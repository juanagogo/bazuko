import { Vector4 } from 'three';

// Cada celda de calle lleva la lista completa de luminarias que la alcanzan, también si quedan en otra celda.
export const STREET_LIGHT_CELL = 8;
export const STREET_LIGHT_TEXTURE_WIDTH = 256;
export const STREET_SODIUM_PERCENT = 32;

export const streetLightUniforms = {
  uStreetLightMap: { value: null },
  uStreetLightGrid: { value: new Vector4() },
  uStreetLightLevel: { value: 0 },
};

/** La ciudad y las vistas previas comparten materiales. El campo solo se usa en la escena de Bogotá, en alta. */
export function setStreetLightLevel(scene, high, level) {
  const map = scene.userData.streetLightMap;
  const enabled = !!(map && high);
  scene.userData.mappedStreetLights = enabled;
  streetLightUniforms.uStreetLightLevel.value = enabled ? level : 0;
  streetLightUniforms.uStreetLightMap.value = enabled ? map.texture : null;
  if (map) {
    streetLightUniforms.uStreetLightGrid.value.copy(map.grid);
    map.windowLevel = enabled ? level : null;
  }
  return enabled;
}

export const streetLightDeclarations = /* glsl */`
#if NUM_POINT_LIGHTS > 0
  uniform highp sampler2D uStreetLightMap;
  uniform vec4 uStreetLightGrid;
  uniform float uStreetLightLevel;
  vec4 streetLightTexel( int index ) {
    return texelFetch( uStreetLightMap, ivec2( index % ${STREET_LIGHT_TEXTURE_WIDTH}, index / ${STREET_LIGHT_TEXTURE_WIDTH} ), 0 );
  }
#endif
`;

// Misma respuesta difusa y especular que las demás luces de Three. En pavimento húmedo el reflejo
// se mueve con la cámara y sigue el relieve; en tela y ladrillo permanece la luz difusa.
export const streetLightDirect = /* glsl */`
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
if ( uSunFieldOn * uStreetLightLevel > .001 ) {
  ivec2 cell = ivec2( floor( ( vSunFieldPos.xz - uStreetLightGrid.xy ) / ${STREET_LIGHT_CELL.toFixed(1)} ) );
  ivec2 grid = ivec2( uStreetLightGrid.zw );
  if ( all( greaterThanEqual( cell, ivec2( 0 ) ) ) && all( lessThan( cell, grid ) ) ) {
    ivec2 span = ivec2( streetLightTexel( cell.y * grid.x + cell.x ).xy );
    for ( int i = span.x; i < span.y; i += 2 ) {
      vec4 fixture = streetLightTexel( i ); // centro y radio de corte, en metros
      vec3 toLight = fixture.xyz - vSunFieldPos;
      vec4 emission = streetLightTexel( i + 1 ); // candelas RGB, tipo y ancho de la vitrina
      float beam = 1.;
      if ( emission.w >= 1. ) {
        // El emisor es el vano: la luz sale hacia el andén y se corta contra su propia pared.
        int side = int( emission.w );
        vec2 front = side == 1 ? vec2( 1., 0. ) : side == 2 ? vec2( -1., 0. ) :
                     side == 3 ? vec2( 0., 1. ) : vec2( 0., -1. );
        vec2 edge = vec2( -front.y, front.x );
        float halfWidth = fract( emission.w ) * 4.;
        toLight.xz -= edge * clamp( dot( toLight.xz, edge ), -halfWidth, halfWidth );
        float frontDistance = dot( -toLight.xz, front );
        beam = smoothstep( -.24, .08, frontDistance ) *
               mix( .22, 1., smoothstep( 0., .7, frontDistance / max( length( toLight ), .01 ) ) );
      } else if ( emission.w == 0. ) {
        // La visera de un poste manda luz hacia abajo. El farol de hierro y el bombillo alumbran en redondo.
        beam = smoothstep( -.12, .58, toLight.y / max( length( toLight ), .01 ) );
      }
      float distanceSq = dot( toLight, toLight );
      if ( distanceSq >= fixture.w * fixture.w || beam <= .001 ) continue;
      directLight.direction = mat3( viewMatrix ) * toLight * inversesqrt( max( distanceSq, .0001 ) );
      // A la distancia del propio vidrio, el emisor tiene tamaño y su iluminancia permanece finita.
      float distanceRatio = distanceSq / ( fixture.w * fixture.w );
      float cutoff = 1. - distanceRatio * distanceRatio;
      directLight.color = emission.rgb * ( uStreetLightLevel * beam * cutoff * cutoff / max( distanceSq, .8 ) );
      directLight.visible = true;
      RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
  }
}
#endif
`;
