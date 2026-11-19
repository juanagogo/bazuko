import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';

/** El mismo acabado en el prado por tiles y los paños de césped de la ribera. */
export const GRASS_FINISH_GLSL = /* glsl */`
uniform sampler2D uGroundWear;
uniform vec2 uGroundWearScale;
vec3 grassFinish( vec3 color, vec2 groundAt ) {
  float groundPatch = texture2D( uSunCloud, groundAt * .021 ).r;
  float groundClump = texture2D( uSunCloud, groundAt.yx * .025 + .37 ).g;
  color *= mix( vec3( .84, .93, .82 ), vec3( 1.14, 1.08, .94 ), smoothstep( .24, .76, groundPatch * .7 + groundClump * .3 ) );
  float groundWear = texture2D( uGroundWear, ( groundAt + ${(TILE_SIZE / 2).toFixed(1)} ) * uGroundWearScale ).r;
  if ( groundWear <= .06 ) return color;
  // Los claros de tierra nacen donde se pisa. El ruido rompe el borde de esas zonas.
  float groundFine = texture2D( uSunCloud, groundAt * .156 + .11 ).g;
  float groundTrod = groundWear + smoothstep( .06, .3, groundWear ) * ( ( groundClump - .5 ) * .26 + ( groundFine - .5 ) * .18 );
  color *= mix( vec3( 1. ), vec3( 1.18, 1.01, .79 ), smoothstep( .14, .4, groundTrod ) );
  float groundGrit = texture2D( uSunCloud, groundAt * 1.25 + .5 ).g;
  vec3 groundEarth = vec3( .107, .083, .058 ) * ( .76 + .5 * groundGrit ) * ( .9 + .2 * groundFine );
  return mix( color, groundEarth, smoothstep( .27, .49, groundTrod ) );
}
`;

export function grassWearUniforms(wearTexture) {
  const { width, depth } = wearTexture.userData;
  return {
    uGroundWear: { value: wearTexture },
    uGroundWearScale: { value: new THREE.Vector2(1 / width, 1 / depth) }
  };
}
