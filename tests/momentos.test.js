import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  calleCercana, titularDeArresto, pieDeFoto, sueltaDeArresto, perdidoEnArresto, perdidoAlMorir, tituloDeMuerte,
  consejoDeMuerte, CONSECUENCIAS_RECORTE, CONSEJO_CAMIONETA, recorteDeLimpieza, letreroDeDormir, encuadrar,
  redondelAMano, sitioDelPie, sitioParaVoz, VOCES,
} from '../src/ui/momentosTextos.js';
import { streetLabels } from '../src/world/bogota/CityMapRaster.js';
import { Momentos } from '../src/ui/Momentos.js';
import { Avisos } from '../src/ui/avisos.js';
import { LimpiezaSocialSystem } from '../src/systems/LimpiezaSocialSystem.js';
import { ITEMS } from '../src/data/items.js';

const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const HOMBRE = { nombre: 'Jairo', real: { sexo: 'hombre' } };
const MUJER = { nombre: 'Yolanda', real: { sexo: 'mujer' } };

// ---------- la primera plana ----------
test('el titular cambia con el personaje y con la calle', () => {
  assert.deepEqual(titularDeArresto(HOMBRE, 'la Caracas').largo, ['¡LO COGIÓ LA TOMBA', 'EN LA CARACAS!']);
  assert.deepEqual(titularDeArresto(MUJER, 'la Calle 8').corto, ['¡LA COGIÓ', 'LA TOMBA', 'EN LA CALLE 8!']);
  assert.equal(pieDeFoto(HOMBRE), 'Este es Jairo.');
  assert.equal(pieDeFoto(MUJER), 'Esta es Yolanda.');
  assert.match(sueltaDeArresto(MUJER), /^La sueltan en otro lado\. La próxima, despístelos\.$/);
});

test('la calle es la más cercana de verdad, con las vías del mapa', () => {
  const vias = streetLabels(2);
  assert.ok(vias.length > 5, 'el mapa trae vías');
  const nombres = vias.map((v) => v.name);
  for (const via of vias) {
    // Parado encima de cada vía, en un sitio donde no hay otra más cerca, el titular nombra esa vía o una igual de cerca.
    const x = via.vertical ? via.x : Math.max(via.minX ?? 0, 60), z = via.vertical ? 100 : via.z;
    const dicho = calleCercana(x, z, vias);
    assert.ok(dicho.startsWith('la '), dicho);
    assert.ok(nombres.some((n) => dicho === `la ${n.replace(/^Av\.\s*/, '')}`), dicho);
  }
  const propias = [{ name: 'Av. Caracas', vertical: true, x: 100 }, { name: 'Calle 8', vertical: false, z: 40 }];
  assert.equal(calleCercana(96, 400, propias), 'la Caracas');
  assert.equal(calleCercana(10, 44, propias), 'la Calle 8');
  assert.equal(calleCercana(96, 44, propias, (x) => x !== 100), 'la Calle 8', 'si la vía no pasa por aquí, no cuenta');
  assert.equal(calleCercana(0, 0, []), 'la calle');
});

test('lo perdido es lo que de verdad se pierde', () => {
  const items = [{ id: 'carton', qty: 8 }, { id: 'pan', qty: 2 }, { id: 'agua', qty: 1 }, { id: 'lata', qty: 4 }, { id: 'botella', qty: 1 }];
  const preso = perdidoEnArresto(12400, items, ITEMS);
  assert.equal(preso.cosas.length, 3);
  assert.equal(preso.cosas[0], '$ 12.400');
  assert.equal(preso.resto, 3);
  assert.deepEqual(perdidoEnArresto(0, [], ITEMS), { cosas: [], resto: 0 });
  // Morir se lleva la primera mitad de las filas: `Game._respawn`.
  const muerto = perdidoAlMorir(items, ITEMS);
  assert.equal(muerto.cosas.length, 2);
  assert.match(muerto.cosas[0], /×8$/);
  assert.equal(muerto.resto, 0);
  assert.match(leer('src/core/game.js'), /const half = Math\.floor\(this\.inventory\.items\.length \/ 2\);/);
});

// ---------- las muertes ----------
test('la muerte no grita: sin exclamación en títulos ni consejos', () => {
  const casos = [['atropello', {}], ['golpiza', {}], ['limpieza', {}], [null, { isFreezing: true }], [null, { sed: 0 }], [null, { hambre: 0 }], [null, {}]];
  for (const [causa, stats] of casos) {
    assert.doesNotMatch(tituloDeMuerte(causa, stats), /[¡!]/);
    assert.doesNotMatch(consejoDeMuerte(causa, stats) ?? '', /[¡!]/);
  }
  assert.equal(tituloDeMuerte('atropello', {}), 'Me atropellaron');
  assert.equal(tituloDeMuerte('golpiza', {}), 'Te cascaron');
  assert.equal(tituloDeMuerte('limpieza', {}), 'Te mató la limpieza social');
});

test('el recorte es plano y el consejo no va en él', () => {
  assert.equal(recorteDeLimpieza(HOMBRE, 'la Caracas'), 'Hallan muerto a Jairo, habitante de calle, en la Caracas. Nadie vio nada.');
  assert.equal(recorteDeLimpieza(MUJER, 'la Calle 8'), 'Hallan muerta a Yolanda, habitante de calle, en la Calle 8. Nadie vio nada.');
  assert.equal(consejoDeMuerte('limpieza', {}), null);
  assert.doesNotMatch(CONSECUENCIAS_RECORTE, /[¡!]/);
  assert.equal(CONSEJO_CAMIONETA, 'Si vuelve la camioneta, córrale y no pare');
});

test('el recorte se viste sin amarillo, sin rojo y sin adornos', () => {
  const css = leer('src/ui/css/momentos.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const reglas = [...css.matchAll(/([^{}]*(?:recorte)[^{}]*)\{([^{}]*)\}/g)].map((m) => m[2]).join(' ');
  assert.ok(reglas.length > 100, 'halló las reglas del recorte');
  assert.doesNotMatch(reglas, /--rojo|--plana-papel|FFE100|border-radius:\s*50|rotate|m-regla/i);
});

// ---------- la camioneta ----------
const camioneta = () => {
  const avisos = [];
  globalThis.window = new EventTarget();
  globalThis.window.addEventListener('toast', (e) => avisos.push(e.detail));
  const player = { position: { x: 0, y: 0, z: 0, clone() { return { sub() { return { x: 1, y: 0, z: 0 }; } }; } }, receiveHit() {} };
  const stats = { salud: 100 };
  const sistema = new LimpiezaSocialSystem(null, { player, stats, random: () => .5 });
  return { avisos, sistema, stats };
};

test('el aviso de la camioneta habla en usted, sin rojo, sin tecla y sin emoji', () => {
  const { avisos, sistema } = camioneta();
  const miembro = { exitCar() {}, say() {}, active: true };
  sistema.members = [miembro, miembro, miembro];
  sistema._people = null;
  sistema._doorPoint = (_i, t) => t;
  sistema._dropOff();
  assert.deepEqual(avisos, [{ text: 'Una camioneta negra frenó en seco: limpieza social. Córrale y no se deje alcanzar.', type: 'warn' }]);
  assert.equal(sistema.state, 'out');
});

test('un golpe de la limpieza no lleva emoji de sangre, y nada lleva cuenta ni logro', () => {
  const fuente = leer('src/systems/LimpiezaSocialSystem.js');
  assert.ok(fuente.includes('`Me dieron un cachazo: −${damage} de salud.`'));
  assert.doesNotMatch(fuente, /\p{Extended_Pictographic}/u, 'sin emojis');
  assert.doesNotMatch(fuente, /Shift/);
  assert.doesNotMatch(fuente, /logro|contador|kills/i);
  assert.match(fuente, /Se cansaron de perseguirte/);
});

// ---------- lo que no pausa ----------
const nodo = () => ({ hidden: true, style: { setProperty() {} }, replaceChildren(t) { this.texto = t; }, querySelector: () => ({ replaceChildren() {} }) });

beforeEach(() => {
  globalThis.document = {
    _n: { cascado: nodo(), cerrado: nodo(), 'cerrado-hora': nodo() },
    getElementById(id) { return this._n[id] ?? null; },
    fonts: { load: async () => null },
  };
});
afterEach(() => { delete globalThis.document; delete globalThis.window; });

test('un golpe suelto no muestra el cartón, estar en el suelo sí, y se va solo', () => {
  const m = new Momentos();
  const cascado = globalThis.document._n.cascado;
  const stats = { salud: 80 };
  for (let i = 0; i < 3; i++) m.update(.1, { isStunned: true }, stats, null);
  assert.equal(cascado.hidden, true, 'lo que dura un tambaleo no cuenta');
  m.update(.1, { isStunned: false }, stats, null);
  for (let i = 0; i < 5; i++) m.update(.1, { isStunned: true }, stats, null);
  assert.equal(cascado.hidden, false, 'está noqueado');
  m.update(.5, { isStunned: false }, stats, null);
  assert.equal(cascado.hidden, false, 'se deja leer');
  m.update(1.5, { isStunned: false }, stats, null);
  assert.equal(cascado.hidden, true, 'se fue solo');
});

test('una caída mortal no dice «Ya me levanto»', () => {
  const m = new Momentos();
  const cascado = globalThis.document._n.cascado;
  for (let i = 0; i < 6; i++) m.update(.1, { isStunned: true }, { salud: 0 }, null);
  assert.equal(cascado.hidden, true);
  for (let i = 0; i < 6; i++) m.update(.1, { isStunned: true }, { salud: 50 }, null);
  assert.equal(cascado.hidden, false);
  m.update(.1, { isStunned: true }, { salud: 0 }, null);
  assert.equal(cascado.hidden, true);
});

test('el consejo de la camioneta sale al anochecer siguiente, una sola vez', () => {
  const dichos = [];
  const antes = globalThis.dispatchEvent;
  globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
  globalThis.dispatchEvent = (e) => { if (e.type === 'toast') dichos.push(e.detail); return true; };
  try {
    const m = new Momentos();
    const noche = { isNight: true }, dia = { isNight: false };
    m.guardarConsejoDeCamioneta();
    m.update(.1, null, null, noche);
    assert.equal(dichos.length, 0, 'vuelve de noche: todavía no es el anochecer siguiente');
    m.update(.1, null, null, dia);
    assert.equal(dichos.length, 0);
    m.update(.1, null, null, noche);
    assert.deepEqual(dichos, [{ text: CONSEJO_CAMIONETA, type: 'warn' }]);
    m.update(.1, null, null, dia);
    m.update(.1, null, null, noche);
    assert.equal(dichos.length, 1, 'una sola vez');
  } finally { globalThis.dispatchEvent = antes; }
});

test('CERRADO dice la hora real de despertar', () => {
  assert.equal(letreroDeDormir(30).abajo, 'ABRIMOS A LAS 06:00');
  assert.equal(letreroDeDormir(6).arriba, 'CERRADO');
  assert.equal(letreroDeDormir(15.5).abajo, 'ABRIMOS A LAS 15:30');
  assert.match(leer('src/core/game.js'), /'sleep-start', \{ detail: \{ despierta: this\.clock\.hour \+ hours \} \}/);
});

// ---------- la foto ----------
test('el encuadre deja la cabeza dentro y el pie no pisa el redondel', () => {
  for (const [ancho, alto, cajaAncho, cajaAlto] of [[1280, 800, 1440, 400], [1280, 800, 375, 430], [844, 390, 360, 330], [1280, 800, 320, 190]]) {
    for (const cabeza of [{ x: ancho / 2, y: alto * .4 }, { x: 40, y: 30 }, { x: ancho - 30, y: alto - 40 }]) {
      const e = encuadrar({ ancho, alto, cabeza, pies: { x: cabeza.x, y: cabeza.y + alto * .3 }, cajaAncho, cajaAlto });
      assert.ok(e.sx >= 0 && e.sy >= 0 && e.sx + e.sw <= ancho + 1 && e.sy + e.sh <= alto + 1, 'el recorte no se sale del cuadro');
      assert.ok(e.cx >= 0 && e.cx <= cajaAncho && e.cy >= 0 && e.cy <= cajaAlto, 'la cabeza queda en la caja');
      const rx = e.radio * .94, ry = e.radio * 1.1;
      for (const [anchoPie, altoPie] of [[150, 30], [220, 90]]) {
        if (rx * 2 + anchoPie + 30 > cajaAncho && ry * 2 + altoPie + 30 > cajaAlto) continue;
        const { x, y } = sitioDelPie({ anchoPie, altoPie, cx: e.cx, cy: e.cy, rx, ry, ancho: cajaAncho, alto: cajaAlto });
        const pisa = x + anchoPie > e.cx - rx && x < e.cx + rx && y + altoPie > e.cy - ry && y < e.cy + ry;
        if (x !== 10 || y !== cajaAlto - altoPie - 10) assert.equal(pisa, false, `${cajaAncho}×${cajaAlto} ${anchoPie}`);
      }
    }
  }
  assert.deepEqual(redondelAMano(10, 10, 5, 5), redondelAMano(10, 10, 5, 5), 'siempre el mismo trazo');
});

// ---------- las voces ----------
test('una voz nunca cae sobre las cifras, ni en el centro durante una persecución', () => {
  const ocupado = [{ x: 0, y: 0, w: 360, h: 300 }, { x: 1100, y: 0, w: 340, h: 140 }];
  let azar = 1;
  const pseudo = () => { azar = (azar * 16807) % 2147483647; return azar / 2147483647; };
  const dentroDe = (s, z) => s.x < z.x + z.w && z.x < s.x + 300 && s.y < z.y + z.h && z.y < s.y + 60;
  for (let i = 0; i < 200; i++) {
    const s = sitioParaVoz({ ancho: 1440, alto: 900, vozAncho: 300, vozAlto: 60, ocupado, persecucion: i % 2 === 0, azar: pseudo });
    if (!s) continue;
    for (const z of ocupado) assert.equal(dentroDe(s, z), false);
    if (i % 2 === 0) assert.equal(dentroDe(s, { x: 1440 * .3, y: 900 * .25, w: 1440 * .4, h: 900 * .5 }), false, 'el centro queda libre');
  }
  assert.equal(sitioParaVoz({ ancho: 300, alto: 100, vozAncho: 280, vozAlto: 90, ocupado: [{ x: 0, y: 0, w: 300, h: 100 }], azar: pseudo }), null, 'mejor callar que tapar');
  for (const v of VOCES) assert.doesNotMatch(v, /[!¡]|\p{Extended_Pictographic}/u);
  assert.ok(VOCES.includes('No mire atrás') && VOCES.includes('¿Quién está ahí?'));
});

test('la psicosis no escribe el filtro del lienzo ni oscila', () => {
  const fuente = leer('src/systems/PsychosisSystem.js');
  assert.doesNotMatch(fuente, /canvas[^\n]*\.filter|style\.filter/);
  assert.doesNotMatch(leer('src/ui/CinematicOverlays.js'), /chromatic|style\.filter|hue-rotate/i);
  assert.doesNotMatch(leer('index.html'), /psychosis-warning|rain-lens/);
});

// ---------- amarillo y letra de imprenta: solo la plana; el semitono, también la carga ----------
test('el amarillo y la imprenta no salen de los momentos, y el semitono es de la plana y la carga', () => {
  for (const f of fs.readdirSync('src/ui/css')) {
    const css = leer('src/ui/css', f);
    if (f !== 'momentos.css') {
      assert.doesNotMatch(css, /#FFE100|--plana-papel/i, f);
      assert.doesNotMatch(css, /Titular/, f);
    }
  }
  const usan = [];
  const andar = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name); if (n.isDirectory()) andar(p); else if (p.endsWith('.js') && /from '.*impresion\.js'/.test(leer(p))) usan.push(p); } };
  andar('src');
  assert.deepEqual(usan.sort(), [path.join('src', 'ui', 'LoadingArtwork.js'), path.join('src', 'ui', 'PrimeraPlana.js')]);
});

test('la letra de imprenta sale del programa, y el presupuesto de letra se cumple', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imprenta-'));
  try {
    execFileSync(process.execPath, ['tools/fuente/imprenta.mjs', dir], { stdio: 'pipe' });
    for (const f of ['titular.woff', 'tira.woff']) {
      assert.ok(fs.statSync(path.join(dir, f)).size > 1000);
      assert.equal(fs.statSync(path.join(dir, f)).size, fs.statSync(path.join('src/ui/imprenta', f)).size, f);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const carpetas = ['src/ui/fuentes', 'src/ui/imprenta'];
  const peso = carpetas.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.woff')).map((f) => fs.statSync(path.join(d, f)).size)).reduce((a, b) => a + b, 0)
    + fs.statSync('src/ui/css/marcas.css').size;
  assert.ok(peso <= 200 * 1024, `${peso} bytes`);
});

// ---------- la voz ----------
test('los avisos no usan las palabras viejas', () => {
  const viejas = /Partida en Pausa|Cargando recursos|TOCA ARMAR LA BASE|Te tumbaron|Buscado:|mojón|Mojón|cagada|cagar\b|[«'"`]Dealer|Hacer popó|Boost/;
  const archivos = ['src/ui/HUD.js', 'src/ui/InventoryUI.js', 'src/ui/placeMenus.js', 'src/ui/RadioModal.js', 'src/systems/PoopSystem.js', 'src/systems/LimpiezaSocialSystem.js', 'src/systems/RoadRageSystem.js', 'src/systems/MeleeCombat.js', 'src/features/steal.js', 'src/entities/Cart.js', 'src/systems/InteractionSystem.js'];
  for (const f of archivos) {
    for (const [i, linea] of leer(f).split('\n').entries()) {
      if (!/_toast\(|toast\(|_avisar\(|text:|message:/.test(linea)) continue;
      assert.doesNotMatch(linea, viejas, `${f}:${i + 1}`);
      assert.doesNotMatch(linea, /Shift/, `${f}:${i + 1}`);
    }
  }
});

test('un aviso largo alcanza a leerse, y si hay cola también', () => {
  const fuente = leer('src/ui/avisos.js');
  assert.match(fuente, /Math\.max\(VIDA_MS, texto\.length \* MS_POR_LETRA\)/);
  assert.equal(typeof Avisos, 'function');
});
