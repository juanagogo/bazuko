// Prado y andén sin una textura por parque: una máscara de desgaste de un texel por metro, sacada del
// mapa de tiles, y el ruido que la cúpula ya tiene en memoria. Rompe la repetición cada 6 y 8 m.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { boxBlur, chainSunField, sunFieldUniforms } from './SunField.js';

/** Lo que se pisa o se transita: junto a esto el pasto se gasta. Contra una pared casi no. */
const TRODDEN = new Set(['road', 'busway', 'sidewalk', 'plaza', 'floor', 'dirt']);

/**
 * Máscara R8: 0 es pasto intacto y 1 tierra pisada. La cubre un borde difuso de unos 2,5 m a cada
 * lado de lo transitado; `spots` son redondeles {x, z, radius, amount} y `trails`, trochas
 * {from: [x, z], to: [x, z], width, amount}, ambos en metros de mundo.
 */
export function buildGroundWear(map, { spots = [], trails = [] } = {}) {
  const T = TILE_SIZE, w = map[0].length * T, d = map.length * T;
  const source = new Float32Array(w * d);
  for (let z = 0; z < d; z++) {
    const row = map[Math.floor(z / T)];
    for (let x = 0; x < w; x++) {
      const tile = row[Math.floor(x / T)];
      source[z * w + x] = tile === 'grass' ? 0 : TRODDEN.has(tile) ? 1 : .35;
    }
  }
  const wear = boxBlur(source, w, d, 2);
  // Un texel `i` cubre desde i − T/2: los tiles se centran en múltiplos de T.
  const paint = (x0, x1, z0, z1, value) => {
    for (let z = Math.max(0, Math.floor(z0 + T / 2)); z <= Math.min(d - 1, Math.ceil(z1 + T / 2)); z++) {
      for (let x = Math.max(0, Math.floor(x0 + T / 2)); x <= Math.min(w - 1, Math.ceil(x1 + T / 2)); x++) {
        const amount = value(x - T / 2 + .5, z - T / 2 + .5);
        if (amount > 0) wear[z * w + x] += amount;
      }
    }
  };
  for (const { x, z, radius, amount } of spots) {
    paint(x - radius, x + radius, z - radius, z + radius, (px, pz) => amount * (1 - Math.hypot(px - x, pz - z) / radius));
  }
  for (const { from: [ax, az], to: [bx, bz], width, amount } of trails) {
    const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz || 1;
    paint(Math.min(ax, bx) - width, Math.max(ax, bx) + width, Math.min(az, bz) - width, Math.max(az, bz) + width, (px, pz) => {
      const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / lengthSq, 0, 1);
      return amount * (1 - Math.hypot(px - ax - dx * t, pz - az - dz * t) / width);
    });
  }
  const data = new Uint8Array(w * d);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, wear[i]) * 255;
  const texture = new THREE.DataTexture(data, w, d, THREE.RedFormat);
  texture.name = 'Desgaste del prado';
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.userData = { width: w, depth: d };
  return texture;
}

const NOISE_DECLARATION = /* glsl */'uniform sampler2D uSunCloud;\n';

// Tres escalas del mismo ruido: manchas de una docena de metros, matas y grano bajo el pie.
const GRASS_FRAGMENT = /* glsl */`
{
  vec2 groundAt = vSunFieldPos.xz;
  float groundPatch = texture2D( uSunCloud, groundAt * .021 ).r;
  float groundClump = texture2D( uSunCloud, groundAt.yx * .025 + .37 ).g;
  float groundFine = texture2D( uSunCloud, groundAt * .156 + .11 ).g;
  // Verde hondo donde hay humedad y paja donde da más el sol: nunca un solo tono de tapete.
  diffuseColor.rgb *= mix( vec3( .66, .84, .6 ), vec3( 1.42, 1.2, .78 ), smoothstep( .28, .72, groundPatch * .55 + groundClump * .45 ) );
  // El ruido deshilacha el borde: la tierra entra a mordiscos, no en una franja recta.
  float groundTrod = texture2D( uGroundWear, ( groundAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uGroundWearScale ).r
    + smoothstep( .76, .9, groundPatch ) * .14 + ( groundClump - .5 ) * .46 + ( groundFine - .5 ) * .3;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.26, 1.08, .7 ), smoothstep( .2, .42, groundTrod ) );
  float groundGrit = texture2D( uSunCloud, groundAt * .61 + .5 ).g;
  vec3 groundEarth = vec3( .118, .09, .06 ) * ( .5 + 1. * groundGrit ) * ( .78 + .44 * groundFine );
  diffuseColor.rgb = mix( diffuseColor.rgb, groundEarth, smoothstep( .41, .54, groundTrod ) );
}
`;

// Hollín y lluvia de años: la misma losa no se repite igual cada seis metros.
const PAVING_FRAGMENT = /* glsl */`
{
  float pavingStain = texture2D( uSunCloud, vSunFieldPos.xz * .017 + .2 ).r;
  float pavingScuff = texture2D( uSunCloud, vSunFieldPos.xz.yx * .05 + .6 ).g;
  diffuseColor.rgb *= 1.07 - .2 * smoothstep( .3, .78, pavingStain ) - .11 * smoothstep( .42, .82, pavingScuff );
}
`;

function patchFragment(material, key, declarations, body, uniforms = {}) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, { uSunCloud: sunFieldUniforms.uSunCloud });
    shader.fragmentShader = NOISE_DECLARATION + declarations + shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>\n${body}`);
  };
  material.customProgramCacheKey = () => key;
  chainSunField(material);
}

/** Viste el pasto con la máscara. Solo sirve con mapa: el cuerpo lee su color para el grano de la tierra. */
export function dressGrass(material, wearTexture) {
  const { width, depth } = wearTexture.userData;
  patchFragment(material, 'prado-gastado', 'uniform sampler2D uGroundWear;\nuniform vec2 uGroundWearScale;\n', GRASS_FRAGMENT, {
    uGroundWear: { value: wearTexture }, uGroundWearScale: { value: new THREE.Vector2(1 / width, 1 / depth) },
  });
}

/** Los acabados de andén comparten un solo programa: la mancha no suma compilaciones por barrio. */
export function dressPaving(material) {
  patchFragment(material, 'anden-manchado', '', PAVING_FRAGMENT);
}
