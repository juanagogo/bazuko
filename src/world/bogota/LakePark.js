import * as THREE from 'three';
import { busPathX } from './Colpatria.js';
import { BRIDGE_RISE } from './BridgeElevation.js';
import { createLakeWaterMaterial } from './LakeWaterMaterial.js';
import { createLakeShoreMaterial, createLakeShorePalette, sampleLakeShore } from './LakeShoreMaterials.js';

export const LAKE_PARK = Object.freeze({ name: 'Parque del Lago', z0: 222, z1: 318,
  lakeX: 75, lakeZ: 262, radiusX: 50, radiusZ: 26, surfaceY: -.18, maxDepth: 6, bankWidth: 2 });
// Bordes impares: coinciden con los bordes de los tiles de dos metros sustituidos.
export const LAKE_TERRAIN = Object.freeze({ x0: 21, x1: 129, z0: 231, z1: 293, step: 1 });
export const LAKE_BRIDGE = Object.freeze({ x0: 68, x1: 82, z0: 220, z1: 318,
  crestStart: 220, crestEnd: 280, rise: BRIDGE_RISE });

export function onLakeBridge(x, z) {
  return z >= LAKE_BRIDGE.z0 && z <= LAKE_BRIDGE.z1 && x >= busPathX(z,LAKE_BRIDGE.x0) && x <= busPathX(z,LAKE_BRIDGE.x1);
}

export function bridgeHeight(z) {
  const b = LAKE_BRIDGE;
  // La entrada norte conecta elevada con el viaducto; solo baja en la orilla sur.
  if (z < b.z0 - 1 || z >= b.z1) return .02;
  const t = z > b.crestEnd ? (b.z1 - z) / (b.z1 - b.crestEnd) : 1;
  return .02 + b.rise * (.5 - .5 * Math.cos(Math.PI * t));
}

export function lakeRadius(x, z) {
  return Math.hypot((x - LAKE_PARK.lakeX) / LAKE_PARK.radiusX, (z - LAKE_PARK.lakeZ) / LAKE_PARK.radiusZ);
}

export function inLakeTerrain(x, z) {
  return x >= LAKE_TERRAIN.x0 && x <= LAKE_TERRAIN.x1 && z >= LAKE_TERRAIN.z0 && z <= LAKE_TERRAIN.z1;
}

/** Perfil suave de la cubeta; la franja exterior enlaza con el suelo del parque. */
function terrainVertexHeight(x, z, landHeightAt) {
  const radius = lakeRadius(x, z), p = LAKE_PARK;
  if (radius <= 1) return p.surfaceY - p.maxDepth * Math.pow(Math.max(0, 1 - radius * radius), 1.5);
  const land = landHeightAt(x, z);
  const bank = THREE.MathUtils.smoothstep((radius - 1) * p.radiusZ, 0, p.bankWidth);
  return THREE.MathUtils.lerp(p.surfaceY, land, bank);
}

const flatPark = () => .06;

/** La misma interpolación de los triángulos dibujados, sin suelo invisible paralelo. */
export function lakeTerrainHeight(x, z, landHeightAt = flatPark) {
  if (!inLakeTerrain(x, z)) return null;
  const a = LAKE_TERRAIN;
  const x0 = Math.min(a.x1 - a.step, Math.floor((x - a.x0) / a.step) * a.step + a.x0);
  const z0 = Math.min(a.z1 - a.step, Math.floor((z - a.z0) / a.step) * a.step + a.z0);
  const fx = (x - x0) / a.step, fz = (z - z0) / a.step;
  const h00 = terrainVertexHeight(x0, z0, landHeightAt);
  const h10 = terrainVertexHeight(x0 + a.step, z0, landHeightAt);
  const h01 = terrainVertexHeight(x0, z0 + a.step, landHeightAt);
  const h11 = terrainVertexHeight(x0 + a.step, z0 + a.step, landHeightAt);
  return fx + fz <= 1
    ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
    : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

export function lakeWaterInfo(x, z, landHeightAt = flatPark) {
  if (lakeRadius(x, z) >= 1) return null;
  const bottomY = lakeTerrainHeight(x, z, landHeightAt);
  const depth = LAKE_PARK.surfaceY - bottomY;
  if (!(depth > 0)) return null;
  return { surfaceY: LAKE_PARK.surfaceY, depth, bottomY };
}

function lakeGrid(landHeightAt, surface = false, shoreOptions = {}) {
  const { x0, x1, z0, z1, step } = LAKE_TERRAIN;
  const columns = (x1 - x0) / step + 1, rows = (z1 - z0) / step + 1;
  const positions = [], colors = [], uvs = [], depths = [], plazas = [], layers = [], indices = [];
  const palette = createLakeShorePalette(shoreOptions), sample = { color: new THREE.Color() };
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const x = x0 + col * step, z = z0 + row * step;
    const y = terrainVertexHeight(x, z, landHeightAt), depth = Math.max(0, LAKE_PARK.surfaceY - y);
    positions.push(x, surface ? LAKE_PARK.surfaceY : y, z);
    uvs.push(x / 8, z / 8);
    depths.push(depth);
    const bankDistance = (lakeRadius(x, z) - 1) * LAKE_PARK.radiusZ;
    const bank = THREE.MathUtils.smoothstep(bankDistance, 0, LAKE_PARK.bankWidth);
    const onPlaza = landHeightAt(x, z) >= .1 ? bank : 0;
    plazas.push(onPlaza);
    sampleLakeShore({ x, z, depth, bankDistance,
      edgeDistance: Math.min(x - x0, x1 - x, z - z0, z1 - z) }, palette, sample);
    colors.push(sample.color.r, sample.color.g, sample.color.b);
    layers.push(sample.grass, sample.gravel, sample.wet);
  }
  for (let row = 0; row < rows - 1; row++) for (let col = 0; col < columns - 1; col++) {
    const a = row * columns + col, b = a + 1, c = a + columns, d = c + 1;
    if (surface && Math.max(depths[a], depths[b], depths[c], depths[d]) <= 0) continue;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('lakeDepth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setAttribute('lakePlaza', new THREE.Float32BufferAttribute(plazas, 1));
  if (!surface) geometry.setAttribute('lakeLayers', new THREE.Float32BufferAttribute(layers, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.boundingBox.min.y -= surface ? .035 : 0;
  geometry.boundingBox.max.y += surface ? .035 : 0;
  geometry.computeBoundingSphere();
  if (surface) geometry.boundingSphere.radius += .035;
  return geometry;
}

export function buildLakeTerrain(landHeightAt = flatPark, options = {}) {
  const terrain = new THREE.Mesh(lakeGrid(landHeightAt, false, options), createLakeShoreMaterial(options));
  terrain.name = 'Cubeta profunda y ribera continua';
  terrain.receiveShadow = true;
  // El agrupador estático elimina atributos extra; conservar los colores del lecho.
  terrain.userData.noMerge = true;
  return terrain;
}

export function buildLakeWater(material = createLakeWaterMaterial(), landHeightAt = flatPark) {
  const water = new THREE.Mesh(lakeGrid(landHeightAt, true), material);
  water.name = 'Agua continua bajo el puente';
  water.receiveShadow = true;
  water.userData.noMerge = true;
  water.userData.update = dt => material.userData.update?.(dt);
  return water;
}

/** Solo la ampliación; se conserva la posición de todas las calles del centro. */
export function paintLakePark(map) {
  const p = LAKE_PARK, b = LAKE_BRIDGE;
  for (let z = 111; z < map.length - 1; z++) for (let x = 1; x < map[0].length - 1; x++) {
    const wx = x * 2, wz = z * 2;
    const radius = Math.hypot((wx - p.lakeX) / p.radiusX, (wz - p.lakeZ) / p.radiusZ);
    const promenade = Math.abs(radius - 1.14) < .045 || z === 113 || z === 155 || x === 10 || x === 112 ||
      (x === 86 && (wz < 234 || wz > 290));
    map[z][x] = radius < 1 ? 'water' : promenade ? 'plaza' : 'grass';
    if (onLakeBridge(wx,wz)) map[z][x] = 'busway';
  }
}
