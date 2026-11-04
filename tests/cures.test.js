import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { DISEASES } from '../src/data/diseases.js';
import { ITEMS, SHOP_ITEMS } from '../src/data/items.js';
import { DiseaseSystem } from '../src/systems/DiseaseSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem, NEEDS } from '../src/systems/StatsSystem.js';
import { HUD } from '../src/ui/HUD.js';
import { DISEASE_DURATION, STAT_THRESHOLDS } from '../src/utils/constants.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture() {
  const stats = new StatsSystem();
  for (const need of NEEDS) stats[need] = 45;
  const diseases = new DiseaseSystem();
  const inventory = new InventorySystem();
  const toasts = [];
  window.__game = { stats, diseases, inventory, audio: { play() {} } };
  const hud = Object.assign(Object.create(HUD.prototype), { _toast: (text) => toasts.push(text), _renderInventory() {} });
  return { stats, diseases, inventory, hud, toasts };
}

const sick = (diseases, id) => diseases.deserialize({ active: { [id]: { timeLeft: 30 } } });

test('cada remedio cura una enfermedad que existe y cada enfermedad tiene remedio en la tienda', () => {
  for (const item of Object.values(ITEMS).filter((i) => i.cure)) {
    assert.ok(DISEASES[item.cure], `${item.id} cura «${item.cure}», que no existe`);
  }
  const sold = new Set(SHOP_ITEMS.map((entry) => ITEMS[entry.item]?.cure).filter(Boolean));
  for (const id of Object.keys(DISEASES)) assert.ok(sold.has(id), `${id} no tiene remedio en la tienda`);
});

test('la aguapanela quita la sed y cura la gripe', () => {
  const { stats, diseases, inventory, hud, toasts } = fixture();
  sick(diseases, 'gripe');
  inventory.add(ITEMS.aguapanela, 1);
  hud._useItem('aguapanela', inventory);
  assert.equal(diseases.hasAny, false);
  assert.equal(stats.sed, 45 + ITEMS.aguapanela.amount);
  assert.equal(inventory.count('aguapanela'), 0);
  assert.match(toasts.at(-1), /me curé: Gripe/);
});

test('sin gripe, la aguapanela se toma como cualquier bebida y se gasta', () => {
  const { stats, inventory, hud, toasts } = fixture();
  inventory.add(ITEMS.aguapanela, 1);
  hud._useItem('aguapanela', inventory);
  assert.equal(stats.sed, 45 + ITEMS.aguapanela.amount);
  assert.equal(inventory.count('aguapanela'), 0);
  assert.doesNotMatch(toasts.at(-1), /me curé/);
});

test('cada remedio de la tienda cura su enfermedad y se gasta', () => {
  for (const item of Object.values(ITEMS).filter((i) => i.cure && !i.consumable)) {
    const { diseases, inventory, hud } = fixture();
    sick(diseases, item.cure);
    inventory.add(item, 1);
    hud._useItem(item.id, inventory);
    assert.equal(diseases.hasAny, false, `${item.id} no curó ${item.cure}`);
    assert.equal(inventory.count(item.id), 0);
  }
});

test('el carbón activo cura la intoxicación', () => {
  const { diseases, inventory, hud } = fixture();
  sick(diseases, 'intoxicacion');
  inventory.add(ITEMS.carbon, 1);
  hud._useItem('carbon', inventory);
  assert.equal(diseases.hasAny, false);
});

test('un remedio sin la enfermedad no se gasta', () => {
  const { inventory, hud, toasts } = fixture();
  const sounds = [];
  window.__game.audio.play = (id) => sounds.push(id);
  inventory.add(ITEMS.pomada, 1);
  hud._useItem('pomada', inventory);
  assert.equal(inventory.count('pomada'), 1);
  assert.match(toasts.at(-1), /No tengo sarna/);
  assert.deepEqual(sounds, ['empty']);
});

test('la basura no da tétanos ni sarna; cortarse con metal puede dar tétanos', (t) => {
  const seen = (cut) => {
    const found = new Set();
    for (let i = 0; i < 40; i++) {
      let call = 0;
      // primera tirada: se enferma; segunda: recorre todo el abanico de enfermedades posibles
      t.mock.method(Math, 'random', () => (call++ === 0 ? 0 : (i + 0.5) / 40));
      found.add(new DiseaseSystem().tryInfect(false, 1, { cut })?.id);
    }
    return found;
  };
  const trash = seen(false), cut = seen(true);
  assert.ok(trash.has('parasitos'));
  assert.ok(!trash.has('tetanos') && !trash.has('sarna'));
  assert.ok(cut.has('tetanos'));
  assert.ok(!cut.has('sarna'));
});

test('sacar latas o chatarra de la basura trae riesgo de tétanos; una botella no', () => {
  const options = [];
  const interaction = new InteractionSystem({ position: new THREE.Vector3() }, new InventorySystem(), new StatsSystem(),
    { play() {} }, { tryInfect: (_sorted, _resist, opts) => options.push(opts) }, { getEffect: (_key, base) => base }, null);
  for (const items of [['lata'], ['chatarra', 'botella'], ['botella']]) {
    interaction._harvestTrash({ harvest: () => ({ items, sorted: false }) }, false);
  }
  assert.deepEqual(options, [{ cut: true }, { cut: true }, { cut: false }]);
});

test('dormir sucio puede pegar sarna; dormir bañado nunca', (t) => {
  t.mock.method(Math, 'random', () => 0);
  assert.equal(new DiseaseSystem().tryInfectWhileSleeping(STAT_THRESHOLDS.higieneEnfermedad - 1)?.id, 'sarna');
  assert.equal(new DiseaseSystem().tryInfectWhileSleeping(STAT_THRESHOLDS.higieneEnfermedad), null);
  t.mock.method(Math, 'random', () => 0.99);
  assert.equal(new DiseaseSystem().tryInfectWhileSleeping(0), null, 'no pasa todas las noches');
});

test('dormir en el cambuche con la higiene baja revisa la sarna antes de guardar', (t) => {
  t.mock.method(globalThis, 'setTimeout', () => 0);
  t.mock.method(Math, 'random', () => 0);
  const sleep = (higiene) => {
    const stats = new StatsSystem();
    stats.higiene = higiene;
    let saved = null;
    const game = Object.assign(Object.create(Game.prototype), {
      isSleeping: false, built: { base: true }, dog: null,
      player: { position: new THREE.Vector3(), playAction() {} },
      clock: { isNight: false, hour: 12, day: 1 },
      stats, inventory: new InventorySystem(), diseases: new DiseaseSystem(),
      _save() { saved = structuredClone(this.diseases.serialize()); }
    });
    game.sleep();
    return saved;
  };
  assert.ok(sleep(10).active.sarna, 'la sarna queda en el guardado');
  assert.deepEqual(sleep(80).active, {});
});

test('parásitos, tétanos y sarna no se pasan solos en un minuto y molestan hasta tratarlos', () => {
  const diseases = new DiseaseSystem();
  diseases.deserialize({ active: { parasitos: { timeLeft: 1 }, tetanos: { timeLeft: 1 }, sarna: { timeLeft: 1 } } });
  const fx = diseases.getAggregatedEffects();
  assert.ok(fx.hungerDrainMultiplier > 1, 'los parásitos se comen la comida');
  assert.ok(fx.speedMultiplier < 1, 'el tétanos entiesa');
  assert.ok(fx.energyDrainMultiplier > 1, 'la sarna no deja descansar');
  for (const id of ['parasitos', 'tetanos', 'sarna']) assert.ok(DISEASES[id].duration >= 5 * DISEASE_DURATION, id);
});

test('las partidas viejas conservan la intoxicación guardada con el id en inglés', () => {
  const diseases = new DiseaseSystem();
  diseases.deserialize({ active: { intoxication: { timeLeft: 12 } } });
  assert.deepEqual(diseases.active, { intoxicacion: { timeLeft: 12 } });
});
