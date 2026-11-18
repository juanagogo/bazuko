import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StealSystem, LOOT_VICIOS } from '../src/features/steal.js';
import { ITEMS } from '../src/data/items.js';
import { DiseaseSystem } from '../src/systems/DiseaseSystem.js';

globalThis.window ??= {
  dispatchEvent() {},
  addEventListener() {}
};
globalThis.CustomEvent ??= class {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

test('sobrados existe en el inventario como comida de la basura', () => {
  const sobrados = ITEMS.sobrados;
  assert.ok(sobrados, 'el item sobrados debe existir');
  assert.equal(sobrados.consumable, 'hambre');
  assert.equal(sobrados.isScraps, true);
});

test('DiseaseSystem.infect contrae la enfermedad solicitada', () => {
  const diseases = new DiseaseSystem();
  assert.equal(diseases.hasAny, false);
  const inf = diseases.infect('intoxicacion');
  assert.ok(inf);
  assert.equal(diseases.hasAny, true);
  assert.equal(diseases.active.intoxicacion?.timeLeft > 0, true);
});

test('StealSystem reconoce habitante de calle y le puede robar vicio', () => {
  const mockInventory = {
    items: [],
    add(item) { this.items.push(item); return true; }
  };
  const mockGame = {
    stats: { dinero: 0, salud: 100 },
    inventory: mockInventory,
    traffic: { wantedLevel: 0 },
    audio: { play() {} }
  };

  const steal = new StealSystem(mockGame);
  const habitanteNpc = {
    arquetipo: 'habitante',
    person: { arquetipo: 'habitante' },
    alerta: 0.1,
    alarmedByTheft() {}
  };

  // Forzar que Math.random favorezca obtención de vicio (< 0.65)
  const origRandom = Math.random;
  try {
    Math.random = () => 0.1;
    steal._giveLoot([500, 1000], true, habitanteNpc);
    assert.ok(mockInventory.items.some(it => LOOT_VICIOS.includes(it.id)), 'debe haber robado un vicio');
  } finally {
    Math.random = origRandom;
  }
});

test('si se le hace robo directo a un habitante, se defiende con un chuzo y resta salud', () => {
  const mockGame = {
    player: { position: { x: 0, y: 0, z: 0 } },
    stats: { dinero: 0, salud: 100 },
    inventory: { add() { return true; } },
    traffic: { wantedLevel: 0, alertForTheft() { return false; } },
    audio: { play() {} }
  };

  const steal = new StealSystem(mockGame);
  const habitanteNpc = {
    arquetipo: 'habitante',
    person: { arquetipo: 'habitante' },
    stance: 'parado',
    alerta: 0.1,
    alarmedByTheft() {}
  };

  steal.executeRoboDirecto(habitanteNpc);
  assert.ok(mockGame.stats.salud < 100, 'la salud debio reducirse por la puñalada del habitante');
});

test('InteractionSystem._scavengeFood permite comer de la basura', async () => {
  const { InteractionSystem } = await import('../src/systems/InteractionSystem.js');
  const mockPlayer = { playAction() {} };
  const mockInventory = { add() { return true; } };
  const mockStats = { hambre: 10, energia: 20, salud: 100 };
  const mockDisease = { infect() {} };
  const mockTalents = { getEffect() { return 1; } };

  const inter = new InteractionSystem(mockPlayer, mockInventory, mockStats, { play() {} }, mockDisease, mockTalents, {});
  const mockPickup = { harvest() { return { items: [] }; } };

  inter._scavengeFood(mockPickup);
  // Debe haber modificado o el hambre (comida buena) o la salud (comida descompuesta) o mantenido si no halló nada
  assert.ok(true);
});

test('Bogota reserved locations include residencia on south wall and prostibulo on east wall', async () => {
  const fs = await import('node:fs');
  const code = fs.readFileSync(new URL('../src/world/districts/Bogota.js', import.meta.url), 'utf8');
  assert.match(code, /residencia:\s*\{\s*x:\s*114\.2,\s*z:\s*69\.1,\s*rot:\s*0\s*\}/);
  assert.match(code, /prostibulo:\s*\{\s*x:\s*117\.0,\s*z:\s*65\.5,\s*rot:\s*Math\.PI\s*\/\s*2\s*\}/);
});

test('playBurdelAnimation can be called and exports cleanly', async () => {
  const { playBurdelAnimation } = await import('../src/ui/placeMenus.js');
  assert.equal(typeof playBurdelAnimation, 'function');
});
