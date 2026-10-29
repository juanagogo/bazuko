import * as THREE from 'three';
import { LAKE_PARK, onLakeBridge } from './LakePark.js';

// El cambuche conserva su reserva incluso si el caller no proporciona isReserved.
// No importar Bogota aquí: el distrito construye este módulo.
export const PARK_VEGETATION = Object.freeze({
  maxClusters: 320, maxPerSector: 24, sectorSize: 32, maxHeight: .68,
  windAmplitude: .035, windBounds: .055, clearance: .12,
  shelter: Object.freeze({ x: 112.98, z: 94.64, radius: 7 })
});
export const vegetationWind = { value: 0 };
const TAU = Math.PI * 2;
const SEED = 0x3b17c9e5;
const KINDS = ['grass', 'shrub', 'flowers', 'reeds'];
const LAKE_WATER_LEVEL = -.18;
const lakeRadius = (x, z) => Math.hypot((x - LAKE_PARK.lakeX) / LAKE_PARK.radiusX,
  (z - LAKE_PARK.lakeZ) / LAKE_PARK.radiusZ);

/** Huella visual del lago existente; no añade profundidad ni física del agua. */
export const lakeVegetationMask = (x, z) => lakeRadius(x, z) < 1;

function hash(x, z, salt = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ SEED ^ salt;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const sectorAt = (x, z) => `${Math.floor(x / PARK_VEGETATION.sectorSize)},${Math.floor(z / PARK_VEGETATION.sectorSize)}`;
const distanceToGrid = (value, origin, spacing) => Math.abs(value - origin - Math.round((value - origin) / spacing) * spacing);

/**
 * Solo planifica sobre césped existente. Cada huella incluye follaje, viento y
 * margen; ni caminos, reservas ni agua reciben geometría decorativa.
 * isReserved(x, z, radius) puede proteger mobiliario u otros puntos del distrito.
 * getWaterInfo(x, z) puede devolver un booleano o cualquier valor truthy sobre agua.
 */
export function planParkVegetation({ map, tileSize = 2, groundHeight = () => .06,
  getWaterInfo = lakeVegetationMask, isReserved = () => false } = {}) {
  const clusters = [], counts = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  const result = { clusters, metrics: { clusters: 0, sectors: 0, kinds: counts, maxHeight: 0, coveredArea: 0 } };
  if (!map?.length || !(tileSize > 0) || !Number.isFinite(tileSize)) return result;
  const tileAt = (x, z) => map[Math.round(z / tileSize)]?.[Math.round(x / tileSize)];
  const reserved = (x, z, radius = 0) => {
    const shelter = PARK_VEGETATION.shelter;
    return Math.hypot(x - shelter.x, z - shelter.z) <= shelter.radius + radius || isReserved(x, z, radius);
  };
  // La rampa sur baja de 1,2 m: su exclusión no puede depender de la altura
  // ni de un tile cuyo centro quede fuera del tablero curvo.
  const safePoint = (x, z) => tileAt(x, z) === 'grass' && !onLakeBridge(x, z) && !getWaterInfo(x, z) && !reserved(x, z);
  const footprint = (x, z, radius) => {
    const margin = radius + PARK_VEGETATION.windBounds + PARK_VEGETATION.clearance;
    if (reserved(x, z, margin)) return null;
    const y = groundHeight(x, z);
    if (!Number.isFinite(y) || y > 1.2 || y < LAKE_WATER_LEVEL) return null;
    // Recorrer todos los tiles del rectángulo evita atravesar las esquinas de un paseo.
    for (let row = Math.round((z - margin) / tileSize); row <= Math.round((z + margin) / tileSize); row++) {
      for (let col = Math.round((x - margin) / tileSize); col <= Math.round((x + margin) / tileSize); col++) {
        if (map[row]?.[col] !== 'grass') return null;
      }
    }
    const steps = Math.ceil(margin * 2 / .2);
    let minY = y, maxY = y;
    for (let iz = 0; iz <= steps; iz++) for (let ix = 0; ix <= steps; ix++) {
      const px = x - margin + 2 * margin * ix / steps, pz = z - margin + 2 * margin * iz / steps;
      if (!safePoint(px, pz)) return null;
      const py = groundHeight(px, pz);
      if (!Number.isFinite(py) || Math.abs(py - y) > .065) return null;
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    if (maxY - minY > .11) return null;
    return { y, slopeX: (groundHeight(x + radius, z) - groundHeight(x - radius, z)) / (2 * radius),
      slopeZ: (groundHeight(x, z + radius) - groundHeight(x, z - radius)) / (2 * radius) };
  };
  const bins = new Map();
  // Anclas separadas cuatro metros; cada una produce una pequeña agrupación,
  // con claros amplios entre grupos. El orden no depende del azar global.
  const stride = Math.max(1, Math.round(4 / tileSize));
  for (let row = 1; row < map.length - 1; row += stride) {
    for (let col = 1; col < (map[row]?.length ?? 0) - 1; col += stride) {
      if (map[row][col] !== 'grass') continue;
      const seed = hash(col, row), rng = random(seed);
      const x = col * tileSize + (rng() - .5) * .8, z = row * tileSize + (rng() - .5) * .8;
      if (!safePoint(x, z)) continue;
      const y = groundHeight(x, z);
      if (!Number.isFinite(y) || y > 1.2) continue;
      let edge = false;
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        if (map[row + dz]?.[col + dx] !== 'grass') edge = true;
      }
      const nearLake = z >= LAKE_PARK.z0 && lakeRadius(x, z) < 1.1;
      const spacing = z >= LAKE_PARK.z0 ? 12 : 8;
      const treeDistance = Math.hypot(distanceToGrid(x, 14, spacing), distanceToGrid(z, z >= LAKE_PARK.z0 ? 230 : 2, spacing));
      if (!edge && !nearLake && treeDistance > 3 && rng() > .12) continue;
      const key = sectorAt(x, z);
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push({ x, z, seed, score: rng() + (nearLake ? 2 : edge ? 1 : .35) });
    }
  }
  const sectors = [...bins].map(([key, anchors]) => ({ key, anchors: anchors.sort((a, b) => b.score - a.score), count: 0 }));
  sectors.sort((a, b) => {
    const [ax, az] = a.key.split(',').map(Number), [bx, bz] = b.key.split(',').map(Number);
    return hash(ax, az, 23) - hash(bx, bz, 23);
  });
  let remaining = true;
  while (remaining && clusters.length < PARK_VEGETATION.maxClusters) {
    remaining = false;
    for (const sector of sectors) {
      if (!sector.anchors.length || sector.count >= PARK_VEGETATION.maxPerSector) continue;
      remaining = true;
      const anchor = sector.anchors.shift(), rng = random(anchor.seed ^ 0x5ac91);
      const groupSize = 3 + Math.floor(rng() * 3);
      for (let n = 0; n < groupSize && sector.count < PARK_VEGETATION.maxPerSector && clusters.length < PARK_VEGETATION.maxClusters; n++) {
        const angle = rng() * TAU, distance = n === 0 ? 0 : .65 + rng() * 1.1;
        const x = anchor.x + Math.cos(angle) * distance, z = anchor.z + Math.sin(angle) * distance;
        if (sectorAt(x, z) !== sector.key) continue;
        const shore = z >= LAKE_PARK.z0 && lakeRadius(x, z) > 1 && lakeRadius(x, z) < 1.095;
        const roll = rng();
        const kind = shore && roll < .82 ? 'reeds' : roll < .22 ? 'shrub' : roll < .29 ? 'flowers' : 'grass';
        const radius = kind === 'shrub' ? .44 + rng() * .12 : .25 + rng() * .12;
        if (clusters.some(other => Math.hypot(other.x - x, other.z - z) < (other.radius + radius) * .92)) continue;
        const support = footprint(x, z, radius);
        if (!support) continue;
        const height = kind === 'reeds' ? .5 + rng() * .1 : kind === 'shrub' ? .4 + rng() * .14 : .27 + rng() * .15;
        clusters.push({ kind, x, z, ...support, radius, height, seed: hash(anchor.seed, n, 81), sector: sector.key });
        sector.count++; counts[kind]++;
        result.metrics.maxHeight = Math.max(result.metrics.maxHeight, height);
        result.metrics.coveredArea += Math.PI * radius * radius;
      }
    }
  }
  result.metrics.clusters = clusters.length;
  result.metrics.sectors = sectors.filter(sector => sector.count > 0).length;
  return result;
}

const PALETTE = {
  grass: ['#607b45', '#7b8950', '#4b6941', '#8b8c56'],
  shrub: ['#496646', '#648056', '#77905c', '#526f53'],
  reeds: ['#7a8959', '#939362', '#627b50'],
  flowers: ['#d0cdb2', '#c2bb83', '#b3bfa1'],
  seed: ['#77735a', '#96866b']
};

function createMaterial(windTime) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true,
    roughness: .96, metalness: 0, side: THREE.DoubleSide });
  material.name = 'Vegetación baja · verdes de altura';
  material.userData.windTime = windTime;
  material.onBeforeCompile = shader => {
    shader.uniforms.parkWindTime = windTime;
    shader.vertexShader = `uniform float parkWindTime;\nattribute vec3 treeWind;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(parkWindTime * treeWind.y + treeWind.x) * treeWind.z;
        transformed.z += cos(parkWindTime * treeWind.y * .73 + treeWind.x) * treeWind.z * .72;
      `);
  };
  material.customProgramCacheKey = () => 'park-vegetation-v1';
  return material;
}

// Geometría directa por sector: no se crean cientos de Mesh ni texturas alpha.
function addCluster(batch, plant) {
  const rng = random(plant.seed), phase = rng() * TAU, frequency = .7 + rng() * .45;
  const colors = Object.fromEntries(Object.entries(PALETTE).map(([key, values]) => [key, values.map(value => new THREE.Color(value))]));
  const choose = kind => colors[kind][Math.floor(rng() * colors[kind].length)];
  const vertex = (x, y, z, color, shade = 1) => {
    const i = batch.positions.length / 3;
    batch.positions.push(plant.x + x, plant.y + .003 + y + x * plant.slopeX + z * plant.slopeZ, plant.z + z);
    batch.colors.push(color.r * shade, color.g * shade, color.b * shade);
    batch.uvs.push(x, y);
    const bend = THREE.MathUtils.clamp(y / plant.height, 0, 1);
    batch.wind.push(phase, frequency, PARK_VEGETATION.windAmplitude * bend * bend);
    return i;
  };
  const blade = (x, z, y, length, width, yaw, lean, color) => {
    const dx = Math.cos(yaw), dz = Math.sin(yaw), sx = -dz * width / 2, sz = dx * width / 2;
    const a = vertex(x - sx, y, z - sz, color, .68), b = vertex(x + sx, y, z + sz, color, .68);
    const c = vertex(x + dx * lean * .35 - sx * .6, y + length * .55, z + dz * lean * .35 - sz * .6, color, .96);
    const d = vertex(x + dx * lean * .35 + sx * .6, y + length * .55, z + dz * lean * .35 + sz * .6, color, 1);
    const tip = vertex(x + dx * lean, y + length, z + dz * lean, color, 1.08);
    batch.indices.push(a, b, c, b, d, c, c, d, tip);
  };
  const stem = (x, z, height, color, width = .009) => {
    const a = vertex(x - width, 0, z, color, .7), b = vertex(x + width, 0, z, color, .7);
    const c = vertex(x - width * .5, height, z, color), d = vertex(x + width * .5, height, z, color);
    batch.indices.push(a, b, c, b, d, c);
  };
  if (plant.kind === 'shrub') {
    // Ramas bajas abiertas con hojas elípticas: evita bolas o conos macizos.
    for (let branch = 0; branch < 7; branch++) {
      const angle = rng() * TAU, r = rng() * plant.radius * .45;
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r, h = plant.height * (.6 + rng() * .4);
      stem(x, z, h * .85, choose('seed'));
      for (let leaf = 0; leaf < 5; leaf++) {
        const yaw = angle + leaf * 2.4, y = h * (.16 + leaf * .13);
        blade(x, z, y, h * .25, .07 + rng() * .035, yaw, .15 + rng() * .06, choose('shrub'));
      }
    }
  } else if (plant.kind === 'flowers') {
    for (let n = 0; n < 5; n++) {
      const angle = rng() * TAU, r = rng() * plant.radius * .68, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      const h = plant.height * (.7 + rng() * .3);
      stem(x, z, h, choose('grass'), .006);
      blade(x, z, h * .27, h * .35, .032, angle, .08, choose('grass'));
      const color = choose('flowers'), center = vertex(x, h, z, color, .88);
      for (let petal = 0; petal < 5; petal++) {
        const yaw = petal / 5 * TAU;
        const a = vertex(x + Math.cos(yaw - .4) * .032, h + .008, z + Math.sin(yaw - .4) * .032, color);
        const b = vertex(x + Math.cos(yaw + .4) * .032, h + .008, z + Math.sin(yaw + .4) * .032, color);
        batch.indices.push(center, a, b);
      }
    }
  } else {
    const reeds = plant.kind === 'reeds', count = reeds ? 11 : 13;
    for (let n = 0; n < count; n++) {
      const yaw = rng() * TAU, r = Math.sqrt(rng()) * plant.radius * .35;
      const x = Math.cos(yaw) * r, z = Math.sin(yaw) * r, h = plant.height * (.55 + rng() * .45);
      blade(x, z, 0, h, reeds ? .012 : .025 + rng() * .023, yaw,
        reeds ? .035 + rng() * .045 : .08 + rng() * .09, choose(reeds ? 'reeds' : 'grass'));
      if (reeds && n % 3 === 0) blade(x + Math.cos(yaw) * .05, z + Math.sin(yaw) * .05,
        h * .8, h * .14, .018, yaw + Math.PI / 2, .008, choose('seed'));
    }
  }
}

/**
 * Devuelve un Group con un Mesh por sector de 32 m. El distrito puede mover sus
 * hijos directamente a la ciudad para conservar el descarte por sector.
 * No es necesario actualizar matrices: solo avanza el uniforme compartido.
 */
export function buildParkVegetation(plan, { windTime = vegetationWind } = {}) {
  const group = new THREE.Group(), buckets = new Map();
  group.name = 'Pastos, arbustos bajos y juncos';
  group.userData.noMerge = true;
  for (const cluster of plan?.clusters ?? []) {
    if (!buckets.has(cluster.sector)) buckets.set(cluster.sector, { positions: [], colors: [], uvs: [], wind: [], indices: [] });
    addCluster(buckets.get(cluster.sector), cluster);
  }
  const material = buckets.size ? createMaterial(windTime) : null, meshes = [];
  let triangles = 0;
  for (const [key, batch] of buckets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.setAttribute('treeWind', new THREE.Float32BufferAttribute(batch.wind, 3));
    geometry.setIndex(batch.indices); geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.boundingBox.expandByScalar(PARK_VEGETATION.windBounds);
    geometry.boundingSphere.radius += PARK_VEGETATION.windBounds;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Vegetación baja · ${key}`;
    mesh.userData.noMerge = true; mesh.userData.vegetationSector = key;
    mesh.receiveShadow = true; mesh.castShadow = false;
    group.add(mesh); meshes.push(mesh); triangles += batch.indices.length / 3;
  }
  group.userData.metrics = { ...plan?.metrics, meshes: meshes.length, materials: material ? 1 : 0, triangles, textures: 0 };
  // Opcional para propietarios independientes. El distrito puede usar su
  // recorrido habitual; las referencias compartidas externas no se liberan.
  let disposed = false;
  group.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const mesh of meshes) mesh.geometry.dispose();
    material?.dispose();
  };
  return group;
}
