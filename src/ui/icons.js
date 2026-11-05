// Los iconos de la interfaz son dibujos de la letra: se tiñen con el color del texto y pesan lo que pesa una letra.
import { DIBUJOS } from './fuentes/dibujos.js';
import { dibujo } from './pictos.js';

// Los nombres con que el código pide un icono, y el dibujo que le toca a cada uno.
const ICONOS = {
  recycle: 'reciclar', store: 'tienda', droplets: 'agua', moon: 'luna', sun: 'sol', rain: 'aguacero',
  drizzle: 'llovizna', cloud: 'nube', storm: 'tormenta', backpack: 'costal', pause: 'pausa', x: 'cerrar',
  arrow: 'flecha', hand: 'mano', search: 'lupa', bed: 'colchon', tent: 'cambuche', package: 'carton', coins: 'moneda',
  sandwich: 'pan', coffee: 'pocillo', pill: 'pastilla', thermometer: 'termometro', alert: 'peligro',
  bag: 'costal', hammer: 'martillo', flame: 'fogata', run: 'correr', trash: 'basura', sound: 'sonido',
  mute: 'silencio', save: 'chulo', phone: 'radio', watch: 'reloj', water: 'botellaAgua', food: 'comida',
  heart: 'corazon', smile: 'cara', bath: 'jabon', layers: 'carton', box: 'carton', play: 'flecha', check: 'chulo',
  lock: 'candado', bandage: 'vendaje', banknote: 'moneda', bread: 'pan', wrench: 'martillo', map: 'mapa', pin: 'bandera',
  scissors: 'tijeras', shirt: 'camisa', user: 'persona', dice: 'dado', rotl: 'girar-izq', rotr: 'girar-der', sparkles: 'brillo',
  crown: 'brillo', eye: 'vista', idcard: 'cedula', body: 'persona', palette: 'camisa', radio: 'radio',
  'cloud-sun': 'medioNublado', 'cloud-moon': 'nube', fog: 'neblina', wind: 'viento', zap: 'rayo', droplet: 'agua',
  cigarette: 'cigarrillo', clock: 'reloj', settings: 'ajustes', keyboard: 'teclado', chart: 'barras', dog: 'perro',
  info: 'ayuda',
};

/** Vale el nombre de un icono o el de un dibujo directamente. */
export const hasIcon = (name) => Object.hasOwn(ICONOS, name) || Object.hasOwn(DIBUJOS, name);

/** El carácter que le toca a un icono. Sin nombre conocido, el cartón. */
export const iconChar = (name) => dibujo(ICONOS[name] ?? name);

/**
 * Un dibujo listo para poner en la página. El carácter va en un atributo y lo pinta la hoja (.picto):
 * así no entra en el texto del botón que lo lleva, ni para quien lee ni para el lector de pantalla.
 */
export function icon(name, { size = 24 } = {}) {
  const el = document.createElement('span');
  el.setAttribute('class', 'picto');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('style', `--picto:${size}px`);
  el.setAttribute('data-dibujo', iconChar(name));
  return el;
}

export function setIcon(target, name, opts) {
  target.replaceChildren(icon(name, opts));
}
