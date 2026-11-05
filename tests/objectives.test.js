import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ObjectiveSystem } from '../src/systems/ObjectiveSystem.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { CAMBUCHE } from '../src/data/cambuche.js';

function fakeGame() {
  const items = [];
  return {
    built: {},
    stats: { dinero: 0 },
    dog: { isFriend: false },
    inventory: {
      items,
      count: (id) => items.find(i => i.id === id)?.qty ?? 0,
      add: (id, qty = 1) => {
        const it = items.find(i => i.id === id);
        if (it) it.qty += qty; else items.push({ id, qty });
      }
    }
  };
}

test('los objetivos tienen ids únicos, texto y destinos válidos', () => {
  const ids = OBJECTIVES.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const def of OBJECTIVES) {
    assert.ok(def.title && def.hint, def.id);
    assert.doesNotMatch(def.title + def.hint, /\p{Extended_Pictographic}/u, `${def.id} sin emojis`);
    if (def.target) assert.ok(['bed', 'sell', 'shop', 'craft', 'dog'].includes(def.target), def.id);
    assert.ok(def.event || def.done || def.progress, `${def.id} necesita una forma de cumplirse`);
  }
  assert.equal(OBJECTIVES.at(-1).goal, CAMBUCHE.length);
});

test('el primer objetivo se cumple con un evento de recolección y avanza uno por vez', () => {
  const game = fakeGame(), sys = new ObjectiveSystem();
  assert.equal(sys.current.id, 'revisar-basura');
  assert.equal(sys.update(game), null);
  assert.equal(sys.notify('pickup', { added: [] }), false, 'una bolsa vacía no cuenta');
  assert.equal(sys.notify('sell', {}), false, 'eventos de otro objetivo no cuentan');
  assert.equal(sys.notify('pickup', { added: ['Cartón'] }), true);
  game.inventory.add('carton', 8);
  assert.equal(sys.update(game).id, 'revisar-basura');
  assert.equal(sys.current.id, 'juntar-carton');
  assert.equal(sys.counter, 0);
  assert.equal(sys.update(game).id, 'juntar-carton');
  assert.equal(sys.current.id, 'armar-base');
});

test('el avance por estado se limita a la meta y se marca completo al cumplirse', () => {
  const game = fakeGame(), sys = new ObjectiveSystem();
  sys.index = OBJECTIVES.findIndex(d => d.id === 'juntar-carton');
  game.inventory.add('carton', 3);
  assert.deepEqual(sys.progress(game), { value: 3, goal: 8 });
  game.inventory.add('carton', 20);
  assert.deepEqual(sys.progress(game), { value: 8, goal: 8 });
  game.inventory.items.length = 0;
  game.built.base = true; // gastó el cartón construyendo
  assert.deepEqual(sys.progress(game), { value: 8, goal: 8 });
});

test('una partida anterior salta en silencio lo que ya cumplió y se detiene en lo pendiente', () => {
  const game = fakeGame(), sys = new ObjectiveSystem();
  game.built.base = true;
  game.inventory.add('pan', 1);
  const skipped = sys.catchUp(game);
  assert.equal(sys.current.id, 'reciclar', 'vender requiere el evento');
  assert.equal(skipped, 3);
  sys.notify('sell', { earned: 500 });
  assert.equal(sys.catchUp(game), 2, 'pan y luego se detiene en El Chato');
  assert.equal(sys.current.id, 'el-chato');
});

test('el guardado conserva el avance por ids e ignora datos dañados', () => {
  const sys = new ObjectiveSystem();
  sys.index = 4; sys.completed = OBJECTIVES.slice(0, 4).map(d => d.id); sys.counter = 0;
  const copy = new ObjectiveSystem();
  assert.equal(copy.deserialize(JSON.parse(JSON.stringify(sys.serialize()))), true);
  assert.equal(copy.current.id, OBJECTIVES[4].id);
  assert.equal(new ObjectiveSystem().deserialize(null), false);
  const legacy = new ObjectiveSystem();
  legacy.deserialize({ index: 999, counter: -3 });
  assert.equal(legacy.finished, true);
  assert.equal(legacy.counter, 0);
  const unknown = new ObjectiveSystem();
  unknown.deserialize({ completed: ['revisar-basura', 'ya-no-existe'] });
  assert.equal(unknown.current.id, 'juntar-carton');
});

test('al terminar la cadena no queda objetivo actual', () => {
  const sys = new ObjectiveSystem([{ id: 'a', title: 'A', hint: 'a', event: 'x', goal: 2 }]);
  const game = fakeGame();
  sys.notify('x'); assert.equal(sys.update(game), null);
  sys.notify('x'); assert.equal(sys.update(game).id, 'a');
  assert.equal(sys.finished, true);
  assert.equal(sys.current, null);
  assert.equal(sys.notify('x'), false);
  assert.equal(sys.update(game), null);
});

test('el juego guarda los objetivos, escucha sus eventos y reparte la recompensa', () => {
  const source = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(source, /objectives: this\.objectives\?\.serialize\(\)/);
  assert.match(source, /this\.objectives\.deserialize\(data\.objectives\)/);
  assert.match(source, /this\.objectives\.notify\(name, e\.detail\)/);
  assert.match(source, /this\._updateObjectives\(dt\)/);
  assert.match(source, /TECLA_RUTA/);
});
