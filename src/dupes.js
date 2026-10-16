// Duplicate finder: groups files with identical content.
// Fast path: same size -> same first 64 KB -> same full hash. Only possible matches are ever fully read.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { categoryOf } = require('./categories');

const SKIP = new Set(['$recycle.bin', 'system volume information', 'desktop.ini', 'thumbs.db', '$windows.~bt', '$windows.~ws',
  'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp', 'node_modules', '.git', 'windows', 'program files', 'program files (x86)', 'programdata', 'appdata']);
const MAX_FILES = 400000;
const HEAD = 64 * 1024;
const jobs = new Map();

async function hashHead(p, size) {
  const fh = await fsp.open(p, 'r');
  try {
    const len = Math.min(HEAD, size);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    // also sample the end, which catches files that only differ near the end
    const h = crypto.createHash('sha1').update(buf);
    if (size > HEAD * 2) { const tail = Buffer.alloc(4096); await fh.read(tail, 0, 4096, size - 4096); h.update(tail); }
    return h.digest('hex');
  } finally { await fh.close(); }
}
function hashFull(p, job) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(p, { highWaterMark: 1024 * 1024 });
    job.stream = s;
    s.on('data', (d) => { if (job.cancelled) s.destroy(new Error('cancelled')); else h.update(d); });
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}
function regroup(files, keyOf) {
  const m = new Map();
  for (const f of files) { const k = keyOf(f); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
  return [...m.values()].filter(g => g.length > 1);
}

async function scan(id, root, { includeHidden = false, minSize = 1 } = {}, progress) {
  const job = { cancelled: false };
  jobs.set(id, job);
  try {
    // 1) list every file under root
    const bySize = new Map();
    let files = 0, lastTick = 0;
    const queue = [root];
    while (queue.length) {
      if (job.cancelled) return { cancelled: true };
      const dir = queue.pop();
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const d of ents) {
        const lower = d.name.toLowerCase();
        if (SKIP.has(lower) && dir !== root) continue;
        if (!includeHidden && d.name.startsWith('.')) continue;
        const p = path.join(dir, d.name);
        if (d.isSymbolicLink()) continue;
        if (d.isDirectory()) { queue.push(p); continue; }
        if (!d.isFile()) continue;
        let st;
        try { st = await fsp.stat(p); } catch { continue; }
        if (st.size < minSize) continue;
        files++;
        const f = { path: p, name: d.name, size: st.size, mtime: st.mtimeMs, cat: categoryOf(d.name, false) };
        if (!bySize.has(st.size)) bySize.set(st.size, []);
        bySize.get(st.size).push(f);
        if (files - lastTick >= 500) { lastTick = files; progress({ id, stage: 'list', files }); }
        if (files >= MAX_FILES) { queue.length = 0; break; }
      }
    }
    // 2) same size -> compare the start (and end) of each file
    const sameSize = [...bySize.values()].filter(g => g.length > 1);
    const total = sameSize.reduce((a, g) => a + g.length, 0);
    let done = 0;
    const groups = [];
    for (const g of sameSize) {
      if (job.cancelled) return { cancelled: true };
      for (const f of g) { try { f.head = await hashHead(f.path, f.size); } catch { f.head = null; } done++; }
      progress({ id, stage: 'hash', done, total });
      for (const hg of regroup(g, f => f.head)) {
        // 3) small files are fully compared already; bigger ones get a full hash
        if (hg[0].size <= HEAD) { groups.push(hg); continue; }
        for (const f of hg) { try { f.full = await hashFull(f.path, job); } catch (e) { if (job.cancelled) return { cancelled: true }; f.full = null; } }
        groups.push(...regroup(hg, f => f.full));
      }
    }
    const out = groups.map(g => ({ size: g[0].size, files: g.map(({ path: p, name, mtime, cat }) => ({ path: p, name, mtime, cat })) }))
      .sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
    return { groups: out, files, capped: files >= MAX_FILES };
  } finally {
    jobs.delete(id);
  }
}
function cancel(id) {
  const j = jobs.get(id);
  if (!j) return;
  j.cancelled = true;
  if (j.stream) j.stream.destroy();
}
module.exports = { scan, cancel };
