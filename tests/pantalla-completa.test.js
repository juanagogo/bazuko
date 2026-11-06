import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EN_MAS, TouchControls } from '../src/core/TouchControls.js';
import { alternarPantallaCompleta, enPantallaCompleta, puedePantallaCompleta } from '../src/core/PantallaCompleta.js';

function fakeDoc({ fullscreen = false, soporta = true } = {}) {
  const doc = {
    fullscreenElement: fullscreen ? {} : null,
    pedidos: 0,
    salidas: 0,
    documentElement: soporta ? { requestFullscreen() { doc.pedidos++; } } : {},
    exitFullscreen() { doc.salidas++; doc.fullscreenElement = null; }
  };
  return doc;
}

test('la orden alterna la pantalla completa y calla cuando el navegador no la da', () => {
  const doc = fakeDoc();
  assert.equal(puedePantallaCompleta(doc), true);
  assert.equal(enPantallaCompleta(doc), false);
  alternarPantallaCompleta(doc);
  assert.equal(doc.pedidos, 1);
  const dentro = fakeDoc({ fullscreen: true });
  assert.equal(enPantallaCompleta(dentro), true);
  alternarPantallaCompleta(dentro);
  assert.equal(dentro.salidas, 1);
  const viejo = fakeDoc({ soporta: false });
  assert.equal(puedePantallaCompleta(viejo), false);
  assert.equal(enPantallaCompleta(viejo), false);
  alternarPantallaCompleta(viejo);
  assert.equal(viejo.pedidos, 0);
});

test('la hoja del dedo trae la entrada y cambia su texto al entrar', () => {
  assert.ok(EN_MAS.find((accion) => accion.evento === 'fullscreen-toggle'));
  const boton = { textContent: 'Pantalla completa', getAttribute: () => 'false', setAttribute() {} };
  const relleno = { textContent: '', getAttribute: () => 'false', setAttribute() {} };
  const instancia = {
    botones: new Proxy({ pantalla: boton }, { get: (target, key) => target[key] ?? relleno }),
    game: {},
    doc: { fullscreenElement: null }
  };
  const revisar = TouchControls.prototype._revisarMas;
  revisar.call(instancia);
  assert.equal(boton.textContent, 'Pantalla completa');
  instancia.doc.fullscreenElement = {};
  revisar.call(instancia);
  assert.equal(boton.textContent, 'Salir de pantalla completa');
});

test('el juego escucha el botón y el cambio de pantalla', () => {
  const src = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(src, /'fullscreen-toggle'/);
  assert.match(src, /'fullscreenchange'/);
});
