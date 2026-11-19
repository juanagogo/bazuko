// Calzada con edad: una máscara de un texel por metro, sacada del mapa de tiles, y el ruido que la cúpula ya
// tiene en memoria. Cada tramo de cuadra tiene su tono, cada carril sus dos huellas y la cuneta su mugre; la
// troncal pasa a losas de concreto. No suma mallas ni pedidos de dibujo: todo va en el material de la calzada.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { chainSunField, sunFieldUniforms } from './SunField.js';

const PAVED = new Set(['road', 'busway']);
/** Más ancho que esto en los dos sentidos ya no es una calle: es un cruce o una explanada. */
const WIDEST_STREET = 9;
/** Metros que caben en un canal de 8 bits: distancia al centro del carril y al sardinel. */
const REACH = 4;
/** Metros en que las huellas se desvanecen al llegar al cruce, y metros antes del cruce en que se frena y gotea aceite. */
const FADE = 3, APPROACH = 24;
/** Largo de la losa de la troncal y ancho al que se busca partirla. */
const SLAB_LENGTH = 4.5, SLAB_WIDTH = 4;
/**
 * Cuánto oscurece la huella, en lo más gastado: el asfalto viejo, el recién pavimentado (negativo: lo aclara) y la losa.
 * Se lee como desgaste; de noche la marca sobre todo el brillo pulido bajo el farol.
 */
export const TRACK_SHADE = Object.freeze({ old: .12, fresh: -.04, slab: .14 });
/**
 * La calzada de noche, con todas sus intensidades juntas. `poolTint` es la fuerza del charco de luz del farol;
 * `poolGrain`, entre cuánto lo mueve el árido del asfalto y `poolGrainGain` cuánto lo exagera; `poolStain`, `poolPatch`,
 * `poolTrack` y `poolOil`, lo que le quitan las manchas del asfalto, la mancha grande, la huella y el aceite. De noche y
 * en seco la calzada no baja de `dryRoughness` (menos `dryPolish` en la huella) y devuelve `dryEnvironment` del entorno.
 * De noche y mojada, el agregado queda en `wetRoughness` y el surco de la huella en `wetTrackRoughness`, y el grano los
 * mueve `wetGrain` de punta a punta. De noche el entorno se lee con rugosidad `environmentRoughness` como mínimo.
 */
export const NIGHT_ROAD = Object.freeze({
  poolTint: .24, poolGrain: [.45, 1.35], poolGrainGain: 2.5, poolStain: .7, poolPatch: .16, poolTrack: .22, poolOil: .25,
  dryRoughness: .9, dryPolish: .04, dryEnvironment: .14,
  wetRoughness: .45, wetTrackRoughness: .25, wetGrain: .3,
  environmentRoughness: .62,
});

// Three sortea un identificador por cada textura. La ciudad se arma con el azar del juego sembrado (pruebas y
// mediciones), y la máscara no puede correr lo que se sortea después: nace con un azar propio.
const ownRandom = (() => {
  let a = 0x5A17C0DE;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
})();
function withOwnRandom(create) {
  const games = Math.random;
  Math.random = ownRandom;
  try { return create(); } finally { Math.random = games; }
}

const hash = (a, b, c) => {
  let h = Math.imul(a + 1, 0x9E3779B1) ^ Math.imul(b + 7, 0x85EBCA6B) ^ Math.imul(c + 13, 0xC2B2AE35);
  h = Math.imul(h ^ h >>> 15, 0x2C1B3C6D);
  h = Math.imul(h ^ h >>> 12, 0x297A2D39);
  return ((h ^ h >>> 15) >>> 0) / 4294967296;
};

/**
 * Lee el mapa de tiles como calles. Por tile de calzada o troncal: `along` (1 corre en z, 2 corre en x, 3 cruce o
 * explanada), el tramo a lo ancho (`from`, `count`, en tiles) y el tramo de cuadra entre cruces (`start`, `end`).
 */
function readStreets(map) {
  const cols = map[0].length, rows = map.length, size = cols * rows;
  const x0 = new Int16Array(size), x1 = new Int16Array(size), z0 = new Int16Array(size), z1 = new Int16Array(size);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols;) {
    let end = x;
    while (end + 1 < cols && map[z][end + 1] === map[z][x]) end++;
    for (let i = x; i <= end; i++) { x0[z * cols + i] = x; x1[z * cols + i] = end; }
    x = end + 1;
  }
  for (let x = 0; x < cols; x++) for (let z = 0; z < rows;) {
    let end = z;
    while (end + 1 < rows && map[end + 1][x] === map[z][x]) end++;
    for (let i = z; i <= end; i++) { z0[i * cols + x] = z; z1[i * cols + x] = end; }
    z = end + 1;
  }
  const along = new Uint8Array(size), from = new Int16Array(size), count = new Int16Array(size);
  const start = new Int16Array(size), end = new Int16Array(size);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    if (!PAVED.has(map[z][x])) continue;
    const i = z * cols + x, wide = x1[i] - x0[i] + 1, deep = z1[i] - z0[i] + 1;
    // La curva de la troncal hacia el portal tampoco: casi tan ancha como larga, sus huellas saldrían torcidas.
    if (Math.max(wide, deep) < 2 * Math.min(wide, deep) || Math.min(wide, deep) > WIDEST_STREET) { along[i] = 3; from[i] = x0[i]; start[i] = z0[i]; continue; }
    along[i] = wide < deep ? 1 : 2;
    from[i] = wide < deep ? x0[i] : z0[i];
    count[i] = Math.min(wide, deep);
  }
  // El tramo de cuadra: tiles seguidos de la misma calle, de cruce a cruce.
  const same = (i, j) => along[i] === along[j] && from[i] === from[j] && count[i] === count[j];
  for (let x = 0; x < cols; x++) for (let z = 0; z < rows;) {
    const i = z * cols + x;
    let last = z;
    if (along[i] === 1) while (last + 1 < rows && same(i, (last + 1) * cols + x)) last++;
    if (along[i] === 1) for (let k = z; k <= last; k++) { start[k * cols + x] = z; end[k * cols + x] = last; }
    // Cada cruce es su propio retazo: lo nombra la esquina donde empieza.
    if (along[i] === 3) while (last + 1 < rows && along[(last + 1) * cols + x] === 3) last++;
    if (along[i] === 3) for (let k = z; k <= last; k++) start[k * cols + x] = z;
    z = last + 1;
  }
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols;) {
    const i = z * cols + x;
    let last = x;
    if (along[i] === 2) while (last + 1 < cols && same(i, z * cols + last + 1)) last++;
    if (along[i] === 2) for (let k = x; k <= last; k++) { start[z * cols + k] = x; end[z * cols + k] = last; }
    if (along[i] === 3) while (last + 1 < cols && along[z * cols + last + 1] === 3) last++;
    if (along[i] === 3) for (let k = x; k <= last; k++) from[z * cols + k] = x;
    x = last + 1;
  }
  return { cols, rows, along, from, count, start, end };
}

/**
 * Máscara RGBA8 de un texel por metro. R: metros al centro del carril (÷ 4); G: edad del tramo de cuadra (0 recién
 * pavimentado, 1 viejo); B: metros al sardinel (÷ 4); A: metros al cruce a lo largo de la calle (÷ 24; 0 en el cruce).
 * Fuera de la calzada queda neutra: sin huellas, edad media y lejos del sardinel.
 */
export function buildAsphaltMask(map) {
  const T = TILE_SIZE, streets = readStreets(map), { cols, rows, along, from, count, start, end } = streets;
  const w = cols * T, d = rows * T, data = new Uint8Array(w * d * 4), known = new Uint8Array(w * d);
  const busways = new Map();
  for (let z = 0; z < d; z++) {
    const tz = Math.floor(z / T), pz = z - T / 2 + .5;
    for (let x = 0; x < w; x++) {
      const tx = Math.floor(x / T), tile = tz * cols + tx, at = (z * w + x) * 4, px = x - T / 2 + .5;
      data[at] = 255; data[at + 1] = 128; data[at + 2] = 255; data[at + 3] = 0;
      if (!along[tile]) continue;
      known[z * w + x] = 1;
      if (map[tz][tx] === 'busway' && along[tile] === 1) busways.set(from[tile] * 64 + count[tile], (busways.get(from[tile] * 64 + count[tile]) ?? 0) + 1);
      data[at + 1] = Math.round(hash(along[tile], from[tile], start[tile]) * 255);
      // Sardinel: lo más cerca que no es calzada ni troncal, hasta dos tiles a la redonda.
      let curb = REACH;
      for (let nz = Math.max(0, tz - 2); nz <= Math.min(rows - 1, tz + 2); nz++) {
        for (let nx = Math.max(0, tx - 2); nx <= Math.min(cols - 1, tx + 2); nx++) {
          if (PAVED.has(map[nz][nx])) continue;
          const dx = Math.max(Math.abs(px - nx * T) - T / 2, 0), dz = Math.max(Math.abs(pz - nz * T) - T / 2, 0);
          curb = Math.min(curb, Math.hypot(dx, dz));
        }
      }
      data[at + 2] = Math.round(curb / REACH * 255);
      if (along[tile] === 3) continue;
      const across = along[tile] === 1 ? px : pz, run = along[tile] === 1 ? pz : px;
      const width = count[tile] * T, centre = (from[tile] + (count[tile] - 1) / 2) * T;
      // Dos carriles por calzada, como las rutas del tráfico; una calle de un carril lleva las huellas al centro.
      const lane = count[tile] <= 2 ? Math.abs(across - centre) : Math.abs(Math.abs(across - centre) - width / 4);
      data[at] = Math.round(Math.min(lane / REACH, 1) * 255);
      // Un retazo más corto que dos veces su ancho es el paso de una calle sobre la troncal: ahí nadie deja huella recta.
      if (end[tile] - start[tile] + 1 < 2 * count[tile]) continue;
      const toCrossing = Math.min(run - (start[tile] * T - T / 2), end[tile] * T + T / 2 - run);
      data[at + 3] = Math.round(Math.min(toCrossing / APPROACH, 1) * 255);
    }
  }
  // La calzada se sale un par de metros de sí misma: al filtrar, el borde no se mezcla con el valor neutro.
  for (let pass = 0; pass < 2; pass++) {
    const grown = [];
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      if (known[z * w + x]) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= d || !known[nz * w + nx]) continue;
        grown.push(z * w + x, nz * w + nx);
        break;
      }
    }
    for (let i = 0; i < grown.length; i += 2) {
      const to = grown[i] * 4, source = grown[i + 1] * 4;
      data[to] = data[source]; data[to + 1] = data[source + 1]; data[to + 3] = data[source + 3];
      // Y ahí mismo empieza el sardinel: más lejos, lo que use este material sin ser calle (una estación) queda limpio.
      data[to + 2] = 0;
      known[grown[i]] = 1;
    }
  }
  return withOwnRandom(() => {
    const texture = new THREE.DataTexture(data, w, d, THREE.RGBAFormat);
    texture.name = 'Edad y huellas de la calzada';
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    // Las losas se reparten a lo ancho del tramo más largo de la troncal: la junta cae en su borde.
    const [longest = 0] = [...busways].sort((a, b) => b[1] - a[1])[0] ?? [];
    const buswayWidth = (longest % 64 || SLAB_WIDTH / T) * T;
    texture.userData = { width: w, depth: d, buswayEdge: Math.floor(longest / 64) * T - T / 2,
      slabWidth: buswayWidth / Math.max(1, Math.round(buswayWidth / SLAB_WIDTH)) };
    return texture;
  });
}

const DECLARATIONS = /* glsl */`uniform sampler2D uSunCloud;
uniform sampler2D uAsphaltMask;
uniform vec2 uAsphaltMaskScale;
uniform vec3 uAsphaltSlab;
uniform float uAsphaltWet;
uniform float uAsphaltNight;
float asphaltPolish = 0.;
float asphaltGrain = .5;
`;

// Tres escalas: el tramo de cuadra (30 m), la mancha (3 m) y lo que deja el tráfico (huella, aceite y cuneta).
const COLOR_FRAGMENT = /* glsl */`
{
  vec2 asphaltAt = vSunFieldPos.xz;
  vec2 asphaltUv = ( asphaltAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uAsphaltMaskScale;
  // El viaducto, la terminal y el metro comparten este material: arriba y fuera del mapa no hay calles que leer.
  float asphaltLow = 1. - smoothstep( .3, .8, vSunFieldPos.y );
  float asphaltOn = asphaltLow * step( 0., asphaltUv.x ) * step( asphaltUv.x, 1. ) * step( 0., asphaltUv.y ) * step( asphaltUv.y, 1. );
  vec4 asphaltMask = mix( vec4( 1., .5, 1., 0. ), texture2D( uAsphaltMask, asphaltUv ), asphaltOn );
  float asphaltBig = texture2D( uSunCloud, asphaltAt * .0061 + .13 ).r;
  float asphaltMid = texture2D( uSunCloud, asphaltAt.yx * .029 + .47 ).g;
  float asphaltFine = texture2D( uSunCloud, asphaltAt * .13 + .71 ).g;
  // Lo fino se apaga con la distancia: en calidad baja, sin suavizado, una raya de medio metro titila.
  vec2 asphaltPixel = fwidth( asphaltAt );
  float asphaltNear = 1. - smoothstep( .3, .9, max( asphaltPixel.x, asphaltPixel.y ) );
  // El grano: lo fino del ruido y el árido del mapa de color contra la media de su vecindad. Es lo que el agua no tapa.
  asphaltGrain = .5 + ( asphaltFine - .5 ) * asphaltNear;
  #ifdef USE_MAP
    asphaltGrain += ( dot( sampledDiffuseColor.rgb, vec3( .3, .59, .11 ) ) / max( dot( texture2D( map, vMapUv, 5. ).rgb, vec3( .3, .59, .11 ) ), .001 ) - 1. ) * 1.5;
  #endif
  asphaltGrain = clamp( asphaltGrain, 0., 1. );
  float asphaltLane = asphaltMask.r * ${REACH.toFixed(1)};
  // Las huellas se apagan al entrar al cruce; en los metros de antes se frena: más caucho y más aceite.
  float asphaltRun = smoothstep( 0., ${(FADE / APPROACH).toFixed(3)}, asphaltMask.a ) * asphaltNear;
  float asphaltStop = 1. - smoothstep( .2, .8, asphaltMask.a );
  float asphaltTrack = ( 1. - smoothstep( .15, .48, abs( asphaltLane - .85 ) ) ) * asphaltRun * ( .45 + 1.1 * asphaltMid ) * ( 1. + .4 * asphaltStop );
  float asphaltOil = ( 1. - smoothstep( .05, .42 + .2 * asphaltStop, asphaltLane ) ) * asphaltRun * mix( smoothstep( .42, .68, asphaltFine * .55 + asphaltMid * .45 ), 1., asphaltStop * .6 ) * ( 1. + .8 * asphaltStop );
  float asphaltCurb = asphaltMask.b * ${REACH.toFixed(1)} + ( asphaltFine - .5 ) * .7;
  float asphaltGutter = ( 1. - smoothstep( .2, .95 + .7 * asphaltMid, asphaltCurb ) ) * asphaltOn;
  if ( uAsphaltSlab.x > .5 ) {
    // Troncal: losas de concreto con junta sellada, cada una de su tono, y el caucho negro de los articulados.
    #ifdef USE_MAP
      diffuseColor.rgb = diffuse * mix( texture2D( map, vMapUv, 5. ).rgb, texture2D( map, vMapUv ).rgb, .45 ) * 2.3;
    #endif
    vec2 slabSize = vec2( uAsphaltSlab.z, ${SLAB_LENGTH.toFixed(1)} );
    vec2 slabAt = vec2( asphaltAt.x - uAsphaltSlab.y, asphaltAt.y ) / slabSize;
    vec2 slabCell = floor( slabAt );
    float slabTone = fract( sin( dot( slabCell, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    float slabOther = fract( slabTone * 17.31 );
    vec2 slabEdge = ( .5 - abs( fract( slabAt ) - .5 ) ) * slabSize;
    vec2 slabLine = ( 1. - smoothstep( vec2( .035 ), vec2( .036 ) + asphaltPixel, slabEdge ) ) * clamp( .09 / max( asphaltPixel, vec2( .0001 ) ), 0., 1. );
    float slabJoint = max( slabLine.x, slabLine.y ) * asphaltOn;
    // Una de cada doce se fundió después y quedó más clara; las demás varían poco, y el hollín las iguala.
    vec3 slabColor = vec3( .9 + .16 * slabTone ) * mix( vec3( 1. ), vec3( 1.2, 1.19, 1.15 ), step( .915, slabOther ) * asphaltOn );
    slabColor *= ( .9 + .2 * asphaltBig ) * ( .93 + .14 * asphaltMid );
    slabColor *= 1. - ${TRACK_SHADE.slab.toFixed(3)} * min( asphaltTrack, 1. );
    slabColor = mix( slabColor, slabColor * vec3( .5, .47, .43 ), asphaltGutter * .75 );
    diffuseColor.rgb *= mix( vec3( 1. ), mix( slabColor, vec3( .3, .29, .28 ), slabJoint * .8 ), asphaltLow );
    asphaltPolish = asphaltTrack * .6;
  } else {
    float asphaltAge = clamp( asphaltMask.g + ( asphaltMid - .5 ) * .24 + ( asphaltBig - .5 ) * .3, 0., 1. );
    // Lo recién pavimentado es la excepción: uno de cada diez tramos; cuatro de cada diez ya están del todo viejos.
    float asphaltOld = smoothstep( .08, .62, asphaltAge );
    // Recién pavimentado es casi negro y azulado; viejo, gris claro y cálido con el agregado a la vista.
    vec3 asphaltTone = mix( vec3( .58, .59, .63 ), vec3( 1.22, 1.19, 1.11 ), asphaltOld ) * ( .92 + .18 * asphaltBig );
    // La huella pule y oscurece apenas el asfalto viejo; en el nuevo casi no se nota, un poco más gris.
    asphaltTone *= 1. - min( asphaltTrack, 1. ) * mix( ${TRACK_SHADE.fresh.toFixed(3)}, ${TRACK_SHADE.old.toFixed(3)}, asphaltOld );
    asphaltTone *= 1. - asphaltOil * .22;
    asphaltTone = mix( asphaltTone, asphaltTone * vec3( .56, .52, .46 ), asphaltGutter * .8 );
    diffuseColor.rgb *= mix( vec3( 1. ), asphaltTone, asphaltLow );
    asphaltPolish = asphaltTrack;
  }
}
`;

// La huella está pulida: brilla un poco más en seco y bastante más cuando llueve, sin tocar la rugosidad del material.
// De noche y mojada, el agua se queda en el surco de la huella y lo deja liso; el agregado de alrededor sigue áspero.
// De día la calzada mojada no cambia: devuelve el cielo entero.
const ROUGHNESS_FRAGMENT = /* glsl */`
roughnessFactor *= 1. - .22 * min( asphaltPolish, 1. );
roughnessFactor = mix( roughnessFactor, max( roughnessFactor, ${NIGHT_ROAD.dryRoughness.toFixed(2)} - ${NIGHT_ROAD.dryPolish.toFixed(2)} * min( asphaltPolish, 1. ) ), uAsphaltNight * ( 1. - uAsphaltWet ) );
roughnessFactor = mix( roughnessFactor, mix( ${NIGHT_ROAD.wetRoughness.toFixed(2)}, ${NIGHT_ROAD.wetTrackRoughness.toFixed(2)}, min( asphaltPolish, 1. ) ) * ( ${(1 - NIGHT_ROAD.wetGrain / 2).toFixed(2)} + ${NIGHT_ROAD.wetGrain.toFixed(2)} * asphaltGrain ), uAsphaltWet * uAsphaltNight );
`;

// De noche el entorno fijo son vitrinas encendidas: sobre el asfalto seco quedaba como un velo dorado parejo.
const ENVIRONMENT_FRAGMENT = /* glsl */`
#if defined( USE_ENVMAP ) && defined( STANDARD )
  reflectedLight.indirectSpecular *= mix( 1., ${NIGHT_ROAD.dryEnvironment.toFixed(2)}, uAsphaltNight * ( 1. - uAsphaltWet ) );
#endif
`;

// El surco mojado es casi un espejo, y el entorno de noche son cajas oscuras y vitrinas: nítidas se leían como bloques
// de bordes rectos sobre la calzada. De noche el entorno se consulta borroso; el brillo de los faroles no cambia.
const ENVIRONMENT_LOOKUP = 'getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )';
const NIGHT_LIGHTS_FRAGMENT = THREE.ShaderChunk.lights_fragment_maps.replace(ENVIRONMENT_LOOKUP,
  `getIBLRadiance( geometryViewDir, geometryNormal, mix( material.roughness, max( material.roughness, ${NIGHT_ROAD.environmentRoughness.toFixed(2)} ), uAsphaltNight ) )`);

// Lo mojado y la noche son de toda la calzada: un valor para la calle, la troncal, el viaducto y la terminal.
const roadUniforms = { uAsphaltWet: { value: 0 }, uAsphaltNight: { value: 0 } };
const followed = new WeakSet();

/** Lo mojada que está la calzada (0 a 1), como la recibe el piso. */
export function setAsphaltWetness(wet) {
  roadUniforms.uAsphaltWet.value = Math.min(1, Math.max(0, wet || 0));
}

/** La calzada sigue en cada cuadro la noche de la escena, sin soltar lo que el material ya hacía antes de dibujarse. */
export function followAsphaltNight(...materials) {
  for (const material of materials) {
    if (!material || followed.has(material)) continue;
    followed.add(material);
    const previous = material.onBeforeRender;
    material.onBeforeRender = function (renderer, scene, ...rest) {
      previous?.call(this, renderer, scene, ...rest);
      roadUniforms.uAsphaltNight.value = 1 - Math.min(1, Math.max(0, scene?.userData?.environmentDay ?? 1));
    };
  }
}

const masks = new WeakMap();

/**
 * Viste la calzada (o la troncal, con `slabs`) con la máscara del mapa. Devuelve el mismo material.
 * La calzada y la troncal comparten un solo programa: solo cambia un uniforme.
 */
export function dressAsphalt(material, map, { slabs = false } = {}) {
  let mask = masks.get(map);
  if (!mask) masks.set(map, mask = buildAsphaltMask(map));
  const { width, depth, buswayEdge, slabWidth } = mask.userData;
  const uniforms = {
    uAsphaltMask: { value: mask },
    uAsphaltMaskScale: { value: new THREE.Vector2(1 / width, 1 / depth) },
    uAsphaltSlab: { value: new THREE.Vector3(slabs ? 1 : 0, buswayEdge, slabWidth) },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, roadUniforms, { uSunCloud: sunFieldUniforms.uSunCloud });
    shader.fragmentShader = DECLARATIONS + shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>\n${COLOR_FRAGMENT}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGHNESS_FRAGMENT}`)
      .replace('#include <lights_fragment_maps>', NIGHT_LIGHTS_FRAGMENT)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${ENVIRONMENT_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => 'asfalto-vivo';
  return chainSunField(material);
}

const LAMP_DECLARATIONS = /* glsl */`uniform sampler2D uSunCloud;
uniform sampler2D uAsphaltMask;
uniform vec2 uAsphaltMaskScale;
uniform sampler2D uLampGrain;
uniform float uLampGrainScale;
varying vec3 vLampAt;
`;

// La luz pintada cae sobre asfalto y no sobre una lámina: deja ver su árido y sus manchas, y baja en la huella y en el
// aceite. La calzada y la troncal van por debajo del andén y el viaducto por encima: en el andén la luz queda como estaba.
const LAMP_FRAGMENT = /* glsl */`
{
  vec2 lampAt = vLampAt.xz;
  vec2 lampPixel = fwidth( lampAt );
  float lampNear = 1. - smoothstep( .3, .9, max( lampPixel.x, lampPixel.y ) );
  float lampRoad = 1. - smoothstep( .055, .065, vLampAt.y ) + smoothstep( .3, .8, vLampAt.y );
  vec2 lampGrainUv = lampAt * uLampGrainScale;
  vec3 lampLuma = vec3( .3, .59, .11 );
  float lampLocal = max( dot( texture2D( uLampGrain, lampGrainUv, 5. ).rgb, lampLuma ), .001 );
  float lampRock = dot( texture2D( uLampGrain, lampGrainUv ).rgb, lampLuma ) / lampLocal;
  float lampStain = lampLocal / max( dot( texture2D( uLampGrain, lampGrainUv, 10. ).rgb, lampLuma ), .001 );
  float lampMid = texture2D( uSunCloud, lampAt.yx * .029 + .47 ).g;
  float lampGrain = clamp( 1. + ( lampRock - 1. ) * ${NIGHT_ROAD.poolGrainGain.toFixed(2)}, ${NIGHT_ROAD.poolGrain[0].toFixed(2)}, ${NIGHT_ROAD.poolGrain[1].toFixed(2)} );
  lampGrain *= ( 1. + ( lampStain - 1. ) * ${NIGHT_ROAD.poolStain.toFixed(2)} ) * ( ${(1 - NIGHT_ROAD.poolPatch / 2).toFixed(2)} + ${NIGHT_ROAD.poolPatch.toFixed(2)} * lampMid );
  vec2 lampUv = ( lampAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uAsphaltMaskScale;
  float lampOn = ( 1. - smoothstep( .3, .8, vLampAt.y ) ) * step( 0., lampUv.x ) * step( lampUv.x, 1. ) * step( 0., lampUv.y ) * step( lampUv.y, 1. );
  vec4 lampMask = texture2D( uAsphaltMask, lampUv );
  float lampLane = lampMask.r * ${REACH.toFixed(1)};
  float lampRun = smoothstep( 0., ${(FADE / APPROACH).toFixed(3)}, lampMask.a ) * lampNear * lampOn;
  float lampTrack = ( 1. - smoothstep( .15, .48, abs( lampLane - .85 ) ) ) * lampRun * ( .45 + 1.1 * lampMid );
  float lampOil = ( 1. - smoothstep( .05, .42, lampLane ) ) * lampRun * smoothstep( .42, .68, lampMid );
  diffuseColor.rgb *= mix( 1., lampGrain * ( 1. - ${NIGHT_ROAD.poolTrack.toFixed(2)} * min( lampTrack, 1. ) ) * ( 1. - ${NIGHT_ROAD.poolOil.toFixed(2)} * lampOil ), lampRoad );
}
`;

/**
 * La luz pintada de los faroles y de los locales toma, donde cae en la calzada, el grano del asfalto: su mapa de color,
 * con su mismo repetido, y la máscara de las huellas. Sigue siendo aditiva y se encadena después de lo que ya tenga el material.
 */
export function lightOnAsphalt(material, map, road = null) {
  let mask = masks.get(map);
  if (!mask) masks.set(map, mask = buildAsphaltMask(map));
  const { width, depth } = mask.userData, previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const uniforms = {
    uAsphaltMask: { value: mask },
    uAsphaltMaskScale: { value: new THREE.Vector2(1 / width, 1 / depth) },
    uLampGrain: { value: road?.map ?? null },
    uLampGrainScale: { value: 1 / (road?.map?.userData?.scale ?? 14) },
  };
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    uniforms.uLampGrain.value ??= sunFieldUniforms.uSunCloud.value;
    Object.assign(shader.uniforms, uniforms, { uSunCloud: sunFieldUniforms.uSunCloud });
    shader.vertexShader = `varying vec3 vLampAt;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLampAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = LAMP_DECLARATIONS + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${LAMP_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${key}|grano-calzada`;
  return material;
}
