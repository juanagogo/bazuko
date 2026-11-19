// La parte de sombreado del campo de sol, sin dependencias de la ciudad: la importa cualquier material
// (carros, postes, estación) sin arrastrar el trazado ni crear ciclos con los módulos que este lee.
import * as THREE from 'three';
import { streetLightDeclarations, streetLightDirect, streetLightUniforms } from './StreetLightShader.js';

/** Metros que cubre el canal de altura: 8 bits dan unos 19 cm, de sobra para la sombra de una casa. */
export const SUN_FIELD_HEIGHT = 48;
/** Cuánto se aparta la consulta hacia el sol, en fracción de la componente horizontal de su dirección. */
export const SUN_FIELD_SIDEWAYS = .8;
/** Por debajo de este tope la sombra de una copa ya no se nota: ahí se apaga y el barrido deja de llevarla. */
export const CROWN_FADE = .5;

const OPEN_SKY = new THREE.DataTexture(new Uint8Array([0, 255]), 1, 1, THREE.RGFormat);
OPEN_SKY.minFilter = OPEN_SKY.magFilter = THREE.LinearFilter;
OPEN_SKY.needsUpdate = true;
export { OPEN_SKY };

/** Objetos compartidos por todos los materiales: actualizarlos no recompila ni recorre la escena. */
export const sunFieldUniforms = {
  uSunField: { value: OPEN_SKY },
  uSunFieldRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uSunFieldSun: { value: new THREE.Vector2() },
  // Solo la pasada de la ciudad lo enciende: el creador y las vistas previas dibujan en el origen.
  uSunFieldOn: { value: 0 },
  // Sombra de las nubes que pasan: solo los días de nubes sueltas, muy lenta para que nunca parpadee.
  uSunCloud: { value: OPEN_SKY },
  uSunCloudShade: { value: 0 },
  uSunCloudDrift: { value: new THREE.Vector2() },
  // Lo mínimo que llega a la sombra: de noche la luna casi no marca y un rincón oscuro sigue siendo jugable.
  uSunLitFloor: { value: 0 },
  uSunSkyFloor: { value: .22 },
  // Cuánto sol quita una copa: a medias, porque entre las hojas pasa luz.
  uSunCanopyShade: { value: .62 },
};

const VERTEX_DECLARATIONS = /* glsl */`
uniform sampler2D uSunCloud;
uniform float uSunCloudShade;
uniform vec2 uSunCloudDrift;
varying vec3 vSunFieldPos;
varying vec3 vSunFieldNormal;
varying float vSunFieldCloud;
`;
const VERTEX_BODY = /* glsl */`
{
  vec4 sunFieldWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    sunFieldWorld = instanceMatrix * sunFieldWorld;
  #endif
  sunFieldWorld = modelMatrix * sunFieldWorld;
  vSunFieldPos = sunFieldWorld.xyz;
  vSunFieldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
  // Por vértice: una nube mide cien metros, no necesita una consulta más por píxel.
  vSunFieldCloud = 1.0 - uSunCloudShade * smoothstep( .47, .6, texture2D( uSunCloud, sunFieldWorld.xz * .0019 + uSunCloudDrift ).r );
}
`;
const FRAGMENT_DECLARATIONS = /* glsl */`
uniform sampler2D uSunField;
uniform vec4 uSunFieldRect;
uniform vec2 uSunFieldSun;
uniform float uSunFieldOn;
uniform float uSunLitFloor;
uniform float uSunSkyFloor;
uniform float uSunCanopyShade;
varying vec3 vSunFieldPos;
varying vec3 vSunFieldNormal;
varying float vSunFieldCloud;
float sunFieldAzar( vec2 p ) {
  vec3 q = fract( p.xyx * .1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float sunFieldGrano( vec2 p ) {
  vec2 c = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( sunFieldAzar( c ), sunFieldAzar( c + vec2( 1.0, 0.0 ) ), f.x ),
    mix( sunFieldAzar( c + vec2( 0.0, 1.0 ) ), sunFieldAzar( c + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;
// La consulta se aparta de la superficie por su normal y hacia el sol: así una pared no se tapa
// a sí misma y una azotea queda por encima de su propio edificio.
const FRAGMENT_SAMPLE = /* glsl */`
vec2 sunFieldAt = vSunFieldPos.xz + vSunFieldNormal.xz * 1.1 + uSunFieldSun;
float sunFieldY = vSunFieldPos.y + max( vSunFieldNormal.y, 0.0 ) * .9;
#ifdef SUN_FIELD_REACH
  // Una copa también está en el campo y entera quedaría a su propia sombra: la consulta sigue el rayo
  // hacia el sol, más allá de sus hojas. Lo que tape desde más lejos, como un edificio, sigue contando.
  vec2 sunFieldRay = uSunFieldSun / ${SUN_FIELD_SIDEWAYS.toFixed(2)};
  sunFieldAt += sunFieldRay * SUN_FIELD_REACH;
  sunFieldY += sqrt( max( 1.0 - dot( sunFieldRay, sunFieldRay ), 0.0 ) ) * SUN_FIELD_REACH;
#endif
vec4 sunFieldTexel = texture2D( uSunField, ( sunFieldAt - uSunFieldRect.xy ) * uSunFieldRect.zw );
// La copa tapa entre su base y su tope, con borde ancho; donde su sombra ya roza el piso se apaga sola.
float sunFieldCopa = smoothstep( -1.2, 1.2, sunFieldTexel.b * ${SUN_FIELD_HEIGHT.toFixed(1)} - sunFieldY ) * smoothstep( -1.2, 1.2, sunFieldY - sunFieldTexel.a * ${SUN_FIELD_HEIGHT.toFixed(1)} )
  * clamp( ( sunFieldTexel.b * ${SUN_FIELD_HEIGHT.toFixed(1)} - ${CROWN_FADE.toFixed(1)} ) / 1.5, 0.0, 1.0 );
if ( sunFieldCopa > .004 ) {
  // Manchas de sol entre las hojas, fijas en el mundo y tendidas a lo largo del rayo: en el piso quedan quietas
  // y en una pared no hacen rayas. De lejos se aplanan a su promedio para que no titilen.
  vec2 sunFieldHaz = uSunFieldSun / ${SUN_FIELD_SIDEWAYS.toFixed(2)};
  vec2 sunFieldMota = vSunFieldPos.xz - sunFieldHaz * ( vSunFieldPos.y / max( sqrt( max( 1.0 - dot( sunFieldHaz, sunFieldHaz ), 0.0 ) ), .3 ) );
  float sunFieldLejos = smoothstep( 30.0, 70.0, distance( vSunFieldPos, cameraPosition ) );
  float sunFieldHueco = mix( sunFieldGrano( sunFieldMota * 1.15 ) * .62 + sunFieldGrano( sunFieldMota * 3.3 + 17.0 ) * .38, .5, sunFieldLejos );
  // El mismo grano se come el borde: la mancha no deja ver el círculo de la copa.
  sunFieldCopa = smoothstep( sunFieldHueco * .5, .5 + sunFieldHueco * .5, sunFieldCopa )
    * mix( mix( 1.0, .4, smoothstep( .5, .68, sunFieldHueco ) ), .8, sunFieldLejos );
}
// Cero codifica cielo abierto, también cuando el receptor está por debajo de la cota de la calle.
float sunFieldSolidLit = mix( 1.0, smoothstep( -.3, .3, sunFieldY - sunFieldTexel.r * ${SUN_FIELD_HEIGHT.toFixed(1)} ), min( 1.0, sunFieldTexel.r * 255.0 ) );
float sunFieldLit = mix( 1.0, mix( uSunLitFloor, 1.0, sunFieldSolidLit * vSunFieldCloud * ( 1.0 - uSunCanopyShade * sunFieldCopa ) ), uSunFieldOn );
float sunFieldSky = mix( 1.0, mix( mix( uSunSkyFloor, 1.0, sunFieldTexel.g ), 1.0, smoothstep( .4, 7.5, vSunFieldPos.y ) ), uSunFieldOn );
`;
const DIRECTIONAL_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';

/**
 * Añade el campo a un shader de la familia iluminada; los demás quedan intactos.
 * `reach` son los metros de rayo que se saltan los objetos que están ellos mismos en el campo.
 */
export function patchSunFieldShader(shader, reach = 0) {
  if (!shader?.fragmentShader?.includes('#include <lights_fragment_begin>') || !shader.vertexShader?.includes('#include <project_vertex>')) return false;
  if (shader.vertexShader.includes('vSunFieldPos')) return false;
  Object.assign(shader.uniforms, sunFieldUniforms, streetLightUniforms);
  shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
  shader.fragmentShader = (reach ? `#define SUN_FIELD_REACH ${reach.toFixed(1)}\n` : '') + FRAGMENT_DECLARATIONS + streetLightDeclarations + shader.fragmentShader
    .replace('#include <lights_fragment_begin>', FRAGMENT_SAMPLE + THREE.ShaderChunk.lights_fragment_begin
      .replace('IncidentLight directLight;', `IncidentLight directLight;\n${streetLightDirect}`)
      .replace(DIRECTIONAL_ANCHOR, `${DIRECTIONAL_ANCHOR}\n\t\tdirectLight.color *= sunFieldLit;`))
    .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
reflectedLight.indirectDiffuse *= sunFieldSky;
#if defined( USE_ENVMAP ) && defined( STANDARD )
  reflectedLight.indirectSpecular *= sunFieldSky;
#endif
`);
  return true;
}

// El gancho del prototipo alcanza a todo material sin gancho propio, también a los clones de
// BuildingVisibility. Quien asigna el suyo lo tapa: debe encadenar el campo con chainSunField.
THREE.Material.prototype.onBeforeCompile = function sunField(shader) { patchSunFieldShader(shader); };

/** Encadena el campo en un material con shader propio. Va después de asignar el gancho y su clave. */
export function chainSunField(material, reach = 0) {
  if (!Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') || material.userData.sunFieldChained) return material;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.userData.sunFieldChained = true;
  material.onBeforeCompile = (shader, renderer) => { previous.call(material, shader, renderer); patchSunFieldShader(shader, reach); };
  material.customProgramCacheKey = () => `${key}|campo-sol${reach || ''}`;
  return material;
}

/**
 * Luz aditiva sobre el piso con niebla: se apaga hacia negro con la distancia. Si tomara el color
 * del cielo, ese color se sumaría a un piso ya fundido con él y quedaría una mancha más clara que el cielo.
 */
export function fadeGlowInFog(material) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', /* glsl */`
      #ifdef USE_FOG
        gl_FragColor.rgb *= 1. - smoothstep( fogNear, fogFar, vFogDepth );
      #endif`);
  };
  material.customProgramCacheKey = () => 'luz-aditiva-niebla';
  return material;
}
