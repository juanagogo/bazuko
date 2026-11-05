// Bajo la lluvia el cartón se oscurece: lo único que cambia es --cara, a través de body.mojado (ver base.css).
// Con holgura entre mojarse y secarse, para que no vaya y venga cuando la humedad ronda el corte.
const SE_MOJA = .4;
const SE_SECA = .25;

let mojado = false;

/** Se llama en cada cuadro con la humedad de la calle, de 0 a 1. Solo toca la página cuando cambia. */
export function mojarCarton(humedad) {
  const ahora = mojado ? humedad >= SE_SECA : humedad >= SE_MOJA;
  if (ahora === mojado) return mojado;
  mojado = ahora;
  globalThis.document?.body?.classList?.toggle('mojado', mojado);
  return mojado;
}
