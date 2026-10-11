// Reads song title / artist / album and the cover picture from music files.
// Supports ID3v2 (mp3, also some wav/aac), FLAC and MP4/M4A tags. Reads only the parts of the file it needs.
const fsp = require('fs/promises');

const MAX_PIC = 8 * 1024 * 1024;

async function readTags(p) {
  let fh;
  try {
    fh = await fsp.open(p, 'r');
    const st = await fh.stat();
    const head = Buffer.alloc(Math.min(10, st.size));
    await fh.read(head, 0, head.length, 0);
    if (head.length >= 10 && head.toString('latin1', 0, 3) === 'ID3') return await id3(fh, head);
    if (head.length >= 4 && head.toString('latin1', 0, 4) === 'fLaC') return await flac(fh, st.size);
    if (head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp') return await mp4(fh, st.size);
    return {};
  } catch {
    return {};
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function readAt(fh, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, pos);
  return bytesRead === len ? b : b.subarray(0, bytesRead);
}

function picUrl(mime, data) {
  if (!data || !data.length || data.length > MAX_PIC) return null;
  if (!mime || !mime.includes('/')) mime = data[0] === 0x89 ? 'image/png' : 'image/jpeg';
  if (mime === 'image/jpg') mime = 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
}

// ---------- ID3v2 ----------
const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function decodeText(enc, buf) {
  if (!buf.length) return '';
  let s;
  if (enc === 1 || enc === 2) { // UTF-16 with or without BOM
    let le = enc === 1;
    let b = buf;
    if (b[0] === 0xff && b[1] === 0xfe) { le = true; b = b.subarray(2); }
    else if (b[0] === 0xfe && b[1] === 0xff) { le = false; b = b.subarray(2); }
    if (!le) { b = Buffer.from(b); for (let i = 0; i + 1 < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; } }
    s = b.toString('utf16le');
  } else s = buf.toString(enc === 3 ? 'utf8' : 'latin1');
  return s.replace(/\0[\s\S]*$/, '').trim();
}

function nulEnd(buf, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < buf.length; i += 2) if (buf[i] === 0 && buf[i + 1] === 0) return i;
  } else {
    for (let i = start; i < buf.length; i++) if (buf[i] === 0) return i;
  }
  return buf.length;
}

async function id3(fh, head) {
  const ver = head[3];
  const flags = head[5];
  const size = synchsafe(head, 6);
  if (ver < 2 || ver > 4 || size <= 0 || size > 64 * 1024 * 1024) return {};
  let tag = await readAt(fh, 10, size);
  if (flags & 0x80 && ver < 4) { // whole-tag unsynchronisation
    const out = [];
    for (let i = 0; i < tag.length; i++) { out.push(tag[i]); if (tag[i] === 0xff && tag[i + 1] === 0) i++; }
    tag = Buffer.from(out);
  }
  let pos = 0;
  if (flags & 0x40 && ver >= 3) pos += ver === 4 ? synchsafe(tag, 0) : tag.readUInt32BE(0) + 4; // skip extended header
  const res = {};
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  const names = ver === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album', PIC: 'pic' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album', APIC: 'pic' };
  while (pos + hdrLen <= tag.length) {
    const id = tag.toString('latin1', pos, pos + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = ver === 2 ? tag.readUIntBE(pos + 3, 3) : ver === 4 ? synchsafe(tag, pos + 4) : tag.readUInt32BE(pos + 4);
    const fflags = ver === 2 ? 0 : tag[pos + 9];
    const start = pos + hdrLen;
    pos = start + len;
    if (len <= 0 || pos > tag.length) break;
    const key = names[id];
    if (!key || res[key]) continue;
    let data = tag.subarray(start, pos);
    if (ver === 4 && (fflags & 0x0c)) continue; // compressed/encrypted frames: skip
    if (ver === 4 && (fflags & 0x01)) data = data.subarray(4); // data length indicator
    if (ver === 4 && (fflags & 0x02)) { // frame unsynchronisation
      const out = [];
      for (let i = 0; i < data.length; i++) { out.push(data[i]); if (data[i] === 0xff && data[i + 1] === 0) i++; }
      data = Buffer.from(out);
    }
    const enc = data[0];
    if (key !== 'pic') { res[key] = decodeText(enc, data.subarray(1)); continue; }
    let mime, i;
    if (ver === 2) { mime = 'image/' + data.toString('latin1', 1, 4).toLowerCase(); i = 4; }
    else { const e = nulEnd(data, 1, 0); mime = data.toString('latin1', 1, e).toLowerCase(); i = e + 1; }
    i += 1; // picture type
    const d = nulEnd(data, i, enc);
    i = d + (enc === 1 || enc === 2 ? 2 : 1);
    res.pic = picUrl(mime, data.subarray(i));
  }
  return res;
}

// ---------- FLAC ----------
async function flac(fh, fileSize) {
  const res = {};
  let pos = 4;
  for (let n = 0; n < 64 && pos + 4 <= fileSize; n++) {
    const h = await readAt(fh, pos, 4);
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = h.readUIntBE(1, 3);
    pos += 4;
    if (type === 4 && len < 4 * 1024 * 1024) { // VORBIS_COMMENT
      const b = await readAt(fh, pos, len);
      let o = 4 + b.readUInt32LE(0);
      const count = b.readUInt32LE(o); o += 4;
      for (let i = 0; i < count && o + 4 <= b.length; i++) {
        const l = b.readUInt32LE(o); o += 4;
        const s = b.toString('utf8', o, o + l); o += l;
        const eq = s.indexOf('=');
        const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
        if (k === 'TITLE' && !res.title) res.title = v;
        if (k === 'ARTIST' && !res.artist) res.artist = v;
        if (k === 'ALBUM' && !res.album) res.album = v;
      }
    } else if (type === 6 && !res.pic && len <= MAX_PIC + 1024) { // PICTURE
      const b = await readAt(fh, pos, len);
      let o = 4;
      const ml = b.readUInt32BE(o); o += 4;
      const mime = b.toString('latin1', o, o + ml).toLowerCase(); o += ml;
      const dl = b.readUInt32BE(o); o += 4 + dl + 16;
      const pl = b.readUInt32BE(o); o += 4;
      res.pic = picUrl(mime, b.subarray(o, o + pl));
    }
    pos += len;
    if (last) break;
  }
  return res;
}

// ---------- MP4 / M4A ----------
async function boxes(fh, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end && out.length < 500) {
    const h = await readAt(fh, pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let hdr = 8;
    if (size === 1 && h.length >= 16) { size = Number(h.readBigUInt64BE(8)); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < hdr) break;
    out.push({ type, start: pos + hdr, end: Math.min(pos + size, end) });
    pos += size;
  }
  return out;
}
const find = (list, t) => list.find(b => b.type === t);

async function mp4(fh, fileSize) {
  const moov = find(await boxes(fh, 0, fileSize), 'moov');
  if (!moov) return {};
  const udta = find(await boxes(fh, moov.start, moov.end), 'udta');
  if (!udta) return {};
  const meta = find(await boxes(fh, udta.start, udta.end), 'meta');
  if (!meta) return {};
  const ilst = find(await boxes(fh, meta.start + 4, meta.end), 'ilst'); // meta is a full box
  if (!ilst) return {};
  const res = {};
  const keys = { '\xa9nam': 'title', '\xa9ART': 'artist', 'aART': 'artist', '\xa9alb': 'album', covr: 'pic' };
  for (const item of await boxes(fh, ilst.start, ilst.end)) {
    const key = keys[item.type];
    if (!key || res[key]) continue;
    const data = find(await boxes(fh, item.start, item.end), 'data');
    if (!data || data.end - data.start > MAX_PIC + 8) continue;
    const b = await readAt(fh, data.start, data.end - data.start);
    const kind = b.readUInt32BE(0) & 0xffffff;
    const payload = b.subarray(8);
    if (key === 'pic') res.pic = picUrl(kind === 14 ? 'image/png' : 'image/jpeg', payload);
    else res[key] = payload.toString('utf8').trim();
  }
  return res;
}

module.exports = { readTags };
