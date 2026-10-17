// src/world/AvenidaTM.js
// Dos avenidas TransMilenio perpendiculares (H = a lo largo de X, V = a lo largo de Z) que se cruzan en una plaza.
// Decorado (todo instanciado y barato, compartido entre las dos avenidas):
//  - parche de pasto de la zona verde central (1 InstancedMesh, via TileFactory 'grass')
//  - pasos de cebra en los cruces con las calles transversales (1 draw call)
//  - texto "SOLO BUS" en los carriles exclusivos (1 draw call)
//  - árboles low-poly y arbustos (2 draw calls: geometría fusionada con colores por vértice)
// Coordenadas locales de una avenida: u = a lo largo (X en H, Z en V), v = a través, medido desde el eje.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  TILE_SIZE, WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z,
  AVENUE_N_TILES, AVENUE_TM_TILES, AVENUE_G_TILES
} from '../utils/constants.js';
import { TileFactory } from './tiles/TileFactory.js';

// Medidas (u): carril normal 4 | TM 4 | zona verde 8 | TM 4 | normal 4 = 24 u de ancho total
const N_W = AVENUE_N_TILES * TILE_SIZE, TM_W = AVENUE_TM_TILES * TILE_SIZE, G_W = AVENUE_G_TILES * TILE_SIZE;
const AV_W = 2 * N_W + 2 * TM_W + G_W; // 24
export const STATION_LEN = 18;    // largo de la estación (acorde al bus de 19)
export const STATION_WIDTH = 5.6; // ancho (zona verde 8 u: quedan 1.2 u a cada lado para caminar)
const STATION_PLAZA_GAP = 1.5;    // separación entre una estación y la plaza (el bus de 19 queda a ~1 u)

/** Tramos [a0, a1] (coordenada de mundo) de los tiles consecutivos que cumplen pred (calles o plaza) */
function runsOf(kinds, pred) {
  const out = [];
  let st = -1;
  for (let i = 0; i <= kinds.length; i++) {
    const on = i < kinds.length && pred(kinds[i]);
    if (on && st < 0) st = i;
    if (!on && st >= 0) { out.push({ a0: st * TILE_SIZE - 1, a1: (i - 1) * TILE_SIZE + 1 }); st = -1; }
  }
  return out;
}

function makeAvenue(axis, c, alongKinds, min, max) {
  const half = AV_W / 2;
  const laneOff = G_W / 2 + TM_W / 2;                  // eje de cada carril TM respecto al eje (6 u)
  const nOff = G_W / 2 + TM_W + N_W / 2;               // eje de cada carril normal (10 u)
  const crossings = runsOf(alongKinds, (k) => k === 'road');       // calles transversales (cebras)
  const plazaRuns = runsOf(alongKinds, (k) => k.startsWith('av')); // la otra avenida
  const plaza = plazaRuns[0] || null;
  // Tramos de manzana entre cruces/plaza (donde van "SOLO BUS", árboles y estaciones)
  const cuts = [...crossings, ...plazaRuns].sort((a, b) => a.a0 - b.a0);
  const spans = [];
  let prev = min;
  for (const k of cuts) { spans.push({ a0: prev, a1: k.a0 }); prev = k.a1; }
  spans.push({ a0: prev, a1: max });
  // Conducción por la derecha. H: el carril norte (z menor) va hacia -X y el sur hacia +X.
  // V: el carril oeste (x menor) va hacia +Z y el este hacia -Z.
  const sgn = axis === 'x' ? 1 : -1;
  const lanes = [
    { axis, c: c - laneOff, dir: -sgn },
    { axis, c: c + laneOff, dir: +sgn }
  ];
  // Estaciones en el 2º y 4º tramo; si el tramo toca la plaza se aleja de ella (la plaza no lleva estaciones)
  const stations = [1, 3].filter((i) => spans[i]).map((i) => {
    const sp = spans[i];
    let along = (sp.a0 + sp.a1) / 2;
    if (plaza && Math.abs(sp.a1 - plaza.a0) < 0.01) along = plaza.a0 - STATION_PLAZA_GAP - STATION_LEN / 2;
    else if (plaza && Math.abs(sp.a0 - plaza.a1) < 0.01) along = plaza.a1 + STATION_PLAZA_GAP + STATION_LEN / 2;
    return {
      axis, along, len: STATION_LEN, width: STATION_WIDTH,
      x: axis === 'x' ? along : c, z: axis === 'x' ? c : along
    };
  });
  return {
    axis, c, half, laneOff, nOff, greenHalf: G_W / 2, min, max, lanes, crossings, plaza, spans, stations,
    // compat con la versión de una sola avenida
    zc: c, z0: c - half, z1: c + half, xMin: WORLD_MIN_X, xMax: WORLD_MAX_X
  };
}

/** Geometría de las avenidas a partir del layout (coordenadas de mundo). */
export function computeAvenues(layout) {
  const cz = (layout.avenueRow0 + (layout.avenueRows - 1) / 2) * TILE_SIZE; // eje de la avenida H
  const cx = (layout.avenueCol0 + (layout.avenueCols - 1) / 2) * TILE_SIZE; // eje de la avenida V
  const H = makeAvenue('x', cz, layout.xKinds, WORLD_MIN_X, WORLD_MAX_X);
  const V = makeAvenue('z', cx, layout.yKinds, WORLD_MIN_Z, WORLD_MAX_Z);
  return { H, V, all: [H, V] };
}

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

function instanced(geo, mat, matrices, cast = false) {
  const im = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = true;
  im.frustumCulled = false;
  return im;
}

function mat4(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromEuler(_e.set(0, ry, 0));
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

function colored(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);

function treeGeometry() {
  const trunk = ni(new THREE.CylinderGeometry(0.1, 0.15, 1.1, 5)); trunk.translate(0, 0.55, 0);
  const c1 = new THREE.IcosahedronGeometry(0.8, 0); c1.scale(1, 0.9, 1); c1.translate(0, 1.7, 0);
  const c2 = new THREE.IcosahedronGeometry(0.55, 0); c2.translate(0.15, 2.35, 0.05);
  return mergeGeometries([
    colored(trunk, 0.30, 0.19, 0.10),
    colored(c1, 0.16, 0.38, 0.14),
    colored(c2, 0.22, 0.46, 0.18)
  ]);
}

function shrubGeometry() {
  const a = new THREE.IcosahedronGeometry(0.5, 0); a.scale(1, 0.7, 1); a.translate(0, 0.3, 0);
  const b = new THREE.IcosahedronGeometry(0.34, 0); b.translate(0.3, 0.25, 0.1);
  return mergeGeometries([colored(a, 0.17, 0.36, 0.13), colored(b, 0.21, 0.42, 0.16)]);
}

function busTextTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 46px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeText('SOLO BUS', 128, 34);
  ctx.fillStyle = '#f3d437';
  ctx.fillText('SOLO BUS', 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Construye el decorado de ambas avenidas. Devuelve { group, avenues:{H,V,all}, avenue (= H), stations (todas) }.
 * Los troncos de los árboles se registran como círculos de colisión (r = 0.4).
 */
export function buildAvenueDecor(layout, collisions) {
  const av = computeAvenues(layout);
  const group = new THREE.Group();
  // (u a lo largo, v a través) -> mundo
  const wx = (a, u, v) => (a.axis === 'x' ? u : a.c + v);
  const wz = (a, u, v) => (a.axis === 'x' ? a.c + v : u);
  const ry = (a) => (a.axis === 'x' ? 0 : Math.PI / 2); // gira piezas orientadas a lo largo de X
  const inCrossing = (a, u, pad = 0) => a.crossings.some((c) => u > c.a0 - pad && u < c.a1 + pad);
  const inPlaza = (a, u, pad = 0) => !!a.plaza && u > a.plaza.a0 - pad && u < a.plaza.a1 + pad;

  // ----- Pasto de la zona verde: 4 filas de tiles (8 u); las 2 exteriores dejan ~0.25 u de bordillo -----
  const grassTiles = [];
  const gd = 1.56; // profundidad (z) de la geometría de pasto de TileFactory
  const grassRows = [[-3, 1.75], [-1, 2], [1, 2], [3, 1.75]]; // [centro del tile, profundidad deseada]
  for (const a of av.all) {
    const n = a.axis === 'x' ? layout.cols : layout.rows;
    for (let i = 1; i < n - 1; i++) {
      const u = i * TILE_SIZE;
      if (inPlaza(a, u)) continue; // la plaza no lleva zona verde
      for (const [c, d] of grassRows) {
        const v = c + Math.sign(c) * (d - 2) / 2; // las filas de borde se desplazan hacia dentro
        grassTiles.push(mat4(wx(a, u, v), 0, wz(a, u, v), ry(a), 1, 1, d / gd));
      }
    }
  }
  const sample = TileFactory.create('grass');
  group.add(instanced(sample.geometry, sample.material, grassTiles));

  // ----- Pasos de cebra en cada cruce (solo sobre los 4 carriles, no sobre el pasto): franjas cada 1 u -----
  const bars = [];
  for (const a of av.all) {
    const laneV = [-a.nOff, -a.laneOff, a.laneOff, a.nOff];
    for (const c of a.crossings) {
      const u = (c.a0 + c.a1) / 2;
      for (const lv of laneV) {
        for (const o of [-1.5, -0.5, 0.5, 1.5]) bars.push(mat4(wx(a, u, lv + o), 0.06, wz(a, u, lv + o), ry(a)));
      }
    }
  }
  const zebraMat = new THREE.MeshLambertMaterial({ color: 0xd9d9d0, flatShading: true });
  group.add(instanced(new THREE.BoxGeometry(3.4, 0.02, 0.5), zebraMat, bars));

  // ----- "SOLO BUS" (en cada tramo de manzana, ambos carriles exclusivos) -----
  const textGeo = new THREE.PlaneGeometry(5.4, 1.35); textGeo.rotateX(-Math.PI / 2);
  const textMat = new THREE.MeshLambertMaterial({
    map: busTextTexture(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const texts = [];
  for (const a of av.all) {
    for (const sp of a.spans) {
      if (sp.a1 - sp.a0 < 8) continue;
      const u = (sp.a0 + sp.a1) / 2;
      for (const lv of [-a.laneOff, a.laneOff]) {
        texts.push(mat4(wx(a, u, lv), 0.055, wz(a, u, lv), a.axis === 'x' ? 0 : -Math.PI / 2));
      }
    }
  }
  const txt = instanced(textGeo, textMat, texts);
  txt.receiveShadow = false;
  group.add(txt);

  const stations = [...av.H.stations, ...av.V.stations]; // las estaciones (GLB) las crea EstacionTM.js

  // ----- Árboles y arbustos en la zona verde (evitando cruces, plaza y estaciones) -----
  const treeM = [], shrubM = [];
  for (const a of av.all) {
    const blocked = (u) => inCrossing(a, u, 1.6) || inPlaza(a, u, 1.6) ||
      a.stations.some((s) => Math.abs(u - s.along) < s.len / 2 + 0.6);
    let i = 0;
    for (let u = 4; u < (a.axis === 'x' ? WORLD_MAX_X : WORLD_MAX_Z) - 1; u += 3.4, i++) {
      if (blocked(u)) continue;
      const rnd = Math.sin((u + (a.axis === 'x' ? 0 : 7)) * 12.9898) * 43758.5453; // jitter determinista
      const f = rnd - Math.floor(rnd);
      // Dos hileras sobre la zona verde (a ±2.6 del eje, fuera de la franja de la estación): árbol a un lado y
      // arbusto al otro, alternando
      const side = i % 2 === 0 ? 1 : -1;
      const vt = side * (2.6 + (f - 0.5) * 0.4);
      const vs = -side * (2.6 + (f - 0.5) * 0.4);
      const sc = 1.3 + f * 0.5;
      const tx = wx(a, u, vt), tz = wz(a, u, vt);
      treeM.push(mat4(tx, 0.13, tz, f * 6.28, sc, sc, sc));
      collisions?.addCircle(tx, tz, 0.4);
      const ss = 1.2 + f * 0.5;
      shrubM.push(mat4(wx(a, u + 0.6, vs), 0.13, wz(a, u + 0.6, vs), f * 6.28, ss, ss, ss));
    }
  }
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  if (treeM.length) group.add(instanced(treeGeometry(), vcMat, treeM, true));
  if (shrubM.length) group.add(instanced(shrubGeometry(), vcMat, shrubM, false));

  return { group, avenues: av, avenue: av.H, stations };
}
