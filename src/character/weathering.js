// src/character/weathering.js
// Desgaste del personaje realista sin texturas nuevas:
// - addGrime: manchas de mugre, tela desteñida y piel curtida según el nivel de desgaste.
// - addHairTone: el pelo toma el color elegido aunque su textura sea casi negra (las canas se ven).
//   Usa la luminancia de la textura solo como detalle de los mechones.

// fuerza por nivel (WEAR_LEVELS en look.js); la piel se ensucia menos que la ropa
const GRIME = [0, 0.6, 1];
const SKIN_FACTOR = 0.45;

const NOISE_GLSL = /* glsl */ `
uniform float uGrime;
uniform float uGrimeSeed;
float grimeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float grimeNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grimeHash(i), grimeHash(i + vec2(1.0, 0.0)), f.x),
             mix(grimeHash(i + vec2(0.0, 1.0)), grimeHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float grimeFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * grimeNoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

const GRIME_GLSL = /* glsl */ `
#ifdef USE_MAP
{
  vec2 gp = vMapUv * 3.5 + uGrimeSeed;
  float n = grimeFbm(gp);
  float stain = smoothstep(0.4, 0.72, n) * uGrime;
  float grain = grimeNoise(vMapUv * 90.0 + uGrimeSeed);
  vec3 dirt = vec3(0.13, 0.10, 0.07) * (0.7 + 0.6 * grain);
  // tela vieja: desteñida y opaca
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), uGrime * 0.5);
  // lo claro se pone amarillento y todo pierde brillo
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.68, 0.52), uGrime);
  // manchas de mugre
  diffuseColor.rgb = mix(diffuseColor.rgb, dirt, stain * 0.85);
}
#endif
`;

/** Ensucia un material con textura. `level` es el índice de WEAR_LEVELS; `skin` lo atenúa. */
export function addGrime(material, level, { skin = false, seed = Math.random() * 100 } = {}) {
  const amount = (GRIME[level] ?? 0) * (skin ? SKIN_FACTOR : 1);
  if (!amount || !material.map) return;
  material.roughness = Math.min(1, (material.roughness ?? 1) + amount * 0.15);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uGrime = { value: amount };
    shader.uniforms.uGrimeSeed = { value: seed };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${GRIME_GLSL}`);
  };
  const key = material.customProgramCacheKey?.() ?? '';
  material.customProgramCacheKey = () => `${key}|grime`;
  material.needsUpdate = true;
}

/** Luminancia lineal promedio de píxeles RGBA en sRGB, ignorando los transparentes. */
export function averageLinearLuminance(data) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    sum += 0.299 * lin(data[i] / 255) + 0.587 * lin(data[i + 1] / 255) + 0.114 * lin(data[i + 2] / 255);
    count++;
  }
  return count ? sum / count : 0;
}

const FALLBACK_LUMINANCE = 0.02;
const luminanceCache = new WeakMap();
function textureLuminance(texture) {
  const image = texture?.image;
  if (!image) return FALLBACK_LUMINANCE;
  if (luminanceCache.has(image)) return luminanceCache.get(image);
  let value = FALLBACK_LUMINANCE;
  try {
    const size = 32;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    value = averageLinearLuminance(ctx.getImageData(0, 0, size, size).data) || FALLBACK_LUMINANCE;
  } catch { /* sin canvas: se usa el valor típico de las texturas de pelo */ }
  luminanceCache.set(image, value);
  return value;
}

/** El pelo toma `material.color` como tono real y conserva el detalle de los mechones. */
export function addHairTone(material) {
  if (!material.map) return;
  const average = Math.max(0.005, textureLuminance(material.map));
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uHairAverage = { value: average };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHairAverage;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.rgb = diffuse * clamp(dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114)) / uHairAverage, 0.35, 1.6);
#endif`);
  };
  const key = material.customProgramCacheKey?.() ?? '';
  material.customProgramCacheKey = () => `${key}|hair`;
  material.needsUpdate = true;
}
