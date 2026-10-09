// File categories used by the category tabs, search "type:" filter and Tidy Up.
const CATEGORIES = {
  images: {
    label: 'Images', folder: 'Images',
    ext: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg', 'ico', 'jfif',
      'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'psd', 'xcf', 'tga']
  },
  videos: {
    label: 'Videos', folder: 'Videos',
    ext: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'mts', 'm2ts', 'vob']
  },
  audio: {
    label: 'Music', folder: 'Music',
    ext: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'wma', 'opus', 'aiff', 'aif', 'mid', 'midi', 'alac']
  },
  documents: {
    label: 'Documents', folder: 'Documents',
    ext: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx',
      'md', 'epub', 'pages', 'numbers', 'key', 'log']
  },
  archives: {
    label: 'Archives', folder: 'Archives',
    ext: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'cab', 'zst', 'lz', 'img']
  },
  code: {
    label: 'Code', folder: 'Code',
    ext: ['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'go', 'rs', 'rb',
      'php', 'html', 'htm', 'css', 'scss', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'ps1', 'lua',
      'luau', 'kt', 'swift', 'sql', 'vue', 'svelte', 'dart', 'r', 'gd', 'cfg']
  },
  apps: {
    label: 'Apps', folder: 'Installers',
    ext: ['exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'lnk', 'url', 'jar', 'apk']
  }
};

const EXT_TO_CATEGORY = {};
for (const [key, cat] of Object.entries(CATEGORIES)) {
  for (const e of cat.ext) if (!EXT_TO_CATEGORY[e]) EXT_TO_CATEGORY[e] = key;
}

function categoryOf(name, isDir) {
  if (isDir) return 'folders';
  const i = name.lastIndexOf('.');
  if (i <= 0) return 'other';
  return EXT_TO_CATEGORY[name.slice(i + 1).toLowerCase()] || 'other';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { CATEGORIES, EXT_TO_CATEGORY, categoryOf };
