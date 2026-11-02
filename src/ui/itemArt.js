// src/ui/itemArt.js
// Iconos de objetos (game-icons.net, CC BY 3.0, créditos en docs/iconos.md).
// Son siluetas en currentColor que la hoja recorta con `mask-image`; Vite incrusta
// los SVG pequeños en la compilación, así que no generan peticiones extra.
// La mesa de fabricación y el inventario comparten iconos, familias y textos.
import { ITEMS, itemIcon } from '../data/items.js';
import { diseaseName } from '../data/diseases.js';
import { NEEDS } from '../systems/StatsSystem.js';
import { cop } from '../utils/money.js';
import { conComa, conSigno } from '../utils/numeros.js';
import { iconChar } from './icons.js';

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
  reloj: art('reloj'),
  moneda: art('moneda'),
  anillo: art('anillo'),
  retrovisor: art('retrovisor'),
  radio: art('radio'),
  pan: art('pan'),
  lataComida: art('lataComida'),
  agua: art('agua'),
  refresco: art('refresco'),
  cafe: art('cafe'),
  tintico: art('tintico'),
  vendaje: art('vendaje'),
  jabon: art('jabon'),
  cepillo: art('cepillo'),
  vacuna: art('vacuna'),
  carbon: art('carbon'),
  jarabe: art('jarabe'),
  pomada: art('pomada'),
  antiparasitario: art('antiparasitario'),
  cigarrillo: art('cigarrillo'),
  lona: art('lona'),
  colchon: art('colchon'),
  vela: art('vela'),
  popo: art('popo'),
  yunque: art('yunque'),
  costal: art('costal')
};

export const hasItemArt = (id) => id in ART;

/** Familia del objeto: la casilla la lleva como clase, para reconocerla. */
export function itemCategory(id) {
  const item = ITEMS[id];
  if (!item) return 'material';
  if (item.substance || item.consumable === 'vicio') return 'sustancia';
  if (item.cure || item.consumable === 'salud' || item.consumable === 'higiene') return 'medico';
  if (item.consumable) return 'comida';
  if (item.usable) return 'equipo';
  if (item.rare || id === 'arma' || id === 'rifa') return 'valor';
  return 'material';
}

/** HTML del icono; sin arte propio usa su dibujo de la letra. */
export function itemArtHTML(id, cls = '') {
  const extra = cls ? ` ${cls}` : '';
  if (ART[id]) return `<span class="item-art${extra}" style="--art: url('${ART[id]}')" aria-hidden="true"></span>`;
  return `<span class="item-art item-art--dibujo picto${extra}" data-dibujo="${iconChar(itemIcon(id))}" aria-hidden="true"></span>`;
}

const NEED_LABELS = { hambre: 'hambre', sed: 'sed', energia: 'energía', salud: 'salud', higiene: 'higiene', animo: 'ánimo', vicio: 'vicio' };

/**
 * Una línea con lo que hace el objeto, a partir de sus datos reales.
 * Sin efectos, recuerda para qué sirve; `weight` añade el peso al final.
 */
export function itemEffectLine(item, { weight = true, fallback = true } = {}) {
  if (!item) return '';
  const parts = [];
  if (item.consumable) parts.push(`+${item.amount} ${NEED_LABELS[item.consumable]}`);
  for (const k of NEEDS) {
    if (k !== item.consumable && item[k]) parts.push(`${conSigno(item[k])} ${NEED_LABELS[k]}`);
  }
  if (item.cure) parts.push(`Cura: ${diseaseName(item.cure)}`);
  if (!parts.length && fallback) parts.push(item.usable ? 'Se usa desde el costal' : `Se vende por ${cop(item.value)}`);
  if (weight) parts.push(`${conComa(item.weight)} kg`);
  return parts.join(', ');
}
