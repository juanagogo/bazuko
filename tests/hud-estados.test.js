import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import fs from 'node:fs';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
import { POLICE_SIGHT_RANGE, POLICE_GIVE_UP_RANGE, POLICE_CATCH_RANGE } from '../src/utils/constants.js';
import { estadoBusqueda, piezasDelPrompt, textoDelPrompt, textoDeMision } from '../src/ui/HUD.js';
import { masUrgente, NEED_ORDEN } from '../src/ui/needsMeta.js';
import { avisosALaVista, tipoDeAviso, Avisos } from '../src/ui/avisos.js';
import { CARTON, CARTON_MOJADO, MARCADOR, CINTA, ROJO, hornearPlano } from '../src/ui/planoRadar.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem, POLICE_SIGHT_PER_WANTED } = await import('../src/systems/TrafficSystem.js');
const { StealSystem, WANTED_DECAY_SECONDS } = await import('../src/features/steal.js');

beforeEach(() => { globalThis.window = new EventTarget(); });

test('la búsqueda no existe en cero, y tiene sus cuatro estados', () => {
  assert.equal(estadoBusqueda(null, 0), 'nada');
  assert.equal(estadoBusqueda(null, 2), 'fichado');
  assert.equal(estadoBusqueda(40, 0), 'detras');
  assert.equal(estadoBusqueda(17.9, 3), 'encima');
});

test('la placa de patrulla encima no va y viene en el borde', () => {
  assert.equal(estadoBusqueda(19, 1, 'detras'), 'detras');
  assert.equal(estadoBusqueda(19, 1, 'encima'), 'encima', 'se suelta un poco más lejos de donde se agarra');
  assert.equal(estadoBusqueda(21, 1, 'encima'), 'detras');
});

test('un solo retazo: gana lo más urgente y no salta entre dos parecidos', () => {
  assert.equal(masUrgente({ salud: 100, sed: 90, hambre: 90, energia: 90 }), null);
  assert.equal(masUrgente({ salud: 100, sed: 10, hambre: 15, energia: 90 }).id, 'sed');
  assert.equal(masUrgente({ salud: 8, sed: 10, hambre: 15, energia: 10 }).id, 'salud');
  assert.equal(masUrgente({ salud: 100, sed: 15, hambre: 10, energia: 90 }, 'sed').id, 'sed', 'el que ya está aguanta');
  assert.equal(masUrgente({ salud: 100, sed: 90, hambre: 90, energia: 90, isFreezing: true, calor: 10 }), null, 'con calor no hay frío');
  assert.equal(masUrgente({ salud: 100, sed: 90, hambre: 90, energia: 90, inWithdrawal: true }).grito, 'TENGO MALILLA');
  assert.equal(masUrgente({ salud: 100, sed: 90, hambre: 90, energia: 5 }).orden, 'Busco dónde dormir');
});

test('cada necesidad que puede ser crítica tiene su orden', () => {
  for (const id of ['salud', 'hambre', 'sed', 'energia', 'higiene', 'animo', 'vicio', 'calor']) assert.ok(NEED_ORDEN[id], id);
});

test('la tecla de contexto se parte en tecla y verbo, sin emojis ni corchetes', () => {
  assert.deepEqual(piezasDelPrompt('[E] Recoger basura · [Mantener Q] Seleccionar'), [
    { tecla: 'E', verbo: 'Recoger basura', sostener: false },
    { tecla: 'Q', verbo: 'Mantener: seleccionar', sostener: true },
  ]);
  const [nota] = piezasDelPrompt('Sin tecla');
  assert.equal(nota.tecla, null);
  assert.equal(textoDelPrompt({ currentTarget: { traffic: true }, currentTargetType: 'car' }), '[E] Robar retrovisor del carro en circulación');
  assert.match(textoDelPrompt({ currentTarget: {}, currentTargetType: 'dealer' }), /jíbaro/);
  assert.equal(textoDelPrompt({}), '');
  assert.equal(textoDelPrompt(null), '');
});

test('lo que toca del cambuche sale de lo armado y de lo que hay en el costal', () => {
  const costal = (n) => ({ count: (id) => n[id] ?? 0 });
  assert.equal(textoDeMision({}, costal({ carton: 3 })), 'TOCA JUNTAR 5 CARTONES');
  assert.equal(textoDeMision({}, costal({ carton: 7 })), 'TOCA JUNTAR 1 CARTÓN');
  assert.equal(textoDeMision({}, costal({ carton: 8 })), 'TOCA ARMAR EL CAMBUCHE');
  assert.equal(textoDeMision({ base: 1 }, costal({ lona: 1 })), 'TOCA PONER TECHO DE LONA');
  assert.equal(textoDeMision({ base: 1 }, costal({})), null);
  assert.equal(textoDeMision(null, costal({})), null);
});

test('el fichado baja un nivel cada 120 s sin robar y sin persecución', () => {
  const traffic = { inPursuit: false, wantedLevel: 0 };
  const steal = new StealSystem({ traffic, stats: {}, input: { consumePress: () => false }, interaction: {}, world: { active: { npcs: [] } } });
  steal.buscado = 2;
  steal._enfriarFichado(0);
  assert.equal(traffic.wantedLevel, 2);
  assert.equal(WANTED_DECAY_SECONDS, 120);
  steal._enfriarFichado(119);
  assert.equal(steal.buscado, 2);
  steal._enfriarFichado(1.5);
  assert.equal(steal.buscado, 1);
  assert.equal(traffic.wantedLevel, 1);
  // En persecución la cuenta vuelve a cero.
  steal._enfriarFichado(60);
  traffic.inPursuit = true;
  steal._enfriarFichado(1);
  traffic.inPursuit = false;
  steal._enfriarFichado(119);
  assert.equal(steal.buscado, 1);
  // Un robo también: el retrovisor avisa por evento.
  window.dispatchEvent(new CustomEvent('steal', { detail: {} }));
  steal._enfriarFichado(119);
  assert.equal(steal.buscado, 1);
  steal._enfriarFichado(2);
  assert.equal(steal.buscado, 0);
  steal._enfriarFichado(500);
  assert.equal(steal.buscado, 0, 'de cero no baja');
});

function conPatrulla() {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 80, 0, 80)], { carsPerRoute: 0, policeCount: 1, random: () => .2 });
  traffic.setEnvironment({ getGroundHeight: (_x, _z, y) => y });
  const vehicle = traffic.vehicles[0];
  vehicle.car.position.set(0, 0, 0);
  vehicle.car.group.rotation.y = 0;
  return { traffic, vehicle };
}

test('cada nivel alarga 25 % el alcance con que una patrulla ve un robo', () => {
  const { traffic } = conPatrulla();
  assert.equal(POLICE_SIGHT_PER_WANTED, .25);
  assert.equal(traffic.sightRange, POLICE_SIGHT_RANGE);
  traffic.wantedLevel = 3;
  assert.equal(traffic.sightRange, POLICE_SIGHT_RANGE * 1.75);
  traffic.dispose();
});

test('pursuitInfo da la patrulla más cercana, o null; el nivel solo no hace perseguir', () => {
  const { traffic, vehicle } = conPatrulla();
  traffic.wantedLevel = 3;
  assert.equal(traffic.pursuitInfo, null);
  assert.equal(traffic.inPursuit, false);
  traffic._startChase(vehicle);
  vehicle._chaseDist = POLICE_GIVE_UP_RANGE;
  assert.equal(traffic.pursuitInfo.closeness, 0);
  vehicle._chaseDist = POLICE_CATCH_RANGE;
  assert.equal(traffic.pursuitInfo.closeness, 1);
  vehicle._chaseDist = 40;
  const info = traffic.pursuitInfo;
  assert.equal(info.distance, 40);
  assert.ok(info.closeness > 0 && info.closeness < 1);
  assert.equal(traffic.pursuitInfo, info, 'no crea un objeto por cuadro');
  traffic.dispose();
});

test('hay un solo creador de avisos', () => {
  const fuentes = [];
  const leer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = `${dir}/${e.name}`;
      if (e.isDirectory()) leer(r);
      else if (r.endsWith('.js') && !r.includes('/sala/')) fuentes.push(r);
    }
  };
  leer('src');
  const crean = fuentes.filter((r) => /className\s*=\s*[`'"][^`'"]*loot-toast/.test(fs.readFileSync(r, 'utf8')));
  assert.deepEqual(crean, ['src/ui/avisos.js']);
});

test('los tipos del juego se reducen a los que tienen estilo', () => {
  assert.equal(tipoDeAviso('warning'), 'warn');
  assert.equal(tipoDeAviso('raro-que-no-existe'), 'info');
  assert.equal(tipoDeAviso(undefined), 'info');
  const hoja = fs.readFileSync('src/ui/css/avisos.css', 'utf8');
  for (const t of ['warn', 'death', 'rare']) assert.ok(hoja.includes(`.loot-toast.${t}`), t);
});

test('a la vista: 3 en escritorio, 2 acostado, 1 de pie', () => {
  assert.equal(avisosALaVista(1440, 900), 3);
  assert.equal(avisosALaVista(1280, 800), 3);
  assert.equal(avisosALaVista(844, 390), 2);
  assert.equal(avisosALaVista(375, 812), 1);
  assert.equal(avisosALaVista(320, 568), 1);
});

function paginaFalsa(ancho, alto) {
  const hijos = [];
  globalThis.innerWidth = ancho;
  globalThis.innerHeight = alto;
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, offsetHeight: 28, className: '', textContent: '', remove() { hijos.splice(hijos.indexOf(this), 1); } }),
    body: { appendChild: (e) => hijos.push(e) },
  };
  return hijos;
}

test('la cola: lo que no cabe espera, y se apura al más viejo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hijos = paginaFalsa(375, 812);
  const avisos = new Avisos();
  for (const n of ['uno', 'dos', 'tres']) avisos.poner(n);
  assert.equal(hijos.length, 1, 'de pie se ve uno');
  assert.equal(avisos.cola.length, 2);
  t.mock.timers.tick(1000);
  assert.equal(hijos[0].textContent, 'dos', 'el segundo entra sin esperar la vida entera del primero');
  t.mock.timers.tick(1000);
  assert.equal(hijos[0].textContent, 'tres');
  t.mock.timers.tick(2600);
  assert.equal(hijos.length, 0);
  delete globalThis.innerWidth; delete globalThis.innerHeight; delete globalThis.document;
});

test('el mismo aviso otra vez no se apila, y el tipo warning sale con estilo', () => {
  const hijos = paginaFalsa(1440, 900);
  const avisos = new Avisos();
  avisos.poner('El costal está lleno', 'warning');
  avisos.poner('El costal está lleno', 'warning');
  assert.equal(hijos.length, 1);
  assert.match(hijos[0].className, /\bwarn\b/);
  for (const a of [...avisos.visibles]) avisos._quitar(a, false);
  delete globalThis.innerWidth; delete globalThis.innerHeight; delete globalThis.document;
});

test('el radar usa los mismos colores de la hoja, y sin Path2D no hay plano', () => {
  const hoja = fs.readFileSync('src/ui/css/base.css', 'utf8');
  for (const [v, c] of [['carton', CARTON], ['carton-mojado', CARTON_MOJADO], ['marcador', MARCADOR], ['cinta', CINTA], ['rojo', ROJO]]) {
    assert.ok(hoja.includes(`--${v}: ${c};`), v);
  }
  assert.equal(hornearPlano({ ancho: 1, desdeZ: 0, hastaZ: 0, T: 1, tipo: () => null, originX: 0, originZ: 0 }), null);
});
