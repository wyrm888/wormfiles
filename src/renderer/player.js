// =====================================================================
// Media player — plays videos and music inside WormFiles
// =====================================================================
const PL_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv']);
const PL_AUDIO = new Set(['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'weba']);
const PL_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
const PL = {
  open: false, mini: false, list: [], idx: -1, token: 0, kind: 'video',
  loop: 'off', shuffle: false, history: [], tags: null, subs: null, idleTimer: 0, lastSave: 0, fsExitAt: 0, seeking: false
};

const isPlayable = (e) => !!e && !e.isDir && (PL_VIDEO.has(e.ext) || PL_AUDIO.has(e.ext));
const plMedia = () => $('#pl-media');
const plStore = {
  get(k, d) { try { const v = localStorage.getItem('wf-pl-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wf-pl-' + k, JSON.stringify(v)); } catch { /* storage off */ } }
};
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
const stripExt = (n) => n.replace(/\.[^.]+$/, '');

// ---------- Opening ----------
// Plays `e`, with the other videos/songs in the same folder as the "up next" list
function openPlayer(e, list) {
  if (!list) {
    const vis = (tab().visible || []).filter(isPlayable);
    list = vis.some(x => x.path === e.path) ? vis : [e];
  }
  if (PL.open) plSavePos(true); // remember the spot in whatever was playing before
  PL.list = list.slice();
  PL.idx = -1;
  PL.history = [];
  if (QL.open) quickLookClose();
  showPlayer(false);
  plPlay(Math.max(0, PL.list.findIndex(x => x.path === e.path)));
}
// Opens several selected files: all the videos/songs become one playlist, anything else opens normally
function openEntries(list) {
  const media = S.mediaPlayer !== false ? list.filter(isPlayable) : [];
  if (media.length > 1) {
    list.filter(x => !media.includes(x)).slice(0, 15).forEach(x => openEntry(x));
    openPlayer(media[0], media);
  } else list.slice(0, 15).forEach(x => openEntry(x));
}

function showPlayer(mini) {
  const el = $('#player');
  PL.open = true;
  PL.mini = !!mini;
  el.classList.remove('hidden');
  el.classList.toggle('mini', PL.mini);
  document.body.classList.toggle('pl-mini', PL.mini);
  if (PL.mini && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!PL.mini) { el.focus({ preventScroll: true }); plWake(); }
  if (isWebTab()) webSync();
}
function closePlayer() {
  plSavePos(true);
  PL.open = false; PL.mini = false; PL.token++;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  const m = plMedia();
  m.pause();
  m.removeAttribute('src');
  m.querySelectorAll('track').forEach(t => t.remove());
  m.load();
  if (PL.subs) { URL.revokeObjectURL(PL.subs); PL.subs = null; }
  $('#player').classList.add('hidden');
  document.body.classList.remove('pl-mini');
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  if (isWebTab()) webSync(); else $('#content').focus();
}

// ---------- Loading a track ----------
async function plPlay(i, { resume = true } = {}) {
  const e = PL.list[i];
  if (!e) return;
  plSavePos(true);
  if (PL.idx >= 0 && PL.idx !== i) PL.history.push(PL.idx);
  PL.idx = i;
  const token = ++PL.token;
  const el = $('#player');
  const m = plMedia();
  PL.kind = PL_AUDIO.has(e.ext) ? 'audio' : 'video';
  PL.tags = null;
  el.classList.toggle('audio', PL.kind === 'audio');
  el.classList.remove('error', 'nosubs');
  $('.pl-msg').classList.add('hidden');
  $('.pl-resume').classList.add('hidden');
  $('.pl-title').textContent = stripExt(e.name);
  $('.pl-sub').textContent = [PL.list.length > 1 ? `${i + 1} of ${PL.list.length}` : '', typeLabel(e), fmtSize(e.size)].filter(Boolean).join(' · ');
  $('.pl-mini-title').textContent = stripExt(e.name);
  plSetArt(null, e);

  m.querySelectorAll('track').forEach(t => t.remove());
  if (PL.subs) { URL.revokeObjectURL(PL.subs); PL.subs = null; }
  $('#pl-cc').classList.add('hidden');

  let src;
  try { src = await realPathFor(e); } catch (err) { if (token === PL.token) plError(String(err && err.message || err)); return; }
  if (token !== PL.token) return;
  m.loop = PL.loop === 'one';
  m.src = fileUrl(src);
  m.playbackRate = plStore.get('speed', 1);
  const saved = resume ? (plStore.get('resume', {})[e.path] || 0) : 0;
  m.addEventListener('loadedmetadata', () => {
    if (token !== PL.token) return;
    if (saved > 5 && saved < m.duration - 10) {
      m.currentTime = saved;
      const r = $('.pl-resume');
      r.querySelector('span').textContent = `Resumed at ${fmtTime(saved)}`;
      r.classList.remove('hidden');
      clearTimeout(PL.resumeTimer);
      PL.resumeTimer = setTimeout(() => r.classList.add('hidden'), 6000);
    }
    // A "video" with no picture (e.g. an .mp4 song) shows the music layout
    if (PL.kind === 'video' && !m.videoWidth) { PL.kind = 'audio'; el.classList.add('audio'); plLoadTags(e, src, token); }
  }, { once: true });
  m.play().catch(() => {});
  plRenderList();
  plSyncButtons();
  if (PL.kind === 'audio') plLoadTags(e, src, token);
  else plLoadSubs(e, token);
  plMediaSession(e);
  if (!e.inArchive) api.addRecent(e.path);
}

async function plLoadTags(e, src, token) {
  const tags = await api.mediaTags(src).catch(() => ({})) || {};
  if (token !== PL.token) return;
  PL.tags = tags;
  plSetArt(tags, e);
  plMediaSession(e);
}
function plSetArt(tags, e) {
  const t = tags || {};
  const cover = $('.pl-cover');
  cover.innerHTML = t.pic ? `<img src="${esc(t.pic)}" alt="">` : icon('music');
  cover.classList.toggle('none', !t.pic);
  $('.pl-backdrop').style.backgroundImage = t.pic ? `url("${t.pic}")` : '';
  $('.pl-song').textContent = t.title || stripExt(e.name);
  $('.pl-artist').textContent = [t.artist, t.album].filter(Boolean).join(' · ');
  $('.pl-art').classList.toggle('hidden', PL.kind !== 'audio');
  if (t.title) {
    $('.pl-title').textContent = t.artist ? `${t.artist} — ${t.title}` : t.title;
    $('.pl-mini-title').textContent = $('.pl-title').textContent;
  }
}

// Subtitles: a .srt or .vtt next to the video with the same name (e.g. Movie.srt or Movie.en.srt)
async function plLoadSubs(e, token) {
  if (e.inArchive) return;
  const base = stripExt(e.name).toLowerCase();
  const sib = (tab().entries || []).find(x => !x.isDir && (x.ext === 'srt' || x.ext === 'vtt') &&
    (stripExt(x.name).toLowerCase() === base || stripExt(x.name).toLowerCase().startsWith(base + '.')));
  if (!sib) return;
  let txt = await api.readText(sib.path, 4 * 1024 * 1024).catch(() => null);
  if (token !== PL.token || !txt) return;
  if (sib.ext === 'srt') txt = 'WEBVTT\n\n' + txt.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
  PL.subs = URL.createObjectURL(new Blob([txt], { type: 'text/vtt' }));
  const tr = document.createElement('track');
  tr.kind = 'subtitles'; tr.label = 'Subtitles'; tr.src = PL.subs; tr.default = plStore.get('subs', true);
  plMedia().appendChild(tr);
  const cc = $('#pl-cc');
  cc.classList.remove('hidden');
  setTimeout(() => plSubsShow(plStore.get('subs', true)), 0);
}
function plSubsShow(on) {
  const t = plMedia().textTracks[0];
  if (!t) return;
  t.mode = on ? 'showing' : 'hidden';
  $('#pl-cc').classList.toggle('on', on);
}

function plError(why) {
  const e = PL.list[PL.idx];
  $('#player').classList.add('error');
  const msg = $('.pl-msg');
  msg.innerHTML = `${icon(PL.kind === 'audio' ? 'music' : 'video', 'pl-msg-ico')}
    <b>WormFiles can't play this file</b>
    <span class="dim">${esc(why || 'It uses a format that is not supported here (common with .mkv, .avi and .wmv files).')}</span>
    <div class="row"><button class="btn primary" id="pl-ext">Open with default app</button>${PL.list.length > 1 ? '<button class="btn" id="pl-skip">Skip to next</button>' : ''}</div>`;
  msg.classList.remove('hidden');
  msg.querySelector('#pl-ext').onclick = () => { plMedia().pause(); if (e) api.open(e.path); };
  const sk = msg.querySelector('#pl-skip');
  if (sk) sk.onclick = () => plNext(true);
  plWake();
}

// ---------- Playlist ----------
function plNextIndex(manual) {
  const n = PL.list.length;
  if (PL.shuffle && n > 1) {
    let j;
    do j = Math.floor(Math.random() * n); while (j === PL.idx);
    return j;
  }
  if (PL.idx + 1 < n) return PL.idx + 1;
  return PL.loop === 'all' || manual ? 0 : -1;
}
function plNext(manual = false) {
  const j = plNextIndex(manual);
  if (j < 0) return false;
  plPlay(j);
  return true;
}
function plPrev() {
  const m = plMedia();
  if (m.currentTime > 3 || PL.list.length < 2) { m.currentTime = 0; return; }
  const j = PL.shuffle && PL.history.length ? PL.history.pop() : (PL.idx - 1 + PL.list.length) % PL.list.length;
  const keep = PL.history.slice();
  plPlay(j);
  if (PL.shuffle) PL.history = keep; // going back shouldn't grow the history
}
function plRenderList() {
  const rows = $('.pl-list-rows');
  $('#pl-list-count').textContent = PL.list.length > 1 ? `${PL.list.length} files` : '';
  rows.innerHTML = PL.list.map((x, i) => `<div class="pl-item ${i === PL.idx ? 'on' : ''}" data-i="${i}" title="${esc(x.name)}">
      <span class="pl-item-n">${i === PL.idx ? icon('play') : i + 1}</span>
      <span class="pl-item-thumb" data-p="${esc(x.path)}">${icon(PL_AUDIO.has(x.ext) ? 'music' : 'video')}</span>
      <span class="pl-item-name">${esc(stripExt(x.name))}</span>
      <span class="pl-item-size dim">${fmtSize(x.size)}</span></div>`).join('');
  const on = rows.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
  // Video thumbnails, a few at a time
  const thumbs = [...rows.querySelectorAll('.pl-item-thumb')].filter((el, i) => PL_VIDEO.has(PL.list[i].ext) && !PL.list[i].inArchive);
  const token = PL.token;
  (async () => {
    for (const el of thumbs.slice(0, 200)) {
      if (token !== PL.token) return;
      const pic = await api.thumb(el.dataset.p, 96).catch(() => null);
      if (pic && el.isConnected) el.innerHTML = `<img src="${pic}" alt="">`;
    }
  })();
}

// ---------- Controls ----------
function plToggle() {
  const m = plMedia();
  if (!m.src) return;
  if (m.paused || m.ended) m.play().catch(() => {}); else m.pause();
  plFlash(m.paused ? 'pause' : 'play');
}
function plSeekBy(s) {
  const m = plMedia();
  if (!isFinite(m.duration)) return;
  m.currentTime = Math.max(0, Math.min(m.duration - 0.05, m.currentTime + s));
  plFlash(null, (s > 0 ? '+' : '−') + Math.abs(s) + 's');
}
function plSetVolume(v, show = true) {
  const m = plMedia();
  v = Math.max(0, Math.min(1, v));
  m.volume = v;
  if (v > 0) m.muted = false;
  plStore.set('volume', v);
  if (show) plFlash(null, Math.round(v * 100) + '%');
}
function plSetSpeed(r) {
  plMedia().playbackRate = r;
  plStore.set('speed', r);
  plFlash(null, r + '×');
  plSyncButtons();
}
function plStepSpeed(dir) {
  const r = plMedia().playbackRate;
  const i = PL_SPEEDS.findIndex(x => x >= r - 0.001);
  plSetSpeed(PL_SPEEDS[Math.max(0, Math.min(PL_SPEEDS.length - 1, (i < 0 ? 3 : i) + dir))]);
}
function plCycleLoop() {
  PL.loop = PL.loop === 'off' ? 'all' : PL.loop === 'all' ? 'one' : 'off';
  plMedia().loop = PL.loop === 'one';
  plStore.set('loop', PL.loop);
  plSyncButtons();
  plFlash(null, PL.loop === 'off' ? 'Repeat off' : PL.loop === 'all' ? 'Repeat all' : 'Repeat this one');
}
function plToggleShuffle() {
  PL.shuffle = !PL.shuffle;
  plStore.set('shuffle', PL.shuffle);
  plSyncButtons();
  plFlash(null, PL.shuffle ? 'Shuffle on' : 'Shuffle off');
}
function plToggleFullscreen() {
  if (PL.mini) showPlayer(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {}); // the whole page, so menus still show
}
async function plTogglePip() {
  const m = plMedia();
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (PL.kind === 'video') await m.requestPictureInPicture();
  } catch { toast("Picture in picture isn't available for this video", { error: true }); }
}
function plToggleList(force) {
  const el = $('.pl-list');
  const show = force ?? el.classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  $('#pl-list-btn').classList.toggle('on', show);
  plStore.set('list', show);
  if (show) { const on = el.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
}

function plSyncButtons() {
  const m = plMedia();
  const setIco = (sel, name) => { const b = $(sel); if (b.dataset.ico !== name) { b.innerHTML = icon(name); b.dataset.ico = name; } };
  setIco('#pl-play', m.paused ? 'play' : 'pause');
  setIco('#pl-mute', m.muted || m.volume === 0 ? 'mute' : m.volume < 0.5 ? 'volumelow' : 'volume');
  setIco('#pl-loop', PL.loop === 'one' ? 'repeatone' : 'repeat');
  setIco('#pl-fs', document.fullscreenElement ? 'unfullscreen' : 'fullscreen');
  $('#pl-loop').classList.toggle('on', PL.loop !== 'off');
  $('#pl-shuffle').classList.toggle('on', PL.shuffle);
  $('#pl-speed').textContent = (+m.playbackRate.toFixed(2)) + '×';
  $('#pl-speed').classList.toggle('on', m.playbackRate !== 1);
  $('#pl-volume').value = m.muted ? 0 : m.volume;
  $('#pl-volume').style.setProperty('--v', (m.muted ? 0 : m.volume) * 100 + '%');
  const many = PL.list.length > 1;
  $('#pl-next').disabled = !many;
  $('#pl-shuffle').classList.toggle('hidden', !many);
  $('#pl-pip').classList.toggle('hidden', PL.kind !== 'video' || !document.pictureInPictureEnabled);
  $('#player').classList.toggle('paused', m.paused);
}
function plSyncTime() {
  const m = plMedia();
  const d = m.duration;
  const pct = isFinite(d) && d > 0 ? (m.currentTime / d) * 100 : 0;
  $('.pl-fill').style.width = pct + '%';
  $('.pl-knob').style.left = pct + '%';
  $('#pl-cur').textContent = fmtTime(m.currentTime);
  $('#pl-dur').textContent = fmtTime(d);
  let buf = 0;
  for (let i = 0; i < m.buffered.length; i++) if (m.buffered.start(i) <= m.currentTime + 1) buf = Math.max(buf, m.buffered.end(i));
  $('.pl-buf').style.width = (isFinite(d) && d > 0 ? (buf / d) * 100 : 0) + '%';
  if ('mediaSession' in navigator && isFinite(d) && d > 0) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(m.currentTime, d), playbackRate: m.playbackRate }); } catch { /* ignore */ }
  }
}

// Remembers where you stopped in long videos/songs (over 3 minutes)
function plSavePos(force) {
  const m = plMedia();
  const e = PL.list[PL.idx];
  if (!e || !isFinite(m.duration) || m.duration < 180) return;
  const now = Date.now();
  if (!force && now - PL.lastSave < 5000) return;
  PL.lastSave = now;
  const all = plStore.get('resume', {});
  delete all[e.path];
  if (m.currentTime > 5 && m.currentTime < m.duration - 10) all[e.path] = Math.floor(m.currentTime);
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete all[k];
  plStore.set('resume', all);
}

// Big play/pause/seek feedback in the middle of the screen
function plFlash(ico, text) {
  if (PL.mini) return;
  const f = $('.pl-flash');
  f.innerHTML = ico ? icon(ico) : `<span>${esc(text)}</span>`;
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
}
// Controls fade out while a video plays and the mouse is still
function plWake() {
  const el = $('#player');
  el.classList.remove('idle');
  clearTimeout(PL.idleTimer);
  PL.idleTimer = setTimeout(() => {
    const m = plMedia();
    if (PL.open && !PL.mini && PL.kind === 'video' && !m.paused && !PL.seeking && !el.matches('.pl-controls:hover, :has(.pl-controls:hover)')) el.classList.add('idle');
  }, 2500);
}

function plMediaSession(e) {
  if (!('mediaSession' in navigator)) return;
  const t = PL.tags || {};
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || stripExt(e.name), artist: t.artist || '', album: t.album || 'WormFiles',
      artwork: t.pic ? [{ src: t.pic }] : []
    });
  } catch { /* ignore */ }
}

// ---------- Keyboard (full player only; the mini player leaves keys to the file list) ----------
function handlePlayerKey(e) {
  if (e.target.matches('input[type=text], textarea')) return;
  const k = e.key, m = plMedia();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (k === 't' || k === 'T' || k === 'w' || k === 'W' || k === 'Tab')) { showPlayer(true); return false; } // let tab shortcuts through
  e.preventDefault();
  plWake();
  if (k === 'Escape') {
    if (!$('#ctx').classList.contains('hidden')) { hideMenus(); return; }
    if (document.fullscreenElement || Date.now() - PL.fsExitAt < 400) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); return; }
    closePlayer(); return;
  }
  if (k === ' ' || k === 'k' || k === 'K' || k === 'MediaPlayPause') return plToggle();
  if (k === 'ArrowRight') return plSeekBy(e.shiftKey ? 30 : 5);
  if (k === 'ArrowLeft') return plSeekBy(e.shiftKey ? -30 : -5);
  if (k === 'l' || k === 'L') return plSeekBy(10);
  if (k === 'j' || k === 'J') return plSeekBy(-10);
  if (k === 'ArrowUp') return plSetVolume((m.muted ? 0 : m.volume) + 0.05);
  if (k === 'ArrowDown') return plSetVolume((m.muted ? 0 : m.volume) - 0.05);
  if (k === 'm' || k === 'M') { m.muted = !m.muted; plStore.set('muted', m.muted); plFlash(m.muted ? 'mute' : 'volume'); return; }
  if (k === 'f' || k === 'F' || (k === 'Enter' && e.altKey)) return plToggleFullscreen();
  if (k === 'n' || k === 'N' || k === 'MediaTrackNext' || k === 'PageDown') return plNext(true);
  if (k === 'p' || k === 'P' || k === 'MediaTrackPrevious' || k === 'PageUp') return plPrev();
  if (k === '>' || (k === '.' && e.shiftKey)) return plStepSpeed(1);
  if (k === '<' || (k === ',' && e.shiftKey)) return plStepSpeed(-1);
  if (k === ',' && m.paused) { m.currentTime = Math.max(0, m.currentTime - 1 / 30); return; } // frame by frame
  if (k === '.' && m.paused) { m.currentTime += 1 / 30; return; }
  if (k === 'r' || k === 'R') return plCycleLoop();
  if (k === 's' || k === 'S') return plToggleShuffle();
  if (k === 'q' || k === 'Q') return plToggleList();
  if (k === 'c' || k === 'C') { const on = !$('#pl-cc').classList.contains('on'); plStore.set('subs', on); plSubsShow(on); return; }
  if (k === 'Home') { m.currentTime = 0; return; }
  if (k === 'End' && isFinite(m.duration)) { m.currentTime = m.duration - 0.1; return; }
  if (/^[0-9]$/.test(k) && isFinite(m.duration)) { m.currentTime = m.duration * (+k / 10); return; }
}

// ---------- Setup ----------
function setupPlayer() {
  const el = $('#player'), m = plMedia();
  hydrateIcons(el);
  m.volume = plStore.get('volume', 0.8);
  m.muted = plStore.get('muted', false);
  PL.loop = plStore.get('loop', 'off');
  PL.shuffle = plStore.get('shuffle', false);
  if (plStore.get('list', false)) plToggleList(true);

  m.addEventListener('play', () => { plSyncButtons(); plWake(); });
  m.addEventListener('pause', () => { plSyncButtons(); plWake(); plSavePos(true); });
  m.addEventListener('volumechange', plSyncButtons);
  m.addEventListener('ratechange', plSyncButtons);
  m.addEventListener('timeupdate', () => { if (!PL.seeking) plSyncTime(); plSavePos(false); });
  m.addEventListener('durationchange', plSyncTime);
  m.addEventListener('progress', plSyncTime);
  m.addEventListener('ended', () => {
    const e = PL.list[PL.idx];
    if (e) { const all = plStore.get('resume', {}); if (all[e.path]) { delete all[e.path]; plStore.set('resume', all); } }
    if (!plNext(false)) plSyncButtons();
  });
  m.addEventListener('error', () => { if (PL.open && m.getAttribute('src')) plError(); });

  // Stage: click = play/pause, double-click = fullscreen, wheel = volume
  const stage = el.querySelector('.pl-stage');
  stage.addEventListener('mousemove', plWake);
  stage.addEventListener('click', (e) => {
    if (PL.mini) { if (!e.target.closest('button, input, .pl-seek')) showPlayer(false); return; }
    if (e.target === m || e.target === stage || e.target.closest('.pl-art, .pl-backdrop')) plToggle();
  });
  stage.addEventListener('dblclick', (e) => { if (!PL.mini && (e.target === m || e.target === stage)) plToggleFullscreen(); });
  stage.addEventListener('wheel', (e) => {
    if (PL.mini || e.target.closest('.pl-list')) return;
    e.preventDefault();
    plSetVolume((m.muted ? 0 : m.volume) + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });

  // Seek bar with drag and hover time
  const seek = el.querySelector('.pl-seek'), tip = el.querySelector('.pl-tip');
  const posAt = (x) => { const r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
  seek.addEventListener('pointermove', (e) => {
    if (!isFinite(m.duration)) return;
    const p = posAt(e.clientX);
    tip.textContent = fmtTime(p * m.duration);
    tip.style.left = p * 100 + '%';
    tip.classList.remove('hidden');
    if (PL.seeking) { $('.pl-fill').style.width = p * 100 + '%'; $('.pl-knob').style.left = p * 100 + '%'; $('#pl-cur').textContent = fmtTime(p * m.duration); }
  });
  seek.addEventListener('pointerleave', () => { if (!PL.seeking) tip.classList.add('hidden'); });
  seek.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !isFinite(m.duration)) return;
    PL.seeking = true;
    seek.setPointerCapture(e.pointerId);
    seek.classList.add('dragging');
    const p = posAt(e.clientX);
    $('.pl-fill').style.width = p * 100 + '%'; $('.pl-knob').style.left = p * 100 + '%';
  });
  const endSeek = (e) => {
    if (!PL.seeking) return;
    PL.seeking = false;
    seek.classList.remove('dragging');
    tip.classList.add('hidden');
    m.currentTime = posAt(e.clientX) * m.duration;
    plSyncTime();
  };
  seek.addEventListener('pointerup', endSeek);
  seek.addEventListener('pointercancel', () => { PL.seeking = false; seek.classList.remove('dragging'); plSyncTime(); });

  // Buttons
  $('#pl-play').onclick = plToggle;
  $('#pl-next').onclick = () => plNext(true);
  $('#pl-prev').onclick = plPrev;
  $('#pl-loop').onclick = plCycleLoop;
  $('#pl-shuffle').onclick = plToggleShuffle;
  $('#pl-fs').onclick = plToggleFullscreen;
  $('#pl-pip').onclick = plTogglePip;
  $('#pl-list-btn').onclick = () => plToggleList();
  $('#pl-close').onclick = closePlayer;
  $('#pl-mini-close').onclick = closePlayer;
  $('#pl-mini-btn').onclick = () => showPlayer(true);
  $('#pl-expand').onclick = () => {
    // Worm pages sit on top of everything, so go to a folder tab first
    if (isWebTab() || mailActive) {
      const fi = tabs.findIndex(t => t.kind !== 'web');
      if (fi >= 0) activateTab(fi); else newTab();
    }
    showPlayer(false);
  };
  $('#pl-cc').onclick = () => { const on = !$('#pl-cc').classList.contains('on'); plStore.set('subs', on); plSubsShow(on); };
  $('#pl-restart').onclick = () => { m.currentTime = 0; $('.pl-resume').classList.add('hidden'); m.play().catch(() => {}); };
  $('#pl-mute').onclick = () => { if (m.volume === 0) plSetVolume(0.5, false); else m.muted = !m.muted; plStore.set('muted', m.muted); };
  $('#pl-volume').oninput = (e) => plSetVolume(+e.target.value, false);
  $('#pl-speed').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.top - 8, [{ heading: 'Speed' }, ...PL_SPEEDS.slice().reverse().map(s => ({ label: s === 1 ? 'Normal' : s + '×', checked: Math.abs(m.playbackRate - s) < 0.001, action: () => plSetSpeed(s) }))]);
  };
  el.querySelector('.pl-list-rows').addEventListener('click', (e) => {
    const row = e.target.closest('.pl-item');
    if (row) plPlay(+row.dataset.i);
  });
  el.querySelector('.pl-list-rows').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.pl-item');
    if (!row) return;
    e.preventDefault();
    const i = +row.dataset.i, x = PL.list[i];
    showMenu(e.clientX, e.clientY, [
      { label: 'Play', icon: 'play', action: () => plPlay(i) },
      i !== PL.idx && { label: 'Remove from list', icon: 'x', action: () => { PL.list.splice(i, 1); if (i < PL.idx) PL.idx--; PL.history = []; plRenderList(); plSyncButtons(); } },
      '-',
      !x.inArchive && { label: 'Show in folder', icon: 'folder', action: () => { showPlayer(true); navigate(parentOf(x.path), { keepSelection: x.path }); } },
      { label: 'Open with default app', icon: 'app', action: () => { m.pause(); api.open(x.path); } }
    ]);
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) PL.fsExitAt = Date.now();
    el.classList.toggle('fs', !!document.fullscreenElement && PL.open && !PL.mini);
    plSyncButtons();
  });

  // Windows media keys and the volume flyout's play/pause/next buttons
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    h('play', () => m.play().catch(() => {}));
    h('pause', () => m.pause());
    h('nexttrack', () => { if (PL.open) plNext(true); });
    h('previoustrack', () => { if (PL.open) plPrev(); });
    h('seekbackward', () => plSeekBy(-10));
    h('seekforward', () => plSeekBy(10));
    h('seekto', (d) => { if (d.seekTime != null) m.currentTime = d.seekTime; });
  }
  plSyncButtons();
}
