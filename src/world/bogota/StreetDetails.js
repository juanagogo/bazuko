// Lo que da vida a la calle: sardineles con volumen, postes de concreto, cables y lo que la gente deja afuera.
// Todo nace de recorrer el mapa de baldosas: los barrios nuevos lo reciben solos, sin colisiones nuevas.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { buildSunField, chainSunField, fadeGlowInFog, registerNightGlow } from './SunField.js';
import { STATIC_CHUNK_SIZE, createRenderSectors, freezeStaticTransforms } from './StaticGeometry.js';
import { StreetBatch, WireBatch, tint, unit } from './StreetBatch.js';
import { crossings } from './StreetMarkings.js';
import { detailAtlas, glowTexture } from './textures-calle.js';
import { addStreetPuddles } from './StreetPuddles.js';
import { STREET_LAMP } from './StreetLampModel.js';
import { CARACAS, SIDEWALK_TILES } from './StreetLayout.js';
import { CITY_CALLES as CALLES } from './CityLayout.js';
import { LAKE_PARK, inLakeTerrain, onLakeBridge } from './LakePark.js';
import { VIADUCT, viaductSurface } from './ColpatriaViaduct.js';
import { inTerminal } from './TransitTerminal.js';
import { inGasStation } from './GasStation.js';
import { AVENUE_OVERPASS } from './AvenueLandmarks.js';

const T = TILE_SIZE;
const W = tile => tile * T;
const BAND = SIDEWALK_TILES * T;
const ROADS = new Set(['road', 'busway']);
const RAISED = new Set(['sidewalk', 'plaza', 'floor']);
const HEIGHTS = { road: 0, busway: .02, dirt: .04, grass: .06, sidewalk: .12, plaza: .12, floor: .12 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SOLID = new Set(['building', 'ruin', 'wall', 'smallBuilding', 'storeD69', 'colpatria', 'colpatriaAnnex']);

const CONCRETE = tint('#bdb9ae');
const CURB_YELLOW = tint('#d9a826');
const CURB_RED = tint('#a8352a');
const POLE = tint('#b4b2a8');
const METAL = tint('#5b5e5f');
const INSULATOR = tint('#8d9a94');

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

// ---------- sardineles ----------

/** Un tramo de sardinel por borde de baldosa: cara, bisel y corona, por encima del plano original. */
function addCurbs(street, map, UV) {
  const uv = UV.concrete;
  for (let tz = 0; tz < map.length; tz++) for (let tx = 0; tx < map[0].length; tx++) {
    const type = map[tz][tx], x = W(tx), z = W(tz);
    if (inLakeTerrain(x, z) || onLakeBridge(x, z) || inTerminal(x, z)) continue;
    const high = HEIGHTS[type];
    if (high === undefined) continue;
    for (const [dx, dz] of DIRS) {
      const other = map[tz + dz]?.[tx + dx], low = HEIGHTS[other];
      if (low === undefined || low >= high) continue;
      if (inLakeTerrain(x + dx * T, z + dz * T) || onLakeBridge(x + dx * T, z + dz * T)) continue;
      const rx = dz, rz = -dx;
      const ex = x + dx * T / 2, ez = z + dz * T / 2;
      const left = (o, y) => [ex - rx * T / 2 + dx * o, y, ez - rz * T / 2 + dz * o];
      const right = (o, y) => [ex + rx * T / 2 + dx * o, y, ez + rz * T / 2 + dz * o];
      if (RAISED.has(type) && ROADS.has(other)) {
        // Los tramos pintados duran doce baldosas: nadie pinta un sardinel de a pedacitos.
        const run = dx ? Math.floor(tz / 12) : Math.floor(tx / 12);
        const key = dx ? tx + dx : tz + dz;
        const paintPick = unit(run, key, 41);
        const chip = .86 + unit(tx, tz, 42 + dx + dz * 2) * .2;
        const worn = unit(tx + dx, tz + dz, 43);
        const painted = paintPick < .1 ? CURB_YELLOW : paintPick < .135 ? CURB_RED : null;
        const body = painted ? mix(painted, CONCRETE, worn * .5) : CONCRETE;
        const dirty = scale(body, .34 * chip), face = scale(body, .92 * chip), crown = scale(body, 1.08 * chip);
        const y0 = low - .01, o1 = .026;
        street.quad(left(o1, y0), right(o1, y0), right(o1, .086), left(o1, .086), [dx, 0, dz], uv, [dirty, dirty, face, face]);
        const n = [dx * .6, .8, dz * .6];
        street.quad(left(o1, .086), right(o1, .086), right(-.03, .129), left(-.03, .129), n, uv, [face, face, crown, crown]);
        street.quad(left(-.03, .129), right(-.03, .129), right(-.2, .1235), left(-.2, .1235), [0, 1, 0], uv, crown);
      } else if (!(RAISED.has(type) && ROADS.has(other))) {
        // Escalón entre tierra, pasto y andén: sin esta cara se veía la luz del cielo por la junta.
        const dirtyEdge = scale(CONCRETE, .5), cleanEdge = scale(CONCRETE, .82);
        street.quad(left(0, low - .03), right(0, low - .03), right(0, high + .002), left(0, high + .002), [dx, 0, dz], uv, [dirtyEdge, dirtyEdge, cleanEdge, cleanEdge]);
      }
    }
  }
}

/** Dónde hay rampa: al final de cada cebra, solo si va de andén a calzada. */
function rampSpots(map) {
  const spots = [], tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)], width = 1.9;
  const ramp = (x, z, dx, dz) => {
    if (!RAISED.has(tile(x - dx, z - dz)) || !ROADS.has(tile(x + dx, z + dz))) return;
    if (!onLakeBridge(x, z) && !inLakeTerrain(x, z)) spots.push({ x, z, dx, dz, width });
  };
  for (const { x0, x1, z0, z1 } of crossings()) {
    for (const z of [z0 - BAND / 2, z1 + BAND / 2]) { ramp(x0, z, 1, 0); ramp(x1, z, -1, 0); }
    for (const x of [x0 - BAND / 2, x1 + BAND / 2]) { ramp(x, z0, 0, 1); ramp(x, z1, 0, -1); }
  }
  return spots;
}

/** Rampa de concreto al final de cada cebra; solo se ve, la altura física no cambia. */
function addRamps(street, map, UV) {
  const uv = UV.concrete;
  for (const { x, z, dx, dz, width } of rampSpots(map)) {
    // Corta: una cuña larga sobre la cebra se lee como una losa suelta.
    const rx = dz, rz = -dx, hw = width / 2, depth = .58;
    const at = (a, o, y) => [x + rx * a + dx * o, y, z + rz * a + dz * o];
    const top = scale(CONCRETE, .44), low = scale(CONCRETE, .3);
    const n = [dx * .2, .98, dz * .2];
    street.quad(at(-hw, depth, .014), at(hw, depth, .014), at(hw, -.05, .133), at(-hw, -.05, .133), n, uv, [low, low, top, top]);
    // Ribetes laterales: cierran la cuña para que no se vea hueca desde la calle.
    street.quad(at(hw, depth, .004), at(hw, -.05, .004), at(hw, -.05, .133), at(hw, depth, .014), [rx, 0, rz], uv, low);
    street.quad(at(-hw, -.05, .004), at(-hw, depth, .004), at(-hw, depth, .014), at(-hw, -.05, .133), [-rx, 0, -rz], uv, low);
  }
}

/** Separadores de la troncal: mismas posiciones de siempre, en el lote común de la calle. */
function addBuswaySeparators(street, UV, height) {
  const color = scale(tint('#cfcac0'), .9);
  for (const x of [W(CARACAS.busway[0]) - T / 2, W(CARACAS.busway[1]) + T / 2]) {
    for (let z = 1; z < height - 1; z++) {
      if (W(z) >= LAKE_PARK.z0) continue;
      if (W(z) >= VIADUCT.start && W(z) <= VIADUCT.end) continue;
      if (CALLES.some(([a, b]) => z >= a - .5 && z <= b + .5)) continue;
      street.box(x, 0, W(z), .3, .25, T, 0, UV.concrete, scale(color, .88 + unit(x | 0, z, 44) * .2), .42);
    }
  }
}

// ---------- obstáculos y sitios libres ----------

/** Rejilla de lo que ya ocupa el andén: nada de lo nuevo se monta encima ni tapa nada que sirva. */
function createObstacles(district, collisions) {
  const cells = new Map(), SIZE = 6;
  const add = (x, z, radius) => {
    const key = `${Math.floor(x / SIZE)},${Math.floor(z / SIZE)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ x, z, radius });
  };
  for (const prop of district.props ?? []) {
    const p = prop.instance?.group?.position;
    if (p) add(p.x, p.z, 1.1);
  }
  for (const pole of district.signals?.poles ?? []) add(pole.x, pole.z, 1.2);
  for (const tree of district.treePlan ?? []) add(tree.x, tree.z, 1 + (tree.scale ?? 1) * .5);
  for (const c of district.vegetationPlan?.clusters ?? []) add(c.x, c.z, c.radius ?? 1);
  for (const v of district.vendors ?? []) add(v.position.x, v.position.z, 2.6);
  for (const b of district.fireBarrels ?? []) add(b.position.x, b.position.z, 1.8);
  // Quien baja por la rampa no atraviesa nada: su paso sigue andén adentro, donde van los postes.
  for (const { x, z, dx, dz } of rampSpots(district.map)) add(x - dx * .42, z - dz * .42, .6);
  const near = (x, z, radius) => {
    const cx = Math.floor(x / SIZE), cz = Math.floor(z / SIZE);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const o of cells.get(`${cx + i},${cz + j}`) ?? []) {
        if (Math.hypot(x - o.x, z - o.z) < radius + o.radius) return true;
      }
    }
    return false;
  };
  const scratch = [];
  return {
    add,
    /** Lo puesto ahí no detiene a nadie, pero un cuerpo que cae no debe atravesarlo. */
    takesRoom(x, z, half, y, height) { collisions?.addFallObstacle?.(x - half, z - half, x + half, z + half, y, y + height); },
    free(x, z, radius = .6) {
      if (near(x, z, radius) || district.isNearReserved?.(x, z, 6)) return false;
      if (inGasStation(x, z) || inTerminal(x, z) || inLakeTerrain(x, z) || onLakeBridge(x, z)) return false;
      if (viaductSurface(x, z) !== null || viaductSurface(x + 3, z) !== null || viaductSurface(x - 3, z) !== null) return false;
      if (collisions?.queryStatic) {
        scratch.length = 0;
        collisions.queryStatic(x - radius, z - radius, x + radius, z + radius, scratch);
        for (const { box } of scratch) {
          if (box.max.x > x - radius && box.min.x < x + radius && box.max.z > z - radius && box.min.z < z + radius) return false;
        }
      }
      return true;
    }
  };
}

/** Tramos continuos de andén frente a una vía, leídos del mapa: sirven para cualquier barrio. */
export function curbRuns(map) {
  const runs = [], rows = map.length, cols = map[0].length;
  const ok = (x, z, dx, dz) => RAISED.has(map[z]?.[x]) && ROADS.has(map[z + dz]?.[x + dx]);
  for (const side of [-1, 1]) {
    for (let z = 0; z < rows; z++) {
      let start = -1;
      for (let x = 0; x <= cols; x++) {
        if (x < cols && ok(x, z, 0, side)) { if (start < 0) start = x; } else if (start >= 0) {
          runs.push({ axis: 'x', fixed: z, a: start, b: x - 1, side }); start = -1;
        }
      }
    }
    for (let x = 0; x < cols; x++) {
      let start = -1;
      for (let z = 0; z <= rows; z++) {
        if (z < rows && ok(x, z, side, 0)) { if (start < 0) start = z; } else if (start >= 0) {
          runs.push({ axis: 'z', fixed: x, a: start, b: z - 1, side }); start = -1;
        }
      }
    }
  }
  return runs;
}

// ---------- postes y cables ----------

/** Plan de postes: uno cada 20 a 30 m, corrido si hay un farol, un árbol o un semáforo en el sitio. */
export function planPoles(map, free) {
  const poles = [];
  for (const run of curbRuns(map)) {
    const startM = W(run.a) - T / 2, endM = W(run.b) + T / 2;
    if (endM - startM < 8) continue;
    const lateral = W(run.fixed) + run.side * (T / 2 - .42);
    let along = startM + 3 + unit(run.fixed, run.a, 50 + run.side) * 6;
    let previous = null;
    while (along < endM - 2.5) {
      let placed = null;
      for (const shift of [0, 1.6, -1.6, 3.2, -3.2, 4.8]) {
        const s = along + shift;
        if (s < startM + 2 || s > endM - 2) continue;
        const x = run.axis === 'x' ? s : lateral, z = run.axis === 'x' ? lateral : s;
        if (free(x, z, .7)) {
          placed = { x, z, axis: run.axis, side: run.side, fixed: run.fixed, along: s, previous };
          break;
        }
      }
      if (placed) { poles.push(placed); previous = placed; along = placed.along; }
      along += 20 + unit(Math.round(along), run.fixed, 51) * 10;
    }
  }
  return poles;
}

function addPole(street, pole, UV) {
  const { x, z, axis, side } = pole, seed = [Math.round(x * 3), Math.round(z * 3)];
  const y0 = .12, height = 9.6 + unit(seed[0], seed[1], 52) * 1;
  // Direcciones: `along` sigue la cuadra; `out` apunta hacia la vía.
  const ax = axis === 'x' ? 1 : 0, az = axis === 'x' ? 0 : 1;
  const ox = axis === 'x' ? 0 : side, oz = axis === 'x' ? side : 0;
  const crossAngle = axis === 'x' ? Math.PI / 2 : 0; // cruceta perpendicular a la línea de cables
  const color = scale(POLE, .86 + unit(seed[0], seed[1], 53) * .22);
  street.cylinder(x, y0, z, .15, .085, height, 6, UV.concrete, color, .55);
  // Cruceta alta con sus aisladores, y una segunda más abajo para la baja tensión.
  const top = y0 + height - .32;
  street.box(x, top, z, 1.9, .09, .09, axis === 'x' ? Math.PI / 2 : 0, UV.concrete, scale(color, .92));
  for (const k of [-.82, 0, .82]) {
    const ix = x + (axis === 'x' ? 0 : k), iz = z + (axis === 'x' ? k : 0);
    street.cylinder(ix, top + .09, iz, .04, .025, .16, 4, UV.plain, INSULATOR, .8);
  }
  const low = y0 + height - 1.9;
  street.box(x, low, z, 1.25, .07, .07, axis === 'x' ? Math.PI / 2 : 0, UV.rust, METAL);
  const pick = unit(seed[0], seed[1], 54);
  if (pick < .24) {
    // Transformador colgado hacia el andén: es lo primero que se ve de un poste del centro.
    const tx = x - ox * .36, tz = z - oz * .36, ty = top - 2.5;
    street.cylinder(tx, ty, tz, .29, .29, 1.02, 7, UV.trans, tint('#858d8a'), .8);
    street.cylinder(tx, ty + 1.02, tz, .29, .06, .08, 7, UV.trans, tint('#6d7472'), 1);
    street.box(tx + ox * .2, ty + .25, tz + oz * .2, .22, .55, .16, 0, UV.rust, METAL);
    for (const k of [-.14, .14]) street.cylinder(tx + ax * k, ty + 1.08, tz + az * k, .03, .02, .22, 4, UV.plain, INSULATOR);
  } else if (pick < .5) {
    // Caja de empalmes de teléfono o cable.
    const by = 3.1 + unit(seed[0], seed[1], 55) * 1.1;
    street.box(x - ox * .21, by, z - oz * .21, .44, .62, .22, axis === 'x' ? 0 : Math.PI / 2, UV.meter, tint('#71756f'));
  }
  // Rollo de cable sobrante, en casi todos los postes del centro.
  if (unit(seed[0], seed[1], 56) < .4) {
    const cy = 5.2 + unit(seed[1], seed[0], 56) * 1.6;
    street.cylinder(x + ax * .22, cy, z + az * .22, .2, .2, .1, 6, UV.tire, tint('#2c2c2e'), 1);
  }
  // Avisos pegados a la altura de la mano: sin marcas, los de cualquier cuadra.
  if (unit(seed[0], seed[1], 57) < .42) {
    const kinds = [UV.adA, UV.adB, UV.adC, UV.adD];
    const uv = kinds[Math.floor(unit(seed[0], seed[1], 58) * kinds.length)];
    street.box(x - ox * .135, 1.45 + unit(seed[1], seed[0], 58) * .5, z - oz * .135, .34, .44, .012,
      axis === 'x' ? 0 : Math.PI / 2, uv, [1, 1, 1], 1);
  }
  return { top: y0 + height, crossAngle };
}

/** Punto de amarre sobre la cruceta del poste. */
function anchor(pole, slot) {
  const { x, z, axis } = pole;
  const k = slot.k, y = slot.y;
  return axis === 'x' ? [x, y, z + k] : [x + k, y, z];
}

function blockedSpan(map, a, b) {
  // Un cable no atraviesa manzanas, el viaducto ni el puente vehicular de la avenida.
  const length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(length / 2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (SOLID.has(map[Math.round(z / T)]?.[Math.round(x / T)])) return true;
    if (viaductSurface(x, z) !== null) return true;
    if (AVENUE_OVERPASS && x > AVENUE_OVERPASS.x0 - 1 && x < AVENUE_OVERPASS.x1 + 1 && Math.abs(z - AVENUE_OVERPASS.z) < 6) return true;
  }
  return false;
}

/** El cable atravesado une los dos andenes de una misma vía; no pasa por encima de un parque. */
function onlyRoadBetween(map, a, b) {
  const length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(length / 1.5);
  for (let i = 2; i < steps - 1; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (!ROADS.has(map[Math.round(z / T)]?.[Math.round(x / T)])) return false;
  }
  return true;
}

const WIRE_DARK = [.018, .018, .02];
const WIRE_GRAY = [.05, .05, .055];

function addWires(wires, street, poles, map, UV) {
  const height = pole => pole.topY;
  const byRoad = new Map();
  for (const pole of poles) {
    const a = pole, b = pole.previous;
    const seed = [Math.round(pole.x * 3), Math.round(pole.z * 3)];
    if (b && Math.hypot(a.x - b.x, a.z - b.z) < 36 && !blockedSpan(map, a, b)) {
      // Red de media tensión tensa arriba; abajo la maraña de cables de cada empresa.
      const length = Math.hypot(a.x - b.x, a.z - b.z);
      for (const k of [-.82, 0, .82]) wires.span(anchor(a, { k, y: height(a) - .06 }), anchor(b, { k, y: height(b) - .06 }), length * .012, 8, WIRE_DARK);
      for (const k of [-.55, .55]) wires.span(anchor(a, { k, y: height(a) - 1.86 }), anchor(b, { k, y: height(b) - 1.86 }), length * .018, 8, WIRE_DARK);
      const tangle = 3 + Math.floor(unit(seed[0], seed[1], 60) * 5);
      for (let i = 0; i < tangle; i++) {
        const ka = (unit(seed[0], seed[1], 61 + i) - .5) * .4, kb = (unit(seed[1], seed[0], 61 + i) - .5) * .4;
        const ya = 4.4 + unit(seed[0], seed[1], 70 + i) * 2.2, yb = 4.4 + unit(seed[1], seed[0], 70 + i) * 2.2;
        wires.span(anchor(a, { k: ka, y: ya }), anchor(b, { k: kb, y: yb }), length * (.02 + unit(seed[0], seed[1], 80 + i) * .035), 8, i % 3 ? WIRE_DARK : WIRE_GRAY);
      }
    }
    const list = byRoad.get(pole.axis) ?? [];
    list.push(pole);
    byRoad.set(pole.axis, list);
  }
  // Cruces de calzada: un cable atravesado de andén a andén, con unos tenis colgados de vez en cuando.
  for (const list of byRoad.values()) {
    for (const a of list) {
      if (a.side !== 1) continue;
      let best = null, bestScore = Infinity;
      for (const b of list) {
        if (b.side !== -1) continue;
        const lateral = Math.abs(a.fixed - b.fixed) * T, shift = Math.abs(a.along - b.along);
        if (lateral < 6 || lateral > 34 || shift > 11) continue;
        if ((a.fixed + a.side * 1 - b.fixed) * a.side > 0) continue; // la vía debe quedar entre los dos
        const score = lateral + shift;
        if (score < bestScore && onlyRoadBetween(map, a, b)) { best = b; bestScore = score; }
      }
      const seed = [Math.round(a.x * 3), Math.round(a.z * 3)];
      if (!best || unit(seed[0], seed[1], 90) > .62 || blockedSpan(map, a, best)) continue;
      const ya = height(a) - 2.3, yb = height(best) - 2.3;
      const length = Math.hypot(a.x - best.x, a.z - best.z);
      for (let i = 0; i < 2 + (unit(seed[0], seed[1], 91) < .5 ? 1 : 0); i++) {
        wires.span([a.x, ya - i * .28, a.z], [best.x, yb - i * .34, best.z], length * .02 + i * .1, 10, WIRE_DARK);
      }
      if (unit(seed[0], seed[1], 92) < .3) {
        // Un par de tenis amarrados por los cordones.
        const t = .32 + unit(seed[0], seed[1], 93) * .36;
        const cx = a.x + (best.x - a.x) * t, cz = a.z + (best.z - a.z) * t;
        const sag = 4 * (length * .02) * t * (1 - t);
        const cy = ya + (yb - ya) * t - sag;
        const shoe = unit(seed[0], seed[1], 94) < .5 ? tint('#d6d3c9') : tint('#25262b');
        for (const k of [-.1, .1]) {
          const sx = cx + (a.axis === 'x' ? k : 0), sz = cz + (a.axis === 'x' ? 0 : k), drop = .42 + k;
          wires.span([cx, cy, cz], [sx, cy - drop, sz], 0, 1, WIRE_GRAY);
          street.box(sx, cy - drop - .1, sz, .1, .1, .28, a.axis === 'x' ? Math.PI / 2 : 0, UV.plain, shoe, .7);
        }
      }
    }
  }
  // Acometidas: de cada poste salen cables hacia las fachadas de atrás.
  for (const pole of poles) {
    const seed = [Math.round(pole.x * 3), Math.round(pole.z * 3)];
    const backX = pole.axis === 'x' ? 0 : -pole.side, backZ = pole.axis === 'x' ? -pole.side : 0;
    let hit = null;
    for (let d = 1; d < 9; d += .5) {
      const x = pole.x + backX * d, z = pole.z + backZ * d;
      if (SOLID.has(map[Math.round(z / T)]?.[Math.round(x / T)])) { hit = d; break; }
    }
    if (hit === null) continue;
    const drops = unit(seed[0], seed[1], 95) < .25 ? 0 : 1 + Math.floor(unit(seed[0], seed[1], 96) * 2.4);
    for (let i = 0; i < drops; i++) {
      const shift = (unit(seed[0], seed[1], 97 + i) - .5) * 9;
      const y = 2.9 + unit(seed[1], seed[0], 97 + i) * 1.3;
      const wall = pole.axis === 'x'
        ? [pole.x + shift, y, pole.z + backZ * hit]
        : [pole.x + backX * hit, y, pole.z + shift];
      wires.span([pole.x, 5.2 + unit(seed[0], seed[1], 101 + i) * 1.2, pole.z], wall, .22, 5, i ? WIRE_GRAY : WIRE_DARK);
    }
  }
}

// ---------- mobiliario y basura ----------

const CRATE_COLORS = ['#b53a2c', '#25609c', '#c9a227', '#2f7d4d', '#c9c6bb'].map(c => tint(c));
const CHAIR_COLORS = ['#e8e6dc', '#c03a2b', '#2d62a3', '#d8d4c4'].map(c => tint(c));

function addCrates(street, x, y, z, a, UV, seed) {
  const n = 1 + Math.floor(unit(seed, 1, 110) * 3);
  const color = CRATE_COLORS[Math.floor(unit(seed, 2, 110) * CRATE_COLORS.length)];
  for (let i = 0; i < n; i++) {
    street.box(x + (unit(seed, i, 111) - .5) * .05, y + i * .27, z + (unit(seed, i, 112) - .5) * .05, .5, .27, .36,
      a + (unit(seed, i, 113) - .5) * .25, UV.crate, color, .8);
  }
}
function addTyres(street, x, y, z, UV, seed) {
  const n = 2 + Math.floor(unit(seed, 1, 114) * 3), color = tint('#3a3a3d');
  for (let i = 0; i < n; i++) {
    street.cylinder(x + (unit(seed, i, 115) - .5) * .06, y + i * .19, z + (unit(seed, i, 116) - .5) * .06, .3, .3, .19, 8, UV.tire, color, .8);
  }
}
function addCardboard(street, x, y, z, a, UV, seed) {
  street.box(x, y, z, .56, .05, .74, a, UV.cardboard, [1, 1, 1], .9);
  street.box(x + .03, y + .05, z - .02, .5, .05, .68, a + .17, UV.cardboard, [.92, .9, .86], .9);
  if (unit(seed, 1, 117) < .7) street.box(x + .34, y, z + .22, .42, .36, .42, a + .4, UV.box, [1, 1, 1], .75);
}
function addSacks(street, x, y, z, UV, seed) {
  // Bolsas negras de basura y costales blancos de reciclador.
  const n = 1 + Math.floor(unit(seed, 1, 118) * 3);
  for (let i = 0; i < n; i++) {
    const px = x + (unit(seed, i, 119) - .5) * .7, pz = z + (unit(seed, i, 120) - .5) * .7;
    if (unit(seed, i, 121) < .6) street.cylinder(px, y, pz, .25, .09, .46, 6, UV.plain, tint('#15161a'), .7);
    else street.cylinder(px, y, pz, .25, .17, .62, 6, UV.sack, [1, 1, 1], .75);
  }
}
function addChairs(street, x, y, z, a, UV, seed) {
  const color = CHAIR_COLORS[Math.floor(unit(seed, 1, 122) * CHAIR_COLORS.length)];
  const c = Math.cos(a), s = Math.sin(a);
  const at = (i, j) => [x + i * c + j * s, z - i * s + j * c];
  const chair = (i, j, turn) => {
    const [cx, cz] = at(i, j), b = a + turn, bc = Math.cos(b), bs = Math.sin(b);
    street.box(cx, y + .4, cz, .42, .035, .42, b, UV.chair, color, 1);
    street.box(cx - bs * .2, y + .43, cz - bc * .2, .42, .42, .03, b, UV.chair, color, .9);
    for (const [ki, kj] of [[-.18, -.18], [.18, -.18], [-.18, .18], [.18, .18]]) {
      street.box(cx + ki * bc + kj * bs, y, cz - ki * bs + kj * bc, .035, .4, .035, b, UV.plain, color, .8);
    }
  };
  chair(-.62, 0, Math.PI / 2 + .1);
  if (unit(seed, 2, 122) < .6) chair(.62, .05, -Math.PI / 2 - .2);
  // Mesa plástica de tienda, igual de cuadrada en todo Bogotá.
  const [tx, tz] = at(0, 0);
  street.box(tx, y + .68, tz, .72, .035, .72, a, UV.chair, color, 1);
  for (const [ki, kj] of [[-.3, -.3], [.3, -.3], [-.3, .3], [.3, .3]]) {
    street.box(tx + ki * c + kj * s, y, tz - ki * s + kj * c, .04, .68, .04, a, UV.plain, color, .8);
  }
}

function addBin(street, x, y, z, UV, a) {
  const green = tint('#3f6650');
  street.cylinder(x, y, z, .05, .05, 1.02, 5, UV.rust, METAL, .8);
  street.cylinder(x + Math.cos(a) * .2, y + .42, z + Math.sin(a) * .2, .2, .24, .58, 8, UV.bin, green, .85);
}
function addBollard(street, x, y, z, UV, seed) {
  const body = unit(seed, 1, 123) < .5 ? tint('#3a3d40') : tint('#8b8a84');
  street.cylinder(x, y, z, .07, .06, .86, 6, UV.plain, body, .7);
  street.cylinder(x, y + .62, z, .066, .064, .1, 6, UV.plain, tint('#d9c23a'), 1);
}
function addCone(street, x, y, z, UV) {
  street.box(x, y, z, .34, .03, .34, 0, UV.plain, tint('#1c1c1e'), 1);
  street.cylinder(x, y + .03, z, .14, .025, .56, 7, UV.cone, [1, 1, 1], 1);
}
function addAdPost(street, x, y, z, a, UV, seed) {
  // Valla de barrio: dos tablas clavadas a un parante de madera.
  const kinds = [UV.paintA, UV.paintB, UV.paintC, UV.paintD, UV.adA, UV.adB, UV.adC, UV.adD];
  const uv = kinds[Math.floor(unit(seed, 1, 124) * kinds.length)];
  street.box(x, y, z, .09, 2.15, .09, a, UV.wood, [1, 1, 1], .7);
  street.box(x, y + 1.25, z, .86, .84, .04, a, uv, [1, 1, 1], 1);
}

/** Recorre el andén baldosa por baldosa; cada coordenada decide sola si deja algo y qué. */
function addClutter(street, map, UV, obstacles) {
  const rows = map.length, cols = map[0].length;
  const scan = (tx, tz, set) => DIRS.find(([dx, dz]) => set.has(map[tz + dz]?.[tx + dx]));
  // Lo que se deja contra la pared se corre a lo largo de ella: en una esquina no debe asomar a la vía.
  const clearOfRoad = (px, pz, r) => DIRS.every(([dx, dz]) => !ROADS.has(map[Math.round((pz + dz * r) / T)]?.[Math.round((px + dx * r) / T)]));
  for (let tz = 0; tz < rows; tz++) for (let tx = 0; tx < cols; tx++) {
    if (map[tz][tx] !== 'sidewalk') continue;
    const x = W(tx), z = W(tz), y = .12;
    const toRoad = scan(tx, tz, ROADS), toWall = scan(tx, tz, SOLID);
    const seed = (tx * 311 + tz * 733) >>> 0;
    const pick = unit(tx, tz, 125);
    if (toWall && pick < .085) {
      const [dx, dz] = toWall;
      const along = (unit(tx, tz, 126) - .5) * 1.3;
      const px = x + dx * (T / 2 - .42) + dz * along, pz = z + dz * (T / 2 - .42) + dx * along;
      if (!obstacles.free(px, pz, .55) || !clearOfRoad(px, pz, 1.25)) continue;
      const kind = unit(tx, tz, 127), a = Math.atan2(dx, dz) + (unit(tx, tz, 128) - .5) * .5;
      if (kind < .24) { addCrates(street, px, y, pz, a, UV, seed); obstacles.takesRoom(px, pz, .35, y, .81); }
      else if (kind < .4) { addTyres(street, px, y, pz, UV, seed); obstacles.takesRoom(px, pz, .33, y, .76); }
      else if (kind < .62) addCardboard(street, px, y, pz, a, UV, seed);
      else if (kind < .84) { addSacks(street, px, y, pz, UV, seed); obstacles.takesRoom(px, pz, .6, y, .62); }
      else {
        const qx = x + dx * (T / 2 - .95) + dz * along, qz = z + dz * (T / 2 - .95) + dx * along;
        if (obstacles.free(qx, qz, 1)) { addChairs(street, qx, y, qz, a, UV, seed); obstacles.takesRoom(qx, qz, .95, y, .85); }
      }
      obstacles.add(px, pz, .6);
    } else if (toRoad && pick < .05) {
      const [dx, dz] = toRoad;
      const along = (unit(tx, tz, 129) - .5) * 1.4;
      const px = x + dx * (T / 2 - .62) + dz * along, pz = z + dz * (T / 2 - .62) + dx * along;
      if (!obstacles.free(px, pz, .6)) continue;
      const kind = unit(tx, tz, 130);
      if (kind < .4) { addBin(street, px, y, pz, UV, Math.atan2(dz, dx) + Math.PI); obstacles.takesRoom(px, pz, .3, y, 1.02); }
      else if (kind < .7) { addAdPost(street, px, y, pz, Math.atan2(dz, dx) + (dx ? 0 : Math.PI / 2), UV, seed); obstacles.takesRoom(px, pz, .08, y, 2.15); }
      else if (kind < .84) for (let i = 0; i < 3; i++) {
        // La fila mide casi dos metros: cada cono mira su sitio, o el de la punta cae sobre una rampa.
        const cx = px + dz * (i - 1) * .9, cz = pz + dx * (i - 1) * .9;
        if (obstacles.free(cx, cz, .17)) { addCone(street, cx, y, cz, UV); obstacles.takesRoom(cx, cz, .15, y, .59); }
      }
      else { addSacks(street, px, y, pz, UV, seed); obstacles.takesRoom(px, pz, .6, y, .62); }
      obstacles.add(px, pz, .6);
    }
  }
  // Bolardos en algunas esquinas, para que los carros no se suban a la rampa.
  for (const { x0, x1, z0, z1 } of crossings()) {
    for (const [cx, cz, sx, sz] of [[x0, z0, -1, -1], [x1, z0, 1, -1], [x0, z1, -1, 1], [x1, z1, 1, 1]]) {
      const fx = Math.round(cx), fz = Math.round(cz);
      if (unit(fx, fz, 131) > .42) continue;
      for (let i = 0; i < 4; i++) {
        const px = cx + sx * .36, pz = cz + sz * (.5 + i * 1.05);
        if (map[Math.round(pz / T)]?.[Math.round(px / T)] !== 'sidewalk' || !obstacles.free(px, pz, .3)) continue;
        addBollard(street, px, .12, pz, UV, fx + i);
        obstacles.takesRoom(px, pz, .08, .12, .86);
      }
      for (let i = 0; i < 4; i++) {
        const px = cx + sx * (.5 + i * 1.05), pz = cz + sz * .36;
        if (map[Math.round(pz / T)]?.[Math.round(px / T)] !== 'sidewalk' || !obstacles.free(px, pz, .3)) continue;
        addBollard(street, px, .12, pz, UV, fz + i);
        obstacles.takesRoom(px, pz, .08, .12, .86);
      }
    }
  }
}

// ---------- luz de los faroles ----------

/**
 * Charco de luz de cada farol, pintado: de noche la calle se lee por sus faroles aunque la calidad
 * baja no tenga una luz real por poste. Es un lote por sector, sin luces nuevas; el halo es del poste.
 */
function addLampGlow(glow, district) {
  const uv = [0, 0, 1, 1], pool = tint('#ffb06a', .3);
  for (const prop of district.props ?? []) {
    const group = prop.instance?.group;
    if (!group) continue;
    const angle = group.rotation.y, reach = STREET_LAMP.lens.x;
    const hx = group.position.x + Math.cos(angle) * reach, hz = group.position.z - Math.sin(angle) * reach;
    const y = Math.max(group.position.y, 0) + .03, size = 7.8;
    glow.quad([hx - size, y, hz + size], [hx + size, y, hz + size], [hx + size, y, hz - size], [hx - size, y, hz - size], [0, 1, 0], uv, pool);
  }
}

const TUFT_TONES = [tint('#465a30'), tint('#5a6d38'), tint('#6d7a42'), tint('#85814f')];

/**
 * Matas bajas contra el borde del pasto, donde no llega la guadaña: hojas en lote por sector, sin
 * colisión. El medio del prado queda limpio y una hoja son dos triángulos, uno por cara.
 */
function addEdgeTufts(street, map, UV) {
  const uv = UV.plain, up = [0, 1, 0], y = HEIGHTS.grass;
  for (let tz = 0; tz < map.length; tz++) for (let tx = 0; tx < map[0].length; tx++) {
    if (map[tz][tx] !== 'grass' || inLakeTerrain(W(tx), W(tz))) continue;
    for (const [dx, dz] of DIRS) {
      const other = map[tz + dz]?.[tx + dx];
      if (other === undefined || other === 'grass') continue;
      for (let n = 0; n < 2; n++) {
        const salt = 90 + n * 20 + dx + dz * 2;
        if (unit(tx, tz, salt) > .52) continue;
        const along = (unit(tx, tz, salt + 1) - .5) * T * .94, inset = .24 + unit(tx, tz, salt + 2) * unit(tx, tz, salt + 3) * .85;
        const cx = W(tx) + dx * (T / 2 - inset) + dz * along, cz = W(tz) + dz * (T / 2 - inset) + dx * along;
        const height = .13 + unit(tx, tz, salt + 4) * .17, blades = 4 + Math.floor(unit(tx, tz, salt + 5) * 3);
        for (let b = 0; b < blades; b++) {
          const turn = unit(tx, tz, salt + 6 + b) * Math.PI * 2, c = Math.cos(turn), s = Math.sin(turn);
          const lean = .03 + unit(tz, tx, salt + b) * .1, reach = unit(tz, tx, salt + 7 + b) * .07, wide = .014 + reach * .12;
          const px = cx + c * reach, pz = cz + s * reach, top = height * (.65 + unit(tz, tx, salt + 15 + b) * .35);
          const tone = Math.min(3, Math.floor(unit(tx, tz, salt + 16 + b) * 3.35));
          const tip = TUFT_TONES[tone], root = scale(tip, .55);
          const left = [px - s * wide, y, pz + c * wide], right = [px + s * wide, y, pz - c * wide];
          const end = [px + c * lean, y + top, pz + s * lean];
          const colors = [root, root, tip];
          street.triangle(left, right, end, up, uv, colors);
          street.triangle(right, left, end, up, uv, colors);
        }
      }
    }
  }
}

const LANTERN_POOL_RADIUS = 5.4;
const POOL_GROUND = new Set(['road', 'busway', 'sidewalk', 'plaza', 'floor', 'dirt', 'grass']);

/**
 * Faroles de hierro de pared y de plaza: el charco se parte por tiles a la altura de cada uno,
 * sobre lo que se pisa. Así baja el andén sin flotar sobre el empedrado y se corta contra el muro.
 */
function addLanternPools(glow, district) {
  const T = TILE_SIZE, { map } = district, size = LANTERN_POOL_RADIUS, pool = tint('#ffb877', .24);
  const open = (x, z) => POOL_GROUND.has(map[Math.round(z / T)]?.[Math.round(x / T)]);
  for (const spot of district.lanternSpots ?? []) {
    // El de pared alumbra hacia afuera: el centro del charco se aparta del muro que lo sostiene.
    let cx = spot.x, cz = spot.z;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!open(spot.x + dx * T, spot.z + dz * T)) { cx -= dx * 1.3; cz -= dz * 1.3; }
    }
    for (let tz = Math.round((cz - size) / T); tz <= Math.round((cz + size) / T); tz++) {
      for (let tx = Math.round((cx - size) / T); tx <= Math.round((cx + size) / T); tx++) {
        if (!open(tx * T, tz * T)) continue;
        const x0 = Math.max(tx * T - T / 2, cx - size), x1 = Math.min(tx * T + T / 2, cx + size);
        const z0 = Math.max(tz * T - T / 2, cz - size), z1 = Math.min(tz * T + T / 2, cz + size);
        if (x0 >= x1 || z0 >= z1) continue;
        const y = district.getGroundHeight(tx * T, tz * T) + .03, span = size * 2;
        const uv = [(x0 - cx + size) / span, (cz + size - z1) / span, (x1 - cx + size) / span, (cz + size - z0) / span];
        glow.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], uv, pool);
      }
    }
  }
}

export function addStreetDetails(district, collisions = null) {
  district.sunField = buildSunField(district);
  // La ribera del lago tiene su propio shader: se encadena para que reciba la sombra del puente.
  if (district.lakeTerrain?.material) chainSunField(district.lakeTerrain.material);

  const { texture, uv: UV } = detailAtlas();
  const material = new THREE.MeshStandardMaterial({ map: texture, vertexColors: true, roughness: .9, metalness: 0, envMapIntensity: .5 });
  material.name = 'Calle: sardineles y mobiliario';
  const wireMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  wireMaterial.name = 'Calle: cables';
  const street = new StreetBatch({ material, name: 'Calle', castShadow: true, chunkSize: STATIC_CHUNK_SIZE * 2 });
  const wires = new WireBatch(wireMaterial);
  const map = district.map;

  addCurbs(street, map, UV);
  addRamps(street, map, UV);
  addBuswaySeparators(street, UV, district.height);

  const obstacles = createObstacles(district, collisions);
  const poles = planPoles(map, obstacles.free);
  for (const pole of poles) {
    pole.topY = addPole(street, pole, UV).top;
    obstacles.add(pole.x, pole.z, .5);
    obstacles.takesRoom(pole.x, pole.z, .14, district.getGroundHeight?.(pole.x, pole.z) ?? .12, 6);
  }
  addWires(wires, street, poles, map, UV);
  addClutter(street, map, UV, obstacles);
  addEdgeTufts(street, map, UV);

  const glowMaterial = fadeGlowInFog(new THREE.MeshBasicMaterial({ map: glowTexture(), vertexColors: true, transparent: true, opacity: 0, visible: false,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  glowMaterial.name = 'Calle: luz de faroles';
  const glow = new StreetBatch({ material: glowMaterial, name: 'Luz de faroles', receiveShadow: false, renderOrder: -1, chunkSize: STATIC_CHUNK_SIZE * 2 });
  addLampGlow(glow, district);
  addLanternPools(glow, district);
  registerNightGlow(glowMaterial);

  const group = new THREE.Group();
  group.name = 'Calle: cables y mobiliario';
  group.userData.noMerge = true;
  street.finish(group);
  wires.finish(group);
  glow.finish(group);
  addStreetPuddles(group, district, curbRuns(map), glowMaterial);
  district.group.add(group);
  district.streetPoles = poles;
  if (district.renderSectors) district.renderSectors.push(...createRenderSectors(group));
  freezeStaticTransforms(group);
}
