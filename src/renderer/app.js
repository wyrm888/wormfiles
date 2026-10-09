'use strict';
/* WormFiles — window logic */

const api = window.wf;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileUrl = (p) => `wormfile://f/?p=${encodeURIComponent(p)}`;

const THIS_PC = '::pc';
const CAT_TABS = [
  ['all', 'All', 'all'], ['folders', 'Folders', 'folder'], ['images', 'Images', 'image'], ['videos', 'Videos', 'video'],
  ['audio', 'Music', 'music'], ['documents', 'Documents', 'doc'], ['archives', 'Archives', 'archive'],
  ['code', 'Code', 'code'], ['apps', 'Apps', 'app'], ['other', 'Other', 'info']
];
const SORT_LABELS = { name: 'Name', mtime: 'Date modified', ctime: 'Date created', size: 'Size', type: 'Type' };
const TEXT_EXT = new Set(['txt', 'md', 'log', 'csv', 'json', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'toml', 'bat', 'cmd', 'ps1', 'sh']);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

let S = {};          // settings
let INFO = {};       // static info from main
let tabs = [];
let activeIdx = 0;
let clip = { paths: [], mode: null };
let drives = [];
let tabSeq = 0, searchSeq = 0;

const tab = () => (mailActive && mailTab) ? mailTab : tabs[activeIdx];

// ---------- Path helpers ----------
const sep = () => INFO.sep || '\\';
function joinPath(dir, name) { return dir.endsWith(sep()) ? dir + name : dir + sep() + name; }
function baseName(p) {
  if (p === THIS_PC) return 'This PC';
  const t = p.replace(/[\\/]+$/, '');
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'));
  const b = i >= 0 ? t.slice(i + 1) : t;
  return b || p;
}
function parentOf(p) {
  if (p === THIS_PC) return null;
  if (/^[A-Za-z]:\\?$/.test(p) || p === '/') return THIS_PC;
  const t = p.replace(/[\\/]+$/, '');
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'));
  if (i < 0) return THIS_PC;
  let parent = t.slice(0, i);
  if (/^[A-Za-z]:$/.test(parent)) parent += '\\';
  return parent || '/';
}
function samePath(a, b) { return a && b && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase(); }

// ---------- Formatting ----------
function fmtSize(n) {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}
const fmtDate = (ms) => ms ? dateFmt.format(new Date(ms)) : '';
function typeLabel(e) {
  if (e.isDir) return 'File folder';
  if (!e.ext) return 'File';
  const cat = CATEGORIES[e.cat];
  const kind = { images: 'image', videos: 'video', audio: 'audio', documents: 'document', archives: 'archive', code: 'source', apps: 'app' }[e.cat];
  return `${e.ext.toUpperCase()} ${kind || 'file'}`.trim() || (cat && cat.label) || 'File';
}
function displayName(e) {
  if (e.isDir || S.showExtensions || !e.ext) return e.name;
  return e.name.slice(0, -(e.ext.length + 1));
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, opts = {}) {
  const el = $('#toast');
  el.className = opts.error ? 'error' : '';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (opts.action) {
    const b = document.createElement('button');
    b.textContent = opts.action.label;
    b.onclick = () => { el.classList.add('hidden'); opts.action.fn(); };
    el.appendChild(b);
  }
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), opts.ms || (opts.action ? 8000 : 3500));
}

// ---------- Menus ----------
function showMenu(x, y, items, el = $('#ctx')) {
  hideMenus();
  el.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { el.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
    if (it.heading) { el.insertAdjacentHTML('beforeend', `<div class="menu-label">${esc(it.heading)}</div>`); continue; }
    const d = document.createElement('div');
    d.className = 'menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '') + (it.checked ? ' checked' : '');
    d.innerHTML = `${icon(it.checked ? 'check' : (it.icon || 'none'))}<span>${esc(it.label)}</span>${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : ''}`;
    d.onclick = (e) => { e.stopPropagation(); hideMenus(); it.action && it.action(); };
    el.appendChild(d);
  }
  el.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  el.style.top = (y + r.height > innerHeight - 6 ? Math.max(6, y - r.height) : y) + 'px';
  if (isWebTab()) webSync();
}
function hideMenus() {
  const wasOpen = !$('#ctx').classList.contains('hidden') || !$('#popover').classList.contains('hidden');
  $('#ctx').classList.add('hidden'); $('#popover').classList.add('hidden');
  $('#popover').dataset.kind = ''; $('#popover').style.width = '';
  if (wasOpen && isWebTab()) webSync();
}

// ---------- Modal ----------
function openModal({ title, body, buttons = [], wide = false, onClose }) {
  const m = $('#modal');
  m.style.width = wide ? 'min(820px, calc(100vw - 40px))' : '';
  m.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>`;
  const b = document.createElement('div'); b.className = 'modal-body';
  if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
  m.appendChild(b);
  if (buttons.length) {
    const f = document.createElement('div'); f.className = 'modal-foot';
    for (const btn of buttons) {
      const e = document.createElement('button');
      e.className = 'btn' + (btn.primary ? ' primary' : '') + (btn.danger ? ' danger' : '');
      e.textContent = btn.label;
      e.onclick = async () => { if ((await btn.action?.()) !== false) closeModal(); };
      f.appendChild(e);
    }
    m.appendChild(f);
  }
  m.querySelector('[data-close]').onclick = closeModal;
  $('#modal-wrap').classList.remove('hidden');
  $('#modal-wrap')._onClose = onClose;
  if (isWebTab()) webSync();
  return b;
}
function closeModal() {
  const w = $('#modal-wrap');
  if (w.classList.contains('hidden')) return;
  w.classList.add('hidden');
  w._onClose && w._onClose();
  w._onClose = null;
  if (isWebTab()) webSync();
}

// ---------- Settings ----------
let tabsSaveTimer = null;
function setS(patch, { appearance = false } = {}) {
  Object.assign(S, patch);
  api.setSettings(patch);
  if (appearance) applyAppearance();
}
function saveTabs() {
  clearTimeout(tabsSaveTimer);
  tabsSaveTimer = setTimeout(() => {
    setS({ lastTabs: tabs.map(t => t.kind === 'web' ? 'web:' + t.url : t.path), lastActive: activeIdx });
  }, 400);
}

function applyAppearance() {
  const t = THEMES[S.theme] || THEMES.crimson;
  const accent = S.accent || t.accent;
  const st = document.documentElement.style;
  st.setProperty('--bg-rgb', t.bg);
  st.setProperty('--surface-rgb', t.surface);
  st.setProperty('--surface2-rgb', t.surface2);
  st.setProperty('--text-rgb', t.text);
  st.setProperty('--dim-rgb', t.dim);
  st.setProperty('--border-rgb', t.border);
  st.setProperty('--accent', accent);
  st.setProperty('--accent-rgb', hexToRgb(accent).join(' '));
  st.setProperty('--accent-text', readableOn(accent));
  st.setProperty('--folder-front', t.folderFront || accent);
  st.setProperty('--folder-back', t.folderFront ? shade(accent, -0.2) : shade(accent, -0.3));
  const translucent = !!S.bgImage || !!S.mica;
  st.setProperty('--panel-alpha', translucent ? S.panelAlpha : 1);
  st.setProperty('--bg-opacity', S.bgOpacity);
  st.setProperty('--bg-blur', (S.bgBlur || 0) + 'px');
  st.setProperty('--fs', S.fontSize + 'px');
  st.setProperty('--radius', S.radius + 'px');
  st.setProperty('--icon-size', S.iconSize + 'px');
  st.colorScheme = t.dark ? 'dark' : 'light';
  $('#bg').style.backgroundImage = S.bgImage ? `url("${fileUrl(S.bgImage)}")` : 'none';
  document.body.classList.toggle('mica', !!S.mica);
  document.body.classList.remove('compact', 'spacious');
  if (S.density !== 'comfortable') document.body.classList.add(S.density);
  $('#user-css').textContent = S.customCss || '';
  const [r, g, b] = t.text.split(' ').map(Number);
  api.setOverlay({ symbolColor: '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('') });
  $('#zoom').value = S.iconSize;
}

// ---------- Tabs ----------
function makeTab(path) {
  return {
    id: ++tabSeq, kind: 'folder', path, back: [], fwd: [], cat: 'all',
    entries: [], loading: false, error: null,
    query: '', deep: false, deepAuto: false, results: null, searchId: 0, searching: false, searchInfo: null,
    selection: new Set(), anchor: null, scroll: 0, visible: []
  };
}

function newTab(path = THIS_PC, activate = true) {
  const t = makeTab(path);
  tabs.splice(activeIdx + 1, 0, t);
  if (activate) { activeIdx = tabs.indexOf(t); }
  renderTabs();
  if (activate) activateTab(activeIdx);
  saveTabs();
  return t;
}

function closeTab(i) {
  const t = tabs[i];
  if (!t) return;
  if (t.searching) api.searchCancel(t.searchId);
  if (t.kind === 'web') api.web.destroy(t.id);
  if (isPaired(t)) split = null;
  tabs.splice(i, 1);
  if (!tabs.length) tabs.push(makeTab(THIS_PC));
  if (activeIdx >= tabs.length) activeIdx = tabs.length - 1;
  else if (i < activeIdx) activeIdx--;
  activateTab(activeIdx);
  saveTabs();
}

function activateTab(i) {
  const prev = tab();
  if (prev && prev.kind !== 'web') prev.scroll = $('#content').scrollTop;
  if (WebState.findOpen) closeFind();
  hideSuggestions();
  if (QL.open) quickLookClose();
  mailActive = false;
  activeIdx = i;
  const t = tab();
  document.body.classList.toggle('web-mode', t.kind === 'web');
  renderTabs();
  applySplitLayout();
  if (t.kind === 'web') { api.watch(null); webActivate(t); saveTabs(); return; }
  api.web.hideAll();
  $('#webpage').classList.add('hidden');
  $('#items').classList.remove('hidden');
  $('#btn-refresh').innerHTML = icon('refresh');
  $('#btn-refresh').title = 'Refresh (F5)';
  if (t.path !== THIS_PC) api.web.lastFolder(t.path);
  $('#search-input').value = t.query;
  $('#deep-toggle').checked = t.deep;
  syncSearchClear();
  if (!t.entries.length && !t.loading && !t.results) load(t);
  else { renderAll(); $('#content').scrollTop = t.scroll; }
  api.watch(t.path === THIS_PC ? null : t.path);
  saveTabs();
}

function tabTitle(t) {
  if (t.kind === 'web') {
    if (t.url === WEB_NEWTAB) return 'New tab';
    if (t.title) return t.title;
    try { return new URL(t.url).hostname || t.url; } catch { return t.url; }
  }
  if (t.deep && t.query) return `Search: ${t.query}`;
  return baseName(t.path);
}

function tabIcon(t) {
  if (t.kind === 'web') {
    if (t.loading && t.url !== WEB_NEWTAB) return '<span class="spinner"></span>';
    if (t.favicon && /^(https?|data):/.test(t.favicon)) return `<img class="favicon" src="${esc(t.favicon)}" alt="">`;
    return icon('globe');
  }
  return icon(t.deep && t.query ? 'search' : t.path === THIS_PC ? 'desktop' : isReadonlyPath(t.path) ? 'archive' : 'folder');
}

function renderTabs() {
  const box = $('#tabs');
  box.innerHTML = tabs.map((t, i) => `
    <div class="tab ${i === activeIdx && !mailActive ? 'active' : ''} ${t.kind === 'web' ? 'web' : ''} ${isPaired(t) ? 'paired' : ''}" data-i="${i}" title="${esc(t.kind === 'web' ? (t.title ? t.title + '\n' : '') + (t.url === WEB_NEWTAB ? '' : t.url) : t.path === THIS_PC ? 'This PC' : t.path)}">
      <span class="tab-ico">${tabIcon(t)}</span>
      <span class="tab-title">${esc(tabTitle(t))}</span>
      <button class="icon-btn tab-close" data-close="${i}" title="Close tab (Ctrl+W)">${icon('x')}</button>
    </div>`).join('');
  document.title = `${mailActive ? 'Proton Mail' : tabTitle(tab())} — WormFiles`;
  renderMailButton();
}

function setupTabEvents() {
  const box = $('#tabs');
  let drag = null;
  box.addEventListener('mousedown', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    const el = e.target.closest('.tab');
    if (!el) return;
    const i = +el.dataset.i;
    if (e.button === 1) { e.preventDefault(); closeTab(i); return; }
    if (closeBtn) return;
    if (e.button !== 0) return;
    if (i !== activeIdx || mailActive) activateTab(i);
    drag = { i, x: e.clientX, moved: false };
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
    if (!drag.moved) return;
    const els = $$('.tab', box);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const j = +el.dataset.i;
      if (j !== drag.i && e.clientX > r.left && e.clientX < r.right) {
        const [t] = tabs.splice(drag.i, 1);
        tabs.splice(j, 0, t);
        activeIdx = j; drag.i = j;
        renderTabs();
        $$('.tab', box)[j].classList.add('dragging');
        break;
      }
    }
  });
  window.addEventListener('mouseup', () => { if (drag?.moved) { renderTabs(); saveTabs(); } drag = null; });
  box.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { e.stopPropagation(); closeTab(+c.dataset.close); }
  });
  box.addEventListener('dblclick', (e) => { if (!e.target.closest('.tab')) newTab(tab().path); });
  box.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.tab'); if (!el) return;
    const i = +el.dataset.i;
    showMenu(e.clientX, e.clientY, [
      { label: 'New folder tab', icon: 'plus', kbd: 'Ctrl+T', action: () => newTab(isWebTab() ? THIS_PC : tab().path) },
      { label: 'New Worm tab', icon: 'globe', kbd: 'Ctrl+Shift+T', action: () => newWebTab() },
      { label: 'Duplicate tab', icon: 'copy', action: () => { activeIdx = i; tabs[i].kind === 'web' ? newWebTab(tabs[i].url) : newTab(tabs[i].path); } },
      i !== activeIdx && tabs[i].kind !== 'web' && !isWebTab() && { label: 'Show side by side with this tab', icon: 'columns', action: () => splitWith(i) },
      isPaired(tabs[i]) && { label: 'Exit split view', icon: 'columns', action: () => { split = null; applySplitLayout(); renderTabs(); renderAll(); } },
      '-',
      { label: 'Close tab', icon: 'x', kbd: 'Ctrl+W', action: () => closeTab(i) },
      { label: 'Close other tabs', disabled: tabs.length < 2, action: () => { const keep = tabs[i]; tabs = [keep]; split = null; activeIdx = 0; activateTab(0); } },
      { label: 'Close tabs to the right', disabled: i === tabs.length - 1, action: () => { tabs = tabs.slice(0, i + 1); activateTab(Math.min(activeIdx, i)); } }
    ].filter(Boolean));
  });
  $('#new-tab').onclick = () => newTab(isWebTab() ? THIS_PC : tab().path);
}

// ---------- Navigation & loading ----------
function navigate(path, { push = true, t = tab(), keepSelection = null } = {}) {
  if (!path) return;
  if (t.kind === 'web') { newTab(path); return; }
  if (path !== THIS_PC) api.web.lastFolder(path);
  if (t.searching) api.searchCancel(t.searchId);
  if (push && !samePath(path, t.path)) { t.back.push(t.path); t.fwd = []; }
  t.path = path;
  t.query = ''; t.results = null; t.searching = false; t.searchInfo = null;
  if (t.deepAuto) { t.deep = false; t.deepAuto = false; }
  t.selection = new Set(keepSelection ? [keepSelection] : []);
  t.anchor = keepSelection;
  t.scroll = 0;
  if (t === tab()) {
    $('#search-input').value = '';
    $('#deep-toggle').checked = t.deep;
    syncSearchClear();
    api.watch(path === THIS_PC ? null : path);
  }
  renderTabs();
  saveTabs();
  load(t);
}

async function load(t = tab(), { silent = false } = {}) {
  t.loading = true; t.error = null;
  if (!silent && t === tab()) { setProgress('Loading…'); }
  if (t.path === THIS_PC) {
    t.entries = [];
    t.loading = false;
    await refreshDrives();
    if (t === tab()) { setProgress(null); renderAll(); }
    if (t === splitPartner()) renderPane2();
    return;
  }
  try {
    t.entries = await api.list(t.path);
  } catch (e) {
    t.entries = [];
    t.error = /EPERM|EACCES/.test(e.message) ? "You don't have permission to open this folder."
      : /ENOENT/.test(e.message) ? 'This folder no longer exists.' : e.message.replace(/^Error invoking remote method[^:]*: (Error: )?/, '');
  }
  t.loading = false;
  if (t === splitPartner()) renderPane2();
  if (t.deep) { runDeep(t); }
  if (t === tab()) {
    setProgress(null);
    const keepScroll = silent ? $('#content').scrollTop : 0;
    renderAll();
    $('#content').scrollTop = keepScroll;
  }
}

function goBack() { const t = tab(); if (!t.back.length) return; t.fwd.push(t.path); navigate(t.back.pop(), { push: false, keepSelection: t.path }); }
function goForward() { const t = tab(); if (!t.fwd.length) return; t.back.push(t.path); navigate(t.fwd.pop(), { push: false }); }
function goUp() { const t = tab(); const p = parentOf(t.path); if (p) navigate(p, { keepSelection: t.path }); }

async function openEntry(e, { newTabToo = false } = {}) {
  if (!e.isDir && e.isArchive && !e.inArchive && S.openArchives !== false) {
    if (newTabToo) newTab(e.path, false), renderTabs(); else navigate(e.path);
    return;
  }
  if (e.isDir) {
    if (newTabToo) newTab(e.path, false), renderTabs();
    else navigate(e.path);
    return;
  }
  const err = await api.open(e.path);
  if (err) toast(`Couldn't open "${e.name}": ${err}`, { error: true });
}

// ---------- Deep search / include-subfolders ----------
function catToken(cat) {
  if (cat === 'all') return '';
  if (cat === 'folders') return ' kind:folder';
  return ` type:${cat}`;
}

let deepTimer = null;
function scheduleDeep(t = tab(), delay = 280) {
  clearTimeout(deepTimer);
  deepTimer = setTimeout(() => runDeep(t), delay);
}

function runDeep(t = tab()) {
  if (t.searching) api.searchCancel(t.searchId);
  const id = ++searchSeq;
  t.searchId = id;
  t.results = [];
  t.searching = true;
  t.searchInfo = { found: 0, scanned: 0 };
  t.selection.clear();
  const root = t.path === THIS_PC ? INFO.home : t.path;
  const query = (t.query + catToken(t.cat)).trim();
  if (t === tab()) { renderAll(); renderTabs(); }
  api.searchStart({ id, root, query }).then((res) => {
    if (t.searchId !== id) return;
    t.searching = false;
    t.searchInfo = res;
    if (t === tab()) renderAll();
  }).catch(() => { t.searching = false; });
}

let resultsRaf = null;
api.onSearchResults((d) => {
  const t = tabs.find(x => x.searchId === d.id);
  if (!t || !t.results) return;
  t.results.push(...d.items);
  t.searchInfo = { ...t.searchInfo, found: d.found, scanned: d.scanned };
  if (t !== tab()) return;
  if (resultsRaf) return;
  resultsRaf = setTimeout(() => { resultsRaf = null; renderItems({ keepScroll: true }); renderStatus(); }, 160);
});

function stopSearch() {
  const t = tab();
  if (t.searching) { api.searchCancel(t.searchId); t.searching = false; renderStatus(); }
}

// ---------- Sorting & filtering ----------
function effectiveSort(t = tab()) {
  if (S.rememberSortPerFolder && S.folderSorts[t.path]) return { ...S.sort, ...S.folderSorts[t.path], source: 'folder' };
  const name = baseName(t.path).toLowerCase();
  for (const r of S.sortRules || []) {
    if (r.match && (name === r.match.toLowerCase() || t.path.toLowerCase().includes(r.match.toLowerCase()))) {
      return { ...S.sort, by: r.by, dir: r.dir, source: 'rule', rule: r.match };
    }
  }
  return { ...S.sort, source: 'default' };
}

function setSort(patch) {
  const t = tab();
  const cur = effectiveSort(t);
  const next = { by: cur.by, dir: cur.dir, foldersFirst: cur.foldersFirst, ...patch };
  if (S.rememberSortPerFolder && t.path !== THIS_PC) {
    setS({ folderSorts: { ...S.folderSorts, [t.path]: next } });
  } else {
    setS({ sort: next });
  }
  renderItems();
  renderSortLabel();
}

function compareEntries(a, b, s) {
  if (s.foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  let r = 0;
  switch (s.by) {
    case 'mtime': r = a.mtime - b.mtime; break;
    case 'ctime': r = a.ctime - b.ctime; break;
    case 'size': r = a.size - b.size; break;
    case 'type': r = collator.compare(a.isDir ? '' : a.ext, b.isDir ? '' : b.ext); break;
    default: r = 0;
  }
  if (r === 0) r = collator.compare(a.name, b.name);
  return s.dir === 'desc' ? -r : r;
}

function getVisible(t = tab()) {
  const deep = t.deep && t.results;
  let list = deep ? t.results : t.entries;
  if (!S.showHidden) list = list.filter(e => !e.hidden);
  if (t.cat !== 'all') list = list.filter(e => e.cat === t.cat);
  if (!deep && t.query.trim()) {
    const f = parseQuery(t.query);
    list = list.filter(e => matchName(f, e.name, e.isDir) &&
      (!f.needsStat || matchStat(f, { size: e.size, mtimeMs: e.mtime })));
  }
  const s = effectiveSort(t);
  return [...list].sort((a, b) => compareEntries(a, b, s));
}

function groupKey(e, by) {
  if (by === 'type') return e.isDir ? 'Folders' : (CATEGORIES[e.cat]?.label || 'Other files');
  if (by === 'date') {
    if (!e.mtime) return 'Unknown';
    const now = new Date(); const d = new Date(e.mtime);
    const day = 86400000;
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (e.mtime >= startToday) return 'Today';
    if (e.mtime >= startToday - day) return 'Yesterday';
    if (e.mtime >= startToday - 6 * day) return 'Earlier this week';
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'Earlier this month';
    if (d.getFullYear() === now.getFullYear()) return 'Earlier this year';
    return 'A long time ago';
  }
  if (by === 'size') {
    if (e.isDir) return 'Folders';
    const s = e.size;
    return s < 16 * 1024 ? 'Tiny (under 16 KB)' : s < 1024 ** 2 ? 'Small (16 KB – 1 MB)' : s < 128 * 1024 ** 2 ? 'Medium (1 – 128 MB)'
      : s < 1024 ** 3 ? 'Large (128 MB – 1 GB)' : 'Huge (over 1 GB)';
  }
  return '';
}

// ---------- Rendering ----------
function renderAll() {
  if (isWebTab()) { webRender(); return; }
  renderCrumbs();
  renderCats();
  renderSortLabel();
  renderNavButtons();
  renderSidebarActive();
  renderItems();
  renderStatus();
  renderPreview();
  $$('.view-toggle .icon-btn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  $('#btn-preview').classList.toggle('active', S.showPreview);
  $('#preview').classList.toggle('off', !S.showPreview);
}

function renderNavButtons() {
  const t = tab();
  if (t.kind === 'web') return;
  $('#btn-back').disabled = !t.back.length;
  $('#btn-fwd').disabled = !t.fwd.length;
  $('#btn-up').disabled = !parentOf(t.path);
}

function crumbList(p) {
  const out = [{ label: 'This PC', path: THIS_PC }];
  if (p === THIS_PC) return out;
  const m = /^([A-Za-z]:)\\?(.*)$/.exec(p);
  if (m) {
    let acc = m[1] + '\\';
    const driveName = drives.find(d => samePath(d.path, acc));
    out.push({ label: `${driveName && driveName.letter === 'C' ? 'Local Disk' : 'Drive'} (${m[1]})`, path: acc });
    for (const part of m[2].split('\\').filter(Boolean)) {
      acc = joinPath(acc, part);
      out.push({ label: part, path: acc });
    }
  } else if (p.startsWith('\\\\')) {
    const parts = p.slice(2).split('\\').filter(Boolean);
    let acc = '\\\\' + parts.shift();
    out.push({ label: acc, path: acc });
    for (const part of parts) { acc = joinPath(acc, part); out.push({ label: part, path: acc }); }
  } else {
    let acc = '';
    for (const part of p.split('/').filter(Boolean)) { acc += '/' + part; out.push({ label: part, path: acc }); }
  }
  return out;
}

function renderCrumbs() {
  const t = tab();
  if (t.kind === 'web') { renderUrlDisplay(t); return; }
  const box = $('#crumbs');
  const list = crumbList(t.path);
  box.innerHTML = list.map((c, i) => `${i ? `<span class="crumb-sep">${icon('right')}</span>` : ''}<span class="crumb" data-path="${esc(c.path)}">${esc(c.label)}</span>`).join('');
  box.scrollLeft = box.scrollWidth;
}

function renderCats() {
  const t = tab();
  const base = (t.entries || []).filter(e => S.showHidden || !e.hidden);
  const counts = {};
  for (const e of base) counts[e.cat] = (counts[e.cat] || 0) + 1;
  const showCounts = !t.deep && t.path !== THIS_PC;
  $('#cats').innerHTML = CAT_TABS.map(([k, label, ic]) => {
    const n = k === 'all' ? base.length : (counts[k] || 0);
    const empty = showCounts && k !== 'all' && !n;
    return `<button class="cat ${t.cat === k ? 'active' : ''} ${empty ? 'empty-cat' : ''}" data-cat="${k}" title="Show only ${label.toLowerCase()} (Alt+${CAT_TABS.findIndex(c => c[0] === k)})">
      ${icon(ic)}<span>${label}</span>${showCounts && n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
}

function renderSortLabel() {
  const s = effectiveSort();
  $('#sort-label').textContent = `${SORT_LABELS[s.by] || 'Name'} ${s.dir === 'desc' ? '↓' : '↑'}${s.source === 'rule' ? ' · auto' : ''}`;
}

// Thumbnail loading
const thumbCache = new Map();
const iconCache = new Map();
const thumbQueue = [];
let thumbActive = 0;
let thumbObserver = null;

function enqueueThumb(el) {
  if (el._queued) return;
  el._queued = true;
  thumbQueue.push(el);
  pumpThumbs();
}
function pumpThumbs() {
  while (thumbActive < 6 && thumbQueue.length) {
    const el = thumbQueue.shift();
    if (!el.isConnected) continue;
    thumbActive++;
    loadThumb(el).finally(() => { thumbActive--; pumpThumbs(); });
  }
}
async function loadThumb(el) {
  const e = el._entry;
  if (!e) return;
  const holder = el.querySelector('.thumb');
  const wantPhoto = (e.cat === 'images' || e.cat === 'videos') && !(e.inArchive && (e.cat === 'videos' || e.size > 20e6));
  if (wantPhoto) {
    const size = S.view === 'grid' ? Math.min(512, Math.round(S.iconSize * (devicePixelRatio || 1))) : 48;
    const key = `${e.path}|${e.mtime}|${size > 160 ? 'L' : size > 64 ? 'M' : 'S'}`;
    let url = thumbCache.get(key);
    if (url === undefined) {
      url = await api.thumb(e.path, size).catch(() => null);
      if (!url && !e.inArchive && e.cat === 'images' && e.ext !== 'psd' && e.ext !== 'heic') url = fileUrl(e.path);
      thumbCache.set(key, url);
      if (thumbCache.size > 3000) thumbCache.delete(thumbCache.keys().next().value);
    }
    if (url && holder.isConnected) {
      const badge = e.cat === 'videos' ? `<span class="badge">${esc(e.ext.toUpperCase())}</span>` : '';
      holder.innerHTML = `<img class="photo" src="${esc(url)}" draggable="false" alt="">${badge}`;
      const img = holder.querySelector('img');
      img.onerror = () => setNativeIcon(holder, e);
      return;
    }
  }
  await setNativeIcon(holder, e);
}
async function setNativeIcon(holder, e) {
  const unique = ['exe', 'lnk', 'ico', 'url', 'msi', 'appx'].includes(e.ext) && !e.inArchive;
  const key = unique ? e.path : e.ext || '<none>';
  let url = iconCache.get(key);
  if (url === undefined) {
    url = await api.icon(e.path, false).catch(() => null);
    iconCache.set(key, url);
  }
  if (!holder.isConnected) return;
  holder.innerHTML = url ? `<img class="native" src="${url}" draggable="false" alt="">` : icon(catIcon(e.cat), 'fallback');
}
function catIcon(cat) {
  return { images: 'image', videos: 'video', audio: 'music', documents: 'doc', archives: 'archive', code: 'code', apps: 'app', folders: 'folder' }[cat] || 'doc';
}

function itemHtml(e, i, deep, t = tab()) {
  const sel = t.selection.has(e.path) ? ' selected' : '';
  const cut = clip.mode === 'move' && clip.paths.includes(e.path) ? ' cut' : '';
  const thumb = e.isDir ? folderArt() : '';
  const loc = deep ? relLocation(e.path) : '';
  if (S.view === 'list') {
    return `<div class="item${sel}${cut}" data-i="${i}" draggable="true">
      <div class="cell-name"><div class="thumb">${thumb}</div><span class="name">${esc(displayName(e))}</span></div>
      <span class="cell">${fmtDate(e.mtime)}</span>
      <span class="cell">${esc(typeLabel(e))}</span>
      <span class="cell size">${e.isDir ? '' : fmtSize(e.size)}</span>
      ${deep ? `<span class="cell" title="${esc(loc)}">${esc(loc)}</span>` : ''}
    </div>`;
  }
  return `<div class="item${sel}${cut}" data-i="${i}" draggable="true" title="${esc(e.name)}${e.isDir ? '' : '\n' + fmtSize(e.size)}\n${esc(fmtDate(e.mtime))}${loc ? '\nin ' + esc(loc) : ''}">
    <div class="thumb">${thumb}</div>
    <div class="name">${esc(displayName(e))}</div>
    <div class="sub${deep ? ' show' : ''}">${esc(loc)}</div>
  </div>`;
}

function relLocation(p) {
  const t = tab();
  const root = t.path === THIS_PC ? INFO.home : t.path;
  const parent = parentOf(p) || '';
  if (samePath(parent, root)) return 'This folder';
  if (parent.toLowerCase().startsWith(root.toLowerCase())) return parent.slice(root.length).replace(/^[\\/]/, '');
  return parent;
}

function renderItems({ keepScroll = false } = {}) {
  const t = tab();
  if (t.kind === 'web') return;
  const box = $('#items');
  const content = $('#content');
  const scroll = content.scrollTop;
  const empty = $('#empty');
  const header = $('#list-header');
  if (thumbObserver) thumbObserver.disconnect();
  thumbQueue.length = 0;

  if (t.path === THIS_PC && !(t.deep && t.results)) {
    header.classList.add('hidden');
    renderThisPC();
    empty.classList.add('hidden');
    t.visible = [];
    return;
  }

  const vis = getVisible(t);
  t.visible = vis;
  const deep = !!(t.deep && t.results);
  box.className = S.view;
  box.style.setProperty('--loc-col', deep ? 'minmax(120px, .8fr)' : '0px');
  header.style.setProperty('--loc-col', deep ? 'minmax(120px, .8fr)' : '0px');

  if (S.view === 'list') {
    const s = effectiveSort();
    const col = (k, label, cls = '') => `<div data-sort="${k}" class="${cls}">${label}${s.by === k ? icon(s.dir === 'desc' ? 'chev' : 'up') : ''}</div>`;
    header.innerHTML = col('name', 'Name') + col('mtime', 'Date modified') + col('type', 'Type') +
      `<div data-sort="size" style="justify-content:flex-end">Size${s.by === 'size' ? icon(s.dir === 'desc' ? 'chev' : 'up') : ''}</div>` +
      (deep ? '<div>Location</div>' : '');
    header.classList.remove('hidden');
  } else header.classList.add('hidden');

  let html = '';
  if (S.groupBy !== 'none' && vis.length) {
    const groups = new Map();
    vis.forEach((e, i) => {
      const k = groupKey(e, S.groupBy);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([e, i]);
    });
    for (const [k, arr] of groups) {
      html += `<div class="group-head">${esc(k)} <span class="n">${arr.length}</span></div>`;
      html += arr.map(([e, i]) => itemHtml(e, i, deep)).join('');
    }
  } else {
    html = vis.map((e, i) => itemHtml(e, i, deep)).join('');
  }
  box.innerHTML = html;

  // attach entries and lazy thumbnails
  thumbObserver = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) { thumbObserver.unobserve(en.target); enqueueThumb(en.target); }
  }, { root: content, rootMargin: '600px 0px' });
  const els = box.querySelectorAll('.item');
  els.forEach(el => {
    const e = vis[+el.dataset.i];
    el._entry = e;
    if (!e.isDir) thumbObserver.observe(el);
  });

  // empty states
  if (!vis.length && !t.loading) {
    let title = 'This folder is empty', sub = '', btn = '';
    if (t.error) { title = "Can't open this folder"; sub = t.error; }
    else if (deep && t.searching) { title = 'Searching…'; sub = 'Results will appear here as they are found.'; }
    else if (deep) { title = 'Nothing found'; sub = t.query ? 'Try fewer words, or check the search tips (?).' : 'No matching files in this folder or its subfolders.'; }
    else if (t.query) { title = 'No matches in this folder'; sub = 'Press Enter to search all subfolders too.'; }
    else if (t.cat !== 'all') {
      const lbl = CAT_TABS.find(c => c[0] === t.cat)[1].toLowerCase();
      title = `No ${lbl} in this folder`;
      sub = 'They might be in a subfolder.';
      btn = `<button class="btn primary" id="empty-deep" style="pointer-events:auto;margin:10px auto 0">${icon('search')}Look in subfolders</button>`;
    }
    empty.innerHTML = `${icon(t.error ? 'info' : deep ? 'search' : 'folder')}<b>${esc(title)}</b><span>${esc(sub)}</span>${btn}`;
    empty.classList.remove('hidden');
    const b = $('#empty-deep');
    if (b) b.onclick = () => { $('#deep-toggle').checked = true; setDeep(true); };
  } else empty.classList.add('hidden');

  if (keepScroll) content.scrollTop = scroll;
}

function renderThisPC() {
  const box = $('#items');
  box.className = 'pc';
  let html = '<div class="pc-section-title">Drives</div>';
  html += drives.map(d => {
    const used = d.total ? (1 - d.free / d.total) : 0;
    return `<div class="drive-card" data-path="${esc(d.path)}">${icon('drive')}
      <div class="meta"><div><b>${d.letter === 'C' ? 'Local Disk' : 'Drive'} (${d.letter}:)</b></div>
      <div class="drive-bar ${used > .9 ? 'full' : ''}"><div style="width:${(used * 100).toFixed(1)}%"></div></div>
      <span class="sub">${d.total ? `${fmtSize(d.free)} free of ${fmtSize(d.total)}` : ''}</span></div>
      <button class="icon-btn" data-spacemap="${esc(d.path)}" title="What's using space on this drive?">${icon('map')}</button></div>`;
  }).join('');
  html += '<div class="pc-section-title">Folders</div>';
  html += INFO.quick.filter(q => q.label !== 'Home').map(q => `<div class="drive-card" data-path="${esc(q.path)}">${icon(q.icon)}
    <div class="meta"><b>${esc(q.label)}</b><span class="sub">${esc(q.path)}</span></div></div>`).join('');
  box.innerHTML = html;
}

function renderStatus() {
  const t = tab();
  if (t.kind === 'web') { renderWebStatus(); return; }
  const vis = t.visible || [];
  let left = '';
  if (t.path === THIS_PC && !t.deep) left = `${drives.length} drive${drives.length === 1 ? '' : 's'}`;
  else {
    left = `${vis.length.toLocaleString()} item${vis.length === 1 ? '' : 's'}`;
    if (t.selection.size) {
      const sel = vis.filter(e => t.selection.has(e.path));
      const size = sel.reduce((a, e) => a + (e.isDir ? 0 : e.size), 0);
      left += `  ·  ${t.selection.size} selected${size ? ` (${fmtSize(size)})` : ''}`;
    }
  }
  $('#status-left').textContent = left;

  if (t.deep && t.searching) {
    setProgress(`Searching subfolders… ${t.searchInfo.found.toLocaleString()} found · ${t.searchInfo.scanned.toLocaleString()} checked`, true);
  } else if (!t.loading) {
    setProgress(null);
  }
  let right = '';
  if (t.deep && !t.searching && t.searchInfo) {
    right = `Searched ${t.searchInfo.scanned.toLocaleString()} items${t.searchInfo.limited ? ' · showing first 5,000' : ''}${t.searchInfo.cancelled ? ' · stopped' : ''}`;
  } else if (isReadonlyPath(t.path)) {
    right = 'Inside an archive (read-only) — copy files out to use them';
  } else if (t.path !== THIS_PC) {
    const d = drives.find(dr => t.path.toUpperCase().startsWith(dr.letter + ':'));
    if (d && d.total) right = `${fmtSize(d.free)} free on ${d.letter}:`;
  }
  $('#status-right').textContent = right;
}

function setProgress(text, stoppable = false) {
  const el = $('#status-progress');
  if (!text) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('#status-progress-text').innerHTML = esc(text) + (stoppable ? ' <a href="#" id="stop-search" style="color:var(--accent)">Stop</a>' : '');
  const s = $('#stop-search');
  if (s) s.onclick = (e) => { e.preventDefault(); stopSearch(); };
}

// ---------- Sidebar ----------
function renderSidebar() {
  const item = (p, label, ic, extra = '') => `<div class="side-item" data-path="${esc(p)}" title="${esc(p)}">${icon(ic)}<span class="label">${esc(label)}</span></div>${extra}`;
  $('#side-quick').innerHTML = item(THIS_PC, 'This PC', 'desktop') + INFO.quick.map(q => item(q.path, q.label, q.icon)).join('');
  $('#side-pinned').innerHTML = (S.pinned || []).map(p => item(p.path, p.label || baseName(p.path), 'pin')).join('')
    || '<div class="drive-sub" style="margin:2px 10px 6px">Right-click a folder → Pin</div>';
  $('#side-drives').innerHTML = drives.map(d => {
    const used = d.total ? (1 - d.free / d.total) : 0;
    return item(d.path, `${d.letter === 'C' ? 'Local Disk' : 'Drive'} (${d.letter}:)`, 'drive',
      d.total ? `<div class="drive-bar ${used > .9 ? 'full' : ''}"><div style="width:${(used * 100).toFixed(1)}%"></div></div>` : '');
  }).join('');
  renderSidebarActive();
}
function renderSidebarActive() {
  const p = tab()?.path;
  $$('#sidebar .side-item').forEach(el => el.classList.toggle('active', samePath(el.dataset.path, p)));
}
async function refreshDrives() {
  try { drives = await api.drives(); } catch { drives = []; }
  renderSidebar();
}

// ---------- Preview ----------
let previewToken = 0;
async function renderPreview() {
  const pane = $('#preview');
  if (!S.showPreview) return;
  const t = tab();
  if (t.kind === 'web') return;
  const token = ++previewToken;
  const sel = (t.visible || []).filter(e => t.selection.has(e.path));
  if (!sel.length) {
    pane.innerHTML = `<div class="pv-empty">${icon('info')}Select a file to preview it</div>`;
    return;
  }
  if (sel.length > 1) {
    const size = sel.reduce((a, e) => a + (e.isDir ? 0 : e.size), 0);
    const folders = sel.filter(e => e.isDir).length;
    pane.innerHTML = `<div class="pv-media">${icon('copy')}</div><h3>${sel.length} items selected</h3>
      <div class="pv-kind">${folders ? `${folders} folder${folders > 1 ? 's' : ''}, ` : ''}${sel.length - folders} file${sel.length - folders === 1 ? '' : 's'}</div>
      <dl><dt>Total size</dt><dd>${fmtSize(size)}${folders ? ' (excluding folders)' : ''}</dd></dl>`;
    return;
  }
  const e = sel[0];
  let src = e.path;
  if (e.inArchive && !e.isDir && ['images', 'videos', 'audio'].includes(e.cat) && e.size < 300e6) {
    src = await api.archiveTemp(e.path).catch(() => null);
    if (token !== previewToken) return;
  }
  let media = '';
  if (e.isDir) media = folderArt();
  else if (src && e.cat === 'images' && !['psd', 'heic', 'heif', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'xcf', 'tga', 'tif', 'tiff'].includes(e.ext)) media = `<img src="${esc(fileUrl(src))}" alt="" id="pv-img">`;
  else if (src && e.cat === 'videos' && ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'].includes(e.ext)) media = `<video src="${esc(fileUrl(src))}" controls muted preload="metadata"></video>`;
  else media = '<span id="pv-icon"></span>';

  pane.innerHTML = `
    <div class="pv-media">${media}</div>
    ${e.cat === 'audio' && src ? `<audio src="${esc(fileUrl(src))}" controls preload="metadata"></audio>` : ''}
    <div id="pv-text"></div>
    <h3>${esc(e.name)}</h3>
    <div class="pv-kind">${esc(typeLabel(e))}</div>
    <dl>
      ${e.isDir ? (e.inArchive ? '' : '<dt>Size</dt><dd id="pv-fsize"><a href="#" id="pv-calc" style="color:var(--accent)">Calculate</a></dd>') : `<dt>Size</dt><dd>${fmtSize(e.size)} <span style="color:var(--dim)">(${e.size.toLocaleString()} bytes)</span></dd>`}
      <dt id="pv-dim-l" class="hidden">Dimensions</dt><dd id="pv-dim" class="hidden"></dd>
      <dt>Modified</dt><dd>${fmtDate(e.mtime)}</dd>
      <dt>Created</dt><dd>${fmtDate(e.ctime)}</dd>
      <dt>Location</dt><dd>${esc(parentOf(e.path) || '')}</dd>
    </dl>
    <div class="pv-actions">
      <button class="btn primary" id="pv-open">${icon('open')}Open</button>
      <button class="btn" id="pv-reveal" title="Show in Windows File Explorer">${icon('folder')}</button>
      <button class="btn" id="pv-copy" title="Copy path">${icon('copy')}</button>
    </div>`;
  $('#pv-open').onclick = () => openEntry(e);
  $('#pv-reveal').onclick = () => api.reveal(e.inArchive ? archiveRootOf(e.path) : e.path);
  $('#pv-copy').onclick = () => { api.copyText(e.path); toast('Path copied'); };
  const img = $('#pv-img');
  if (img) {
    img.onload = () => { $('#pv-dim').textContent = `${img.naturalWidth} × ${img.naturalHeight}`; $('#pv-dim').classList.remove('hidden'); $('#pv-dim-l').classList.remove('hidden'); };
    img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { id: 'pv-icon' })); fillPvIcon(e); };
  }
  const calc = $('#pv-calc');
  if (calc) calc.onclick = async (ev) => {
    ev.preventDefault();
    $('#pv-fsize').textContent = 'Calculating…';
    const r = await api.folderSize(e.path);
    if (token === previewToken) $('#pv-fsize').textContent = `${fmtSize(r.total)} · ${r.files.toLocaleString()} files${r.partial ? ' (partial)' : ''}`;
  };
  if ($('#pv-icon')) fillPvIcon(e);
  if (!e.isDir && (e.cat === 'code' || TEXT_EXT.has(e.ext)) && e.size < 50 * 1024 * 1024) {
    const txt = await api.readText(e.path, 16 * 1024).catch(() => null);
    if (token === previewToken && txt != null && $('#pv-text')) {
      $('#pv-text').innerHTML = `<pre>${esc(txt)}${e.size > 16 * 1024 ? '\n…' : ''}</pre>`;
    }
  }
}
async function fillPvIcon(e) {
  let url = await api.thumb(e.path, 256).catch(() => null);
  if (!url) url = await api.icon(e.path, false).catch(() => null);
  const el = $('#pv-icon');
  if (el && url) el.outerHTML = `<img src="${url}" class="${url.length < 20000 ? 'native' : ''}" alt="">`;
  else if (el) el.outerHTML = icon(catIcon(e.cat), 'pv-fallback');
}

// ---------- Selection ----------
function setSelection(paths, anchor) {
  const t = tab();
  t.selection = new Set(paths);
  if (anchor !== undefined) t.anchor = anchor;
  $$('#items .item').forEach(el => el.classList.toggle('selected', t.selection.has(el._entry?.path)));
  renderStatus();
  renderPreview();
}
function selectedEntries() {
  const t = tab();
  return (t.visible || []).filter(e => t.selection.has(e.path));
}
function itemElFor(path) { return $$('#items .item').find(el => el._entry?.path === path); }
function scrollIntoViewIfNeeded(el) { el && el.scrollIntoView({ block: 'nearest' }); }

function setupContentEvents() {
  const content = $('#content');
  const box = $('#items');

  box.addEventListener('mousedown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const el = e.target.closest('.item, .drive-card');
    if (!el) return;
    if (el.classList.contains('drive-card')) return;
    const t = tab();
    const ent = el._entry;
    if (e.button === 2 && t.selection.has(ent.path)) return;
    if (e.ctrlKey) {
      const s = new Set(t.selection);
      s.has(ent.path) ? s.delete(ent.path) : s.add(ent.path);
      setSelection(s, ent.path);
    } else if (e.shiftKey && t.anchor) {
      const a = t.visible.findIndex(x => x.path === t.anchor);
      const b = t.visible.indexOf(ent);
      if (a >= 0 && b >= 0) setSelection(t.visible.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.path));
    } else if (!t.selection.has(ent.path) || e.button === 2) {
      setSelection([ent.path], ent.path);
    } else {
      el._clickToSingle = true; // collapse to single selection on mouseup if no drag
    }
  });
  box.addEventListener('mouseup', (e) => {
    const el = e.target.closest('.item');
    if (el && el._clickToSingle) { el._clickToSingle = false; if (!e.ctrlKey && !e.shiftKey) setSelection([el._entry.path], el._entry.path); }
  });
  box.addEventListener('click', (e) => {
    const sm = e.target.closest('[data-spacemap]');
    if (sm) { e.stopPropagation(); openSpaceMap(sm.dataset.spacemap); return; }
    const card = e.target.closest('.drive-card');
    if (card) navigate(card.dataset.path);
  });
  box.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.item');
    if (el) openEntry(el._entry);
  });
  box.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const el = e.target.closest('.item, .drive-card');
    if (!el) return;
    const p = el._entry ? (el._entry.isDir ? el._entry.path : null) : el.dataset.path;
    if (p) { newTab(p, false); toast(`Opened "${baseName(p)}" in a new tab`); }
  });

  content.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isWebTab()) return;
    const el = e.target.closest('.item');
    const card = e.target.closest('.drive-card');
    if (card) return showMenu(e.clientX, e.clientY, folderMenu(card.dataset.path));
    if (el) return showMenu(e.clientX, e.clientY, itemMenu());
    if (!e.ctrlKey) setSelection([]);
    showMenu(e.clientX, e.clientY, backgroundMenu());
  });

  // Marquee selection
  let mq = null;
  content.addEventListener('mousedown', (e) => {
    if (isWebTab() || e.button !== 0 || e.target.closest('.item, .drive-card, #list-header, button, input, #webpage')) return;
    if (e.offsetX > content.clientWidth) return; // scrollbar
    content.focus();
    const t = tab();
    const r = content.getBoundingClientRect();
    mq = { x: e.clientX - r.left, y: e.clientY - r.top + content.scrollTop, base: e.ctrlKey ? new Set(t.selection) : new Set(), rects: null };
    if (!e.ctrlKey) setSelection([]);
  });
  window.addEventListener('mousemove', (e) => {
    if (!mq) return;
    const r = content.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, content.clientWidth));
    const y = Math.max(0, e.clientY - r.top) + content.scrollTop;
    const L = Math.min(mq.x, x), T = Math.min(mq.y, y), W = Math.abs(x - mq.x), H = Math.abs(y - mq.y);
    if (W < 4 && H < 4) return;
    const m = $('#marquee');
    m.classList.remove('hidden');
    Object.assign(m.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
    if (!mq.rects) {
      mq.rects = $$('#items .item').map(el => {
        const b = el.getBoundingClientRect();
        return { p: el._entry.path, l: b.left - r.left, t: b.top - r.top + content.scrollTop, r: b.right - r.left, b: b.bottom - r.top + content.scrollTop };
      });
    }
    const s = new Set(mq.base);
    for (const it of mq.rects) if (it.l < L + W && it.r > L && it.t < T + H && it.b > T) s.add(it.p);
    const t = tab();
    t.selection = s;
    $$('#items .item').forEach(el => el.classList.toggle('selected', s.has(el._entry.path)));
    // auto-scroll near edges
    if (e.clientY > r.bottom - 20) content.scrollTop += 20; else if (e.clientY < r.top + 20) content.scrollTop -= 20;
  });
  window.addEventListener('mouseup', () => {
    if (!mq) return;
    mq = null;
    $('#marquee').classList.add('hidden');
    renderStatus(); renderPreview();
  });

  $('#list-header').addEventListener('click', (e) => {
    const c = e.target.closest('[data-sort]'); if (!c) return;
    const s = effectiveSort();
    const by = c.dataset.sort;
    setSort(s.by === by ? { dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'name' || by === 'type' ? 'asc' : 'desc' });
  });

  // Ctrl+wheel zoom
  content.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const v = Math.max(48, Math.min(220, S.iconSize + (e.deltaY < 0 ? 8 : -8)));
    if (S.view !== 'grid') setS({ view: 'grid' });
    setS({ iconSize: v }); applyAppearance(); renderItems({ keepScroll: true });
  }, { passive: false });

  // Native drag out (to other apps, or back into WormFiles)
  box.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.item');
    if (!el) return;
    const t = tab();
    if (!t.selection.has(el._entry.path)) setSelection([el._entry.path], el._entry.path);
    if (isReadonlyPath(t.path)) {
      e.dataTransfer.setData('application/x-wormfiles', JSON.stringify([...t.selection]));
      e.dataTransfer.effectAllowed = 'copy';
      return;
    }
    e.preventDefault();
    api.startDrag([...t.selection]);
  });

  setupDropTarget(content, (e) => {
    const el = e.target.closest('.item');
    if (isWebTab() || isReadonlyPath(tab().path)) return null;
    if (el && el._entry.isDir) return { path: el._entry.path, el };
    if (tab().path === THIS_PC || tab().deep) return null;
    return { path: tab().path, el: null };
  });
}

// Generic drop handling (files dragged from WormFiles or from Windows)
function setupDropTarget(root, resolve) {
  let current = null;
  const clear = () => { if (current?.el) current.el.classList.remove('drop-target'); current = null; $('#content').classList.remove('dragover'); $('#drop-hint').classList.add('hidden'); };
  root.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-wormfiles')) return;
    const target = resolve(e);
    if (!target) { e.dataTransfer.dropEffect = 'none'; clear(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    if (current?.el !== target.el) { clear(); if (target.el) target.el.classList.add('drop-target'); }
    current = target;
    if (!target.el && root.id === 'content') { $('#content').classList.add('dragover'); $('#drop-hint').classList.remove('hidden'); }
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) clear(); });
  root.addEventListener('drop', async (e) => {
    const target = resolve(e);
    clear();
    if (!target) return;
    e.preventDefault();
    const internal = e.dataTransfer.getData('application/x-wormfiles');
    if (internal) { await doPaste(JSON.parse(internal), target.path, 'copy'); return; }
    const paths = Array.from(e.dataTransfer.files).map(f => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    await doPaste(paths, target.path, e.ctrlKey ? 'copy' : 'move');
  });
}

// ---------- File operations ----------
function copySel(mode) {
  const sel = selectedEntries().map(e => e.path);
  if (!sel.length) return;
  if (mode === 'move' && isReadonlyPath(tab().path)) mode = 'copy'; // can't take files out of an archive, only copy them
  clip = { paths: sel, mode };
  renderItems({ keepScroll: true });
  toast(`${mode === 'move' ? 'Cut' : 'Copied'} ${sel.length} item${sel.length > 1 ? 's' : ''} — paste with Ctrl+V`);
}

async function doPaste(paths = clip.paths, dest = tab().path, mode = clip.mode) {
  if (!paths.length || !dest || dest === THIS_PC) return;
  if (isReadonlyPath(dest)) { toast(READONLY_MSG, { error: true }); return; }
  const fromArchive = paths.some(isReadonlyPath);
  if (fromArchive) mode = 'copy';
  setProgress(`${fromArchive ? 'Extracting' : mode === 'move' ? 'Moving' : 'Copying'} ${paths.length} item${paths.length > 1 ? 's' : ''}…`);
  const r = await api.paste({ paths, dest, mode }).catch(err => ({ done: [], errors: [{ error: err.message }] }));
  setProgress(null);
  if (mode === 'move' && paths === clip.paths) clip = { paths: [], mode: null };
  if (r.errors.length) toast(r.errors[0].error + (r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ''), { error: true });
  if (!isWebTab()) await load(tab(), { silent: true });
  refreshPartner();
  if (!isWebTab() && samePath(dest, tab().path) && r.done.length) setSelection(r.done);
  if (fromArchive && r.done.length && !samePath(dest, tab().path)) {
    toast(`Extracted ${r.done.length} item${r.done.length > 1 ? 's' : ''} to ${baseName(dest)}`);
  }
}

async function trashSel() {
  const sel = selectedEntries();
  if (!sel.length) return;
  if (isReadonlyPath(tab().path)) { toast(READONLY_MSG, { error: true }); return; }
  const failed = await api.trash(sel.map(e => e.path));
  if (failed.length) toast(`Couldn't delete ${failed.length} item${failed.length > 1 ? 's' : ''}: ${failed[0].error}`, { error: true });
  else toast(`Moved ${sel.length} item${sel.length > 1 ? 's' : ''} to the Recycle Bin`);
  const t = tab();
  if (t.deep && t.results) t.results = t.results.filter(e => !sel.includes(e));
  await load(t, { silent: true });
  refreshPartner();
  setSelection([]);
}

function startRename(entry) {
  if (entry.inArchive) { toast(READONLY_MSG, { error: true }); return; }
  const el = itemElFor(entry.path);
  if (!el) return;
  scrollIntoViewIfNeeded(el);
  const nameEl = el.querySelector('.name');
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = entry.name;
  nameEl.replaceWith(input);
  el.draggable = false;
  input.focus();
  const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  let done = false;
  const finish = async (commit) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (commit && v && v !== entry.name) {
      try {
        const np = await api.rename(entry.path, v);
        await load(tab(), { silent: true });
        setSelection([np], np);
        return;
      } catch (err) {
        toast(err.message.replace(/^Error invoking remote method[^:]*: (Error: )?/, ''), { error: true });
      }
    }
    renderItems({ keepScroll: true });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('mousedown', (e) => e.stopPropagation());
}

async function newFolder() {
  const t = tab();
  if (t.path === THIS_PC || t.deep) return;
  if (isReadonlyPath(t.path)) { toast(READONLY_MSG, { error: true }); return; }
  try {
    const p = await api.newFolder(t.path);
    if (t.cat !== 'all' && t.cat !== 'folders') { t.cat = 'all'; renderCats(); }
    await load(t, { silent: true });
    setSelection([p], p);
    const e = t.visible.find(x => x.path === p);
    if (e) startRename(e);
  } catch (err) { toast(err.message, { error: true }); }
}
async function newFile() {
  const t = tab();
  if (t.path === THIS_PC || t.deep) return;
  if (isReadonlyPath(t.path)) { toast(READONLY_MSG, { error: true }); return; }
  try {
    const p = await api.newFile(t.path);
    if (t.cat !== 'all' && t.cat !== 'documents') { t.cat = 'all'; renderCats(); }
    await load(t, { silent: true });
    setSelection([p], p);
    const e = t.visible.find(x => x.path === p);
    if (e) startRename(e);
  } catch (err) { toast(err.message, { error: true }); }
}

function pinFolder(p) {
  if ((S.pinned || []).some(x => samePath(x.path, p))) return toast('Already pinned');
  setS({ pinned: [...(S.pinned || []), { path: p, label: baseName(p) }] });
  renderSidebar();
  toast(`Pinned "${baseName(p)}" to the sidebar`);
}
function unpinFolder(p) {
  setS({ pinned: (S.pinned || []).filter(x => !samePath(x.path, p)) });
  renderSidebar();
}

// ---------- Context menus ----------
function itemMenu() {
  const sel = selectedEntries();
  const one = sel.length === 1 ? sel[0] : null;
  const t = tab();
  if (isReadonlyPath(t.path)) {
    const root = archiveRootOf(t.path);
    return [
      { label: 'Open', icon: 'open', kbd: 'Enter', action: () => sel.slice(0, 15).forEach(e => openEntry(e)) },
      { label: 'Quick look', icon: 'eye', kbd: 'Space', action: quickLookOpen },
      '-',
      { label: `Extract to "${baseName(parentOf(root))}"`, icon: 'download', action: () => doPaste(sel.map(e => e.path), parentOf(root), 'copy') },
      { label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', action: () => copySel('copy') },
      { label: 'Copy path', icon: 'copy', action: () => { api.copyText(sel.map(e => e.path).join('\r\n')); toast('Path copied'); } }
    ];
  }
  const archiveFile = one && one.isArchive && !one.inArchive;
  return [
    { label: archiveFile && S.openArchives !== false ? 'Look inside' : 'Open', icon: 'open', kbd: 'Enter', action: () => sel.slice(0, 15).forEach(e => openEntry(e)) },
    { label: 'Quick look', icon: 'eye', kbd: 'Space', action: quickLookOpen },
    one && one.isDir && { label: 'Open in new tab', icon: 'tab', kbd: 'Middle-click', action: () => newTab(one.path) },
    archiveFile && { label: `Extract to "${one.name.replace(/\.(tar\.(gz|bz2|xz)|[^.]+)$/i, '')}\\"`, icon: 'download', action: () => extractArchive(one.path, 'folder') },
    archiveFile && { label: 'Extract here', icon: 'download', action: () => extractArchive(one.path, 'here') },
    archiveFile && S.openArchives !== false && { label: 'Open with default app', icon: 'app', action: () => api.open(one.path) },
    one && !one.isDir && { label: 'Open with…', icon: 'app', action: () => api.openWith(one.path) },
    one && !one.isDir && BROWSER_OPENABLE.has(one.ext) && { label: 'Open in Worm', icon: 'globe', action: () => newWebTab(fileToUrl(one.path)) },
    t.deep && one && { label: 'Open file location', icon: 'folder', action: () => navigate(parentOf(one.path), { keepSelection: one.path }) },
    '-',
    { label: 'Cut', icon: 'cut', kbd: 'Ctrl+X', action: () => copySel('move') },
    { label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', action: () => copySel('copy') },
    one && one.isDir && clip.paths.length && { label: 'Paste into folder', icon: 'paste', action: () => doPaste(clip.paths, one.path, clip.mode) },
    { label: 'Copy path', icon: 'copy', kbd: 'Ctrl+Shift+C', action: () => { api.copyText(sel.map(e => e.path).join('\r\n')); toast('Path copied'); } },
    '-',
    one && { label: 'Rename', icon: 'edit', kbd: 'F2', action: () => startRename(one) },
    { label: 'Delete', icon: 'trash', kbd: 'Del', danger: true, action: trashSel },
    '-',
    one && one.isDir && { label: 'Pin to sidebar', icon: 'pin', action: () => pinFolder(one.path) },
    one && one.isDir && { label: 'Disk space map', icon: 'map', action: () => openSpaceMap(one.path) },
    one && one.isDir && { label: 'Open terminal here', icon: 'terminal', action: () => api.terminal(one.path) },
    one && { label: 'Show in Windows Explorer', icon: 'folder', action: () => api.reveal(one.path) },
    one && { label: 'Properties', icon: 'info', kbd: 'Alt+Enter', action: () => api.properties(one.path) }
  ].filter(Boolean);
}

function folderMenu(p) {
  const pinned = (S.pinned || []).some(x => samePath(x.path, p));
  return [
    { label: 'Open', icon: 'open', action: () => navigate(p) },
    { label: 'Open in new tab', icon: 'tab', action: () => newTab(p) },
    '-',
    p !== THIS_PC && (pinned ? { label: 'Unpin from sidebar', icon: 'pin', action: () => unpinFolder(p) } : { label: 'Pin to sidebar', icon: 'pin', action: () => pinFolder(p) }),
    p !== THIS_PC && { label: 'Disk space map', icon: 'map', action: () => openSpaceMap(p) },
    p !== THIS_PC && { label: 'Copy path', icon: 'copy', action: () => { api.copyText(p); toast('Path copied'); } },
    p !== THIS_PC && { label: 'Open terminal here', icon: 'terminal', action: () => api.terminal(p) },
    p !== THIS_PC && { label: 'Show in Windows Explorer', icon: 'folder', action: () => api.reveal(p) },
    p !== THIS_PC && { label: 'Properties', icon: 'info', action: () => api.properties(p) }
  ].filter(Boolean);
}

function backgroundMenu() {
  const t = tab();
  const inZip = isReadonlyPath(t.path);
  const real = t.path !== THIS_PC && !t.deep && !inZip;
  return [
    { heading: 'View' },
    { label: 'Grid', icon: 'grid', checked: S.view === 'grid', action: () => setView('grid') },
    { label: 'List', icon: 'list', checked: S.view === 'list', action: () => setView('list') },
    '-',
    real && { label: 'New folder', icon: 'newfolder', kbd: 'Ctrl+Shift+N', action: newFolder },
    real && { label: 'New text file', icon: 'newfile', action: newFile },
    real && { label: 'Paste', icon: 'paste', kbd: 'Ctrl+V', disabled: !clip.paths.length, action: () => doPaste() },
    real && '-',
    inZip && { label: 'Extract everything', icon: 'download', action: () => extractArchive(archiveRootOf(t.path), 'folder') },
    inZip && '-',
    real && { label: 'Tidy up this folder…', icon: 'sparkle', action: tidyUp },
    real && { label: 'Disk space map', icon: 'map', action: () => openSpaceMap(t.path) },
    !isWebTab() && { label: inSplit() ? 'Exit split view' : 'Split view', icon: 'columns', kbd: 'Ctrl+\\', action: toggleSplit },
    { label: 'Refresh', icon: 'refresh', kbd: 'F5', action: () => load(tab()) },
    real && { label: 'Pin this folder', icon: 'pin', action: () => pinFolder(t.path) },
    real && { label: 'Open terminal here', icon: 'terminal', action: () => api.terminal(t.path) },
    real && { label: 'Open in Windows Explorer', icon: 'folder', action: () => api.explorer(t.path) },
    '-',
    { label: 'Customize WormFiles…', icon: 'palette', kbd: 'Ctrl+,', action: openSettings }
  ].filter(Boolean);
}

function sortMenu() {
  const s = effectiveSort();
  const rows = [
    { heading: 'Sort by' },
    ...Object.entries(SORT_LABELS).map(([k, l]) => ({ label: l, checked: s.by === k, action: () => setSort({ by: k, dir: k === 'name' || k === 'type' ? 'asc' : 'desc' }) })),
    '-',
    { label: 'Ascending', checked: s.dir === 'asc', action: () => setSort({ dir: 'asc' }) },
    { label: 'Descending', checked: s.dir === 'desc', action: () => setSort({ dir: 'desc' }) },
    { label: 'Folders first', checked: s.foldersFirst, action: () => setSort({ foldersFirst: !s.foldersFirst }) },
    { heading: 'Group by' },
    ...[['none', 'None'], ['type', 'Type'], ['date', 'Date modified'], ['size', 'Size']].map(([k, l]) => ({
      label: l, checked: S.groupBy === k, action: () => { setS({ groupBy: k }); renderItems(); }
    })),
    '-'
  ];
  if (s.source === 'folder') rows.push({ label: 'Forget sort for this folder', icon: 'undo', action: () => { const fs = { ...S.folderSorts }; delete fs[tab().path]; setS({ folderSorts: fs }); renderItems(); renderSortLabel(); } });
  if (s.source === 'rule') rows.push({ label: `Auto-sorted by rule "${s.rule}"`, icon: 'sparkle', disabled: true });
  rows.push({ label: 'Edit auto-sort rules…', icon: 'settings', action: () => openSettings('sorting') });
  return rows;
}

function setView(v) {
  setS({ view: v });
  renderAll();
}

// ---------- Tidy up ----------
async function tidyUp() {
  const t = tab();
  if (t.path === THIS_PC) return;
  let plan;
  try { plan = await api.organizePreview(t.path); } catch (e) { return toast(e.message, { error: true }); }
  const groups = Object.entries(plan);
  if (!groups.length) return toast('Nothing to tidy — no loose files here.');
  const total = groups.reduce((a, [, v]) => a + v.length, 0);
  openModal({
    title: 'Tidy up this folder',
    body: `<p class="tip">WormFiles will move <b>${total}</b> loose file${total > 1 ? 's' : ''} in <b>${esc(baseName(t.path))}</b> into folders by type. Existing folders are left alone, and you can undo this right after.</p>
      <div class="tidy-list">${groups.map(([f, list]) => `<div><span>${icon('folder')} ${esc(f)}</span><span>${list.length} file${list.length > 1 ? 's' : ''}</span></div>`).join('')}</div>`,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Tidy up', primary: true, action: async () => {
          const r = await api.organizeRun(t.path);
          await load(t, { silent: true });
          toast(`Moved ${r.moves.length} files into ${groups.length} folder${groups.length > 1 ? 's' : ''}`, {
            action: { label: 'Undo', fn: async () => { const n = await api.organizeUndo(r); await load(t, { silent: true }); toast(`Restored ${n} files`); } }
          });
        }
      }
    ]
  });
}

// ---------- Settings UI ----------
function openSettings(startTab = 'look') {
  const body = document.createElement('div');
  const tabsDef = [['look', 'Appearance'], ['behavior', 'Behavior'], ['sorting', 'Auto-sort'], ['browser', 'Worm browser'], ['advanced', 'Advanced'], ['keys', 'Shortcuts']];
  let current = startTab;

  const render = () => {
    const pane = body.querySelector('.settings-pane');
    pane.innerHTML = ({ look: lookPane, behavior: behaviorPane, sorting: sortingPane, browser: browserSettingsPane, advanced: advancedPane, keys: keysPane })[current]();
    hydrateIcons(pane);
    bind(pane);
    body.querySelectorAll('.settings-tab').forEach(el => el.classList.toggle('active', el.dataset.t === current));
  };

  const range = (key, label, min, max, step, fmt = (v) => v, hint = '') => `
    <div class="field"><label>${label}</label><div class="row"><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${S[key]}"><span class="val" data-v="${key}">${fmt(S[key])}</span></div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const check = (key, label, hint = '') => `
    <div class="field"><label>${label}</label><label class="toggle"><input type="checkbox" data-k="${key}" ${S[key] ? 'checked' : ''}><span class="track"></span><span>${S[key] ? 'On' : 'Off'}</span></label>
    ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const pct = (v) => Math.round(v * 100) + '%';

  const lookPane = () => `
    <div class="side-title" style="padding-left:0">Theme</div>
    <div class="theme-grid">${Object.entries(THEMES).map(([k, t]) => `
      <div class="theme-card ${S.theme === k ? 'active' : ''}" data-theme="${k}">
        <div class="sw" style="background:rgb(${t.bg})"><div class="a" style="background:rgb(${t.surface})"><i style="background:${t.accent}"></i></div>
          <div style="display:grid;place-items:center"><i style="width:60%;height:8px;border-radius:4px;background:rgb(${t.surface2});display:block"></i></div></div>
        <div class="nm" style="background:rgb(${t.surface});color:rgb(${t.text})">${esc(t.name)}</div>
      </div>`).join('')}</div>
    <div class="field"><label>Accent color</label><div class="row">
      <input type="color" id="accent-pick" value="${S.accent || THEMES[S.theme]?.accent || '#e11d2e'}">
      <button class="btn" id="accent-reset" ${S.accent ? '' : 'disabled'}>Use theme color</button></div></div>
    <div class="field"><label>Background image</label><div class="row">
      <div class="bg-preview" style="${S.bgImage ? `background-image:url(&quot;${esc(fileUrl(S.bgImage))}&quot;)` : ''}">${S.bgImage ? '' : 'None'}</div>
      <div style="display:grid;gap:6px"><button class="btn" id="bg-pick">${icon('image')}Choose image…</button>
      ${S.bgImage ? '<button class="btn danger" id="bg-clear">Remove</button>' : ''}</div></div></div>
    ${S.bgImage ? range('bgOpacity', 'Image visibility', 0.05, 1, 0.05, pct) + range('bgBlur', 'Image blur', 0, 40, 1, v => v + 'px') : ''}
    ${S.bgImage || S.mica ? range('panelAlpha', 'Panel opacity', 0.3, 1, 0.02, pct, 'Lower = more of the background shows through.') : ''}
    ${check('mica', 'Windows Mica effect', 'Lets your desktop wallpaper tint the window (Windows 11 only).')}
    <div class="field"><label>Density</label><select data-k="density">
      ${['compact', 'comfortable', 'spacious'].map(d => `<option value="${d}" ${S.density === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></div>
    ${range('fontSize', 'Text size', 11, 18, 1, v => v + 'px')}
    ${range('radius', 'Corner roundness', 0, 18, 1, v => v + 'px')}
    ${range('iconSize', 'Icon size', 48, 220, 4, v => v + 'px')}`;

  const behaviorPane = () => `
    <div class="field"><label>Default view</label><select data-k="view">
      <option value="grid" ${S.view === 'grid' ? 'selected' : ''}>Grid</option><option value="list" ${S.view === 'list' ? 'selected' : ''}>List</option></select></div>
    ${check('showHidden', 'Show hidden files', 'Files starting with a dot and Windows system files.')}
    ${check('showExtensions', 'Show file extensions')}
    ${check('showPreview', 'Preview pane')}
    ${check('restoreTabs', 'Reopen tabs on launch')}
    ${check('openArchives', 'Open zip files like folders', 'Double-click a .zip, .7z or .rar to look inside. Turn off to open them with your usual app instead.')}
    <div id="integration"></div>`;

  const sortingPane = () => `
    <p class="tip">WormFiles picks a sort order automatically for each folder:</p>
    <p class="tip">1. If you changed the sort in a folder, it remembers that (when the setting below is on).<br>
    2. Otherwise the first matching rule below is used — e.g. <b>Downloads</b> shows newest first.<br>
    3. Otherwise it uses the default.</p>
    ${check('rememberSortPerFolder', 'Remember sort per folder')}
    <div class="field"><label>Default sort</label><div class="row">
      <select id="def-by">${Object.entries(SORT_LABELS).map(([k, l]) => `<option value="${k}" ${S.sort.by === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="def-dir"><option value="asc" ${S.sort.dir === 'asc' ? 'selected' : ''}>Ascending</option><option value="desc" ${S.sort.dir === 'desc' ? 'selected' : ''}>Descending</option></select>
      <label class="toggle"><input type="checkbox" id="def-ff" ${S.sort.foldersFirst ? 'checked' : ''}><span class="track"></span><span>Folders first</span></label></div></div>
    <div class="side-title" style="padding-left:0;margin-top:16px">Rules — folder name or path contains…</div>
    <div id="rules">${(S.sortRules || []).map((r, i) => `<div class="rule-row" data-i="${i}">
      <input class="text-input" data-r="match" value="${esc(r.match)}" placeholder="e.g. Screenshots">
      <select data-r="by">${Object.entries(SORT_LABELS).map(([k, l]) => `<option value="${k}" ${r.by === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-r="dir"><option value="asc" ${r.dir === 'asc' ? 'selected' : ''}>Ascending</option><option value="desc" ${r.dir === 'desc' ? 'selected' : ''}>Descending</option></select>
      <button class="icon-btn" data-del-rule="${i}" title="Remove">${icon('x')}</button></div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button class="btn" id="add-rule">${icon('plus')}Add rule</button>
    <button class="btn" id="clear-folder-sorts" ${Object.keys(S.folderSorts || {}).length ? '' : 'disabled'}>Forget ${Object.keys(S.folderSorts || {}).length} remembered folder sort(s)</button></div>`;

  const advancedPane = () => `
    <div class="field" style="grid-template-columns:1fr"><label>Custom CSS — style anything you like</label>
      <textarea id="custom-css" spellcheck="false" placeholder="/* example */\n.item .name { font-weight: 600; }\n#sidebar { width: 260px; }">${esc(S.customCss || '')}</textarea>
      <div class="hint" style="grid-column:1">Useful variables: --accent, --radius, --icon-size, --bg-rgb, --surface-rgb, --text-rgb. Changes apply instantly.</div></div>
    <div class="field"><label>Reset</label><div class="row"><button class="btn danger" id="reset-all">Reset all settings</button></div></div>
    <div class="field"><label>Updates</label><div class="row"><span id="upd-text" class="dim">WormFiles ${esc(INFO.version)}</span><button class="btn" id="upd-check">${icon('refresh')}Check for updates</button></div></div>`;

  const keysPane = () => `<div class="kbd-table">${[
    ['Ctrl+T / Ctrl+W', 'New folder tab / close tab'], ['Ctrl+Tab', 'Next tab'], ['Ctrl+1…9 (with Alt)', 'Alt+0–9: switch category'],
    ['Ctrl+F', 'Search'], ['Enter (in search)', 'Search all subfolders'], ['Ctrl+L or Alt+D', 'Type a path'],
    ['Alt+← / Alt+→ / Alt+↑', 'Back / forward / up'], ['Backspace', 'Back'], ['F5', 'Refresh'], ['F2', 'Rename'], ['Del', 'Move to Recycle Bin'],
    ['Ctrl+C / X / V', 'Copy / cut / paste'], ['Ctrl+Shift+C', 'Copy path'], ['Ctrl+Shift+N', 'New folder'], ['Ctrl+A', 'Select all'],
    ['Ctrl+1 / Ctrl+2', 'Grid / list view'], ['Ctrl+scroll', 'Change icon size'], ['Alt+P', 'Toggle preview pane'],
    ['Alt+Enter', 'Properties'], ['Ctrl+,', 'Settings'], ['Type letters', 'Jump to a file by name'], ['Middle-click folder', 'Open in new tab'],
    ['Space', 'Quick look (full-size preview; arrows for next/previous)'], ['Ctrl+\\', 'Split view'],
    ['Ctrl+Shift+T', 'New Worm tab'], ['Ctrl+D', 'Bookmark page (Worm)'], ['Ctrl+F', 'Find on page (Worm)'], ['Ctrl + / − / 0', 'Zoom page (Worm)'], ['F12', 'Developer tools (Worm)']
  ].map(([k, d]) => `<span><kbd>${esc(k)}</kbd></span><span>${esc(d)}</span>`).join('')}</div>`;

  const bind = (pane) => {
    bindBrowserSettings(pane, render);
    renderIntegration(pane);
    pane.querySelectorAll('[data-theme]').forEach(el => el.onclick = () => { setS({ theme: el.dataset.theme, accent: '' }, { appearance: true }); render(); });
    pane.querySelectorAll('input[type=range][data-k]').forEach(el => el.oninput = () => {
      const k = el.dataset.k; const v = parseFloat(el.value);
      setS({ [k]: v }, { appearance: true });
      const lbl = pane.querySelector(`[data-v="${k}"]`);
      if (lbl) lbl.textContent = k === 'bgOpacity' || k === 'panelAlpha' ? Math.round(v * 100) + '%' : v + 'px';
      if (k === 'iconSize') renderItems({ keepScroll: true });
    });
    pane.querySelectorAll('input[type=checkbox][data-k]').forEach(el => el.onchange = async () => {
      const k = el.dataset.k;
      setS({ [k]: el.checked }, { appearance: true });
      el.parentElement.querySelector('span:last-child').textContent = el.checked ? 'On' : 'Off';
      if (k === 'mica') { await api.setMica(el.checked); render(); }
      if (k === 'showHidden' || k === 'showExtensions') { renderAll(); }
      if (k === 'showPreview') renderAll();
    });
    pane.querySelectorAll('select[data-k]').forEach(el => el.onchange = () => { setS({ [el.dataset.k]: el.value }, { appearance: true }); renderAll(); });
    const ap = $('#accent-pick', pane);
    if (ap) {
      ap.oninput = () => setS({ accent: ap.value }, { appearance: true });
      ap.onchange = () => render();
      $('#accent-reset', pane).onclick = () => { setS({ accent: '' }, { appearance: true }); render(); };
      $('#bg-pick', pane).onclick = async () => {
        const p = await api.pickImage();
        if (p) { setS({ bgImage: p, panelAlpha: S.panelAlpha >= 0.99 ? 0.78 : S.panelAlpha }, { appearance: true }); render(); }
      };
      const clr = $('#bg-clear', pane);
      if (clr) clr.onclick = () => { setS({ bgImage: '' }, { appearance: true }); render(); };
    }
    const css = $('#custom-css', pane);
    if (css) css.oninput = () => { S.customCss = css.value; $('#user-css').textContent = css.value; clearTimeout(css._t); css._t = setTimeout(() => setS({ customCss: css.value }), 400); };
    const updText = $('#upd-text', pane);
    if (updText) {
      const show = (u) => { if (updText.isConnected) updText.textContent = updateText(u); };
      api.updateStatus().then(show);
      $('#upd-check', pane).onclick = async () => { updText.textContent = 'Checking…'; show(await api.updateCheck()); };
    }
    const reset = $('#reset-all', pane);
    if (reset) reset.onclick = () => {
      if (!confirm('Reset every WormFiles setting (theme, rules, pins)?')) return;
      const defaults = { theme: 'crimson', accent: '', bgImage: '', bgOpacity: 0.55, bgBlur: 0, panelAlpha: 0.78, mica: false, fontSize: 13, radius: 10, density: 'comfortable', view: 'grid', iconSize: 96, showHidden: false, showExtensions: true, showPreview: true, customCss: '', groupBy: 'none', folderSorts: {} };
      setS(defaults, { appearance: true }); api.setMica(false); renderAll(); render();
    };
    // sorting pane
    const defBy = $('#def-by', pane);
    if (defBy) {
      const saveDef = () => { setS({ sort: { by: defBy.value, dir: $('#def-dir', pane).value, foldersFirst: $('#def-ff', pane).checked } }); renderItems(); renderSortLabel(); };
      defBy.onchange = saveDef; $('#def-dir', pane).onchange = saveDef; $('#def-ff', pane).onchange = saveDef;
      const saveRules = () => {
        const rules = $$('.rule-row', pane).map(row => ({
          match: row.querySelector('[data-r=match]').value.trim(),
          by: row.querySelector('[data-r=by]').value,
          dir: row.querySelector('[data-r=dir]').value
        }));
        setS({ sortRules: rules }); renderItems(); renderSortLabel();
      };
      pane.querySelectorAll('[data-r]').forEach(el => { el.oninput = saveRules; el.onchange = saveRules; });
      pane.querySelectorAll('[data-del-rule]').forEach(b => b.onclick = () => { const r = [...S.sortRules]; r.splice(+b.dataset.delRule, 1); setS({ sortRules: r }); render(); renderItems(); });
      $('#add-rule', pane).onclick = () => { setS({ sortRules: [...(S.sortRules || []), { match: '', by: 'mtime', dir: 'desc' }] }); render(); };
      $('#clear-folder-sorts', pane).onclick = () => { setS({ folderSorts: {} }); render(); renderItems(); renderSortLabel(); };
    }
  };

  body.innerHTML = `<div class="settings-tabs" style="margin:-14px -18px 0">${tabsDef.map(([k, l]) => `<div class="settings-tab" data-t="${k}">${l}</div>`).join('')}</div><div class="settings-pane"></div>`;
  body.querySelectorAll('.settings-tab').forEach(el => el.onclick = () => { current = el.dataset.t; render(); });
  openModal({ title: 'Customize WormFiles', body, wide: true });
  render();
}

// ---------- Updates ----------
function updateText(u) {
  const v = `WormFiles ${INFO.version}`;
  switch (u && u.state) {
    case 'checking': return `${v} — checking for updates…`;
    case 'latest': return `${v} — you're up to date`;
    case 'downloading': return `${v} — downloading ${u.version || 'update'}${u.percent ? ` (${u.percent}%)` : ''}…`;
    case 'ready': return `Version ${u.version} is ready — restart WormFiles to finish`;
    case 'error': return `${v} — couldn't check for updates`;
    case 'off': return `${v} — automatic updates are on in the installed version from GitHub`;
    default: return v;
  }
}
function setupUpdatesUI() {
  let told = false;
  api.onUpdate((u) => {
    const el = $('#upd-text');
    if (el) el.textContent = updateText(u);
    if (u.state === 'ready' && !told) {
      told = true;
      toast(`WormFiles ${u.version} is ready`, { ms: 60000, action: { label: 'Restart now', fn: () => api.updateInstall() } });
    }
  });
}

// "Use WormFiles instead of File Explorer" and "Make Worm my default browser"
async function renderIntegration(pane) {
  const box = $('#integration', pane);
  if (!box) return;
  const st = await api.integrationStatus().catch(() => null);
  if (!st || !st.windows || !box.isConnected) return;
  box.innerHTML = `
    <div class="side-title" style="padding-left:0;margin-top:18px">Windows</div>
    <div class="field"><label>Open folders in WormFiles</label>
      <label class="toggle"><input type="checkbox" id="int-explorer" ${st.replaceExplorer ? 'checked' : ''}><span class="track"></span><span>${st.replaceExplorer ? 'On' : 'Off'}</span></label>
      <div class="hint">Folders you open from the desktop, Win+E, apps and shortcuts open in WormFiles instead of File Explorer. Turn it off any time to go back.</div></div>
    <div class="field"><label>Default browser</label>
      <div class="row">${st.defaultBrowser
        ? `<span style="color:var(--accent);display:inline-flex;gap:6px;align-items:center">${icon('check')} Worm is your default browser</span>`
        : `<button class="btn primary" id="int-browser">${icon('globe')}Make Worm my default browser</button>`}</div>
      <div class="hint">${st.defaultBrowser ? 'Links from other apps open in Worm tabs.' : 'Windows opens its Default apps page. Click <b>Set default</b> at the top, then come back here.'}</div></div>`;
  hydrateIcons(box);
  $('#int-explorer', box).onchange = async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    try {
      const ok = await api.setExplorer(on);
      toast(ok ? 'Folders will now open in WormFiles' : 'Folders will open in File Explorer again');
    } catch (err) { toast("Couldn't change that: " + err.message, { error: true }); }
    renderIntegration(pane);
  };
  const b = $('#int-browser', box);
  if (b) b.onclick = async () => {
    await api.defaultBrowser();
    toast('In Windows Settings, click "Set default" next to Worm');
    // re-check when the user comes back to WormFiles
    window.addEventListener('focus', () => setTimeout(() => renderIntegration(pane), 300), { once: true });
  };
}

function showSearchHelp() {
  const r = $('#search-help-btn').getBoundingClientRect();
  const el = $('#popover');
  hideMenus();
  el.innerHTML = `<div style="padding:8px 10px;max-width:360px;user-select:text">
    <div class="menu-label" style="padding:0 0 6px">Search tips</div>
    <div class="tip">Type to filter this folder. Press <kbd>Enter</kbd> to search every subfolder.</div>
    <div class="tip"><code>holiday beach</code> — names containing both words</div>
    <div class="tip"><code>"final draft"</code> — exact phrase</div>
    <div class="tip"><code>ext:png,jpg</code> — by extension</div>
    <div class="tip"><code>type:video</code> — image, video, music, document, archive, code, app</div>
    <div class="tip"><code>size:>500mb</code> &nbsp; <code>size:&lt;10kb</code></div>
    <div class="tip"><code>modified:&lt;7d</code> — changed in the last week<br><code>modified:>1y</code> — older than a year · <code>modified:today</code></div>
    <div class="tip"><code>kind:folder</code> — only folders</div>
    <div class="tip"><code>IMG_*.jpg</code> — wildcards &nbsp; <code>-copy</code> — exclude a word</div>
  </div>`;
  el.classList.remove('hidden');
  const w = el.getBoundingClientRect().width;
  el.style.left = Math.min(r.left, innerWidth - w - 8) + 'px';
  el.style.top = (r.bottom + 6) + 'px';
}

// ---------- Search box ----------
function syncSearchClear() {
  $('#search-clear').classList.toggle('hidden', !$('#search-input').value);
  const t = tab();
  $('#search-input').placeholder = t.deep ? `Search ${baseName(t.path)} and subfolders` : `Search ${baseName(t.path)} · Enter for subfolders`;
}

function setDeep(on, auto = false) {
  const t = tab();
  if (on && isReadonlyPath(t.path)) { $('#deep-toggle').checked = false; toast("Searching subfolders doesn't work inside archives"); return; }
  t.deep = on;
  t.deepAuto = on && auto;
  $('#deep-toggle').checked = on;
  syncSearchClear();
  if (on) runDeep(t);
  else {
    if (t.searching) api.searchCancel(t.searchId);
    t.results = null; t.searching = false; t.searchInfo = null;
    renderAll(); renderTabs();
  }
}

function setupSearch() {
  const input = $('#search-input');
  input.addEventListener('input', () => {
    const t = tab();
    t.query = input.value;
    syncSearchClear();
    if (t.deep) scheduleDeep(t);
    else { renderItems(); renderStatus(); }
  });
  input.addEventListener('keydown', (e) => {
    const t = tab();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!t.deep) setDeep(true, true); else runDeep(t);
      renderTabs();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      $('#content').focus();
      const first = tab().visible[0];
      if (first) setSelection([first.path], first.path);
    }
  });
  $('#search-clear').onclick = clearSearch;
  $('#search-help-btn').onclick = (e) => { e.stopPropagation(); showSearchHelp(); };
  $('#deep-toggle').onchange = (e) => setDeep(e.target.checked);
}

function clearSearch() {
  const t = tab();
  const input = $('#search-input');
  input.value = ''; t.query = '';
  syncSearchClear();
  if (t.deepAuto) setDeep(false);
  else if (t.deep) runDeep(t);
  else { renderItems(); renderStatus(); }
  renderTabs();
}

// ---------- Address bar ----------
function setupAddress() {
  const box = $('#address');
  const input = $('#address-input');
  const startEdit = () => {
    box.classList.add('editing');
    const t = tab();
    if (t.kind === 'web') {
      input.value = t.url === WEB_NEWTAB ? '' : t.url;
      input.placeholder = 'Search or type a web address';
    } else {
      input.value = t.path === THIS_PC ? '' : t.path;
      input.placeholder = 'Type a folder path, or a web address to open it in Worm';
    }
    input.focus(); input.select();
  };
  const stopEdit = () => { box.classList.remove('editing'); hideSuggestions(); if (isWebTab()) renderUrlDisplay(tab()); };
  box.addEventListener('click', (e) => {
    const c = e.target.closest('.crumb');
    if (c) { navigate(c.dataset.path); return; }
    if (!box.classList.contains('editing')) startEdit();
  });
  box.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.crumb');
    if (c) { e.preventDefault(); showMenu(e.clientX, e.clientY, folderMenu(c.dataset.path)); }
  });
  input.addEventListener('input', () => { if (isWebTab()) showSuggestions(input); });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { stopEdit(); if (isWebTab()) api.web.focus(tab().id); else $('#content').focus(); }
    if (isWebTab() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (moveSuggestion(e.key === 'ArrowDown' ? 1 : -1, input)) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && isWebTab()) {
      const v = input.value;
      stopEdit();
      webGo(tab(), v);
      return;
    }
    if (e.key === 'Enter' && looksLikeUrl(input.value)) {
      const v = input.value;
      stopEdit();
      webGo(newWebTab(), v);
      return;
    }
    if (e.key === 'Enter') {
      let v = input.value.trim().replace(/^"|"$/g, '');
      if (!v || /^this pc$/i.test(v)) { stopEdit(); navigate(THIS_PC); return; }
      v = v.replace(/%([^%]+)%/g, (m, k) => (k.toUpperCase() === 'USERPROFILE' ? INFO.home : m));
      if (/^[a-z]:$/i.test(v)) v += '\\';
      const kind = await api.exists(v);
      if (kind === 'dir') { stopEdit(); navigate(v); }
      else if (kind === 'file') { stopEdit(); const err = await api.open(v); if (err) toast(err, { error: true }); }
      else toast(`WormFiles can't find "${v}"`, { error: true });
    }
  });
  input.addEventListener('blur', () => setTimeout(stopEdit, 100));
  window._startAddressEdit = startEdit;

  // dropping onto breadcrumbs moves files there
  setupDropTarget($('#crumbs'), (e) => {
    const c = e.target.closest('.crumb');
    if (!c || c.dataset.path === THIS_PC) return null;
    return { path: c.dataset.path, el: c };
  });
}

// ---------- Keyboard ----------
let typeBuf = '', typeTimer = null;
function moveSelection(dir, extend) {
  const t = tab();
  const vis = t.visible;
  if (!vis.length) return;
  const els = $$('#items .item');
  const curPath = t.anchor && t.selection.has(t.anchor) ? t.anchor : [...t.selection].pop();
  let curEl = els.find(el => el._entry.path === curPath);
  let next;
  if (!curEl) next = els[0];
  else if (dir === 'left' || dir === 'right' || S.view === 'list') {
    const order = els;
    const i = order.indexOf(curEl);
    const step = (dir === 'left' || dir === 'up') ? -1 : 1;
    next = order[Math.max(0, Math.min(order.length - 1, i + step))];
  } else {
    const cr = curEl.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    let best = null, bestRow = null, bestDx = Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const isCandidate = dir === 'down' ? r.top > cr.top + 2 : r.top < cr.top - 2;
      if (!isCandidate) continue;
      if (bestRow === null || (dir === 'down' ? r.top < bestRow - 2 : r.top > bestRow + 2)) { bestRow = r.top; best = null; bestDx = Infinity; }
      if (Math.abs(r.top - bestRow) <= 2) {
        const dx = Math.abs(r.left + r.width / 2 - cx);
        if (dx < bestDx) { bestDx = dx; best = el; }
      }
    }
    next = best || curEl;
  }
  if (!next) return;
  const p = next._entry.path;
  if (extend && t.anchor) {
    const a = vis.findIndex(x => x.path === t.anchor), b = vis.indexOf(next._entry);
    setSelection(vis.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.path));
  } else setSelection([p], p);
  scrollIntoViewIfNeeded(next);
}

function setupKeys() {
  document.addEventListener('keydown', (e) => {
    if (QL.open) { handleQLKey(e); return; }
    if (!$('#spacemap').classList.contains('hidden')) { if (e.key === 'Escape') closeSpaceMap(); return; }
    const inField = e.target.matches('input, textarea, select');
    const modalOpen = !$('#modal-wrap').classList.contains('hidden');
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    if (k === 'Escape') {
      hideMenus();
      if (modalOpen) { closeModal(); return; }
      if (isWebTab()) { if (WebState.findOpen) closeFind(); else if (tab().loading) api.web.stop(tab().id); return; }
      if (!inField) { if (tab().query) clearSearch(); else setSelection([]); }
      return;
    }
    if (modalOpen) return;

    // global shortcuts (work even in inputs)
    if (ctrl && e.shiftKey && k.toLowerCase() === 't') { e.preventDefault(); newWebTab(); return; }
    if (ctrl && k.toLowerCase() === 't') { e.preventDefault(); newTab(isWebTab() ? THIS_PC : tab().path); return; }
    if (ctrl && k.toLowerCase() === 'w') { e.preventDefault(); closeCurrentTab(); return; }
    if (ctrl && k === '\\') { e.preventDefault(); toggleSplit(); return; }
    if (ctrl && k === 'Tab') { e.preventDefault(); activateTab((activeIdx + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length); return; }
    if (ctrl && k === ',') { e.preventDefault(); openSettings(); return; }
    if (isWebTab()) {
      if (ctrl && k.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
      else if ((ctrl && k.toLowerCase() === 'l') || (e.altKey && k.toLowerCase() === 'd')) { e.preventDefault(); window._startAddressEdit(); }
      else if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); toggleBookmark(); }
      else if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); webBack(); }
      else if (e.altKey && k === 'ArrowRight') { e.preventDefault(); webForward(); }
      else if (k === 'F5' || (ctrl && k.toLowerCase() === 'r')) { e.preventDefault(); webReloadOrStop(); }
      return;
    }
    if (ctrl && k.toLowerCase() === 'f') { e.preventDefault(); $('#search-input').focus(); $('#search-input').select(); return; }
    if ((ctrl && k.toLowerCase() === 'l') || (e.altKey && k.toLowerCase() === 'd')) { e.preventDefault(); window._startAddressEdit(); return; }
    if (ctrl && k === ',') { e.preventDefault(); openSettings(); return; }
    if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
    if (e.altKey && k === 'ArrowRight') { e.preventDefault(); goForward(); return; }
    if (e.altKey && k === 'ArrowUp') { e.preventDefault(); goUp(); return; }
    if (e.altKey && /^[0-9]$/.test(k)) { e.preventDefault(); const c = CAT_TABS[+k]; if (c) setCategory(c[0]); return; }
    if (e.altKey && k.toLowerCase() === 'p') { e.preventDefault(); togglePreview(); return; }
    if (k === 'F5') { e.preventDefault(); load(tab()); return; }
    if (inField) return;

    const t = tab();
    const sel = selectedEntries();
    if (ctrl && k === '1') { e.preventDefault(); setView('grid'); }
    else if (ctrl && k === '2') { e.preventDefault(); setView('list'); }
    else if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); setSelection(t.visible.map(x => x.path)); }
    else if (ctrl && e.shiftKey && k.toLowerCase() === 'c') { e.preventDefault(); if (sel.length) { api.copyText(sel.map(x => x.path).join('\r\n')); toast('Path copied'); } }
    else if (ctrl && k.toLowerCase() === 'c') { e.preventDefault(); copySel('copy'); }
    else if (ctrl && k.toLowerCase() === 'x') { e.preventDefault(); copySel('move'); }
    else if (ctrl && k.toLowerCase() === 'v') { e.preventDefault(); doPaste(); }
    else if (ctrl && e.shiftKey && k.toLowerCase() === 'n') { e.preventDefault(); newFolder(); }
    else if (k === 'F2') { e.preventDefault(); if (sel.length === 1) startRename(sel[0]); }
    else if (k === 'Delete') { e.preventDefault(); trashSel(); }
    else if (e.altKey && k === 'Enter') { e.preventDefault(); if (sel[0]) api.properties(sel[0].path); }
    else if (k === 'Enter') { e.preventDefault(); if (sel.length === 1 && sel[0].isDir) openEntry(sel[0]); else sel.slice(0, 15).forEach(x => openEntry(x)); }
    else if (k === 'Backspace') { e.preventDefault(); goBack(); }
    else if (k === ' ' && !ctrl && !e.altKey) { e.preventDefault(); quickLookOpen(); }
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      e.preventDefault();
      moveSelection(k.replace('Arrow', '').toLowerCase(), e.shiftKey);
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      const it = k === 'Home' ? t.visible[0] : t.visible[t.visible.length - 1];
      if (it) { setSelection([it.path], it.path); scrollIntoViewIfNeeded(itemElFor(it.path)); }
    } else if (k.length === 1 && !ctrl && !e.altKey && /\S/.test(k)) {
      // type-to-find
      typeBuf += k.toLowerCase();
      clearTimeout(typeTimer); typeTimer = setTimeout(() => { typeBuf = ''; }, 800);
      const hit = t.visible.find(x => x.name.toLowerCase().startsWith(typeBuf));
      if (hit) { setSelection([hit.path], hit.path); scrollIntoViewIfNeeded(itemElFor(hit.path)); }
    }
  });

  // mouse back/forward buttons
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) { e.preventDefault(); isWebTab() ? webBack() : goBack(); }
    if (e.button === 4) { e.preventDefault(); isWebTab() ? webForward() : goForward(); }
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu')) hideMenus(); });
  window.addEventListener('blur', hideMenus);
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('#content, #sidebar, #tabs, #address')) e.preventDefault(); });
}

function setCategory(cat) {
  const t = tab();
  t.cat = cat;
  renderCats();
  if (t.deep) runDeep(t);
  else { t.selection.clear(); renderItems(); renderStatus(); renderPreview(); }
}

function togglePreview() {
  setS({ showPreview: !S.showPreview });
  renderAll();
}

// ---------- Wire up ----------
async function init() {
  INFO = await api.init();
  S = INFO.settings;
  hydrateIcons();
  applyAppearance();

  setupTabEvents();
  setupSearch();
  setupAddress();
  setupContentEvents();
  setupKeys();
  setupWeb();
  setupExtras();
  setupUpdatesUI();

  $('#btn-back').onclick = () => isWebTab() ? webBack() : goBack();
  $('#btn-ql').onclick = quickLookOpen;
  $('#btn-fwd').onclick = () => isWebTab() ? webForward() : goForward();
  $('#btn-up').onclick = goUp;
  $('#btn-refresh').onclick = () => { if (isWebTab()) return webReloadOrStop(); refreshDrives(); load(tab()); };
  $('#btn-settings').onclick = () => openSettings();
  $('#btn-preview').onclick = togglePreview;
  $$('.view-toggle .icon-btn').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#zoom').oninput = (e) => { setS({ iconSize: +e.target.value }); if (S.view !== 'grid') setView('grid'); applyAppearance(); renderItems({ keepScroll: true }); };
  $('#sort-btn').onclick = (e) => { e.stopPropagation(); const r = $('#sort-btn').getBoundingClientRect(); showMenu(r.left, r.bottom + 4, sortMenu()); };
  $('#cats').onclick = (e) => { const c = e.target.closest('[data-cat]'); if (c) setCategory(c.dataset.cat); };
  $('#pin-add').onclick = async (e) => { e.stopPropagation(); const p = await api.pickFolder(); if (p) pinFolder(p); };
  $('#modal-wrap').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-wrap') closeModal(); });

  // sidebar
  const side = $('#sidebar');
  side.addEventListener('click', (e) => { const it = e.target.closest('.side-item'); if (it) navigate(it.dataset.path); });
  side.addEventListener('auxclick', (e) => { const it = e.target.closest('.side-item'); if (it && e.button === 1) newTab(it.dataset.path, false); });
  side.addEventListener('contextmenu', (e) => { const it = e.target.closest('.side-item'); if (!it) return; e.preventDefault(); showMenu(e.clientX, e.clientY, folderMenu(it.dataset.path)); });
  setupDropTarget(side, (e) => {
    const it = e.target.closest('.side-item');
    if (!it || it.dataset.path === THIS_PC) return null;
    return { path: it.dataset.path, el: it };
  });

  api.onWatch((dir) => {
    const t = tab();
    if (t.kind !== 'web' && samePath(dir, t.path) && !t.deep && !$('.rename-input')) load(t, { silent: true });
  });
  setInterval(refreshDrives, 30000);

  await refreshDrives();

  const restore = S.restoreTabs && Array.isArray(S.lastTabs) && S.lastTabs.length ? S.lastTabs : [THIS_PC];
  tabs = restore.map(p => typeof p === 'string' && p.startsWith('web:') ? makeWebTab(p.slice(4)) : makeTab(p));
  activeIdx = Math.min(S.lastActive || 0, tabs.length - 1);
  renderTabs();
  // Folders, files or links WormFiles was launched with (e.g. a folder opened from the desktop)
  const launch = await api.takeTargets().catch(() => []);
  if (launch.length) { activeIdx = tabs.length - 1; openTargets(launch); }
  else activateTab(activeIdx);
  api.onOpen(openTargets);
  if (!isWebTab()) $('#content').focus();
}

function openTargets(list) {
  for (const t of list) {
    if (t.kind === 'thispc') { newTab(THIS_PC); continue; }
    if (t.kind === 'url') { newWebTab(t.target); continue; }
    if (t.kind === 'folder') {
      const i = tabs.findIndex(x => x.kind !== 'web' && samePath(x.path, t.target));
      if (i >= 0) activateTab(i); else newTab(t.target);
      continue;
    }
    const ext = (t.target.split('.').pop() || '').toLowerCase();
    if (['html', 'htm', 'xhtml', 'pdf', 'svg'].includes(ext)) newWebTab(fileToUrl(t.target)); // files Worm is registered for
    else showFileInFolderTab(t.target);
  }
}

init().catch(err => {
  document.body.innerHTML = `<pre style="padding:20px;color:#f66;white-space:pre-wrap">WormFiles failed to start:\n${esc(err.stack || err)}</pre>`;
});
