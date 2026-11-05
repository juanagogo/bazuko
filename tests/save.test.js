import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveSystem, AUTOSAVE_INTERVAL } from '../src/systems/SaveSystem.js';

const memoryStorage = () => {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); }
  };
};

test('guarda y carga la partida con versión y fecha', () => {
  const save = new SaveSystem(memoryStorage());
  assert.equal(save.save({ stats: { dinero: 5000 } }), true);
  const data = save.load();
  assert.equal(data.stats.dinero, 5000);
  assert.equal(data.v, 2);
  assert.equal(typeof data.savedAt, 'number');
});

test('una partida dañada se recupera desde el respaldo sin lanzar errores', () => {
  const storage = memoryStorage();
  const save = new SaveSystem(storage);
  save.save({ stats: { dinero: 1000 } });
  save.save({ stats: { dinero: 2000 } });
  storage.setItem('habitante-de-calle-save-v1', '{"stats": {"dinero": 30');
  const data = save.load();
  assert.equal(data.stats.dinero, 1000);
  assert.equal(save.restoredFromBackup, true);
});

test('un guardado dañado no sobrescribe el respaldo bueno', () => {
  const storage = memoryStorage();
  const save = new SaveSystem(storage);
  save.save({ stats: { dinero: 1000 } });
  save.save({ stats: { dinero: 2000 } });
  storage.setItem('habitante-de-calle-save-v1', 'basura');
  save.save({ stats: { dinero: 3000 } });
  assert.equal(JSON.parse(storage.getItem('habitante-de-calle-save-v1-respaldo')).stats.dinero, 1000);
});

test('sin partida devuelve null y sin almacenamiento no falla', () => {
  assert.equal(new SaveSystem(memoryStorage()).load(), null);
  const none = new SaveSystem(null);
  assert.equal(none.save({}), false);
  assert.equal(none.load(), null);
  none.clear();
});

test('la cuota llena devuelve false en lugar de romper el juego', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const save = new SaveSystem(storage);
  assert.equal(save.save({ stats: {} }), false);
  assert.match(save.lastError.message, /Quota/);
});

test('las partidas v1 en dólares se convierten a pesos', () => {
  const storage = memoryStorage();
  storage.setItem('habitante-de-calle-save-v1', JSON.stringify({ stats: { dinero: 4 } }));
  assert.equal(new SaveSystem(storage).load().stats.dinero, 1000);
});

test('clear borra la partida y el respaldo', () => {
  const storage = memoryStorage();
  const save = new SaveSystem(storage);
  save.save({ a: 1 }); save.save({ a: 2 });
  save.clear();
  assert.equal(storage.data.size, 0);
  assert.ok(AUTOSAVE_INTERVAL >= 60);
});
