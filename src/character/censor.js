// src/character/censor.js
// Censurado en mosaico pintado sobre la piel misma: los fragmentos de la zona elegida se agrupan en
// cuadros alineados a la pantalla y cada cuadro toma un tono de piel al azar. Sigue la silueta del
// cuerpo (no es un cartel encima) y lo que quede delante lo tapa normal. Va después del color final y
// antes del tone mapping, para que siga la exposición y la luz del sitio.
import * as THREE from 'three';

/** Un cuadro mide la sexta parte de lo que ocupa la cadera en pantalla, y nunca menos de 3 px. */
export const CENSOR_DIVISIONS = 6;
export const CENSOR_MIN_BLOCK = 3;
/** Segundos entre patrones: el mosaico no parpadea por encima de medio hercio. */
export const CENSOR_RESEED = 2;
/** Metros de cadera con los que se mide el tamaño en pantalla. */
export const CENSOR_SPAN = .3;

const UNIFORMS = 'uniform float uCensor;\nuniform float uCensorBlock;\nuniform float uCensorSeed;\nuniform vec2 uCensorUv;\n';
const MOSAIC = mask => `
  if (uCensor > .5 && ${mask}) {
    vec2 cell = floor(gl_FragCoord.xy / uCensorBlock);
    float h = fract(sin(dot(cell + uCensorSeed, vec2(12.9898, 78.233))) * 43758.5453);
    float dark = fract(sin(dot(cell + uCensorSeed * 1.7, vec2(39.3468, 11.135))) * 24634.6345);
    // Un solo tono de piel por cuadro: el del material, con su textura leída en un punto de la cadera.
    vec3 censorBase = diffuse;
#ifdef USE_MAP
    censorBase *= texture2D( map, uCensorUv ).rgb;
#endif
    // La luz del sitio sin la textura de la piel: de noche el mosaico no brilla como un parche.
    float light = clamp(dot(outgoingLight, vec3(.2126, .7152, .0722)) / max(dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)), 1e-3), 0., 4.);
    gl_FragColor.rgb = censorBase * light * (.5 + .55 * h) * (dark < .2 ? .6 : 1.);
  }`;

/**
 * Uniformes compartidos por todos los materiales censurados de una persona. `uv` es un punto de piel de
 * la cadera en la textura del cuerpo; sin textura el tono es el color del material.
 */
export function createCensorUniforms({ uv = null } = {}) {
  return {
    uCensor: { value: 0 },
    uCensorBlock: { value: 8 },
    uCensorSeed: { value: 0 },
    uCensorUv: { value: new THREE.Vector2(...(uv ?? [.5, .5])) }
  };
}

function chain(material, uniforms, key, extra, edit) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.() ?? '';
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms, extra);
    edit(shader);
  };
  material.customProgramCacheKey = () => `${previousKey}|censor:v1:${key}`;
  material.needsUpdate = true;
}

/**
 * Censura lo que cae en una caja del reposo normalizado (`vStreetRest`, de applyStreetMaterial):
 * `box.x` media anchura, `box.y` altura mínima y `box.z` altura máxima. Va después de applyStreetMaterial.
 */
export function censorByRestBox(material, uniforms, box) {
  chain(material, uniforms, 'rest', { uCensorBox: { value: box.clone() } }, shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORMS}uniform vec3 uCensorBox;\n`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>${MOSAIC('abs(vStreetRest.x) < uCensorBox.x && vStreetRest.y > uCensorBox.y && vStreetRest.y < uCensorBox.z')}`);
  });
}

/** Censura lo que quede por encima de `minY` en el espacio local de la malla. */
export function censorByLocalY(material, uniforms, minY) {
  chain(material, uniforms, 'local', { uCensorMinY: { value: minY } }, shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCensorY;\n')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCensorY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORMS}uniform float uCensorMinY;\nvarying float vCensorY;\n`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>${MOSAIC('vCensorY > uCensorMinY')}`);
  });
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** Píxeles de un cuadro para una cadera en `center` vista por `camera` en un lienzo de `viewportHeight`. */
export function censorBlockPixels(center, camera, viewportHeight, span = CENSOR_SPAN) {
  _a.copy(center).project(camera);
  _b.copy(center).setY(center.y + span).project(camera);
  const px = Math.abs(_b.y - _a.y) * .5 * viewportHeight;
  return Math.max(CENSOR_MIN_BLOCK, Math.round(px / CENSOR_DIVISIONS)) || CENSOR_MIN_BLOCK;
}

export const censorSeed = time => Math.floor(time / CENSOR_RESEED) * 3.7;

export function setCensor(uniforms, { on = false, block, seed } = {}) {
  uniforms.uCensor.value = on ? 1 : 0;
  if (block != null) uniforms.uCensorBlock.value = block;
  if (seed != null) uniforms.uCensorSeed.value = seed;
}
