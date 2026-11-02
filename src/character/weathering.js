// src/character/weathering.js
// addHairTone: el pelo toma el color elegido aunque su textura sea casi negra (las canas se ven).
// Usa la luminancia de la textura solo como detalle de los mechones. El resto del desgaste de piel y
// ropa está en streetMaterials.js.

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

/**
 * El pelo toma `material.color` como tono real y conserva el detalle de los mechones. `contrast` baja ese
 * detalle en las texturas con parches grandes, que en las canas se verían como camuflado.
 */
export function addHairTone(material, contrast = 1) {
  if (!material.map) return;
  const average = Math.max(0.005, textureLuminance(material.map));
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uHairAverage = { value: average };
    shader.uniforms.uHairContrast = { value: contrast };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHairAverage;\nuniform float uHairContrast;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.rgb = diffuse * mix(1.0, clamp(dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114)) / uHairAverage, 0.58, 1.35), uHairContrast);
#endif`);
  };
  const key = material.customProgramCacheKey?.() ?? '';
  material.customProgramCacheKey = () => `${key}|hair`;
  material.needsUpdate = true;
}
