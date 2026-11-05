import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hora, metros, porcentaje } from '../src/ui/formato.js';
import { NEED_META } from '../src/ui/needsMeta.js';
import { GamepadInput, CON_LB, BUTTON_KEYS, CONTROLES_CON_MANDO } from '../src/core/Gamepad.js';
import { ponerModo, sinTeclas, teclaVisible, teclaDeCierre, TECLA_EN_MANDO } from '../src/core/modoEntrada.js';
import { ITEMS, describeEffects } from '../src/data/items.js';
import { formatDistance } from '../src/ui/Minimap.js';

test('la hora, la distancia y el porcentaje se escriben de una sola manera', () => {
  assert.equal(hora(6), '06:00');
  assert.equal(hora(12 + 5 / 60), '12:05');
  assert.equal(hora(23.999), '23:59');
  assert.equal(hora(25), '01:00');
  assert.equal(metros(109.4), '109 m');
  assert.equal(metros(1234), '1,2 km');
  assert.equal(formatDistance(1234), '1,2 km');
  assert.equal(porcentaje(70.4), '70 %');
});

test('ningún menú escribe a mano la hora ni el porcentaje', () => {
  for (const archivo of ['ui/HUD.js', 'ui/PauseMenu.js', 'ui/RadioModal.js', 'ui/momentosTextos.js']) {
    const fuente = fs.readFileSync(new URL(`../src/${archivo}`, import.meta.url), 'utf8');
    assert.doesNotMatch(fuente, /padStart\(2/, `${archivo} arma una hora`);
    assert.doesNotMatch(fuente, /text(Content)?\s*[:=]\s*`\$\{[^`]*\}\s?%`/, `${archivo} arma un porcentaje`);
  }
});

test('las necesidades van en el mismo orden en el cartón y en la pausa', () => {
  const hud = fs.readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8').match(/const FILAS = \[(.*?)\]/)[1].replace(/['\s]/g, '').split(',');
  assert.deepEqual(NEED_META.slice(0, hud.length).map((n) => n.id), hud);
});

test('todos los menús se cierran con la misma pieza', () => {
  const hud = fs.readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
  const costal = fs.readFileSync(new URL('../src/ui/InventoryUI.js', import.meta.url), 'utf8');
  for (const [fuente, clase] of [[hud, 'talent-close'], [hud, 'craft-close'], [hud, 'dealer-close'], [costal, 'inv-close']]) {
    assert.match(fuente, new RegExp(`cierreHTML\\('[^']+', '[^']+', '${clase}'`), clase);
  }
  for (const encabezado of ['talent-header cabecera', 'craft-header cabecera', 'dealer-header cabecera']) assert.ok(hud.includes(encabezado), encabezado);
  assert.ok(costal.includes('inv-head cabecera'));
});

// ---------- objetos: todos, con el dedo y con mando ----------
const TECLAS_DEDO = /\bShift\b|WASD|\bEsc\b|\[[A-Z]\]|\bTab\b|[Tt]ecla|\b[Cc]lic\b|[Rr]atón|[Pp]resiona|\bF2\b|con [A-Z]\b|\([A-Z]\)|\bo [A-Z]\b|[Rr]ueda|[Ff]lechas|Enter|teclado/;
const TECLAS_MANDO = /\bShift\b|WASD|\[[A-Z]\]|\bTab\b|[Tt]ecla \d|\b[Cc]lic\b|[Rr]atón|\bF2\b|\bo [C-KM-WZ]\b|[Rr]ueda|[Ff]lechas/;
const textosDe = (def) => [def.desc ?? '', ...describeEffects(def)];

for (const [modo, patron] of [['tactil', TECLAS_DEDO], ['mando', TECLAS_MANDO]]) {
  test(`con ${modo} ningún objeto habla de una tecla, recorriéndolos todos`, () => {
    ponerModo(modo);
    try {
      const ids = Object.keys(ITEMS);
      assert.ok(ids.length > 30);
      for (const id of ids) for (const t of textosDe(ITEMS[id])) assert.doesNotMatch(sinTeclas(t), patron, `${id}: ${t}`);
    } finally { ponerModo('teclado'); }
  });
}

test('con teclado los textos no cambian', () => {
  ponerModo('teclado');
  for (const id of Object.keys(ITEMS)) for (const t of textosDe(ITEMS[id])) assert.equal(sinTeclas(t), t);
});

test('la foto se explica para cada mano', () => {
  const frase = 'Arrastrar o flechas: girar. Rueda: acercar.';
  ponerModo('tactil');
  assert.equal(sinTeclas(frase), 'Arrastre para girar.');
  ponerModo('mando');
  assert.equal(sinTeclas(frase), 'Stick derecho: girar.');
  ponerModo('teclado');
  assert.equal(sinTeclas(frase), frase);
});

test('con mando el aviso del popó no nombra la X del mando, que es otra cosa', () => {
  ponerModo('mando');
  try {
    assert.match(sinTeclas('para lanzarlo [X]'), /\[Abajo\]/);
    assert.equal(teclaVisible('X'), 'Abajo');
    assert.equal(teclaVisible('C'), 'LB+Y');
    assert.equal(teclaVisible('1'), 'LB+↑');
    assert.equal(teclaDeCierre('T'), 'B');
  } finally { ponerModo('teclado'); }
  assert.equal(teclaDeCierre('T'), 'T');
});

// ---------- el mando ----------
function fakePad(pressed = []) {
  return { index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) };
}
function conMando(fn) {
  const events = [];
  globalThis.KeyboardEvent = class { constructor(type, init) { Object.assign(this, init, { type }); } };
  globalThis.document = { body: { dispatchEvent: (e) => events.push(`${e.type}:${e.code}`) } };
  try {
    const gamepad = new GamepadInput();
    const paso = (...pressed) => { globalThis.navigator.getGamepads = () => [fakePad(pressed)]; gamepad.poll(); };
    fn(paso, events);
  } finally { delete globalThis.KeyboardEvent; delete globalThis.document; delete globalThis.navigator.getGamepads; }
}

test('LB solo cambia la cámara, y al soltarlo', () => {
  conMando((paso, ev) => {
    paso(4);
    paso(4);
    assert.deepEqual(ev, [], 'oprimirlo aún no hace nada');
    paso();
    assert.deepEqual(ev, ['keydown:KeyV', 'keyup:KeyV']);
  });
});

test('LB sostenido da las casillas, Fabricar y Mañas, sin lo suyo de cada botón y sin cambiar la cámara', () => {
  for (const [boton, tecla] of Object.entries(CON_LB)) {
    conMando((paso, ev) => {
      paso();
      paso(4);
      paso(4, Number(boton));
      paso(4, Number(boton));
      assert.deepEqual(ev, [`keydown:${tecla}`, `keyup:${tecla}`], `una sola vez: botón ${boton}`);
      paso(Number(boton)); // suelta LB primero, con el botón todavía abajo: no dispara lo suyo
      paso();
      assert.deepEqual(ev, [`keydown:${tecla}`, `keyup:${tecla}`], `sin lo suyo: botón ${boton}`);
    });
  }
});

test('sin LB cada botón sigue haciendo lo de siempre', () => {
  for (const [boton, tecla] of Object.entries(BUTTON_KEYS)) {
    if (Number(boton) === 4 || !tecla) continue;
    conMando((paso, ev) => {
      paso();
      paso(Number(boton));
      assert.ok(ev.includes(`keydown:${tecla}`), `botón ${boton}`);
    });
  }
});

test('todo lo del mando está en la lista, y la tabla de teclas dice lo que hace', () => {
  assert.equal(TECLA_EN_MANDO.C, 'LB+Y');
  assert.equal(TECLA_EN_MANDO.T, 'LB+X');
  const filas = CONTROLES_CON_MANDO.flatMap(([, items]) => items.map(([k]) => k));
  for (const k of ['LB+Y', 'LB+X', 'LB+cruceta', 'LB+A', 'Y', 'A', 'B', 'RB', 'RT', 'LT']) assert.ok(filas.includes(k), k);
});
