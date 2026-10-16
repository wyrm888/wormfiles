// =====================================================================
// Image tools: rotate, flip, resize, convert, strip location/camera info
// =====================================================================
const IMG_EDITABLE = new Set(['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'avif', 'ico']);
const IMG_KEEP_FORMAT = { png: 'png', jpg: 'jpg', jpeg: 'jpg', jfif: 'jpg', webp: 'webp' };
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const isEditableImage = (e) => !!e && !e.isDir && !e.inArchive && IMG_EDITABLE.has(e.ext);

async function loadBitmap(path) {
  const bytes = await api.readBytes(path);
  return createImageBitmap(new Blob([bytes]));
}

// Applies the edits in `o` to a decoded image and returns { blob, ext, width, height }
async function renderEdited(bmp, srcExt, o) {
  const turn = ((o.rot % 360) + 360) % 360;
  const sideways = turn === 90 || turn === 270;
  let w = bmp.width, h = bmp.height;
  let scale = 1;
  if (o.size === 'pct') scale = Math.min(1, o.pct / 100);
  else if (o.size === 'max') scale = Math.min(1, o.max / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
  const cw = sideways ? dh : dw, ch = sideways ? dw : dh;
  const ext = o.format === 'same' ? (IMG_KEEP_FORMAT[srcExt] || 'png') : o.format;
  const canvas = new OffscreenCanvas(cw, ch);
  const g = canvas.getContext('2d');
  if (ext === 'jpg') { g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); } // JPG has no transparency
  g.imageSmoothingQuality = 'high';
  g.translate(cw / 2, ch / 2);
  g.rotate(turn * Math.PI / 180);
  if (o.flip) g.scale(-1, 1);
  g.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
  const blob = await canvas.convertToBlob({ type: IMG_MIME[ext], quality: ext === 'png' ? undefined : o.quality });
  return { blob, ext, width: cw, height: ch };
}

function editSuffix(o) {
  const parts = [];
  if (o.rot % 360) parts.push('rotated');
  if (o.flip) parts.push('flipped');
  if (o.size === 'pct' && o.pct < 100) parts.push(o.pct + '%');
  if (o.size === 'max') parts.push(o.max + 'px');
  if (o.format !== 'same') parts.push(o.format);
  return parts.join(' ') || 'clean';
}

async function processImages(list, o, { quiet = false } = {}) {
  const id = 'img' + Date.now();
  const many = list.length > 2;
  let done = 0, failed = 0, last = null;
  for (const e of list) {
    if (many) jobCard(id, { title: `Editing ${list.length} images`, sub: `${done} of ${list.length} · ${e.name}`, pct: done / list.length * 100 });
    try {
      const bmp = await loadBitmap(e.path);
      const r = await renderEdited(bmp, e.ext, o);
      bmp.close();
      last = await api.saveImage({ source: e.path, ext: r.ext, data: await r.blob.arrayBuffer(), replace: o.replace, suffix: editSuffix(o) });
      done++;
    } catch (err) {
      failed++;
      console.error('image edit failed', e.path, err);
    }
  }
  if (many) jobDone(id);
  if (!quiet || failed) {
    toast(failed ? `Saved ${done} image${done === 1 ? '' : 's'} · ${failed} couldn't be opened` : `Saved ${done} image${done === 1 ? '' : 's'}${o.replace ? ' (originals are in the Recycle Bin)' : ''}`,
      { error: !!failed && !done, action: last && !o.replace && done === 1 ? { label: 'Show', fn: () => setSelection([last], last) } : null });
  }
  load(tab(), { silent: true }).then(() => { if (last && !o.replace && done === 1) { setSelection([last], last); scrollIntoViewIfNeeded(itemElFor(last)); } });
}

// One-click versions from the right-click menu (these change the file itself; the old one goes to the Recycle Bin)
function quickRotate(list, deg) { processImages(list, { rot: deg, flip: false, size: 'orig', format: 'same', quality: 0.95, replace: true }, { quiet: true }); }

async function openImageTools(list) {
  list = list.filter(isEditableImage);
  if (!list.length) return toast("These images can't be edited here", { error: true });
  const o = Object.assign({ rot: 0, flip: false, size: 'orig', pct: 50, max: 1920, format: 'same', quality: 0.9, replace: false }, S.imageToolLast || {}, { rot: 0, flip: false, replace: false });
  let bmp = null;
  try { bmp = await loadBitmap(list[0].path); } catch { return toast(`Couldn't open "${list[0].name}"`, { error: true }); }
  const body = document.createElement('div');
  body.className = 'imgtools';
  const gif = list.some(e => e.ext === 'gif');
  body.innerHTML = `<div class="it-preview"><canvas></canvas><div class="it-dims dim"></div></div>
    <div class="it-opts">
      <div class="field"><label>Turn</label><div class="row">
        <button class="btn" data-rot="-90">${icon('undo')}Left</button>
        <button class="btn" data-rot="90"><span style="transform:scaleX(-1);display:inline-flex">${icon('undo')}</span>Right</button>
        <button class="btn" id="it-flip">Mirror</button></div></div>
      <div class="field"><label>Size</label><div class="row it-size">
        <select id="it-size"><option value="orig">Keep size</option><option value="pct">Percent</option><option value="max">Longest side</option></select>
        <span class="it-pct"><input class="text-input" type="number" id="it-pct" min="1" max="100" value="${o.pct}"> %</span>
        <span class="it-max"><select id="it-max">${[3840, 2560, 1920, 1280, 1024, 800, 512, 256].map(v => `<option value="${v}" ${o.max === v ? 'selected' : ''}>${v} px</option>`).join('')}</select></span></div></div>
      <div class="field"><label>Format</label><div class="row">
        <select id="it-format"><option value="same">Keep format</option><option value="png">PNG (sharp, bigger)</option><option value="jpg">JPG (photos, small)</option><option value="webp">WEBP (smallest)</option></select>
        <span class="it-q">Quality <input type="range" id="it-q" min="0.4" max="1" step="0.05" value="${o.quality}"><span id="it-qv"></span></span></div></div>
      <div class="field"><label>Save</label><div class="row">
        <select id="it-save"><option value="new">As a new file next to it</option><option value="replace">Replace the original (old one goes to Recycle Bin)</option></select></div></div>
      <p class="tip">${icon('shield')} Location, camera and other hidden info is always removed from the saved image.${gif ? ' GIFs are saved as a still picture.' : ''}</p>
    </div>`;
  const cv = body.querySelector('canvas'), dims = body.querySelector('.it-dims');
  const sel = (id) => body.querySelector(id);
  sel('#it-size').value = o.size; sel('#it-format').value = o.format; sel('#it-save').value = 'new';
  let drawT = 0;
  const redraw = () => {
    clearTimeout(drawT);
    sel('.it-pct').style.display = o.size === 'pct' ? '' : 'none';
    sel('.it-max').style.display = o.size === 'max' ? '' : 'none';
    const fmt = o.format === 'same' ? (IMG_KEEP_FORMAT[list[0].ext] || 'png') : o.format;
    sel('.it-q').style.display = fmt === 'png' ? 'none' : '';
    sel('#it-qv').textContent = Math.round(o.quality * 100) + '%';
    drawT = setTimeout(async () => {
      const r = await renderEdited(bmp, list[0].ext, o);
      const prev = await createImageBitmap(r.blob);
      const box = 300, s = Math.min(1, box / Math.max(prev.width, prev.height));
      cv.width = Math.max(1, Math.round(prev.width * s)); cv.height = Math.max(1, Math.round(prev.height * s));
      cv.getContext('2d').drawImage(prev, 0, 0, cv.width, cv.height);
      prev.close();
      dims.textContent = `${bmp.width}×${bmp.height} → ${r.width}×${r.height} · ${r.ext.toUpperCase()} · about ${fmtSize(r.blob.size)}${list.length > 1 ? ` · ${list.length} images` : ''}`;
    }, 60);
  };
  body.querySelectorAll('[data-rot]').forEach(b => b.onclick = () => { o.rot += +b.dataset.rot; redraw(); });
  sel('#it-flip').onclick = () => { o.flip = !o.flip; sel('#it-flip').classList.toggle('primary', o.flip); redraw(); };
  sel('#it-size').onchange = (e) => { o.size = e.target.value; redraw(); };
  sel('#it-pct').oninput = (e) => { o.pct = Math.max(1, Math.min(100, +e.target.value || 50)); redraw(); };
  sel('#it-max').onchange = (e) => { o.max = +e.target.value; redraw(); };
  sel('#it-format').onchange = (e) => { o.format = e.target.value; redraw(); };
  sel('#it-q').oninput = (e) => { o.quality = +e.target.value; redraw(); };
  sel('#it-save').onchange = (e) => { o.replace = e.target.value === 'replace'; };
  redraw();
  openModal({
    title: list.length > 1 ? `Edit ${list.length} images` : 'Edit image', body, wide: true,
    onClose: () => { try { bmp.close(); } catch { /* closed */ } },
    buttons: [{ label: 'Cancel' }, {
      label: list.length > 1 ? `Save ${list.length} images` : 'Save', primary: true, action: () => {
        setS({ imageToolLast: { size: o.size, pct: o.pct, max: o.max, format: o.format, quality: o.quality } });
        processImages(list, { ...o });
      }
    }]
  });
}

// =====================================================================
// Duplicate finder: same content, not just same name
// =====================================================================
let dupSeq = 0;
async function openDuplicateFinder(root) {
  const id = ++dupSeq;
  const body = document.createElement('div');
  body.className = 'dups';
  body.innerHTML = `<div class="dup-status"><span class="spinner"></span> <span class="dup-text">Looking through “${esc(baseName(root))}”…</span></div><div class="dup-list"></div>`;
  let finished = false;
  openModal({
    title: 'Duplicate files', body, wide: true,
    onClose: () => { if (!finished) api.dupCancel(id); },
    buttons: [{ label: 'Close' }, { label: 'Move selected to Recycle Bin', danger: true, action: () => trashPicked() }]
  });
  const foot = $('#modal .modal-foot');
  const trashBtn = foot && foot.lastElementChild;
  if (trashBtn) trashBtn.disabled = true;
  const off = (d) => {
    if (d.id !== id) return;
    const t = body.querySelector('.dup-text');
    if (t) t.textContent = d.stage === 'hash'
      ? `Comparing ${d.done.toLocaleString()} of ${d.total.toLocaleString()} possible matches…`
      : `Looking through files… ${d.files.toLocaleString()} checked`;
  };
  DUP_LISTENERS.add(off);
  const r = await api.dupScan(id, root, { includeHidden: !!S.showHidden });
  DUP_LISTENERS.delete(off);
  finished = true;
  if (!body.isConnected) return;
  if (r.cancelled) return;
  if (r.error) { body.innerHTML = `<p class="tip">${esc(r.error)}</p>`; return; }
  const groups = r.groups;
  const status = body.querySelector('.dup-status');
  if (!groups.length) {
    status.innerHTML = `${icon('check')} No duplicates in ${r.files.toLocaleString()} files.`;
    return;
  }
  const wasted = groups.reduce((a, g) => a + g.size * (g.files.length - 1), 0);
  status.innerHTML = `<b>${groups.length.toLocaleString()} sets of duplicates</b> · ${fmtSize(wasted)} could be freed
    <span class="dup-pick">Pick extras: <select id="dup-keep"><option value="newest">keep the newest</option><option value="oldest">keep the oldest</option><option value="shortest">keep the shortest path</option><option value="none">pick none</option></select></span>`;
  const list = body.querySelector('.dup-list');
  const picked = new Set();
  const pick = (mode) => {
    picked.clear();
    if (mode !== 'none') for (const g of groups) {
      const keep = [...g.files].sort((a, b) => mode === 'newest' ? b.mtime - a.mtime : mode === 'oldest' ? a.mtime - b.mtime : a.path.length - b.path.length)[0];
      for (const f of g.files) if (f !== keep) picked.add(f.path);
    }
    paint();
  };
  const paint = () => {
    list.innerHTML = groups.slice(0, 500).map((g, gi) => `<div class="dup-group">
      <div class="dup-head">${icon(catIcon(g.files[0].cat))}<b>${esc(g.files[0].name)}</b><span class="dim">${g.files.length} copies · ${fmtSize(g.size)} each</span></div>
      ${g.files.map((f, fi) => `<label class="dup-row ${picked.has(f.path) ? 'picked' : ''}">
        <input type="checkbox" data-g="${gi}" data-f="${fi}" ${picked.has(f.path) ? 'checked' : ''}>
        <span class="dup-path" title="${esc(f.path)}">${esc(f.path)}</span>
        <span class="dim dup-date">${fmtDate(f.mtime)}</span>
        <button class="icon-btn small" data-show="${esc(f.path)}" title="Show in folder">${icon('folder')}</button></label>`).join('')}
    </div>`).join('') + (groups.length > 500 ? `<p class="tip">Showing the biggest 500 sets.</p>` : '');
    const n = picked.size;
    let bytes = 0;
    for (const g of groups) for (const f of g.files) if (picked.has(f.path)) bytes += g.size;
    if (trashBtn) { trashBtn.disabled = !n; trashBtn.textContent = n ? `Move ${n} to Recycle Bin (${fmtSize(bytes)})` : 'Move selected to Recycle Bin'; }
  };
  list.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    const g = groups[+cb.dataset.g], f = g.files[+cb.dataset.f];
    if (cb.checked) {
      // Never let every copy of a file be picked
      const others = g.files.filter(x => x !== f && !picked.has(x.path));
      if (!others.length) { cb.checked = false; toast('Keep at least one copy', { error: true }); return; }
      picked.add(f.path);
    } else picked.delete(f.path);
    paint();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    e.preventDefault();
    closeModal();
    navigate(parentOf(b.dataset.show), { keepSelection: b.dataset.show });
  });
  body.querySelector('#dup-keep').onchange = (e) => pick(e.target.value);
  pick('newest');
  async function trashPicked() {
    const paths = [...picked];
    if (!paths.length) return false;
    const res = await api.trash(paths).catch(() => null);
    toast(`Moved ${paths.length} duplicate${paths.length === 1 ? '' : 's'} to the Recycle Bin`);
    load(tab(), { silent: true });
    return res;
  }
}
const DUP_LISTENERS = new Set();
window.wf.onDupProgress && window.wf.onDupProgress((d) => DUP_LISTENERS.forEach(f => f(d)));
