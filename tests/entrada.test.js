// La entrada: la palabra que se escribe, la impresión en una tinta, el nombre que no se corta y la foto limpia.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MARCA } from '../src/ui/marcaBazuko.js';
import { moduloDeMarca } from '../tools/fuente/marca.mjs';
import { escritura, marcaPorEscribir, marcaQuieta } from '../src/ui/LoadingScreen.js';
import { caber, cubrir, radioDePunto, reservado, tono } from '../src/ui/impresion.js';
import { celdaPara, encuadre } from '../src/ui/LoadingArtwork.js';
import { letraParaNombre } from '../src/ui/Creator.js';

const leer = (ruta) => fs.readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('la marca guardada es la que sale del generador', () => {
  assert.equal(leer('src/ui/marcaBazuko.js'), moduloDeMarca());
});

test('BAZUKO tiene los trazos de sus seis letras y cada uno con tinta y lomo', () => {
  assert.equal(MARCA.trazos.length, 3 + 3 + 3 + 1 + 3 + 2);
  for (const t of MARCA.trazos) {
    assert.match(t.tinta, /^M[-\d .L]+Z$/);
    assert.match(t.lomo, /^M[-\d .L]+$/);
    assert.ok(t.largo > 0);
  }
  assert.equal(marcaPorEscribir().match(/class="carga__lomo"/g).length, MARCA.trazos.length);
  assert.equal(marcaPorEscribir().match(/<clipPath/g).length, MARCA.trazos.length);
  assert.doesNotMatch(marcaQuieta(), /clipPath/);
});

test('se escribe en orden: un trazo no empieza hasta acabar el anterior, y al final está todo', () => {
  const largos = MARCA.trazos.map((t) => t.largo);
  assert.deepEqual(escritura(0, largos), largos.map(() => 0));
  assert.deepEqual(escritura(1, largos), largos.map(() => 1));
  let antes = largos.map(() => 0);
  for (let a = 0; a <= 1.0001; a += .02) {
    const hoy = escritura(a, largos);
    const curso = hoy.filter((t) => t > 0 && t < 1);
    assert.ok(curso.length <= 1, 'la mano hace un trazo a la vez');
    hoy.forEach((t, i) => {
      assert.ok(t >= antes[i], 'lo escrito no se borra');
      if (i && t > 0) assert.equal(hoy[i - 1], 1);
    });
    antes = hoy;
  }
});

test('el semitono: más oscuro, punto más grande; claro de sobra, sin punto', () => {
  assert.equal(tono(.1, .1, .9), 0);
  assert.equal(tono(.95, .1, .9), 1);
  assert.equal(radioDePunto(1, 8, .8), 0);
  assert.ok(radioDePunto(.2, 8, .8) > radioDePunto(.7, 8, .8));
  // Un punto bien formado sale aunque los niveles coincidan: no divide por cero.
  assert.ok(Number.isFinite(tono(.5, .5, .5)));
});

test('la reserva deja limpio donde se escribe y se apaga de a poco', () => {
  const r = { left: 100, right: 200, top: 100, bottom: 150 };
  assert.equal(reservado(150, 120, r, 50), 1);
  assert.equal(reservado(300, 300, r, 50), 0);
  const medio = reservado(225, 120, r, 50);
  assert.ok(medio > 0 && medio < 1);
  assert.equal(reservado(150, 120, null, 50), 0);
});

test('rectángulos: cubrir no deja huecos y caber no se sale', () => {
  const c = cubrir(1600, 900, 375, 812);
  assert.ok(c.w >= 375 && c.h >= 812 - 1e-6);
  const d = caber(1600, 900, 300, 300, 1, 1);
  assert.ok(d.w <= 300 && d.h <= 300);
  assert.equal(d.x + d.w, 300);
  assert.equal(d.y + d.h, 300);
});

test('el personaje se para debajo de la palabra: ninguna cara queda detrás de una letra', () => {
  for (const [W, H, techo] of [[1440, 900, 349], [1280, 800, 315], [375, 812, 120], [320, 568, 110]]) {
    for (const personaje of [{ w: 1305, h: 1205 }, { w: 1671, h: 941 }]) {
      const { personaje: p } = encuadre(W, H, { w: 1672, h: 941 }, personaje, techo);
      assert.ok(p.y >= techo, `${W}: ${p.y} contra ${techo}`);
      assert.ok(Math.abs(p.y + p.h - H) < 1, 'pisa el borde de abajo');
    }
  }
  // Acostado y chico, la palabra se queda a la izquierda: el personaje no entra bajo ella.
  const { personaje: p } = encuadre(844, 390, { w: 1672, h: 941 }, { w: 1305, h: 1205 }, 100);
  assert.ok(p.x >= 844 * .46);
});

test('la celda del semitono no se sale de lo que se alcanza a imprimir', () => {
  assert.equal(celdaPara(1440, 900), 7);
  assert.equal(celdaPara(320, 568), 4);
  assert.equal(celdaPara(3840, 2160), 8);
});

test('el nombre baja de letra lo justo para caber entero, sin bajar del mínimo', () => {
  const medir = (texto, px) => texto.length * px * .8; // 16 W: letra ancha
  assert.equal(letraParaNombre('Jairo', 400, medir), 40);
  const px = letraParaNombre('W'.repeat(16), 240, medir);
  assert.ok(px < 40);
  assert.ok(medir('W'.repeat(16), px) <= 240);
  assert.equal(letraParaNombre('W'.repeat(16), 60, medir), 16);
});

test('la carga no tiene barra, porcentaje ni consejos, y el creador conserva sus piezas', () => {
  const html = leer('index.html');
  for (const viejo of ['<progress', 'loading-percent', 'loading-hint', 'loading-steps', 'creator__scene-label', '04° N']) {
    assert.ok(!html.includes(viejo), viejo);
  }
  for (const id of ['loading-screen', 'loading-status', 'loading-progress', 'loading-retry', 'creator-modal', 'creator-canvas', 'creator-tabs', 'creator-panel', 'creator-error', 'creator-close', 'creator-random', 'creator-done', 'creator-title', 'creator-rot-l', 'creator-rot-r']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /role="progressbar"/);
  assert.match(html, />Un momentico</);
});

test('el creador sigue sin ofrecer a un cuerpo joven lo que deja el cuerpo al aire', () => {
  assert.match(leer('src/ui/Creator.js'), /filter\(\(o\) => garmentAllowed\(o\.id, L\.real\.edad\)\)/);
});

test('las hojas de la entrada no vuelven a lo de antes', () => {
  for (const hoja of ['entrada', 'foto']) {
    const css = leer(`src/ui/css/${hoja}.css`);
    assert.doesNotMatch(css, /--(urban|street|azul|hud|entry)-/, hoja);
    assert.doesNotMatch(css, /backdrop-filter|filter:\s*drop-shadow/, hoja);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b(?!-)/i, `${hoja}: colores solo por variable`);
  }
});
