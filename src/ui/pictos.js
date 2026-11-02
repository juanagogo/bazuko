// La tabla de dibujos: cada emoji o símbolo que el juego escribe en un texto tiene aquí su dibujo de la letra.
// El dibujo es una letra más: se tiñe con el color del texto, sale de la misma mano y no depende del sistema.
import { DIBUJOS } from './fuentes/dibujos.js';
import { sinTeclas } from '../core/modoEntrada.js';

const RESPALDO = 'carton';

// El emoji, sin selector de variante. `null`: se quita del texto, porque ahí sobra o porque no debe decirse así.
export const PICTOS = {
  // Clima y hora
  '☀': 'sol', '🌞': 'sol', '🌅': 'sol', '🌙': 'luna', '⛅': 'medioNublado', '☁': 'nube', '🌫': 'neblina',
  '🌦': 'llovizna', '🌧': 'aguacero', '⛈': 'tormenta', '🪁': 'viento', '💨': 'viento', '⏳': 'reloj',
  // Lo que se recoge, se come y se vende
  '🥫': 'lata', '🍶': 'botella', '📦': 'carton', '🔩': 'chatarra', '🔌': 'cable', '⛺': 'cambuche', '🪵': 'madera',
  '🛏': 'colchon', '🕯': 'vela', '🍞': 'pan', '💧': 'agua', '🥤': 'refresco', '☕': 'pocillo', '🍵': 'pocillo',
  '🐟': 'lataComida', '🩹': 'vendaje', '🌭': 'morcilla', '🥔': 'papa', '🥟': 'empanada', '⌚': 'reloj',
  '🪙': 'moneda', '💰': 'moneda', '💸': 'moneda', '💎': 'moneda', '💍': 'anillo', '🧼': 'jabon', '🪥': 'cepillo',
  '💊': 'pastilla', '🧪': 'frasco', '🪞': 'retrovisor', '📻': 'radio', '📡': 'radio', '📶': 'radio', '🎸': 'radio',
  '🔋': 'pilas', '💩': 'popo', '🌿': 'hierba', '🎟': 'rifa', '🗡': 'arma', '🔪': 'cuchillo', '🍾': 'botellaPicada',
  '🚬': 'cigarrillo', '🧴': 'pegante',
  // El cuerpo
  '🦠': 'bicho', '🐜': 'bicho', '🪱': 'bicho', '☠': 'bicho', '🤧': 'enfermo', '🤢': 'nauseas', '🥶': 'termometro',
  '😴': 'sueno', '💤': 'sueno',
  // La calle
  '🐕': 'perro', '💀': 'luna', '🧍': 'persona', '🧸': 'persona', '🚶': 'persona', '👀': 'vista', '👊': 'golpe',
  '🧤': 'mano', '🎯': 'centrar', '💾': 'chulo', '🚓': 'patrulla', '🚨': 'sirena', '🎮': 'mando', '📍': 'bandera',
  '🧭': 'flecha', '🔇': 'silencio', '🔊': 'sonido', '🔍': 'lupa', '🔥': 'fogata', '🔨': 'martillo', '🗑': 'basura',
  '⚠': 'peligro', '⚡': 'rayo', '✨': 'brillo', '⭐': 'brillo', '🌟': 'brillo', '♻': 'reciclar',
  // Los sitios
  '🏪': 'tienda', '🏬': 'tienda', '🧺': 'tienda', '🏙': 'edificio', '🏢': 'edificio', '🌊': 'lago', '⛲': 'parque',
  '🌳': 'parque', '⛽': 'gasolina', '🚏': 'bus', '🍬': 'chaza', '🍲': 'comida', '🍴': 'comida', '🛒': 'carreta',
  '🎒': 'costal', '❌': 'cerrar', '🚫': 'cerrar',
  // Símbolos que no son emoji y la letra no trae
  '◎': 'centrar', '⤢': 'ciudad',
  // Se quitan
  '🤮': null, '🤬': null, '😡': null, '🏃': null, '♂': null, '😮': null, '🩸': null, '🚙': null, '🟣': null,
  '🔴': null, '🟢': null, '⚖': null, '🗣': null,
};

// La letra trae estas flechas como signos; no son emoji aunque Unicode las pueda pintar como tales.
const SIGNOS_DE_LA_LETRA = new Set(['↖', '↗', '↘', '↙']);

// Un emoji con todo lo que puede venir pegado: selector de variante, tono de piel y uniones.
const EMOJI = /(?:\p{Extended_Pictographic}|[◎⤢])(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*/gu;

/** El carácter de un dibujo por su nombre. Si no existe, el cartón: nada cae a una letra del sistema. */
export const dibujo = (nombre) => DIBUJOS[nombre] ?? DIBUJOS[RESPALDO];

/** El carácter del dibujo de un emoji, o cadena vacía si ese emoji se quita. Sin tabla, el cartón. */
export function picto(emoji) {
  const base = [...String(emoji).replace(/️/g, '')][0];
  if (Object.hasOwn(PICTOS, base)) return PICTOS[base] === null ? '' : dibujo(PICTOS[base]);
  return dibujo(RESPALDO);
}

const recuerdo = new Map();

/**
 * Pasa un texto de aviso o de lienzo a la letra: cada emoji sale como su dibujo. Devuelve texto plano, para
 * textContent o fillText, y un emoji que no está en la tabla sale como el cartón, nunca como emoji.
 */
export function pasarTexto(entra) {
  const texto = sinTeclas(entra);
  if (typeof texto !== 'string' || !texto) return texto ?? '';
  const guardado = recuerdo.get(texto);
  if (guardado !== undefined) return guardado;
  let quitado = false;
  const paso = texto.replace(EMOJI, (e) => {
    if (SIGNOS_DE_LA_LETRA.has(e[0])) return e;
    const d = picto(e);
    if (!d) quitado = true;
    return d;
  });
  // Lo quitado no deja un hueco de dos espacios ni un espacio al principio.
  const limpio = quitado ? paso.replace(/ {2,}/g, ' ').trim() : paso;
  if (recuerdo.size > 512) recuerdo.clear();
  recuerdo.set(texto, limpio);
  return limpio;
}
