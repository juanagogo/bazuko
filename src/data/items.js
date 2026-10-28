
// src/data/items.js
// Valores en pesos colombianos (COP): `value` es lo que pagan por el objeto.

export const ITEMS = {
  // ===== BASURA =====
  lata:     { id: 'lata',     name: 'Lata vacía',    weight: 0.2,  value: 250, rarity: 'common' },
  botella:  { id: 'botella',  name: 'Botella PET',   weight: 0.3,  value: 150 },
  carton:   { id: 'carton',   name: 'Cartón',        weight: 0.5,  value: 200, rarity: 'common' },
  chatarra: { id: 'chatarra', name: 'Chatarra',      weight: 1.0,  value: 900 },
  cable:    { id: 'cable',    name: 'Cable cobre',   weight: 0.4,  value: 2400 },

  // ===== TESOROS =====
  reloj:  { id: 'reloj',  name: 'Reloj oxidado', weight: 0.1,  value: 8000, rare: true },
  moneda: { id: 'moneda', name: 'Moneda vieja',  weight: 0.02, value: 12000, rare: true },
  anillo: { id: 'anillo', name: 'Anillo',        weight: 0.05, value: 20000, rare: true },

  // ===== RADIO Y PILAS =====
  radioTransistor: { id: 'radioTransistor', name: 'Radio transistor AM/FM', weight: 0.6, value: 18000, usable: true },
  pilas: { id: 'pilas', name: 'Pilas AA', weight: 0.1, value: 2000, usable: true },

  // ===== OBJETOS ROBADOS (AUTOS) =====
  retrovisor: { id: 'retrovisor', name: 'Retrovisor',   weight: 0.8, value: 15000 },
  radio:      { id: 'radio',      name: 'Radio auto',   weight: 1.5, value: 35000 },

  // ===== CONSUMIBLES =====
  pan: {
    id: 'pan', name: 'Pan duro', weight: 0.3, value: 1000,
    consumable: 'hambre', amount: 25, animo: 5
  },
  lataComida: {
    id: 'lataComida', name: 'Lata de atún', weight: 0.4, value: 4500,
    consumable: 'hambre', amount: 45, animo: 8
  },
  agua: {
    id: 'agua', name: 'Botella agua', weight: 0.5, value: 1500,
    consumable: 'sed', amount: 35
  },
  refresco: {
    id: 'refresco', name: 'Refresco', weight: 0.4, value: 2500,
    consumable: 'sed', amount: 50, energia: 10, animo: 10
  },
  cafe: {
    id: 'cafe', name: 'Café caliente', weight: 0.3, value: 1500,
    consumable: 'energia', amount: 40, animo: 15
  },
  vendaje: {
    id: 'vendaje', name: 'Vendaje', weight: 0.1, value: 3000,
    consumable: 'salud', amount: 30
  },

  // ===== HIGIENE =====
  jabon: {
    id: 'jabon', name: 'Jabón', weight: 0.2, value: 2500,
    consumable: 'higiene', amount: 40
  },
  cepillo: {
    id: 'cepillo', name: 'Cepillo', weight: 0.1, value: 2000,
    consumable: 'higiene', amount: 20
  },

  // ===== CURAS =====
  vacuna: {
    id: 'vacuna', name: 'Vacuna', weight: 0.1, value: 15000,
    cure: 'tetanos'
  },
  carbon: {
    id: 'carbon', name: 'Carbón activo', weight: 0.1, value: 6000,
    cure: 'intoxicacion'
  },
  jarabe: {
    id: 'jarabe', name: 'Jarabe', weight: 0.2, value: 8000,
    cure: 'gripe'
  },
  pomada: {
    id: 'pomada', name: 'Pomada', weight: 0.15, value: 7000,
    cure: 'sarna'
  },
  antibiotico: {
    id: 'antibiotico', name: 'Antibiótico', weight: 0.1, value: 18000,
    cure: 'infeccion'
  },
  antiparasitario: {
    id: 'antiparasitario', name: 'Antiparasitario', weight: 0.1, value: 9000,
    cure: 'parasitos'
  },

  // ===== SUSTANCIAS =====
  tintico: {
    id: 'tintico', name: 'Tintico', weight: 0.1, value: 1000,
    consumable: 'vicio', amount: 20, animo: 15, energia: 20, substance: true
  },
  pegante: {
    id: 'pegante', name: 'Pegante', weight: 0.2, value: 3000,
    consumable: 'vicio', amount: 40, animo: 25, salud: -3, substance: true
  },
  pastilla: {
    id: 'pastilla', name: 'Pastilla', weight: 0.05, value: 8000,
    consumable: 'vicio', amount: 60, animo: 40, salud: -5, substance: true
  },
  cigarrillo: {
    id: 'cigarrillo', name: 'Cigarrillo suelto', weight: 0.01, value: 300,
    consumable: 'vicio', amount: 35, salud: -1
  },

  // ===== FABRICADOS EN LA MESA =====
  // Valores por debajo o cerca de sus materiales: fabricar da XP, no dinero fácil.
  curita: {
    id: 'curita', name: 'Curita', weight: 0.05, value: 800,
    consumable: 'salud', amount: 12
  },
  hierba: {
    id: 'hierba', name: 'Hierba seca', weight: 0.05, value: 250,
    consumable: 'vicio', amount: 25, salud: -1, substance: true
  },
  rifa:  { id: 'rifa', name: 'Cartón de rifa', weight: 0.02, value: 1500 },
  arma:  { id: 'arma', name: 'Arma casera',    weight: 1.2,  value: 6000 },

  // ===== MATERIALES DEL CAMBUCHE =====
  lona:    { id: 'lona',    name: 'Lona azul',     weight: 2,    value: 4000, build: true, rarity: 'rare' },
  madera:  { id: 'madera',  name: 'Tablas',        weight: 2,    value: 1500, build: true, rarity: 'uncommon' },
  colchon: { id: 'colchon', name: 'Colchón viejo', weight: 6,    value: 5000, build: true, rarity: 'veryRare' },
  vela:    { id: 'vela',    name: 'Vela',          weight: 0.05, value: 500,  build: true, rarity: 'rare' },

  // ===== ARMAS / HERRAMIENTAS =====
  popo: {
    id: 'popo',
    name: 'Mojón de popó',
    weight: 0.3,
    value: 50,
    usable: true,
    desc: 'Proyectil biológico artesanal. Presiona [X] para lanzárselo a los peatones.'
  }
};

export const RARITIES = {
  common: 'Común', uncommon: 'Poco común', rare: 'Raro', veryRare: 'Muy raro'
};
export const itemRarityLabel = id => RARITIES[ITEMS[id]?.rarity] ?? '';

const ITEM_EMOJIS = {
  lata: '🥫', botella: '🍶', carton: '📦', chatarra: '🔩', cable: '🔌',
  lona: '⛺', madera: '🪵', colchon: '🛏️', vela: '🕯️', pan: '🍞',
  agua: '💧', refresco: '🥤', cafe: '☕', lataComida: '🐟', vendaje: '🩹',
  reloj: '⌚', moneda: '🪙', anillo: '💍', jabon: '🧼', cepillo: '🪥',
  retrovisor: '🪞', radio: '📻', radioTransistor: '📻', pilas: '🔋', popo: '💩', cigarrillo: '🚬',
  curita: '🩹', hierba: '🌿', rifa: '🎟️', arma: '🗡️'
};
for (const item of Object.values(ITEMS)) {
  item.emoji = ITEM_EMOJIS[item.id] ?? (item.cure ? '💊' : item.substance ? '🧪' : '📦');
  item.desc ??= item.build ? 'Material para mejorar el cambuche.' : item.consumable ? 'Consumible.' : item.cure ? 'Tratamiento.' : 'Se puede vender.';
}
export const isUsable = item => !!(item?.consumable || item?.cure || item?.usable);
export function describeEffects(item) {
  const lines = [];
  if (item.id === 'radioTransistor') lines.push('Usar: abrir el sintonizador. También con R.');
  if (item.id === 'pilas') lines.push('Usar: recargar 50% de batería de la radio.');
  if (item.id === 'popo') lines.push('Usar o X en la calle: lanzar a un peatón.');
  if (item.consumable) lines.push(`${item.consumable}: +${item.amount}`);
  for (const key of ['hambre', 'sed', 'energia', 'salud', 'higiene', 'animo', 'vicio']) {
    if (item[key]) lines.push(`${key}: ${item[key] > 0 ? '+' : ''}${item[key]}`);
  }
  if (item.cure) lines.push(`Cura: ${item.cure}`);
  const rarity = itemRarityLabel(item.id);
  if (rarity) lines.push(`Rareza: ${rarity}`);
  return lines;
}

/** La recicladora compra todo lo que no se come, no cura, no es sustancia ni sirve para construir */
export const isRecyclable = (item) =>
  !!item && !item.consumable && !item.cure && !item.substance && !item.build && item.id !== 'popo' && item.id !== 'radioTransistor' && item.id !== 'pilas';

// Icono (lucide) para mostrar cada objeto en los menús
const ICONS = {
  lata: 'recycle', botella: 'recycle', carton: 'package', chatarra: 'wrench', cable: 'flame',
  reloj: 'watch', moneda: 'coins', anillo: 'sparkles', retrovisor: 'eye', radio: 'phone', radioTransistor: 'radio', pilas: 'flame',
  pan: 'bread', lataComida: 'food', agua: 'water', refresco: 'water', cafe: 'coffee',
  vendaje: 'bandage', jabon: 'bath', cepillo: 'bath', cigarrillo: 'flame',
  lona: 'tent', madera: 'layers', colchon: 'bed', vela: 'flame', popo: 'alert-triangle',
  curita: 'bandage', hierba: 'flame', rifa: 'dice', arma: 'wrench'
};
export const itemIcon = (id) => ICONS[id] ?? (ITEMS[id]?.cure ? 'pill' : 'box');

// ===== LOOT TABLES =====

export const LOOT_COMMON = [
  { item: 'lata',       weight: 33 },
  { item: 'botella',    weight: 24 },
  { item: 'carton',     weight: 17 },
  { item: 'chatarra',   weight: 8 },
  { item: 'cable',      weight: 4 },
  { item: 'pilas',      weight: 3 },
  { item: 'pan',        weight: 4 },
  { item: 'agua',       weight: 3 },
  { item: 'lataComida', weight: 2 },
  { item: 'vendaje',    weight: 1 },
  { item: 'cigarrillo', weight: 2 },
  { item: 'madera',     weight: 3 },
  { item: 'lona',       weight: 0.6 },
  { item: 'colchon',    weight: 0.4 },
  { item: 'vela',       weight: 0.8 },
  // Sustancias: poco frecuentes porque el dealer las compra caras (la pastilla, muy rara)
  { item: 'pegante',    weight: 1.0 },
  { item: 'hierba',     weight: 1.5 },
  { item: 'pastilla',   weight: 0.3 }
];

export const LOOT_RARE = [
  { item: 'reloj',  weight: 55 },
  { item: 'moneda', weight: 30 },
  { item: 'anillo', weight: 15 }
];

export const LOOT_SUBSTANCE = [
  { item: 'tintico',  weight: 50 },
  { item: 'pegante',  weight: 30 },
  { item: 'pastilla', weight: 20 }
];

// ===== TIENDA LA ESQUINITA (precios en COP) =====

export const SHOP_ITEMS = [
  { item: 'pan',        price: 1500 },
  { item: 'lataComida', price: 6000 },
  { item: 'agua',       price: 2000 },
  { item: 'refresco',   price: 3500 },
  { item: 'cafe',       price: 2000, desc: 'Un tinto caliente: quita el sueño.' },
  { item: 'cigarrillo', price: 500,  desc: 'Calma el vicio. Le quita un poquito a la salud.' },
  { item: 'vendaje',    price: 4500 },
  { item: 'jabon',      price: 3500 },
  { item: 'cepillo',    price: 3000 },
  { item: 'jarabe',     price: 11000 },
  { item: 'pomada',     price: 9500 },
  { item: 'carbon',     price: 9000 },
  { item: 'antiparasitario', price: 13000 },
  { item: 'vacuna',     price: 20000 },
  { item: 'antibiotico', price: 25000 },
  { item: 'vela',       price: 1000, desc: 'Ilumina el cambuche: duermes más tranquilo.' },
  { item: 'lona',       price: 9000, desc: 'Para el techo del cambuche.' },
  { item: 'madera',     price: 6000, qty: 3, label: 'Tablas ×3', desc: 'Para las paredes del cambuche.' },
  { item: 'pilas',           price: 2000,  desc: 'Pilas AA: recargan la radio transistor.' },
  { item: 'radioTransistor', price: 18000, desc: 'Radio transistor: sintoniza emisoras y calma la mente.' },
  { upgrade: 'costal',  price: 12000, label: 'Costal grande', icon: 'backpack', desc: 'Cargas 20 kg más.' }
];

export const COSTAL_BONUS = 20;
