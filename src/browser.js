// Worm — the WormFiles built-in privacy browser (main process side).
// Each browser tab is a WebContentsView laid over the content area of the window.
const { app, WebContentsView, ipcMain, session, Menu, clipboard, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const PARTITION = 'persist:wormfiles-web';

// Small built-in tracker list, used only if the full ad blocker can't load.
const FALLBACK_BLOCK = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
  'adservice.google.com', 'connect.facebook.net', 'scorecardresearch.com', 'quantserve.com', 'adnxs.com', 'criteo.com',
  'criteo.net', 'taboola.com', 'outbrain.com', 'amazon-adsystem.com', 'hotjar.com', 'mixpanel.com', 'cdn.segment.com',
  'pubmatic.com', 'rubiconproject.com', 'openx.net', 'casalemedia.com', 'moatads.com', 'adsrvr.org', 'bidswitch.net',
  'teads.tv', 'media.net', 'adform.net', 'smartadserver.com', 'chartbeat.com', 'nr-data.net', 'fullstory.com',
  'mouseflow.com', 'clarity.ms', 'bat.bing.com', 'ads.linkedin.com', 'analytics.tiktok.com', 'ads-twitter.com',
  'adsafeprotected.com', 'doubleverify.com', 'krxd.net', 'bluekai.com', 'demdex.net', 'omtrdc.net', 'everesttech.net',
  'tapad.com', 'rlcdn.com', '33across.com', 'indexww.com', 'lijit.com', 'sovrn.com', 'gumgum.com', 'contextweb.com',
  'popads.net', 'propellerads.com', 'exoclick.com', 'yieldmo.com', 'sharethrough.com', 'zedo.com', 'adcolony.com'
];

// Ad endpoints on otherwise-needed domains (YouTube serves ads from youtube.com itself)
const FALLBACK_URLS = [
  'youtube.com/api/stats/ads', 'youtube.com/pagead/', 'youtube.com/ptracking', 'youtube.com/get_midroll_',
  'youtube.com/youtubei/v1/log_event?alt=json&key=', 'googleads.g.doubleclick.net', 'youtube.com/api/stats/atr',
  'www.google.com/pagead/', 'static.doubleclick.net'
];

const MULTI_TLD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.jp', 'co.nz', 'com.br', 'co.in', 'com.mx', 'co.kr', 'com.tr', 'com.cn', 'co.za']);
function siteOf(host) {
  if (!host) return '';
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2 || /^\d+$/.test(parts[parts.length - 1])) return host.toLowerCase();
  const last2 = parts.slice(-2).join('.');
  return MULTI_TLD.has(last2) ? parts.slice(-3).join('.') : last2;
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

function setupBrowser({ getWin, getSettings, saveSettings, send }) {
  const views = new Map();      // tabId -> { view, wc }
  const wcToTab = new Map();    // webContents.id -> tabId
  const blockedCounts = new Map();
  let attachedId = null;
  let lastFolder = app.getPath('downloads');
  let blocker = null;
  let blockerStatus = 'loading';
  let ses = null;

  // ---------- History ----------
  const HISTORY_FILE = path.join(app.getPath('userData'), 'history.json');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { history = []; }
  let histTimer = null;
  const saveHistory = () => {
    clearTimeout(histTimer);
    histTimer = setTimeout(() => fsp.writeFile(HISTORY_FILE, JSON.stringify(history)).catch(() => {}), 1500);
  };
  function addHistory(url, title) {
    const s = getSettings();
    if (!s.webRememberHistory || !/^https?:/.test(url)) return;
    const i = history.findIndex(h => h.url === url);
    if (i >= 0) {
      const h = history.splice(i, 1)[0];
      h.t = Date.now(); h.visits = (h.visits || 1) + 1; if (title) h.title = title;
      history.unshift(h);
    } else history.unshift({ url, title: title || url, t: Date.now(), visits: 1 });
    if (history.length > 3000) history.length = 3000;
    saveHistory();
  }
  function setHistoryTitle(url, title) {
    const h = history.find(x => x.url === url);
    if (h && title) { h.title = title; saveHistory(); }
  }

  // ---------- Session & privacy ----------
  // ---------- Speed: connect to a site before you click ----------
  // Only opens the connection (DNS + secure handshake); nothing is downloaded until you click.
  const recentlyWarmed = new Map();
  function preconnect(u) {
    if (!ses || !u || !getSettings().webPreload) return;
    let origin;
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return; origin = x.origin; } catch { return; }
    const now = Date.now();
    if (now - (recentlyWarmed.get(origin) || 0) < 20000) return;
    recentlyWarmed.set(origin, now);
    if (recentlyWarmed.size > 300) recentlyWarmed.delete(recentlyWarmed.keys().next().value);
    try { ses.preconnect({ url: origin, numSockets: 1 }); } catch { /* older Electron */ }
  }

  function initSession() {
    ses = session.fromPartition(PARTITION);
    const ua = ses.getUserAgent().replace(/\s?Electron\/\S+/i, '').replace(/\s?wormfiles\/\S+/i, '').replace(/\s?WormFiles\/\S+/i, '');
    ses.setUserAgent(ua);
    ses.setSpellCheckerEnabled(false);

    // Third-party cookie stripping + Do Not Track / Global Privacy Control headers
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const s = getSettings();
      const headers = details.requestHeaders;
      if (s.webDoNotTrack) { headers.DNT = '1'; headers['Sec-GPC'] = '1'; }
      if (s.webBlockThirdPartyCookies && details.resourceType !== 'mainFrame') {
        let top = '';
        try { top = details.webContents ? details.webContents.getURL() : ''; } catch { top = ''; }
        const topSite = siteOf(hostOf(top));
        const reqSite = siteOf(hostOf(details.url));
        if (topSite && reqSite && topSite !== reqSite) delete headers.Cookie;
      }
      cb({ requestHeaders: headers });
    });

    // Permissions: deny trackers' favourites, ask for camera/mic
    const ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
    ses.setPermissionRequestHandler(async (wc, perm, cb, details) => {
      if (ALLOW.has(perm)) return cb(true);
      if (perm === 'media') {
        const what = (details.mediaTypes || []).join(' and ') || 'camera/microphone';
        const host = hostOf(details.requestingUrl) || 'This site';
        const r = await dialog.showMessageBox(getWin(), {
          type: 'question', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0,
          title: 'Permission request', message: `${host} wants to use your ${what}.`
        });
        return cb(r.response === 1);
      }
      // Proton Mail may show new-mail notifications; every other site is refused
      if (perm === 'notifications' && /(^|\.)proton\.me$/i.test(hostOf(details.requestingUrl || ''))) return cb(true);
      cb(false); // notifications, location, MIDI, USB, etc.
    });
    ses.setPermissionCheckHandler((wc, perm, origin) =>
      ALLOW.has(perm) || perm === 'media' || (perm === 'notifications' && /(^|\.)proton\.me$/i.test(hostOf(origin || ''))));

    ses.on('will-download', onDownload);
    loadBlocker();
  }

  async function loadBlocker() {
    const s = getSettings();
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron');
      const dir = path.join(app.getPath('userData'), 'adblock');
      await fsp.mkdir(dir, { recursive: true });
      const cache = path.join(dir, 'engine.bin');
      try { // refresh filter lists every 3 days
        const st = await fsp.stat(cache);
        if (Date.now() - st.mtimeMs > 3 * 86400e3) await fsp.unlink(cache);
      } catch { /* no cache yet */ }
      const make = ElectronBlocker.fromPrebuiltAdsAndTracking || ElectronBlocker.fromPrebuiltFull;
      blocker = await make.call(ElectronBlocker, fetch, { path: cache, read: fsp.readFile, write: fsp.writeFile });
      blocker.on('request-blocked', (req) => countBlocked(req.tabId));
      blockerStatus = 'full';
      if (s.webBlockAds) blocker.enableBlockingInSession(ses);
    } catch (e) {
      console.warn('Full ad blocker unavailable, using built-in tracker list:', e.message);
      blocker = null;
      blockerStatus = 'basic';
      ses.webRequest.onBeforeRequest((details, cb) => {
        if (!getSettings().webBlockAds || details.resourceType === 'mainFrame') return cb({});
        const h = hostOf(details.url);
        if (FALLBACK_BLOCK.some(d => h === d || h.endsWith('.' + d)) || FALLBACK_URLS.some(u => details.url.includes(u))) {
          countBlocked(details.webContentsId);
          return cb({ cancel: true });
        }
        cb({});
      });
    }
    send('web:blocker', blockerStatus);
  }

  function setAdBlock(on) {
    if (!blocker || !ses) return;
    try { on ? blocker.enableBlockingInSession(ses) : blocker.disableBlockingInSession(ses); } catch { /* already in that state */ }
  }

  function countBlocked(wcId) {
    const tabId = wcToTab.get(wcId);
    if (tabId == null) return;
    const n = (blockedCounts.get(tabId) || 0) + 1;
    blockedCounts.set(tabId, n);
    send('web:state', { id: tabId, blocked: n });
  }

  // ---------- Downloads ----------
  let dlSeq = 0;
  function uniqueTarget(dir, name) {
    let p = path.join(dir, name);
    if (!fs.existsSync(p)) return p;
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    for (let i = 2; i < 10000; i++) { p = path.join(dir, `${base} (${i})${ext}`); if (!fs.existsSync(p)) return p; }
    return p;
  }
  function onDownload(_e, item) {
    const s = getSettings();
    const id = ++dlSeq;
    const name = item.getFilename();
    if (s.webDownloadTo !== 'ask') {
      let dir = s.webDownloadTo === 'current' ? lastFolder : app.getPath('downloads');
      if (!dir || !fs.existsSync(dir)) dir = app.getPath('downloads');
      item.setSavePath(uniqueTarget(dir, name));
    }
    const report = (state) => send('web:download', {
      id, name: path.basename(item.getSavePath() || name), path: item.getSavePath(),
      received: item.getReceivedBytes(), total: item.getTotalBytes(), state
    });
    report('progressing');
    let last = 0;
    item.on('updated', (_ev, state) => { if (Date.now() - last > 250) { last = Date.now(); report(state === 'interrupted' ? 'interrupted' : 'progressing'); } });
    item.once('done', (_ev, state) => report(state));
    downloads.set(id, item);
  }
  const downloads = new Map();
  ipcMain.handle('web:cancelDownload', (_e, id) => { const it = downloads.get(id); if (it) it.cancel(); });

  // ---------- Views ----------
  function getView(id) { return views.get(id); }

  function emit(id, extra = {}) {
    const v = views.get(id);
    if (!v) return;
    const wc = v.wc;
    if (wc.isDestroyed()) return;
    send('web:state', {
      id, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
      canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(),
      zoom: wc.getZoomFactor(), ...extra
    });
  }

  function create(id, url, { background = false } = {}) {
    if (views.has(id)) return;
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, plugins: true, spellcheck: false, safeDialogs: true, autoplayPolicy: 'document-user-activation-required',
        preload: path.join(__dirname, 'web-preload.js')
      }
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    views.set(id, { view, wc });
    wcToTab.set(wc.id, id);
    try { wc.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch { /* older Electron */ }

    wc.setWindowOpenHandler(({ url: u, disposition }) => {
      if (/^https?:|^file:/.test(u)) send('web:open', { url: u, background: disposition === 'background-tab', opener: id });
      else if (/^(mailto|tel):/.test(u)) shell.openExternal(u);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, u) => {
      if (!/^(https?|file|data|blob|about|chrome-extension|devtools):/i.test(u)) {
        e.preventDefault();
        if (/^(mailto|tel|magnet|steam|discord|spotify|zoommtg|ms-[a-z-]+):/i.test(u)) shell.openExternal(u);
      }
    });
    wc.on('did-start-loading', () => emit(id, { error: null }));
    wc.on('did-stop-loading', () => emit(id));
    wc.on('did-navigate', (_e, u) => { blockedCounts.set(id, 0); emit(id, { blocked: 0, error: null }); addHistory(u, wc.getTitle()); });
    wc.on('did-navigate-in-page', (_e, u, isMain) => { if (isMain) { emit(id); addHistory(u, wc.getTitle()); } });
    wc.on('page-title-updated', (_e, title) => { emit(id, { title }); setHistoryTitle(wc.getURL(), title); });
    wc.on('page-favicon-updated', (_e, favs) => send('web:state', { id, favicon: favs && favs[0] }));
    wc.on('update-target-url', (_e, u) => { send('web:hover', { id, url: u }); preconnect(u); });
    wc.on('found-in-page', (_e, r) => send('web:found', { id, active: r.activeMatchOrdinal, matches: r.matches }));
    wc.on('did-fail-load', (_e, code, desc, u, isMain) => {
      if (!isMain || code === -3) return; // -3 = aborted (e.g. user clicked elsewhere)
      emit(id, { error: { code, desc, url: u } });
    });
    wc.on('render-process-gone', () => emit(id, { error: { code: 'crash', desc: 'This page crashed.', url: wc.getURL() } }));
    wc.on('enter-html-full-screen', () => enterFullscreen(id));
    wc.on('leave-html-full-screen', () => leaveFullscreen(id));
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      const k = input.key;
      let action = null;
      if (ctrl && !input.shift && /^[tTwWlLfFdD]$/.test(k)) action = 'ctrl+' + k.toLowerCase();
      else if (ctrl && input.shift && /^[tTnN]$/.test(k)) action = 'ctrl+shift+' + k.toLowerCase();
      else if (ctrl && k === 'Tab') action = input.shift ? 'ctrl+shift+tab' : 'ctrl+tab';
      else if (ctrl && k === ',') action = 'ctrl+,';
      else if (ctrl && (k === '=' || k === '+')) { wc.setZoomFactor(Math.min(3, wc.getZoomFactor() + 0.1)); emit(id); e.preventDefault(); return; }
      else if (ctrl && k === '-') { wc.setZoomFactor(Math.max(0.3, wc.getZoomFactor() - 0.1)); emit(id); e.preventDefault(); return; }
      else if (ctrl && k === '0') { wc.setZoomFactor(1); emit(id); e.preventDefault(); return; }
      else if (input.alt && k === 'ArrowLeft') { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); e.preventDefault(); return; }
      else if (input.alt && k === 'ArrowRight') { if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); e.preventDefault(); return; }
      else if (k === 'F5' || (ctrl && /^[rR]$/.test(k))) { if (input.shift) wc.reloadIgnoringCache(); else wc.reload(); e.preventDefault(); return; }
      else if (k === 'F12') { wc.toggleDevTools(); e.preventDefault(); return; }
      else if (k === 'Escape') action = 'escape';
      if (action) {
        if (action !== 'escape') e.preventDefault();
        send('web:key', { id, action });
      }
    });
    wc.on('context-menu', (_e, p) => pageMenu(id, wc, p));

    wc.loadURL(url).catch(() => { /* reported via did-fail-load */ });
    if (!background) emit(id);
  }

  function pageMenu(id, wc, p) {
    const s = getSettings();
    const items = [];
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
    if (p.linkURL) {
      items.push({ label: 'Open link in new tab', click: () => send('web:open', { url: p.linkURL, background: true, opener: id }) });
      items.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
      items.push({ label: 'Save link as…', click: () => wc.downloadURL(p.linkURL) });
      sep();
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Open image in new tab', click: () => send('web:open', { url: p.srcURL, background: true, opener: id }) });
      items.push({ label: 'Save image', click: () => wc.downloadURL(p.srcURL) });
      items.push({ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) });
      items.push({ label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) });
      sep();
    }
    if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && !p.srcURL.startsWith('blob:')) {
      items.push({ label: `Save ${p.mediaType}`, click: () => wc.downloadURL(p.srcURL) });
      sep();
    }
    if (p.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
      sep();
    } else if (p.selectionText) {
      const text = p.selectionText.trim();
      items.push({ role: 'copy' });
      items.push({
        label: `Search for "${text.length > 24 ? text.slice(0, 24) + '…' : text}"`,
        click: () => send('web:open', { url: searchUrl(s.webSearchEngine, text), background: false, opener: id })
      });
      sep();
    }
    if (!p.linkURL && !p.selectionText && !p.isEditable && p.mediaType === 'none') {
      items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
      items.push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
      items.push({ label: 'Reload', click: () => wc.reload() });
      sep();
      items.push({ label: 'Save page as…', click: () => saveAs(wc) });
      items.push({ label: 'Print…', click: () => wc.print() });
      sep();
    }
    items.push({ label: 'Inspect', click: () => { wc.inspectElement(p.x, p.y); } });
    Menu.buildFromTemplate(items).popup({ window: getWin() });
  }

  async function saveAs(wc) {
    const title = (wc.getTitle() || 'page').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 100);
    const r = await dialog.showSaveDialog(getWin(), {
      defaultPath: path.join(lastFolder || app.getPath('downloads'), title + '.html'),
      filters: [{ name: 'Web page, complete', extensions: ['html'] }]
    });
    if (!r.canceled && r.filePath) wc.savePage(r.filePath, 'HTMLComplete').catch(() => {});
  }

  function searchUrl(engine, q) {
    const e = encodeURIComponent(q);
    switch (engine) {
      case 'startpage': return `https://www.startpage.com/sp/search?query=${e}`;
      case 'brave': return `https://search.brave.com/search?q=${e}`;
      case 'google': return `https://www.google.com/search?q=${e}`;
      case 'bing': return `https://www.bing.com/search?q=${e}`;
      case 'ecosia': return `https://www.ecosia.org/search?q=${e}`;
      case 'mojeek': return `https://www.mojeek.com/search?q=${e}`;
      default: return `https://duckduckgo.com/?q=${e}`;
    }
  }

  // ---------- Video fullscreen ----------
  // Handled here rather than in the window UI: while a page covers the whole window, Windows treats
  // the WormFiles UI underneath as hidden and pauses it, so it can't be relied on to shrink the page back.
  let fsTab = null, wasWinFullscreen = false, normalBounds = null, winHooked = false;
  const fullBounds = () => { const [w, h] = getWin().getContentSize(); return { x: 0, y: 0, width: w, height: h }; };
  function hookWindow() {
    if (winHooked || !getWin()) return;
    winHooked = true;
    const win = getWin();
    const keepFull = () => { const v = fsTab != null && views.get(fsTab); if (v) v.view.setBounds(fullBounds()); };
    win.on('resize', keepFull);
    win.on('enter-full-screen', keepFull);
    win.on('leave-full-screen', () => {
      // Window left fullscreen some other way (e.g. Windows shortcut): make the page exit too
      const v = fsTab != null && views.get(fsTab);
      if (v) v.wc.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
      setTimeout(() => send('web:resync'), 200);
    });
  }
  function enterFullscreen(id) {
    const win = getWin(), v = views.get(id);
    if (!win || !v) return;
    hookWindow();
    fsTab = id;
    wasWinFullscreen = win.isFullScreen();
    if (!wasWinFullscreen) win.setFullScreen(true);
    v.view.setBounds(fullBounds());
    send('web:fullscreen', { id, on: true });
  }
  function leaveFullscreen(id) {
    if (fsTab !== id) return;
    fsTab = null;
    const win = getWin(), v = views.get(id);
    if (win && !wasWinFullscreen && win.isFullScreen()) win.setFullScreen(false);
    if (v && normalBounds) v.view.setBounds(normalBounds); // back to the content area right away
    send('web:fullscreen', { id, on: false });
    // ask the UI to re-measure once the window has finished resizing
    for (const ms of [150, 400, 900]) setTimeout(() => send('web:resync'), ms);
  }

  function show(id, b) {
    const win = getWin();
    const v = views.get(id);
    if (!win || !v) return;
    if (fsTab === id) { v.view.setBounds(fullBounds()); v.view.setVisible(true); return; }
    for (const [oid, o] of views) if (oid !== id) o.view.setVisible(false);
    if (attachedId !== id) {
      win.contentView.addChildView(v.view); // re-adding moves it to the top
      attachedId = id;
    }
    normalBounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
    v.view.setBounds(normalBounds);
    v.view.setVisible(true);
  }
  function hideAll() { for (const [, o] of views) o.view.setVisible(false); }
  function destroy(id) {
    const v = views.get(id);
    if (!v) return;
    const win = getWin();
    try { win && win.contentView.removeChildView(v.view); } catch { /* already removed */ }
    wcToTab.delete(v.wc.id);
    views.delete(id);
    blockedCounts.delete(id);
    if (attachedId === id) attachedId = null;
    if (fsTab === id) { fsTab = null; const w = getWin(); if (w && !wasWinFullscreen && w.isFullScreen()) w.setFullScreen(false); send('web:fullscreen', { id, on: false }); }
    try { v.wc.close(); } catch { /* gone */ }
  }

  // ---------- Page shield (YouTube) ----------
  ipcMain.on('web:shieldConfig', (e) => { e.returnValue = { youtube: !!getSettings().webBlockAds }; });
  ipcMain.on('web:ytBlocked', (e) => countBlocked(e.sender.id));

  // ---------- IPC ----------
  const withWc = (fn) => (_e, id, ...a) => { const v = getView(id); if (v && !v.wc.isDestroyed()) return fn(v.wc, id, ...a); };
  ipcMain.handle('web:create', (_e, id, url, opts) => create(id, url, opts));
  ipcMain.handle('web:navigate', withWc((wc, id, url) => { wc.loadURL(url).catch(() => {}); }));
  ipcMain.handle('web:back', withWc((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()));
  ipcMain.handle('web:forward', withWc((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()));
  ipcMain.handle('web:reload', withWc((wc) => wc.reload()));
  ipcMain.handle('web:stop', withWc((wc) => wc.stop()));
  ipcMain.handle('web:zoom', withWc((wc, id, f) => { wc.setZoomFactor(f); emit(id); }));
  ipcMain.handle('web:find', withWc((wc, id, text, opts) => text ? wc.findInPage(text, opts || {}) : wc.stopFindInPage('clearSelection')));
  ipcMain.handle('web:stopFind', withWc((wc) => wc.stopFindInPage('keepSelection')));
  ipcMain.handle('web:devtools', withWc((wc) => wc.toggleDevTools()));
  ipcMain.handle('web:print', withWc((wc) => wc.print()));
  ipcMain.handle('web:savePage', withWc((wc) => saveAs(wc)));
  ipcMain.handle('web:focus', withWc((wc) => wc.focus()));
  ipcMain.handle('web:show', (_e, id, bounds) => show(id, bounds));
  ipcMain.handle('web:hideAll', () => hideAll());
  ipcMain.handle('web:destroy', (_e, id) => destroy(id));
  ipcMain.handle('web:lastFolder', (_e, p) => { if (p) lastFolder = p; });
  ipcMain.handle('web:searchUrl', (_e, q) => searchUrl(getSettings().webSearchEngine, q));
  ipcMain.handle('web:preconnect', (_e, u) => preconnect(u === 'search' ? searchUrl(getSettings().webSearchEngine, 'x') : u));
  ipcMain.handle('web:blockerStatus', () => blockerStatus);
  ipcMain.handle('web:setAdBlock', (_e, on) => setAdBlock(on));
  ipcMain.handle('web:history', (_e, q, limit = 8) => {
    const s = (q || '').toLowerCase().trim();
    if (!s) return history.slice(0, limit);
    const out = [];
    for (const h of history) {
      if (h.url.toLowerCase().includes(s) || (h.title || '').toLowerCase().includes(s)) out.push(h);
      if (out.length >= limit) break;
    }
    return out;
  });
  ipcMain.handle('web:topSites', () => {
    const bySite = new Map();
    for (const h of history) {
      let origin; try { origin = new URL(h.url).origin; } catch { continue; }
      const cur = bySite.get(origin) || { url: origin + '/', title: '', visits: 0 };
      cur.visits += h.visits || 1;
      if (!cur.title && h.title) cur.title = h.title;
      bySite.set(origin, cur);
    }
    return [...bySite.values()].sort((a, b) => b.visits - a.visits).slice(0, 8);
  });
  ipcMain.handle('web:clearData', async (_e, what = {}) => {
    if (!ses) return;
    if (what.history !== false) { history = []; saveHistory(); }
    if (what.cookies !== false) await ses.clearStorageData();
    if (what.cache !== false) await ses.clearCache();
  });

  // Forget cookies & site data when WormFiles closes (if enabled)
  let quitting = false;
  app.on('before-quit', (e) => {
    const s = getSettings();
    if (quitting || !ses || !s.webClearOnExit) return;
    e.preventDefault();
    quitting = true;
    Promise.race([
      Promise.all([ses.clearStorageData(), ses.clearCache(), s.webRememberHistory ? null : fsp.writeFile(HISTORY_FILE, '[]')]),
      new Promise(r => setTimeout(r, 3000))
    ]).finally(() => app.quit());
  });

  return { initSession, hideAll, setAdBlock };
}

module.exports = { setupBrowser };
