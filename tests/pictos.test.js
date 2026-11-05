// La tabla de dibujos: todo emoji del juego sale como dibujo de la letra, y lo que no está en la tabla no sale como emoji.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { DIBUJOS } from '../src/ui/fuentes/dibujos.js';
import { PICTOS, dibujo, picto, pasarTexto } from '../src/ui/pictos.js';
import { hasIcon, icon, iconChar, setIcon } from '../src/ui/icons.js';
import { ITEMS, itemIcon } from '../src/data/items.js';
import { hasItemArt, itemArtHTML } from '../src/ui/itemArt.js';

const CARTON = DIBUJOS.carton;
const SIN_EMOJI = /[\p{Extended_Pictographic}️‍]/u;

beforeEach(() => {
  globalThis.document = {
    createElement(tag) {
      return { tag, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } };
    },
  };
});

test('cada entrada de la tabla apunta a un dibujo que existe', () => {
  for (const [emoji, nombre] of Object.entries(PICTOS)) {
    if (nombre !== null) assert.ok(Object.hasOwn(DIBUJOS, nombre), `${emoji}: ${nombre}`);
  }
});

test('pasarTexto cambia cada emoji por su dibujo y deja el texto como estaba', () => {
  assert.equal(pasarTexto('🔥 Prendiste candela'), `${DIBUJOS.fogata} Prendiste candela`);
  assert.equal(pasarTexto('Vendiste 🥫 y 🍶'), `Vendiste ${DIBUJOS.lata} y ${DIBUJOS.botella}`);
  assert.equal(pasarTexto('Sin nada: $ 1.200, ¿qué hubo? ñ ✓ ↗'), 'Sin nada: $ 1.200, ¿qué hubo? ñ ✓ ↗');
});

test('el selector de variante se va con su emoji', () => {
  assert.equal(pasarTexto('☀️ Sol'), `${DIBUJOS.sol} Sol`);
  assert.equal(pasarTexto('🛏️'), DIBUJOS.colchon);
  assert.equal(pasarTexto('♻️'), DIBUJOS.reciclar);
});

test('lo que se quita no deja hueco, y se quita entero si viene unido', () => {
  assert.equal(pasarTexto('🩸 ¡Cachazo!'), '¡Cachazo!');
  assert.equal(pasarTexto('🏃‍♂️ ¡Corre!'), '¡Corre!');
  assert.equal(pasarTexto('Uy 😡 ya'), 'Uy ya');
});

test('ningún emoji de la tabla sobrevive, con o sin selector de variante', () => {
  for (const emoji of Object.keys(PICTOS)) {
    for (const forma of [emoji, `${emoji}️`]) {
      assert.doesNotMatch(pasarTexto(`a ${forma} b`), SIN_EMOJI, forma);
    }
  }
});

test('un emoji que no está en la tabla sale como el cartón, nunca como emoji', () => {
  assert.equal(pasarTexto('👽 hola'), `${CARTON} hola`);
  assert.equal(picto('👽'), CARTON);
  assert.equal(dibujo('no-existe'), CARTON);
});

test('picto da el carácter de un emoji, o nada si ese emoji se quita', () => {
  assert.equal(picto('🔥'), DIBUJOS.fogata);
  assert.equal(picto('🕯️'), DIBUJOS.vela);
  assert.equal(picto('🩸'), '');
});

test('pasarTexto aguanta lo que no es texto y se puede pasar dos veces', () => {
  assert.equal(pasarTexto(undefined), '');
  assert.equal(pasarTexto(''), '');
  const una = pasarTexto('🔥 Ya');
  assert.equal(pasarTexto(una), una);
});

test('icon pinta un dibujo sin meterlo en el texto del botón', () => {
  const el = icon('heart', { size: 18 });
  assert.equal(el.tag, 'span');
  assert.equal(el.attributes.class, 'picto');
  assert.equal(el.attributes['aria-hidden'], 'true');
  assert.equal(el.attributes['data-dibujo'], DIBUJOS.corazon);
  assert.equal(el.attributes.style, '--picto:18px');
  assert.equal(el.textContent, undefined);
});

test('los iconos se piden por su nombre o por el del dibujo, y sin nombre conocido sale el cartón', () => {
  assert.equal(iconChar('x'), DIBUJOS.cerrar);
  assert.equal(iconChar('lupa'), DIBUJOS.lupa);
  assert.equal(iconChar('no-existe'), CARTON);
  assert.ok(hasIcon('x') && hasIcon('lupa') && hasIcon('info'));
  assert.ok(!hasIcon('no-existe') && !hasIcon('toString'));
});

test('setIcon reemplaza lo que había', () => {
  let puesto = null;
  setIcon({ replaceChildren: (n) => { puesto = n; } }, 'pause', { size: 16 });
  assert.equal(puesto.attributes['data-dibujo'], DIBUJOS.pausa);
});

test('todo objeto del catálogo tiene un dibujo de verdad, no el respaldo', () => {
  for (const id of Object.keys(ITEMS)) assert.ok(hasIcon(itemIcon(id)), `${id}: ${itemIcon(id)}`);
});

test('el arte teñido se conserva, y lo que no tiene arte usa su dibujo', () => {
  assert.ok(hasItemArt('lata'));
  assert.match(itemArtHTML('lata'), /class="item-art" style="--art: url\(/);
  assert.ok(!hasItemArt('empanada'));
  const html = itemArtHTML('empanada', 'extra');
  assert.match(html, /class="item-art item-art--dibujo picto extra"/);
  assert.ok(html.includes(`data-dibujo="${DIBUJOS.empanada}"`));
  assert.ok(itemArtHTML('no-existe').includes(`data-dibujo="${CARTON}"`));
});
