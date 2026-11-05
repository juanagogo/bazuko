import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ReputationSystem, FAMA, peldanoDe } from '../src/systems/ReputationSystem.js';
import { WitnessSystem, WITNESS } from '../src/systems/WitnessSystem.js';

let target, toasts;
beforeEach(() => {
  target = new EventTarget();
  globalThis.window = target;
  toasts = [];
  target.addEventListener('toast', (e) => toasts.push(e.detail.text));
});
const fire = (name, detail) => target.dispatchEvent(new CustomEvent(name, { detail }));

test('trabajar sube la fama y robar la baja, sin pasar de los topes', () => {
  const r = new ReputationSystem({ target });
  fire('sell'); fire('craft'); fire('encargo-cumplido');
  assert.equal(r.valor, FAMA.vender + FAMA.fabricar + FAMA.encargo);
  fire('robo-peaton', { directo: true });
  fire('carjack');
  assert.equal(r.valor, 6 + FAMA.roboDirecto + FAMA.carro);
  r.sumar(-1000);
  assert.equal(r.valor, -100);
  r.dispose();
});

test('una pelea cuenta una vez por rato, no por cada puño', () => {
  const r = new ReputationSystem({ target });
  fire('street-fight'); fire('street-fight'); fire('street-fight');
  assert.equal(r.valor, FAMA.pelea);
  r.update(FAMA.peleaCada);
  fire('street-fight');
  assert.equal(r.valor, 2 * FAMA.pelea);
  r.dispose();
});

test('cambiar de peldaño se avisa, en primera persona', () => {
  const r = new ReputationSystem({ target });
  assert.equal(r.peldano.id, 'nadie');
  r.sumar(25);
  assert.deepEqual(toasts, ['En el barrio: ya me conocen']);
  assert.equal(peldanoDe(-60).id, 'temido');
  assert.equal(peldanoDe(100).id, 'querido');
  r.dispose();
});

test('la fama cambia la calle: llamadas, calma del fichado, limosna y cosquilleo', () => {
  const r = new ReputationSystem({ target });
  const base = { llamar: r.probabilidadDeLlamar(.7), calma: r.segundosDeCalma(120) };
  assert.equal(base.llamar, .7); assert.equal(base.calma, 120); assert.equal(r.multiplicadorLimosna, 1);
  r.sumar(100);
  assert.ok(r.probabilidadDeLlamar(.7) < .45);
  assert.ok(r.segundosDeCalma(120) < 100);
  assert.ok(r.multiplicadorLimosna > 1.3);
  assert.ok(r.alertaExtra < 0);
  r.sumar(-200);
  assert.ok(r.probabilidadDeLlamar(.7) > .95);
  assert.ok(r.segundosDeCalma(120) > 150);
  assert.ok(r.multiplicadorLimosna < .7);
  r.dispose();
});

test('con buena fama el testigo no llama aunque el azar quede justo arriba de lo que antes alcanzaba', () => {
  const npc = {
    position: { x: 3, y: 0, z: 0, clone() { return { ...this }; } }, stance: 'caminar', hp: 100, fleeTimer: 0,
    witness(mode) { this.modo = mode; return true; }, get witnessing() { return this.modo ?? null; },
    stopWitness() {}, _fleeFrom() {}, say() {},
  };
  const reputation = new ReputationSystem({ target });
  reputation.sumar(100);
  const game = { player: { position: { x: 0, y: 0, z: 0, clone() { return { ...this }; } } }, world: { active: { npcs: [npc] } }, reputation };
  const sys = new WitnessSystem(game, { random: () => WITNESS.callChance - .05 });
  sys.report('robo');
  assert.notEqual(npc.modo, 'llamar');
  sys.dispose(); reputation.dispose();
});

test('se guarda con la partida y se ve en la pausa', () => {
  const r = new ReputationSystem({ target });
  r.sumar(-30);
  const copia = new ReputationSystem({ target });
  copia.deserialize(JSON.parse(JSON.stringify(r.serialize())));
  assert.equal(copia.valor, -30);
  copia.deserialize({ valor: 'x' });
  assert.equal(copia.valor, 0);
  const game = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(game, /fama: this\.reputation\?\.serialize\(\)/);
  assert.match(readFileSync(new URL('../src/ui/PauseMenu.js', import.meta.url), 'utf8'), /card\('El barrio'/);
  r.dispose(); copia.dispose();
});
