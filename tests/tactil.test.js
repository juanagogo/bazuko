import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUTTON_KEYS } from '../src/core/Gamepad.js';
import { vectorDePalanca, modoInicial, esTeclaFisica, A_LA_MANO, EN_MAS, CONTROLES_CON_EL_DEDO } from '../src/core/TouchControls.js';
import { modoEntrada, ponerModo, sinTeclas, teclaVisible, TECLA_EN_MANDO } from '../src/core/modoEntrada.js';
import { pasarTexto } from '../src/ui/pictos.js';
import { Input } from '../src/core/Input.js';
import { avisosALaVista } from '../src/ui/avisos.js';

const hoja = fs.readFileSync(new URL('../src/ui/css/tactil.css', import.meta.url), 'utf8');
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('la palanca: zona muerta en el centro, tope antes del aro y la tapa no se sale', () => {
  assert.deepEqual(vectorDePalanca(0, 0, 60).x, 0);
  const quieto = vectorDePalanca(5, 0, 60);
  assert.equal(quieto.x, 0);
  assert.equal(quieto.y, 0);
  const lleno = vectorDePalanca(0, -55, 60);
  assert.equal(lleno.y, -1);
  const fuera = vectorDePalanca(300, 0, 60);
  assert.equal(fuera.x, 1);
  assert.equal(fuera.dibujo.x, 60);
  const medio = vectorDePalanca(30, 0, 60);
  assert.ok(medio.x > .3 && medio.x < .7, 'la fuerza crece con la distancia');
  const diagonal = vectorDePalanca(40, 40, 60);
  assert.ok(Math.hypot(diagonal.x, diagonal.y) <= 1 + 1e-9, 'en diagonal tampoco pasa de 1');
});

test('arranca táctil con puntero grueso; el parámetro manda sobre el equipo', () => {
  assert.deepEqual(modoInicial('', true), { modo: 'tactil', forzado: false });
  assert.deepEqual(modoInicial('', false), { modo: 'teclado', forzado: false });
  assert.deepEqual(modoInicial('?tactil=1', false), { modo: 'tactil', forzado: true });
  assert.deepEqual(modoInicial('?a=b&tactil=0', true), { modo: 'teclado', forzado: true });
  assert.deepEqual(modoInicial('?tactil=10', false), { modo: 'teclado', forzado: false });
});

test('solo una tecla física apaga el modo táctil', () => {
  const campo = { closest: () => ({}) }, lienzo = { closest: () => null };
  assert.equal(esTeclaFisica({ isTrusted: true, code: 'KeyW', target: lienzo }), true);
  assert.equal(esTeclaFisica({ isTrusted: false, code: 'KeyW', target: lienzo }), false, 'inyectada');
  assert.equal(esTeclaFisica({ isTrusted: true, gamepadInput: true, code: 'KeyW', target: lienzo }), false, 'del mando o del dedo');
  assert.equal(esTeclaFisica({ isTrusted: true, code: 'KeyW', target: campo }), false, 'el teclado de la pantalla en un campo');
  assert.equal(esTeclaFisica({ isTrusted: true, code: 'Unidentified', target: lienzo }), false);
  assert.equal(esTeclaFisica({ isTrusted: true, code: '', target: lienzo }), false);
});

test('los botones inyectan las teclas del mando, y «Más» trae todo lo que pide el diseño', () => {
  const delMando = new Set(Object.values(BUTTON_KEYS));
  for (const a of [...A_LA_MANO, ...EN_MAS]) {
    if (a.correr || a.evento) continue;
    assert.ok(delMando.has(a.tecla) || ['KeyZ', 'KeyT', 'F2'].includes(a.tecla), `${a.id}: ${a.tecla}`);
  }
  const nombres = EN_MAS.map((a) => a.texto).join(' | ');
  for (const pide of ['Envión', 'Lanzar', 'Popó', 'Robo directo', 'Mantener', 'Detener', 'Cámara', 'Foto', 'Radio', 'onido', 'Ayuda', 'Pedir', 'Mañas']) assert.ok(nombres.includes(pide), pide);
  assert.deepEqual(A_LA_MANO.map((a) => a.texto), ['Pegar', 'Brincar', 'Correr']);
  // Mantener y robo directo son la misma tecla: sostener funciona porque se suelta al soltar el dedo.
  assert.equal(EN_MAS.find((a) => a.id === 'mantener').tecla, EN_MAS.find((a) => a.id === 'robar').tecla);
});

test('lo tachado depende del juego', () => {
  const de = (id) => EN_MAS.find((a) => a.id === id).puede;
  assert.equal(de('lanzar')({ inventory: { count: () => 0 } }), false);
  assert.equal(de('lanzar')({ inventory: { count: () => 2 } }), true);
  assert.equal(de('robar')({ steal: { targetNpc: {}, cooldown: 3 } }), false);
  assert.equal(de('robar')({ steal: { targetNpc: {}, cooldown: 0 } }), true);
  assert.equal(de('robar')({ steal: { targetNpc: null, cooldown: 0 } }), false);
  assert.equal(de('mantener')({ interaction: { currentTargetType: 'pickup' } }), true);
  assert.equal(de('mantener')({ interaction: { currentTargetType: 'shop' } }), false);
  assert.equal(de('detener')({ steal: { minigameActive: true } }), true);
  assert.equal(de('detener')({ steal: { minigameActive: false } }), false);
});

test('la palanca del dedo mueve y Correr corre, sin quitarle nada al teclado ni al mando', () => {
  const input = new Input();
  input.gamepad.move = { x: 0, y: 0 };
  assert.deepEqual(input.axis, { x: 0, z: 0 });
  input.touch.move.x = .5; input.touch.move.y = -1;
  assert.deepEqual(input.axis, { x: .5, z: -1 });
  input.gamepad.move = { x: 1, y: 0 };
  assert.deepEqual(input.axis, { x: 1, z: 0 }, 'el mando gana');
  input.gamepad.move = { x: 0, y: 0 };
  input.keys.KeyD = true;
  assert.deepEqual(input.axis, { x: 1, z: 0 }, 'el teclado gana');
  input.keys.KeyD = false;
  input.locked = true;
  assert.deepEqual(input.axis, { x: 0, z: 0 }, 'con un panel abierto no mueve');
  input.touch.running = true;
  assert.equal(input.isRunning, false);
  input.locked = false;
  assert.equal(input.isRunning, true);
});

test('con teclado los textos salen idénticos; con el dedo no nombran teclas; con mando dicen el botón', () => {
  const frases = [
    '😡 ¡El conductor se bajó con una varilla! Corra (Shift).',
    'Si un conductor se baja con una varilla, corra con Shift: es más lento que usted corriendo.',
    '🧭 Radar oculto (N)',
    '💩 Popó listo. Oprima [X] para lanzarlo.',
    'Sirve para tirárselo a la gente. Oprima [X] para lanzárselo a los peatones.',
    'WASD para nadar, Shift para acelerar',
    '📻 Radio transistor (R)',
    'Usar desde el inventario (I)',
    'Abrir el costal (I o Tab)',
    'Haga clic en el mapa o elija un lugar.',
    'Enter o doble clic: comer',
    'Sin destino marcado. Abra el mapa con M',
    'Llevo: Pan duro. Se usa desde el costal con I.',
    'Saqué: Cuchillo. Pego con clic o G.',
    'Pan duro → tecla 2',
  ];
  try {
    ponerModo('teclado');
    for (const f of frases) assert.equal(sinTeclas(f), f);
    ponerModo('tactil');
    for (const f of frases) {
      const t = sinTeclas(f);
      assert.doesNotMatch(t, /Shift|WASD|\[[A-Z]\]|\([A-Z]\)|Tab|clic|tecla| con [A-Z]\b/, t);
    }
    assert.match(sinTeclas(frases[0]), /botón Correr/);
    assert.equal(pasarTexto('Corre (Shift).').includes('Shift'), false, 'el filtro único de textos también');
    assert.equal(sinTeclas('El Chato (+120 kg)'), 'El Chato (+120 kg)', 'los paréntesis que no son teclas se quedan');
    assert.equal(sinTeclas('Un texto (Bogotá)'), 'Un texto (Bogotá)');
    assert.equal(sinTeclas('Hablar con El Chato'), 'Hablar con El Chato', 'un nombre no es una tecla');
    ponerModo('mando');
    assert.match(sinTeclas(frases[0]), /RT/);
    assert.doesNotMatch(sinTeclas(frases[5]), /Shift|WASD/);
    assert.match(sinTeclas(frases[3]), /\[Abajo\]/, 'con mando, lanzar es la cruceta: X sería robar');
  } finally {
    ponerModo('teclado');
  }
});

test('con mando la celda de la tecla dice su botón, y coincide con el mapeo', () => {
  try {
    ponerModo('teclado');
    assert.equal(teclaVisible('E'), 'E');
    ponerModo('mando');
    assert.equal(teclaVisible('E'), 'A');
    assert.equal(teclaVisible('Q / E'), 'X / A');
    assert.equal(BUTTON_KEYS[0], `Key${Object.entries(TECLA_EN_MANDO).find(([, b]) => b === 'A')[0]}`);
    assert.equal(BUTTON_KEYS[2], `Key${Object.entries(TECLA_EN_MANDO).find(([, b]) => b === 'X')[0]}`);
    assert.equal(BUTTON_KEYS[5], `Key${Object.entries(TECLA_EN_MANDO).find(([, b]) => b === 'RB')[0]}`);
  } finally {
    ponerModo('teclado');
  }
});

test('un celular grande acostado es celular: dos avisos, aunque pase de 900 de ancho', () => {
  assert.equal(avisosALaVista(932, 430), 2);
  assert.equal(avisosALaVista(844, 390), 2);
  assert.equal(avisosALaVista(1024, 768), 3);
  assert.equal(avisosALaVista(375, 812), 1);
});

test('la hoja: nada táctil existe sin body.tactil, salvo el gesto del lienzo', () => {
  const css = sinComentarios(hoja).replace(/@media[^{]+\{/g, '').replace(/^\s*\}\s*$/gm, '');
  const selectores = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim());
  const sueltos = selectores.filter((s) => !/body\.tactil/.test(s));
  // Lo que no lleva la clase vive dentro de #joystick o #acciones, que sin ella son display: none, o es el gesto.
  for (const s of sueltos) assert.match(s, /^(#game-canvas|html|\.joystick__|\.tactil-|#tactil-mas|#hud-dock|#topbar|#game-settings)/, s);
  assert.doesNotMatch(hoja, /:focus-visible|outline:\s*none/);
  assert.doesNotMatch(hoja, /transition|animation|filter:/, 'sin nada que oscile ni filtros en vivo');
  assert.match(hoja, /touch-action: none/);
  assert.match(hoja, /user-select: none/);
  assert.match(hoja, /var\(--safe-l\)[\s\S]*var\(--safe-r\)[\s\S]*var\(--safe-b\)/, 'respeta la muesca');
});

test('la pestaña Controles con el dedo no nombra teclas ni ratón', () => {
  for (const [, filas] of CONTROLES_CON_EL_DEDO) for (const [nombre, texto] of filas) {
    assert.doesNotMatch(`${nombre} ${texto}`, /Shift|WASD|\bEsc\b|Ratón|clic|\b[A-Z]\b(?= |$)/, `${nombre}: ${texto}`);
  }
});

test('la cámara deja el toque a los controles: no pide bloquear el puntero con un dedo', () => {
  const camara = fs.readFileSync(new URL('../src/core/Camera.js', import.meta.url), 'utf8');
  assert.match(camara, /pointerdown[\s\S]{0,220}pointerType === 'touch'[\s\S]{0,80}return/);
});
