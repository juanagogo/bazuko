// Vuelca los datos del juego web (src) a native/data/game_data.json.
// Aplica las correcciones documentadas en CHANGES.md sobre una copia, sin tocar el juego web.
//   node tools/export_data.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../src');
const load = (p) => import(pathToFileURL(resolve(web, p)).href);

const C = await load('utils/constants.js');
const I = await load('data/items.js');
const R = await load('data/recipes.js');
const T = await load('data/talents.js');
const O = await load('data/origins.js');
const K = await load('data/cambuche.js');
const L = await load('character/look.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- constantes sueltas (todas las exportadas que son números) + tablas ----
const constants = {};
for (const [k, v] of Object.entries(C)) if (typeof v === 'number') constants[k] = v;
const tables = {
  decay: clone(C.DECAY),
  survivalDamage: clone(C.SURVIVAL_DAMAGE),
  statThresholds: clone(C.STAT_THRESHOLDS),
  withdrawal: clone(C.WITHDRAWAL),
  recovery: clone(C.RECOVERY),
  colors: clone(C.COLORS),
};

// ---- ítems ----
const items = Object.values(I.ITEMS).map((it) => ({ ...clone(it), icon: I.itemIcon(it.id) }));
const itemById = new Map(items.map((i) => [i.id, i]));


// ---- enfermedades (antes solo 3 y con 'intoxication' sin tilde de curas) ----
const H = C.DISEASE_HEALTH_DRAIN, M = C.DISEASE_MENTAL_DRAIN, D = C.DISEASE_DURATION;
const diseases = [
  { id: 'gripe',        name: 'Gripe',        emoji: '🤧', healthDrain: H,       mentalDrain: M * 0.5, duration: D },
  { id: 'infeccion',    name: 'Infección',    emoji: '🦠', healthDrain: H * 1.8, mentalDrain: M,       duration: D * 1.2 },
  { id: 'intoxicacion', name: 'Intoxicación', emoji: '🤢', healthDrain: H * 0.8, mentalDrain: M * 1.5, duration: D * 0.8 },
  // FIX: tétanos, sarna y parásitos tenían cura pero no existían como enfermedad.
  { id: 'tetanos',      name: 'Tétanos',      emoji: '🩸', healthDrain: H * 1.5, mentalDrain: M,       duration: D * 1.2 },
  { id: 'sarna',        name: 'Sarna',        emoji: '🐛', healthDrain: H * 0.5, mentalDrain: M * 1.5, duration: D },
  { id: 'parasitos',    name: 'Parásitos',    emoji: '🪱', healthDrain: H * 0.7, mentalDrain: M,       duration: D * 1.1 },
];
for (const it of items) {
  if (it.cure && !diseases.some((d) => d.id === it.cure)) throw new Error(`cura sin enfermedad: ${it.id} -> ${it.cure}`);
}

// ---- recetas ----
// FIX: 5 de 6 recetas apuntaban a ítems inexistentes (arma, mochila, curita, rifa, hierba,
// alambre, tela, plastico). Se dejan solo recetas con ítems reales y coherentes.
const recipes = [
  { id: 'antibiotico', name: 'Antibiótico', emoji: '💊', result: 'antibiotico', qty: 1, ingredients: { pastilla: 1, botella: 1 } },
  { id: 'vendaje',     name: 'Vendajes de lona', emoji: '🩹', result: 'vendaje', qty: 3, ingredients: { lona: 1 } },
  { id: 'carbon',      name: 'Carbón activo', emoji: '⚫', result: 'carbon', qty: 1, ingredients: { madera: 2 } },
];
for (const r of recipes) {
  for (const id of [r.result, ...Object.keys(r.ingredients)]) {
    if (!itemById.has(id)) throw new Error(`receta ${r.id}: ítem inexistente ${id}`);
  }
}

// ---- talentos ----
const talents = Object.values(clone(T.TALENTS));
for (const t of talents) {
  // FIX: surv2 usaba 'diseaseResist' (se sumaba: 1 + 0.6 = más riesgo). Ahora es un multiplicador.
  if (t.effects.diseaseResist !== undefined) {
    t.effects.diseaseResistMult = t.effects.diseaseResist;
    delete t.effects.diseaseResist;
  }
}

// ---- orígenes ----
const origins = Object.entries(clone(O.ORIGINS)).map(([id, o]) => {
  if (o.effects.diseaseResist !== undefined) {
    o.effects.diseaseResistMult = o.effects.diseaseResist; // misma corrección de nombre
    delete o.effects.diseaseResist;
  }
  return { id, ...o };
});

const data = {
  version: 1,
  constants,
  ...tables,
  items,
  lootCommon: clone(I.LOOT_COMMON),
  lootRare: clone(I.LOOT_RARE),
  lootSubstance: clone(I.LOOT_SUBSTANCE),
  shopItems: clone(I.SHOP_ITEMS),
  costalBonus: I.COSTAL_BONUS,
  recipes,
  talents,
  branches: clone(T.BRANCHES),
  origins,
  cambuche: clone(K.CAMBUCHE),
  sleep: clone(K.SLEEP),
  diseases,
  look: {
    palettes: clone(L.PALETTES),
    colorNames: clone(L.COLOR_NAMES),
    styles: clone(L.STYLES),
    defaultLook: clone(L.DEFAULT_LOOK),
    nameIdeas: clone(L.NAME_IDEAS),
  },
};

const out = resolve(here, '../data/game_data.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`OK ${out}: ${items.length} ítems, ${recipes.length} recetas, ${talents.length} talentos, ${diseases.length} enfermedades`);
