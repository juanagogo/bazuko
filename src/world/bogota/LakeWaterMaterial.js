import * as THREE from 'three';
import { RAIN_COVER_GLSL } from '../RainCover.js';
import { LAKE_WAVE_FIELD } from './LakeWaveField.js';
import { chainSunField } from './SunFieldShader.js';

const LAKE_LAMP_SLOTS = 6;
const WAVE_HEIGHTS = [.016, .010, .008];
const RAIN_SWELL = 1.3;
export const LAKE_MAX_SWELL = WAVE_HEIGHTS.reduce((height, wave) => height + wave, 0) * RAIN_SWELL;
// El entorno fijo de la escena deja una losa clara sobre el agua, sobre todo de
// noche: se atenúa en el shader (la intensidad del material no cuenta cuando el
// entorno es el de la escena) y el reflejo lo pone el color del horizonte.
const ENV_DAY = .45, ENV_NIGHT = .06;
// Zona donde un farol de la calle alcanza a reflejarse en el lago.
const LAMP_AREA = Object.freeze({ x0: -10, x1: 160, z0: 196, z1: 344, lakeX: 75, lakeZ: 262 });

// Three sortea un identificador por cada textura, geometría, material y malla.
// Lo nuevo del lago nace con un azar propio: si gastara el de la ciudad, con una
// semilla fija correría todo lo que se sortea después al armarla.
let lakeIdState = 0x1a6e5eed;
const lakeIdRandom = () => {
  lakeIdState = lakeIdState + 0x6d2b79f5 | 0;
  let t = Math.imul(lakeIdState ^ lakeIdState >>> 15, 1 | lakeIdState);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
export function withLakeRandom(create) {
  const cityRandom = Math.random;
  Math.random = lakeIdRandom;
  try { return create(); } finally { Math.random = cityRandom; }
}

const hash = (x, z, seed) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** Ruido de valor que repite cada `period` celdas: la textura empalma sin costura. */
function tileNoise(x, z, period, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const wrap = v => (v % period + period) % period;
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(wrap(ix), wrap(iz), seed), b = hash(wrap(ix + 1), wrap(iz), seed);
  const c = hash(wrap(ix), wrap(iz + 1), seed), d = hash(wrap(ix + 1), wrap(iz + 1), seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * RGBA lineal hecha en código con azar propio: pendiente del rizado (RG),
 * altura del rizo (B) y manchas anchas de lama y de racha de viento (A).
 */
export function createLakeRippleTexture(size = 128) {
  const height = new Float32Array(size * size), data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const u = x / size, v = z / size;
    height[z * size + x] = tileNoise(u * 8, v * 8, 8, 0x51a7e3) * .5 +
      tileNoise(u * 16, v * 16, 16, 0x2f6b19) * .32 + tileNoise(u * 32, v * 32, 32, 0x77c4d1) * .18;
  }
  const at = (x, z) => height[((z + size) % size) * size + (x + size) % size];
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const i = (z * size + x) * 4, u = x / size, v = z / size;
    const dx = (at(x + 1, z) - at(x - 1, z)) * 9, dz = (at(x, z + 1) - at(x, z - 1)) * 9;
    const patch = tileNoise(u * 4, v * 4, 4, 0x1d93b7) * .62 + tileNoise(u * 8, v * 8, 8, 0x64e2a5) * .38;
    data[i] = Math.round(THREE.MathUtils.clamp(.5 + dx * .5, 0, 1) * 255);
    data[i + 1] = Math.round(THREE.MathUtils.clamp(.5 + dz * .5, 0, 1) * 255);
    data[i + 2] = Math.round(height[z * size + x] * 255);
    data[i + 3] = Math.round(patch * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Lago · rizado, lama y rachas';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 2; texture.needsUpdate = true;
  return texture;
}

const luminance = color => color.r * .2126 + color.g * .7152 + color.b * .0722;

/** Agua turbia de parque con rizado, espuma y reflejos del entorno. */
export function createLakeWaterMaterial() {
  const ripples = withLakeRandom(() => createLakeRippleTexture());
  const uniforms = {
    lakeTime: { value: 0 },
    lakeRain: { value: 0 },
    lakeShallow: { value: new THREE.Color('#727862') },
    lakeDeep: { value: new THREE.Color('#293c34') },
    lakeScumColor: { value: new THREE.Color('#66704b') },
    lakeFoamColor: { value: new THREE.Color('#a5a18e') },
    lakeSky: { value: new THREE.Color('#8fa3b4') },
    lakeSkyTop: { value: new THREE.Color('#7297b9') },
    lakeCloudLight: { value: new THREE.Color('#bfc4c7') },
    lakeCloudShadow: { value: new THREE.Color('#8b9aab') },
    lakeCloudDrift: { value: new THREE.Vector2() },
    lakeCloudCover: { value: 0 },
    lakeCloudNoise: { value: ripples },
    lakeBankTint: { value: new THREE.Color('#4b5a3a') },
    lakeSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    lakeSunColor: { value: new THREE.Color('#f4d6a9') },
    lakeSunGlow: { value: 0 },
    lakeSunAmount: { value: 0 },
    lakeNight: { value: 0 },
    lakeEnvGain: { value: ENV_DAY },
    lakeRipples: { value: ripples },
    lakeLamps: { value: Array.from({ length: LAKE_LAMP_SLOTS }, () => new THREE.Vector4(0, 6, 0, 0)) },
    lakeLampRadiance: { value: Array.from({ length: LAKE_LAMP_SLOTS }, () => new THREE.Color(0)) },
    lakeLampBeam: { value: Array.from({ length: LAKE_LAMP_SLOTS }, () => new THREE.Vector2()) }
  };
  const bridge = {
    lakeBridgeTexture: { value: null },
    lakeBridgeDepth: { value: null },
    lakeBridgeProjection: { value: new THREE.Matrix4() },
    lakeBridgeInverse: { value: new THREE.Matrix4() },
    lakeBridgeTexel: { value: new THREE.Vector2(1, 1) },
    lakeBridgeVisible: { value: 0 }
  };
  const coverUniforms = {
    uRainCoverMap: { value: null },
    uRainCoverRect: { value: new THREE.Vector4() },
    uRainCoverHeight: { value: 0 }
  };
  const material = new THREE.MeshStandardMaterial({
    name: 'Agua del lago · turbia, con rizado y reflejo', color: 0xffffff,
    roughness: .2, metalness: 0, transparent: true, opacity: 1,
    depthWrite: false, side: THREE.DoubleSide
  });
  material.forceSinglePass = true;
  material.userData.uniforms = uniforms;
  material.userData.setBridgeReflection = reflection => {
    bridge.lakeBridgeVisible.value = reflection ? 1 : 0;
    if (reflection) {
      bridge.lakeBridgeTexture.value = reflection.target.texture;
      bridge.lakeBridgeDepth.value = reflection.target.depthTexture;
      bridge.lakeBridgeProjection.value.copy(reflection.projection);
      bridge.lakeBridgeInverse.value.copy(reflection.inverseViewProjection);
      bridge.lakeBridgeTexel.value.set(1 / reflection.target.width, 1 / reflection.target.height);
    }
  };
  material.userData.setRain = intensity => {
    uniforms.lakeRain.value = Number.isFinite(intensity) ? THREE.MathUtils.clamp(intensity, 0, 1) : 0;
  };
  material.userData.setRainCover = cover => {
    coverUniforms.uRainCoverMap.value = cover?.texture ?? null;
    coverUniforms.uRainCoverHeight.value = cover?.maxHeight ?? 0;
    if (cover) coverUniforms.uRainCoverRect.value.copy(cover.rect);
  };
  material.userData.update = dt => {
    if (Number.isFinite(dt) && dt > 0) uniforms.lakeTime.value += dt;
  };
  // Los mismos colores y el mismo estrato de nube que ya pinta la cúpula.
  let lampScans = 0, nextScan = 0;
  let lampSources = [], streetMap = null;
  const lampPosition = new THREE.Vector3();
  const findLamps = scene => {
    const found = [];
    const add = (x, y, z, light, fixture) => {
      if (x < LAMP_AREA.x0 || x > LAMP_AREA.x1 || z < LAMP_AREA.z0 || z > LAMP_AREA.z1 || y < 2 || y > 12) return;
      if (found.some(lamp => Math.hypot(lamp.x - x, lamp.z - z) < 9)) return;
      found.push({ x, y, z, light, fixture, distance: Math.hypot((x - LAMP_AREA.lakeX) / 2, z - LAMP_AREA.lakeZ) });
    };
    if (streetMap) {
      for (const source of streetMap.sources) if (source.shape === 0 || source.shape === -1 && source.y > 2.5) {
        add(source.x, source.y, source.z, null, source);
      }
    } else {
      scene.traverse(object => {
        if (!object.isPointLight || object.userData.localLightProxy) return;
        object.getWorldPosition(lampPosition);
        add(lampPosition.x, lampPosition.y, lampPosition.z, object, null);
      });
    }
    found.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
    lampSources = found.slice(0, LAKE_LAMP_SLOTS);
    uniforms.lakeLamps.value.forEach((slot, i) => {
      const lamp = found[i];
      if (lamp) slot.set(lamp.x, lamp.y, lamp.z, 1); else slot.w = 0;
      uniforms.lakeLampBeam.value[i].set(lamp?.fixture?.range ?? 0, lamp?.fixture?.shape === 0 ? 1 : 0);
    });
    return found.length;
  };
  material.userData.syncScene = (scene, renderer) => {
    const fog = scene?.fog?.color;
    if (fog?.isColor) uniforms.lakeSky.value.copy(fog);
    const sky = scene?.children?.find(object => object.userData.isSkyDome)?.material?.uniforms;
    uniforms.lakeSkyTop.value.copy(sky?.topColor.value ?? uniforms.lakeSky.value);
    uniforms.lakeCloudCover.value = sky?.cloudCover.value ?? 0;
    uniforms.lakeCloudNoise.value = sky?.cloudNoise.value ?? ripples;
    if (sky) {
      uniforms.lakeCloudLight.value.copy(sky.cloudLight.value);
      uniforms.lakeCloudShadow.value.copy(sky.cloudShadow.value);
      uniforms.lakeCloudDrift.value.copy(sky.cloudOffset.value);
      if (sky.sunDirection) uniforms.lakeSunDirection.value.copy(sky.sunDirection.value);
      if (sky.sunGlowColor) uniforms.lakeSunColor.value.copy(sky.sunGlowColor.value);
    }
    uniforms.lakeSunGlow.value = sky?.sunGlowIntensity?.value ?? 0;
    uniforms.lakeSunAmount.value = (sky?.sunDisc?.value ?? 0) *
      (1 - THREE.MathUtils.smoothstep(uniforms.lakeCloudCover.value, .32, .82)) *
      THREE.MathUtils.smoothstep(uniforms.lakeSunDirection.value.y, .06, .32);
    const exposure = renderer?.toneMappingExposure;
    const dark = 1 - THREE.MathUtils.smoothstep(luminance(uniforms.lakeSky.value), .07, .2);
    uniforms.lakeNight.value = sky?.nightFactor?.value ??
      dark * (Number.isFinite(exposure) ? THREE.MathUtils.smoothstep(exposure, 1.06, 1.2) : 1);
    uniforms.lakeEnvGain.value = THREE.MathUtils.lerp(ENV_DAY, ENV_NIGHT, dark);
    // Los faroles se buscan unas pocas veces mientras la ciudad termina de armarse.
    const localMap = scene?.userData?.streetLightMap;
    const mapped = localMap?.sources && Number.isFinite(localMap.windowLevel) ? localMap : null;
    if (streetMap !== mapped) { streetMap = mapped; lampScans = 0; nextScan = 0; }
    if (scene?.traverse && lampScans < 4 && uniforms.lakeTime.value >= nextScan) {
      lampScans++; nextScan = uniforms.lakeTime.value + 4;
      if (findLamps(scene) >= LAKE_LAMP_SLOTS) lampScans = 4;
    }
    for (let i = 0; i < lampSources.length; i++) {
      const { light, fixture } = lampSources[i], radiance = uniforms.lakeLampRadiance.value[i];
      if (fixture) radiance.fromArray(fixture.radiance).multiplyScalar(streetMap.windowLevel);
      else radiance.copy(light.color).multiplyScalar(light.visible ? light.intensity : 0);
    }
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, bridge, coverUniforms);
    shader.vertexShader = /* glsl */ `attribute float lakeDepth;
attribute float lakeShoreMeters;
uniform float lakeTime;
uniform float lakeRain;
uniform mat4 lakeBridgeProjection;
varying float vLakeDepth;
varying float vLakeShoreMeters;
varying vec3 vLakeWorld;
varying vec4 vLakeBridgeProjected;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
#include <beginnormal_vertex>
// Ondas de 4–9 m. Los rizos menores viven en la normal del fragmento, no en la retícula de 1 m.
vec3 lakeWaveX = vec3(0.76, -0.39, 1.15);
vec3 lakeWaveZ = vec3(0.29, 0.65, -0.70);
vec3 lakePhases = position.x * lakeWaveX + position.z * lakeWaveZ - lakeTime * vec3(1.05, 0.74, 1.63);
vec3 lakeHeight = vec3(${WAVE_HEIGHTS.join(', ')}) * smoothstep(0.04, 0.65, lakeDepth) * mix(1.0, ${RAIN_SWELL}, lakeRain);
vec3 lakeWaveSlope = cos(lakePhases) * lakeHeight;
objectNormal = normalize(vec3(-dot(lakeWaveSlope, lakeWaveX), 1.0, -dot(lakeWaveSlope, lakeWaveZ)));
`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
vLakeDepth = lakeDepth;
vLakeShoreMeters = lakeShoreMeters;
vLakeBridgeProjected = lakeBridgeProjection * modelMatrix * vec4(position, 1.0);
transformed.y += dot(sin(lakePhases), lakeHeight);
vLakeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`);
    shader.fragmentShader = /* glsl */ `uniform vec3 lakeShallow;
uniform vec3 lakeDeep;
uniform vec3 lakeScumColor;
uniform vec3 lakeFoamColor;
uniform vec3 lakeSky;
uniform vec3 lakeSkyTop;
uniform vec3 lakeCloudLight;
uniform vec3 lakeCloudShadow;
uniform vec2 lakeCloudDrift;
uniform float lakeCloudCover;
uniform sampler2D lakeCloudNoise;
uniform vec3 lakeBankTint;
uniform vec3 lakeSunDirection;
uniform vec3 lakeSunColor;
uniform float lakeSunGlow;
uniform float lakeNight;
uniform float lakeEnvGain;
uniform float lakeTime;
uniform float lakeRain;
uniform sampler2D lakeRipples;
uniform sampler2D lakeBridgeTexture;
uniform sampler2D lakeBridgeDepth;
uniform mat4 lakeBridgeProjection;
uniform mat4 lakeBridgeInverse;
uniform vec2 lakeBridgeTexel;
uniform float lakeBridgeVisible;
uniform vec4 lakeLamps[${LAKE_LAMP_SLOTS}];
uniform vec3 lakeLampRadiance[${LAKE_LAMP_SLOTS}];
uniform vec2 lakeLampBeam[${LAKE_LAMP_SLOTS}];
varying float vLakeDepth;
varying float vLakeShoreMeters;
varying vec3 vLakeWorld;
varying vec4 vLakeBridgeProjected;
${RAIN_COVER_GLSL}
${LAKE_WAVE_FIELD}

vec3 lakeDropHash(vec2 cell) {
  vec3 p = fract(cell.xyx * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xxy + p.yzz) * p.zyx);
}

vec3 lakeRainRing(vec2 point, float rain, float pixelMeters) {
  // Impactos fijos en el mundo, repartidos en el tiempo y en celdas de 58 cm.
  vec2 grid = point / 0.58;
  vec3 drop = lakeDropHash(floor(grid));
  float cycle = lakeTime * (0.92 + drop.z * 0.55) + drop.x;
  float age = fract(cycle);
  float occurrence = smoothstep(drop.y - 0.09, drop.y + 0.12, rain);
  vec2 delta = fract(grid) - (0.31 + 0.38 * lakeDropHash(floor(grid) + floor(cycle) * 19.73).xy);
  float radius = length(delta);
  float ring = (radius - age * 0.27) * 0.58;
  float envelope = (1.0 - smoothstep(0.012, 0.038 + pixelMeters, abs(ring))) *
    smoothstep(0.0, 0.095, age) * (1.0 - age) * occurrence;
  vec2 slope = delta / max(radius, 0.02) * sin(ring * 188.0) * envelope;
  return vec3(slope * rain * 0.24, envelope * rain);
}

vec3 lakeReflectedSky(vec3 ray) {
  float y = max(ray.y, 0.0);
  vec3 sky = mix(lakeSky, lakeSkyTop, pow(y + 0.04, 0.78));
  float sunDot = max(dot(ray, lakeSunDirection), 0.0);
  sky += lakeSunColor * (pow(sunDot, 5.0) * 0.6 + pow(sunDot, 48.0) * 0.5) * lakeSunGlow;
  if (lakeCloudCover > 0.01) {
    // El estrato bajo usa la misma altura, ruido y deriva que el cielo de Bogotá.
    vec2 cloudPoint = vLakeWorld.xz + ray.xz * ((550.0 - vLakeWorld.y) / max(y, 0.065));
    vec2 cloudUV = cloudPoint / 3450.0 + vec2(0.32, 0.69) + lakeCloudDrift * 0.0625;
    vec2 field = texture2D(lakeCloudNoise, cloudUV).rg;
    float threshold = mix(0.796, 0.35, lakeCloudCover);
    float cloud = smoothstep(threshold - 0.04, threshold + 0.10, mix(field.r, field.g, 0.28));
    vec3 cloudColor = mix(lakeCloudShadow, lakeCloudLight, 0.52 - lakeRain * 0.29 + field.g * 0.19);
    sky = mix(sky, cloudColor, cloud * smoothstep(0.065, 0.27, y) * (0.82 - lakeNight * 0.35));
  }
  float bank = 1.0 - smoothstep(-0.10, 0.055, ray.y);
  return mix(sky, sky * lakeBankTint * 1.8, bank * 0.55);
}
` + shader.fragmentShader;
    // Dos escalas de rizo y una de manchas. El grano fino cede cuando ocupa menos de un píxel.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
#include <color_fragment>
vec2 lakeXZ = vLakeWorld.xz;
float lakePixel = max(length(dFdx(lakeXZ)), length(dFdy(lakeXZ)));
float lakeDetail = 1.0 - smoothstep(0.045, 0.22, lakePixel);
float lakeDepthPixel = fwidth(vLakeDepth);
vec2 windXZ = vec2(dot(lakeXZ, lakeWind), dot(lakeXZ, lakeCrosswind));
vec4 lakeRippleA = texture2D(lakeRipples, windXZ * vec2(0.34, 0.14) + lakeTime * vec2(-0.064, 0.01));
vec4 lakeRippleB = texture2D(lakeRipples, lakeXZ * vec2(0.49, 0.65) + lakeTime * vec2(0.036, -0.078));
vec4 lakePatch = texture2D(lakeRipples, windXZ * vec2(0.034, 0.022) + lakeTime * vec2(-0.0048, 0.0014));
float lakeEdgeFade = clamp(lakeDepthPixel + mix(0.007, 0.018, lakeRippleA.b), 0.010, 0.056);
float lakeWaterline = smoothstep(0.0, lakeEdgeFade, vLakeDepth);
float lakeGust = mix(0.48, 1.0, smoothstep(0.31, 0.68, lakePatch.b));
vec2 lakeSlope = lakeWindWaves(lakeXZ, lakeTime, vLakeShoreMeters, lakePixel, lakeRain).xy;
lakeSlope += (lakeWind * (lakeRippleA.r - 0.5) * 0.24 + lakeCrosswind * (lakeRippleA.g - 0.5) * 0.13 +
  (lakeRippleB.rg - 0.5) * 0.15 * lakeDetail) * lakeGust;

float lakeScum = smoothstep(0.51, 0.76, lakePatch.a) * smoothstep(0.20, 0.90, vLakeDepth);
float lakeFilm = lakeScum * smoothstep(0.45, 0.66, lakeRippleA.b * 0.68 + lakeRippleB.b * 0.32);
float lakeShoreBand = 1.0 - smoothstep(0.06, 0.61, vLakeShoreMeters);
float lakeShorePhase = vLakeShoreMeters * 13.0 + lakeTime * 2.25 + (lakePatch.b - 0.5) * 8.0 + lakeRippleA.b * 3.4;
float lakeCrest = smoothstep(0.55, 0.97, sin(lakeShorePhase));
float lakeFoamPatches = mix(lakePatch.a, lakeRippleA.b, 0.68) + (lakeRippleB.b - 0.5) * 0.13;
float lakeFoam = lakeShoreBand * lakeCrest * lakeWaterline * smoothstep(0.57, 0.74, lakeFoamPatches);
lakeSlope *= mix(0.32, 1.0 + lakeRain * 0.28, smoothstep(0.035, 0.47, vLakeDepth));

float lakeDropLight = 0.0;
if (lakeRain > 0.01 && lakeDetail > 0.01 && rainCoverAt(lakeXZ) < vLakeWorld.y) {
  vec3 drops = lakeRainRing(lakeXZ, lakeRain, lakePixel) * lakeDetail;
  lakeSlope += drops.xy;
  lakeDropLight = drops.z;
}
`);
    // El color del agua depende del trayecto bajo la superficie. El reflejo sigue el ángulo de la cámara.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
#include <normal_fragment_maps>
normal = normalize(normal - mat3(viewMatrix) * vec3(lakeSlope.x, 0.0, lakeSlope.y) * faceDirection);
float lakeSlopeFootprint = max(length(dFdx(lakeSlope)), length(dFdy(lakeSlope)));
roughnessFactor = clamp(0.144 + 0.095 * lakeGust + sqrt(min(lakeSlopeFootprint, 0.15)) * 0.25 +
  lakeRain * 0.07 + lakeFoam * 0.16, 0.15, 0.49);
vec3 lakeViewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
float lakeFacing = clamp(dot(normal, lakeViewDir), 0.0, 1.0);
float lakeCalm = (1.0 - lakeFoam * 0.62) * (1.0 - lakeScum * 0.42);
// Fresnel dieléctrico sin polarizar, con índice 1.333. Desde abajo también
// aparece la reflexión total al salir del cono de Snell.
float lakeEta = gl_FrontFacing ? 0.75019 : 1.333;
float lakeTransmittedCos = sqrt(max(0.0, 1.0 - lakeEta * lakeEta * (1.0 - lakeFacing * lakeFacing)));
float lakeRs = (lakeEta * lakeFacing - lakeTransmittedCos) / max(lakeEta * lakeFacing + lakeTransmittedCos, 0.0001);
float lakeRp = (lakeFacing - lakeEta * lakeTransmittedCos) / max(lakeFacing + lakeEta * lakeTransmittedCos, 0.0001);
float lakeFresnel = 0.5 * (lakeRs * lakeRs + lakeRp * lakeRp) * lakeCalm;
float lakeOpticalDepth = gl_FrontFacing ? max(vLakeDepth, 0.0) / max(lakeTransmittedCos, 0.64) : length(vViewPosition);
float lakeDepthBlend = 1.0 - exp(-lakeOpticalDepth * 0.84);
vec3 lakeTint = mix(lakeShallow, lakeDeep, lakeDepthBlend);
lakeTint = mix(lakeTint, lakeScumColor, lakeScum * 0.15 + lakeFilm * 0.34);
lakeTint = mix(lakeTint, lakeFoamColor, lakeFoam * 0.45);
float lakeTurbidity = mix(0.67, 0.93, lakePatch.a) + 0.14 * lakeRain;
float lakeThrough = exp(-lakeOpticalDepth * lakeTurbidity) * (1.0 - lakeFoam * 0.74);
float lakeVolume = (1.0 - lakeFresnel) * (1.0 - lakeThrough);
float lakeCoverage = max(0.0001, lakeFresnel + lakeVolume);
// La mezcla alfa ya multiplica el fragmento. Cada término entra con su fracción
// relativa, para que el destello no desaparezca dos veces en agua transparente.
diffuseColor.rgb *= lakeTint * (lakeVolume / lakeCoverage) * (1.0 + lakeDropLight * 0.1);
diffuseColor.a *= lakeWaterline * lakeCoverage;

vec3 lakeReflectDir = inverseTransformDirection(reflect(-lakeViewDir, normal), viewMatrix);
vec3 lakeReflected = gl_FrontFacing ? lakeReflectedSky(lakeReflectDir) : lakeDeep * (0.43 - 0.32 * lakeNight);
float lakeBridgeMask = 0.0;
if (lakeBridgeVisible > 0.5 && gl_FrontFacing && vLakeBridgeProjected.w > 0.0) {
  vec2 flatNdc = vLakeBridgeProjected.xy / vLakeBridgeProjected.w;
  vec2 flatUV = flatNdc * 0.5 + 0.5;
  // La profundidad de la cámara oblicua da la longitud del tramo agua–objeto.
  // En el pie del pilar vale cero; el mismo rizo sí desvía el cerro del fondo.
  float sceneDepth = texture2D(lakeBridgeDepth, clamp(flatUV, 0.0, 1.0)).x;
  vec4 sceneHit = lakeBridgeInverse * vec4(flatNdc, sceneDepth * 2.0 - 1.0, 1.0);
  float travel = 220.0;
  if (sceneDepth < 0.99998 && abs(sceneHit.w) > 0.00001) travel = min(travel, distance(sceneHit.xyz / sceneHit.w, vLakeWorld));
  vec4 bentHit = lakeBridgeProjection * vec4(vLakeWorld + lakeReflectDir * travel, 1.0);
  vec2 reflectedUV = flatUV;
  if (bentHit.w > 0.02) reflectedUV += clamp(bentHit.xy / bentHit.w * 0.5 + 0.5 - flatUV, -0.12, 0.12);
  vec2 targetMargin = min(reflectedUV, 1.0 - reflectedUV);
  // El cono de las pequeñas facetas se abre con la distancia al objeto. En la
  // línea de contacto la huella se recoge hasta el filtro de un único texel.
  float cone = travel / (travel + max(length(vViewPosition), 1.0));
  vec2 blur = lakeBridgeTexel * 0.58 + cone * (0.0018 + 0.010 * roughnessFactor) * vec2(0.74, 1.55);
  vec2 obliqueBlur = vec2(blur.x, -blur.y) * 0.68;
  vec4 reflectedObjects = 0.28 * texture2D(lakeBridgeTexture, clamp(reflectedUV, 0.0, 1.0)) +
    0.18 * (texture2D(lakeBridgeTexture, clamp(reflectedUV - blur, 0.0, 1.0)) +
    texture2D(lakeBridgeTexture, clamp(reflectedUV + blur, 0.0, 1.0)) +
    texture2D(lakeBridgeTexture, clamp(reflectedUV - obliqueBlur, 0.0, 1.0)) +
    texture2D(lakeBridgeTexture, clamp(reflectedUV + obliqueBlur, 0.0, 1.0)));
  float inTarget = smoothstep(0.0, 0.027, min(targetMargin.x, targetMargin.y));
  lakeBridgeMask = reflectedObjects.a * inTarget;
  lakeReflected = mix(lakeReflected, reflectedObjects.rgb / max(reflectedObjects.a, 0.01), lakeBridgeMask);
}
totalEmissiveRadiance += lakeReflected * (lakeFresnel / lakeCoverage);
if (lakeNight > 0.01 && gl_FrontFacing) {
  vec3 lakeGlints = vec3(0.0);
  vec3 worldEye = inverseTransformDirection(lakeViewDir, viewMatrix);
  vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
  for (int i = 0; i < ${LAKE_LAMP_SLOTS}; i++) {
    vec3 lakeToLamp = lakeLamps[i].xyz - vLakeWorld;
    float lampRange = max(length(lakeToLamp), 0.25);
    vec3 halfRay = normalize(lakeToLamp / lampRange + worldEye);
    vec2 miss = halfRay.xz / max(halfRay.y, 0.03) - worldNormal.xz / max(worldNormal.y, 0.24);
    // Distribución de pendientes sin resolver; un farol más lejano ocupa menos
    // ángulo sólido. La energía y el color salen de la luminaria encendida.
    vec2 width = vec2(0.077, 0.047) * (1.0 + lakeRain * 0.43) + 0.19 / lampRange;
    vec2 errorSlope = vec2(dot(miss, lakeWind), dot(miss, lakeCrosswind)) / width;
    float density = exp(-0.5 * dot(errorSlope, errorSlope)) / (6.28318 * width.x * width.y);
    float beam = mix(1.0, smoothstep(-0.12, 0.58, lakeToLamp.y / lampRange), lakeLampBeam[i].y);
    // El campo de la calle ya ilumina las facetas cercanas. Al salir de su radio
    // se recupera exactamente la fracción que su caída suave dejó de aportar.
    float localRatio = min(lampRange / max(lakeLampBeam[i].x, 0.01), 1.0);
    float localCut = 1.0 - pow(localRatio, 4.0);
    lakeGlints += lakeLampRadiance[i] * lakeLamps[i].w * beam * (1.0 - localCut * localCut) *
      density / (lampRange * lampRange * max(4.0 * lakeFacing, 0.27));
  }
  totalEmissiveRadiance += lakeGlints * (lakeFresnel / lakeCoverage);
}
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
#include <lights_physical_fragment>
material.specularColor = vec3(0.02037);
material.specularColorBlended = material.specularColor;
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
#include <lights_fragment_end>
reflectedLight.directSpecular *= lakeCalm / lakeCoverage;
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', `
#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
radiance *= lakeEnvGain * (1.0 - 0.58 * lakeBridgeMask);
#endif
`);
  };
  material.customProgramCacheKey = () => 'lake-water-optics-v8';
  let disposed = false;
  material.addEventListener('dispose', () => {
    if (!disposed) { disposed = true; ripples.dispose(); }
  });
  return chainSunField(material);
}
