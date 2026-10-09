// Theme presets. Colors are "R G B" triplets so panels can be made translucent over a background image.
const THEMES = {
  crimson: {
    name: 'Crimson', dark: true,
    bg: '10 10 12', surface: '20 20 23', surface2: '31 31 36', text: '242 242 244', dim: '150 150 160',
    border: '48 48 56', accent: '#e11d2e', folderFront: '#1c1c20', folderBack: '#b3121f'
  },
  midnight: {
    name: 'Midnight', dark: true,
    bg: '17 19 26', surface: '24 27 36', surface2: '33 37 49', text: '232 234 240', dim: '144 150 168',
    border: '48 53 70', accent: '#6c8cff'
  },
  graphite: {
    name: 'Graphite', dark: true,
    bg: '24 24 24', surface: '32 32 32', surface2: '43 43 43', text: '236 236 236', dim: '160 160 160',
    border: '60 60 60', accent: '#4cc2ff'
  },
  nord: {
    name: 'Nord', dark: true,
    bg: '36 41 51', surface: '46 52 64', surface2: '59 66 82', text: '236 239 244', dim: '170 178 192',
    border: '67 76 94', accent: '#88c0d0'
  },
  grape: {
    name: 'Grape', dark: true,
    bg: '26 22 37', surface: '35 30 50', surface2: '47 40 66', text: '240 236 250', dim: '168 158 190',
    border: '64 55 88', accent: '#bd93f9'
  },
  forest: {
    name: 'Forest', dark: true,
    bg: '18 25 21', surface: '25 34 29', surface2: '34 46 39', text: '230 240 233', dim: '146 168 154',
    border: '45 61 52', accent: '#5fd38d'
  },
  sunset: {
    name: 'Sunset', dark: true,
    bg: '30 20 22', surface: '41 27 30', surface2: '55 36 40', text: '250 236 232', dim: '190 160 156',
    border: '74 48 52', accent: '#ff8a4c'
  },
  ocean: {
    name: 'Ocean', dark: true,
    bg: '10 24 36', surface: '15 33 49', surface2: '21 45 66', text: '226 240 250', dim: '140 170 192',
    border: '30 58 84', accent: '#2dd4bf'
  },
  hotpink: {
    name: 'Hot Pink', dark: true,
    bg: '24 10 20', surface: '36 14 30', surface2: '52 20 43', text: '255 236 247', dim: '214 156 192',
    border: '82 32 66', accent: '#ff3ea5', folderFront: '#3a1230', folderBack: '#ff3ea5'
  },
  bubblegum: {
    name: 'Bubblegum', dark: false,
    bg: '255 228 241', surface: '255 240 248', surface2: '255 214 234', text: '74 16 52', dim: '166 82 132',
    border: '250 186 220', accent: '#ff2e93', folderFront: '#ff8cc6', folderBack: '#e0127a'
  },
  light: {
    name: 'Light', dark: false,
    bg: '243 243 246', surface: '251 251 252', surface2: '236 237 241', text: '28 30 36', dim: '104 108 122',
    border: '218 220 228', accent: '#0f6cbd'
  },
  rose: {
    name: 'Rosé', dark: false,
    bg: '250 240 242', surface: '255 249 250', surface2: '245 228 233', text: '58 32 42', dim: '140 104 116',
    border: '235 210 218', accent: '#e0457b'
  },
  paper: {
    name: 'Paper', dark: false,
    bg: '244 239 228', surface: '251 248 240', surface2: '236 229 214', text: '50 44 36', dim: '128 116 98',
    border: '222 212 192', accent: '#b5651d'
  },
  contrast: {
    name: 'High contrast', dark: true,
    bg: '0 0 0', surface: '0 0 0', surface2: '20 20 20', text: '255 255 255', dim: '210 210 210',
    border: '255 255 255', accent: '#ffd400'
  }
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return '#' + [f(r), f(g), f(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

function readableOn(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111111' : '#ffffff';
}
