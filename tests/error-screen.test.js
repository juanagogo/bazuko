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
  assert.match(body.children[0].className, /soft/);
  assert.equal(screen.reports.length, 2);
});

test('perder WebGL guarda la partida y pide recargar', () => {
  const { doc, win, canvas, body, fire } = fakeDom();
  let saved = 0, prevented = false;
  installErrorScreen({ doc, win, canvas, game: { _save() { saved++; } } });
  fire(canvas, 'webglcontextlost', { preventDefault() { prevented = true; } });
  assert.equal(saved, 1);
  assert.equal(prevented, true);
  assert.doesNotMatch(body.children[0].className, /soft/);
});

test('los recursos que no cargan no muestran el aviso', () => {
  const { doc, win, canvas, body, fire } = fakeDom();
  installErrorScreen({ doc, win, canvas });
  fire(win, 'error', {});
  assert.equal(body.children.length, 0);
});
