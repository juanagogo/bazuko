// src/core/PantallaCompleta.js
// Pantalla completa en el navegador: la misma orden desde la pausa y desde el dedo del celular.

/** ¿Este navegador deja pedir pantalla completa? En los móviles que no la dan, el juego se instala desde el menú. */
export function puedePantallaCompleta(doc = globalThis.document) {
  return !!doc?.documentElement?.requestFullscreen;
}

export function enPantallaCompleta(doc = globalThis.document) {
  return !!doc?.fullscreenElement;
}

/** Alterna la pantalla completa. Sin soporte del navegador no hace nada. */
export function alternarPantallaCompleta(doc = globalThis.document) {
  if (!puedePantallaCompleta(doc)) return;
  const pedido = doc.fullscreenElement ? doc.exitFullscreen?.() : doc.documentElement.requestFullscreen();
  // Una negativa del navegador no debe reventar el cuadro: solo se queda sin pantalla completa.
  pedido?.catch?.(() => {});
}
