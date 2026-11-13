// src/entities/npc/hypot.js
// Largo de un vector en el plano. `Math.hypot` acepta cualquier número de argumentos y en V8 arma por dentro un
// arreglo con ellos en cada llamada (unos 80 bytes, medido con el muestreador de memoria en Node 22): en las cuentas
// que se hacen por cuadro y por peatón eso suma kilobytes. La raíz de la suma de cuadrados no reserva nada.

/** √(x² + z²), sin reservar memoria. */
export function hypot(x, z) {
  return Math.sqrt(x * x + z * z);
}
