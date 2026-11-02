// Charcos: el agua se queda junto al sardinel y en los baches del carril. En seco no dibujan nada.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { STATIC_CHUNK_SIZE } from './StaticGeometry.js';
import { StreetBatch, tint, unit } from './StreetBatch.js';
import { inLakeTerrain, onLakeBridge } from './LakePark.js';

const T = TILE_SIZE;
const ROADS = new Set(['road', 'busway']);
const PAVED = new Set(['sidewalk', 'plaza']);
const LIFT = .017;
const MASK_SIZE = 128;
const MAX_STEP = .025;

let maskCache = null;
/** Mancha irregular por suma de ondas: sin lienzo, para construirse igual en cualquier entorno. */
function puddleMask() {
  if (maskCache) return maskCache;
  const data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);
  for (let j = 0; j < MASK_SIZE; j++) for (let i = 0; i < MASK_SIZE; i++) {
    const u = (i + .5) / MASK_SIZE * 2 - 1, v = (j + .5) / MASK_SIZE * 2 - 1, a = Math.atan2(v, u);
    const wobble = .17 * Math.sin(a * 3 + 1.1) + .11 * Math.sin(a * 5 + 2.6) + .07 * Math.sin(a * 9 + .4)
      + .06 * Math.sin(u * 13 + v * 7) * Math.sin(v * 11 - u * 5);
    const f = (.74 + wobble - Math.hypot(u, v)) / .1, k = Math.min(1, Math.max(0, f));
    const p = (j * MASK_SIZE + i) * 4;
    data[p] = data[p + 1] = data[p + 2] = 255;
    data[p + 3] = Math.round(k * k * (3 - 2 * k) * 255);
  }
  const texture = new THREE.DataTexture(data, MASK_SIZE, MASK_SIZE, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.name = 'Forma de los charcos';
  texture.needsUpdate = true;
  texture.addEventListener('dispose', () => { maskCache = null; });
  maskCache = texture;
  return texture;
}

/** Dónde se acumula el agua. Determinista: la misma cuadra siempre se encharca en el mismo sitio. */
export function planPuddles(map, runs, heightAt = () => 0) {
  const tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  const fits = (set, x, z, hw, hd, along) => {
    const [dx, dz] = along === 'x' ? [hw, hd] : [hd, hw];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * dx, z + b * dz]);
    if (!corners.every(([px, pz]) => set.has(tile(px, pz)))) return false;
    // El agua es plana: nada de charcos sobre una rampa o un escalón.
    const y = corners.map(([px, pz]) => heightAt(px, pz));
    return Math.max(...y) - Math.min(...y) <= MAX_STEP;
  };
  const out = [];
  // Junto al sardinel: la calle tiene bombeo y el agua corre hacia el borde.
  for (const { axis, fixed, a, b, side } of runs) {
    for (let i = a; i <= b; i += 3) {
      if (unit(i, fixed, 71 + side) > .46) continue;
      const width = 1.5 + unit(fixed, i, 72) * 2.9, depth = .75 + unit(i, fixed, 73) * .75;
      const along = (i + unit(fixed, i, 74)) * T, across = fixed * T + side * (T / 2 + .22 + depth / 2);
      const [x, z] = axis === 'x' ? [along, across] : [across, along];
      if (fits(ROADS, x, z, width / 2, depth / 2, axis)) out.push({ x, z, width, depth, axis });
    }
  }
  // Baches del carril y losas hundidas del andén, más escasos.
  map.forEach((row, j) => row.forEach((type, i) => {
    const road = ROADS.has(type), paved = PAVED.has(type);
    if (!road && !paved) return;
    if (unit(i, j, 75) > (road ? .018 : .012)) return;
    const axis = unit(j, i, 76) < .5 ? 'x' : 'z', width = (road ? 1.3 : .9) + unit(i, j, 77) * 1.7, depth = (road ? .8 : .55) + unit(j, i, 78) * .7;
    const x = i * T + (unit(i, j, 79) - .5) * .8, z = j * T + (unit(j, i, 80) - .5) * .8;
    if (fits(road ? ROADS : PAVED, x, z, width / 2, depth / 2, axis)) out.push({ x, z, width, depth, axis });
  }));
  return out;
}

let puddleMaterial = null, lampGlow = null;

/** La lluvia ya cayó: aparecen los charcos y el pavimento mojado devuelve más luz de los faroles. */
export function setPuddles(wetness) {
  const k = Math.min(1, Math.max(0, (wetness - .3) / .55)), level = k * k * (3 - 2 * k);
  if (puddleMaterial) {
    puddleMaterial.opacity = .9 * level;
    puddleMaterial.visible = level > .01;
  }
  lampGlow?.color.setScalar(1 + level * .2);
}

export function addStreetPuddles(group, district, runs, glowMaterial = null) {
  const material = new THREE.MeshStandardMaterial({
    map: puddleMask(), vertexColors: true, transparent: true, opacity: 0, visible: false, depthWrite: false,
    roughness: .07, metalness: 0, envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  material.name = 'Calle: charcos';
  puddleMaterial = material;
  lampGlow = glowMaterial;
  const batch = new StreetBatch({ material, name: 'Charcos', receiveShadow: true, renderOrder: -2, chunkSize: STATIC_CHUNK_SIZE * 2 });
  const color = tint('#262d33');
  const variants = [[0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0], [1, 1, 0, 0]];
  const plan = planPuddles(district.map, runs, (x, z) => district.getGroundHeight(x, z));
  for (const { x, z, width, depth, axis } of plan) {
    if (onLakeBridge(x, z) || inLakeTerrain(x, z)) continue;
    const y = district.getGroundHeight(x, z) + LIFT;
    batch.decal(x, y, z, width, depth, axis === 'x' ? 0 : Math.PI / 2, variants[Math.floor(unit(Math.round(x), Math.round(z), 81) * 4)], color);
  }
  batch.finish(group);
  return plan.length;
}
