const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, protocol, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { CATEGORIES, categoryOf } = require('./categories');
const { parseQuery, matchName, matchStat } = require('./query');
const { setupBrowser } = require('./browser');
const integration = require('./integration');
const archive = require('./archive');
const spacemap = require('./spacemap');

// ---------- Custom protocol so the UI can show local images/videos safely ----------
protocol.registerSchemesAsPrivileged([
  { scheme: 'wormfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

// ---------- One WormFiles at a time: later launches open a tab in the existing window ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
let pendingTargets = integration.parseTargets(process.argv);

// ---------- Speed: GPU acceleration ----------
// Read early: these switches only work before the app is ready.
let earlySettings = {};
try { earlySettings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); } catch { /* first run */ }
if (earlySettings.gpuBoost !== false) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');       // use the graphics card even if Chrome would refuse it
  app.commandLine.appendSwitch('enable-gpu-rasterization');   // draw pages on the graphics card
  app.commandLine.appendSwitch('enable-zero-copy');           // fewer memory copies when drawing
  app.commandLine.appendSwitch('enable-smooth-scrolling');
}
// Bigger browser cache (512 MB) so sites you revisit load more from disk
app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024));

// If the graphics driver crashes with the boost on, turn the boost off for next time
let gpuCrashes = 0;
app.on('child-process-gone', (_e, d) => {
  if (d.type !== 'GPU' || d.reason === 'clean-exit' || settings.gpuBoost === false) return;
  if (++gpuCrashes >= 2) {
    settings.gpuBoost = false;
    saveSettings();
    send('app:notice', 'Your graphics driver had trouble with GPU boost, so it was turned off. Restart WormFiles to finish.');
  }
});

// ---------- Speed + privacy: encrypted DNS ----------
const DNS_SERVERS = {
  cloudflare: ['https://cloudflare-dns.com/dns-query'],
  quad9: ['https://dns.quad9.net/dns-query'],
  google: ['https://dns.google/dns-query']
};
function applyDns() {
  const servers = DNS_SERVERS[settings.webDns];
  try {
    // "automatic" uses the fast encrypted server, and quietly falls back to normal DNS on networks that block it
    if (servers) app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode: 'automatic', secureDnsServers: servers });
    else app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode: 'off' });
  } catch (e) { console.warn('DNS setup failed:', e.message); }
}
let rendererReady = false;
app.on('second-instance', (_e, argv) => {
  let targets = integration.parseTargets(argv);
  if (!targets.length) targets = [{ kind: 'thispc' }]; // launched again with nothing to open: new This PC tab
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  if (rendererReady && win) win.webContents.send('app:open', targets);
  else pendingTargets.push(...targets);
});

let win = null;
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};

const DEFAULT_SETTINGS = {
  theme: 'crimson',
  accent: '',
  bgImage: '',
  bgOpacity: 0.55,
  bgBlur: 0,
  panelAlpha: 0.78,
  mica: false,
  fontSize: 13,
  radius: 10,
  density: 'comfortable',
  view: 'grid',
  iconSize: 96,
  showHidden: false,
  showExtensions: true,
  showPreview: true,
  restoreTabs: true,
  replaceExplorer: false,
  gpuBoost: true,
  webPreload: true,
  webShowMostVisited: false,
  webDns: 'cloudflare',
  openArchives: true,
  mailButton: true,
  mailBackground: true,
  mailUrl: 'https://mail.proton.me/u/0/inbox',
  lastTabs: [],
  sort: { by: 'name', dir: 'asc', foldersFirst: true },
  rememberSortPerFolder: true,
  folderSorts: {},
  sortRules: [
    { match: 'Downloads', by: 'mtime', dir: 'desc' },
    { match: 'Screenshots', by: 'mtime', dir: 'desc' },
    { match: 'Pictures', by: 'mtime', dir: 'desc' },
    { match: 'Videos', by: 'mtime', dir: 'desc' }
  ],
  groupBy: 'none',
  pinned: [],
  customCss: '',
  // built-in browser
  webSearchEngine: 'duckduckgo',
  webBlockAds: true,
  webBlockThirdPartyCookies: true,
  webDoNotTrack: true,
  webRememberHistory: true,
  webClearOnExit: false,
  webDownloadTo: 'current',
  bookmarks: [
    { url: 'https://duckduckgo.com/', title: 'DuckDuckGo' },
    { url: 'https://www.wikipedia.org/', title: 'Wikipedia' },
    { url: 'https://www.youtube.com/', title: 'YouTube' },
    { url: 'https://github.com/', title: 'GitHub' }
  ],
  windowBounds: null,
  maximized: false
};

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
    settings = { ...DEFAULT_SETTINGS, ...raw, sort: { ...DEFAULT_SETTINGS.sort, ...(raw.sort || {}) } };
  } catch {
    settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
      fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
    } catch (e) { console.error('save settings failed', e); }
  }, 250);
}

// ---------- Window ----------
function createWindow() {
  const b = settings.windowBounds || { width: 1280, height: 800 };
  win = new BrowserWindow({
    ...b,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#0a0a0c',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e8eaf0', height: 40 },
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false, // keep the UI responsive while a Worm page covers it
      plugins: true // built-in PDF viewer for spacebar preview
    }
  });
  if (settings.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    settings.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) settings.windowBounds = win.getBounds();
    saveSettings();
  };
  win.on('resize', remember);
  win.on('move', remember);

  // Links opened from the UI go to the default browser, never a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The WormFiles window itself must never navigate away from its own page
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  loadSettings();
  if (process.platform === 'win32') app.setAppUserModelId('com.wormfiles.app'); // needed for Windows notifications
  protocol.handle('wormfile', async (req) => {
    const p = new URL(req.url).searchParams.get('p');
    if (!p) return new Response('missing', { status: 400 });
    let st;
    try { st = await fsp.stat(p); } catch { return new Response('not found', { status: 404 }); }
    if (!st.isFile()) return new Response('not a file', { status: 400 });
    const type = MIME[extOf(p)] || 'application/octet-stream';
    const range = req.headers.get('range');
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m && st.size > 0) {
      let start = m[1] ? +m[1] : 0;
      let end = m[2] ? +m[2] : st.size - 1;
      if (!m[1] && m[2]) { start = Math.max(0, st.size - +m[2]); end = st.size - 1; }
      end = Math.min(end, st.size - 1);
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
      return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) }
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(p)), {
      status: 200, headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' }
    });
  });
  applyDns();
  createWindow();
  browser.initSession();
  setupUpdates();
  if (settings.mica) applyMica(true);
  // Keep Windows pointing at this copy of WormFiles (the path changes if it's reinstalled or moved)
  if (process.platform === 'win32' && app.isPackaged) {
    if (settings.replaceExplorer) integration.enableExplorerReplacement().catch(() => {});
    if (settings.browserRegistered) integration.registerBrowser().catch(() => {});
  }
});

app.on('window-all-closed', () => app.quit());

// ---------- Helpers ----------
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', opus: 'audio/opus', pdf: 'application/pdf'
};

const SKIP_NAMES = new Set(['$recycle.bin', 'system volume information', 'desktop.ini', 'thumbs.db', '$windows.~bt', '$windows.~ws', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp']);

function isHiddenName(name) {
  return name.startsWith('.') || SKIP_NAMES.has(name.toLowerCase());
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function entryInfo(dir, dirent, st) {
  const isDir = st ? st.isDirectory() : dirent.isDirectory();
  const name = dirent.name;
  return {
    name,
    path: path.join(dir, name),
    isDir,
    size: st && !isDir ? st.size : 0,
    mtime: st ? st.mtimeMs : 0,
    ctime: st ? st.birthtimeMs : 0,
    ext: isDir ? '' : extOf(name),
    cat: categoryOf(name, isDir),
    hidden: isHiddenName(name),
    isArchive: !isDir && archive.ARCHIVE_EXT.has(extOf(name))
  };
}

// Entries inside an archive look like normal ones, flagged read-only
function archiveEntry({ name, path: p, isDir, size, mtime }) {
  return {
    name, path: p, isDir, size: isDir ? 0 : size, mtime, ctime: 0,
    ext: isDir ? '' : extOf(name), cat: categoryOf(name, isDir), hidden: false,
    isArchive: !isDir && archive.ARCHIVE_EXT.has(extOf(name)), inArchive: true
  };
}
const readOnly = () => new Error("Files inside an archive can't be changed. Copy them out first.");
// True for an archive itself or anything inside one (somewhere files can't be written)
function insideArchive(p) {
  if (!archive.splitVirtual(p)) return false;
  try { return !fs.statSync(p).isDirectory(); } catch { return true; }
}

async function uniquePath(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name);
  const base = ext && ext !== name ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 10000; i++) {
    target = path.join(dir, `${base} (${i})${ext && ext !== name ? ext : ''}`);
    if (!fs.existsSync(target)) return target;
  }
  throw new Error('Could not find a free name');
}

async function movePath(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

const browser = setupBrowser({
  getWin: () => win,
  getSettings: () => settings,
  saveSettings,
  send
});

// ---------- App / settings IPC ----------
ipcMain.handle('app:init', () => {
  const home = os.homedir();
  const quick = [
    ['Home', home, 'home'],
    ['Desktop', app.getPath('desktop'), 'desktop'],
    ['Downloads', app.getPath('downloads'), 'download'],
    ['Documents', app.getPath('documents'), 'doc'],
    ['Pictures', app.getPath('pictures'), 'image'],
    ['Music', app.getPath('music'), 'music'],
    ['Videos', app.getPath('videos'), 'video']
  ].filter(([, p]) => { try { return fs.existsSync(p); } catch { return false; } })
    .map(([label, p, icon]) => ({ label, path: p, icon }));
  const cats = {};
  for (const [k, c] of Object.entries(CATEGORIES)) cats[k] = { label: c.label, ext: c.ext };
  return {
    settings, quick, categories: cats, platform: process.platform, home,
    sep: path.sep, version: app.getVersion(), systemDark: nativeTheme.shouldUseDarkColors
  };
});

ipcMain.handle('settings:set', (_e, patch) => {
  settings = { ...settings, ...patch };
  if ('webBlockAds' in patch) browser.setAdBlock(patch.webBlockAds);
  if ('webDns' in patch) applyDns();
  saveSettings();
  return settings;
});

ipcMain.handle('window:overlay', (_e, { symbolColor }) => {
  try { win.setTitleBarOverlay({ color: '#00000000', symbolColor, height: 40 }); } catch { /* not supported */ }
});

function applyMica(on) {
  if (!win) return;
  try {
    if (typeof win.setBackgroundMaterial === 'function') {
      win.setBackgroundMaterial(on ? 'mica' : 'none');
      win.setBackgroundColor(on ? '#00000000' : '#0a0a0c');
      return true;
    }
  } catch { /* older Windows */ }
  return false;
}
ipcMain.handle('window:mica', (_e, on) => applyMica(on));

// ---------- File system IPC ----------
ipcMain.handle('fs:list', async (_e, dir) => {
  let dirents;
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    // Not a real folder: maybe a zip (or a folder inside one)
    if ((e.code === 'ENOTDIR' || e.code === 'ENOENT') && archive.splitVirtual(dir)) return archive.list(dir, archiveEntry);
    throw e;
  }
  const out = [];
  const CHUNK = 256;
  for (let i = 0; i < dirents.length; i += CHUNK) {
    const slice = dirents.slice(i, i + CHUNK);
    const stats = await Promise.allSettled(slice.map(d => fsp.stat(path.join(dir, d.name))));
    slice.forEach((d, j) => {
      const st = stats[j].status === 'fulfilled' ? stats[j].value : null;
      if (!st && !d.isDirectory() && !d.isFile()) return; // broken link etc.
      out.push(entryInfo(dir, d, st));
    });
  }
  return out;
});

ipcMain.handle('fs:drives', async () => {
  if (process.platform !== 'win32') {
    return [{ letter: '/', path: '/', label: 'Root', total: 0, free: 0 }];
  }
  const drives = [];
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${L}:\\`;
    try {
      await fsp.access(root);
      let total = 0, free = 0;
      try {
        const s = await fsp.statfs(root);
        total = s.blocks * s.bsize; free = s.bavail * s.bsize;
      } catch { /* optical drives etc. */ }
      drives.push({ letter: L, path: root, label: L === 'C' ? 'Local Disk' : 'Drive', total, free });
    } catch { /* not present */ }
  }
  return drives;
});

ipcMain.handle('fs:diskFree', async (_e, p) => {
  try {
    const s = await fsp.statfs(p);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { return null; }
});

ipcMain.handle('fs:exists', async (_e, p) => {
  try { const st = await fsp.stat(p); return st.isDirectory() ? 'dir' : 'file'; } catch { return archive.kindOf(p); }
});

// ---------- Automatic updates (from GitHub Releases) ----------
let updater = null;
let updateState = { state: 'off' };
function setUpdate(s) { updateState = s; send('update:status', s); }
function setupUpdates() {
  // Only the installed version updates itself (not the portable .exe or a copy built without GitHub info)
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return;
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
  updater.on('update-available', (i) => setUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  updater.on('update-not-available', () => setUpdate({ state: 'latest' }));
  updater.on('download-progress', (p) => setUpdate({ ...updateState, state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => setUpdate({ state: 'ready', version: i.version }));
  updater.on('error', (e) => setUpdate({ state: 'error', message: String(e && e.message || e).split('\n')[0] }));
  setUpdate({ state: 'idle' });
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 4 * 3600e3);
}
ipcMain.handle('update:status', () => updateState);
ipcMain.handle('update:check', async () => {
  if (!updater) return updateState;
  await updater.checkForUpdates().catch(() => {});
  return updateState;
});
ipcMain.handle('update:install', () => { if (updater) updater.quitAndInstall(false, true); });

// ---------- Windows integration ----------
ipcMain.handle('app:takeTargets', () => { rendererReady = true; const t = pendingTargets; pendingTargets = []; return t; });
ipcMain.handle('integration:status', async () => ({
  windows: process.platform === 'win32',
  replaceExplorer: await integration.explorerReplacementActive().catch(() => false),
  defaultBrowser: await integration.isDefaultBrowser().catch(() => false)
}));
ipcMain.handle('integration:setExplorer', async (_e, on) => {
  if (on) await integration.enableExplorerReplacement(); else await integration.disableExplorerReplacement();
  settings.replaceExplorer = !!on; saveSettings();
  return integration.explorerReplacementActive();
});
ipcMain.handle('integration:defaultBrowser', async () => {
  settings.browserRegistered = true; saveSettings();
  await integration.openDefaultAppsSettings();
});
// Opens the real Windows File Explorer (shell.openPath on a folder would come back to WormFiles)
ipcMain.handle('app:explorer', (_e, p) => {
  if (process.platform !== 'win32') return shell.openPath(p);
  spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref();
});

ipcMain.handle('fs:open', async (_e, p) => {
  // Something inside an archive: unpack it to a temporary folder first
  if (!fs.existsSync(p) && archive.splitVirtual(p)) {
    try { p = await archive.extractToTemp(p); } catch (e) { return e.message; }
  }
  const err = await shell.openPath(p);
  return err || null;
});

// ---------- Archives ----------
ipcMain.handle('archive:temp', async (_e, p) => archive.extractToTemp(p));
ipcMain.handle('archive:extract', async (_e, archivePath, where) => {
  const dir = path.dirname(archivePath);
  if (where === 'here') { await archive.extractAll(archivePath, dir); return dir; }
  const base = path.basename(archivePath).replace(/\.(tar\.(gz|bz2|xz)|[^.]+)$/i, '');
  const dest = await uniquePath(dir, base || 'Extracted');
  await archive.extractAll(archivePath, dest);
  return dest;
});
app.on('will-quit', () => archive.cleanupTemp());

// ---------- Disk space map ----------
ipcMain.handle('space:scan', (_e, id, root) => spacemap.scan(id, root, (d) => send('space:progress', d)));
ipcMain.handle('space:cancel', (_e, id) => spacemap.cancel(id));
ipcMain.handle('space:view', (_e, p) => spacemap.view(p));

ipcMain.handle('fs:reveal', (_e, p) => {
  // Always the real File Explorer, even when WormFiles is set to open folders
  if (process.platform !== 'win32') return shell.showItemInFolder(p);
  spawn('explorer.exe', [`/select,"${p.replace(/"/g, '')}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
});

ipcMain.handle('fs:trash', async (_e, paths) => {
  if (paths.some(p => !fs.existsSync(p) && archive.splitVirtual(p))) throw readOnly();
  const failed = [];
  for (const p of paths) {
    try { await shell.trashItem(p); } catch (e) { failed.push({ path: p, error: e.message }); }
  }
  return failed;
});

ipcMain.handle('fs:rename', async (_e, p, newName) => {
  if (!fs.existsSync(p) && archive.splitVirtual(p)) throw readOnly();
  if (!newName || /[<>:"/\\|?*]/.test(newName)) throw new Error('That name has characters Windows does not allow.');
  const target = path.join(path.dirname(p), newName);
  if (target.toLowerCase() !== p.toLowerCase() && fs.existsSync(target)) throw new Error('Something with that name already exists here.');
  await fsp.rename(p, target);
  return target;
});

ipcMain.handle('fs:newFolder', async (_e, dir) => {
  if (archive.splitVirtual(dir)) throw readOnly();
  const p = await uniquePath(dir, 'New folder');
  await fsp.mkdir(p);
  return p;
});

ipcMain.handle('fs:newFile', async (_e, dir) => {
  if (archive.splitVirtual(dir)) throw readOnly();
  const p = await uniquePath(dir, 'New Text Document.txt');
  await fsp.writeFile(p, '');
  return p;
});

ipcMain.handle('fs:paste', async (_e, { paths, dest, mode }) => {
  const done = [];
  const errors = [];
  if (insideArchive(dest)) return { done, errors: [{ path: dest, error: readOnly().message }] };
  for (const src of paths) {
    try {
      const name = path.basename(src);
      // Copying out of an archive = extracting
      if (!fs.existsSync(src) && archive.splitVirtual(src)) {
        const x = await archive.extractItem(src, dest);
        const target = await uniquePath(dest, name);
        try { await fsp.rename(x.path, target); }
        finally { await fsp.rm(x.work, { recursive: true, force: true }).catch(() => {}); }
        done.push(target);
        continue;
      }
      const srcNorm = path.resolve(src).toLowerCase();
      const destNorm = path.resolve(dest).toLowerCase();
      if (destNorm === srcNorm || destNorm.startsWith(srcNorm + path.sep)) {
        throw new Error(`Can't put "${name}" inside itself.`);
      }
      if (mode === 'move' && path.dirname(srcNorm) === destNorm) { done.push(src); continue; }
      const target = await uniquePath(dest, name);
      if (mode === 'move') await movePath(src, target);
      else await fsp.cp(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      done.push(target);
    } catch (e) { errors.push({ path: src, error: e.message }); }
  }
  return { done, errors };
});

ipcMain.handle('fs:readText', async (_e, p, max = 64 * 1024) => {
  if (!fs.existsSync(p) && archive.splitVirtual(p)) p = await archive.extractToTemp(p);
  const fh = await fsp.open(p, 'r');
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    const slice = buf.subarray(0, bytesRead);
    // crude binary detection
    let zeros = 0;
    for (let i = 0; i < Math.min(bytesRead, 4096); i++) if (slice[i] === 0) zeros++;
    if (zeros > 4) return null;
    return slice.toString('utf8');
  } finally { await fh.close(); }
});

ipcMain.handle('fs:folderSize', async (_e, dir) => {
  let total = 0, files = 0;
  const stack = [dir];
  const started = Date.now();
  while (stack.length && Date.now() - started < 8000) {
    const d = stack.pop();
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += (await fsp.stat(p)).size; files++; } catch { /* skip */ } }
    }
  }
  return { total, files, partial: stack.length > 0 };
});

// ---------- Thumbnails & icons ----------
const iconCache = new Map();
const UNIQUE_ICON_EXT = new Set(['exe', 'lnk', 'ico', 'url', 'msi', 'appx']);

ipcMain.handle('fs:icon', async (_e, p, isDir) => {
  const ext = isDir ? '<dir>' : extOf(p);
  const key = UNIQUE_ICON_EXT.has(ext) ? p : ext;
  if (iconCache.has(key)) return iconCache.get(key);
  try {
    const img = await app.getFileIcon(p, { size: 'large' });
    const url = img.isEmpty() ? null : img.toDataURL();
    iconCache.set(key, url);
    return url;
  } catch { return null; }
});

ipcMain.handle('fs:thumb', async (_e, p, size = 256) => {
  try {
    if (!fs.existsSync(p) && archive.splitVirtual(p)) p = await archive.extractToTemp(p);
    const img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size });
    if (!img.isEmpty()) return img.toDataURL();
  } catch { /* fall through */ }
  return null;
});

// ---------- Search (recursive, streamed, cancellable) ----------
const searches = new Map();

ipcMain.handle('search:start', async (_e, { id, root, query, limit = 5000 }) => {
  const f = parseQuery(query);
  const token = { cancelled: false };
  searches.set(id, token);

  const queue = [root];
  let batch = [];
  let found = 0, scanned = 0;
  let lastFlush = Date.now();
  const flush = (done = false) => {
    send('search:results', { id, items: batch, done, scanned, found });
    batch = [];
    lastFlush = Date.now();
  };

  while (queue.length && !token.cancelled && found < limit) {
    const dir = queue.shift();
    let dh;
    try { dh = await fsp.opendir(dir, { bufferSize: 128 }); } catch { continue; }
    try {
      for await (const d of dh) {
        if (token.cancelled || found >= limit) break;
        const name = d.name;
        const lowerName = name.toLowerCase();
        if (SKIP_NAMES.has(lowerName)) continue;
        if (!settings.showHidden && name.startsWith('.')) continue;
        const isDir = d.isDirectory();
        scanned++;
        if (isDir && !d.isSymbolicLink()) queue.push(path.join(dir, name));
        if (!f.empty && !matchName(f, name, isDir)) continue;
        let st = null;
        try { st = await fsp.stat(path.join(dir, name)); } catch { if (f.needsStat) continue; }
        if (f.needsStat && (!st || !matchStat(f, st))) continue;
        batch.push(entryInfo(dir, d, st));
        found++;
        if (batch.length >= 150 || Date.now() - lastFlush > 200) flush();
      }
    } catch { /* permission denied mid-read */ }
    if (scanned % 2000 === 0 && Date.now() - lastFlush > 300) flush();
  }
  flush(true);
  searches.delete(id);
  return { found, scanned, cancelled: token.cancelled, limited: found >= limit };
});

ipcMain.handle('search:cancel', (_e, id) => {
  const t = searches.get(id);
  if (t) t.cancelled = true;
});

// ---------- Folder watching ----------
let watcher = null;
let watchTimer = null;
ipcMain.handle('watch:set', (_e, dir) => {
  try { watcher && watcher.close(); } catch { /* ignore */ }
  watcher = null;
  if (!dir) return;
  try {
    watcher = fs.watch(dir, { persistent: false }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => send('watch:changed', dir), 400);
    });
    watcher.on('error', () => { /* folder removed etc. */ });
  } catch { /* unwatchable */ }
});

// ---------- Tidy up (organize files into category folders) ----------
ipcMain.handle('organize:preview', async (_e, dir) => {
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const plan = {};
  for (const d of ents) {
    if (!d.isFile() || isHiddenName(d.name)) continue;
    const cat = categoryOf(d.name, false);
    if (!CATEGORIES[cat]) continue;
    const folder = CATEGORIES[cat].folder;
    (plan[folder] = plan[folder] || []).push(d.name);
  }
  return plan;
});

ipcMain.handle('organize:run', async (_e, dir) => {
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const moves = [];
  const createdDirs = [];
  for (const d of ents) {
    if (!d.isFile() || isHiddenName(d.name)) continue;
    const cat = categoryOf(d.name, false);
    if (!CATEGORIES[cat]) continue;
    const folderPath = path.join(dir, CATEGORIES[cat].folder);
    if (!fs.existsSync(folderPath)) { await fsp.mkdir(folderPath); createdDirs.push(folderPath); }
    const from = path.join(dir, d.name);
    const to = await uniquePath(folderPath, d.name);
    try { await movePath(from, to); moves.push({ from, to }); } catch { /* file in use */ }
  }
  return { moves, createdDirs };
});

ipcMain.handle('organize:undo', async (_e, { moves, createdDirs }) => {
  let restored = 0;
  for (const m of [...moves].reverse()) {
    try {
      const back = fs.existsSync(m.from) ? await uniquePath(path.dirname(m.from), path.basename(m.from)) : m.from;
      await movePath(m.to, back); restored++;
    } catch { /* moved elsewhere since */ }
  }
  for (const d of createdDirs || []) {
    try { if ((await fsp.readdir(d)).length === 0) await fsp.rmdir(d); } catch { /* not empty */ }
  }
  return restored;
});

// ---------- Misc ----------
ipcMain.handle('dialog:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  // Copy into app data so the background survives if the original is moved
  const src = r.filePaths[0];
  const dir = path.join(app.getPath('userData'), 'backgrounds');
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `bg-${Date.now()}${path.extname(src)}`);
  await fsp.copyFile(src, dest);
  return dest;
});

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('clipboard:text', (_e, t) => clipboard.writeText(t));

ipcMain.handle('app:terminal', (_e, dir) => {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit'], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  }
});

ipcMain.handle('app:openWith', (_e, p) => {
  if (process.platform === 'win32') {
    const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p], { detached: true, stdio: 'ignore' });
    child.unref();
  }
});

ipcMain.handle('app:properties', (_e, p) => {
  // Opens the classic Windows Properties dialog for a file or folder
  if (process.platform === 'win32') {
    const ps = `$s=New-Object -ComObject Shell.Application; $f=$s.Namespace((Split-Path -LiteralPath $env:WF_P)); $i=$f.ParseName((Split-Path -Leaf -LiteralPath $env:WF_P)); $i.InvokeVerb('properties'); Start-Sleep -Seconds 60`;
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
      { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, WF_P: p } });
    child.unref();
  }
});

ipcMain.on('drag:start', (e, paths) => {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 48, height: 48 });
  try {
    e.sender.startDrag({ files: paths, file: paths[0], icon });
  } catch { /* ignore */ }
});
