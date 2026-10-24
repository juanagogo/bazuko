// src/character/hatFit.js
// El pelo no atraviesa el sombrero: se mide el borde inferior del sombrero en cada dirección
// alrededor de la cabeza y el pelo descarta lo que queda por encima de ese borde.
// Todo se calcula en la pose de reposo, así el recorte sigue a la cabeza durante la animación.

export const HAT_SECTORS = 16;
// el corte queda apenas por encima del borde para que el pelo salga por debajo sin dejar hueco
const EDGE_MARGIN = 0.004;

/** Borde inferior del sombrero por sector angular (0 = adelante, +Z). `positions` es xyz plano. */
export function hatEdgeProfile(positions, sectors = HAT_SECTORS) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    maxY = Math.max(maxY, positions[i + 1]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const edge = new Array(sectors).fill(Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const s = sectorOf(positions[i] - cx, positions[i + 2] - cz, sectors);
    edge[s] = Math.min(edge[s], positions[i + 1]);
  }
  // sin vértices en un sector: no se recorta por ese lado
  return { center: [cx, cz], edge: edge.map((y) => (Number.isFinite(y) ? y : maxY)) };
}

function sectorOf(dx, dz, sectors) {
  const turn = (Math.atan2(dx, dz) / (Math.PI * 2) + 1) % 1;
  return Math.min(sectors - 1, Math.floor(turn * sectors));
}

/** Altura del borde en la dirección (dx, dz) desde el centro, interpolada entre sectores. */
export function edgeHeightAt(profile, dx, dz) {
  const n = profile.edge.length;
  const f = ((Math.atan2(dx, dz) / (Math.PI * 2) + 1) % 1) * n - 0.5;
  const i = Math.floor(f), t = f - i;
  const at = (k) => profile.edge[((k % n) + n) % n];
  return at(i) * (1 - t) + at(i + 1) * t;
}

/** El material del pelo descarta los fragmentos que quedan dentro del sombrero. */
export function addHatClip(material, profile) {
  if (!profile) return;
  const n = profile.edge.length;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uHatCenter = { value: profile.center };
    shader.uniforms.uHatEdge = { value: profile.edge.map((y) => y + EDGE_MARGIN) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHatRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHatRest;
uniform vec2 uHatCenter;
uniform float uHatEdge[${n}];
float hatEdgeAt(int k) { return uHatEdge[(k + ${n}) % ${n}]; }`)
      .replace('void main() {', `void main() {
  {
    vec2 d = vHatRest.xz - uHatCenter;
    float f = fract(atan(d.x, d.y) / 6.28318530718 + 1.0) * ${n}.0 - 0.5;
    int i = int(floor(f));
    if (vHatRest.y > mix(hatEdgeAt(i), hatEdgeAt(i + 1), f - floor(f))) discard;
  }`);
  };
  const key = material.customProgramCacheKey?.() ?? '';
  material.customProgramCacheKey = () => `${key}|hat${n}`;
  material.needsUpdate = true;
}
