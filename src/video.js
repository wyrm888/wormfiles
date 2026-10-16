// Video tools: shrink a video to fit a file size (e.g. Discord's upload limit), using the bundled ffmpeg.
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn, spawnSync } = require('child_process');

let ffmpegPath;
function ffmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  ffmpegPath = null;
  try {
    const p = require('ffmpeg-static');
    if (p) {
      const unpacked = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      if (fs.existsSync(unpacked)) ffmpegPath = unpacked;
      else if (fs.existsSync(p)) ffmpegPath = p;
    }
  } catch { /* not installed */ }
  if (!ffmpegPath) { // fall back to an ffmpeg the person installed themselves
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
    const first = (r.stdout || '').split(/\r?\n/).find(Boolean);
    if (first && fs.existsSync(first.trim())) ffmpegPath = first.trim();
  }
  return ffmpegPath;
}

const toSec = (h, m, s) => +h * 3600 + +m * 60 + parseFloat(s);

// Duration, size, resolution, fps and audio of a video (from ffmpeg's own report)
function probe(file) {
  return new Promise((resolve, reject) => {
    const bin = ffmpeg();
    if (!bin) return reject(new Error('ffmpeg is missing. Reinstall WormFiles to get the video tools.'));
    const p = spawn(bin, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', () => {
      const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
      const v = /Stream #\S+.*?: Video: .*?(\d{2,5})x(\d{2,5})/.exec(err);
      const fps = /, ([\d.]+) fps/.exec(err);
      const audio = /Stream #\S+.*?: Audio:/.test(err);
      if (!d || !v) return reject(new Error("This doesn't look like a video ffmpeg can read."));
      resolve({ duration: toSec(d[1], d[2], d[3]), width: +v[1], height: +v[2], fps: fps ? +fps[1] : 30, audio });
    });
  });
}

// Pick bitrates and a resolution that fit `targetBytes`
function plan(info, targetBytes) {
  const total = (targetBytes * 8) / 1000 / info.duration * 0.94; // kbit/s, leaving room for the file's own overhead
  let audio = 0;
  if (info.audio) audio = total > 2000 ? 160 : total > 800 ? 128 : total > 300 ? 96 : total > 150 ? 64 : 32;
  const video = Math.floor(total - audio);
  const maxH = video >= 5000 ? 1440 : video >= 2500 ? 1080 : video >= 1200 ? 720 : video >= 600 ? 540 : video >= 300 ? 360 : 240;
  const height = Math.min(info.height, maxH);
  const fps = video < 1500 && info.fps > 30 ? 30 : null;
  const quality = video >= 2500 ? 'Great' : video >= 1200 ? 'Good' : video >= 500 ? 'OK' : video >= 150 ? 'Low' : 'Very low';
  return { audio, video, height, fps, quality, possible: video >= 40 };
}

const jobs = new Map(); // id -> { procs, cancelled }

function run(bin, args, job, onTime) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    job.procs.push(p);
    let tail = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-3000);
      const m = /time=(\d+):(\d+):([\d.]+)/g;
      let x, last = null;
      while ((x = m.exec(s))) last = x;
      if (last) onTime(toSec(last[1], last[2], last[3]));
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (job.cancelled) return reject(new Error('cancelled'));
      if (code === 0) resolve();
      else reject(new Error((tail.split(/\r?\n/).filter(Boolean).pop() || 'ffmpeg failed').slice(0, 300)));
    });
  });
}

async function uniqueOut(file, mb) {
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  let out = path.join(dir, `${base} (${mb} MB).mp4`);
  for (let i = 2; fs.existsSync(out); i++) out = path.join(dir, `${base} (${mb} MB) ${i}.mp4`);
  return out;
}

// Two-pass encode so the result lands just under the target size
async function shrink({ id, file, targetMB }, send) {
  const bin = ffmpeg();
  if (!bin) throw new Error('ffmpeg is missing. Reinstall WormFiles to get the video tools.');
  const info = await probe(file);
  const targetBytes = Math.floor(targetMB * 1024 * 1024 * 0.995);
  const size = (await fsp.stat(file)).size;
  if (size <= targetBytes) return { already: true, size };
  const job = { procs: [], cancelled: false };
  jobs.set(id, job);
  const out = await uniqueOut(file, targetMB);
  const logBase = path.join(os.tmpdir(), `wormfiles-2pass-${process.pid}-${id}`);
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const report = (pass, t, attempt) => send({ id, pass, attempt, pct: Math.min(99, Math.round(((pass - 1) + Math.min(1, t / info.duration)) * 50)) });
  try {
    let p = plan(info, targetBytes);
    if (!p.possible) throw new Error(`${targetMB} MB is too small for a video this long. Try a bigger size or trim it first.`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const vf = [`scale=-2:'min(${p.height},ih)':flags=lanczos`, 'format=yuv420p'];
      const common = ['-hide_banner', '-y', '-i', file, '-map', '0:v:0', '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'medium',
        '-b:v', `${p.video}k`, '-maxrate', `${Math.round(p.video * 1.5)}k`, '-bufsize', `${p.video * 2}k`, '-passlogfile', logBase];
      if (p.fps) common.push('-fpsmax', String(p.fps));
      await run(bin, [...common, '-pass', '1', '-an', '-f', 'null', nul], job, (t) => report(1, t, attempt));
      const audioArgs = info.audio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${p.audio}k`, '-ac', p.audio < 96 ? '1' : '2'] : [];
      await run(bin, [...common, ...audioArgs, '-pass', '2', '-movflags', '+faststart', out], job, (t) => report(2, t, attempt));
      const got = (await fsp.stat(out)).size;
      if (got <= targetBytes) return { out, size: got, height: p.height, quality: p.quality };
      // A little too big (it happens with very short or very still videos): aim lower and redo
      const ratio = (targetBytes / got) * 0.97;
      p = { ...p, video: Math.max(40, Math.floor(p.video * ratio)), audio: p.audio > 64 ? Math.floor(p.audio * 0.8) : p.audio };
    }
    const got = (await fsp.stat(out)).size;
    return { out, size: got, height: p.height, quality: p.quality, over: true };
  } catch (e) {
    await fsp.unlink(out).catch(() => {});
    throw e;
  } finally {
    jobs.delete(id);
    for (const f of [logBase + '-0.log', logBase + '-0.log.mbtree']) fsp.unlink(f).catch(() => {});
  }
}

function cancel(id) {
  const j = jobs.get(id);
  if (!j) return;
  j.cancelled = true;
  for (const p of j.procs) { try { p.kill(); } catch { /* gone */ } }
}

module.exports = { ffmpeg, probe, plan, shrink, cancel };
