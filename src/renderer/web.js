'use strict';
/* WormFiles — Worm, the built-in privacy browser (window side).
   Loaded before app.js; uses app.js globals (tabs, tab(), toast, …) at call time. */

const WEB_NEWTAB = 'about:newtab';
const SEARCH_ENGINES = {
  duckduckgo: 'DuckDuckGo', startpage: 'Startpage', brave: 'Brave Search', mojeek: 'Mojeek',
  ecosia: 'Ecosia', bing: 'Bing', google: 'Google'
};
const BROWSER_OPENABLE = new Set(['html', 'htm', 'pdf', 'svg', 'txt', 'json', 'xml', 'md', 'log', 'csv',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'flac']);

const WebState = {
  downloads: new Map(),
  blocker: 'loading',
  fullscreen: false,
  findOpen: false
};

function makeWebTab(url = WEB_NEWTAB) {
  return {
    id: ++tabSeq, kind: 'web', url, path: url, title: '', favicon: '', loading: false,
    canBack: false, canForward: false, blocked: 0, error: null, created: false, zoom: 1, hoverUrl: '', cameFromNewTab: false,
    // fields shared with folder tabs so generic code stays happy
    back: [], fwd: [], cat: 'all', entries: [], query: '', deep: false, results: null,
    selection: new Set(), visible: [], scroll: 0
  };
}

function isWebTab(t = tab()) { return t && t.kind === 'web'; }

function newWebTab(url = WEB_NEWTAB, { activate = true, after = null } = {}) {
  const t = makeWebTab(url);
  let at = activeIdx + 1;
  if (after != null) {
    const oi = tabs.findIndex(x => x.id === after);
    if (oi >= 0) { at = oi + 1; while (at < tabs.length && tabs[at]._openedBy === after) at++; }
  }
  t._openedBy = after;
  tabs.splice(at, 0, t);
  if (at <= activeIdx && !activate) activeIdx++;
  if (!activate && url !== WEB_NEWTAB) { window.wf.web.create(t.id, url, { background: true }); t.created = true; t.loading = true; }
  if (activate) activateTab(at); else renderTabs();
  saveTabs();
  if (activate && url === WEB_NEWTAB) setTimeout(() => { const i = $('#ntp-input'); if (i) i.focus(); }, 30);
  return t;
}

function fileToUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
}

async function resolveWebInput(v) {
  v = (v || '').trim().replace(/^"|"$/g, '');
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(about|data|view-source|mailto):/i.test(v)) return { url: v };
  if (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith('\\\\')) {
    const kind = await api.exists(v);
    if (kind === 'dir') return { folder: v };
    if (kind === 'file') return { url: fileToUrl(v) };
  }
  if (/^localhost(:\d+)?([/?#]|$)/i.test(v) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(v)) return { url: 'http://' + v };
  if (!/\s/.test(v) && /^[^\s/]+\.[a-z][a-z0-9-]{1,}(:\d+)?([/?#].*)?$/i.test(v)) return { url: 'https://' + v };
  return { url: await api.web.searchUrl(v) };
}

function looksLikeUrl(v) {
  v = v.trim();
  return /^https?:\/\//i.test(v) || /^www\./i.test(v) ||
    (!/\s/.test(v) && !/[\\]/.test(v) && /^[^\s/:]+\.(com|org|net|io|dev|app|gg|tv|co|uk|de|edu|gov|me|ai|xyz|info|ca|us|fr|jp|ru|be|nl|it|es|au)([/:?#].*)?$/i.test(v));
}

// Navigate the given web tab to whatever was typed
async function webGo(t, input) {
  const r = await resolveWebInput(input);
  if (!r) return;
  if (r.folder) {
    newTab(r.folder);
    return;
  }
  webLoad(t, r.url);
}

function webLoad(t, url) {
  t.error = null;
  if (t.url === WEB_NEWTAB) t.cameFromNewTab = true;
  t.url = url; t.path = url;
  t.loading = true;
  if (!t.created) { api.web.create(t.id, url); t.created = true; }
  else api.web.navigate(t.id, url);
  if (t === tab()) { webRender(); api.web.focus(t.id); }
  renderTabs(); saveTabs();
}

function webActivate(t) {
  if (!t.created && t.url !== WEB_NEWTAB) { api.web.create(t.id, t.url); t.created = true; t.loading = true; }
  webRender();
}

// ---------- Rendering ----------
function webRender() {
  const t = tab();
  if (!isWebTab(t)) return;
  $('#btn-back').disabled = !t.canBack && !(t.cameFromNewTab && t.url !== WEB_NEWTAB);
  $('#btn-fwd').disabled = !t.canForward;
  const rb = $('#btn-refresh');
  rb.innerHTML = icon(t.loading ? 'x' : 'refresh');
  rb.title = t.loading ? 'Stop (Esc)' : 'Reload (F5)';
  renderUrlDisplay(t);
  const bm = (S.bookmarks || []).some(b => b.url === t.url);
  $('#btn-star').innerHTML = icon(bm ? 'starfill' : 'star');
  $('#btn-star').classList.toggle('active', bm);
  $('#btn-star').disabled = t.url === WEB_NEWTAB;
  $('#shield-count').textContent = t.blocked ? (t.blocked > 99 ? '99+' : t.blocked) : '';
  $('#btn-shield').classList.toggle('off', !S.webBlockAds);
  renderDownloadsButton();

  const page = $('#webpage');
  $('#items').classList.add('hidden');
  $('#list-header').classList.add('hidden');
  $('#empty').classList.add('hidden');
  if (t.url === WEB_NEWTAB) { page.classList.remove('hidden'); renderNewTabPage(); }
  else if (t.error) { page.classList.remove('hidden'); renderErrorPage(t); }
  else { page.classList.add('hidden'); page.innerHTML = ''; }
  renderWebStatus();
  webSync();
}

function renderUrlDisplay(t) {
  const box = $('#crumbs');
  if (t.url === WEB_NEWTAB) { box.innerHTML = `<span class="url-text dim">${icon('search')} Search ${esc(SEARCH_ENGINES[S.webSearchEngine] || 'DuckDuckGo')} or type a URL</span>`; return; }
  let u;
  try { u = new URL(t.url); } catch { box.innerHTML = `<span class="url-text">${esc(t.url)}</span>`; return; }
  const secure = u.protocol === 'https:';
  const lock = u.protocol === 'file:' ? icon('folder') : icon(secure ? 'lock' : 'unlock');
  const host = u.protocol === 'file:' ? decodeURIComponent(u.pathname.replace(/^\//, '')).replace(/\//g, '\\') : u.host;
  const rest = u.protocol === 'file:' ? '' : (u.pathname === '/' ? '' : u.pathname) + u.search;
  box.innerHTML = `<span class="url-text"><span class="url-lock ${secure || u.protocol === 'file:' ? '' : 'insecure'}" title="${secure ? 'Secure connection' : u.protocol === 'file:' ? 'Local file' : 'Not secure'}">${lock}</span><b>${esc(host)}</b><span class="dim">${esc(rest)}</span></span>`;
}

function renderWebStatus() {
  const t = tab();
  if (!isWebTab(t)) return;
  $('#status-left').textContent = t.hoverUrl || (t.loading ? 'Loading…' : '');
  const bits = [];
  if (t.zoom && Math.abs(t.zoom - 1) > 0.01) bits.push(`Zoom ${Math.round(t.zoom * 100)}%`);
  if (S.webBlockAds) bits.push(`${t.blocked || 0} blocked`);
  $('#status-right').textContent = bits.join('  ·  ');
  $('#status-progress').classList.add('hidden');
}

function siteInitial(url) {
  try { return new URL(url).hostname.replace(/^www\./, '')[0].toUpperCase(); } catch { return '?'; }
}
function tileHtml(b, removable) {
  let host = ''; try { host = new URL(b.url).hostname.replace(/^www\./, ''); } catch { /* bad url */ }
  const fav = b.favicon || ''; // only icons saved when bookmarking — no background requests to sites
  return `<a class="ntp-tile" href="#" data-url="${esc(b.url)}" title="${esc(b.url)}">
    <span class="ntp-fav"><span class="ntp-letter">${esc(siteInitial(b.url))}</span>${fav ? `<img src="${esc(fav)}" alt="" class="ntp-favimg">` : ''}</span>
    <span class="ntp-title">${esc(b.title || host)}</span>
    ${removable ? `<button class="icon-btn tiny ntp-x" data-remove="${esc(b.url)}" title="Remove bookmark">${icon('x')}</button>` : ''}
  </a>`;
}

function wireFavicons(root) {
  root.querySelectorAll('img.ntp-favimg').forEach(img => {
    const ok = () => { if (img.naturalWidth > 1) { const l = img.previousElementSibling; if (l && l.classList.contains('ntp-letter')) l.remove(); } else img.remove(); };
    if (img.complete) { img.naturalWidth ? ok() : img.remove(); }
    img.addEventListener('load', ok);
    img.addEventListener('error', () => img.remove());
  });
}

async function renderNewTabPage() {
  const page = $('#webpage');
  const t = tab();
  const engine = SEARCH_ENGINES[S.webSearchEngine] || 'DuckDuckGo';
  const bms = S.bookmarks || [];
  page.innerHTML = `<div class="ntp">
    <div class="ntp-brand"><img src="../../build/icon.png" alt="" class="ntp-favimg"><span>Worm</span></div>
    <form class="ntp-search" id="ntp-form">${icon('search')}<input id="ntp-input" placeholder="Search ${esc(engine)} or type a URL" autocomplete="off" spellcheck="false"></form>
    ${bms.length ? `<div class="ntp-section">Bookmarks</div><div class="ntp-grid">${bms.map(b => tileHtml(b, true)).join('')}</div>` : ''}
    <div id="ntp-top"></div>
    <div class="ntp-privacy">
      <span class="${S.webBlockAds ? 'on' : ''}">${icon('shield')} Ads &amp; trackers ${S.webBlockAds ? 'blocked' : 'allowed'}</span>
      <span class="${S.webBlockThirdPartyCookies ? 'on' : ''}">${icon('cookie')} Third-party cookies ${S.webBlockThirdPartyCookies ? 'blocked' : 'allowed'}</span>
      <span class="${S.webDoNotTrack ? 'on' : ''}">${icon('eye')} Do Not Track ${S.webDoNotTrack ? 'on' : 'off'}</span>
      ${S.webClearOnExit ? `<span class="on">${icon('trash')} Forgets cookies on exit</span>` : ''}
    </div>
  </div>`;
  wireFavicons(page);
  const form = $('#ntp-form');
  form.onsubmit = (e) => { e.preventDefault(); webGo(t, $('#ntp-input').value); };
  page.onclick = (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { e.preventDefault(); e.stopPropagation(); setS({ bookmarks: (S.bookmarks || []).filter(b => b.url !== rm.dataset.remove) }); renderNewTabPage(); return; }
    const tile = e.target.closest('.ntp-tile');
    if (tile) { e.preventDefault(); webLoad(t, tile.dataset.url); }
  };
  page.onauxclick = (e) => {
    const tile = e.target.closest('.ntp-tile');
    if (tile && e.button === 1) { e.preventDefault(); newWebTab(tile.dataset.url, { activate: false, after: t.id }); }
  };
  if (S.webRememberHistory) {
    const top = await api.web.topSites().catch(() => []);
    const bmUrls = new Set(bms.map(b => b.url));
    const list = top.filter(x => !bmUrls.has(x.url)).slice(0, 8);
    const el = $('#ntp-top');
    if (el && list.length && tab() === t) { el.innerHTML = `<div class="ntp-section">Most visited</div><div class="ntp-grid">${list.map(b => tileHtml(b, false)).join('')}</div>`; wireFavicons(el); }
  }
}

function renderErrorPage(t) {
  const e = t.error;
  const friendly = {
    '-105': "This site's address couldn't be found. Check the spelling, or your internet connection.",
    '-106': "You're offline. Check your internet connection.",
    '-102': 'The site refused to connect.',
    '-118': 'The connection timed out.',
    '-109': "The site can't be reached.",
    '-200': 'The site has an invalid security certificate, so Worm stopped the connection.',
    '-201': 'The site has an invalid security certificate, so Worm stopped the connection.',
    '-202': 'The site has an invalid security certificate, so Worm stopped the connection.',
    '-6': 'That file could not be found.',
    'crash': 'This page crashed.'
  }[String(e.code)] || e.desc || 'Something went wrong loading this page.';
  $('#webpage').innerHTML = `<div class="ntp web-error">
    ${icon('info')}<h2>Can't open this page</h2><p>${esc(friendly)}</p><p class="dim">${esc(e.url || '')}</p>
    <div class="row" style="justify-content:center"><button class="btn primary" id="web-retry">${icon('refresh')}Try again</button></div></div>`;
  $('#web-retry').onclick = () => { t.error = null; webRender(); api.web.reload(t.id); };
}

// Show/hide the native page view over the content area
let syncQueued = false;
function webSync() {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(() => { // not requestAnimationFrame: it pauses while a page covers the window
    syncQueued = false;
    const t = tab();
    const overlay = !$('#ctx').classList.contains('hidden') || !$('#popover').classList.contains('hidden') ||
      !$('#modal-wrap').classList.contains('hidden');
    if (!isWebTab(t) || !t.created || t.url === WEB_NEWTAB || t.error || overlay) { api.web.hideAll(); return; }
    const r = WebState.fullscreen ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : $('#content').getBoundingClientRect();
    api.web.show(t.id, { x: r.left, y: r.top, width: r.width, height: r.height });
  });
}

// ---------- Toolbar actions ----------
function webBack() {
  const t = tab();
  if (t.canBack) return api.web.back(t.id);
  if (t.cameFromNewTab && t.url !== WEB_NEWTAB) {
    api.web.destroy(t.id);
    Object.assign(t, { created: false, url: WEB_NEWTAB, path: WEB_NEWTAB, title: '', favicon: '', loading: false, canBack: false, canForward: false, blocked: 0, error: null, cameFromNewTab: false });
    renderTabs(); webRender(); saveTabs();
  }
}
function webForward() { api.web.forward(tab().id); }
function webReloadOrStop() { const t = tab(); if (t.url === WEB_NEWTAB) return renderNewTabPage(); t.loading ? api.web.stop(t.id) : (t.error = null, api.web.reload(t.id)); }

function toggleBookmark() {
  const t = tab();
  if (!isWebTab(t) || t.url === WEB_NEWTAB) return;
  const list = S.bookmarks || [];
  if (list.some(b => b.url === t.url)) {
    setS({ bookmarks: list.filter(b => b.url !== t.url) });
    toast('Bookmark removed');
  } else {
    setS({ bookmarks: [...list, { url: t.url, title: t.title || t.url, favicon: /^https:/.test(t.favicon || '') ? t.favicon : '' }] });
    toast('Bookmarked — it shows on the new tab page');
  }
  webRender();
}

function shieldPopover() {
  const t = tab();
  const r = $('#btn-shield').getBoundingClientRect();
  const el = $('#popover');
  hideMenus();
  const status = WebState.blocker === 'full' ? 'Using EasyList + EasyPrivacy filter lists' : WebState.blocker === 'basic' ? 'Using the built-in tracker list (full lists couldn\'t load)' : 'Loading filter lists…';
  el.innerHTML = `<div class="shield-pop">
    <div class="shield-big">${icon('shield')}<div><b>${t.blocked || 0}</b> ads &amp; trackers blocked<div class="dim">on this page</div></div></div>
    <label class="toggle"><input type="checkbox" data-wk="webBlockAds" ${S.webBlockAds ? 'checked' : ''}><span class="track"></span><span>Block ads &amp; trackers</span></label>
    <label class="toggle"><input type="checkbox" data-wk="webBlockThirdPartyCookies" ${S.webBlockThirdPartyCookies ? 'checked' : ''}><span class="track"></span><span>Block third-party cookies</span></label>
    <label class="toggle"><input type="checkbox" data-wk="webDoNotTrack" ${S.webDoNotTrack ? 'checked' : ''}><span class="track"></span><span>Send Do Not Track</span></label>
    <div class="dim small">${esc(status)}</div>
    <div class="row"><button class="btn" id="sp-clear">${icon('trash')}Clear browsing data…</button><button class="btn" id="sp-settings">${icon('settings')}Settings</button></div>
  </div>`;
  el.classList.remove('hidden');
  const w = el.getBoundingClientRect().width;
  el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  el.style.top = (r.bottom + 6) + 'px';
  el.querySelectorAll('[data-wk]').forEach(cb => cb.onchange = () => {
    setS({ [cb.dataset.wk]: cb.checked });
    if (cb.dataset.wk !== 'webBlockAds') toast('Applies to new page loads — reload to see the effect');
    webRender();
  });
  $('#sp-clear').onclick = () => { hideMenus(); clearDataDialog(); };
  $('#sp-settings').onclick = () => { hideMenus(); openSettings('browser'); };
  webSync();
}

function clearDataDialog() {
  openModal({
    title: 'Clear browsing data',
    body: `<p class="tip">Choose what to delete from Worm. This can't be undone.</p>
      <label class="toggle" style="margin:8px 0;display:flex"><input type="checkbox" id="cd-h" checked><span class="track"></span><span>Browsing history</span></label>
      <label class="toggle" style="margin:8px 0;display:flex"><input type="checkbox" id="cd-c" checked><span class="track"></span><span>Cookies and site data (signs you out of sites)</span></label>
      <label class="toggle" style="margin:8px 0;display:flex"><input type="checkbox" id="cd-x" checked><span class="track"></span><span>Cached images and files</span></label>`,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Clear data', primary: true, action: async () => {
          await api.web.clearData({ history: $('#cd-h').checked, cookies: $('#cd-c').checked, cache: $('#cd-x').checked });
          toast('Browsing data cleared');
        }
      }
    ],
    onClose: webSync
  });
  webSync();
}

function webMoreMenu() {
  const t = tab();
  const r = $('#btn-webmenu').getBoundingClientRect();
  const z = Math.round((t.zoom || 1) * 100);
  const real = t.url !== WEB_NEWTAB && t.created;
  showMenu(r.right - 240, r.bottom + 4, [
    { label: 'New Worm tab', icon: 'globe', kbd: 'Ctrl+Shift+T', action: () => newWebTab() },
    '-',
    { label: `Zoom in (${z}%)`, icon: 'plus', kbd: 'Ctrl++', disabled: !real, action: () => api.web.zoom(t.id, Math.min(3, (t.zoom || 1) + 0.1)) },
    { label: 'Zoom out', icon: 'minus', kbd: 'Ctrl+-', disabled: !real, action: () => api.web.zoom(t.id, Math.max(0.3, (t.zoom || 1) - 0.1)) },
    { label: 'Reset zoom', icon: 'undo', kbd: 'Ctrl+0', disabled: !real || z === 100, action: () => api.web.zoom(t.id, 1) },
    '-',
    { label: 'Find on page', icon: 'search', kbd: 'Ctrl+F', disabled: !real, action: openFind },
    { label: 'Print…', icon: 'doc', disabled: !real, action: () => api.web.print(t.id) },
    { label: 'Save page as…', icon: 'download', disabled: !real, action: () => api.web.savePage(t.id) },
    { label: 'Copy page address', icon: 'copy', disabled: !real, action: () => { api.copyText(t.url); toast('Address copied'); } },
    '-',
    { label: 'Clear browsing data…', icon: 'trash', action: clearDataDialog },
    { label: 'Developer tools', icon: 'code', kbd: 'F12', disabled: !real, action: () => api.web.devtools(t.id) },
    { label: 'Worm settings…', icon: 'settings', action: () => openSettings('browser') }
  ]);
}

// ---------- Downloads ----------
function renderDownloadsButton() {
  const list = [...WebState.downloads.values()];
  const btn = $('#btn-downloads');
  btn.classList.toggle('hidden', !list.length);
  const active = list.filter(d => d.state === 'progressing');
  let pct = 0;
  if (active.length) {
    const tot = active.reduce((a, d) => a + (d.total || 0), 0);
    const rec = active.reduce((a, d) => a + d.received, 0);
    pct = tot ? rec / tot : 0.15;
  }
  btn.style.setProperty('--dl', active.length ? `${Math.round(pct * 100)}%` : '0%');
  btn.classList.toggle('downloading', !!active.length);
}

function downloadsPopover() {
  const r = $('#btn-downloads').getBoundingClientRect();
  const el = $('#popover');
  hideMenus();
  const list = [...WebState.downloads.values()].reverse();
  el.innerHTML = `<div class="dl-pop"><div class="menu-label">Downloads</div>${list.map(d => {
    const pct = d.total ? Math.min(100, d.received / d.total * 100) : 0;
    const status = d.state === 'completed' ? fmtSize(d.total || d.received) : d.state === 'progressing' ? `${fmtSize(d.received)}${d.total ? ' of ' + fmtSize(d.total) : ''}` : d.state === 'cancelled' ? 'Cancelled' : 'Failed';
    return `<div class="dl-row" data-dl="${d.id}">
      <div class="dl-main"><b title="${esc(d.path)}">${esc(d.name)}</b><span class="dim">${esc(status)}</span>
      ${d.state === 'progressing' ? `<div class="drive-bar" style="margin:4px 0 0"><div style="width:${pct.toFixed(1)}%"></div></div>` : ''}</div>
      ${d.state === 'completed' ? `<button class="icon-btn small" data-act="open" title="Open">${icon('open')}</button><button class="icon-btn small" data-act="show" title="Show in folder">${icon('folder')}</button>` : ''}
      ${d.state === 'progressing' ? `<button class="icon-btn small" data-act="cancel" title="Cancel">${icon('x')}</button>` : ''}
    </div>`;
  }).join('')}
  <div class="dim small" style="padding:6px 10px">Saving to: ${esc(S.webDownloadTo === 'current' ? 'the folder you were last in' : S.webDownloadTo === 'ask' ? 'ask every time' : 'Downloads')}</div></div>`;
  el.classList.remove('hidden');
  const w = el.getBoundingClientRect().width;
  el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  el.style.top = (r.bottom + 6) + 'px';
  el.onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const d = WebState.downloads.get(+b.closest('[data-dl]').dataset.dl);
    hideMenus();
    if (b.dataset.act === 'open') api.open(d.path);
    if (b.dataset.act === 'show') showFileInFolderTab(d.path);
    if (b.dataset.act === 'cancel') api.web.cancelDownload(d.id);
    webSync();
  };
  webSync();
}

function showFileInFolderTab(p) {
  const dir = parentOf(p);
  if (!dir) return;
  const existing = tabs.findIndex(x => x.kind !== 'web' && samePath(x.path, dir));
  if (existing >= 0) {
    const t = tabs[existing];
    t.selection = new Set([p]); t.anchor = p;
    activateTab(existing);
    load(t, { silent: true }).then(() => { setSelection([p], p); scrollIntoViewIfNeeded(itemElFor(p)); });
  } else {
    const t = makeTab(dir);
    t.selection = new Set([p]); t.anchor = p;
    tabs.splice(activeIdx + 1, 0, t);
    activateTab(activeIdx + 1);
  }
}

// ---------- Find on page ----------
function openFind() {
  const t = tab();
  if (!isWebTab(t) || !t.created || t.url === WEB_NEWTAB) return;
  WebState.findOpen = true;
  $('#findbar').classList.remove('hidden');
  const i = $('#find-input');
  i.focus(); i.select();
  if (i.value) api.web.find(t.id, i.value, { findNext: false });
  webSync();
}
function closeFind() {
  WebState.findOpen = false;
  $('#findbar').classList.add('hidden');
  $('#find-count').textContent = '';
  const t = tab();
  if (isWebTab(t) && t.created) { api.web.stopFind(t.id); api.web.focus(t.id); }
  webSync();
}

// ---------- Address suggestions ----------
let suggestTimer = null;
async function showSuggestions(input) {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(async () => {
    const q = input.value.trim();
    const el = $('#popover');
    if (!q || document.activeElement !== input) { if (el.dataset.kind === 'suggest') { el.classList.add('hidden'); webSync(); } return; }
    const hist = S.webRememberHistory ? await api.web.history(q, 6).catch(() => []) : [];
    const bms = (S.bookmarks || []).filter(b => b.url.toLowerCase().includes(q.toLowerCase()) || (b.title || '').toLowerCase().includes(q.toLowerCase())).slice(0, 3);
    const seen = new Set();
    const rows = [];
    const engine = SEARCH_ENGINES[S.webSearchEngine] || 'DuckDuckGo';
    rows.push({ kind: 'go', label: looksLikeUrl(q) ? q : `Search ${engine} for “${q}”`, value: q, icon: looksLikeUrl(q) ? 'globe' : 'search' });
    for (const b of bms) if (!seen.has(b.url)) { seen.add(b.url); rows.push({ kind: 'url', label: b.title || b.url, sub: b.url, value: b.url, icon: 'star' }); }
    for (const h of hist) if (!seen.has(h.url)) { seen.add(h.url); rows.push({ kind: 'url', label: h.title || h.url, sub: h.url, value: h.url, icon: 'clock' }); }
    const r = $('#address').getBoundingClientRect();
    el.dataset.kind = 'suggest';
    el.innerHTML = rows.map((x, i) => `<div class="menu-item suggest ${i === 0 ? 'focus' : ''}" data-i="${i}">${icon(x.icon)}<span class="sg-label">${esc(x.label)}</span>${x.sub ? `<span class="kbd sg-sub">${esc(x.sub)}</span>` : ''}</div>`).join('');
    el.style.left = r.left + 'px'; el.style.top = (r.bottom + 4) + 'px'; el.style.width = r.width + 'px';
    el.classList.remove('hidden');
    el._rows = rows;
    el.onmousedown = (e) => {
      const it = e.target.closest('[data-i]'); if (!it) return;
      e.preventDefault();
      const row = rows[+it.dataset.i];
      input.value = row.value;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    };
    webSync();
  }, 90);
}
function moveSuggestion(dir, input) {
  const el = $('#popover');
  if (el.classList.contains('hidden') || el.dataset.kind !== 'suggest') return false;
  const items = $$('.suggest', el);
  let i = items.findIndex(x => x.classList.contains('focus'));
  items[i]?.classList.remove('focus');
  i = (i + dir + items.length) % items.length;
  items[i].classList.add('focus');
  input.value = el._rows[i].value;
  return true;
}
function hideSuggestions() {
  const el = $('#popover');
  if (el.dataset.kind === 'suggest') { el.classList.add('hidden'); el.dataset.kind = ''; el.style.width = ''; webSync(); }
}

// ---------- Events from the main process ----------
let webTabsRaf = null;
function onWebState(d) {
  const t = findTab(d.id);
  if (!t) return;
  if (d.url !== undefined && d.url) { t.url = d.url; t.path = d.url; }
  if (d.title !== undefined) t.title = d.title;
  if (d.loading !== undefined) t.loading = d.loading;
  if (d.canBack !== undefined) t.canBack = d.canBack;
  if (d.canForward !== undefined) t.canForward = d.canForward;
  if (d.blocked !== undefined) t.blocked = d.blocked;
  if (d.zoom !== undefined) t.zoom = d.zoom;
  if (d.favicon !== undefined) t.favicon = d.favicon;
  if (d.error !== undefined) t.error = d.error;
  if (t.isMail && (d.title !== undefined || d.loading !== undefined)) mailTitleChanged(t);
  if (t === tab()) {
    if (d.blocked !== undefined && Object.keys(d).length === 2) {
      $('#shield-count').textContent = t.blocked > 99 ? '99+' : t.blocked;
      renderWebStatus();
    } else if (!$('#address').classList.contains('editing') || d.error !== undefined) webRender();
  }
  if (!webTabsRaf) webTabsRaf = setTimeout(() => { webTabsRaf = null; renderTabs(); saveTabs(); }, 120);
}

function setupWeb() {
  api.web.on('web:state', onWebState);
  api.web.on('web:open', (d) => newWebTab(d.url, { activate: !d.background, after: d.opener }));
  api.web.on('web:hover', (d) => { const t = findTab(d.id); if (t) { t.hoverUrl = d.url; if (t === tab()) renderWebStatus(); } });
  api.web.on('web:found', (d) => { if (d.id === tab().id) $('#find-count').textContent = d.matches ? `${d.active} of ${d.matches}` : 'No matches'; });
  api.web.on('web:fullscreen', (d) => { WebState.fullscreen = d.on; document.body.classList.toggle('fullscreen', d.on); webSync(); });
  api.web.on('web:resync', () => webSync());
  api.web.on('web:blocker', (s) => { WebState.blocker = s; });
  api.web.on('web:key', (d) => {
    const map = {
      'ctrl+t': () => newTab(tab().kind === 'web' ? THIS_PC : tab().path),
      'ctrl+shift+t': () => newWebTab(),
      'ctrl+w': () => closeCurrentTab(),
      'ctrl+tab': () => activateTab((activeIdx + 1) % tabs.length),
      'ctrl+shift+tab': () => activateTab((activeIdx - 1 + tabs.length) % tabs.length),
      'ctrl+l': () => window._startAddressEdit(),
      'ctrl+d': toggleBookmark,
      'ctrl+f': openFind,
      'ctrl+,': () => openSettings(),
      'escape': () => { if (WebState.findOpen) closeFind(); else if (tab().loading) api.web.stop(tab().id); }
    };
    map[d.action] && map[d.action]();
  });
  api.web.on('web:download', (d) => {
    const prev = WebState.downloads.get(d.id);
    WebState.downloads.set(d.id, d);
    if (!prev) toast(`Downloading “${d.name}”`);
    if (d.state === 'completed' && prev?.state !== 'completed') {
      toast(`Downloaded “${d.name}”`, { action: { label: 'Show in folder', fn: () => showFileInFolderTab(d.path) } });
    }
    if (d.state === 'interrupted' && prev?.state !== 'interrupted') toast(`Download of “${d.name}” failed`, { error: true });
    if (isWebTab()) renderDownloadsButton();
    const pop = $('#popover');
    if (!pop.classList.contains('hidden') && pop.querySelector('.dl-pop')) downloadsPopover();
  });
  api.web.blockerStatus().then(s => { WebState.blocker = s; }).catch(() => {});

  $('#new-web-tab').onclick = () => newWebTab();
  $('#btn-star').onclick = toggleBookmark;
  $('#btn-shield').onclick = (e) => { e.stopPropagation(); shieldPopover(); };
  $('#btn-downloads').onclick = (e) => { e.stopPropagation(); downloadsPopover(); };
  $('#btn-webmenu').onclick = (e) => { e.stopPropagation(); webMoreMenu(); };

  const fi = $('#find-input');
  fi.addEventListener('input', () => { const t = tab(); if (fi.value) api.web.find(t.id, fi.value, { findNext: false }); else { api.web.find(t.id, ''); $('#find-count').textContent = ''; } });
  fi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (fi.value) api.web.find(tab().id, fi.value, { findNext: true, forward: !e.shiftKey }); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  });
  $('#find-prev').onclick = () => fi.value && api.web.find(tab().id, fi.value, { findNext: true, forward: false });
  $('#find-next').onclick = () => fi.value && api.web.find(tab().id, fi.value, { findNext: true, forward: true });
  $('#find-close').onclick = closeFind;

  new ResizeObserver(() => webSync()).observe($('#content'));
  window.addEventListener('resize', webSync);
}

// ---------- Settings pane ----------
function browserSettingsPane() {
  const chk = (key, label, hint = '') => `
    <div class="field"><label>${label}</label><label class="toggle"><input type="checkbox" data-bk="${key}" ${S[key] ? 'checked' : ''}><span class="track"></span><span>${S[key] ? 'On' : 'Off'}</span></label>
    ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  return `
    <div class="field"><label>Search engine</label><select data-bsel="webSearchEngine">
      ${Object.entries(SEARCH_ENGINES).map(([k, l]) => `<option value="${k}" ${S.webSearchEngine === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${chk('webBlockAds', 'Block ads & trackers', 'Uses the EasyList and EasyPrivacy filter lists (the same ones uBlock Origin uses). Lists refresh every few days.')}
    ${chk('webBlockThirdPartyCookies', 'Block third-party cookies', 'Stops other sites embedded in a page from reading their cookies.')}
    ${chk('webDoNotTrack', 'Send Do Not Track', 'Also sends Global Privacy Control, which is legally binding in some US states.')}
    ${chk('webRememberHistory', 'Remember history', 'Used for address-bar suggestions and Most visited. Stored only on this PC.')}
    ${chk('webClearOnExit', 'Forget cookies & site data when WormFiles closes', 'You will be signed out of websites each time you restart.')}
    <div class="field"><label>Save downloads to</label><select data-bsel="webDownloadTo">
      <option value="current" ${S.webDownloadTo === 'current' ? 'selected' : ''}>The folder I was last in</option>
      <option value="downloads" ${S.webDownloadTo === 'downloads' ? 'selected' : ''}>Downloads folder</option>
      <option value="ask" ${S.webDownloadTo === 'ask' ? 'selected' : ''}>Ask every time</option></select></div>
    <div class="side-title" style="padding-left:0;margin-top:16px">Mail button</div>
    ${chk('mailButton', 'Show the Mail button', 'An envelope at the left of the tab bar that opens your mail in Worm. Click it again to go back.')}
    ${chk('mailBackground', 'Check for new mail in the background', 'Keeps your inbox loaded so the button can show how many unread emails you have. Uses a bit more memory.')}
    <div class="field"><label>Mail address</label><input class="text-input" data-btext="mailUrl" value="${esc(S.mailUrl || MAIL_DEFAULT)}" spellcheck="false"></div>
    <div class="field"><label>Browsing data</label><div class="row"><button class="btn" id="bs-clear">${icon('trash')}Clear browsing data…</button></div></div>
    <p class="tip dim">Every site runs in a locked-down sandbox, location, notification and device requests are blocked automatically, and Worm asks before any site uses your camera or microphone. Your IP is hidden from WebRTC on local networks, and the browser identifies itself as plain Chrome instead of Worm. It's built on Chromium, so Firefox extensions won't work.</p>`;
}
function bindBrowserSettings(pane, rerender) {
  pane.querySelectorAll('[data-bk]').forEach(el => el.onchange = () => {
    setS({ [el.dataset.bk]: el.checked });
    el.parentElement.querySelector('span:last-child').textContent = el.checked ? 'On' : 'Off';
    if (el.dataset.bk === 'mailButton' || el.dataset.bk === 'mailBackground') { renderMailButton(); startMailInBackground(); }
    if (isWebTab()) webRender();
  });
  pane.querySelectorAll('[data-btext]').forEach(el => el.onchange = () => {
    let v = el.value.trim() || MAIL_DEFAULT;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    setS({ [el.dataset.btext]: v });
    if (mailTab) { mailTab.url = v; if (mailTab.created) api.web.navigate(mailTab.id, v); }
  });
  pane.querySelectorAll('[data-bsel]').forEach(el => el.onchange = () => { setS({ [el.dataset.bsel]: el.value }); if (isWebTab()) webRender(); });
  const c = $('#bs-clear', pane);
  if (c) c.onclick = () => { closeModal(); clearDataDialog(); };
}
