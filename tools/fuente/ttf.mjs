// Escribe una fuente TrueType y su WOFF a partir de contornos, sin dependencias.
// glyphs: { 'A': { advance, contours: [ [[x, y], [x, y], ...], ... ] }, ... }
// Un contorno es una lista de puntos en unidades de fuente con Y hacia arriba. Un punto [x, y, false]
// es de control cuadrático; los demás están sobre la curva. La dirección se corrige sola por contorno:
// el más grande que contiene a otro es exterior; lo contenido, agujero. Con { hole: true } en el arreglo
// o con la opción fill: 'nonzero-as-is' se puede forzar a mano.
import zlib from 'node:zlib';

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return b; };
const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(Math.round(v)); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };

function checksum(buf) {
  let sum = 0;
  const n = buf.length;
  for (let i = 0; i < n; i += 4) {
    const a = buf[i] << 24 | (buf[i + 1] ?? 0) << 16 | (buf[i + 2] ?? 0) << 8 | (buf[i + 3] ?? 0);
    sum = (sum + (a >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function pad4(buf) {
  const extra = (4 - buf.length % 4) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra)]) : buf;
}

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

function inside(point, poly) {
  const [x, y] = point;
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// En TrueType el relleno va a la derecha del trazo: exterior en sentido horario, agujero al revés.
function orient(contours) {
  return contours.map((pts, i) => {
    const hole = pts.hole ?? contours.some((other, j) => j !== i && Math.abs(area(other)) > Math.abs(area(pts)) && inside(pts[0], other));
    const clockwise = area(pts) < 0;
    return hole === clockwise ? [...pts].reverse() : pts;
  });
}

function encodeGlyph(contours) {
  if (!contours.length) return { data: Buffer.alloc(0), bbox: [0, 0, 0, 0], points: 0 };
  const list = orient(contours).map((c) => c.map(([x, y, on]) => [Math.round(x), Math.round(y), on !== false]));
  const all = list.flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const parts = [i16(list.length), ...bbox.map(i16)];
  let end = -1;
  for (const c of list) { end += c.length; parts.push(u16(end)); }
  parts.push(u16(0));
  const flags = Buffer.alloc(all.length);
  all.forEach((p, i) => { flags[i] = (p[2] ? 1 : 0) | (i === 0 ? 0x40 : 0); });
  parts.push(flags);
  let prev = 0;
  for (const p of all) { parts.push(i16(p[0] - prev)); prev = p[0]; }
  prev = 0;
  for (const p of all) { parts.push(i16(p[1] - prev)); prev = p[1]; }
  return { data: pad4(Buffer.concat(parts)), bbox, points: all.length };
}

function cmapTable(codes) {
  // codes: lista ordenada de [unicode, índice de glifo]; formato 4, solo plano básico.
  const segs = [];
  for (const [code, gid] of codes) {
    const last = segs[segs.length - 1];
    if (last && code === last.end + 1 && gid === last.gid + (code - last.start)) last.end = code;
    else segs.push({ start: code, end: code, gid });
  }
  segs.push({ start: 0xffff, end: 0xffff, gid: 0, last: true });
  const segCount = segs.length;
  const search = 2 * 2 ** Math.floor(Math.log2(segCount));
  const sub = [u16(4), u16(16 + segCount * 8), u16(0), u16(segCount * 2), u16(search), u16(Math.log2(search / 2)), u16(segCount * 2 - search)];
  for (const s of segs) sub.push(u16(s.end));
  sub.push(u16(0));
  for (const s of segs) sub.push(u16(s.start));
  for (const s of segs) sub.push(u16(s.last ? 1 : (s.gid - s.start) & 0xffff));
  for (const _ of segs) sub.push(u16(0));
  const body = Buffer.concat(sub);
  return Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
}

function nameTable(records) {
  const strings = [], entries = [];
  let offset = 0;
  for (const [id, text] of records) {
    const buf = Buffer.from(text, 'utf16le').swap16();
    entries.push(u16(3), u16(1), u16(0x0409), u16(id), u16(buf.length), u16(offset));
    strings.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([u16(0), u16(records.length), u16(6 + records.length * 12), ...entries, ...strings]);
}

export function buildFont({ family, style = 'Regular', weight = 400, unitsPerEm = 1000, ascent = 800, descent = -200, capHeight = 700, xHeight = 500, glyphs, kerning = null, version = '1.000' }) {
  const chars = Object.keys(glyphs).map((c) => [c, c.codePointAt(0)]).sort((a, b) => a[1] - b[1]);
  const notdef = { advance: Math.round(unitsPerEm * .5), contours: [] };
  const list = [notdef, ...chars.map(([c]) => glyphs[c])];
  const encoded = list.map((g) => encodeGlyph(g.contours ?? []));
  const codes = chars.map(([, code], i) => [code, i + 1]);
  const gidOf = new Map(chars.map(([c], i) => [c, i + 1]));

  const glyf = Buffer.concat(encoded.map((e) => e.data));
  const locaParts = [];
  let off = 0;
  for (const e of encoded) { locaParts.push(u32(off)); off += e.data.length; }
  locaParts.push(u32(off));
  const loca = Buffer.concat(locaParts);

  const boxes = encoded.filter((e) => e.points).map((e) => e.bbox);
  const xMin = Math.min(...boxes.map((b) => b[0])), yMin = Math.min(...boxes.map((b) => b[1]));
  const xMax = Math.max(...boxes.map((b) => b[2])), yMax = Math.max(...boxes.map((b) => b[3]));

  const head = Buffer.concat([u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(0x000b), u16(unitsPerEm), u32(0), u32(0), u32(0), u32(0), i16(xMin), i16(yMin), i16(xMax), i16(yMax), u16(0), u16(8), i16(2), i16(1), i16(0)]);
  const advances = list.map((g) => Math.round(g.advance));
  const lsb = encoded.map((e) => e.bbox[0]);
  const hhea = Buffer.concat([u32(0x00010000), i16(ascent), i16(descent), i16(0), u16(Math.max(...advances)), i16(Math.min(...lsb)), i16(Math.min(...encoded.map((e, i) => advances[i] - e.bbox[2]))), i16(xMax), i16(1), i16(0), i16(0), i16(0), i16(0), i16(0), i16(0), i16(0), u16(list.length)]);
  const hmtx = Buffer.concat(list.flatMap((_, i) => [u16(advances[i]), i16(lsb[i])]));
  const maxPoints = Math.max(...encoded.map((e) => e.points));
  const maxContours = Math.max(...list.map((g) => (g.contours ?? []).length));
  const maxp = Buffer.concat([u32(0x00010000), u16(list.length), u16(maxPoints), u16(maxContours), u16(0), u16(0), u16(1), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0)]);
  const firstChar = chars[0][1], lastChar = Math.min(chars[chars.length - 1][1], 0xffff);
  const avg = Math.round(advances.reduce((a, b) => a + b, 0) / advances.length);
  const os2 = Buffer.concat([u16(3), i16(avg), u16(weight), u16(5), u16(0),
    i16(unitsPerEm * .65), i16(unitsPerEm * .7), i16(0), i16(unitsPerEm * .14), i16(unitsPerEm * .65), i16(unitsPerEm * .7), i16(0), i16(unitsPerEm * .48),
    i16(unitsPerEm * .05), i16(unitsPerEm * .26), i16(0), Buffer.alloc(10), u32(1), u32(0), u32(0), u32(0), Buffer.from('BZKO'), u16(0x0040), u16(firstChar), u16(lastChar),
    i16(ascent), i16(descent), i16(0), u16(ascent), u16(-descent), u32(1), u32(0), i16(xHeight), i16(capHeight), u16(0), u16(32), u16(1)]);
  const post = Buffer.concat([u32(0x00030000), u32(0), i16(-unitsPerEm * .1), i16(unitsPerEm * .05), u32(0), u32(0), u32(0), u32(0), u32(0)]);
  const safeName = family.replace(/\s+/g, '');
  const name = nameTable([[1, family], [2, style], [3, `${version};${safeName}-${style}`], [4, `${family} ${style}`], [5, `Version ${version}`], [6, `${safeName}-${style}`]]);
  const cmap = cmapTable(codes);

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post };
  if (kerning && Object.keys(kerning).length) {
    const pairs = [];
    for (const [pair, value] of Object.entries(kerning)) {
      const [a, b] = [...pair];
      if (gidOf.has(a) && gidOf.has(b)) pairs.push([gidOf.get(a), gidOf.get(b), value]);
    }
    pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const search = 6 * 2 ** Math.floor(Math.log2(pairs.length || 1));
    const sub = [u16(0), u16(14 + pairs.length * 6), u16(1), u16(pairs.length), u16(search), u16(Math.floor(Math.log2(pairs.length || 1))), u16(pairs.length * 6 - search)];
    for (const [l, r, v] of pairs) sub.push(u16(l), u16(r), i16(v));
    tables.kern = Buffer.concat([u16(0), u16(1), ...sub]);
  }

  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  const search = 16 * 2 ** Math.floor(Math.log2(numTables));
  const header = Buffer.concat([u32(0x00010000), u16(numTables), u16(search), u16(Math.log2(search / 16)), u16(numTables * 16 - search)]);
  const dir = [], bodies = [];
  let offset = 12 + numTables * 16;
  for (const tag of tags) {
    const data = tables[tag];
    dir.push(Buffer.from(tag.padEnd(4, ' ')), u32(checksum(data)), u32(offset), u32(data.length));
    const padded = pad4(data);
    bodies.push(padded);
    offset += padded.length;
  }
  const ttf = Buffer.concat([header, ...dir, ...bodies]);
  // checkSumAdjustment de head, en el desplazamiento 8 de la tabla.
  const headOffset = 12 + numTables * 16 + tags.slice(0, tags.indexOf('head')).reduce((s, t) => s + pad4(tables[t]).length, 0);
  ttf.writeUInt32BE((0xb1b0afba - checksum(ttf)) >>> 0, headOffset + 8);

  // WOFF 1: las mismas tablas comprimidas una por una.
  const adjustedHead = ttf.subarray(headOffset, headOffset + head.length);
  const finalTables = { ...tables, head: Buffer.from(adjustedHead) };
  const wDir = [], wBodies = [];
  let wOffset = 44 + numTables * 20;
  for (const tag of tags) {
    const data = finalTables[tag];
    const packed = zlib.deflateSync(data, { level: 9 });
    const use = packed.length < data.length ? packed : data;
    wDir.push(Buffer.from(tag.padEnd(4, ' ')), u32(wOffset), u32(use.length), u32(data.length), u32(checksum(tables[tag])));
    const padded = pad4(use);
    wBodies.push(padded);
    wOffset += padded.length;
  }
  const wHeader = Buffer.concat([Buffer.from('wOFF'), u32(0x00010000), u32(wOffset), u16(numTables), u16(0), u32(ttf.length), u16(1), u16(0), u32(0), u32(0), u32(0), u32(0), u32(0)]);
  const woff = Buffer.concat([wHeader, ...wDir, ...wBodies]);
  return { ttf, woff };
}
