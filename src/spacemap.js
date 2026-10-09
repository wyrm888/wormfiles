// Disk space map: scans a folder tree and keeps a compact size tree in memory.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { categoryOf } = require('./categories');

const SKIP = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys']);
const KEEP_FILES = 40; // biggest files remembered per folder (the rest are summed up)

let current = null; // { id, root, tree, cancelled }

// Node: { name, path, size, files, dirs: [Node], top: [{name,size}], other: bytes in files not in top }
async function scan(id, root, onProgress) {
  const job = { id, root, cancelled: false, files: 0, bytes: 0, errors: 0 };
  current = job;
  let lastReport = 0;
  const report = (done = false) => {
    const now = Date.now();
    if (!done && now - lastReport < 200) return;
    lastReport = now;
    onProgress({ id, files: job.files, bytes: job.bytes, done });
  };

  // Limit how many folders are read at the same time
  let active = 0;
  const waiting = [];
  const slot = () => new Promise(r => { if (active < 24) { active++; r(); } else waiting.push(r); });
  const release = () => { active--; const n = waiting.shift(); if (n) { active++; n(); } };

  async function walk(dir, name) {
    const node = { name, path: dir, size: 0, files: 0, dirs: [], top: [], other: 0 };
    if (job.cancelled) return node;
    await slot();
    let ents = [];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { job.errors++; }
    const fileSizes = [];
    // stat files in small parallel batches
    for (let i = 0; i < ents.length && !job.cancelled; i += 64) {
      const batch = ents.slice(i, i + 64).filter(d => d.isFile() && !SKIP.has(d.name.toLowerCase()));
      const stats = await Promise.allSettled(batch.map(d => fsp.stat(path.join(dir, d.name))));
      batch.forEach((d, j) => {
        if (stats[j].status !== 'fulfilled') return;
        const size = stats[j].value.size;
        fileSizes.push({ name: d.name, size });
        job.files++; job.bytes += size;
      });
      report();
    }
    release();
    fileSizes.sort((a, b) => b.size - a.size);
    node.top = fileSizes.slice(0, KEEP_FILES);
    node.other = fileSizes.slice(KEEP_FILES).reduce((a, f) => a + f.size, 0);
    node.files = fileSizes.length;
    const subdirs = ents.filter(d => d.isDirectory() && !d.isSymbolicLink() && !SKIP.has(d.name.toLowerCase()));
    node.dirs = await Promise.all(subdirs.map(d => walk(path.join(dir, d.name), d.name)));
    node.size = fileSizes.reduce((a, f) => a + f.size, 0) + node.dirs.reduce((a, d) => a + d.size, 0);
    node.files += node.dirs.reduce((a, d) => a + d.files, 0);
    return node;
  }

  const name = path.basename(root.replace(/[\\/]+$/, '')) || root;
  job.tree = await walk(root, name);
  report(true);
  return { id, cancelled: job.cancelled, errors: job.errors };
}

function cancel(id) { if (current && current.id === id) current.cancelled = true; }

// What the map shows for one folder: its subfolders and biggest files, two levels deep
function view(p) {
  if (!current || !current.tree) return null;
  const norm = (s) => s.replace(/[\\/]+$/, '').toLowerCase();
  let node = current.tree;
  if (norm(p) !== norm(node.path)) {
    const stack = [node];
    node = null;
    while (stack.length) {
      const n = stack.pop();
      if (norm(n.path) === norm(p)) { node = n; break; }
      if (norm(p).startsWith(norm(n.path))) stack.push(...n.dirs);
    }
  }
  if (!node) return null;
  const shape = (n, depth) => {
    const items = [
      ...n.dirs.filter(d => d.size > 0).map(d => ({
        name: d.name, path: d.path, size: d.size, isDir: true, files: d.files,
        children: depth > 0 ? shape(d, depth - 1) : null
      })),
      ...n.top.filter(f => f.size > 0).map(f => ({
        name: f.name, path: path.join(n.path, f.name), size: f.size, isDir: false, cat: categoryOf(f.name, false)
      }))
    ];
    if (n.other > 0) items.push({ name: `${n.files - n.top.length - n.dirs.reduce((a, d) => a + d.files, 0)} smaller files`, size: n.other, isDir: false, cat: 'other', isRest: true });
    return items.sort((a, b) => b.size - a.size);
  };
  return { path: node.path, name: node.name, size: node.size, files: node.files, root: current.tree.path, items: shape(node, 1) };
}

module.exports = { scan, cancel, view };
