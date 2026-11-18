// La escritura de BAZUKO, sin DOM: reparte el avance entre los trazos y lo mueve con el reloj.
// Vive aparte porque la usan el hilo principal (respaldo SVG) y el trabajador que dibuja el lienzo.
export const DURACION = 4500; // lo que tarda una carga rápida; si la carga se demora, la palabra lo espera escrita
export const ARRANQUE = .05; // nunca se ve el cartón sin nada escrito
export const GROSOR = 210; // más grueso que cualquier punta: lo que se ve es la tinta que recorta cada trazo

/** Cuánto de cada trazo va escrito, en orden y según su largo. El trazo en curso es uno solo. */
export function escritura(avance, largos) {
  const total = largos.reduce((s, l) => s + l, 0);
  let falta = Math.min(1, Math.max(0, avance)) * total;
  return largos.map(l => {
    const t = Math.min(1, falta / l);
    falta = Math.max(0, falta - l);
    return t;
  });
}

/** Avance de la mano por tiempo: arranca y termina suave, sin saltos de etapa. */
export function avanceDeTiempo(ms, duracion = DURACION) {
  const t = Math.min(1, Math.max(0, ms / duracion));
  return t * t * (3 - 2 * t);
}
