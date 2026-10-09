// Parses search queries like:  vacation ext:jpg,png size:>2mb modified:<30d -thumb "my trip"
// Works in both the main process (Node) and the window (plain <script>).
const PQ_CAT = (typeof module !== 'undefined' && module.exports) ? require('./categories')
  : { CATEGORIES, categoryOf }; // globals from categories.js in the window

const SIZE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
const TIME_UNITS = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3, mo: 30 * 86400e3, y: 365 * 86400e3 };

function tokenize(q) {
  const out = [];
  const re = /(-?)(\w+:)?"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[3] !== undefined) out.push((m[1] || '') + (m[2] || '') + m[3]);
    else out.push(m[4]);
  }
  return out;
}

function parseSize(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(s);
  if (!m) return null;
  return parseFloat(m[1]) * SIZE_UNITS[(m[2] || 'b').toLowerCase()];
}

function parseAge(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(mo|m|h|d|w|y)$/i.exec(s);
  if (m) return parseFloat(m[1]) * TIME_UNITS[m[2].toLowerCase()];
  return null;
}

function wildcardToRegex(p) {
  const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$', 'i');
}

function parseQuery(q) {
  const f = {
    terms: [], excludes: [], patterns: [], exts: null, types: null,
    minSize: null, maxSize: null, newerThan: null, olderThan: null, kind: null,
    needsStat: false
  };
  for (const tok of tokenize(q || '')) {
    const lower = tok.toLowerCase();
    const colon = lower.indexOf(':');
    const key = colon > 0 ? lower.slice(0, colon) : null;
    const val = colon > 0 ? tok.slice(colon + 1) : null;

    if (key === 'ext' && val) {
      f.exts = new Set(val.toLowerCase().split(',').map(e => e.replace(/^\./, '')).filter(Boolean));
    } else if ((key === 'type' || key === 'cat') && val) {
      const wanted = val.toLowerCase().split(',');
      f.types = new Set();
      for (const w of wanted) {
        const hit = Object.entries(PQ_CAT.CATEGORIES).find(([k, c]) =>
          k === w || k.startsWith(w) || c.label.toLowerCase().startsWith(w));
        if (hit) f.types.add(hit[0]);
        if (w.startsWith('folder')) f.types.add('folders');
        if (w === 'other') f.types.add('other');
      }
    } else if (key === 'size' && val) {
      const m = /^(>=|<=|>|<|=)?(.+)$/.exec(val);
      const n = parseSize(m[2]);
      if (n != null) {
        if (m[1] === '<' || m[1] === '<=') f.maxSize = n;
        else if (m[1] === '>' || m[1] === '>=') f.minSize = n;
        else { f.minSize = n * 0.9; f.maxSize = n * 1.1; }
        f.needsStat = true;
      }
    } else if ((key === 'modified' || key === 'date' || key === 'age') && val) {
      const m = /^(>|<)?(.+)$/.exec(val);
      const age = parseAge(m[2]);
      if (age != null) {
        // "<7d" = modified within the last 7 days, ">1y" = older than a year
        if (m[1] === '>') f.olderThan = Date.now() - age;
        else f.newerThan = Date.now() - age;
        f.needsStat = true;
      } else if (m[2] === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); f.newerThan = d.getTime(); f.needsStat = true; }
    } else if (key === 'kind' && val) {
      f.kind = val.toLowerCase().startsWith('folder') || val.toLowerCase().startsWith('dir') ? 'dir' : 'file';
    } else if (tok.startsWith('-') && tok.length > 1) {
      f.excludes.push(tok.slice(1).toLowerCase());
    } else if (/[*?]/.test(tok)) {
      f.patterns.push(wildcardToRegex(tok));
    } else if (tok) {
      f.terms.push(lower);
    }
  }
  f.empty = !f.terms.length && !f.excludes.length && !f.patterns.length && !f.exts && !f.types &&
    f.minSize == null && f.maxSize == null && f.newerThan == null && f.olderThan == null && !f.kind;
  return f;
}

// Name-level test (no stat needed)
function matchName(f, name, isDir) {
  const lower = name.toLowerCase();
  if (f.kind === 'dir' && !isDir) return false;
  if (f.kind === 'file' && isDir) return false;
  for (const t of f.terms) if (!lower.includes(t)) return false;
  for (const t of f.excludes) if (lower.includes(t)) return false;
  for (const p of f.patterns) if (!p.test(name)) return false;
  if (f.exts) {
    if (isDir) return false;
    const i = lower.lastIndexOf('.');
    if (i < 0 || !f.exts.has(lower.slice(i + 1))) return false;
  }
  if (f.types && !f.types.has(PQ_CAT.categoryOf(name, isDir))) return false;
  return true;
}

function matchStat(f, st) {
  if (f.minSize != null && st.size < f.minSize) return false;
  if (f.maxSize != null && st.size > f.maxSize) return false;
  if (f.newerThan != null && st.mtimeMs < f.newerThan) return false;
  if (f.olderThan != null && st.mtimeMs > f.olderThan) return false;
  return true;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseQuery, matchName, matchStat };
