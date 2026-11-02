import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { Player, golpeTumba, GOLPE_TUMBA } from '../src/entities/Player.js';
import { PsychosisSystem } from '../src/systems/PsychosisSystem.js';
import { SaveSystem, KEY_DANADA } from '../src/systems/SaveSystem.js';
import { CinematicOverlays } from '../src/ui/CinematicOverlays.js';
import { Avisos } from '../src/ui/avisos.js';
import { sitioDeFoto, quitarClave } from '../src/ui/fotoDeArresto.js';
import { frasesALaVista, repartirFrases } from '../src/ui/frases.js';
import { piezasDelPrompt, piezasParaElDedo, textoDelPrompt, calorALaVista } from '../src/ui/HUD.js';
import { imprimir } from '../src/ui/impresion.js';
import { masCercanoQueVende, ordenDeSugerencia } from '../src/ui/mapServices.js';
import { tituloDeTirado } from '../src/ui/Momentos.js';
import { cabezaDeFigura, celdaDePlana } from '../src/ui/PrimeraPlana.js';
import { SUBSTANCE_EFFECTS } from '../src/data/substanceEffects.js';

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
beforeEach(() => { globalThis.window = new EventTarget(); });

// ---------- el radar ----------
test('la segunda línea del radar: el precio y qué hacer, según el caso', () => {
  assert.deepEqual(ordenDeSugerencia({ tag: 'agua', poi: {}, price: 2000 }).precio, 'Agua $ 2.000');
  assert.equal(ordenDeSugerencia({ tag: 'calor', poi: {}, price: 0 }).precio, 'Calor gratis');
  const pobre = ordenDeSugerencia({ tag: 'agua', broke: true, price: 1200 });
  assert.equal(pobre.precio, 'Agua $ 1.200');
  assert.match(pobre.hacer, /^Sin plata: pida limosna/);
  assert.match(ordenDeSugerencia({ tag: 'agua', carried: 'Botella' }).hacer, /^Usar desde el costal/);
  assert.match(ordenDeSugerencia({ tag: 'agua', full: true, price: 1200 }).hacer, /^Tire algo del costal/);
});

test('sin plata la flecha sigue apuntando: al más cercano que vende lo que hace falta', () => {
  const lejos = { x: 90, z: 0, prices: { agua: 1200 } }, cerca = { x: 30, z: 0, prices: { agua: 1500 } }, otro = { x: 2, z: 0, prices: { comida: 1 } };
  const r = masCercanoQueVende([lejos, cerca, otro], { x: 0, z: 0 }, 'agua');
  assert.equal(r.poi, cerca);
  assert.equal(r.dist, 30);
  assert.equal(masCercanoQueVende([otro], { x: 0, z: 0 }, 'agua'), null);
});

// ---------- la tecla de contexto ----------
test('la mesa da su aviso, como cualquier otro lugar', () => {
  assert.equal(textoDelPrompt({ currentTarget: {}, currentTargetType: 'mesa' }), '[E] Fabricar');
  const fuente = leer('src/systems/InteractionSystem.js');
  assert.match(fuente, /'open-mesa'/);
  assert.match(leer('src/core/game.js'), /'open-mesa'/);
  assert.match(leer('src/core/game.js'), /interaction\.register\(this\.craftingStation\)/);
});

test('con el dedo la tecla de contexto va en corto, dos piezas como mucho y sin la nota de al lado', () => {
  const corto = (tipo, target = {}) => piezasParaElDedo(piezasDelPrompt(textoDelPrompt({ currentTarget: target, currentTargetType: tipo }))).map((p) => p.verbo);
  assert.deepEqual(corto('car', { traffic: true }), ['Robar retrovisor']);
  assert.deepEqual(corto('pickup'), ['Recoger basura', 'Seleccionar']);
  assert.deepEqual(corto('dog'), ['Acariciar'], 'la nota sobre el pan se queda por fuera');
  assert.deepEqual(corto('shop', { title: 'Tienda La Esquinita' }), ['Comprar']);
  for (const v of ['car', 'fireBarrel', 'sell', 'cambuche', 'dealer', 'cart', 'mesa'].flatMap((t) => corto(t))) assert.ok(v.length <= 18, v);
});

test('el calor se lee en minutos y segundos', () => {
  assert.equal(calorALaVista(179.2), '3:00');
  assert.equal(calorALaVista(95), '1:35');
  assert.equal(calorALaVista(0), '0:00');
});

// ---------- las frases ----------
test('hablan dos o tres, los más cercanos, sin pisarse ni tocar lo ocupado', () => {
  assert.equal(frasesALaVista(1440, 900), 3);
  assert.equal(frasesALaVista(844, 390), 2);
  assert.equal(frasesALaVista(375, 812), 2);
  const f = (x, y) => ({ x, y, w: 180, h: 40 });
  const cajas = repartirFrases([f(300, 300), f(310, 305), f(320, 310), f(330, 315)], { ancho: 1280, alto: 800, maximo: 3 });
  const vistas = cajas.filter(Boolean);
  assert.equal(vistas.length, 3);
  assert.equal(cajas[3], null, 'al más lejano no le toca');
  for (const a of vistas) for (const b of vistas) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'se pisan');
  const [encima] = repartirFrases([f(200, 200)], { ancho: 1280, alto: 800, ocupado: [{ x: 100, y: 150, w: 300, h: 60 }] });
  assert.ok(!encima || encima.y + encima.h <= 150 || encima.y >= 210, 'no se monta en el cartón');
  // Entre dos cartones se busca el hueco más cercano, sin saltar de uno a otro hasta rendirse.
  const [hueco] = repartirFrases([f(188, 310)], { ancho: 375, alto: 812, ocupado: [{ x: 0, y: 46, w: 375, h: 165 }, { x: 7, y: 217, w: 207, h: 59 }] });
  assert.ok(hueco && hueco.y >= 276, 'cabe debajo del retazo');
  const [afuera] = repartirFrases([f(10, 300)], { ancho: 375, alto: 812 });
  assert.ok(afuera.x >= 0, 'nunca se sale por el lado');
});

// ---------- la cola de avisos ----------
function pagina() {
  const hijos = [];
  globalThis.innerWidth = 375;
  globalThis.innerHeight = 812;
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, offsetHeight: 28, className: '', textContent: '', remove() { hijos.splice(hijos.indexOf(this), 1); } }),
    body: { appendChild: (e) => hijos.push(e) },
  };
  return hijos;
}

test('en la cola de avisos el peligro pasa antes que la información', () => {
  const hijos = pagina();
  const avisos = new Avisos();
  mock.timers.enable({ apis: ['setTimeout'] });
  avisos.poner('primero');
  avisos.poner('+ Cartón');
  avisos.poner('+ Lata');
  avisos.poner('Te cogió la noche', 'warn');
  avisos.poner('Te vas a morir', 'death');
  const cola = avisos.cola.map((a) => a.texto);
  assert.deepEqual(cola, ['Te vas a morir', 'Te cogió la noche', '+ Cartón', '+ Lata']);
  assert.equal(hijos.length, 1, 'a 375 se ve uno');
});

// ---------- la sacudida ----------
const cambiosDeSigno = (v) => v.reduce((n, x, i) => n + (i && Math.sign(x) !== Math.sign(v[i - 1]) && x !== 0 ? 1 : 0), 0);

function malilla({ reducido = false } = {}) {
  const sistema = new PsychosisSystem(new THREE.Scene(), null, { abstinencia: 100 }, null);
  sistema._movimiento = { matches: reducido };
  sistema._spawnFloatingWhisper = () => {};
  sistema._clearShadowPeople = () => {};
  return sistema;
}

test('la malilla no sacude la cámara: lo que se mueve va por debajo de 0,5 Hz', () => {
  const sistema = malilla();
  const camara = new THREE.PerspectiveCamera(55);
  const rig = { camera: camara, baseFov: 55 };
  const giro = [], fov = [];
  mock.method(performance, 'now', () => reloj);
  let reloj = 0;
  const segundos = 40;
  for (let i = 0; i < segundos * 60; i++) {
    reloj = i * 1000 / 60;
    camara.rotation.z = 0; // la cámara se vuelve a poner en su sitio en cada cuadro
    sistema.update(1 / 60, rig);
    giro.push(camara.rotation.z);
    fov.push(camara.fov - 55);
  }
  mock.restoreAll();
  assert.ok(giro.some((v) => v !== 0), 'hay deriva');
  assert.ok(cambiosDeSigno(giro) / 2 / segundos <= .5, `giro: ${cambiosDeSigno(giro)} cambios de signo en ${segundos} s`);
  assert.ok(cambiosDeSigno(fov) / 2 / segundos <= .5, `fov: ${cambiosDeSigno(fov)} cambios de signo en ${segundos} s`);
});

test('con movimiento reducido la cámara se queda quieta en la malilla', () => {
  const sistema = malilla({ reducido: true });
  const camara = new THREE.PerspectiveCamera(55);
  for (let i = 0; i < 120; i++) sistema.update(1 / 60, { camera: camara, baseFov: 55 });
  assert.equal(camara.rotation.z, 0);
  assert.equal(camara.fov, 55);
});

test('la malilla pone sus capas una vez, no en cada cuadro', () => {
  let escrituras = 0;
  const lista = { add() { escrituras++; }, remove() {}, toggle() {} };
  globalThis.document = { body: { classList: lista }, querySelector: () => null, getElementById: () => ({ classList: lista }), createElement: () => ({ classList: lista, style: {}, appendChild() {} }) };
  const sistema = malilla();
  sistema.overlayEl = { classList: lista };
  for (let i = 0; i < 30; i++) sistema.update(1 / 60, null);
  assert.equal(escrituras, 2, 'la capa y las voces, una sola vez');
  delete globalThis.document;
});

// ---------- comparar antes de escribir ----------
test('el frío y la lluvia solo se escriben si cambia lo que se ve', () => {
  let frio = 0;
  const el = () => ({ style: {}, classList: { toggle() {} } });
  const cold = el();
  Object.defineProperty(cold.style, 'opacity', { set() { frio++; }, get() { return ''; } });
  globalThis.document = { getElementById: (id) => (id === 'cinematic-cold' ? cold : el()) };
  const o = new CinematicOverlays();
  for (let i = 0; i < 60; i++) o.update(1 / 60, { isRaining: false }, { isFreezing: true });
  assert.ok(frio <= 5, `se escribió ${frio} veces en 60 cuadros`);
  delete globalThis.document;
});

// ---------- la partida dañada ----------
test('una partida dañada se aparta sin borrarla y se sigue sin ella', () => {
  const guardado = new Map([['habitante-de-calle-save-v1', '{"pegado": no es json']]);
  globalThis.localStorage = {
    getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v), removeItem: (k) => guardado.delete(k),
  };
  const save = new SaveSystem();
  assert.equal(save.load(), null);
  assert.equal(guardado.get(KEY_DANADA), '{"pegado": no es json');
  assert.equal(guardado.has('habitante-de-calle-save-v1'), false);
  assert.equal(save.fueApartada(), true);
  assert.match(leer('src/core/game.js'), /save\.apartar\(\)/);
});

// ---------- tirado ----------
test('el cartón dice lo que lo dejó tirado', () => {
  assert.equal(tituloDeTirado('carro'), 'Me llevó un carro');
  assert.equal(tituloDeTirado('golpe'), 'TE CASCARON');
});

test('un golpe tumba solo con la salud baja, y deja un respiro antes del siguiente', () => {
  assert.equal(golpeTumba(100), false);
  assert.equal(golpeTumba(GOLPE_TUMBA.salud + 1), false);
  assert.equal(golpeTumba(GOLPE_TUMBA.salud), true);
  assert.equal(golpeTumba(0), false, 'el golpe que mata no lleva cartón');
  assert.equal(golpeTumba(20, 3), false, 'todavía en el respiro');
  assert.equal(golpeTumba(undefined), false);
});

test('los golpes de verdad dejan tirado y el carro dice que fue el carro', () => {
  const nuevo = () => {
    const p = new Player(new THREE.Scene(), { axis: { x: 0, z: 0 }, isRunning: false }, { salud: 100 });
    p.position.set(0, 0, 0); p.root.position.copy(p.position);
    return p;
  };
  const sano = nuevo();
  sano.receiveHit(new THREE.Vector3(1, 0, 0), 2, { salud: 80 });
  assert.equal(sano.isRagdollActive, false);
  assert.equal(sano.tiradoPor, null);

  const golpeado = nuevo();
  golpeado.receiveHit(new THREE.Vector3(1, 0, 0), 2, { salud: 30 });
  assert.equal(golpeado.tiradoPor, 'golpe');
  assert.equal(golpeado.isStunned, true);

  const atropellado = nuevo();
  atropellado.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 8);
  assert.equal(atropellado.tiradoPor, 'carro');
});

// ---------- la plana ----------
test('el punto de la foto es de 4,5 a 5 px, también con pantalla grande', () => {
  assert.equal(celdaDePlana(320), 4.5);
  assert.equal(celdaDePlana(1440), 5);
  assert.equal(celdaDePlana(1440, 2), 10);
});

test('el redondel sigue a la cabeza de quien sea: alto o bajo, se lee de la figura', () => {
  const figura = (arriba, desde, hasta) => {
    const px = new Uint8ClampedArray(20 * 40 * 4);
    for (let y = arriba; y < 40; y++) for (let x = desde; x < hasta; x++) px[(y * 20 + x) * 4 + 3] = 255;
    return px;
  };
  const alta = cabezaDeFigura(figura(4, 8, 12), 20, 40, 40);
  const baja = cabezaDeFigura(figura(12, 8, 12), 20, 40, 40);
  assert.ok(Math.abs(alta.x - 9.5) < .01);
  assert.ok(baja.y > alta.y + 5, 'la baja lleva la cabeza más abajo');
  assert.ok(alta.y > 4 && alta.y < 10, 'el centro, no la coronilla');
  assert.equal(cabezaDeFigura(new Uint8ClampedArray(20 * 40 * 4), 20, 40, 40), null);
});

test('el fotógrafo se para de frente; con una pared en medio se corre', () => {
  const pos = { x: 10, y: 0, z: 10 };
  const frente = sitioDeFoto(pos, 0, null);
  assert.ok(frente.z > 12 && Math.abs(frente.x - 10) < .001, 'de frente: hacia donde mira el personaje');
  let intentos = 0;
  const corrido = sitioDeFoto(pos, 0, { mayOccludePlayer: () => intentos++ < 2 });
  assert.ok(Math.abs(corrido.x - 10) > .5);
  assert.equal(sitioDeFoto(pos, 0, { mayOccludePlayer: () => true }), null, 'encerrado: se queda con el cuadro del juego');
});

test('lo del color clave se vuelve transparente y lo demás queda', () => {
  const px = new Uint8ClampedArray([255, 0, 255, 255, 250, 3, 250, 255, 120, 90, 60, 255]);
  quitarClave(px);
  assert.deepEqual([px[3], px[7], px[11]], [0, 0, 255]);
});

test('una capa blanca despeja lo de atrás en la impresión', () => {
  const lienzo = (color, alfa = 255) => {
    const datos = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < datos.length; i += 4) { datos[i] = color; datos[i + 1] = color; datos[i + 2] = color; datos[i + 3] = alfa; }
    return datos;
  };
  const capas = [];
  globalThis.document = {
    createElement: () => {
      const mc = {
        imageSmoothingQuality: '', filter: '',
        clearRect() {}, drawImage(img) { mc.ultima = img; },
        getImageData: () => ({ data: mc.ultima.datos }),
      };
      return { width: 8, height: 8, getContext: () => mc };
    },
  };
  let puntos = 0;
  const ctx = { beginPath() {}, moveTo() {}, arc() { puntos++; }, fill() {}, fillStyle: '' };
  const oscura = { datos: lienzo(10) }, gradiente = { datos: lienzo(10) };
  for (let i = 0; i < gradiente.datos.length; i += 4) gradiente.datos[i] = gradiente.datos[i + 1] = gradiente.datos[i + 2] = i % 256;
  void capas;
  const sola = imprimir(ctx, 40, 40, [{ img: gradiente, x: 0, y: 0, w: 40, h: 40 }], { celda: 4 });
  puntos = 0;
  const conBlanca = imprimir(ctx, 40, 40, [{ img: gradiente, x: 0, y: 0, w: 40, h: 40 }, { img: oscura, blanca: true, x: 0, y: 0, w: 40, h: 40 }], { celda: 4 });
  assert.ok(sola > 0);
  assert.equal(conBlanca, 0);
  delete globalThis.document;
});

// ---------- los filtros de las sustancias ----------
test('el único filtro en vivo es el de las sustancias, sobre el lienzo, y va más lento que 0,5 Hz', () => {
  for (const [id, receta] of Object.entries(SUBSTANCE_EFFECTS)) {
    assert.ok(receta.camera.hz <= .5, `${id}: la cámara va a ${receta.camera.hz} Hz`);
    const llaves = Object.keys(receta.filter(1, 0));
    const paso = .02, segundos = 40;
    for (const llave of llaves) {
      let vueltas = 0, antes = 0, previo = receta.filter(1, 0)[llave];
      for (let t = paso; t < segundos; t += paso) {
        const ahora = receta.filter(1, t)[llave], delta = ahora - previo;
        if (Math.abs(delta) > 1e-9) {
          if (antes && Math.sign(delta) !== antes) vueltas++;
          antes = Math.sign(delta);
        }
        previo = ahora;
      }
      assert.ok(vueltas / 2 / segundos <= .5, `${id}.${llave}: ${vueltas} vueltas en ${segundos} s`);
    }
  }
  const fuentes = leer('src/systems/SubstanceEffects.js');
  assert.match(fuentes, /this\.canvas\.style\.filter = /);
  for (const f of ['src/ui/HUD.js', 'src/ui/Minimap.js', 'src/ui/Momentos.js', 'src/systems/PsychosisSystem.js', 'src/ui/CinematicOverlays.js']) {
    assert.doesNotMatch(leer(f), /style\.(?:filter|backdropFilter)|filter:/, f);
  }
  for (const f of ['hud', 'radar', 'avisos', 'momentos', 'base', 'tactil']) {
    assert.doesNotMatch(leer(`src/ui/css/${f}.css`).replace(/\/\*[\s\S]*?\*\//g, ''), /(^|[\s;{])(?:backdrop-)?filter\s*:/, f);
  }
});

// ---------- el cosquilleo ----------
test('el cosquilleo es de la casa: marcador sobre cartón, con su ayuda por fuera de la barra', () => {
  const fuente = leer('src/features/steal.js');
  assert.doesNotMatch(fuente, /cssText|\[ESPACIO\]|color:#fff/);
  assert.match(fuente, /class[nN]ame = 'carton/);
  const css = leer('src/ui/css/hud.css');
  assert.match(css, /#steal-ayuda \{[^}]*font-weight/);
  assert.doesNotMatch(css, /^#steal-[a-z]+ \{[^}]*!important/m);
});

// ---------- la limpieza no le pega a quien está en el piso ----------
test('tirado en el piso no le siguen pegando: el siguiente golpe es cuando se pare', async () => {
  const { LimpiezaSocialSystem } = await import('../src/systems/LimpiezaSocialSystem.js');
  const recibidos = [];
  const player = { position: new THREE.Vector3(), isRagdollActive: true, receiveHit(...a) { recibidos.push(a); } };
  const stats = { salud: 30 };
  const sistema = new LimpiezaSocialSystem(new THREE.Scene(), { player, stats, random: () => .5 });
  const miembro = { active: true, position: new THREE.Vector3(.2, 0, 0) };
  sistema._hitPlayer(miembro);
  assert.equal(stats.salud, 30);
  player.isRagdollActive = false;
  sistema._hitPlayer(miembro);
  assert.ok(stats.salud < 30);
  assert.equal(recibidos.length, 1);
  assert.deepEqual(recibidos[0][2], { salud: stats.salud }, 'el golpe sabe con cuánta salud deja');
});

afterEach(() => { mock.restoreAll(); mock.timers.reset(); delete globalThis.document; });
