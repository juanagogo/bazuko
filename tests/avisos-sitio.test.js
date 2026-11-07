// De pie, la pila de avisos nunca baja del 40 % de la pantalla, donde empieza el personaje: si debajo del cartón no
// cabe, sube arriba del todo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Avisos, zonaDeAvisos } from '../src/ui/avisos.js';

function pantalla(ancho, alto, cajas) {
  const elementos = [];
  const rect = ([left, top, right, bottom]) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  globalThis.innerWidth = ancho;
  globalThis.innerHeight = alto;
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById: (id) => (cajas[id] ? { hidden: false, getBoundingClientRect: () => rect(cajas[id]) } : null),
    createElement: () => ({
      className: '', textContent: '', offsetHeight: 26,
      clases: new Set(),
      classList: { contains(c) { return this.el.clases.has(c); }, toggle(c, si) { if (si) this.el.clases.add(c); else this.el.clases.delete(c); } },
      style: { top: '', setProperty() {} },
      remove() { elementos.splice(elementos.indexOf(this), 1); },
    }),
    body: { appendChild: (el) => { el.classList.el = el; elementos.push(el); return el; } },
  };
  return elementos;
}

test('a 320 × 568 no cabe un aviso bajo el cartón: va arriba, sobre la plata, y no en la zona del personaje', () => {
  const visibles = pantalla(320, 568, { topbar: [0, 0, 270, 46], 'hud-dock': [0, 46, 320, 215] });
  const zona = zonaDeAvisos(globalThis.document, 320, 568);
  assert.ok(zona.arriba + 26 > zona.abajo, 'debajo del cartón quedan menos de 26 px');
  const avisos = new Avisos();
  avisos.poner('Aviso de prueba 0');
  assert.equal(visibles.length, 1);
  assert.equal(visibles[0].style.top, '6px');
  assert.ok(visibles[0].clases.has('loot-toast--arriba'), 'arriba deja libre el botón de Pausa');
  assert.ok(parseFloat(visibles[0].style.top) + 26 <= 568 * .4);
  for (const a of avisos.visibles) clearTimeout(a.reloj);
});

test('con la tira de misión a la vista a 375 × 812 también sube; sin ella va bajo el cartón', () => {
  const visibles = pantalla(375, 812, { topbar: [0, 0, 325, 46], 'hud-dock': [0, 46, 375, 262], mision: [6, 269, 237, 302] });
  const avisos = new Avisos();
  avisos.poner('Aviso de prueba 0');
  assert.equal(visibles[0].style.top, '6px');
  for (const a of avisos.visibles) clearTimeout(a.reloj);

  const otros = pantalla(375, 812, { topbar: [0, 0, 325, 46], 'hud-dock': [0, 46, 375, 262] });
  const sinMision = new Avisos();
  sinMision.poner('Aviso de prueba 0');
  assert.equal(otros[0].style.top, '270px', 'hay sitio: 262 + 8 de aire');
  assert.equal(otros[0].clases.has('loot-toast--arriba'), false);
  for (const a of sinMision.visibles) clearTimeout(a.reloj);
});
