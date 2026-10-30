/**
 * En WebGPU, `renderer.shadowMap.enabled` y el `castShadow` de cada luz forman parte de la clave
 * de todos los RenderObject: cambiarlos descarta y reconstruye los nodos de toda la escena
 * (segundos de CPU). Como en Slop New York, la sombra del sol se deja siempre declarada y solo
 * se pausa su pasada y se anula su intensidad, que son valores de ejecución.
 */
export function setShadowActive(light, active) {
  light.castShadow = true;
  const shadow = light.shadow;
  if (active && shadow.autoUpdate === false) shadow.needsUpdate = true;
  shadow.autoUpdate = active;
  shadow.intensity = active ? 1 : 0;
}

export const isShadowActive = light => !!light?.castShadow && light.shadow?.autoUpdate !== false;

/** Cambia la resolución del mapa; solo en un cambio manual de calidad, nunca por presión de FPS. */
export function setShadowResolution(light, size) {
  const shadow = light.shadow;
  if (shadow.mapSize.x === size) return false;
  shadow.map?.dispose();
  shadow.mapPass?.dispose?.();
  shadow.map = null;
  if ('mapPass' in shadow) shadow.mapPass = null;
  shadow.mapSize.set(size, size);
  shadow.needsUpdate = true;
  return true;
}

export const shadowResolutionFor = level => level === 'alta' ? 2048 : 1024;
