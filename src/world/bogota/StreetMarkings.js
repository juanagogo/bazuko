// Lo pintado y remendado sobre el suelo: un material y una llamada por sector, sin mallas sueltas.
// La pintura está gastada de verdad: el asfalto asoma por el canal alfa y las llantas la borran por carril.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { CITY_CALLES as CALLES, CITY_CARRERAS as CARRERAS } from './CityLayout.js';
import { CARACAS, SIDEWALK_TILES } from './StreetLayout.js';
import { VIADUCT } from './ColpatriaViaduct.js';
import { LAKE_PARK, bridgeHeight, inLakeTerrain, onLakeBridge } from './LakePark.js';
import { inTerminal } from './TransitTerminal.js';
import { neighborhoodAt } from './NeighborhoodIdentity.js';
import { paintAtlas, wornUv } from './textures-calle.js';
import { STATIC_CHUNK_SIZE } from './StaticGeometry.js';
import { StreetBatch, tint, unit } from './StreetBatch.js';

const T = TILE_SIZE;
const W = tile => tile * T;
const BAND = SIDEWALK_TILES * T;
const ROADS = new Set(['road', 'busway']);
const RAISED = new Set(['sidewalk', 'plaza', 'floor']);
const SOLID = new Set(['building', 'ruin', 'wall', 'smallBuilding', 'storeD69', 'colpatria', 'colpatriaAnnex']);
const LIFT = .012;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const WHITE = tint('#e8e6de');
const YELLOW = tint('#d8a01c');
const BUS_YELLOW = tint('#efc42f');
const INK = [.012, .012, .014];

/** Ruta común de las pruebas y del distrito: cruces con su banda de cebra. */
export function crossings() {
  const spans = [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
  const list = [];
  for (const [za, zb] of CALLES) for (const [xa, xb] of spans) {
    list.push({ za, zb, xa, xb, x0: W(xa) - T / 2, x1: W(xb) + T / 2, z0: W(za) - T / 2, z1: W(zb) + T / 2, wide: xa === CARACAS.lanes[0][0] });
  }
  return list;
}

// Un barrio puede tener las calles empedradas y sin pintura; si no lo declara se pinta como siempre.
const paintedByNeighborhood = (x, z) => neighborhoodAt(x, z)?.streets?.paintedLines !== false;

export function buildStreetMarkings(district, painted = paintedByNeighborhood) {
  const map = district.map;
  const tileAt = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  const onRoad = (x, z) => ROADS.has(tileAt(x, z));
  const { texture, uv: UV } = paintAtlas();
  const material = new THREE.MeshStandardMaterial({
    map: texture, vertexColors: true, transparent: true, depthWrite: false,
    roughness: .85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  material.name = 'Pintura y remiendos';
  // Con este nombre setWetness la moja igual que al andén: la pintura también brilla bajo la lluvia.
  if (district.groundMaterials) district.groundMaterials.sidewalk_pintura = material;
  // Sector doble: la pintura casi no pesa en vértices y sí sumaba muchas llamadas.
  // Lo que va sobre el piso se dibuja antes que todo lo transparente, para que sombras de contacto,
  // vidrios y personas queden encima: pintura, luego charcos (StreetPuddles) y luz de faroles (StreetDetails).
  const batch = new StreetBatch({ material, name: 'Suelo pintado', alpha: true, renderOrder: -3, chunkSize: STATIC_CHUNK_SIZE * 2 });

  const baseY = (x, z) => district.getGroundHeight(x, z) + LIFT;
  const bent = (x, z, y) => onLakeBridge(x, z) ? bridgeHeight(z) + LIFT : y;

  // Rectángulo alineado a los ejes: U sigue el lado largo, para que los rayones vayan con la franja.
  const rect = (cx, cz, sx, sz, uv, color) => {
    const y = baseY(cx, cz), hx = sx / 2, hz = sz / 2;
    const corners = [[cx - hx, cz + hz], [cx + hx, cz + hz], [cx + hx, cz - hz], [cx - hx, cz - hz]];
    if (sz > sx) corners.push(corners.shift());
    const [a, b, c, d] = corners.map(([x, z]) => [x, bent(x, z, y), z]);
    batch.quad(a, b, c, d, [0, 1, 0], uv, color);
  };
  const worn = (sx, sz, x, z, salt) => wornUv(Math.max(sx, sz), Math.min(sx, sz), unit(Math.round(x * 7), Math.round(z * 7), salt), unit(Math.round(z * 7), Math.round(x * 7), salt + 1));
  const inked = (base, x, z, salt, wear = 0, min = .62, spread = .33) => {
    const fx = Math.round(x * 7), fz = Math.round(z * 7), dirt = .8 + unit(fx, fz, salt) * .2;
    return [base[0] * dirt, base[1] * dirt, base[2] * dirt, (min + unit(fz, fx, salt) * spread) * (1 - wear)];
  };
  // Las llantas pasan a ±.85 m del centro del carril: ahí es donde la cebra desaparece primero.
  const tyreWear = (lateral, from, laneWidth) => {
    const offset = ((lateral - from) % laneWidth + laneWidth) % laneWidth;
    const d = Math.abs(Math.abs(offset - laneWidth / 2) - .85);
    return .68 * Math.exp(-(d * d) / .16);
  };
  const stripe = (cx, cz, sx, sz, base, salt, wear = 0, min, spread) => {
    if (!onRoad(cx, cz) || !painted(cx, cz)) return;
    rect(cx, cz, sx, sz, worn(sx, sz, cx, cz, salt), inked(base, cx, cz, salt, wear, min, spread));
  };
  // Calcomanía girada: `heading` apunta hacia donde la lee quien la pisa de frente.
  const glyph = (x, z, width, depth, dx, dz, uv, color) => {
    const y = baseY(x, z);
    batch.decal(x, y, z, width, depth, Math.atan2(-dx, -dz), uv, color, (px, pz) => bent(px, pz, y));
  };

  // Cruces de la cuadrícula: la línea amarilla no atraviesa la intersección ni la cebra.
  const crossingList = crossings();
  const nearCrossingX = x => crossingList.some(c => x > c.x0 - BAND - .4 && x < c.x1 + BAND + .4);
  const nearCrossingZ = z => crossingList.some(c => z > c.z0 - BAND - .4 && z < c.z1 + BAND + .4);
  // Nadie remienda encima de la cebra ni deja un sumidero en la mitad del paso de peatones.
  const inCrossing = (x, z, margin = 1) => crossingList.some(c =>
    x > c.x0 - BAND - margin && x < c.x1 + BAND + margin && z > c.z0 - BAND - margin && z < c.z1 + BAND + margin);

  // Letreros y numeración de la troncal, en el sentido de cada carril exclusivo.
  const busCenter = (W(CARACAS.busway[0]) + W(CARACAS.busway[1])) / 2;
  for (let z = 8; z < W(district.height) - 8; z += 22) {
    if (z >= VIADUCT.start && z <= VIADUCT.end) continue;
    if (CALLES.some(([a, b]) => z > W(a) - 7 && z < W(b) + 7)) continue;
    for (const side of [-1, 1]) {
      const x = busCenter + side * 3.5, heading = -side;
      if (!onRoad(x, z) || !painted(x, z)) continue;
      glyph(x, z, 3.1, 1.7, 0, heading, UV.soloBus, inked(BUS_YELLOW, x, z, 3, 0, .72, .22));
      const numberZ = z - heading * 3.6;
      if (onRoad(x, numberZ)) glyph(x, numberZ, 1.1, 2.3, 0, heading, side < 0 ? UV.uno : UV.dos, inked(WHITE, x, numberZ, 4, 0, .66, .24));
    }
  }

  // Dos pasos peatonales de la avenida sur, en los puntos de siempre.
  for (const z of [158, 178]) for (let x = 56; x <= 114; x += .9) stripe(x, z, .5, 1.6, WHITE, 5, tyreWear(x, 56, 3.5));

  // Línea central amarilla de calles y carreras.
  for (const [a, b] of CALLES) {
    const zc = (W(a) + W(b)) / 2;
    for (let x = 2; x < W(district.width) - 2; x += 3) {
      if (!nearCrossingX(x)) stripe(x, zc, 1.6, .13, YELLOW, 6);
    }
  }
  for (const [a, b] of CARRERAS) {
    const xc = (W(a) + W(b)) / 2;
    for (let z = 2; z < LAKE_PARK.z0; z += 3) {
      if (!nearCrossingZ(z)) stripe(xc, z, .13, 1.6, YELLOW, 6);
    }
  }

  // Divisiones de carril y borde de la Caracas: la leen desde lejos como avenida.
  for (const [a, b] of CARACAS.lanes) {
    const xc = (W(a) + W(b)) / 2;
    if (W(b) - W(a) >= 6) for (let z = 2; z < LAKE_PARK.z0; z += 7) {
      if (!nearCrossingZ(z)) stripe(xc, z, .12, 3, WHITE, 7);
    }
  }

  // Cebras a los cuatro lados de cada cruce, con su línea de pare y su flecha.
  const stops = (x0, x1, zStop, headZ) => {
    const cx = (x0 + x1) / 2;
    if (!onRoad(cx, zStop) || !painted(cx, zStop)) return;
    stripe(cx, zStop, x1 - x0, .42, WHITE, 8, 0, .7, .25);
    approach(cx, zStop, 0, headZ, x1 - x0);
  };
  const stopsX = (z0, z1, xStop, headX) => {
    const cz = (z0 + z1) / 2;
    if (!onRoad(xStop, cz) || !painted(xStop, cz)) return;
    stripe(xStop, cz, .42, z1 - z0, WHITE, 8, 0, .7, .25);
    approach(xStop, cz, headX, 0, z1 - z0);
  };
  // Lo que deja un semáforo: caucho pulido y aceite justo antes de la línea, PARE y flecha.
  function approach(x, z, dx, dz, laneWidth) {
    const fx = Math.round(x), fz = Math.round(z);
    glyph(x - dx * 8, z - dz * 8, 2.4, 13, dx, dz, UV.tyre, [INK[0], INK[1], INK[2], .55 + unit(fx, fz, 9) * .3]);
    const oilX = x - dx * (2.2 + unit(fx, fz, 10) * 3), oilZ = z - dz * (2.2 + unit(fz, fx, 10) * 3);
    glyph(oilX, oilZ, 1.3, 1.9, dx, dz, UV.oil2, [1, 1, 1, .66]);
    if (unit(fx, fz, 11) < .55 && laneWidth >= 3.4) {
      const px = x - dx * 2.4, pz = z - dz * 2.4;
      if (onRoad(px, pz)) glyph(px, pz, Math.min(3.4, laneWidth - .5), 1.5, dx, dz, UV.pare, inked(WHITE, px, pz, 12, 0, .68, .24));
    }
    const ax = x - dx * 7.2, az = z - dz * 7.2;
    if (!onRoad(ax, az)) return;
    const pick = unit(fx, fz, 13);
    const uv = pick < .62 ? UV.arrow : pick < .85 ? UV.arrowRight : UV.arrowLeft;
    glyph(ax, az, pick < .62 ? 1.25 : 1.95, 3.2, dx, dz, uv, inked(WHITE, ax, az, 14, 0, .64, .28));
  }
  for (const c of crossingList) {
    const { x0, x1, z0, z1 } = c, laneWidth = c.wide ? 3.5 : 6;
    for (const zEdge of [z0 - BAND / 2, z1 + BAND / 2]) {
      for (let x = x0 + .4; x < x1; x += .9) stripe(x, zEdge, .5, BAND - .4, WHITE, 15, tyreWear(x, x0, laneWidth));
    }
    for (const xEdge of [x0 - BAND / 2, x1 + BAND / 2]) {
      for (let z = z0 + .4; z < z1; z += .9) stripe(xEdge, z, BAND - .4, .5, WHITE, 15, tyreWear(z, z0, 6));
    }
    // Mano derecha: la mitad −x de la carrera baja hacia +z; la mitad +z de la calle corre hacia +x.
    const zc = (z0 + z1) / 2, xc = (x0 + x1) / 2;
    const lanesA = c.wide ? [W(CARACAS.lanes[0][0]) - T / 2, W(CARACAS.lanes[0][1]) + T / 2] : [x0 + .3, xc - .25];
    const lanesB = c.wide ? [W(CARACAS.lanes[1][0]) - T / 2, W(CARACAS.lanes[1][1]) + T / 2] : [xc + .25, x1 - .3];
    stops(lanesA[0], lanesA[1], z0 - BAND - .7, 1);
    stops(lanesB[0], lanesB[1], z1 + BAND + .7, -1);
    stopsX(zc + .25, z1 - .3, x0 - BAND - .7, 1);
    stopsX(z0 + .3, zc - .25, x1 + BAND + .7, -1);
  }

  // Remiendos del asfalto y mugre de los bordes, tile por tile y siempre igual para las mismas coordenadas.
  const height = map.length, width = map[0].length;
  const rotated = (tx, tz, salt) => unit(tx, tz, salt) < .5 ? 0 : Math.PI / 2;
  for (let tz = 0; tz < height; tz++) for (let tx = 0; tx < width; tx++) {
    const type = map[tz][tx], x = W(tx), z = W(tz);
    if (inTerminal(x, z) || inLakeTerrain(x, z) || onLakeBridge(x, z)) continue;
    if (type === 'road') {
      const cobbled = !painted(x, z);
      const px = x + (unit(tx, tz, 20) - .5) * 1.2, pz = z + (unit(tz, tx, 20) - .5) * 1.2;
      const pick = unit(tx, tz, 21), y = LIFT;
      const white = [1, 1, 1, 1];
      if (pick < .018) batch.decal(px, y, pz, 1.24, 1.24, unit(tx, tz, 22) * 6.28, unit(tx, tz, 23) < .7 ? UV.manhole : UV.manhole2, white);
      if (cobbled) continue;
      if (pick >= .03 && pick < .068 && !inCrossing(x, z)) {
        const big = unit(tx, tz, 24);
        batch.decal(px, y, pz, 1.2 + big * 2.1, 1 + unit(tz, tx, 24) * 1.5, rotated(tx, tz, 25) + (unit(tx, tz, 26) - .5) * .08,
          big < .62 ? UV.patch : UV.patch2, [1, 1, 1, 1]);
      } else if (pick >= .068 && pick < .125) {
        batch.decal(px, y, pz, 2 + unit(tx, tz, 27) * 2.6, .46, unit(tx, tz, 28) * 3.14, unit(tx, tz, 29) < .5 ? UV.crack : UV.crack2, [1, 1, 1, .62]);
      } else if (pick >= .125 && pick < .18) {
        const s = .9 + unit(tx, tz, 30) * 1.1;
        batch.decal(px, y, pz, s, s * 1.25, unit(tx, tz, 31) * 6.28, unit(tx, tz, 32) < .5 ? UV.oil : UV.oil2, [1, 1, 1, .62]);
      } else if (pick >= .18 && pick < .184) {
        batch.decal(px, y, pz, 1.05, .9, unit(tx, tz, 33) * 6.28, UV.pothole, [1, 1, 1, .9]);
      }
    }
    if (ROADS.has(type) || RAISED.has(type)) {
      for (const [dx, dz] of DIRS) {
        const neighbor = map[tz + dz]?.[tx + dx];
        // Mugre que se junta contra el sardinel: amarra la calzada con el andén.
        if (ROADS.has(type) && RAISED.has(neighbor)) {
          grime(x, z, dx, dz, .62, .42, tx, tz);
          if (type === 'road' && unit(tx + dx, tz + dz, 34) < .05 && !inCrossing(x, z)) {
            // Sumidero al pie del sardinel, con la boca hacia el centro de la vía.
            const ox = x + dx * (T / 2 - .3), oz = z + dz * (T / 2 - .3);
            batch.decal(ox, baseY(x, z), oz, 1.1, .55, Math.atan2(dx, dz), UV.grate, [1, 1, 1, 1]);
          }
        }
        // Y contra los muros: hace de sombra de contacto también sin mapas de sombra.
        if (RAISED.has(type) && SOLID.has(neighbor)) grime(x, z, dx, dz, .8, .46, tx, tz);
      }
      if (type === 'sidewalk') {
        const pick = unit(tx, tz, 35);
        const px = x + (unit(tx, tz, 36) - .5) * 1.1, pz = z + (unit(tz, tx, 36) - .5) * 1.1;
        if (pick < .02) batch.decal(px, baseY(x, z), pz, .58, .58, rotated(tx, tz, 37), UV.cover, [1, 1, 1, 1]);
        else if (pick < .05) batch.decal(px, baseY(x, z), pz, 1 + unit(tx, tz, 38), 1 + unit(tz, tx, 38), unit(tx, tz, 39) * 6.28, UV.oil, [1, 1, 1, .34]);
      }
    }
  }

  // Banda oscura con degradado hacia afuera; usa la textura gastada para que no sea una regla.
  function grime(x, z, dx, dz, width, strength, tx, tz) {
    const y = baseY(x, z);
    const ex = x + dx * T / 2, ez = z + dz * T / 2;
    const rx = dz, rz = -dx;
    const at = (along, inward) => [ex + rx * along - dx * inward, y, ez + rz * along - dz * inward];
    const edge = [INK[0], INK[1], INK[2], strength], far = [INK[0], INK[1], INK[2], 0];
    const uv = wornUv(2, width, unit(tx, tz, 40), unit(tz, tx, 40));
    // Vista desde arriba: del borde hacia adentro, en sentido antihorario.
    batch.quad(at(-T / 2, 0), at(T / 2, 0), at(T / 2, width), at(-T / 2, width), [0, 1, 0], uv, [edge, edge, far, far]);
  }

  return batch.finish(district.group);
}
