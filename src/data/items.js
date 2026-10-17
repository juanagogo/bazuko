
 // src/data/items.js

export const ITEMS = {
  // ===== BASURA =====
  lata:     { id: 'lata',     name: 'Lata vacía',    weight: 0.2,  value: 1 },
  botella:  { id: 'botella',  name: 'Botella PET',   weight: 0.3,  value: 2 },
  carton:   { id: 'carton',   name: 'Cartón',        weight: 0.5,  value: 3 },
  chatarra: { id: 'chatarra', name: 'Chatarra',      weight: 1.0,  value: 5 },
  cable:    { id: 'cable',    name: 'Cable cobre',   weight: 0.4,  value: 8 },

  // ===== TESOROS =====
  reloj:  { id: 'reloj',  name: 'Reloj oxidado', weight: 0.1,  value: 25, rare: true },
  moneda: { id: 'moneda', name: 'Moneda vieja',  weight: 0.02, value: 40, rare: true },
  anillo: { id: 'anillo', name: 'Anillo',        weight: 0.05, value: 60, rare: true },

  // ===== OBJETOS ROBADOS (AUTOS) =====
  retrovisor: { id: 'retrovisor', name: 'Retrovisor',   weight: 0.3, value: 6, stack: 10 }, // se roba a autos detenidos; ~$6 en la Tienda
  radio:      { id: 'radio',      name: 'Radio auto',   weight: 1.5, value: 35 },

  // ===== CONSUMIBLES =====
  pan: {
    id: 'pan', name: 'Pan duro', weight: 0.3, value: 4,
    consumable: 'hambre', amount: 25, animo: 5
  },
  lataComida: {
    id: 'lataComida', name: 'Lata de atún', weight: 0.4, value: 8,
    consumable: 'hambre', amount: 45, animo: 8
  },
  agua: {
    id: 'agua', name: 'Botella agua', weight: 0.5, value: 3,
    consumable: 'sed', amount: 35
  },
  refresco: {
    id: 'refresco', name: 'Refresco', weight: 0.4, value: 5,
    consumable: 'sed', amount: 50, energia: 10, animo: 10
  },
  cafe: {
    id: 'cafe', name: 'Café caliente', weight: 0.3, value: 6,
    consumable: 'energia', amount: 40, animo: 15
  },
  vendaje: {
    id: 'vendaje', name: 'Vendaje', weight: 0.1, value: 15,
    consumable: 'salud', amount: 30
  },

  // ===== HIGIENE =====
  jabon: {
    id: 'jabon', name: 'Jabón', weight: 0.2, value: 12,
    consumable: 'higiene', amount: 40
  },
  cepillo: {
    id: 'cepillo', name: 'Cepillo', weight: 0.1, value: 8,
    consumable: 'higiene', amount: 20
  },

  // ===== CURAS =====
  vacuna: {
    id: 'vacuna', name: 'Vacuna', weight: 0.1, value: 40,
    cure: 'tetanos'
  },
  carbon: {
    id: 'carbon', name: 'Carbón activo', weight: 0.1, value: 25,
    cure: 'intoxicacion'
  },
  jarabe: {
    id: 'jarabe', name: 'Jarabe', weight: 0.2, value: 20,
    cure: 'gripe'
  },
  pomada: {
    id: 'pomada', name: 'Pomada', weight: 0.15, value: 18,
    cure: 'sarna'
  },
  antibiotico: {
    id: 'antibiotico', name: 'Antibiótico', weight: 0.1, value: 45,
    cure: 'infeccion'
  },
  antiparasitario: {
    id: 'antiparasitario', name: 'Antiparasitario', weight: 0.1, value: 30,
    cure: 'parasitos'
  },

  // ===== SUSTANCIAS =====
  tintico: {
    id: 'tintico', name: 'Tintico', weight: 0.1, value: 5,
    consumable: 'animo', amount: 30, energia: 20, substance: true
  },
  pegante: {
    id: 'pegante', name: 'Pegante', weight: 0.2, value: 8,
    consumable: 'animo', amount: 40, substance: true
  },
  pastilla: {
    id: 'pastilla', name: 'Pastilla', weight: 0.05, value: 15,
    consumable: 'animo', amount: 60, substance: true
  }
};

// ===== LOOT TABLES =====

export const LOOT_COMMON = [
  { item: 'lata',       weight: 33 },
  { item: 'botella',    weight: 24 },
  { item: 'carton',     weight: 17 },
  { item: 'chatarra',   weight: 8 },
  { item: 'cable',      weight: 4 },
  { item: 'pan',        weight: 4 },
  { item: 'agua',       weight: 3 },
  { item: 'lataComida', weight: 2 },
  { item: 'vendaje',    weight: 1 }
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

// ===== TIENDA =====

export const SHOP_ITEMS = [
  // Consumibles
  { item: 'pan',        buyPrice: 6 },
  { item: 'agua',       buyPrice: 5 },
  { item: 'lataComida', buyPrice: 12 },
  { item: 'refresco',   buyPrice: 8 },
  { item: 'cafe',       buyPrice: 10 },
  { item: 'vendaje',    buyPrice: 25 },

  // Higiene
  { item: 'jabon',   buyPrice: 15 },
  { item: 'cepillo', buyPrice: 10 },

  // Curas
  { item: 'vacuna',          buyPrice: 50 },
  { item: 'carbon',          buyPrice: 30 },
  { item: 'jarabe',          buyPrice: 25 },
  { item: 'pomada',          buyPrice: 22 },
  { item: 'antibiotico',     buyPrice: 55 },
  { item: 'antiparasitario', buyPrice: 38 },

  // Sustancias
  { item: 'tintico',  buyPrice: 5 },
  { item: 'pegante',  buyPrice: 8 },
  { item: 'pastilla', buyPrice: 15 }
];


// ===== METADATOS DE INVENTARIO (icono, descripción, stack) =====

const ITEM_META = {
  lata:        { emoji: '🥫', desc: 'Una lata aplastada. Se vende por kilo.' },
  botella:     { emoji: '🍼', desc: 'Plástico reciclable.' },
  carton:      { emoji: '📦', desc: 'Cartón seco, siempre hay quien lo compre.' },
  chatarra:    { emoji: '🔩', desc: 'Metal viejo. Pesa, pero paga.' },
  cable:       { emoji: '🔌', desc: 'Cobre pelado, bien cotizado.' },
  reloj:       { emoji: '⌚', desc: 'Oxidado pero todavía vale algo.' },
  moneda:      { emoji: '🪙', desc: 'Moneda antigua de coleccionista.' },
  anillo:      { emoji: '💍', desc: 'Brilla incluso sucio.' },
  retrovisor:  { emoji: '🪞', desc: 'Retrovisor robado a un auto detenido. Se vende en la Tienda.' },
  radio:       { emoji: '📻', desc: 'Radio de auto, se vende bien.' },
  pan:         { emoji: '🍞', desc: 'Duro, pero llena el estómago.' },
  lataComida:  { emoji: '🐟', desc: 'Atún en lata. Comida sólida.' },
  agua:        { emoji: '💧', desc: 'Agua para la sed.' },
  refresco:    { emoji: '🥤', desc: 'Dulce y con cafeína.' },
  cafe:        { emoji: '☕', desc: 'Caliente: despierta y anima.' },
  vendaje:     { emoji: '🩹', desc: 'Cierra heridas y recupera salud.' },
  jabon:       { emoji: '🧼', desc: 'Para quitarte la mugre.' },
  cepillo:     { emoji: '🪥', desc: 'Higiene básica.' },
  vacuna:      { emoji: '💉', desc: 'Cura el tétanos.' },
  carbon:      { emoji: '⚫', desc: 'Cura la intoxicación.' },
  jarabe:      { emoji: '🍯', desc: 'Cura la gripe.' },
  pomada:      { emoji: '🧴', desc: 'Cura la sarna.' },
  antibiotico: { emoji: '💊', desc: 'Cura la infección.' },
  antiparasitario: { emoji: '🪱', desc: 'Cura los parásitos.' },
  tintico:     { emoji: '☕', desc: 'Sustancia: ánimo y energía. Se revende al dealer.' },
  pegante:     { emoji: '🧪', desc: 'Sustancia: sube el ánimo de golpe. Se revende al dealer.' },
  pastilla:    { emoji: '💊', desc: 'Sustancia: ánimo intenso. Se revende al dealer.' }
};

// Fusiona en ITEMS (emoji, desc) para que cualquier sistema los lea del mismo sitio
for (const id of Object.keys(ITEMS)) {
  const m = ITEM_META[id];
  ITEMS[id].emoji = m?.emoji ?? '📦';
  ITEMS[id].desc = m?.desc ?? '';
}

/** ¿Se puede usar/consumir desde el inventario? */
export function isUsable(def) {
  return !!(def && (def.consumable || def.cure));
}

/** Máximo de unidades por casilla (def.stack tiene prioridad) */
export function getStackMax(def) {
  if (!def) return 1;
  if (def.stack) return def.stack;
  if (def.rare) return 5;
  if (def.consumable || def.cure) return 10;
  return 20;
}

const STAT_LABELS = {
  hambre: '🍖 Hambre', sed: '💧 Sed', energia: '⚡ Energía', salud: '🩹 Salud',
  higiene: '🧼 Higiene', animo: '🧠 Ánimo'
};

/** Líneas de efecto legibles para tooltip/detalle */
export function describeEffects(def) {
  const out = [];
  if (!def) return out;
  if (def.consumable) {
    out.push(`${STAT_LABELS[def.consumable] ?? def.consumable} +${def.amount}`);
    if (def.animo && def.consumable !== 'animo') out.push(`${STAT_LABELS.animo} +${def.animo}`);
    if (def.energia && def.consumable !== 'energia') out.push(`${STAT_LABELS.energia} +${def.energia}`);
  }
  if (def.cure) out.push(`✨ Cura: ${def.cure}`);
  if (def.substance) out.push('⚠️ Sustancia');
  return out;
}
