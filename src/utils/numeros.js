// src/utils/numeros.js
// Cómo se escriben los números en la pantalla: coma decimal y un solo signo de menos.

const MENOS = '−';

/** 5.9 → «5,9». Con `decimales`, fijos. */
export const conComa = (n, decimales = null) => String(decimales === null ? n : n.toFixed(decimales)).replace('.', ',');

/** Con su signo: +5 o −3. */
export const conSigno = (n) => (n > 0 ? `+${conComa(n)}` : `${MENOS}${conComa(Math.abs(n))}`);
