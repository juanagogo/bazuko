import * as THREE from 'three';

const smooth = THREE.MathUtils.smoothstep;
const mix = THREE.MathUtils.lerp;
// La cuadrícula mide un metro: esta banda deja un borde de 10–14 cm,
// según la orientación del triángulo, sin difuminar toda una losa.
export const LAKE_PAVING_EDGE = Object.freeze({ start: .43, end: .57, irregularity: .035 });
export const lakePavingBlend = (mask, grain = .65) => smooth(
  mask + (grain - .65) * LAKE_PAVING_EDGE.irregularity, LAKE_PAVING_EDGE.start, LAKE_PAVING_EDGE.end
);
const hash = (x, z) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ 17011987;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix, 0, 1), fz = smooth(z - iz, 0, 1);
  return mix(mix(hash(ix, iz), hash(ix + 1, iz), fx), mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx), fz);
}

/** Colores apagados de suelo frío, grava gris y vegetación de clima altoandino. */
export function createLakeShorePalette({ groundMap = null, plazaMap = null, groundTint, plazaTint } = {}) {
  return {
    grass: new THREE.Color(groundTint ?? (groundMap ? '#c2c7ac' : '#53683c')),
    plaza: new THREE.Color(plazaTint ?? (plazaMap ? '#d2cfc1' : '#b3afa0')),
    soil: new THREE.Color('#7f7059'), wetSoil: new THREE.Color('#4c5042'),
    bed: new THREE.Color('#43574c'), gravel: new THREE.Color('#93948a')
  };
}

/** Solo color/pesos: nunca cambia alturas, profundidad ni recorridos. */
export function sampleLakeShore({ x, z, depth, bankDistance, edgeDistance = Infinity }, palette, target) {
  const patch = noise(x * .29, z * .29), broad = noise(x * .085 + 17, z * .085 - 9);
  const variation = (patch - .5) * .32;
  const grass = smooth(bankDistance + variation, .42, 1.85);
  const gravel = smooth(bankDistance, -.12, .4) * (1 - smooth(bankDistance, 1.2, 1.9)) *
    (.35 + patch * .65) * (1 - grass);
  const wet = (1 - smooth(bankDistance, .08, 1.12)) * (1 - smooth(depth, .4, 2.4));
  target.color.copy(palette.soil).lerp(palette.wetSoil, wet).lerp(palette.bed, smooth(depth, .2, 4));
  target.color.lerp(palette.gravel, gravel).multiplyScalar(.9 + .17 * broad + .06 * patch);
  target.color.lerp(palette.grass, grass);
  // Los límites del rectángulo coinciden con los materiales vecinos: no aparece
  // una costura verde/arena. La variación de césped se concentra junto a la ribera.
  const grassVariation = 1 + (broad - .5) * .16 * grass * smooth(edgeDistance, 0, 3);
  target.color.multiplyScalar(grassVariation);
  target.grass = grass; target.gravel = gravel; target.wet = wet;
  return target;
}

/** RGBA lineal: grano, guijarros, rugosidad y relieve. Repite sin Canvas ni assets. */
export function createLakeShoreDetail(size = 128) {
  const data = new Uint8Array(size * size * 4), cells = 16;
  const wrap = x => (x % cells + cells) % cells;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const sx = x / size * cells, sz = z / size * cells;
    const cx = Math.floor(sx), cz = Math.floor(sz);
    let pebble = 0;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gz = cz + oz, h = hash(wrap(gx), wrap(gz));
      const px = gx + .22 + h * .56, pz = gz + .22 + hash(wrap(gx) + 71, wrap(gz)) * .56;
      const radius = .18 + hash(wrap(gx), wrap(gz) + 37) * .22;
      pebble = Math.max(pebble, 1 - smooth(Math.hypot((sx - px) * (1 + h * .45), sz - pz), radius * .45, radius));
    }
    const grain = hash(x + 103, z + 211), i = (z * size + x) * 4;
    data[i] = Math.round(120 + grain * 95);
    data[i + 1] = Math.round(pebble * 225 + grain * 25);
    data[i + 2] = Math.round(195 + grain * 55 - pebble * 30);
    data[i + 3] = Math.round(80 + pebble * 145 + grain * 22);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Ribera · grano y grava compartidos';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 2; texture.needsUpdate = true;
  return texture;
}

/** Un material/una pasada PBR. Las texturas del parque son referencias prestadas. */
export function createLakeShoreMaterial({ groundMap = null, groundBumpMap = null, plazaMap = null,
  plazaBumpMap = null, groundScale = 8, plazaScale = 6, plazaTint } = {}) {
  const detail = createLakeShoreDetail();
  const material = new THREE.MeshStandardMaterial({
    name: 'Ribera · hierba, grava y lodo húmedo', vertexColors: true,
    color: 0xffffff, roughness: .92, metalness: 0,
    map: groundMap, bumpMap: detail, bumpScale: .08
  });
  const uniforms = {
    lakeShoreDetail: { value: detail }, lakeSurfaceScale: { value: new THREE.Vector2(groundScale, plazaScale) },
    lakePlazaTint: { value: new THREE.Color(plazaTint ?? (plazaMap ? '#d2cfc1' : '#b3afa0')) }
  };
  if (plazaMap) uniforms.lakePlazaMap = { value: plazaMap };
  if (groundBumpMap) uniforms.lakeGroundBump = { value: groundBumpMap };
  if (plazaBumpMap) uniforms.lakePlazaBump = { value: plazaBumpMap };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float lakePlaza;
attribute vec3 lakeLayers;
varying float vLakePlaza;
varying vec3 vLakeLayers;
varying vec2 vLakeXZ;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
vLakePlaza = lakePlaza;
vLakeLayers = lakeLayers;
vLakeXZ = position.xz;
`);
    shader.fragmentShader = `uniform sampler2D lakeShoreDetail;
uniform vec2 lakeSurfaceScale;
uniform vec3 lakePlazaTint;
${plazaMap ? 'uniform sampler2D lakePlazaMap;' : ''}
${groundBumpMap ? 'uniform sampler2D lakeGroundBump;' : ''}
${plazaBumpMap ? 'uniform sampler2D lakePlazaBump;' : ''}
varying float vLakePlaza;
varying vec3 vLakeLayers;
varying vec2 vLakeXZ;
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
vec4 lakeDetail = texture2D(lakeShoreDetail, vLakeXZ / 1.6);
float lakePavingMix = smoothstep(${LAKE_PAVING_EDGE.start}, ${LAKE_PAVING_EDGE.end}, vLakePlaza + (lakeDetail.r - 0.65) * ${LAKE_PAVING_EDGE.irregularity});
float lakeGravel = clamp(vLakeLayers.y, 0.0, 1.0);
vec3 lakeAlbedo = vec3(mix(0.72 + lakeDetail.r * 0.5, 0.72 + lakeDetail.g * 0.5, lakeGravel));
vec3 lakePavingAlbedo = ${plazaMap ? 'texture2D(lakePlazaMap, vLakeXZ / lakeSurfaceScale.y).rgb' : 'vec3(1.0)'};
float lakeMicroHeight = mix(lakeDetail.r * 0.035, lakeDetail.a * 0.08, lakeGravel);
${groundMap ? 'lakeAlbedo = mix(lakeAlbedo, texture2D(map, vLakeXZ / lakeSurfaceScale.x).rgb, vLakeLayers.x);' : ''}
${groundBumpMap ? 'lakeMicroHeight = mix(lakeMicroHeight, texture2D(lakeGroundBump, vLakeXZ / lakeSurfaceScale.x).r * 0.055, vLakeLayers.x);' : ''}
${plazaBumpMap ? 'lakeMicroHeight = mix(lakeMicroHeight, texture2D(lakePlazaBump, vLakeXZ / lakeSurfaceScale.y).r * 0.09, lakePavingMix);' : ''}
diffuseColor.rgb *= lakeAlbedo;
`);
    // El tinte de piedra nunca se interpola dentro del césped. Una única máscara
    // decide color, relieve y rugosidad después de aplicar el color del terreno.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * lakePlazaTint * lakePavingAlbedo, lakePavingMix);
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
#include <roughnessmap_fragment>
float lakeDryRoughness = mix(0.89, 0.98, vLakeLayers.x);
lakeDryRoughness = mix(lakeDryRoughness, 0.84, lakePavingMix);
roughnessFactor = clamp(lakeDryRoughness - vLakeLayers.z * (1.0 - lakePavingMix) * 0.3 + (lakeDetail.b - 0.8) * 0.08, 0.52, 1.0);
`);
    // Reutiliza el perturbador PBR con derivadas de las muestras ya leídas:
    // no añade las tres lecturas extra del bump estándar ni mueve los vértices.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
#ifdef USE_BUMPMAP
normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(lakeMicroHeight), dFdy(lakeMicroHeight)), faceDirection);
#endif
`);
  };
  material.customProgramCacheKey = () => `lake-shore-pbr-v3:${+!!groundMap}${+!!plazaMap}${+!!groundBumpMap}${+!!plazaBumpMap}`;
  let disposed = false;
  material.addEventListener('dispose', () => {
    if (!disposed) { disposed = true; detail.dispose(); }
  });
  return material;
}
