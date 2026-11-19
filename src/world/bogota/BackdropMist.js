// Extiende la bruma de la calle al fondo comprimido, donde la distancia de recorte ya no describe el aire atravesado.
const BACKDROP_MIST = /* glsl */ `
#ifdef USE_FOG
  float backdropMist(float aerial) {
    float eye = max(cameraPosition.y, 0.);
    float surface = max(cameraPosition.y + vSkyFogRay.y, 0.);
    float rise = abs(surface - eye) * skyFogLayer.x;
    // Promedio de la densidad exponencial entre la cámara y la superficie, incluso para un rayo horizontal.
    float meanDensity = exp(-min(surface, eye) * skyFogLayer.x) *
      (rise > .01 ? (1. - exp(-rise)) / rise : 1. - .5 * rise);
    float reach = max(length(vSkyFogRay) - fogNear, 0.) / max(fogFar - fogNear, 1.);
    float wet = max(skyFogLayer.w, skyFogCloud.w * .60);
    float mist = smoothstep(.08, .74, wet);
    // En despejado domina la perspectiva aérea. Con neblina se acumula el espesor de aire húmedo.
    float dryVeil = .48 * meanDensity * (1. - exp(-1.75 * reach));
    float wetVeil = .95 * (1. - exp(-2.4 * reach * meanDensity));
    // El aire bajo se abre por encima de las manzanas y deja profundidad en las crestas y azoteas.
    float clearance = 1. - .53 * smoothstep(24., 118., surface);
    float lowMist = mix(dryVeil, wetVeil, mist) * clearance;
    return mix(aerial, 1., lowMist);
  }
#endif
`;

export function patchBackdropMist(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>',
    `#include <fog_pars_fragment>\n${BACKDROP_MIST}`);
}
