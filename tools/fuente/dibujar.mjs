// Dibuja la letra del juego, «Dios Le Pague», en sus dos cortes: Grueso y Fino.
// Uso: npm run fuente. Escribe en src/ui/fuentes/ los .woff, el manifiesto y la tabla de dibujos.
// Repetido en un mismo equipo da los mismos bytes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildFont } from './ttf.mjs';
import { inkStrokes, bbox, rnd } from './nib.mjs';
import { CAPS, DIGITS, SIGNS, sideUnits } from './mayusculas.mjs';
import { LOWER, ACENTOS_FINO } from './minusculas.mjs';
import { DIBUJOS, NOMBRES } from './dibujos.mjs';
import { leerCmap } from './woff.mjs';

const SALIDA = process.argv[2] ?? fileURLToPath(new URL('../../src/ui/fuentes/', import.meta.url));

// ---------- las dos puntas ----------
const GRUESO = { angle: 28, w: 146, t: 48, r: 16 };
const ANCHO_GRUESO = .9; // letra alta y apretada: se lee como letrero, no como cómic
const FINO = { angle: 26, w: 112, t: 76, r: 28 }; // el más delgado que se lee a 16 px sobre cartón mojado y en celular
const ANCHO_FINO = 1.08; // con este grueso la letra necesita aire: un poco más ancha que la mano natural
const DIBUJO = { angle: 30, w: 92, t: 44, r: 14 };

// ---------- acentos ----------
const accentStrokes = {
  acute: (cx, y) => [{ kind: 'poly', pts: [[cx - 26, y + 8], [cx + 40, y + 116]], amp: 0 }],
  tilde: (cx, y) => [{ kind: 'curve', pts: [[cx - 130, y + 14], [cx - 70, y + 74], [cx, y + 46], [cx + 66, y + 22], [cx + 130, y + 84]], amp: 0, nib: { w: 80, t: 46 } }],
  dier: (cx, y) => [
    { kind: 'poly', pts: [[cx - 90, y + 24], [cx - 76, y + 76]], amp: 0 },
    { kind: 'poly', pts: [[cx + 76, y + 24], [cx + 90, y + 76]], amp: 0 },
  ],
};

// ---------- montar un glifo ----------
// tol: a 200 px de letra, 1,4 unidades de fuente son menos de 0,3 px y le quitan a cada archivo 13 KB.
const TOL = 1.4;
function compose(strokes, { nib, seed, amp, transform, sides, tol = TOL, shake = 0 }) {
  const contours = inkStrokes(strokes, { nib, seed, amp, transform, tol, shake });
  const box = bbox(contours);
  const [ls, rs] = sides;
  const shift = ls - box.x0;
  const moved = contours.map((c) => {
    const m = c.map(([x, y]) => [x + shift, y]);
    m.hole = false;
    return m;
  });
  return { advance: Math.round(box.x1 - box.x0 + ls + rs), contours: moved };
}

// La mano no repite: cada variante cambia un poco tamaño, inclinación, línea de base y ángulo de la punta.
function variation(index, seed, strength = 1) {
  if (index === 0) return { dy: 0, sx: 1, rot: 0, angle: 0 };
  const r = rnd(seed * 97 + index * 13);
  const pick = (a) => (r() * 2 - 1) * a * strength;
  const dy = (index === 1 ? 1 : -1) * (6 + r() * 7) * strength;
  return { dy, sx: 1 + pick(.022), rot: (index === 1 ? -1 : 1) * (.5 + r() * .7) * strength, angle: pick(3) };
}

function xform({ dy, sx, sy = 1, rot }, cx = 200) {
  const a = rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return ([x, y]) => {
    const X = (x - cx) * sx, Y = (y - 340) * sy;
    return [cx + X * ca - Y * sa, 340 * sy + X * sa + Y * ca + dy];
  };
}

/** Todas las variantes de una letra del catálogo. */
function drawForms(entry, ch, cfg) {
  const { nib, amp, scale = null, sides = null, shake = 0 } = cfg;
  const forms = entry.forms;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const form = forms[i % forms.length];
    const seed = ch.codePointAt(0) + i * 211 + (cfg.seedBase ?? 0);
    const v = variation(i, ch.codePointAt(0) + (cfg.seedBase ?? 0));
    const trans = xform({ dy: v.dy, sx: v.sx * (scale?.sx ?? 1), sy: scale?.sy ?? 1, rot: v.rot });
    const adjNib = { ...nib, angle: nib.angle + v.angle };
    out.push(compose(form, { nib: adjNib, seed, amp, transform: trans, sides: sides ?? sideUnits(entry.side ?? 'ss'), shake }));
  }
  return out;
}

// Todas las cifras, en todas sus formas, miden lo mismo: una columna de cifras no baila.
function igualarCifras(formas, margen) {
  const ancho = Math.max(...formas.map((g) => { const b = bbox(g.contours); return b.x1 - b.x0; }));
  const avance = Math.round(ancho + margen * 2);
  for (const g of formas) {
    const b = bbox(g.contours), corre = (avance - (b.x1 - b.x0)) / 2 - b.x0;
    g.contours = g.contours.map((c) => { const m = c.map(([x, y]) => [x + corre, y]); m.hole = false; return m; });
    g.advance = avance;
  }
}

// ---------- acentos sobre letra ya hecha ----------
function withAccent(base, kind, { y, nib, seed, cx = null, shake = 0 }) {
  const box = bbox(base.contours);
  const center = cx ?? (box.x0 + box.x1) / 2;
  const contours = inkStrokes(accentStrokes[kind](center, y), { nib, seed, amp: 2, shake, tol: TOL }).map((c) => { c.hole = false; return c; });
  return { advance: base.advance, contours: [...base.contours, ...contours] };
}

// ---------- GSUB: alternar formas en cada palabra ----------
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };

function coverage(gids) {
  const sorted = [...gids].sort((a, b) => a - b);
  return Buffer.concat([u16(1), u16(sorted.length), ...sorted.map(u16)]);
}

function singleSubst(pairs) {
  // Formato 2: cobertura ordenada y sustitutos en el mismo orden.
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const cov = coverage(sorted.map((p) => p[0]));
  const head = Buffer.concat([u16(2), u16(6 + sorted.length * 2), u16(sorted.length), ...sorted.map((p) => u16(p[1]))]);
  return Buffer.concat([head, cov]);
}

function chainFormat3(backtrack, input, lookupIndex) {
  // Un glifo atrás, un glifo de entrada, nada adelante.
  const covB = coverage(backtrack), covI = coverage(input);
  const headLen = 2 + 2 + 2 + 2 + 2 + 2 + 2 + 4;
  const head = Buffer.concat([u16(3), u16(1), u16(headLen), u16(1), u16(headLen + covB.length), u16(0), u16(1), u16(0), u16(lookupIndex)]);
  return Buffer.concat([head, covB, covI]);
}

function lookup(type, subtables) {
  const headLen = 6 + subtables.length * 2;
  let off = headLen;
  const offs = subtables.map((s) => { const o = off; off += s.length; return u16(o); });
  return Buffer.concat([u16(type), u16(0), u16(subtables.length), ...offs, ...subtables]);
}

function gsubCalt(baseGids, alt1Pairs, alt2Pairs, alt1Gids) {
  const l1 = lookup(1, [singleSubst(alt1Pairs)]);
  const l2 = lookup(1, [singleSubst(alt2Pairs)]);
  const l0 = lookup(6, [
    chainFormat3(alt1Gids, baseGids, 2), // después de la primera variante va la segunda
    chainFormat3(baseGids, baseGids, 1), // después de la base va la primera
  ]);
  const lookups = [l0, l1, l2];
  const listHead = 2 + lookups.length * 2;
  let off = listHead;
  const lookupOffs = lookups.map((x) => { const o = off; off += x.length; return u16(o); });
  const lookupList = Buffer.concat([u16(lookups.length), ...lookupOffs, ...lookups]);
  const feature = Buffer.concat([u16(0), u16(1), u16(0)]);
  const featureList = Buffer.concat([u16(1), Buffer.from('calt'), u16(8), feature]);
  const langSys = Buffer.concat([u16(0), u16(0xffff), u16(1), u16(0)]);
  const script = Buffer.concat([u16(4), u16(0), langSys]);
  const scriptList = Buffer.concat([u16(2), Buffer.from('DFLT'), u16(14), Buffer.from('latn'), u16(14 + 0), script]);
  const header = 10;
  return Buffer.concat([u32(0x00010000), u16(header), u16(header + scriptList.length), u16(header + scriptList.length + featureList.length), scriptList, featureList, lookupList]);
}

// ---------- añadir una tabla al TTF ya armado y sacar el WOFF ----------
function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i] << 24 | (buf[i + 1] ?? 0) << 16 | (buf[i + 2] ?? 0) << 8 | (buf[i + 3] ?? 0);
    sum = (sum + (a >>> 0)) >>> 0;
  }
  return sum >>> 0;
}
const pad4 = (b) => { const e = (4 - b.length % 4) % 4; return e ? Buffer.concat([b, Buffer.alloc(e)]) : b; };

function packFont(ttfIn, extra) {
  const n = ttfIn.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = ttfIn.toString('latin1', o, o + 4);
    tables[tag] = ttfIn.subarray(ttfIn.readUInt32BE(o + 8), ttfIn.readUInt32BE(o + 8) + ttfIn.readUInt32BE(o + 12));
  }
  Object.assign(tables, extra);
  tables.head = Buffer.from(tables.head);
  tables.head.writeUInt32BE(0, 8);
  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  const search = 16 * 2 ** Math.floor(Math.log2(numTables));
  const header = Buffer.concat([u32(0x00010000), u16(numTables), u16(search), u16(Math.log2(search / 16)), u16(numTables * 16 - search)]);
  const dir = [], bodies = [];
  let offset = 12 + numTables * 16, headOffset = 0;
  for (const tag of tags) {
    const data = tables[tag];
    dir.push(Buffer.from(tag.padEnd(4, ' '), 'latin1'), u32(checksum(data)), u32(offset), u32(data.length));
    if (tag === 'head') headOffset = offset;
    const padded = pad4(data);
    bodies.push(padded);
    offset += padded.length;
  }
  const ttf = Buffer.concat([header, ...dir, ...bodies]);
  ttf.writeUInt32BE((0xb1b0afba - checksum(ttf)) >>> 0, headOffset + 8);
  const finalHead = Buffer.from(ttf.subarray(headOffset, headOffset + tables.head.length));
  const wDir = [], wBodies = [];
  let wOffset = 44 + numTables * 20;
  for (const tag of tags) {
    const data = tag === 'head' ? finalHead : tables[tag];
    const zipped = zlib.deflateSync(data, { level: 9 });
    const use = zipped.length < data.length ? zipped : data;
    wDir.push(Buffer.from(tag.padEnd(4, ' '), 'latin1'), u32(wOffset), u32(use.length), u32(data.length), u32(checksum(tables[tag])));
    const padded = pad4(use);
    wBodies.push(padded);
    wOffset += padded.length;
  }
  const wHeader = Buffer.concat([Buffer.from('wOFF'), u32(0x00010000), u32(wOffset), u16(numTables), u16(0), u32(ttf.length), u16(1), u16(0), u32(0), u32(0), u32(0), u32(0), u32(0)]);
  return { ttf, woff: Buffer.concat([wHeader, ...wDir, ...wBodies]) };
}

// ---------- catálogos ----------
const PUA_START = { alt1: 0xE300, alt2: 0xE500 };

const KERN_PAIRS = {
  AV: -70, AW: -50, AY: -70, AT: -60, AO: -16, AC: -16, AG: -16, AU: -14, AQ: -16,
  VA: -70, WA: -50, YA: -70, TA: -60, OA: -16, CA: -6, DA: -22, GA: -8, PA: -60, FA: -46, RA: -6, UA: -10,
  LT: -46, LV: -54, LW: -40, LY: -54, LO: -14, LU: -10,
  TO: -40, TE: -22, TI: -4, TC: -30, TG: -30, TS: -18, TR: -10, TU: -8,
  OT: -26, OV: -22, OW: -14, OY: -26, OX: -16, VO: -22, WO: -14, YO: -30, XO: -14,
  KO: -22, KE: -6, RT: -12, RO: -8, RV: -14, RY: -18, FO: -18, FE: -4, PO: -8, PE: -4,
  ST: -8, SA: -4, EA: -2, ZA: -2, EJ: -10, LA: 6, BA: -10, NA: -2, MA: -2,
  'P.': -90, 'T.': -70, 'V.': -70, 'Y.': -70, 'F.': -60,
};

function buildGrueso() {
  const nib = GRUESO, glyphs = {}, cfg = { nib, amp: 5, scale: { sx: ANCHO_GRUESO, sy: 1 } };
  const base = [], alt1 = [], alt2 = [];
  const bigAccentY = 748, smallAccentY = 650;
  const cps = new Map();
  let aI = 0;

  const addLetter = (ch, entry, cfgLetter) => {
    const forms = drawForms(entry, ch, cfgLetter);
    glyphs[ch] = forms[0];
    const a1 = String.fromCodePoint(PUA_START.alt1 + aI), a2 = String.fromCodePoint(PUA_START.alt2 + aI);
    glyphs[a1] = forms[1];
    glyphs[a2] = forms[2];
    base.push(ch); alt1.push(a1); alt2.push(a2);
    cps.set(ch, [a1, a2]);
    aI++;
    return forms;
  };

  const smallCfg = { ...cfg, scale: { sx: .94 * ANCHO_GRUESO, sy: .84 }, seedBase: 500 };
  const capForms = {};
  for (const [ch, entry] of Object.entries(CAPS)) {
    if (entry.copy) continue;
    capForms[ch] = addLetter(ch, entry, cfg);
    addLetter(ch.toLowerCase(), entry, smallCfg);
  }
  igualarCifras(Object.entries(DIGITS).flatMap(([ch, entry]) => addLetter(ch, entry, cfg)), 22);

  // Letras con acento: base más acento. Sin variantes; con esas basta.
  for (const [ch, entry] of Object.entries(CAPS)) {
    if (!entry.copy) continue;
    const seed = ch.codePointAt(0);
    glyphs[ch] = withAccent(glyphs[entry.copy], entry.accent, { y: bigAccentY, nib: { ...nib, w: 100, t: 54 }, seed });
    const lower = ch.toLowerCase();
    glyphs[lower] = withAccent(glyphs[entry.copy.toLowerCase()], entry.accent, { y: smallAccentY, nib: { ...nib, w: 100, t: 54 }, seed: seed + 3 });
  }

  // Signos
  for (const [ch, entry] of Object.entries(SIGNS)) {
    if (entry.copy) continue;
    const forms = drawForms(entry, ch, { ...cfg, amp: 2.5 });
    glyphs[ch] = forms[0];
  }
  for (const [ch, entry] of Object.entries(SIGNS)) if (entry.copy) glyphs[ch] = glyphs[entry.copy];
  glyphs[' '] = { advance: 230, contours: [] };
  invisibles(glyphs, 230);

  addDrawings(glyphs);

  // Parejas con todas sus variantes
  const kerning = {};
  const every = (ch) => [ch, ...(cps.get(ch) ?? [])];
  for (const [pair, value] of Object.entries(KERN_PAIRS)) {
    const [a, b] = [...pair];
    const lowerPair = /[A-Z]/.test(a) && /[A-Z]/.test(b);
    for (const x of every(a)) for (const y of every(b)) kerning[x + y] = value;
    if (lowerPair) {
      for (const x of every(a.toLowerCase())) for (const y of every(b.toLowerCase())) kerning[x + y] = Math.round(value * .88);
      for (const x of every(a)) for (const y of every(b.toLowerCase())) kerning[x + y] = Math.round(value * .9);
    }
  }
  return { glyphs, kerning, base, alt1, alt2, cifras: [...'0123456789'].flatMap(every) };
}

// Espacio duro, y los dos caracteres sin dibujo con que se arman los emojis: si uno se cuela, no pide otra letra.
function invisibles(glyphs, espacio) {
  glyphs['\u00a0'] = { advance: espacio, contours: [] };
  glyphs['\u200d'] = { advance: 0, contours: [] };
  glyphs['\ufe0f'] = { advance: 0, contours: [] };
}

function addDrawings(glyphs) {
  for (const [code, entry] of Object.entries(DIBUJOS)) {
    const ch = String.fromCodePoint(Number(code));
    const contours = inkStrokes(entry.s, { nib: { ...DIBUJO, ...(entry.nib ?? {}) }, seed: Number(code) & 255, amp: entry.amp ?? 3, tol: TOL });
    const box = bbox(contours);
    const pad = 40, w = box.x1 - box.x0;
    const moved = contours.map((c) => { const m = c.map(([x, y]) => [x - box.x0 + pad, y]); m.hole = false; return m; });
    glyphs[ch] = { advance: Math.round(w + pad * 2), contours: moved };
  }
}

function buildFino() {
  const nib = FINO, glyphs = {};
  const cfg = { nib, amp: 3, seedBase: 1000 };
  const base = [], alt1 = [], alt2 = [];
  const cps = new Map();
  let aI = 0;
  const addLetter = (ch, entry, cf, sides) => {
    const forms = drawForms(entry, ch, { ...cf, sides });
    glyphs[ch] = forms[0];
    const a1 = String.fromCodePoint(PUA_START.alt1 + aI), a2 = String.fromCodePoint(PUA_START.alt2 + aI);
    glyphs[a1] = forms[1];
    glyphs[a2] = forms[2];
    base.push(ch); alt1.push(a1); alt2.push(a2);
    cps.set(ch, [a1, a2]);
    aI++;
    return forms;
  };
  const SF = { s: 60, r: 46, d: 26, a: 14 };
  const sidesOf = (code) => [SF[code[0]] ?? 40, SF[code[1]] ?? 40];
  for (const [ch, entry] of Object.entries(CAPS)) {
    if (entry.copy) continue;
    addLetter(ch, entry, { ...cfg, scale: { sx: .9, sy: 1 } }, sidesOf(entry.side ?? 'ss'));
  }
  igualarCifras(Object.entries(DIGITS).flatMap(([ch, entry]) => addLetter(ch, entry, { ...cfg, scale: { sx: .9, sy: 1 } }, sidesOf(entry.side ?? 'ss'))), 30);
  for (const [ch, entry] of Object.entries(LOWER)) addLetter(ch, entry, { ...cfg, scale: { sx: ANCHO_FINO, sy: 1 } }, entry.lados ?? sidesOf(entry.side ?? 'ss'));
  // Acentos
  for (const [ch, entry] of Object.entries(CAPS)) {
    if (!entry.copy) continue;
    glyphs[ch] = withAccent(glyphs[entry.copy], entry.accent, { y: 744, nib: { ...nib, w: 88, t: 54 }, seed: ch.codePointAt(0) });
  }
  for (const [ch, def] of Object.entries(ACENTOS_FINO)) {
    glyphs[ch] = withAccent(glyphs[def.base], def.accent, { y: def.y, nib: { ...nib, w: 88, t: 54 }, seed: ch.codePointAt(0), cx: null });
  }
  for (const [ch, entry] of Object.entries(SIGNS)) {
    if (entry.copy) continue;
    const forms = drawForms(entry, ch, { ...cfg, amp: 1.5, nib: { ...nib } });
    glyphs[ch] = forms[0];
  }
  for (const [ch, entry] of Object.entries(SIGNS)) if (entry.copy) glyphs[ch] = glyphs[entry.copy];
  glyphs[' '] = { advance: 250, contours: [] };
  invisibles(glyphs, 250);
  addDrawings(glyphs);
  const kerning = {};
  const every = (ch) => [ch, ...(cps.get(ch) ?? [])];
  for (const [pair, value] of Object.entries(KERN_PAIRS)) {
    const [a, b] = [...pair];
    for (const x of every(a)) for (const y of every(b)) kerning[x + y] = Math.round(value * .6);
  }
  for (const [pair, value] of Object.entries({ 'r.': -40, 'r,': -40, 'y.': -40, 'y,': -40, 'v.': -30, 'f.': -20, 'Te': -50, 'Ta': -50, 'To': -50, 'Tu': -40, 'Ya': -40, 'Ve': -20, 'Vi': -14, 'ra': -8, 'ro': -8, 'ta': -6, 'fa': -6, 'fe': -8, 'fo': -8, 'Pa': -24, 'Pe': -14, 'Fa': -24, 'Fe': -14 })) {
    const [a, b] = [...pair];
    for (const x of every(a)) for (const y of every(b)) kerning[x + y] = value;
  }
  return { glyphs, kerning, base, alt1, alt2, cifras: [...'0123456789'].flatMap(every) };
}

function emit({ glyphs, kerning, base, alt1, alt2 }, family, style, weight, file, metrics) {
  const { ttf } = buildFont({ family, style, weight, unitsPerEm: 1000, ascent: metrics.ascent, descent: metrics.descent, capHeight: 700, xHeight: metrics.xHeight, glyphs, kerning });
  // buildFont ordena por punto de código: el índice de glifo se deduce igual.
  const ordered = Object.keys(glyphs).map((c) => [c, c.codePointAt(0)]).sort((a, b) => a[1] - b[1]);
  const gid = new Map(ordered.map(([c], i) => [c, i + 1]));
  const baseG = base.map((c) => gid.get(c));
  const alt1G = alt1.map((c) => gid.get(c));
  const gsub = gsubCalt(baseG, base.map((c, i) => [gid.get(c), gid.get(alt1[i])]), base.map((c, i) => [gid.get(c), gid.get(alt2[i])]), alt1G);
  const { woff } = packFont(ttf, { GSUB: gsub });
  fs.writeFileSync(path.join(SALIDA, `${file}.woff`), woff);
  console.log(file, 'glifos', ordered.length, 'woff', woff.length);
  return woff;
}

// Rangos [desde, hasta] de los puntos de código, para que el manifiesto se pueda leer.
function rangos(codigos) {
  const out = [];
  for (const c of codigos) {
    const u = out[out.length - 1];
    if (u && u[1] === c - 1) u[1] = c;
    else out.push([c, c]);
  }
  return out;
}

fs.mkdirSync(SALIDA, { recursive: true });
const cortes = { grueso: buildGrueso(), fino: buildFino() };
const grueso = emit(cortes.grueso, 'Dios Le Pague', 'Grueso', 800, 'dios-le-pague-grueso', { ascent: 960, descent: -240, xHeight: 590 });
const fino = emit(cortes.fino, 'Dios Le Pague', 'Fino', 400, 'dios-le-pague-fino', { ascent: 960, descent: -240, xHeight: 500 });
const puntos = (cadenas) => cadenas.map((c) => c.codePointAt(0));

fs.writeFileSync(path.join(SALIDA, 'manifiesto.json'), `${JSON.stringify({ grueso: rangos(leerCmap(grueso)), fino: rangos(leerCmap(fino)), cifras: { grueso: puntos(cortes.grueso.cifras), fino: puntos(cortes.fino.cifras) } })}\n`);

// Nombre de cada dibujo y su carácter. La interfaz los pide por nombre, nunca por punto de código.
const escapar = (code) => `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
const filas = Object.entries(NOMBRES).map(([n, code]) => `  ${/^[a-zA-Z]\w*$/.test(n) ? n : `'${n}'`}: '${escapar(code)}',`).join('\n');
fs.writeFileSync(path.join(SALIDA, 'dibujos.js'), `// Generado por tools/fuente/dibujar.mjs: no editar a mano.\nexport const DIBUJOS = {\n${filas}\n};\n`);
