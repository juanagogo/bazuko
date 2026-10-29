// src/ui/itemArt.js
// Iconos de objetos (game-icons.net, CC BY 3.0, créditos en docs/iconos.md).
// Son siluetas en currentColor que el CSS tiñe con `mask-image`; Vite incrusta
// los SVG pequeños en la compilación, así que no generan peticiones extra.
import { ITEMS } from '../data/items.js';

// En la compilación los SVG se vuelven data URI con comillas simples: se codifican
// para no cortar el url('…') del estilo.
const art = (file) => new URL(`./item-art/${file}.svg`, import.meta.url).href.replace(/'/g, '%27');

const ART = {
  radioTransistor: art('radioTransistor'),
  arma: art('arma'),
  cuchillo: art('cuchillo'),
  botella_picada: art('botella_picada'),
  curita: art('curita'),
  antibiotico: art('antibiotico'),
  rifa: art('rifa'),
  hierba: art('hierba'),
  chatarra: art('chatarra'),
  cable: art('cable'),
  pilas: art('pilas'),
  madera: art('madera'),
  botella: art('botella'),
  carton: art('carton'),
  lata: art('lata'),
  pastilla: art('pastilla'),
  yunque: art('yunque')
};

export const hasItemArt = (id) => id in ART;

/** Familia visual del objeto: define el color de su casilla. */
export function itemCategory(id) {
  const item = ITEMS[id];
  if (!item) return 'material';
  if (item.substance) return 'sustancia';
  if (item.cure || item.consumable === 'salud') return 'medico';
  if (item.usable) return 'equipo';
  if (item.rare || id === 'arma' || id === 'rifa') return 'valor';
  return 'material';
}

/** HTML del icono; sin arte propio usa el emoji del catálogo. */
export function itemArtHTML(id, cls = '') {
  const extra = cls ? ` ${cls}` : '';
  if (ART[id]) return `<span class="item-art${extra}" style="--art: url('${ART[id]}')" aria-hidden="true"></span>`;
  return `<span class="item-art item-art--emoji${extra}" aria-hidden="true">${ITEMS[id]?.emoji ?? '📦'}</span>`;
}
