// Prado y andén sin una textura por parque: una máscara de desgaste de un texel por metro, sacada del
// mapa de tiles, y el ruido que la cúpula ya tiene en memoria. Rompe la repetición cada 6 y 8 m.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { boxBlur, chainSunField, sunFieldUniforms } from './SunField.js';
import { PAVING_KINDS, pavingBandsOf, pavingMarksOf, releasePavingBands } from './PavingBands.js';
import { grassWearUniforms, GRASS_FINISH_GLSL } from './GrassFinish.js';
import { PAVING_STAIN_GLSL } from './PavingFinish.js';

/** Lo que se pisa o se transita: junto a esto el pasto se gasta. Contra una pared casi no. */
const TRODDEN = new Set(['road', 'busway', 'sidewalk', 'plaza', 'floor', 'dirt']);

/** Acabado de la tierra en el programa del andén: no es un andén, así que no está en `PAVING_KINDS`. */
export const DIRT_KIND = 4;

// La máscara de desgaste de un mapa la leen también el andén y la tierra, para ensuciarse contra los muros:
// un solo par de uniformes por mapa, que se llena cuando la máscara existe.
const wearUniforms = new WeakMap();
function wearOf(map) {
  if (!map) return { uGroundWear: { value: null }, uGroundWearScale: { value: new THREE.Vector2() } };
  if (!wearUniforms.has(map)) wearUniforms.set(map, { uGroundWear: { value: null }, uGroundWearScale: { value: new THREE.Vector2() } });
  return wearUniforms.get(map);
}

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
  const shared = wearOf(map);
  shared.uGroundWear.value = texture;
  shared.uGroundWearScale.value.set(1 / w, 1 / d);
  return texture;
}

const NOISE_DECLARATION = /* glsl */'uniform sampler2D uSunCloud;\n';

// Lo que el programa del andén declara: la máscara de franjas, el acabado del material y dos funciones.
const PAVING_DECLARATIONS = /* glsl */`
${PAVING_STAIN_GLSL}
uniform sampler2D uPavingBands;
uniform sampler2D uPavingMarks;
uniform vec2 uPavingBandsScale;
uniform float uPavingKind;
uniform sampler2D uGroundWear;
uniform vec2 uGroundWearScale;
float pavingHash( vec2 cell ) {
  vec3 p = fract( vec3( cell.xyx ) * .1031 );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
// Adoquín de arcilla de 24 × 12 cm en espina de pez. La junta y el tono de cada pieza se apagan con la
// distancia: de lejos queda el color medio y nada titila.
vec3 pavingClay( vec2 at ) {
  vec2 p = at / .12;
  vec2 cell = floor( p );
  float turn = mod( cell.x - cell.y, 4. );
  vec2 base = cell;
  vec2 size = vec2( 2., 1. );
  if ( turn > 1.5 ) size = vec2( 1., 2. );
  if ( turn > .5 && turn < 1.5 ) base.x -= 1.;
  if ( turn > 1.5 && turn < 2.5 ) base.y -= 1.;
  vec2 inside = p - base;
  vec2 toEdge = min( inside, size - inside );
  float fine = 1. - smoothstep( .3, 1., fwidth( p.x ) + fwidth( p.y ) );
  vec3 clay = mix( vec3( .2, .092, .06 ), vec3( .35, .168, .11 ), pavingHash( base ) );
  clay = mix( clay, vec3( .125, .08, .064 ), step( .9, pavingHash( base + 7.3 ) ) * .7 );
  clay = mix( vec3( .262, .122, .08 ), clay, .3 + .7 * fine );
  return clay * ( 1. - .4 * fine * ( 1. - smoothstep( .03, .14, min( toEdge.x, toEdge.y ) ) ) );
}
`;

// Hollín y lluvia de años: la misma losa no se repite igual cada seis metros. Encima, el acabado del barrio:
// cada losa con su tono, la franja de arcilla y la guía táctil del andén renovado, la placa vieja o la losa de la plaza.
const PAVING_FRAGMENT = /* glsl */`
float pavingPanelHeight = 0.;
float pavingPanelBlend = 0.;
{
  vec2 pavingAt = vSunFieldPos.xz;
  vec2 stains = pavingStains(pavingAt);
  float pavingStain = stains.x, pavingScuff = stains.y;
  // Lo que no se pisa (muros, fachadas, agua, pasto) baja el desgaste en línea recta hasta 2,5 m de su borde: con la
  // pendiente se sabe a cuánto queda el borde, sea un muro o un prado.
  float pavingWear = texture2D( uGroundWear, ( pavingAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uGroundWearScale ).r;
  float pavingWearX = texture2D( uGroundWear, ( pavingAt + vec2( ${(TILE_SIZE / 2 + .5).toFixed(1)}, ${(TILE_SIZE / 2).toFixed(1)} ) ) * uGroundWearScale ).r;
  float pavingWearZ = texture2D( uGroundWear, ( pavingAt + vec2( ${(TILE_SIZE / 2).toFixed(1)}, ${(TILE_SIZE / 2 + .5).toFixed(1)} ) ) * uGroundWearScale ).r;
  float pavingHasWear = step( 1e-6, uGroundWearScale.x );
  float pavingFromWall = mix( 9., 2.5 - ( 1. - pavingWear ) / max( length( vec2( pavingWearX, pavingWearZ ) - pavingWear ) * 2., .05 ), pavingHasWear )
    + ( pavingScuff - .5 ) * .12;
  if ( uPavingKind > .5 && uPavingKind < 3.5 ) {
    // El color del material trae lo que oscurece la lluvia: lo pintado encima se moja igual que la losa.
    float pavingWet = dot( diffuse, vec3( .3, .59, .11 ) ) * 1.36;
    vec2 pavingSlab = floor( pavingAt / .75 );
    if ( uPavingKind > 2.5 ) {
      // Plazas y senderos de parque: su propia losa, cada una de su tono. La arcilla es solo del andén.
      diffuseColor.rgb *= ( .9 + .2 * pavingHash( pavingSlab + 2.9 ) ) * mix( vec3( 1.025, 1., .97 ), vec3( .975, .99, 1.015 ), pavingHash( pavingSlab + 8.3 ) );
    } else {
      vec3 pavingBrick = pavingClay( pavingAt ) * pavingWet;
      vec2 pavingMask = texture2D( uPavingBands, ( pavingAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uPavingBandsScale ).rg;
      float pavingMend = texture2D( uSunCloud, pavingAt * .06 + .43 ).r * .7 + pavingStain * .3 + ( pavingScuff - .5 ) * .14;
      // Loseta prefabricada de 40 × 40 cm. La junta, el bisel y el tono se filtran con la huella del píxel.
      vec2 pavingPanel = pavingAt / .4;
      vec2 pavingPanelId = floor( pavingPanel ), pavingFract = fract( pavingPanel );
      vec2 pavingToEdge = min( pavingFract, 1. - pavingFract );
      float pavingEdge = min( pavingToEdge.x, pavingToEdge.y ) * .4;
      vec2 pavingPixel = fwidth( pavingAt );
      float pavingFootprint = max( pavingPixel.x, pavingPixel.y );
      float pavingFeather = max( .001, pavingFootprint * .45 );
      float pavingPanelDetail = 1. - smoothstep( .095, .26, pavingFootprint );
      float pavingBevel = smoothstep( .0035 - pavingFeather, .009 + pavingFeather, pavingEdge );
      float pavingMix = pavingHash( pavingPanelId + 5.1 );
      vec3 pavingConcrete = diffuse * vec3( .337, .334, .322 );
      vec3 pavingNew = pavingConcrete * ( 1. + ( pavingHash( pavingPanelId ) - .5 ) * .15 * pavingPanelDetail );
      pavingNew *= mix( vec3( 1. ), mix( vec3( 1.025, 1., .979 ), vec3( .979, .998, 1.024 ), pavingMix ), pavingPanelDetail );
      // El agregado del concreto usa el ruido compartido y se pierde al alejarse antes de las juntas.
      float pavingAggregate = texture2D( uSunCloud, pavingAt.yx * .77 + vec2( .73, .41 ) ).g;
      float pavingGrainDetail = 1. - smoothstep( .025, .10, pavingFootprint );
      pavingNew *= 1. + ( smoothstep( .25, .78, pavingAggregate ) - .5 ) * .16 * pavingGrainDetail;
      pavingNew *= 1. - ( 1. - pavingBevel ) * .46 * pavingPanelDetail;
      pavingPanelHeight = .0045 * pavingBevel * pavingPanelDetail;
      float pavingRoad = pavingMask.r * 4.5 - .5;
      float pavingSoft = fwidth( pavingRoad ) + .015;
      // Detrás de cada rampa la arcilla se corta y va la loseta de botones; junto al alcorque la guía se corre.
      vec2 pavingMarks = texture2D( uPavingMarks, ( pavingAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uPavingBandsScale ).rg;
      float pavingRamp = smoothstep( .4, .6, pavingMarks.r );
      float pavingLine = pavingRoad - ( pavingMarks.g - .5 ) * 1.0;
      // Guía táctil a metro y medio del sardinel: loseta de concreto ocre apagado, con cuatro barras a lo largo y
      // mugre en las canales. Conserva las juntas de la losa, que salen de lo que la textura le quita al color del material.
      float pavingGuide = smoothstep( 1.5 - pavingSoft, 1.5 + pavingSoft, pavingLine ) * ( 1. - smoothstep( 1.9 - pavingSoft, 1.9 + pavingSoft, pavingLine ) );
      float pavingJoint = dot( diffuseColor.rgb, vec3( .3, .59, .11 ) ) / max( dot( diffuse, vec3( .3, .59, .11 ) ), .01 );
      float pavingBars = ( pavingRoad - 1.5 ) * 10.;
      pavingBars -= ( pavingMarks.g - .5 ) * 10.;
      float pavingBarU = fract( pavingBars );
      float pavingCrown = smoothstep( .1, .34, pavingBarU ) * ( 1. - smoothstep( .66, .9, pavingBarU ) );
      float pavingRelief = mix( .64 + .44 * pavingCrown, .88, smoothstep( .3, .7, fwidth( pavingBars ) ) );
      vec3 pavingOchre = vec3( .27, .222, .138 ) * pavingWet * clamp( pavingJoint / .3, .55, 1.1 ) * pavingRelief;
      pavingNew = mix( pavingNew, pavingOchre, pavingGuide * ( .72 + .2 * smoothstep( .36, .58, pavingScuff ) ) );
      // Loseta de botones de 30 cm a 1,55 m del sardinel, del ancho de la rampa: domos en cuadrícula de 7,5 cm.
      float pavingField = pavingRamp * smoothstep( .35 - pavingSoft, .35 + pavingSoft, pavingRoad ) * ( 1. - smoothstep( 1.55 - pavingSoft, 1.55 + pavingSoft, pavingRoad ) );
      vec2 pavingDot = fract( pavingAt / .075 ) - .5;
      float pavingDome = 1. - smoothstep( .18, .32, length( pavingDot ) );
      float pavingDomes = mix( .64 + .44 * pavingDome, .88, smoothstep( .3, .7, fwidth( pavingAt.x / .075 ) ) );
      vec3 pavingButtons = vec3( .27, .222, .138 ) * pavingWet * clamp( pavingJoint / .3, .55, 1.1 ) * pavingDomes;
      pavingNew = mix( pavingNew, pavingButtons, pavingField * ( .72 + .2 * smoothstep( .36, .58, pavingScuff ) ) );
      // Franja de adoquín de arcilla de 0,6 m contra el sardinel.
      float pavingClayStrip = ( 1. - smoothstep( .6 - pavingSoft, .6 + pavingSoft, pavingRoad ) ) * ( 1. - pavingRamp );
      pavingNew = mix( pavingNew, pavingBrick, pavingClayStrip );
      // Placa vieja, fundida en sitio: la rejilla de la loseta se apaga y manda el paño de 3 × 1,5 m, cada uno de su edad.
      vec3 pavingOld = mix( diffuseColor.rgb, vec3( .2, .19, .172 ) * pavingWet, .55 );
      pavingOld *= ( .84 + .28 * pavingHash( floor( pavingAt / vec2( 3., 1.5 ) ) ) ) * ( .96 + .08 * pavingHash( pavingSlab ) );
      // Remiendos: paños de dos losas vueltos a fundir, más claros y de borde recto, uno de cada diez.
      pavingOld = mix( pavingOld, vec3( .28, .275, .26 ) * pavingWet * ( .92 + .16 * pavingHash( pavingSlab + 3.7 ) ), step( .9, pavingHash( floor( pavingAt / vec2( 1.5, .75 ) ) + 11.3 ) ) * .68 );
      // Tierra donde la placa ya no está: manchas de un par de metros con el borde roto por el ruido, cerca de una vigésima parte del andén.
      pavingOld = mix( pavingOld, vec3( .105, .08, .055 ) * pavingWet * ( .7 + .6 * pavingScuff ), ( 1. - smoothstep( .21, .29, pavingMend ) ) * .68 );
      // El barrio del cambuche es todo viejo; en el centro lo viejo (El Cartucho) entra a mordiscos, no por una raya.
      float pavingAge = uPavingKind < 1.5 ? 1. : smoothstep( .42, .58, pavingMask.g + ( pavingMend - .5 ) * .7 );
      diffuseColor.rgb = mix( pavingNew, pavingOld, pavingAge );
      pavingPanelBlend = ( 1. - pavingAge ) * ( 1. - max( max( pavingGuide, pavingField ), pavingClayStrip ) );
    }
  }
  // Andén y plaza: un 20 % más oscuros en los 25 cm contra el sardinel y los 35 cm contra la fachada, donde no llega el paso.
  float pavingCurbSide = texture2D( uPavingBands, ( pavingAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uPavingBandsScale ).r * 4.5 - .5 + ( pavingScuff - .5 ) * .08;
  float pavingGrime = max( 1. - smoothstep( .2, .3, pavingCurbSide ), 1. - smoothstep( .28, .42, pavingFromWall ) );
  diffuseColor.rgb *= 1. - .2 * pavingGrime * step( .5, uPavingKind ) * step( uPavingKind, 3.5 );
  // La tierra va por manchas de 15 a 25 m, que no dejan leer la repetición de 8 m, y un 20 % más oscura en los 40 cm contra los muros.
  float dirtTone = ( .92 + .16 * smoothstep( .3, .7, texture2D( uSunCloud, pavingAt * .0125 + .53 ).r ) )
    * ( 1. - .2 * ( 1. - smoothstep( .32, .48, pavingFromWall ) ) );
  diffuseColor.rgb *= uPavingKind > 3.5 ? dirtTone : pavingTone(stains);
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
  patchFragment(material, 'prado-gastado', GRASS_FINISH_GLSL, 'diffuseColor.rgb = grassFinish( diffuseColor.rgb, vSunFieldPos.xz );', grassWearUniforms(wearTexture));
}

/**
 * Los acabados de andén comparten un solo programa: ni la mancha ni el acabado suman compilaciones por barrio.
 * Con el mapa de tiles y la clave del material (`sidewalk_lago`, `plaza`…) cada uno toma su acabado por uniformes.
 */
export function dressPaving(material, { map, key } = {}) {
  const bands = pavingBandsOf(map), { width, depth } = bands.userData;
  patchFragment(material, 'anden-manchado', PAVING_DECLARATIONS, PAVING_FRAGMENT, {
    uPavingBands: { value: bands }, uPavingMarks: { value: pavingMarksOf(map) }, uPavingBandsScale: { value: new THREE.Vector2(1 / width, 1 / depth) },
    uPavingKind: { value: map ? key === 'dirt' ? DIRT_KIND : PAVING_KINDS[key] ?? 0 : 0 }, ...wearOf(map),
  });
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, roughness * .92, pavingPanelBlend );
#if NUM_POINT_LIGHTS > 0
// El agregado de la loseta húmeda dispersa el brillo de las vitrinas; el agua encharcada tiene su propio material.
roughnessFactor = mix( roughnessFactor, max( roughnessFactor, .48 ), uStreetLightLevel * ( 1. - smoothstep( .52, .78, roughness ) ) );
#endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef USE_BUMPMAP
vec2 pavingSlope = vec2( dFdx( pavingPanelHeight ), dFdy( pavingPanelHeight ) );
if ( pavingPanelBlend > 0. ) {
  vec3 pavingNormal = perturbNormalArb( -vViewPosition, nonPerturbedNormal, pavingSlope, faceDirection );
  normal = normalize( mix( normal, pavingNormal, pavingPanelBlend ) );
}
#endif`);
  };
  // La máscara no cuelga del material como un mapa: se va con el primer andén que se suelte al cerrar la ciudad.
  if (map) material.addEventListener('dispose', () => releasePavingBands(map));
  return material;
}
