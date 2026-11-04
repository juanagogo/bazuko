// BAZUKO trazo por trazo: la misma punta y los mismos esqueletos de la letra Grueso, sin pasar por el archivo de la letra.
// Por eso la pantalla de carga puede escribir la palabra antes de que llegue la letra, y escribirla de verdad:
// cada trazo guarda su tinta y su lomo, en el orden en que los hace la mano.
// Uso: npm run fuente. Escribe src/ui/marcaBazuko.js.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAPS, sideUnits } from './mayusculas.mjs';
import { inkStrokes, sampleStroke, simplify, bbox } from './nib.mjs';

const PUNTA = { angle: 28, w: 146, t: 48, r: 16 }; // la del Grueso
const ANCHO = .9;
const PALABRA = 'BAZUKO';
const TOLERANCIA = 2; // en unidades de la letra: a 1440 de ancho es menos de medio punto
const ESPACIO = 22; // la palabra es grande: se aprieta más que en un texto

const n = (v) => Math.round(v);
const lleno = (pts) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
const lomo = (pts) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}`;
const largo = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

export function construirMarca() {
  let x = 0, arriba = Infinity, abajo = -Infinity;
  const trazos = [];
  [...PALABRA].forEach((letra, l) => {
    const entrada = CAPS[letra];
    const esqueletos = entrada.forms[0];
    const estirar = ([px, py]) => [px * ANCHO, py];
    const semilla = letra.codePointAt(0);
    const contornos = inkStrokes(esqueletos, { nib: PUNTA, seed: semilla, amp: 4, transform: estirar, tol: TOLERANCIA });
    const caja = bbox(contornos);
    const corre = x - caja.x0 + (l ? sideUnits(entrada.side)[0] * .4 : 0);
    esqueletos.forEach((esq, i) => {
      // La misma semilla que usa inkStrokes para este trazo: el lomo va por donde fue la tinta.
      const puntos = sampleStroke(esq, { seed: semilla * 31 + i * 7 + 1, amp: 4 }).map(estirar).map(([px, py]) => [px + corre, -py]);
      const tinta = contornos[i].map(([px, py]) => [px + corre, -py]);
      for (const [, py] of tinta) { arriba = Math.min(arriba, py); abajo = Math.max(abajo, py); }
      trazos.push({ tinta, lomo: simplify(puntos, 1.5) });
    });
    x = corre + caja.x1 + ESPACIO;
  });
  const ancho = n(x - ESPACIO);
  return {
    ancho,
    alto: n(abajo - arriba),
    arriba: n(arriba),
    trazos: trazos.map((t) => ({ tinta: lleno(t.tinta), lomo: lomo(t.lomo), largo: n(largo(t.lomo)) })),
  };
}

export function moduloDeMarca() {
  const m = construirMarca();
  return `// Generado por tools/fuente/marca.mjs (npm run fuente). No se edita a mano.
// BAZUKO, trazo por trazo: la tinta de cada trazo y el lomo por donde pasó la punta.
export const MARCA = ${JSON.stringify(m)};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = process.argv[2] ?? fileURLToPath(new URL('../../src/ui/marcaBazuko.js', import.meta.url));
  fs.writeFileSync(destino, moduloDeMarca());
}
