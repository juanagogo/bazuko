import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoliranaSession } from '../src/features/bolirana/BoliranaSession.js';
const game = () => ({
  stats: { dinero: 10000 },
  bolirana: { level: 1, pending: false },
  look: { nombre: 'Parcero' },
  audio: { muted: true, volume: 0.5 },
  _save() {
    this.saved = { balance: this.stats.dinero, pending: this.bolirana.pending };
  }
});
test('Bolirana descuenta y guarda la apuesta en el saldo real antes de jugar', () => {
  const g = game(),
    s = new BoliranaSession(g);
  s.begin(2000);
  assert.equal(g.stats.dinero, 8000);
  assert.deepEqual(g.saved, { balance: 8000, pending: true });
  assert.throws(() => s.begin(20));
});
test('La práctica y la salida sin apuesta conservan el saldo', () => {
  const g = game();
  new BoliranaSession(g).close();
  assert.equal(g.stats.dinero, 10000);
});
test('La victoria se paga una vez y se rechazan tiros o finales inválidos', () => {
  const g = game(),
    s = new BoliranaSession(g);
  s.begin(2000);
  assert.throws(() => s.score('npc', 20));
  assert.throws(() => s.score('player', 999));
  assert.throws(() => s.finish());
  for (let i = 0; i < 3; i++) s.score('player', 20);
  for (let i = 0; i < 3; i++) s.score('npc', 1);
  s.finish();
  s.finish();
  s.close();
  assert.equal(g.stats.dinero, 12000);
  assert.equal(g.bolirana.level, 2);
  assert.equal(g.bolirana.pending, false);
});
test('Salir pierde la apuesta una sola vez y reinicia la dificultad', () => {
  const g = game();
  g.bolirana.level = 4;
  const s = new BoliranaSession(g);
  s.begin(2000);
  s.close();
  s.close();
  assert.equal(g.stats.dinero, 8000);
  assert.equal(g.bolirana.level, 1);
  assert.equal(g.bolirana.pending, false);
});
test('El empate devuelve la apuesta sin ganancia', () => {
  const g = game(),
    s = new BoliranaSession(g);
  s.begin(2000);
  for (let i = 0; i < 3; i++) s.score('player', 1);
  for (let i = 0; i < 3; i++) s.score('npc', 1);
  s.finish();
  assert.equal(g.stats.dinero, 10000);
});
test('No comienza con saldo insuficiente o fallo al guardar', () => {
  const g = game(),
    s = new BoliranaSession(g);
  assert.throws(() => s.begin(10001));
  g._save = () => {
    throw Error('disk');
  };
  assert.throws(() => s.begin(2000));
  assert.equal(g.stats.dinero, 10000);
  assert.equal(g.bolirana.pending, false);
});
test('Los tiros tardíos no evitan el límite de tiempo', () => {
  const g = game(),
    s = new BoliranaSession(g);
  s.begin(2000);
  s.deadline = Date.now() - 1;
  assert.throws(() => s.score('player', 20));
  s.finish();
  assert.equal(g.stats.dinero, 8000);
});

test('La fachada usa un edificio existente y su andén sin ocupar el parque', async () => {
  const { Bogota } = await import('../src/world/districts/Bogota.js');
  const { BOLIRANA_LOCATION: L } = await import(
    '../src/world/bogota/BoliranaLocation.js'
  );
  const map = Bogota.prototype._layout();
  assert.equal(map[59][58], 'building');
  assert.equal(map[Math.round(L.z / 2)][Math.round(L.x / 2)], 'sidewalk');
  assert.equal(map[51][50], 'plaza');
  assert.ok(Math.hypot(L.x - 112.98, L.z - 94.64) < 26);
});
test('El último tiro abona la victoria y actualiza el saldo visible una sola vez', () => {
  const g = game();
  g.hud = {
    moneyEl: { textContent: '' },
    _setText(el, text) {
      el.textContent = text;
    }
  };
  const s = new BoliranaSession(g);
  s.begin(2000);
  for (let i = 0; i < 3; i++) s.score('player', 20);
  for (let i = 0; i < 3; i++) s.score('npc', 1);
  assert.equal(g.stats.dinero, 12000);
  assert.equal(g.saved.balance, 12000);
  assert.match(g.hud.moneyEl.textContent, /12[.,]000/);
  assert.equal(s.snapshot().result.outcome, 'win');
  s.close();
  s.finish();
  assert.equal(g.stats.dinero, 12000);
});
test('El último tiro liquida la derrota sin otro descuento', () => {
  const g = game(),
    s = new BoliranaSession(g);
  s.begin(2000);
  for (let i = 0; i < 3; i++) s.score('player', 1);
  for (let i = 0; i < 3; i++) s.score('npc', 20);
  assert.equal(g.stats.dinero, 8000);
  assert.equal(g.saved.balance, 8000);
  assert.equal(s.snapshot().result.outcome, 'loss');
  s.close();
  assert.equal(g.stats.dinero, 8000);
});
test('Un resultado completo se conserva aunque se retrase su confirmación', () => {
  const g = game(),
    s = new BoliranaSession(g);
  s.begin(2000);
  for (let i = 0; i < 3; i++) s.score('player', 20);
  for (let i = 0; i < 3; i++) s.score('npc', 0);
  s.deadline = Date.now() - 1;
  s.finish(true);
  assert.equal(g.stats.dinero, 12000);
  assert.equal(s.snapshot().result.outcome, 'win');
});
test('El fallo al guardar revierte el pago y permite reintentarlo sin duplicarlo', () => {
  const g = game(),
    s = new BoliranaSession(g);
  s.begin(2000);
  for (let i = 0; i < 3; i++) s.score('player', 20);
  for (let i = 0; i < 2; i++) s.score('npc', 0);
  const save = g._save;
  g._save = () => {
    throw Error('quota');
  };
  assert.throws(() => s.score('npc', 0));
  assert.equal(g.stats.dinero, 8000);
  assert.equal(s.match.active, true);
  g._save = save;
  s.finish();
  s.finish();
  assert.equal(g.stats.dinero, 12000);
});
