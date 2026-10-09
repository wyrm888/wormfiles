'use strict';
/* WormFiles — Mail button, spacebar preview, archives, disk space map and split view.
   Loaded before app.js; uses app.js/web.js globals (tabs, tab(), api, …) at call time. */

// =====================================================================
// Archives (read-only folders)
// =====================================================================
const ARCHIVE_RE = /\.(zip|7z|rar|tar|tgz|gz|bz2|tbz2|xz|txz|cab|iso)(?=[\\/]|$)/i;
const READONLY_MSG = "Files inside an archive can't be changed. Copy them out first.";
function isReadonlyPath(p) { return !!p && p !== THIS_PC && !p.startsWith('about:') && ARCHIVE_RE.test(p); }
function archiveRootOf(p) {
  const m = /^(.*?\.(zip|7z|rar|tar|tgz|gz|bz2|tbz2|xz|txz|cab|iso))(?=[\\/]|$)/i.exec(p || '');
  return m ? m[1] : null;
}
async function extractArchive(path, where) {
  setProgress(`Extracting ${baseName(path)}…`);
  try {
    const dest = await api.archiveExtract(path, where);
    setProgress(null);
    const t = tab();
    if (!isWebTab()) await load(t, { silent: true });
    if (where !== 'here' && !isWebTab()) setSelection([dest], dest);
    toast(where === 'here' ? `Extracted ${baseName(path)} here` : `Extracted to "${baseName(dest)}"`,
      where === 'here' ? {} : { action: { label: 'Open', fn: () => navigate(dest) } });
  } catch (err) {
    setProgress(null);
    toast(cleanErr(err), { error: true });
  }
}
function cleanErr(err) { return String(err && err.message || err).replace(/^Error invoking remote method[^:]*: (Error: )?/, ''); }

// =====================================================================
// Proton Mail button
// =====================================================================
const MAIL_DEFAULT = 'https://mail.proton.me/u/0/inbox';
let mailTab = null;
let mailActive = false;
let mailReturnIdx = 0;

function findTab(id) { return tabs.find(x => x.id === id) || (mailTab && mailTab.id === id ? mailTab : null); }

function ensureMailTab() {
  if (!mailTab) {
    mailTab = makeWebTab(S.mailUrl || MAIL_DEFAULT);
    mailTab.isMail = true;
    mailTab.unread = 0;
  }
  return mailTab;
}
function openMail() {
  if (mailActive) { activateTab(Math.min(mailReturnIdx, tabs.length - 1)); return; } // click again = go back
  const t = ensureMailTab();
  const prev = tab();
  if (prev && prev.kind !== 'web') prev.scroll = $('#content').scrollTop;
  if (WebState.findOpen) closeFind();
  hideSuggestions();
  if (QL.open) quickLookClose();
  mailReturnIdx = activeIdx;
  mailActive = true;
  document.body.classList.add('web-mode');
  applySplitLayout();
  renderTabs();
  api.watch(null);
  webActivate(t);
}
function closeCurrentTab() {
  if (mailActive) { activateTab(Math.min(mailReturnIdx, tabs.length - 1)); return; }
  closeTab(activeIdx);
}
function renderMailButton() {
  const b = $('#mail-btn');
  if (!b) return;
  b.classList.toggle('hidden', !S.mailButton);
  b.classList.toggle('active', mailActive);
  const n = mailTab ? mailTab.unread : 0;
  const badge = b.querySelector('.mail-badge');
  badge.textContent = n > 99 ? '99+' : n || '';
  b.title = mailTab && mailTab.loading && !mailTab.unread ? 'Proton Mail (loading…)' : n ? `Proton Mail — ${n} unread` : 'Proton Mail';
}
function mailTitleChanged(t) {
  const m = /\((\d+)\)/.exec(t.title || '');
  t.unread = m ? +m[1] : 0;
  renderMailButton();
}
function startMailInBackground() {
  if (!S.mailButton || !S.mailBackground) return;
  setTimeout(() => {
    const t = ensureMailTab();
    if (!t.created) { api.web.create(t.id, t.url, { background: true }); t.created = true; t.loading = true; }
  }, 2500);
}

// =====================================================================
// Spacebar preview (Quick Look)
// =====================================================================
const QL = { open: false, entry: null, token: 0 };
const QL_IMG = new Set(['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico']);
const QL_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv']);
const QL_AUDIO = new Set(['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus']);
const QL_TEXT = new Set([...TEXT_EXT_LIST(), 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb',
  'php', 'html', 'htm', 'css', 'scss', 'lua', 'luau', 'kt', 'swift', 'sql', 'vue', 'svelte', 'dart', 'r', 'gd', 'gitignore', 'env', 'properties', 'mcmeta', 'nfo']);
function TEXT_EXT_LIST() { return ['txt', 'md', 'log', 'csv', 'json', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'toml', 'bat', 'cmd', 'ps1', 'sh']; }

function quickLookOpen() {
  if (isWebTab()) return;
  const t = tab();
  let e = selectedEntries()[0];
  if (!e) {
    e = (t.visible || [])[0];
    if (!e) return;
    setSelection([e.path], e.path);
  }
  QL.open = true;
  $('#ql').classList.remove('hidden');
  renderQL(e);
}
function quickLookClose() {
  QL.open = false;
  QL.token++;
  const el = $('#ql');
  el.classList.add('hidden');
  el.querySelector('.ql-body').innerHTML = ''; // stops any playing media
}
function qlMove(step) {
  const vis = tab().visible || [];
  let i = vis.findIndex(x => x.path === QL.entry?.path);
  const e = vis[Math.max(0, Math.min(vis.length - 1, i + step))];
  if (!e || e === QL.entry) return;
  setSelection([e.path], e.path);
  scrollIntoViewIfNeeded(itemElFor(e.path));
  renderQL(e);
}
async function realPathFor(e) { return e.inArchive ? api.archiveTemp(e.path) : e.path; }

async function renderQL(e) {
  QL.entry = e;
  const token = ++QL.token;
  const root = $('#ql');
  const vis = tab().visible || [];
  const idx = vis.findIndex(x => x.path === e.path);
  root.querySelector('.ql-title').textContent = e.name;
  root.querySelector('.ql-sub').textContent = e.isDir ? 'Folder' : `${typeLabel(e)} · ${fmtSize(e.size)}${e.mtime ? ' · ' + fmtDate(e.mtime) : ''}`;
  root.querySelector('.ql-count').textContent = vis.length > 1 && idx >= 0 ? `${idx + 1} of ${vis.length}` : '';
  const body = root.querySelector('.ql-body');
  body.className = 'ql-body';
  body.innerHTML = '<div class="ql-center"><span class="spinner"></span></div>';
  let html = '';
  let kind = 'other';
  try {
    if (e.isDir || (e.isArchive && !e.inArchive)) {
      kind = 'list';
      const items = await api.list(e.path).catch((err) => { throw err; });
      const shown = items.filter(x => S.showHidden || !x.hidden)
        .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : collator.compare(a.name, b.name)));
      html = `<div class="ql-list-head">${shown.length} item${shown.length === 1 ? '' : 's'}${e.isArchive ? ' inside this archive' : ''}</div>
        <div class="ql-list">${shown.slice(0, 300).map(x => `<div class="ql-row">${x.isDir ? icon('folder') : icon(catIcon(x.cat))}<span>${esc(x.name)}</span><span class="dim">${x.isDir ? '' : fmtSize(x.size)}</span></div>`).join('')}
        ${shown.length > 300 ? `<div class="ql-row dim">…and ${shown.length - 300} more</div>` : ''}</div>`;
    } else if (QL_IMG.has(e.ext)) {
      kind = 'media';
      html = `<img class="ql-img" src="${esc(fileUrl(await realPathFor(e)))}" alt="">`;
    } else if (QL_VIDEO.has(e.ext)) {
      kind = 'media';
      html = `<video class="ql-video" src="${esc(fileUrl(await realPathFor(e)))}" controls autoplay></video>`;
    } else if (QL_AUDIO.has(e.ext)) {
      kind = 'audio';
      html = `<div class="ql-center">${icon('music', 'ql-bigicon')}<audio src="${esc(fileUrl(await realPathFor(e)))}" controls autoplay></audio></div>`;
    } else if (e.ext === 'pdf') {
      kind = 'pdf';
      html = `<iframe class="ql-pdf" src="${esc(fileUrl(await realPathFor(e)))}#toolbar=1"></iframe>`;
    } else if (QL_TEXT.has(e.ext) || (!e.ext && e.size < 512 * 1024)) {
      kind = 'text';
      const txt = await api.readText(e.path, 256 * 1024);
      if (txt == null) throw new Error('binary');
      html = `<pre class="ql-text">${esc(txt)}${e.size > 256 * 1024 ? '\n\n… (showing the first 256 KB)' : ''}</pre>`;
    } else throw new Error('no preview');
  } catch {
    kind = 'other';
    let pic = await api.thumb(e.path, 768).catch(() => null);
    if (!pic && !e.inArchive) pic = await api.icon(e.path, false).catch(() => null);
    html = `<div class="ql-center">${pic ? `<img class="${pic.length < 20000 ? 'ql-icon' : 'ql-img'}" src="${pic}" alt="">` : icon(catIcon(e.cat), 'ql-bigicon')}
      <div class="dim">No preview for this kind of file — press Enter to open it.</div></div>`;
  }
  if (token !== QL.token) return;
  body.classList.add('qlk-' + kind);
  body.innerHTML = html;
  const img = body.querySelector('img.ql-img');
  if (img) img.onload = () => { if (token === QL.token) root.querySelector('.ql-sub').textContent += ` · ${img.naturalWidth} × ${img.naturalHeight}`; };
}

function handleQLKey(e) {
  const k = e.key;
  if (k === ' ' || k === 'Escape') { e.preventDefault(); quickLookClose(); return; }
  if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); qlMove(1); return; }
  if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); qlMove(-1); return; }
  if (k === 'Enter') { e.preventDefault(); const en = QL.entry; quickLookClose(); if (en) openEntry(en); return; }
}

// =====================================================================
// Disk space map
// =====================================================================
const SM = { id: 0, root: null, done: false, view: null, scanning: false };
const SM_COLORS = {
  images: '#3fb6ff', videos: '#ff5c8a', audio: '#b678ff', documents: '#ffc53d', archives: '#ff8a3d',
  code: '#3ddc97', apps: '#7a8cff', other: '#8b93a7', folders: '#8b93a7'
};

function openSpaceMap(root) {
  if (!root || root === THIS_PC || isReadonlyPath(root)) return;
  hideMenus();
  $('#spacemap').classList.remove('hidden');
  if (SM.done && samePath(SM.root, root)) { smShow(root); return; }
  smScan(root);
}
function closeSpaceMap() {
  if (SM.scanning) api.spaceCancel(SM.id);
  SM.scanning = false;
  $('#spacemap').classList.add('hidden');
}
async function smScan(root) {
  const id = ++SM.id;
  SM.root = root; SM.done = false; SM.scanning = true; SM.view = null;
  const el = $('#spacemap');
  el.querySelector('.sm-title').textContent = `Disk space — ${baseName(root)}`;
  el.querySelector('.sm-crumbs').innerHTML = '';
  el.querySelector('.sm-total').textContent = '';
  el.querySelector('.sm-map').innerHTML = `<div class="ql-center"><span class="spinner"></span>
    <b>Measuring ${esc(baseName(root))}…</b><span class="dim" id="sm-progress">Starting</span>
    <button class="btn" id="sm-stop">Stop</button></div>`;
  $('#sm-stop').onclick = () => api.spaceCancel(id);
  const r = await api.spaceScan(id, root).catch((err) => ({ error: cleanErr(err) }));
  if (id !== SM.id) return;
  SM.scanning = false;
  SM.done = !r.error;
  if (r.error) { el.querySelector('.sm-map').innerHTML = `<div class="ql-center">${icon('info', 'ql-bigicon')}<b>Couldn't measure this folder</b><span class="dim">${esc(r.error)}</span></div>`; return; }
  smShow(root, r.cancelled);
}

async function smShow(p, partial = false) {
  const v = await api.spaceView(p);
  if (!v) return;
  SM.view = v;
  const el = $('#spacemap');
  // breadcrumbs from the scanned folder down to here
  const crumbs = [];
  let cur = v.path;
  while (cur && cur.length >= v.root.length) {
    crumbs.unshift(cur);
    if (samePath(cur, v.root)) break;
    cur = parentOf(cur);
  }
  el.querySelector('.sm-title').textContent = 'Disk space';
  el.querySelector('.sm-crumbs').innerHTML = crumbs.map((c, i) =>
    `${i ? `<span class="crumb-sep">${icon('right')}</span>` : ''}<span class="crumb" data-sm="${esc(c)}">${esc(baseName(c))}</span>`).join('');
  el.querySelector('.sm-total').textContent = `${fmtSize(v.size)} · ${v.files.toLocaleString()} files${partial ? ' · scan stopped early' : ''}`;
  el.querySelector('#sm-up').disabled = samePath(v.path, v.root);
  smDraw();
}

function squarify(items, rect) {
  const total = items.reduce((a, b) => a + b.size, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const area = rect.w * rect.h;
  const nodes = items.map(it => ({ it, a: it.size / total * area }));
  const out = [];
  let r = { ...rect };
  let row = [];
  const worst = (rw, side) => {
    const s = rw.reduce((a, n) => a + n.a, 0);
    let max = 0, min = Infinity;
    for (const n of rw) { if (n.a > max) max = n.a; if (n.a < min) min = n.a; }
    return Math.max(side * side * max / (s * s), (s * s) / (side * side * min));
  };
  const place = (rw) => {
    const s = rw.reduce((a, n) => a + n.a, 0);
    if (r.w >= r.h) {
      const cw = s / r.h; let y = r.y;
      for (const n of rw) { const h = n.a / cw; out.push({ it: n.it, x: r.x, y, w: cw, h }); y += h; }
      r = { x: r.x + cw, y: r.y, w: r.w - cw, h: r.h };
    } else {
      const rh = s / r.w; let x = r.x;
      for (const n of rw) { const w = n.a / rh; out.push({ it: n.it, x, y: r.y, w, h: rh }); x += w; }
      r = { x: r.x, y: r.y + rh, w: r.w, h: r.h - rh };
    }
  };
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(r.w, r.h);
    if (!row.length || worst([...row, nodes[i]], side) <= worst(row, side)) { row.push(nodes[i]); i++; }
    else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
}

function smBlock(it, x, y, w, h, depth, total) {
  const pct = total ? (it.size / total * 100) : 0;
  const tip = `${it.name}\n${fmtSize(it.size)} · ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%${it.isDir ? `\n${(it.files || 0).toLocaleString()} files — click to look inside` : ''}`;
  const style = `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${Math.max(0, w - 2).toFixed(1)}px;height:${Math.max(0, h - 2).toFixed(1)}px`;
  const label = w > 54 && h > 26 ? `<span class="sm-label"><b>${esc(it.name)}</b> ${fmtSize(it.size)}</span>` : '';
  if (it.isDir) {
    let inner = '';
    if (depth === 0 && it.children && it.children.length && w > 90 && h > 64) {
      const rects = squarify(it.children.filter(c => c.size > 0), { x: 3, y: 22, w: w - 8, h: h - 27 });
      inner = rects.filter(r => r.w * r.h > 24).map(r => smBlock(r.it, r.x, r.y, r.w, r.h, depth + 1, total)).join('');
    }
    return `<div class="sm-block sm-dir d${depth}" style="${style}" data-path="${esc(it.path)}" data-dir="1" title="${esc(tip)}">${label}${inner}</div>`;
  }
  const color = SM_COLORS[it.cat] || SM_COLORS.other;
  return `<div class="sm-block sm-file${it.isRest ? ' rest' : ''}" style="${style};--c:${color}" ${it.path ? `data-path="${esc(it.path)}"` : ''} title="${esc(tip)}">${label}</div>`;
}

function smDraw() {
  const v = SM.view;
  const map = $('#spacemap .sm-map');
  if (!v || !map) return;
  const w = map.clientWidth, h = map.clientHeight;
  const items = v.items.filter(i => i.size > 0);
  if (!items.length) { map.innerHTML = `<div class="ql-center dim">This folder is empty.</div>`; return; }
  const rects = squarify(items, { x: 0, y: 0, w, h });
  map.innerHTML = rects.filter(r => r.w * r.h > 12).map(r => smBlock(r.it, r.x, r.y, r.w, r.h, 0, v.size)).join('');
}

function setupSpaceMap() {
  const el = $('#spacemap');
  el.querySelector('#sm-close').onclick = closeSpaceMap;
  el.querySelector('#sm-up').onclick = () => { const v = SM.view; if (v && !samePath(v.path, v.root)) smShow(parentOf(v.path)); };
  el.querySelector('#sm-rescan').onclick = () => { if (SM.root) smScan(SM.view ? SM.view.path : SM.root); };
  el.querySelector('.sm-crumbs').onclick = (e) => { const c = e.target.closest('[data-sm]'); if (c) smShow(c.dataset.sm); };
  const map = el.querySelector('.sm-map');
  map.addEventListener('click', (e) => {
    const b = e.target.closest('.sm-block[data-dir]');
    if (b) smShow(b.dataset.path);
  });
  map.addEventListener('dblclick', (e) => {
    const b = e.target.closest('.sm-file[data-path]');
    if (b) { closeSpaceMap(); showFileInFolderTab(b.dataset.path); }
  });
  map.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const b = e.target.closest('.sm-block[data-path]');
    if (!b) return;
    const p = b.dataset.path, dir = !!b.dataset.dir;
    showMenu(e.clientX, e.clientY, [
      dir && { label: 'Look inside', icon: 'map', action: () => smShow(p) },
      { label: dir ? 'Open folder in WormFiles' : 'Show in WormFiles', icon: 'folder', action: () => { closeSpaceMap(); dir ? newTab(p) : showFileInFolderTab(p); } },
      !dir && { label: 'Open', icon: 'open', action: () => api.open(p) },
      { label: 'Show in Windows Explorer', icon: 'folder', action: () => api.reveal(p) },
      { label: 'Copy path', icon: 'copy', action: () => { api.copyText(p); toast('Path copied'); } }
    ].filter(Boolean));
  });
  new ResizeObserver(() => { if (!el.classList.contains('hidden')) smDraw(); }).observe(map);
  el.querySelector('.sm-legend').innerHTML = [['folders', 'Folders'], ['images', 'Images'], ['videos', 'Videos'], ['audio', 'Music'], ['documents', 'Documents'],
    ['archives', 'Archives'], ['code', 'Code'], ['apps', 'Apps'], ['other', 'Other']]
    .map(([k, l]) => `<span><i style="background:${k === 'folders' ? 'rgb(var(--accent-rgb) / .45)' : SM_COLORS[k]}"></i>${l}</span>`).join('');
}

// =====================================================================
// Split view
// =====================================================================
let split = null; // { a: left tab id, b: right tab id }
let pane2Observer = null;

function splitPartner(t = tab()) {
  if (!split || !t || mailActive) return null;
  const other = t.id === split.a ? split.b : t.id === split.b ? split.a : null;
  return other == null ? null : (tabs.find(x => x.id === other) || null);
}
function inSplit() { return !!splitPartner(); }
function isPaired(t) { return !!split && (t.id === split.a || t.id === split.b); }

function toggleSplit() {
  if (inSplit()) { split = null; applySplitLayout(); renderTabs(); renderAll(); return; }
  const t = tab();
  if (isWebTab()) { toast('Split view works with folder tabs'); return; }
  const p = makeTab(t.path);
  tabs.splice(activeIdx + 1, 0, p);
  split = { a: t.id, b: p.id };
  renderTabs();
  applySplitLayout();
  load(p);
  saveTabs();
  renderAll();
}
function splitWith(i) {
  const t = tab(), o = tabs[i];
  if (!o || o === t || o.kind === 'web' || t.kind === 'web') return;
  tabs.splice(i, 1);
  tabs.splice(tabs.indexOf(t) + 1, 0, o);
  activeIdx = tabs.indexOf(t);
  split = { a: t.id, b: o.id };
  renderTabs();
  applySplitLayout();
  if (!o.entries.length && o.path !== THIS_PC) load(o); else renderPane2();
  saveTabs();
  renderAll();
}
function refreshPartner() { const p = splitPartner(); if (p) load(p, { silent: true }); }

function applySplitLayout() {
  const on = inSplit();
  document.body.classList.toggle('split', on);
  const p2 = $('#content2');
  const btn = $('#btn-split');
  if (btn) btn.classList.toggle('active', on);
  if (!on) {
    p2.classList.add('hidden');
    p2.innerHTML = '';
    $('#content').style.order = '';
    return;
  }
  const leftActive = tab().id === split.a;
  $('#content').style.order = leftActive ? 2 : 3;
  p2.style.order = leftActive ? 3 : 2;
  p2.classList.remove('hidden');
  renderPane2();
}

function renderPane2() {
  const p2 = $('#content2');
  const t2 = splitPartner();
  if (!t2 || !inSplit()) return;
  if (pane2Observer) pane2Observer.disconnect();
  const title = t2.path === THIS_PC ? 'This PC' : t2.path;
  let body = '';
  if (t2.path === THIS_PC) {
    body = `<div class="items2 pc">${drives.map(d => `<div class="drive-card" data-path="${esc(d.path)}">${icon('drive')}<div class="meta"><b>${d.letter === 'C' ? 'Local Disk' : 'Drive'} (${d.letter}:)</b></div></div>`).join('')}
      ${INFO.quick.filter(q => q.label !== 'Home').map(q => `<div class="drive-card" data-path="${esc(q.path)}">${icon(q.icon)}<div class="meta"><b>${esc(q.label)}</b></div></div>`).join('')}</div>`;
  } else {
    const vis = getVisible(t2);
    t2.visible = vis;
    body = `<div class="items2 ${S.view}">${vis.map((e, i) => itemHtml(e, i, false, t2)).join('')}</div>` +
      (!vis.length ? `<div class="pane2-empty">${esc(t2.loading ? 'Loading…' : t2.error || 'This folder is empty')}</div>` : '');
  }
  p2.innerHTML = `<div class="pane2-head" title="${esc(title)}">${icon(t2.path === THIS_PC ? 'desktop' : isReadonlyPath(t2.path) ? 'archive' : 'folder')}
    <span class="pane2-path">${esc(title)}</span><span class="dim">Click to use this side</span></div>${body}`;
  const box = p2.querySelector('.items2');
  if (!box || box.classList.contains('pc')) return;
  pane2Observer = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) { pane2Observer.unobserve(en.target); enqueueThumb(en.target); }
  }, { root: p2, rootMargin: '400px 0px' });
  box.querySelectorAll('.item').forEach(el => {
    const e = t2.visible[+el.dataset.i];
    el._entry = e;
    el.draggable = false;
    if (!e.isDir) pane2Observer.observe(el);
  });
}

function setupSplit() {
  const p2 = $('#content2');
  // Clicking the other side makes it the active side
  p2.addEventListener('mousedown', (e) => {
    const t2 = splitPartner();
    if (!t2) return;
    const el = e.target.closest('.item');
    const card = e.target.closest('.drive-card');
    activateTab(tabs.indexOf(t2));
    if (el) setSelection([el._entry.path], el._entry.path);
    if (card && e.button === 0) navigate(card.dataset.path);
    if (t2.path !== THIS_PC) load(t2, { silent: true });
  }, true);
  p2.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setTimeout(() => {
      const el = itemElFor(selectedEntries()[0]?.path || '');
      showMenu(e.clientX, e.clientY, el ? itemMenu() : backgroundMenu());
    }, 0);
  });
  setupDropTarget(p2, (e) => {
    const t2 = splitPartner();
    if (!t2 || t2.path === THIS_PC || isReadonlyPath(t2.path)) return null;
    const el = e.target.closest('.item');
    if (el && el._entry && el._entry.isDir) return { path: el._entry.path, el };
    return { path: t2.path, el: null };
  });
}

// =====================================================================
// Setup
// =====================================================================
function setupExtras() {
  hydrateIcons($('#mail-btn').parentElement);
  $('#mail-btn').onclick = openMail;
  $('#ql').addEventListener('mousedown', (e) => { if (e.target.id === 'ql') quickLookClose(); });
  $('#ql-close').onclick = quickLookClose;
  $('#ql-open').onclick = () => { const en = QL.entry; quickLookClose(); if (en) openEntry(en); };
  $('#ql-prev').onclick = () => qlMove(-1);
  $('#ql-next').onclick = () => qlMove(1);
  $('#btn-split').onclick = toggleSplit;
  setupSpaceMap();
  setupSplit();
  api.onSpaceProgress((d) => {
    if (d.id !== SM.id) return;
    const p = $('#sm-progress');
    if (p) p.textContent = `${d.files.toLocaleString()} files · ${fmtSize(d.bytes)}`;
  });
  renderMailButton();
  startMailInBackground();
}
