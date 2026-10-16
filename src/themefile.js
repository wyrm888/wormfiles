// .wormtheme files: a WormFiles look (colors, accent, background image, corner style, custom CSS) in one shareable file.
const { app, dialog } = require('electron');
const path = require('path');
const fsp = require('fs/promises');

const TRIPLET = /^\d{1,3} \d{1,3} \d{1,3}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/bmp': '.bmp' };
const MAX_BG = 30 * 1024 * 1024;
const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function clean(raw) {
  if (!raw || raw.format !== 'wormfiles-theme') throw new Error("This isn't a WormFiles theme file.");
  const c = raw.colors || {};
  const colors = {};
  for (const k of ['bg', 'surface', 'surface2', 'text', 'dim', 'border']) {
    if (!TRIPLET.test(c[k] || '')) throw new Error('The theme file is damaged (missing colors).');
    colors[k] = c[k];
  }
  colors.accent = HEX.test(c.accent || '') ? c.accent : '#e11d2e';
  if (HEX.test(c.folderFront || '')) colors.folderFront = c.folderFront;
  colors.dark = !!c.dark;
  const s = raw.settings || {};
  return {
    name: String(raw.name || 'Imported theme').replace(/[\r\n\t]/g, ' ').slice(0, 40).trim() || 'Imported theme',
    author: String(raw.author || '').slice(0, 40),
    colors,
    settings: {
      bgOpacity: num(s.bgOpacity, 0.05, 1, 0.55),
      bgBlur: num(s.bgBlur, 0, 40, 0),
      panelAlpha: num(s.panelAlpha, 0.3, 1, 0.78),
      radius: num(s.radius, 0, 18, 10),
      density: ['compact', 'comfortable', 'spacious'].includes(s.density) ? s.density : 'comfortable',
      customCss: typeof s.customCss === 'string' ? s.customCss.slice(0, 100000) : ''
    },
    background: typeof raw.background === 'string' ? raw.background : null
  };
}

async function exportTheme(win, theme) {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save theme',
    defaultPath: path.join(app.getPath('desktop'), (theme.name || 'My theme').replace(/[<>:"/\\|?*]+/g, '_') + '.wormtheme'),
    filters: [{ name: 'WormFiles theme', extensions: ['wormtheme'] }]
  });
  if (r.canceled || !r.filePath) return null;
  const out = { format: 'wormfiles-theme', version: 1, ...theme, background: null };
  if (theme.bgImage) {
    try {
      const buf = await fsp.readFile(theme.bgImage);
      if (buf.length <= MAX_BG) {
        const ext = path.extname(theme.bgImage).slice(1).toLowerCase();
        const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' }[ext] || 'image/png';
        out.background = `data:${mime};base64,${buf.toString('base64')}`;
      }
    } catch { /* background missing: export without it */ }
  }
  delete out.bgImage;
  await fsp.writeFile(r.filePath, JSON.stringify(out));
  return r.filePath;
}

async function importTheme(win, filePath) {
  if (!filePath) {
    const r = await dialog.showOpenDialog(win, {
      title: 'Import a theme', properties: ['openFile'],
      filters: [{ name: 'WormFiles theme', extensions: ['wormtheme', 'json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    filePath = r.filePaths[0];
  }
  const st = await fsp.stat(filePath);
  if (st.size > MAX_BG * 1.5) throw new Error('That theme file is too big.');
  let raw;
  try { raw = JSON.parse(await fsp.readFile(filePath, 'utf8')); } catch { throw new Error("This isn't a WormFiles theme file."); }
  const t = clean(raw);
  let bgImage = '';
  const m = t.background && /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(t.background);
  if (m && IMG_EXT[m[1]]) {
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length <= MAX_BG) {
      const dir = path.join(app.getPath('userData'), 'backgrounds');
      await fsp.mkdir(dir, { recursive: true });
      bgImage = path.join(dir, `theme-${Date.now()}${IMG_EXT[m[1]]}`);
      await fsp.writeFile(bgImage, buf);
    }
  }
  delete t.background;
  return { ...t, bgImage };
}

module.exports = { exportTheme, importTheme, clean };
