// src/world/bogota/CityEdge.js
// Borde de la ciudad: el tile 'wall' sigue sólido, pero se ve como lo que hay en una ciudad cuando
// no se puede pasar: cierres de obra en las calles, reja y seto en los parques y edificios detrás.
import * as THREE from 'three';
import { Batch, ALL_FACES, SKIN, NO_BACK, FACES } from './ZoneGeometry.js';
import { detailRect } from './ZoneTextures.js';

const T = 2;
const STREET = new Set(['road', 'busway', 'sidewalk', 'floor', 'dirt']);
const OPEN = new Set(['grass', 'plaza']);
const SIDES = Object.freeze([
  { name: 'norte', face: 4, edge: (m, t) => [t, 0], inner: (m, t) => [t, 1], along: m => m[0].length, outward: [0, -1] },
  { name: 'sur', face: 5, edge: (m, t) => [t, m.length - 1], inner: (m, t) => [t, m.length - 2], along: m => m[0].length, outward: [0, 1] },
  { name: 'occidente', face: 0, edge: (m, t) => [0, t], inner: (m, t) => [1, t], along: m => m.length, outward: [-1, 0] },
  { name: 'oriente', face: 1, edge: (m, t) => [m[0].length - 1, t], inner: (m, t) => [m[0].length - 2, t], along: m => m.length, outward: [1, 0] }
]);
const hash = (a, b, salt = 0) => {
  let h = Math.imul(a + 104729, 73856093) ^ Math.imul(b + 7919, 19349663) ^ Math.imul(salt + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const FACADE_COLORS = [[.54, .34, .26], [.60, .39, .30], [.62, .60, .55], [.70, .67, .60], [.52, .54, .54], [.57, .47, .38]];

/** Clasifica cada tramo de perímetro según lo que tiene al frente. */
export function scanCityEdge(map) {
  const runs = [];
  for (const side of SIDES) {
    let current = null;
    const length = side.along(map);
    for (let t = 0; t < length; t++) {
      const [ex, ez] = side.edge(map, t), [ix, iz] = side.inner(map, t);
      const type = map[iz]?.[ix];
      let kind = null;
      if (map[ez][ex] === 'wall') kind = STREET.has(type) ? 'closure' : OPEN.has(type) ? 'fence' : 'facade';
      if (kind !== current?.kind) {
        if (current) runs.push(current);
        current = kind ? { side, kind, a: t, b: t, road: false } : null;
      }
      if (current) {
        current.b = t;
        if (type === 'road' || type === 'busway') current.road = true;
      }
    }
    if (current) runs.push(current);
  }
  return runs;
}

// u del marco de cada pared: el tramo se recorre en metros de mundo y se pasa al marco de esa cara.
const toFrameU = (face, value) => (face === 4 || face === 1 ? value : -value);
const toFrameN = (face, value) => (face === 4 || face === 0 ? value : -value);

/** Seto con reja por delante y pilares de ladrillo, sobre el plano de un costado. */
function dressFence(f, detail, side, start, end, plane) {
  const toU = v => toFrameU(side.face, v), planeN = toFrameN(side.face, plane);
  for (let t = start; t < end;) {
    const length = Math.min(end - t, 6);
    const center = toU(t + length / 2);
    f.box(detail, center, .06, planeN - .28, length, 1.12, .78, 'hedge', ALL_FACES & ~FACES.bottom);
    f.box(detail, center, 1.72, planeN + .12, length, .05, .05, 'iron', NO_BACK);
    f.box(detail, center, .42, planeN + .12, length, .05, .05, 'iron', NO_BACK);
    for (let k = .22; k < length - .1; k += .3) f.box(detail, toU(t + k), .1, planeN + .12, .028, 1.65, .028, 'iron', SKIN);
    f.box(detail, toU(t), .06, planeN + .05, .46, 2, .46, 'brick', ALL_FACES & ~FACES.bottom);
    t += length;
  }
}

/** Cierre de obra: lámina, polisombra, barreras y separadores. keepClear deja libre lo que recorre el bus. */
function dressClosure(f, detail, side, start, end, plane, seed, keepClear = () => false) {
  const toU = v => toFrameU(side.face, v), planeN = toFrameN(side.face, plane);
  // Hoja de lámina cada 1,22 m con la unión visible; arriba, malla de obra sobre varas.
  for (let t = start, i = 0; t < end; i++) {
    const panel = Math.min(end - t, 1.22);
    const u = toU(t + panel / 2), kind2 = hash(seed, i, 2);
    const rect = kind2 < .72 ? 'sheetMetal' : 'plywood';
    const tall = 2.35 + (hash(seed, Math.floor(i / 3), 3) - .5) * .14;
    f.box(detail, u, 0, planeN + .04, panel - .012, tall, .04, rect, FACES.front | FACES.back | FACES.top);
    if (i % 3 === 0) {
      f.box(detail, toU(t), 0, planeN + .11, .09, 4.1, .09, 'woodLight', NO_BACK);
      f.box(detail, toU(t), 0, planeN - .1, .09, 2.4, .09, 'woodLight', NO_BACK);
    }
    // Bolsillos de polisombra sobre la lámina, para que el cierre no parezca recién hecho.
    if (hash(seed, Math.floor(i / 2), 4) < .78) f.panel(detail, u, tall - .05, planeN + .05, panel, 1.55 + hash(seed, i, 5) * .14, 'mesh');
    t += panel;
  }
  f.box(detail, toU((start + end) / 2), 3.92, planeN + .11, end - start, .06, .06, 'woodLight', NO_BACK);
  f.box(detail, toU((start + end) / 2), 2.32, planeN + .1, end - start, .08, .05, 'woodDark', NO_BACK);
  // Aviso de la obra en mitad de la calzada.
  f.panel(detail, toU((start + end) / 2), 1.15, planeN + .08, 2.6, 1.04, 'signObra');
  // Separadores de concreto, con un perfil de dos niveles.
  for (let t = start + .15, i = 0; t < end - 1; i++) {
    const length = 1.95;
    const u = toU(t + length / 2), offset = (hash(seed, i, 7) - .5) * .12;
    const n = planeN + 1 + offset;
    if (!keepClear(t) && !keepClear(t + length)) {
      f.box(detail, u, 0, n, length, .34, .6, 'concrete', ALL_FACES & ~FACES.bottom);
      f.box(detail, u, .34, n, length, .5, .22, 'concrete', ALL_FACES & ~FACES.bottom);
    }
    t += length + .05;
  }
  // Barreras a franjas más adentro, cada una con su par de patas.
  for (let t = start + 1.1, i = 0; t < end - 2.4; i++) {
    const length = 2.4;
    if (hash(seed, i, 8) < .82 && !keepClear(t) && !keepClear(t + length)) {
      const u = toU(t + length / 2), n = planeN + 1.95 + (hash(seed, i, 9) - .5) * .4;
      for (const y of [.62, .98]) f.box(detail, u, y, n, length, .2, .04, 'barrier', NO_BACK);
      for (const leg of [-1, 1]) {
        f.box(detail, u + leg * (length / 2 - .2), 0, n, .06, 1.22, .06, 'woodLight', SKIN);
        f.box(detail, u + leg * (length / 2 - .2), 0, n, .08, .05, .62, 'iron', ALL_FACES & ~FACES.bottom);
      }
    }
    t += length + .9 + hash(seed, i, 10) * 1.3;
  }
  // Conos sueltos en la calzada: cuatro caras bastan a esta distancia.
  const [c0, c1, c2, c3] = detailRect('orangeTarp'), coneUV = [c0, c1, c2, c1, (c0 + c2) / 2, c3];
  for (let i = 0; i < Math.round((end - start) / 3.2); i++) {
    const t = start + .8 + hash(seed, i, 12) * (end - start - 1.6), n = planeN + 2.7 + hash(seed, i, 13) * .9;
    if (keepClear(t)) continue;
    const u = toU(t), tip = [u, .72, n], s = .14;
    const corner = (du, dn) => [u + du, .02, n + dn];
    f.tri(detail, corner(-s, s), corner(s, s), tip, coneUV);
    f.tri(detail, corner(s, s), corner(s, -s), tip, coneUV);
    f.tri(detail, corner(s, -s), corner(-s, -s), tip, coneUV);
    f.tri(detail, corner(-s, -s), corner(-s, s), tip, coneUV);
  }
}

/** Reja a los costados de la terminal y cierre al final de la vía: lo que antes era una pared gris sin más. */
export function buildTerminalEdge({ x0, x1, z0, z1, lanes }, { detail, collisions = null } = {}) {
  const group = new THREE.Group();
  group.name = 'Borde de la terminal';
  const [north, , west, east] = SIDES;
  const fence = new Batch();
  dressFence(fence.frame(east.face, 0), detail, east, z0, z1, x1 + .3);
  dressFence(fence.frame(west.face, 0), detail, west, z0, z1, x0 - .3);
  fence.finish(group, { castShadow: true, receiveShadow: true, name: 'Reja de la terminal' });
  const closure = new Batch();
  const onLanes = t => t > lanes[0] && t < lanes[1];
  dressClosure(closure.frame(north.face, 0), detail, north, x0, x1, z0 - .3, 7301, onLanes);
  closure.finish(group, { castShadow: true, receiveShadow: true, name: 'Cierre al final de la vía' });
  if (collisions) {
    // Solo los tramos con barreras: el carril del bus sigue libre hasta la lámina.
    for (const [a, b] of [[x0, lanes[0]], [lanes[1], x1]]) {
      const object = new THREE.Object3D();
      object.position.set((a + b) / 2, 0, z0 + 1.2);
      collisions.add(object, new THREE.Vector3(b - a, 1.1, 2.4));
    }
  }
  return group;
}

/** Nada de muro liso: cierres y rejas se agrupan por material y por sector como todo lo demás. */
export function buildCityEdge(map, { detail, collisions = null } = {}) {
  const group = new THREE.Group();
  group.name = 'Borde de la ciudad';
  const runs = scanCityEdge(map);
  const width = map[0].length * T, height = map.length * T;
  const corridors = [], blocks = [], blockedTiles = new Set();
  // Cada cierre se construye en un grupo propio: los sectores de render lo descartan por separado.
  const addPiece = (batch, name) => {
    const piece = new THREE.Group();
    piece.name = name;
    batch.finish(piece, { castShadow: true, receiveShadow: true, name });
    group.add(piece);
  };

  for (const run of runs) {
    const { side, kind, a, b } = run;
    const alongX = side.face === 4 || side.face === 5;
    const [ox, oz] = side.outward;
    const start = a * T - T / 2, end = b * T + T / 2;
    // Plano del lado interior del tile de borde.
    const plane = alongX ? (oz < 0 ? T / 2 : (map.length - 1) * T - T / 2) : (ox < 0 ? T / 2 : (map[0].length - 1) * T - T / 2);
    if (kind === 'facade') {
      // Edificios de relleno: cubren el tile y salen hacia afuera para que no parezcan una lámina.
      for (let t = start; t < end;) {
        const length = Math.min(end - t, 9 + hash(a, Math.round(t), side.face) * 14);
        const h = 8 + hash(Math.round(t), b, side.face + 4) ** 1.4 * 9;
        const deep = 8 + hash(Math.round(t), a, 9) * 8;
        const center = t + length / 2;
        const color = FACADE_COLORS[Math.floor(hash(Math.round(t), side.face, 11) * FACADE_COLORS.length)];
        const across = plane + (ox + oz) * deep / 2 - (ox + oz) * .02;
        blocks.push(alongX ? { x: center, z: across, w: length, d: deep, h, color } : { x: across, z: center, w: deep, d: length, h, color });
        t += length;
      }
      continue;
    }
    if (kind === 'fence') {
      const batch = new Batch();
      dressFence(batch.frame(side.face, 0), detail, side, start, end, plane);
      addPiece(batch, 'Reja y seto de parque');
      continue;
    }
    const batch = new Batch();
    // El bus articulado arranca con la cola junto al cierre: su carril queda sin estorbos delante de la lámina.
    const onBusway = t => {
      const [ix, iz] = side.inner(map, Math.round(t / T));
      return map[iz]?.[ix] === 'busway';
    };
    dressClosure(batch.frame(side.face, 0), detail, side, start, end, plane, a * 31 + side.face, onBusway);
    // El puente del carril termina antes de la lámina y bajo él no hay suelo: sin esta losa se pisa sobre el cielo.
    const slab = batch.frame(side.face, 0), slabDepth = 1.6;
    for (let t = a; t <= b; t++) {
      if (!onBusway(t * T)) continue;
      slab.box(detail, toFrameU(side.face, t * T), 0, toFrameN(side.face, plane) + slabDepth / 2, T, .02, slabDepth, 'asphalt', FACES.top);
    }
    addPiece(batch, 'Cierre de obra');
    if (collisions) {
      // Las barreras se comportan como un obstáculo: el peatón se detiene antes del cierre. El carril del bus no
      // lleva barreras, así que tampoco caja: se camina hasta la lámina, como en la terminal.
      const reach = 2.4, across = plane - (ox + oz) * reach / 2;
      const busTile = t => {
        const [ix, iz] = side.inner(map, t);
        return map[iz]?.[ix] === 'busway';
      };
      for (let t = a; t <= b; t++) {
        if (busTile(t)) continue;
        let last = t;
        while (last < b && !busTile(last + 1)) last++;
        const from = t * T - T / 2, to = last * T + T / 2, center = (from + to) / 2;
        const object = new THREE.Object3D();
        object.position.set(alongX ? center : across, 0, alongX ? across : center);
        collisions.add(object, new THREE.Vector3(alongX ? to - from : reach, 1.1, alongX ? reach : to - from));
        t = last;
      }
    }
    for (let t = a; t <= b; t++) {
      const [ix, iz] = side.inner(map, t);
      blockedTiles.add(`${ix},${iz}`);
    }
    if (run.road) {
      // La calle sigue detrás del cierre, flanqueada por los bloques de fondo.
      const LENGTH = 190;
      const x0 = alongX ? start : ox < 0 ? -LENGTH : width - T / 2 - T / 2;
      const x1 = alongX ? end : ox < 0 ? T / 2 : width + LENGTH;
      const z0 = alongX ? (oz < 0 ? -LENGTH : height - T / 2 - T / 2) : start;
      const z1 = alongX ? (oz < 0 ? T / 2 : height + LENGTH) : end;
      corridors.push({ x0, x1, z0, z1, alongX: !alongX, outward: ox + oz });
    }
  }
  group.userData.blockedTiles = blockedTiles;
  return { group, corridors, blocks, runs, blockedTiles };
}
