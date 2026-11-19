import * as THREE from 'three';
import { withVisualRandom } from './bogota/VisualRandom.js';

const CELL = .25;

export const RAIN_COVER_GLSL = /* glsl */ `
  uniform sampler2D uRainCoverMap;
  uniform vec4 uRainCoverRect;
  uniform float uRainCoverHeight;

  float rainCoverAt(vec2 world) {
    if (uRainCoverHeight <= 0.0) return -1000.0;
    vec2 uv = (world - uRainCoverRect.xy) * uRainCoverRect.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return -1000.0;
    float height = texture2D(uRainCoverMap, uv).r;
    return height > 0.0 ? height * uRainCoverHeight : -1000.0;
  }
`;

function rasterizeCover(data, grid, a, b, c) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const acx = c.x - a.x, acz = c.z - a.z;
  const area = abx * acz - abz * acx;
  if (Math.abs(area) < 1e-8) return; // Las paredes verticales no cortan la caída.

  const loX = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - grid.x) / CELL));
  const hiX = Math.min(grid.width - 1, Math.ceil((Math.max(a.x, b.x, c.x) - grid.x) / CELL) - 1);
  const loZ = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - grid.z) / CELL));
  const hiZ = Math.min(grid.depth - 1, Math.ceil((Math.max(a.z, b.z, c.z) - grid.z) / CELL) - 1);
  // En el borde curvo cuenta la celda entera: si solo se usa su centro, pasa agua por el canto.
  const halfCell = (CELL * .5 - 1e-6) / Math.abs(area);
  const padU = halfCell * (Math.abs(acx) + Math.abs(acz));
  const padV = halfCell * (Math.abs(abx) + Math.abs(abz));
  const padW = halfCell * (Math.abs(acx - abx) + Math.abs(acz - abz));
  const minY = Math.min(a.y, b.y, c.y), maxY = Math.max(a.y, b.y, c.y);
  for (let z = loZ; z <= hiZ; z++) {
    const dz = grid.z + (z + .5) * CELL - a.z;
    for (let x = loX; x <= hiX; x++) {
      const dx = grid.x + (x + .5) * CELL - a.x;
      const u = (dx * acz - dz * acx) / area, v = (abx * dz - abz * dx) / area;
      if (u < -padU || v < -padV || u + v > 1 + padW) continue;
      const y = THREE.MathUtils.clamp(a.y + (b.y - a.y) * u + (c.y - a.y) * v, minY, maxY);
      if (y <= 0) continue;
      const pixel = z * grid.width + x;
      data[pixel] = Math.max(data[pixel], Math.max(1, Math.round(y / grid.metersPerByte)));
    }
  }
}

/** Cuadrícula de las caras reales de cubierta, calculada antes de fusionar la ciudad. */
export function buildRainCover(...roots) {
  const surfaces = [];
  const bounds = new THREE.Box3(), local = new THREE.Box3();
  for (const root of roots) root.traverse(mesh => {
    if (!mesh.userData.rainCover || !mesh.geometry?.attributes.position) return;
    mesh.updateWorldMatrix(true, false);
    const { geometry } = mesh;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    bounds.union(local.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    surfaces.push(mesh);
  });
  if (!surfaces.length || bounds.isEmpty()) return null;

  const x = Math.floor(bounds.min.x / CELL) * CELL, z = Math.floor(bounds.min.z / CELL) * CELL;
  const width = Math.max(1, Math.ceil((bounds.max.x - x) / CELL));
  const depth = Math.max(1, Math.ceil((bounds.max.z - z) / CELL));
  const maxHeight = Math.max(1, Math.ceil(bounds.max.y));
  const metersPerByte = maxHeight / 255;
  const grid = { x, z, width, depth, metersPerByte };
  const data = new Uint8Array(width * depth);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const mesh of surfaces) {
    const { position } = mesh.geometry.attributes, { index } = mesh.geometry;
    const matrix = mesh.matrixWorld;
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
      rasterizeCover(data, grid, a, b, c);
    }
  }

  const texture = withVisualRandom(() => new THREE.DataTexture(data, width, depth, THREE.RedFormat));
  texture.name = 'Altura de las cubiertas contra lluvia';
  texture.needsUpdate = true;
  return {
    texture, maxHeight, metersPerByte,
    rect: new THREE.Vector4(x, z, 1 / (width * CELL), 1 / (depth * CELL)),
    heightAt(px, pz) {
      const ix = Math.floor((px - x) / CELL), iz = Math.floor((pz - z) / CELL);
      if (ix < 0 || ix >= width || iz < 0 || iz >= depth) return null;
      const byte = data[iz * width + ix];
      return byte ? byte * metersPerByte : null;
    },
    dispose() { texture.dispose(); }
  };
}
