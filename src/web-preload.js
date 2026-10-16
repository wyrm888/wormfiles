// Worm page shield — runs at the start of every page in Worm tabs (sandboxed, isolated world).
// Currently handles YouTube, whose ads are served from youtube.com itself and can't be blocked
// by request filtering alone.
const { ipcRenderer, webFrame } = require('electron');

let cfg = { youtube: true };
try { cfg = ipcRenderer.sendSync('web:shieldConfig') || cfg; } catch { /* use defaults */ }

const host = location.hostname;
const isYouTube = /(^|\.)youtube\.com$/.test(host) || /(^|\.)youtube-nocookie\.com$/.test(host);

if (isYouTube && cfg.youtube) {
  // 1) Hide ad slots, promoted results and the "ad blockers are not allowed" popup
  webFrame.insertCSS(`
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
    ytd-display-ad-renderer, ytd-banner-promo-renderer, ytd-promoted-video-renderer,
    ytd-compact-promoted-video-renderer, ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-companion-slot-renderer, ytd-action-companion-ad-renderer, ytd-merch-shelf-renderer,
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    ytd-statement-banner-renderer, ytd-brand-video-singleton-renderer, ytd-brand-video-shelf-renderer,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer), ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    ytd-search-pyv-renderer, ytd-video-masthead-ad-v3-renderer, ad-slot-renderer, ytm-promoted-sparkles-web-renderer,
    #masthead-ad, #player-ads, #panels > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    .ytp-ad-overlay-container, .ytp-ad-overlay-slot, .ytp-ad-image-overlay, .ytp-featured-product,
    ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)
    { display: none !important; }
  `, { cssOrigin: 'user' });

  // 2) Remove ad data before YouTube's player reads it (same technique uBlock Origin uses)
  webFrame.executeJavaScript(`(${youtubeMainWorld.toString()})();`).catch(() => {});

  // Count blocked ads on the shield button
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__worm === 'yt-blocked') ipcRenderer.send('web:ytBlocked');
  });
}

// This function is stringified and runs in the page's own JavaScript world.
function youtubeMainWorld() {
  if (window.__wormShield) return;
  window.__wormShield = true;

  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  let lastReport = 0;
  const report = () => {
    const now = Date.now();
    if (now - lastReport < 1500) return;
    lastReport = now;
    try { window.postMessage({ __worm: 'yt-blocked' }, '*'); } catch (e) { /* ignore */ }
  };

  function strip(o) {
    if (!o || typeof o !== 'object') return false;
    let hit = false;
    for (const k of AD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(o, k)) { delete o[k]; hit = true; }
    }
    return hit;
  }
  function prune(o) {
    if (!o || typeof o !== 'object') return o;
    let hit = strip(o);
    if (o.playerResponse) hit = strip(o.playerResponse) || hit;
    if (o.response && o.response.playerResponse) hit = strip(o.response.playerResponse) || hit;
    if (Array.isArray(o)) {
      for (const x of o) {
        if (x && typeof x === 'object') {
          hit = strip(x) || hit;
          if (x.playerResponse) hit = strip(x.playerResponse) || hit;
        }
      }
    }
    if (hit) report();
    return o;
  }
  const looksLikePlayer = (r) => r && typeof r === 'object' &&
    (r.adPlacements || r.playerAds || r.adSlots || r.playerResponse || Array.isArray(r));

  // JSON.parse — used for /youtubei/v1/player and /next responses
  const origParse = JSON.parse;
  JSON.parse = function (...args) {
    const r = origParse.apply(this, args);
    try { if (looksLikePlayer(r)) prune(r); } catch (e) { /* never break the page */ }
    return r;
  };

  // Response.json() — fetch path
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.call(this).then((r) => { try { if (looksLikePlayer(r)) prune(r); } catch (e) { /* ignore */ } return r; });
  };

  // Data embedded in the first page load
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let val;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() { return val; },
        set(v) { val = prune(v); }
      });
    } catch (e) { /* already defined */ }
  }

  let stuckSince = 0, stuckVideo = '';
  function healCheck(player, video) {
    if (!player || !video || !/^\/(watch|shorts\/|live\/)/.test(location.pathname)) { stuckSince = 0; return; }
    const id = new URLSearchParams(location.search).get('v') || location.pathname;
    if (id !== stuckVideo) { stuckVideo = id; stuckSince = 0; }
    const wantsToPlay = !video.paused || player.classList.contains('playing-mode') || player.classList.contains('buffering-mode');
    const stuck = wantsToPlay && video.currentTime < 0.3 && video.readyState < 3 && !player.classList.contains('ad-showing') && document.visibilityState === 'visible';
    if (!stuck) { stuckSince = 0; return; }
    if (!stuckSince) { stuckSince = Date.now(); return; }
    if (Date.now() - stuckSince < 6000) return;
    stuckSince = 0;
    let done = false;
    try { done = sessionStorage.getItem('worm-healed') === id; sessionStorage.setItem('worm-healed', id); } catch (e) { done = true; }
    if (!done) location.reload(); // only once per video, so it can never loop
  }

  // Safety net: if an ad still starts, mute it, jump to the end and press Skip
  let adActive = false, prevMuted = false, prevRate = 1;
  const SKIP = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[id^="skip-button"], .ytp-ad-skip-button-container button';
  setInterval(() => {
    const player = document.querySelector('#movie_player');
    const video = player && player.querySelector('video');
    const showing = !!(player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')));
    if (showing && video) {
      if (!adActive) { adActive = true; prevMuted = video.muted; prevRate = video.playbackRate || 1; report(); }
      video.muted = true;
      if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
        try { video.currentTime = video.duration; } catch (e) { /* ignore */ }
      }
      try { video.playbackRate = 16; } catch (e) { /* ignore */ }
      document.querySelectorAll(SKIP).forEach((b) => { try { b.click(); } catch (e) { /* ignore */ } });
    } else if (adActive && video) {
      adActive = false;
      video.muted = prevMuted;
      try { video.playbackRate = prevRate; } catch (e) { /* ignore */ }
    }

    // Stuck-video fix: YouTube sometimes won't start the first video after the page opens
    // (the player sits at 0:00 forever until you refresh). If that happens, refresh once by ourselves.
    healCheck(player, video);

    // "Ad blockers violate YouTube's Terms" popup: remove it and keep playing
    const enforce = document.querySelector('ytd-enforcement-message-view-model');
    if (enforce) {
      const dlg = enforce.closest('tp-yt-paper-dialog');
      if (dlg) dlg.remove(); else enforce.remove();
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
      document.body && (document.body.style.overflow = '');
      if (video && video.paused) video.play().catch(() => {});
    }
  }, 250);
}

// =====================================================================
// Pop-out mode: when this tab is moved into the floating video window, make the
// video fill the window and add a small control bar (shows when you move the mouse).
// =====================================================================
const POP_CSS = `
html.worm-pop, html.worm-pop body { overflow: hidden !important; background: #000 !important; }
html.worm-pop .worm-pop-anc {
  transform: none !important; filter: none !important; perspective: none !important; contain: none !important;
  will-change: auto !important; backdrop-filter: none !important; isolation: auto !important; z-index: auto !important;
  clip-path: none !important; mask: none !important;
}
html.worm-pop .worm-pop-anc > :not(.worm-pop-anc):not(.worm-pop-fill):not(#worm-pop-ui) { opacity: 0 !important; pointer-events: none !important; }
html.worm-pop .worm-pop-fill {
  position: fixed !important; inset: 0 !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
  width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
  min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
  border-radius: 0 !important; transform: none !important; z-index: 2147483646 !important; background: #000 !important;
}
html.worm-pop video.worm-pop-fill, html.worm-pop .worm-pop-fill video { object-fit: contain !important; }
html.worm-pop::after { content: ''; position: fixed; inset: 0; border: 2px solid var(--worm-pop-accent, #e11d2e); pointer-events: none; z-index: 2147483647; }
`;
let pop = null;

function popFindVideo() {
  const vs = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 || v.currentSrc);
  if (!vs.length) return null;
  const score = v => { const r = v.getBoundingClientRect(); return (v.paused ? 0 : 1e9) + r.width * r.height; };
  return vs.sort((a, b) => score(b) - score(a))[0];
}
// The box to stretch: the site's own player (keeps its controls and captions), or just the video
function popTargetFor(v) {
  const h = location.hostname;
  if (/youtube/.test(h)) { const t = v.closest('#movie_player, .html5-video-player'); if (t) return t; }
  if (/twitch\.tv$/.test(h)) { const t = v.closest('[data-a-target="video-player"], .video-player__container, .video-player'); if (t) return t; }
  if (/kick\.com$/.test(h)) { const t = v.closest('#injected-embedded-channel-player-video, .video-player'); if (t) return t; }
  const vr = v.getBoundingClientRect();
  let t = v, el = v.parentElement;
  for (let i = 0; el && el !== document.body && i < 6; i++, el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - vr.width) > 8 || Math.abs(r.height - vr.height) > 8) break;
    t = el;
  }
  return t;
}
function popUnmark() {
  document.querySelectorAll('.worm-pop-fill, .worm-pop-anc').forEach(e => e.classList.remove('worm-pop-fill', 'worm-pop-anc'));
}
function popMark() {
  if (!pop) return;
  const v = popFindVideo();
  if (!v) return;
  const t = popTargetFor(v);
  if (pop.target === t && t.isConnected && t.classList.contains('worm-pop-fill')) return;
  popUnmark();
  pop.target = t;
  t.classList.add('worm-pop-fill');
  for (let a = t.parentElement; a; a = a.parentElement) a.classList.add('worm-pop-anc');
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50); // let the site's player re-measure
}

const POP_ICONS = {
  back: '<path d="M10 14L4 8l6-6"/><path d="M4 8h10a6 6 0 0 1 0 12h-3"/>',
  ghost: '<path d="M6 21V10a6 6 0 0 1 12 0v11l-3-2-3 2-3-2z"/><path d="M10 10h.01M14 10h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
};
const popIco = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${POP_ICONS[n]}</svg>`;

function popBuildUi() {
  const host = document.createElement('div');
  host.id = 'worm-pop-ui';
  host.style.cssText = 'position:fixed;inset:0 0 auto 0;height:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { all: initial; }
    .bar { position: fixed; top: 0; left: 0; right: 0; height: 36px; display: flex; align-items: center; gap: 2px; padding: 0 4px 0 10px;
      background: linear-gradient(rgb(0 0 0 / .85), rgb(0 0 0 / .55)); color: #fff; font: 600 12px "Segoe UI", system-ui, sans-serif;
      opacity: 0; transition: opacity .2s; user-select: none; }
    .bar.show, .bar:hover { opacity: 1; }
    .drag { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; cursor: grab; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .drag:active { cursor: grabbing; }
    .drag span { overflow: hidden; text-overflow: ellipsis; opacity: .85; }
    button { all: unset; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; cursor: pointer; flex: none; }
    button:hover { background: rgb(255 255 255 / .18); }
    button.on { color: #ff4d6a; }
    svg { width: 16px; height: 16px; }
    .op { display: flex; align-items: center; gap: 4px; }
    input { width: 64px; accent-color: #e11d2e; cursor: pointer; }
    .msg { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 86vw; padding: 10px 14px; border-radius: 10px;
      background: rgb(0 0 0 / .8); color: #fff; font: 600 13px "Segoe UI", system-ui, sans-serif; text-align: center; pointer-events: none;
      opacity: 0; transition: opacity .25s; }
    .msg.show { opacity: 1; }
    .msg small { display: block; font-weight: 400; opacity: .75; margin-top: 3px; }
  </style>
  <div class="bar">
    <div class="drag" title="Drag to move · Ctrl+scroll to resize"><span></span></div>
    <span class="op" title="See-through (Ctrl+Alt+↑/↓)">${popIco('sun')}<input type="range" min="15" max="100" value="100"></span>
    <button class="ghost" title="Click-through: clicks go to the game underneath (Ctrl+Alt+G)">${popIco('ghost')}</button>
    <button class="back" title="Back to the Worm tab">${popIco('back')}</button>
    <button class="close" title="Close (pauses the video)">${popIco('x')}</button>
  </div>
  <div class="msg"></div>`;
  const $ = (s) => root.querySelector(s);
  const bar = $('.bar'), drag = $('.drag'), msg = $('.msg');
  const show = () => { bar.classList.add('show'); clearTimeout(pop.hideT); pop.hideT = setTimeout(() => bar.classList.remove('show'), 2200); };
  pop.say = (text, sub) => {
    msg.innerHTML = '';
    msg.append(text);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; msg.append(s); }
    msg.classList.add('show');
    clearTimeout(pop.msgT);
    pop.msgT = setTimeout(() => msg.classList.remove('show'), 2600);
  };
  pop.setGhost = (on) => $('.ghost').classList.toggle('on', on);
  pop.setOpacity = (o) => { $('input').value = Math.round(o * 100); };
  pop.setTitle = () => { $('.drag span').textContent = document.title.replace(/ - YouTube$| - Twitch$/, ''); };
  pop.setTitle();
  pop.onMove = () => show();
  window.addEventListener('mousemove', pop.onMove, true);
  pop.onWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    ipcRenderer.send('popout:cmd', { cmd: 'scale', value: e.deltaY < 0 ? 1.08 : 1 / 1.08 });
  };
  window.addEventListener('wheel', pop.onWheel, { capture: true, passive: false });

  drag.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag.setPointerCapture(e.pointerId);
    ipcRenderer.send('popout:drag', { phase: 'start', x: e.screenX, y: e.screenY });
    const move = (ev) => ipcRenderer.send('popout:drag', { phase: 'move', x: ev.screenX, y: ev.screenY });
    const up = () => {
      drag.removeEventListener('pointermove', move);
      drag.removeEventListener('pointerup', up);
      ipcRenderer.send('popout:drag', { phase: 'end' });
    };
    drag.addEventListener('pointermove', move);
    drag.addEventListener('pointerup', up);
  });
  $('input').addEventListener('input', (e) => ipcRenderer.send('popout:cmd', { cmd: 'opacity', value: e.target.value / 100 }));
  $('.ghost').onclick = () => ipcRenderer.send('popout:cmd', { cmd: 'ghost' });
  $('.back').onclick = () => ipcRenderer.send('popout:cmd', { cmd: 'back' });
  $('.close').onclick = () => ipcRenderer.send('popout:cmd', { cmd: 'close' });
  document.documentElement.appendChild(host);
  pop.host = host;
  show();
  pop.say('Floating over everything', 'Drag the top bar to move · drag edges to resize · Ctrl+Alt+G = click-through');
}

function popOn(accent) {
  if (pop) return;
  if (accent) document.documentElement.style.setProperty('--worm-pop-accent', accent);
  pop = { target: null };
  pop.cssKey = webFrame.insertCSS(POP_CSS, { cssOrigin: 'author' });
  document.documentElement.classList.add('worm-pop');
  const start = () => { if (!pop) return; popMark(); if (!pop.host) popBuildUi(); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  // Sites swap their video element (next YouTube video, Twitch ads/raids); keep following it
  pop.timer = setInterval(() => { if (!pop) return; popMark(); pop.setTitle && pop.setTitle(); }, 1000);
}
function popOff() {
  if (!pop) return;
  clearInterval(pop.timer);
  clearTimeout(pop.hideT); clearTimeout(pop.msgT);
  if (pop.onMove) window.removeEventListener('mousemove', pop.onMove, true);
  if (pop.onWheel) window.removeEventListener('wheel', pop.onWheel, { capture: true });
  if (pop.host) pop.host.remove();
  try { webFrame.removeInsertedCSS(pop.cssKey); } catch (e) { /* ignore */ }
  document.documentElement.classList.remove('worm-pop');
  popUnmark();
  pop = null;
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

ipcRenderer.on('popout:mode', (_e, d) => { if (d && d.on) popOn(d.accent); else popOff(); });
ipcRenderer.on('popout:do', (_e, d) => {
  if (!pop || !d) return;
  if (d.ghost !== undefined) {
    pop.setGhost && pop.setGhost(d.ghost);
    pop.say && pop.say(d.ghost ? 'Click-through on' : 'Click-through off', d.ghost ? 'Clicks go to the window underneath · Ctrl+Alt+G to turn off' : '');
  }
  if (d.opacity !== undefined) { pop.setOpacity && pop.setOpacity(d.opacity); }
});
