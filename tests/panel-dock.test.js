import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPanelDock, toggleCraft } from '../src/ui/PanelDock.js';

function game({ paused = false, craftOpen = false } = {}) {
  const g = { paused, toggles: 0, hud: { _craftOpen: craftOpen } };
  g.hud.toggleCraftPanel = () => { g.toggles++; g.hud._craftOpen = !g.hud._craftOpen; };
  return g;
}

test('el acceso a la mesa abre y cierra como la tecla C', () => {
  const g = game();
  assert.equal(toggleCraft(g), true);
  assert.equal(g.hud._craftOpen, true);
  g.paused = true; // la mesa abierta pausa el juego, pero el botón debe poder cerrarla
  assert.equal(toggleCraft(g), true);
  assert.equal(g.hud._craftOpen, false);
});

test('el acceso a la mesa no actúa con la pausa, el inventario u otro panel abiertos', () => {
  const g = game({ paused: true });
  assert.equal(toggleCraft(g), false);
  assert.equal(g.toggles, 0);
  assert.equal(toggleCraft({ paused: false }), false, 'sin HUD no hace nada');
});

// Un documento mínimo: la barra y la cámara con el ancho que se les diga, y la raíz que guarda las variables.
function documento({ camara = true } = {}) {
  const raiz = { props: {}, style: { setProperty(k, v) { raiz.props[k] = v; } } };
  const caja = (ancho) => ({ ancho, get offsetWidth() { return Math.round(this.ancho); }, getBoundingClientRect() { return { width: this.ancho }; } });
  const cam = caja(69.6);
  const doc = {
    nav: null,
    documentElement: raiz,
    body: { appendChild(n) { doc.nav = n; n.puesta = true; } },
    getElementById: (id) => (id === 'camera-controls' && camara ? cam : null),
    createElement() {
      return Object.assign(caja(435.2), {
        setAttribute() {}, addEventListener() {}, removeEventListener() {},
        querySelector: () => ({ append() {} }),
        remove() { this.puesta = false; },
      });
    },
  };
  doc.cam = cam;
  return doc;
}

/** Deja `document` y `ResizeObserver` como estaban al terminar la prueba. */
function devolverGlobales() {
  const antes = ['document', 'ResizeObserver'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  return () => antes.forEach(([k, d]) => (d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]));
}

function observador() {
  const vivos = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.mira = []; vivos.push(this); }
    observe(el) { this.mira.push(el); }
    disconnect() { this.mira = []; }
  };
  return vivos;
}

test('la barra de paneles le pasa su ancho real a la cámara y a la ayuda, y deja de mirar al cerrarse', (t) => {
  t.after(devolverGlobales());
  const doc = documento();
  globalThis.document = doc;
  const vivos = observador();
  const dock = createPanelDock({});
  assert.equal(vivos.length, 1, 'la barra mide su ancho con un ResizeObserver');
  assert.deepEqual(vivos[0].mira, [doc.nav, doc.cam], 'mira la barra y la cámara');
  vivos[0].cb();
  assert.equal(doc.documentElement.props['--panel-dock-w'], '436px');
  assert.equal(doc.documentElement.props['--camera-w'], '70px');
  doc.nav.ancho = 521.3; // con mando, «LB+Y» ensancha la barra
  vivos[0].cb();
  assert.equal(doc.documentElement.props['--panel-dock-w'], '522px');
  doc.nav.ancho = 0; // escondida no cuenta: se queda la última medida
  vivos[0].cb();
  assert.equal(doc.documentElement.props['--panel-dock-w'], '522px');
  dock.dispose();
  assert.deepEqual(vivos[0].mira, [], 'al cerrarse no queda mirando nada');
  assert.equal(doc.nav.puesta, false);
});

test('sin ResizeObserver ni cámara la barra igual se arma y se cierra', (t) => {
  t.after(devolverGlobales());
  globalThis.document = documento({ camara: false });
  delete globalThis.ResizeObserver;
  const dock = createPanelDock({});
  dock.dispose();
  assert.deepEqual(globalThis.document.documentElement.props, {}, 'la hoja de estilos usa sus valores de siempre');
  const vivos = observador();
  const otra = createPanelDock({});
  assert.equal(vivos.length, 1, 'con observador, la barra lo usa');
  assert.equal(vivos[0].mira.length, 1, 'sin cámara solo mira la barra');
  otra.dispose();
  assert.deepEqual(vivos[0].mira, [], 'y al cerrarse la suelta');
});

test('la cámara, la ayuda, su cartón y la pista se paran según el ancho medido de la barra y de la cámara', () => {
  const css = readFileSync(new URL('../src/ui/css/hud.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const reglas = (sel) => [...css.matchAll(new RegExp(`^\\s*${sel} \\{([^}]*)\\}`, 'gm'))].map((m) => m[1].replace(/\s+/g, ' ').trim());
  const hasta1100 = css.slice(css.indexOf('@media (max-width: 1100px)'));
  const enMedia = (sel) => hasta1100.match(new RegExp(`${sel} \\{([^}]*)\\}`))?.[1] ?? '';
  // Las expresiones exactas: con las posiciones fijas de antes (322px, 412px) la cámara y la ayuda quedan bajo la barra.
  assert.match(reglas('#camera-controls')[0], /right: calc\(30px \+ var\(--panel-dock-w, 435px\) \+ var\(--safe-r\)\);/, 'la cámara, 10px a la izquierda de la barra');
  assert.match(reglas('#controls-help')[0], /--ayuda-r: calc\(50px \+ var\(--panel-dock-w, 435px\) \+ var\(--camera-w, 70px\)\);/, 'la ayuda, 20px a la izquierda de la cámara');
  assert.match(reglas('#controls-help')[0], /right: calc\(var\(--ayuda-r\) \+ var\(--safe-r\)\);/);
  assert.match(reglas('#controls-help-content')[0], /right: calc\(412px - var\(--ayuda-r\)\);.*width: min\(560px, calc\(100vw - 788px\)\);/, 'el cartón no se corre ni se angosta con la ayuda');
  assert.match(reglas('#camera-hint')[0], /right: calc\(292px - var\(--panel-dock-w, 435px\)\);/, 'la pista no se corre con la cámara');
  // Hasta 1100px la fila va encima de la barra, pegada al borde, como antes.
  assert.match(enMedia('#controls-help-content'), /right: 0;/);
  assert.match(enMedia('#camera-hint'), /right: 0;/);
});
