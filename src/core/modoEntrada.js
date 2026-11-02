// src/core/modoEntrada.js
// Con qué se está jugando ahora: teclado y ratón, el dedo o un mando. De eso dependen dos cosas: si se ven los controles
// táctiles (`body.tactil`) y qué nombre recibe cada acción en los textos. Sin DOM también funciona.

let modo = 'teclado';
let fijo = false;

export const modoEntrada = () => modo;

/** `fijar` es para `?tactil=1`: a partir de ahí nada lo cambia. */
export function ponerModo(nuevo, { fijar = false } = {}) {
  if (fijar) fijo = true;
  else if (fijo) return false;
  if (nuevo === modo) return false;
  modo = nuevo;
  const clases = globalThis.document?.body?.classList;
  clases?.toggle?.('tactil', nuevo === 'tactil');
  clases?.toggle?.('mando', nuevo === 'mando');
  repintarTeclas();
  globalThis.window?.dispatchEvent?.(new CustomEvent('modo-entrada', { detail: { modo: nuevo } }));
  return true;
}

/** La misma tecla con el nombre del botón que la produce (`BUTTON_KEYS` de Gamepad.js). */
export const TECLA_EN_MANDO = {
  E: 'A', Q: 'X', I: 'Y', V: 'LB', G: 'RB', M: 'View', N: 'R3', R: 'Arriba', X: 'Abajo', B: 'Izquierda', F: 'Derecha', Esc: 'B', Espacio: 'LT', Shift: 'RT',
  // Sostener LB cambia lo que hacen la cruceta, A, X y Y (`CON_LB` de Gamepad.js).
  C: 'LB+Y', T: 'LB+X', 1: 'LB+↑', 2: 'LB+→', 3: 'LB+↓', 4: 'LB+←', 5: 'LB+A',
};

/** Lo que dice la celda de la tecla: con mando dice su botón, y si no, la tecla de siempre. */
export function teclaVisible(tecla) {
  if (modo !== 'mando') return tecla;
  return String(tecla).split(' / ').map((t) => TECLA_EN_MANDO[t] ?? t).join(' / ');
}

/** La tecla del cierre de un menú: con teclado, la suya; con mando, B cierra cualquiera. */
export const teclaDeCierre = (tecla) => (modo === 'mando' ? TECLA_EN_MANDO.Esc : tecla);

/** Las teclas escritas en la página (`data-k`) se vuelven a escribir al cambiar con qué se juega. */
function repintarTeclas() {
  globalThis.document?.querySelectorAll?.('[data-k]').forEach((k) => {
    k.textContent = teclaVisible(modo === 'mando' ? k.dataset.kMando ?? k.dataset.k : k.dataset.k);
  });
}

// Primero las frases hechas, y al final el atajo entre paréntesis. El dedo nunca lee «Shift».
const PARA_EL_DEDO = [
  [/WASD para nadar, Shift para acelerar/g, 'La palanca mueve, Correr acelera'],
  [/\(Shift\)/g, 'con el botón Correr'],
  [/con Shift/g, 'con el botón Correr'],
  [/Oprima \[X\] para (lanzarlo|lanzárselo)/g, 'Con Lanzar, en Más, se puede $1'],
  [/Haga clic en el mapa o elija/g, 'Toque el mapa o elija'],
  [/con clic o G\b/g, 'con Pegar'],
  [/Arrastrar o flechas: girar\. Rueda: acercar\./g, 'Arrastre para girar.'],
  [/Usar o X en la calle:/g, 'Usar:'],
  [/ También con [A-Z]\./g, ''],
  [/Tecla (\d)/g, 'Casilla $1'],
  [/tecla (\d)/g, 'casilla $1'],
  [/ con [A-Z]\b(?!\p{L})/gu, ''],
  [/Haga clic en/g, 'Toque'],
  [/haga clic en/g, 'toque'],
  [/Enter o doble clic: [^.]*/g, ''],
  [/\s*\((?:[A-Z]|F\d|Esc|Tab)(?: o (?:[A-Z]|F\d|Esc|Tab))*\)/g, ''],
];
const PARA_EL_MANDO = [
  [/WASD para nadar, Shift para acelerar/g, 'El stick mueve, RT acelera'],
  [/\[X\]/g, '[Abajo]'],
  [/con clic o G\b/g, 'con RB'],
  [/Arrastrar o flechas: girar\. Rueda: acercar\./g, 'Stick derecho: girar.'],
  [/Usar o X en la calle:/g, 'Usar o Abajo en la calle:'],
  [/También con ([A-Z])\./g, (_, t) => `También con ${TECLA_EN_MANDO[t]}.`],
  [/\b[Tt]ecla (\d)/g, 'Casilla $1'],
  [/\bShift\b/g, 'RT'],
  [/ con ([EQIVGMNRXBF])\b(?!\p{L})/gu, (_, t) => ` con ${TECLA_EN_MANDO[t]}`],
];

/** Un texto del juego, sin nombrar teclas que quien juega no tiene. Con teclado sale igual. */
export function sinTeclas(texto) {
  if (modo === 'teclado' || typeof texto !== 'string') return texto;
  let salida = texto;
  for (const [patron, cambio] of modo === 'tactil' ? PARA_EL_DEDO : PARA_EL_MANDO) salida = salida.replace(patron, cambio);
  return salida;
}
