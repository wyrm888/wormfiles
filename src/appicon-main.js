// Applies a custom app icon: window + taskbar icon, desktop / Start menu / pinned taskbar shortcuts,
// and the icon Windows shows for WormFiles' registrations (Worm browser, media player, "Open in WormFiles").
const { app, nativeImage, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// .ico with PNG images inside (supported since Windows Vista)
function buildIco(img) {
  const pngs = ICO_SIZES.map(s => img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const s = ICO_SIZES[i], o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o); dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

function shortcutPaths() {
  const ad = app.getPath('appData');
  return [
    path.join(app.getPath('desktop'), 'WormFiles.lnk'),
    path.join(ad, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'WormFiles.lnk'),
    path.join(ad, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'WormFiles.lnk'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop', 'WormFiles.lnk')
  ];
}
// Point WormFiles' own shortcuts at the icon (installs and updates put the default icon back, so this runs at startup too)
function updateShortcuts(ico) {
  if (process.platform !== 'win32' || !app.isPackaged) return 0;
  const exe = (process.env.PORTABLE_EXECUTABLE_FILE || process.execPath).toLowerCase();
  let changed = 0;
  for (const p of shortcutPaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const l = shell.readShortcutLink(p);
      if (!l || (l.target || '').toLowerCase() !== exe) continue;
      const want = ico || l.target;
      if ((l.icon || '').toLowerCase() === want.toLowerCase()) continue;
      if (shell.writeShortcutLink(p, 'update', { icon: want, iconIndex: 0 })) changed++;
    } catch { /* no permission or not a link */ }
  }
  if (changed) { // ask Explorer to redraw icons
    try { spawn('ie4uinit.exe', ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* old Windows */ }
  }
  return changed;
}

function setWindowIcons(img, ico) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.setIcon(img); } catch { /* destroyed */ }
    if (process.platform === 'win32' && ico) {
      try { w.setAppDetails({ appId: 'com.wormfiles.app', appIconPath: ico, appIconIndex: 0 }); } catch { /* ignore */ }
    }
  }
}

async function apply(dataUrl) {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) throw new Error('empty icon');
  const dir = path.join(app.getPath('userData'), 'icons');
  await fsp.mkdir(dir, { recursive: true });
  const stamp = Date.now();
  const png = path.join(dir, `app-${stamp}.png`);
  const ico = path.join(dir, `app-${stamp}.ico`);
  await fsp.writeFile(png, img.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  await fsp.writeFile(ico, buildIco(img));
  // keep only the newest few (shortcuts may still point at the previous one for a moment)
  try {
    const old = (await fsp.readdir(dir)).filter(n => /^app-\d+\.(png|ico)$/.test(n)).sort().reverse().slice(6);
    for (const n of old) fsp.unlink(path.join(dir, n)).catch(() => {});
  } catch { /* ignore */ }
  setWindowIcons(img, ico);
  updateShortcuts(ico);
  return { png, ico };
}

module.exports = { apply, updateShortcuts, setWindowIcons, buildIco };
