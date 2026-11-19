import { rng } from './textures.js';

// Secuencia persistente para los UUID de las piezas visuales añadidas. Three consulta Math.random
// al construir o clonar recursos, así que el cambio de fuente se limita a la operación sincrónica.
const visualRandom = rng(0x2e97baf1);

export function withVisualRandom(create) {
  const previous = Math.random;
  Math.random = visualRandom;
  try { return create(); } finally { Math.random = previous; }
}
