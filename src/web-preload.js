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
