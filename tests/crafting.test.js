import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECIPES } from '../src/data/recipes.js';
import { ITEMS, LOOT_COMMON, LOOT_SUBSTANCE, SHOP_ITEMS } from '../src/data/items.js';
import { CraftingSystem } from '../src/systems/CraftingSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { DrugDealer } from '../src/entities/DrugDealer.js';

globalThis.window ??= { dispatchEvent() {} };
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const sources = new Set([
  ...LOOT_COMMON.map((l) => l.item),
  ...LOOT_SUBSTANCE.map((l) => l.item),
  ...SHOP_ITEMS.map((s) => s.item).filter(Boolean)
]);

function stocked(recipe, maxWeight = 20) {
  const inventory = new InventorySystem(maxWeight);
  for (const [id, qty] of Object.entries(recipe.ingredients)) inventory.add(ITEMS[id], qty);
  return inventory;
}

test('cada receta usa materiales y resultados que existen y se pueden conseguir', () => {
  for (const recipe of RECIPES) {
    assert.ok(ITEMS[recipe.result], `${recipe.id}: falta el resultado ${recipe.result}`);
    for (const id of Object.keys(recipe.ingredients)) {
      assert.ok(ITEMS[id], `${recipe.id}: falta el material ${id}`);
      assert.ok(sources.has(id), `${recipe.id}: ${id} no sale de basura, tienda ni dealer`);
    }
  }
});

test('todas las recetas se fabrican con sus materiales exactos', () => {
  const crafting = new CraftingSystem();
  for (const recipe of RECIPES) {
    const inventory = stocked(recipe);
    assert.equal(crafting.canCraft(recipe, inventory), true, recipe.id);
    assert.equal(crafting.craft(recipe, inventory)?.id, recipe.result, recipe.id);
    assert.equal(inventory.count(recipe.result), recipe.qty, recipe.id);
    for (const id of Object.keys(recipe.ingredients)) {
      if (id !== recipe.result) assert.equal(inventory.count(id), 0, `${recipe.id}: sobra ${id}`);
    }
  }
});

test('fabricar con el costal lleno descuenta el peso de los ingredientes antes de comprobar el resultado', () => {
  const crafting = new CraftingSystem();
  const recipe = RECIPES.find((r) => r.id === 'arma');
  const inventory = stocked(recipe);
  assert.equal(inventory.add(ITEMS.lata, 78), true);
  assert.equal(inventory.totalWeight, 20);
  const shown = crafting.getAvailable(inventory).find((r) => r.id === 'arma');
  assert.equal(shown.craftable, true);
  assert.equal(shown.fits, true);
  assert.equal(crafting.craft(recipe, inventory)?.id, 'arma');
  assert.equal(inventory.totalWeight, 16.8);
  assert.equal(inventory.count('arma'), 1);
  assert.equal(inventory.count('lata'), 78);
  for (const id of Object.keys(recipe.ingredients)) assert.equal(inventory.count(id), 0);
});

test('si el peso final sigue excediendo el costal no se fabrica ni se pierde ningún objeto', () => {
  const crafting = new CraftingSystem();
  const recipe = RECIPES.find((r) => r.id === 'arma');
  const inventory = stocked(recipe, 140);
  inventory.add(ITEMS.colchon, 4);
  // Soltar la carreta puede dejar una carga mayor que la capacidad del costal.
  inventory.maxWeight = 20;
  const before = structuredClone(inventory.items);
  assert.equal(crafting.craft(recipe, inventory), null);
  assert.deepEqual(inventory.items, before);
  const shown = crafting.getAvailable(inventory).find((r) => r.id === 'arma');
  assert.equal(shown.craftable, true);
  assert.equal(shown.fits, false);
});

test('una receta sin todos sus ingredientes no consume los materiales disponibles', () => {
  const crafting = new CraftingSystem();
  const recipe = RECIPES.find((r) => r.id === 'arma');
  const inventory = stocked(recipe);
  inventory.remove('cable');
  const before = structuredClone(inventory.items);
  assert.equal(crafting.craft(recipe, inventory), null);
  assert.deepEqual(inventory.items, before);
});

test('fabricar sustancias no deja ganancia al revenderlas al dealer con el mejor talento', () => {
  const crafting = new CraftingSystem();
  for (const recipe of RECIPES.filter((r) => ITEMS[r.result].substance)) {
    const cost = Object.entries(recipe.ingredients).reduce((sum, [id, qty]) => sum + ITEMS[id].value * qty, 0);
    const inventory = stocked(recipe);
    crafting.craft(recipe, inventory);
    const { earned } = DrugDealer.prototype.sellSubstances.call({}, inventory, true, 1.3);
    assert.ok(earned < cost, `${recipe.id}: paga ${earned} por materiales de ${cost}`);
  }
});

test('los objetos de la mesa tienen iconos limpios y acreditados', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { hasItemArt, itemArtHTML } = await import('../src/ui/itemArt.js');
  const credits = readFileSync(new URL('../docs/iconos.md', import.meta.url), 'utf8');
  for (const recipe of RECIPES) {
    for (const id of [recipe.result, ...Object.keys(recipe.ingredients)]) {
      assert.ok(hasItemArt(id), `${id} no tiene icono`);
      assert.match(itemArtHTML(id), /item-art" style="--art: url\('[^'"]+\/item-art\/[^'"]+\.svg'\)"/);
    }
  }
  assert.match(itemArtHTML('pegante'), /item-art--dibujo[^>]*data-dibujo="[\uE100-\uE2FF]"/);
  const dir = new URL('../src/ui/item-art/', import.meta.url);
  for (const file of readdirSync(dir)) {
    const svg = readFileSync(new URL(file, dir), 'utf8');
    assert.match(svg, /^<svg [^>]*viewBox="0 0 512 512" fill="currentColor">(<path d="[^"<>]+"\/>)+<\/svg>\s*$/, file);
    // Fila completa: archivo, objeto, enlace al icono original y autor.
    const row = credits.split(/\r?\n/).find((line) => line.startsWith(`| \`${file}\``));
    assert.ok(row, `${file} sin créditos en docs/iconos.md`);
    if (/\| Dibujo propio del proyecto \([^)]+\) \| Equipo del proyecto \|$/.test(row)) continue;
    assert.match(row, /\| \[[^\]]+\]\(https:\/\/game-icons\.net\/1x1\/[a-z0-9-]+\/[a-z0-9-]+\.html\) \| [A-Za-z0-9][A-Za-z0-9 -]* \|$/, `${file}: falta enlace o autor`);
  }
});

test('todo objeto del catálogo tiene icono propio, salvo los que documentan su dibujo', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { hasItemArt, itemArtHTML } = await import('../src/ui/itemArt.js');
  const credits = readFileSync(new URL('../docs/iconos.md', import.meta.url), 'utf8');
  const withoutArt = Object.keys(ITEMS).filter((id) => !hasItemArt(id));
  const section = credits.split('## Objetos sin icono')[1]?.split(/\n\n(?!- )/)[0] ?? '';
  const documented = section.split('\n').filter((line) => line.startsWith('- '))
    .flatMap((line) => [...line.split(':')[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  assert.deepEqual(withoutArt.toSorted(), documented.toSorted(), 'solo los objetos listados en docs/iconos.md usan un dibujo de la letra');
  for (const id of withoutArt) assert.ok(credits.includes(`\`${id}\``), `${id}: explicar en docs/iconos.md por qué usa un dibujo`);
  for (const id of Object.keys(ITEMS).filter(hasItemArt)) {
    const file = itemArtHTML(id).match(/item-art\/([^'"]+\.svg)/)?.[1];
    assert.ok(file && existsSync(new URL(`../src/ui/item-art/${file}`, import.meta.url)), `${id}: falta ${file}`);
    assert.ok(credits.includes(`\`${file}\``), `${id}: ${file} sin créditos`);
  }
});
