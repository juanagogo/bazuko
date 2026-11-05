// Lee del WOFF lo que hay que comprobar: lo que trae por dentro, sus caracteres y lo que mide cada uno. Sin dependencias.
import zlib from 'node:zlib';

/** Las tablas de la fuente, ya sin comprimir. */
export function tablas(woff) {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('no es un WOFF');
  const n = woff.readUInt16BE(12), out = {};
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const tag = woff.toString('latin1', o, o + 4).trim();
    const offset = woff.readUInt32BE(o + 4), comp = woff.readUInt32BE(o + 8), orig = woff.readUInt32BE(o + 12);
    const data = woff.subarray(offset, offset + comp);
    out[tag] = comp === orig ? Buffer.from(data) : zlib.inflateSync(data);
  }
  return out;
}

function cmapDeTabla(cmap) {
  // Una subtabla de formato 4: la única que escribe ttf.mjs.
  const sub = cmap.readUInt32BE(8);
  const segCount = cmap.readUInt16BE(sub + 6) / 2;
  const endO = sub + 14, startO = endO + segCount * 2 + 2, deltaO = startO + segCount * 2;
  const mapa = new Map();
  for (let s = 0; s < segCount; s++) {
    const end = cmap.readUInt16BE(endO + s * 2), start = cmap.readUInt16BE(startO + s * 2), delta = cmap.readUInt16BE(deltaO + s * 2);
    if (start === 0xffff) continue;
    for (let c = start; c <= end; c++) mapa.set(c, (c + delta) & 0xffff);
  }
  return mapa;
}

/** Puntos de código de la fuente, en orden. */
export function leerCmap(woff) {
  return [...cmapDeTabla(tablas(woff).cmap).keys()].sort((a, b) => a - b);
}

/** Lo que avanza cada carácter, en unidades de fuente. */
export function leerAvances(woff) {
  const t = tablas(woff), mapa = cmapDeTabla(t.cmap), avances = new Map();
  const nLargos = t.hhea.readUInt16BE(34);
  for (const [code, gid] of mapa) avances.set(code, t.hmtx.readUInt16BE(Math.min(gid, nLargos - 1) * 4));
  return avances;
}
