// =====================================================================
// App icon: the WormFiles folder in your theme's colors (default), another style, or your own picture.
// The picture is drawn here, then the main process turns it into the window / taskbar / shortcut icon.
// =====================================================================
const APP_ICON_STYLES = [
  ['theme', 'Folder', 'Matches your theme'],
  ['classic', 'Classic', 'The original red folder'],
  ['worm', 'Worm', ''],
  ['ghost', 'Ghost', ''],
  ['skull', 'Skull', ''],
  ['heart', 'Heart', ''],
  ['star', 'Star', ''],
  ['moon', 'Moon', '']
];
const GLYPHS = {
  heart: '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.6.7-1.5 2.2-2.6 4.3-2.6 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21z" fill="FG"/>',
  star: '<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" fill="FG" stroke="FG" stroke-width="1" stroke-linejoin="round"/>',
  moon: '<path d="M20.5 14.6A8.8 8.8 0 0 1 9.4 3.5a8.8 8.8 0 1 0 11.1 11.1z" fill="FG"/><circle cx="17.5" cy="5.5" r="1.1" fill="FG"/><circle cx="20.3" cy="9" r=".7" fill="FG"/>',
  ghost: '<path d="M12 2.5a7.5 7.5 0 0 0-7.5 7.5v11.2l2.5-1.9 2.5 1.9 2.5-1.9 2.5 1.9 2.5-1.9 2.5 1.9V10A7.5 7.5 0 0 0 12 2.5z" fill="FG"/><ellipse cx="9.2" cy="10.2" rx="1.4" ry="1.9" fill="BG"/><ellipse cx="14.8" cy="10.2" rx="1.4" ry="1.9" fill="BG"/>',
  skull: '<path d="M12 2.6c-4.8 0-8.6 3.5-8.6 8.1 0 2.6 1.2 4.7 3.1 6V19c0 .9.7 1.6 1.6 1.6h7.8c.9 0 1.6-.7 1.6-1.6v-2.3c1.9-1.3 3.1-3.4 3.1-6 0-4.6-3.8-8.1-8.6-8.1z" fill="FG"/><circle cx="8.6" cy="11.2" r="2.1" fill="BG"/><circle cx="15.4" cy="11.2" r="2.1" fill="BG"/><path d="M12 13.6l-1.2 2.1h2.4z" fill="BG"/><path d="M10 18v2.4M12 18v2.4M14 18v2.4" stroke="BG" stroke-width="1"/>',
  worm: '<path d="M3.6 17.2c1.6-3.6 3.6-3.6 5.2 0s3.6 3.6 5.2 0 2.6-5.8 4.4-7.4" fill="none" stroke="FG" stroke-width="3.4" stroke-linecap="round"/><circle cx="18.6" cy="8.6" r="2.9" fill="FG"/><circle cx="19.4" cy="8" r=".9" fill="BG"/>'
};

function iconPalette(classic) {
  if (classic) return { accent: '#e11d2e', dark: '#9a0f1c', body: '#141416', band: '#26262b', light: false };
  const t = themeById(S.theme) || THEMES.crimson;
  const accent = S.accent || t.accent;
  const toHex = (trip) => '#' + trip.split(' ').map(n => (+n).toString(16).padStart(2, '0')).join('');
  return {
    accent, dark: shade(accent, -0.35),
    body: t.dark ? toHex(t.surface) : (t.folderFront || shade(accent, 0.75)),
    band: t.dark ? toHex(t.surface2) : shade(accent, 0.6),
    light: !t.dark
  };
}

function appIconSvg(style) {
  if (style === 'theme' || style === 'classic') {
    const c = iconPalette(style === 'classic');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
      <defs><filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".28"/></filter></defs>
      <g filter="url(#s)">
        <path d="M46 102c0-22 18-38 40-38h88c12 0 22 5 29 14l14 18h209c22 0 40 18 40 40v80H46z" fill="${c.dark}"/>
        <rect x="34" y="154" width="444" height="284" rx="34" fill="${c.body}" stroke="${c.accent}" stroke-width="12"/>
        <path d="M74 160h364c18 0 30 10 33 26H41c3-16 15-26 33-26z" fill="${c.band}"/>
        <rect x="100" y="282" width="312" height="24" rx="12" fill="${c.accent}"/>
        <rect x="100" y="330" width="220" height="20" rx="10" fill="${c.dark}"/>
      </g></svg>`;
  }
  const c = iconPalette(false);
  const fg = readableOn(c.accent) === '#111111' ? '#1a1a1a' : '#ffffff';
  const glyph = (GLYPHS[style] || GLYPHS.worm).replace(/FG/g, fg).replace(/BG/g, c.dark);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(c.accent, 0.12)}"/><stop offset="1" stop-color="${c.dark}"/></linearGradient>
      <filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".28"/></filter></defs>
    <rect x="36" y="36" width="440" height="440" rx="104" fill="url(#g)" filter="url(#s)"/>
    <rect x="36" y="36" width="440" height="220" rx="104" fill="#fff" opacity=".08"/>
    <g transform="translate(106 106) scale(12.5)">${glyph}</g></svg>`;
}

async function svgToPng(svg, size = 256) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  cv.getContext('2d').drawImage(img, 0, 0, size, size);
  return cv.toDataURL('image/png');
}

// Your own picture: center square, rounded corners
async function customIconPng(path, round = true, size = 256) {
  const bmp = await createImageBitmap(new Blob([await api.readBytes(path)]));
  const side = Math.min(bmp.width, bmp.height);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (round) { g.beginPath(); g.roundRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92, size * 0.2); g.clip(); }
  g.imageSmoothingQuality = 'high';
  const pad = round ? size * 0.04 : 0;
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, pad, pad, size - pad * 2, size - pad * 2);
  bmp.close();
  return cv.toDataURL('image/png');
}

function currentIconChoice() { return Object.assign({ style: 'theme', custom: '', round: true }, S.appIcon || {}); }
function iconSignature(ch) {
  if (ch.style === 'custom') return 'custom|' + ch.custom + '|' + ch.round;
  if (ch.style === 'classic') return 'classic|2';
  return ch.style + '|' + JSON.stringify(iconPalette(false)) + '|2';
}

let iconTimer = 0;
// Called after every appearance change; only does work when the icon would actually look different
function syncAppIcon({ force = false, delay = 700 } = {}) {
  clearTimeout(iconTimer);
  iconTimer = setTimeout(async () => {
    const ch = currentIconChoice();
    const sig = iconSignature(ch);
    if (!force && sig === S.appIconSig && S.appIconPng) return;
    try {
      const png = ch.style === 'custom' && ch.custom ? await customIconPng(ch.custom, ch.round) : await svgToPng(appIconSvg(ch.style));
      const r = await api.applyAppIcon({ png });
      if (r && r.png) setS({ appIconSig: sig, appIconPng: r.png });
      refreshBrandIcons();
    } catch (err) {
      console.error('app icon', err);
      if (ch.style === 'custom') { toast("Couldn't use that picture as the icon", { error: true }); setS({ appIcon: { ...ch, style: 'theme' } }); }
    }
  }, delay);
}
function brandIconUrl() { return S.appIconPng ? fileUrl(S.appIconPng) + '&v=' + encodeURIComponent(S.appIconSig || '') : '../../build/icon.png'; }
function refreshBrandIcons() { document.querySelectorAll('img.app-brand').forEach(img => { img.src = brandIconUrl(); }); }
// If the saved icon file is missing, fall back to the built-in one
document.addEventListener('error', (e) => { const t = e.target; if (t && t.matches && t.matches('img.app-brand') && !t.src.endsWith('build/icon.png')) t.src = '../../build/icon.png'; }, true);

// Settings → Appearance: the icon picker
function appIconPicker() {
  const ch = currentIconChoice();
  return `<div class="side-title" style="padding-left:0;margin-top:18px">App icon</div>
    <div class="icon-grid">${APP_ICON_STYLES.map(([k, name, sub]) => `
      <button class="icon-card ${ch.style === k ? 'active' : ''}" data-appicon="${k}" title="${esc(sub || name)}">
        <span class="icon-prev" data-prev="${k}"></span><span>${esc(name)}</span></button>`).join('')}
      <button class="icon-card ${ch.style === 'custom' ? 'active' : ''}" data-appicon="custom" title="Use your own picture">
        <span class="icon-prev">${ch.style === 'custom' && S.appIconPng ? `<img src="${esc(brandIconUrl())}" alt="">` : icon('image')}</span><span>Your picture…</span></button>
    </div>
    <div class="hint">Changes the icon on the window, taskbar, desktop and Start menu shortcuts, Worm's pop-out window and Worm in Windows settings. The Folder icon follows your theme colors automatically.${ch.style === 'custom' ? ` <label class="toggle" style="display:inline-flex;margin-left:8px"><input type="checkbox" id="icon-round" ${ch.round ? 'checked' : ''}><span class="track"></span><span>Rounded corners</span></label>` : ''}</div>`;
}
async function bindAppIconPicker(pane, rerender) {
  for (const el of pane.querySelectorAll('[data-prev]')) {
    svgToPng(appIconSvg(el.dataset.prev), 96).then(src => { el.innerHTML = `<img src="${src}" alt="">`; }).catch(() => {});
  }
  pane.querySelectorAll('[data-appicon]').forEach(b => b.onclick = async () => {
    const style = b.dataset.appicon;
    const ch = currentIconChoice();
    if (style === 'custom') {
      const p = await api.pickIcon();
      if (!p) return;
      setS({ appIcon: { ...ch, style: 'custom', custom: p } });
    } else setS({ appIcon: { ...ch, style } });
    syncAppIcon({ delay: 0 });
    toast('Icon updated — shortcuts may take a few seconds to refresh');
    setTimeout(rerender, 400);
  });
  const r = pane.querySelector('#icon-round');
  if (r) r.onchange = () => { setS({ appIcon: { ...currentIconChoice(), round: r.checked } }); syncAppIcon({ delay: 0 }); setTimeout(rerender, 400); };
}
