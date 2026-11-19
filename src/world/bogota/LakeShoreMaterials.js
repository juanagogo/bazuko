import * as THREE from 'three';
import { grassWearUniforms, GRASS_FINISH_GLSL } from './GrassFinish.js';
import { PAVING_STAIN_GLSL } from './PavingFinish.js';
import { LAKE_WAVE_FIELD } from './LakeWaveField.js';
import { chainSunField, sunFieldUniforms } from './SunFieldShader.js';

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

function noise(x, z, period) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const wrap = value => period ? (value % period + period) % period : value;
  const fx = smooth(x - ix, 0, 1), fz = smooth(z - iz, 0, 1);
  const a = wrap(ix), b = wrap(ix + 1), c = wrap(iz), d = wrap(iz + 1);
  return mix(mix(hash(a, c), hash(b, c), fx), mix(hash(a, d), hash(b, d), fx), fz);
}

/** Colores apagados de suelo frío, grava gris y vegetación de clima altoandino. */
export function createLakeShorePalette({ groundMap = null, plazaMap = null, groundTint, plazaTint } = {}) {
  return {
    grass: new THREE.Color(groundTint ?? (groundMap ? '#c2c7ac' : '#53683c')),
    plaza: new THREE.Color(plazaTint ?? (plazaMap ? '#d2cfc1' : '#b3afa0')),
    soil: new THREE.Color('#625744'), wetSoil: new THREE.Color('#544b3c'),
    bed: new THREE.Color('#394039'), gravel: new THREE.Color('#817761')
  };
}

/** Solo color/pesos: nunca cambia alturas, profundidad ni recorridos. */
export function sampleLakeShore({ x, z, depth, bankDistance, shoreDistance = bankDistance, edgeDistance = Infinity }, palette, target) {
  const patch = noise(x * .29, z * .29), broad = noise(x * .085 + 17, z * .085 - 9);
  // Orilla de barro: el pasto llega al agua en unos tramos y en otros deja un
  // playón de lodo; la grava queda en parches sueltos y no en un anillo parejo.
  const variation = (patch - .5) * .5 + (broad - .5) * 1.7;
  const grass = smooth(bankDistance + variation, .3, 1.5);
  const gravel = smooth(bankDistance, -.12, .4) * (1 - smooth(bankDistance, 1.2, 1.9)) *
    (.08 + patch * patch * .5) * (1 - grass);
  const wet = (1 - smooth(shoreDistance, .08, .98 + patch * .3)) * (1 - smooth(depth, .4, 2.4));
  target.color.copy(palette.soil).lerp(palette.wetSoil, wet).lerp(palette.bed, smooth(depth, .2, 4));
  target.color.lerp(palette.gravel, gravel).multiplyScalar(.9 + .17 * broad + .06 * patch);
  // Los límites del rectángulo coinciden con los materiales vecinos: no aparece
  // una costura verde/arena. La variación de césped se concentra junto a la ribera.
  const grassVariation = 1 + (broad - .5) * .16 * grass * smooth(edgeDistance, 0, 3);
  target.soil?.copy(target.color).multiplyScalar((1 - grass) * grassVariation);
  target.color.lerp(palette.grass, grass).multiplyScalar(grassVariation);
  target.grass = grass; target.gravel = gravel; target.wet = wet;
  return target;
}

/** RGBA lineal: limo, máscara de grava, tono de la piedra y relieve. */
export function createLakeShoreDetail(size = 128) {
  const data = new Uint8Array(size * size * 4), cells = 12;
  const wrap = x => (x % cells + cells) % cells;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const sx = x / size * cells, sz = z / size * cells;
    const cx = Math.floor(sx), cz = Math.floor(sz);
    let pebble = 0, height = 0, tone = .55;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gz = cz + oz, wx = wrap(gx), wz = wrap(gz), h = hash(wx, wz);
      const dx = sx - (gx + .20 + h * .60), dz = sz - (gz + .20 + hash(wx + 71, wz) * .60);
      const radius = .14 + hash(wx, wz + 37) * .31;
      const stretch = 1.1 + hash(wx + 37, wz + 17) * .64;
      const xAxis = dx + dz * (h - .5) * 1.8;
      const progress = Math.hypot(xAxis * stretch, dz) / radius;
      const shape = 1 - smooth(progress, .74, 1.03);
      if (shape <= pebble) continue;
      pebble = shape;
      height = shape * (1 - progress ** 2 * .70);
      tone = .22 + hash(wx + 103, wz + 63) * .72;
    }
    const grain = hash(x + 103, z + 211), i = (z * size + x) * 4;
    const coarse = noise(sx / 3, sz / 3, 4), fine = noise(sx + 7, sz + 3, cells);
    const silt = coarse * .75 + fine * .17 + grain * .08;
    data[i] = Math.round(silt * 255);
    data[i + 1] = Math.round(pebble * 255);
    data[i + 2] = Math.round(tone * 255);
    data[i + 3] = Math.round(32 + height * 195 + fine * 17 + grain * 11);
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
export function createLakeShoreMaterial({ groundMap = null, groundBumpMap = null, plazaMaterial = null,
  plazaMap = plazaMaterial?.map ?? null, plazaBumpMap = plazaMaterial?.bumpMap ?? null,
  groundScale = 8, plazaScale = 6, plazaTint, wearTexture = null, waterUniforms = null } = {}) {
  const detail = createLakeShoreDetail();
  const material = new THREE.MeshStandardMaterial({
    name: 'Ribera · hierba, grava y lodo húmedo', vertexColors: true,
    color: 0xffffff, roughness: .92, metalness: 0,
    map: groundMap, bumpMap: detail, bumpScale: .08
  });
  const uniforms = {
    lakeShoreDetail: { value: detail }, lakeSurfaceScale: { value: new THREE.Vector2(groundScale, plazaScale) },
    lakePlazaTint: { value: plazaMaterial?.color ?? new THREE.Color(plazaTint ?? (plazaMap ? '#d2cfc1' : '#b3afa0')) },
    lakePlazaRoughness: { get value() { return plazaMaterial?.roughness ?? .84; } },
    lakePlazaBumpScale: { value: plazaMaterial?.bumpScale ?? .09 }
  };
  if (plazaMap) uniforms.lakePlazaMap = { value: plazaMap };
  if (groundBumpMap) uniforms.lakeGroundBump = { value: groundBumpMap };
  if (plazaBumpMap) uniforms.lakePlazaBump = { value: plazaBumpMap };
  if (wearTexture) Object.assign(uniforms, grassWearUniforms(wearTexture));
  if (waterUniforms) {
    for (const key of ['lakeTime', 'lakeRain', 'lakeSunDirection', 'lakeSunAmount']) uniforms[key] = waterUniforms[key];
  }
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    if (wearTexture) shader.uniforms.uSunCloud = sunFieldUniforms.uSunCloud;
    shader.vertexShader = `attribute float lakePlaza;
attribute float lakeShoreMeters;
${waterUniforms ? 'attribute float lakeDepth; varying vec2 vLakeBed;' : ''}
attribute vec3 lakeLayers;
attribute vec3 lakeSoil;
varying float vLakePlaza;
varying float vLakeShoreMeters;
varying vec3 vLakeLayers;
varying vec3 vLakeSoil;
varying vec2 vLakeXZ;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
vLakePlaza = lakePlaza;
vLakeShoreMeters = lakeShoreMeters;
vLakeLayers = lakeLayers;
vLakeSoil = lakeSoil;
vLakeXZ = position.xz;
${waterUniforms ? 'vLakeBed = vec2(lakeDepth, (modelMatrix * vec4(position, 1.0)).y);' : ''}
`);
    shader.fragmentShader = `uniform sampler2D lakeShoreDetail;
uniform vec2 lakeSurfaceScale;
uniform vec3 lakePlazaTint;
uniform float lakePlazaRoughness;
uniform float lakePlazaBumpScale;
${waterUniforms ? `varying vec2 vLakeBed;
uniform float lakeTime;
uniform float lakeRain;
uniform float lakeSunAmount;
uniform vec3 lakeSunDirection;
${LAKE_WAVE_FIELD}
` : ''}
${plazaMap ? 'uniform sampler2D lakePlazaMap;' : ''}
${groundBumpMap ? 'uniform sampler2D lakeGroundBump;' : ''}
${plazaBumpMap ? 'uniform sampler2D lakePlazaBump;' : ''}
${wearTexture ? `uniform sampler2D uSunCloud;\n${GRASS_FINISH_GLSL}\n${PAVING_STAIN_GLSL}` : ''}
varying float vLakePlaza;
varying float vLakeShoreMeters;
varying vec3 vLakeLayers;
varying vec3 vLakeSoil;
varying vec2 vLakeXZ;
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
vec2 lakeBedXZ = vLakeXZ;
${waterUniforms ? `
float bedDepth = max(vLakeBed.x, 0.0);
float bedPixel = max(length(dFdx(vLakeXZ)), length(dFdy(vLakeXZ)));
vec3 bedToEye = normalize(cameraPosition - vec3(vLakeXZ.x, vLakeBed.y, vLakeXZ.y));
// Solo se curva el tramo sumergido del rayo. Fuera del alcance visual del lecho
// basta su color de fondo; el borde seco comparte sus UV exactas con el parque.
if (bedDepth > 0.001 && cameraPosition.y > vLakeBed.y + bedDepth) {
  vec2 straightPath = bedToEye.xz / max(bedToEye.y, 0.10);
  vec2 entry = vLakeXZ + straightPath * bedDepth;
  vec2 wave = lakeWindWaves(entry, lakeTime, vLakeShoreMeters, bedPixel, lakeRain).xy;
  vec3 refracted = refract(-bedToEye, normalize(vec3(-wave.x, 1.0, -wave.y)), 0.75019);
  vec2 offset = (straightPath + refracted.xz / max(-refracted.y, 0.35)) * bedDepth;
  float reach = min(2.6, max(vLakeShoreMeters, 0.0) * 0.70);
  lakeBedXZ += offset * min(1.0, reach / max(length(offset), 0.001));
}
` : ''}
vec2 lakeSoilUV = lakeBedXZ / 2.75 + 0.09 * sin(lakeBedXZ.yx * vec2(0.68, 0.51));
vec4 lakeDetail = texture2D(lakeShoreDetail, lakeSoilUV);
float lakePavingMix = smoothstep(${LAKE_PAVING_EDGE.start}, ${LAKE_PAVING_EDGE.end}, vLakePlaza + (lakeDetail.r - 0.65) * ${LAKE_PAVING_EDGE.irregularity});
float lakeGravel = clamp(vLakeLayers.y, 0.0, 1.0);
float lakeWetRibbon = smoothstep(-0.55, -0.11, vLakeShoreMeters + (lakeDetail.r - 0.5) * 0.69);
float lakeMud = vLakeLayers.z * lakeWetRibbon * (1.0 - vLakeLayers.x) * (1.0 - lakePavingMix);
float lakeSilt = smoothstep(0.20, 0.78, lakeDetail.r);
float lakeGravelPockets = smoothstep(0.34, 0.69, lakeDetail.r + lakeGravel * 0.49);
float lakeStones = lakeDetail.g * lakeGravelPockets * (1.0 - smoothstep(1.45, 3.1, abs(vLakeShoreMeters)));
vec3 lakeSiltAlbedo = mix(vec3(0.65, 0.72, 0.71), vec3(1.35, 1.23, 1.04), lakeSilt);
vec3 lakeStoneAlbedo = mix(vec3(0.68, 0.79, 0.91), vec3(2.4, 2.05, 1.60), lakeDetail.b);
vec3 lakeSoilAlbedo = mix(lakeSiltAlbedo, lakeStoneAlbedo, lakeStones);
lakeSoilAlbedo *= mix(vec3(1.0), vec3(0.88, 0.88, 0.82), lakeMud * (0.84 - lakeStones * 0.59));
vec3 lakeGrassAlbedo = ${groundMap ? 'texture2D(map, vLakeXZ / lakeSurfaceScale.x).rgb' : 'vec3(1.0)'};
vec3 lakePavingAlbedo = ${plazaMap ? 'texture2D(lakePlazaMap, vLakeXZ / lakeSurfaceScale.y).rgb' : 'vec3(1.0)'};
${wearTexture && plazaMaterial ? 'if (lakePavingMix > 0.0) lakePavingAlbedo *= pavingTone(pavingStains(vLakeXZ));' : ''}
float lakeMicroHeight = lakeDetail.r * 0.014 + lakeDetail.a * lakeGravelPockets * 0.033;
float lakePavingRoughness = lakePlazaRoughness;
${groundBumpMap ? 'lakeMicroHeight = mix(lakeMicroHeight, texture2D(lakeGroundBump, vLakeXZ / lakeSurfaceScale.x).r * 0.055, vLakeLayers.x);' : ''}
${plazaBumpMap ? `vec2 lakePavingSurface = texture2D(lakePlazaBump, vLakeXZ / lakeSurfaceScale.y).rg;
lakeMicroHeight = mix(lakeMicroHeight, lakePavingSurface.r * lakePlazaBumpScale, lakePavingMix);
${plazaMaterial ? 'lakePavingRoughness *= lakePavingSurface.g;' : ''}` : ''}
`);
    // Cada tinte ponderado recibe su propio mapa antes de sumar los acabados.
    // El grano claro del sustrato ya no ilumina el tinte del césped en la transición.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
vec3 lakeTerrainColor = vLakeSoil * lakeSoilAlbedo + max(vColor.rgb - vLakeSoil, vec3(0.0)) * lakeGrassAlbedo;
${waterUniforms ? `
// La transparencia del agua ya atenúa todos los canales. Aquí solo hace falta
// la pérdida adicional de rojo y azul que tiñe la grava sumergida.
lakeTerrainColor *= exp(-bedDepth * vec3(0.45, 0.0, 0.24));
` : ''}
diffuseColor.rgb *= lakeTerrainColor;
${wearTexture ? `
if ( vLakeLayers.x > .6 && lakePavingMix < 1. ) {
  float lakeGrassFinish = smoothstep( .6, .99, vLakeLayers.x );
  diffuseColor.rgb = mix( diffuseColor.rgb, grassFinish( diffuseColor.rgb, vLakeXZ ), lakeGrassFinish );
}
` : ''}
diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * lakePlazaTint * lakePavingAlbedo, lakePavingMix);
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
#include <roughnessmap_fragment>
float lakeDryRoughness = mix(0.89, 0.98, vLakeLayers.x);
roughnessFactor = mix(clamp(lakeDryRoughness - lakeMud * mix(0.12, 0.20, lakeSilt) - lakeStones * 0.08, 0.62, 1.0), lakePavingRoughness, lakePavingMix);
`);
    // El lodo húmedo conserva pequeños brillos entre los granos, sin el reflejo ancho del cielo sobre toda la orilla.
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
#include <aomap_fragment>
reflectedLight.indirectSpecular *= 1.0 - lakeMud * mix(0.56, 0.76, lakeDetail.r);
reflectedLight.directSpecular *= 1.0 - lakeMud * 0.40;
`);
    // Reutiliza el perturbador PBR con derivadas de las muestras ya leídas:
    // no añade las tres lecturas extra del bump estándar ni mueve los vértices.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
#ifdef USE_BUMPMAP
normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(lakeMicroHeight), dFdy(lakeMicroHeight)), faceDirection);
#endif
`);
    if (waterUniforms) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
#include <lights_fragment_end>
if (bedDepth > 0.018 && bedDepth < 2.4 && lakeSunAmount > 0.001) {
  // Las pendientes concentran el haz en un punto que depende de la altura del
  // sol. Modula solo la luz directa, ya recortada por el tablero y las copas.
  vec3 sunBelow = refract(-lakeSunDirection, vec3(0.0, 1.0, 0.0), 0.75019);
  vec2 sunEntry = lakeBedXZ - sunBelow.xz * bedDepth / max(-sunBelow.y, 0.65);
  float curvature = lakeWindWaves(sunEntry, lakeTime, vLakeShoreMeters, bedPixel, lakeRain).z;
  float focus = 1.0 / clamp(1.0 + 0.48 * bedDepth * curvature, 0.54, 1.7);
  reflectedLight.directDiffuse *= mix(1.0, focus, lakeSunAmount * (1.0 - smoothstep(0.48, 2.4, bedDepth)));
}
`);
  };
  material.customProgramCacheKey = () => `lake-shore-pbr-v9:${+!!groundMap}${+!!plazaMap}${+!!groundBumpMap}${+!!plazaBumpMap}${+!!wearTexture}${+!!plazaMaterial}${+!!waterUniforms}`;
  let disposed = false;
  material.addEventListener('dispose', () => {
    if (!disposed) { disposed = true; detail.dispose(); }
  });
  return chainSunField(material);
}
