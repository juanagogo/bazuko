import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError, installErrorScreen } from '../src/ui/ErrorScreen.js';

const fakeDom = () => {
  const listeners = {};
  const target = () => ({ handlers: {}, addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); } });
  const element = () => ({
    children: [], attrs: {}, textContent: '', className: '', id: '', handlers: {},
    setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); },
    addEventListener(type, fn) { this.handlers[type] = fn; }, remove() { this.removed = true; }
  });
  const body = element();
  const doc = { body, createElement: element };
  const win = target(); win.location = { reload() { win.reloaded = true; } };
  const canvas = target();
  const fire = (t, type, event = {}) => t.handlers[type]?.forEach(fn => fn(event));
  return { doc, win, canvas, body, fire, listeners };
};

test('describeError resume el mensaje en una línea', () => {
  assert.equal(describeError(new Error('falló algo\nstack')), 'falló algo');
  assert.equal(describeError(null), 'Error desconocido');
  assert.equal(describeError('x'.repeat(300)).length, 160);
});

test('un error inesperado muestra un aviso que deja seguir jugando', () => {
  const { doc, win, canvas, body, fire } = fakeDom();
  const original = console.error; console.error = () => {};
  const screen = installErrorScreen({ doc, win, canvas, game: null });
  fire(win, 'error', { error: new Error('boom') });
  fire(win, 'unhandledrejection', { reason: new Error('otra') });
  console.error = original;
  assert.equal(body.children.length, 1);
  assert.match(body.children[0].className, /suave/);
  assert.equal(screen.reports.length, 2);
});

test('perder WebGL guarda la partida y pide recargar', () => {
  const { doc, win, canvas, body, fire } = fakeDom();
  let saved = 0, prevented = false;
  installErrorScreen({ doc, win, canvas, game: { _save() { saved++; } } });
  fire(canvas, 'webglcontextlost', { preventDefault() { prevented = true; } });
  assert.equal(saved, 1);
  assert.equal(prevented, true);
  assert.doesNotMatch(body.children[0].className, /suave/);
});

test('los recursos que no cargan no muestran el aviso', () => {
  const { doc, win, canvas, body, fire } = fakeDom();
  installErrorScreen({ doc, win, canvas });
  fire(win, 'error', {});
  assert.equal(body.children.length, 0);
});

// Un juego de mentiras con el mismo guardado solo que el de verdad: la guarda decide si se escribe.
import { AutoSave } from '../src/systems/AutoSave.js';
import { Game } from '../src/core/game.js';
const juegoConGuarda = (extra = {}) => {
  const game = Object.assign(Object.create(Game.prototype), {
    _loading: false, _deathPending: false, _arrestPending: false, isSleeping: false,
    creator: { isOpen: false }, stats: { salud: 80 }, guardados: 0, ...extra
  });
  game._save = () => { game.guardados++; return true; };
  game.autoSave = new AutoSave({ guardar: () => game._save(), puede: () => game._puedeAutoguardar() });
  return game;
};

test('perder WebGL cargando, preso o muerto no escribe la partida, y el aviso no promete que quedó guardada', () => {
  for (const estado of [{ _loading: true }, { _arrestPending: true }, { _deathPending: true, stats: { salud: 0 } }]) {
    const { doc, win, canvas, body, fire } = fakeDom();
    const game = juegoConGuarda(estado);
    installErrorScreen({ doc, win, canvas, game });
    fire(canvas, 'webglcontextlost', { preventDefault() {} });
    assert.equal(game.guardados, 0, JSON.stringify(estado));
    const texto = body.children[0].children[0].children[1].textContent;
    assert.doesNotMatch(texto, /quedó guardada/);
    assert.match(texto, /último guardado/);
  }
  const { doc, win, canvas, body, fire } = fakeDom();
  const game = juegoConGuarda();
  installErrorScreen({ doc, win, canvas, game });
  fire(canvas, 'webglcontextlost', { preventDefault() {} });
  assert.equal(game.guardados, 1, 'en un momento firme sí guarda');
  assert.match(body.children[0].children[0].children[1].textContent, /quedó guardada/);
});

test('«Recargar el juego» durante el arresto recarga sin guardar lo de antes del castigo', () => {
  const { doc, win, canvas, body, fire } = fakeDom();
  const original = console.error; console.error = () => {};
  const game = juegoConGuarda({ _arrestPending: true });
  installErrorScreen({ doc, win, canvas, game });
  fire(win, 'error', { error: new Error('boom') });
  console.error = original;
  const recargar = body.children[0].children[0].children[2].children[0];
  recargar.handlers.click();
  assert.equal(game.guardados, 0);
  assert.equal(win.reloaded, true);
  game._arrestPending = false;
  recargar.handlers.click();
  assert.equal(game.guardados, 1);
});
