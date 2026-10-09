// Browse archives (zip, 7z, rar, tar…) like folders, using 7-Zip.
// Inside WormFiles an archive is addressed like a folder:  C:\Downloads\pack.zip\textures\stone.png
const { app } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

const ARCHIVE_EXT = new Set(['zip', '7z', 'rar', 'tar', 'tgz', 'gz', 'bz2', 'tbz2', 'xz', 'txz', 'cab', 'iso']);
const NEEDS_FULL_7ZIP = new Set(['rar', 'cab', 'iso']); // the bundled 7za can't read these
const NO_PASS = '-pwormfiles-no-password'; // stops 7-Zip from waiting for a password that never comes

const extOf = (p) => { const b = path.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const isArchiveName = (p) => ARCHIVE_EXT.has(extOf(p));

// ---------- Which 7-Zip to use ----------
function bundled7za() {
  try {
    const p = require('7zip-bin').path7za;
    return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  } catch { return null; }
}
function installed7z() {
  if (process.platform !== 'win32') return null;
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]) {
    if (!base) continue;
    const p = path.join(base, '7-Zip', '7z.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function sevenZipFor(archivePath) {
  const full = installed7z();
  if (full) return full;
  if (NEEDS_FULL_7ZIP.has(extOf(archivePath))) {
    const e = new Error(`To open .${extOf(archivePath)} files, install 7-Zip (free) from 7-zip.org.`);
    e.code = 'NEED_7ZIP';
    throw e;
  }
  const b = bundled7za();
  if (!b) throw new Error('7-Zip is missing from this copy of WormFiles.');
  return b;
}

function run7z(archivePath, args, { maxBuffer = 256 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let exe;
    try { exe = sevenZipFor(archivePath); } catch (e) { return reject(e); }
    execFile(exe, args, { windowsHide: true, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || '') + (stdout || '');
        if (/Wrong password|encrypted|Can not open encrypted/i.test(msg)) return reject(new Error('This archive is password-protected.'));
        if (/Can not open the file as archive|Is not archive|Unexpected end of archive/i.test(msg)) return reject(new Error("This file isn't a readable archive (it may be damaged)."));
        return reject(new Error((msg.trim().split(/\r?\n/).filter(Boolean).pop()) || err.message));
      }
      resolve(stdout);
    });
  });
}

// ---------- Listing ----------
// Parses `7z l -slt` output into [{ inner: 'a/b.txt', isDir, size, mtime }]
function parseListing(out) {
  const lines = out.split(/\r?\n/);
  const start = lines.findIndex(l => /^-{5,}\s*$/.test(l));
  const entries = [];
  let cur = null;
  const push = () => {
    if (cur && cur.Path != null) {
      const inner = cur.Path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (inner) {
        const isDir = cur.Folder === '+' || /^D/.test(cur.Attributes || '');
        let mtime = 0;
        const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(cur.Modified || '');
        if (m) mtime = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        entries.push({ inner, isDir, size: isDir ? 0 : (parseInt(cur.Size, 10) || 0), mtime, raw: cur.Path });
      }
    }
    cur = null;
  };
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { push(); continue; }
    const m = /^([^=]+?) = ?(.*)$/.exec(l);
    if (!m) continue;
    if (m[1] === 'Path' && cur && cur.Path != null) push();
    if (!cur) cur = {};
    cur[m[1]] = m[2];
  }
  push();
  return entries;
}

// Build a folder tree (adds folders that only exist implicitly in the paths)
function buildIndex(entries) {
  const dirs = new Map([['', { children: new Map() }]]);
  const ensureDir = (inner, info) => {
    if (dirs.has(inner)) { if (info) Object.assign(dirs.get(inner), info); return dirs.get(inner); }
    const parent = inner.includes('/') ? inner.slice(0, inner.lastIndexOf('/')) : '';
    const pd = ensureDir(parent);
    const node = { children: new Map(), mtime: 0, ...(info || {}) };
    dirs.set(inner, node);
    pd.children.set(inner.slice(inner.lastIndexOf('/') + 1), { inner, isDir: true, size: 0, mtime: node.mtime });
    return node;
  };
  for (const e of entries) {
    if (e.isDir) { ensureDir(e.inner, { mtime: e.mtime, raw: e.raw }); continue; }
    const parent = e.inner.includes('/') ? e.inner.slice(0, e.inner.lastIndexOf('/')) : '';
    ensureDir(parent).children.set(e.inner.slice(e.inner.lastIndexOf('/') + 1), e);
  }
  // fill folder dates/sizes for display
  for (const [inner, node] of dirs) {
    if (!inner) continue;
    const parent = inner.includes('/') ? inner.slice(0, inner.lastIndexOf('/')) : '';
    const rec = dirs.get(parent).children.get(inner.slice(inner.lastIndexOf('/') + 1));
    if (rec) rec.mtime = node.mtime || rec.mtime;
  }
  return dirs;
}

const cache = new Map(); // archivePath -> { mtimeMs, dirs }
async function getIndex(archivePath) {
  const st = await fsp.stat(archivePath);
  const c = cache.get(archivePath);
  if (c && c.mtimeMs === st.mtimeMs) return c.dirs;
  const out = await run7z(archivePath, ['l', '-slt', '-sccUTF-8', NO_PASS, '--', archivePath]);
  const dirs = buildIndex(parseListing(out));
  cache.set(archivePath, { mtimeMs: st.mtimeMs, dirs });
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return dirs;
}

// Split "C:\x\pack.zip\a\b" into { archive: 'C:\x\pack.zip', inner: 'a/b' }, or null if it's not inside an archive
function splitVirtual(p) {
  if (!p) return null;
  const parts = p.split(/[\\/]/);
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join(path.sep);
    if (!isArchiveName(candidate)) continue;
    try {
      const st = fs.statSync(candidate);
      if (st.isFile()) return { archive: candidate, inner: parts.slice(i).filter(Boolean).join('/') };
      return null; // a real folder that happens to end in .zip
    } catch { /* keep looking up */ }
  }
  return null;
}

async function list(virtualPath, entryInfoFrom) {
  const v = splitVirtual(virtualPath);
  if (!v) throw Object.assign(new Error('Not an archive'), { code: 'ENOTARCHIVE' });
  const dirs = await getIndex(v.archive);
  const node = dirs.get(v.inner);
  if (!node) throw Object.assign(new Error('That folder is not in this archive.'), { code: 'ENOENT' });
  const base = v.inner ? path.join(v.archive, ...v.inner.split('/')) : v.archive;
  return [...node.children.entries()].map(([name, e]) => entryInfoFrom({
    name, path: path.join(base, name), isDir: e.isDir, size: e.size, mtime: e.mtime
  }));
}

function kindOf(virtualPath) {
  const v = splitVirtual(virtualPath);
  if (!v) return null;
  if (!v.inner) return 'dir'; // the archive itself opens like a folder
  const c = cache.get(v.archive);
  if (!c) return 'dir';
  if (c.dirs.has(v.inner)) return 'dir';
  return 'file';
}

// ---------- Extracting ----------
let tempRoot = null;
function tempDir() {
  if (!tempRoot) tempRoot = path.join(app.getPath('temp'), 'WormFiles-archives');
  return tempRoot;
}

// Extract one item (file or folder) from an archive into a hidden work folder inside destDir.
// Returns { path: the extracted item, work: the work folder to delete afterwards }.
async function extractItem(virtualPath, destDir) {
  const v = splitVirtual(virtualPath);
  if (!v || !v.inner) throw new Error('Nothing to extract');
  const dirs = await getIndex(v.archive);
  const work = await fsp.mkdtemp(path.join(destDir || tempDir(), '.wf-'));
  const isDir = dirs.has(v.inner);
  const winInner = v.inner.split('/').join(path.sep);
  const targets = isDir ? [winInner, winInner + path.sep + '*'] : [winInner];
  try {
    await run7z(v.archive, ['x', '-y', '-sccUTF-8', NO_PASS, '-o' + work, '-r-', '--', v.archive, ...targets]);
  } catch (e) { await fsp.rm(work, { recursive: true, force: true }).catch(() => {}); throw e; }
  return { path: path.join(work, ...v.inner.split('/')), work };
}

// For opening/previewing: extract to a cache folder that is reused while the archive is unchanged
async function extractToTemp(virtualPath) {
  const v = splitVirtual(virtualPath);
  if (!v || !v.inner) throw new Error('Nothing to extract');
  await fsp.mkdir(tempDir(), { recursive: true });
  const st = await fsp.stat(v.archive);
  const key = Buffer.from(v.archive.toLowerCase() + '|' + st.mtimeMs).toString('base64url').slice(-40);
  const cacheDir = path.join(tempDir(), key);
  const target = path.join(cacheDir, ...v.inner.split('/'));
  if (fs.existsSync(target)) return target;
  await fsp.mkdir(cacheDir, { recursive: true });
  const dirs = await getIndex(v.archive);
  const winInner = v.inner.split('/').join(path.sep);
  const targets = dirs.has(v.inner) ? [winInner, winInner + path.sep + '*'] : [winInner];
  await run7z(v.archive, ['x', '-y', '-sccUTF-8', NO_PASS, '-o' + cacheDir, '-r-', '--', v.archive, ...targets]);
  return target;
}

// Extract the whole archive into a folder
async function extractAll(archivePath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  await run7z(archivePath, ['x', '-y', '-sccUTF-8', NO_PASS, '-o' + destDir, '--', archivePath]);
  return destDir;
}

function cleanupTemp() {
  try { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* files in use */ }
}

module.exports = {
  ARCHIVE_EXT, isArchiveName, splitVirtual, list, kindOf, extractItem, extractToTemp, extractAll,
  cleanupTemp, parseListing, buildIndex, getIndex
};
