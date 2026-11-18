// src/world/bogota/StoreGlow.js
// Material de las tiendas: una sola malla con color por vértice y brillo propio que se enciende al caer el sol.
import * as THREE from 'three';
import { chainSunField } from './SunFieldShader.js';

/**
 * El alfa del color de cada vértice no es transparencia: dice cuánto brilla esa cara de noche
 * (0 = nada, 1 = su propio color a plena luz, más de 1 = bombillo). Así la nevera, las vitrinas
 * y los bombillos se encienden sin luces nuevas y sin mallas aparte.
 */
export function glowMaterial(Base = THREE.MeshLambertMaterial, options = {}) {
  const material = new Base({ vertexColors: true, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0, ...options });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb * vColor.a;');
  };
  material.customProgramCacheKey = () => 'tienda-brillo';
  return chainSunField(material);
}

/** Sigue la hora que publica la escena (`environmentDay`: 1 de día, 0 de noche); sin ella queda de día. */
export function followNight(mesh, { day = 0, night = 1 } = {}) {
  mesh.material.emissiveIntensity = day;
  mesh.onBeforeRender = (_renderer, scene) => {
    const light = scene?.userData?.environmentDay ?? 1;
    mesh.material.emissiveIntensity = night + (day - night) * light;
  };
  return mesh;
}
