import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SmokePuffs } from '../src/character/smoking.js';
import { CameraRig } from '../src/core/Camera.js';
import { Game } from '../src/core/game.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { PolvoGolpes } from '../src/systems/PolvoGolpes.js';
import { ZonaAviso } from '../src/ui/ZonaAviso.js';
import { createFakeAudioContext } from './helpers/fake-audio-context.js';

const preferencia = { matches: false };
test.before(() => {
  globalThis.window = new EventTarget();
  globalThis.matchMedia = consulta => {
    assert.equal(consulta, '(prefers-reduced-motion: reduce)');
    return preferencia;
  };
});
test.after(() => { delete globalThis.window; delete globalThis.matchMedia; });

const persona = (x, y, z) => ({ position: new THREE.Vector3(x, y, z) });
const visibles = escena => escena.getObjectByName('polvo-golpes')?.children.filter(nube => nube.visible) ?? [];

test('el polvo nace entre los cuerpos, a la altura del pecho de quien recibe, y se desvanece en 0,15 s', () => {
  const escena = new THREE.Scene(), polvo = new PolvoGolpes(escena);
  const atacante = persona(-1, 2.1, 0), objetivo = persona(.6, 2.6, 0);
  const pecho = new THREE.Bone();
  pecho.position.set(.5, objetivo.position.y + .57, .1);
  objetivo.character = { pecho: destino => pecho.getWorldPosition(destino) };
  polvo.emitir(atacante, objetivo);
  const [nube] = visibles(escena);
  assert.equal(visibles(escena).length, 1);
  assert.equal(nube.position.y, pecho.position.y);
  assert.ok(nube.position.x > atacante.position.x && nube.position.x < pecho.position.x);
  assert.ok(nube.position.distanceTo(pecho.position) < .3);
  const opacidad = nube.material.opacity, tamano = nube.scale.x;
  assert.ok(opacidad > .5 && tamano > 0);
  polvo.update(.075);
  assert.ok(nube.scale.x > tamano);
  assert.ok(nube.material.opacity > 0 && nube.material.opacity < opacidad);
  polvo.update(.074);
  assert.equal(nube.visible, true);
  polvo.update(.002);
  assert.equal(nube.visible, false);

  delete objetivo.character;
  objetivo.look = { real: { talla: { alto: .95 } } };
  polvo.emitir(atacante, objetivo);
  assert.equal(visibles(escena)[0].position.y, objetivo.position.y + 1.05 * .95);
  polvo.dispose();
});

test('el polvo sigue la posición física de un peatón que avanzó con sus matrices suspendidas', () => {
  const escena = new THREE.Scene(), polvo = new PolvoGolpes(escena);
  const raiz = new THREE.Group(), pecho = new THREE.Bone();
  escena.add(raiz);
  raiz.position.x = 8;
  pecho.position.y = 1.2;
  raiz.add(pecho);
  raiz.updateWorldMatrix(true, true);
  raiz.matrixWorldAutoUpdate = false;
  raiz.position.x = 12;
  const objetivo = { root: raiz, position: raiz.position, character: { pecho: destino => pecho.getWorldPosition(destino) } };
  const atacante = persona(11, 0, 0);
  polvo.emitir(atacante, objetivo);
  const [nube] = visibles(escena);
  assert.ok(nube.position.x > atacante.position.x && nube.position.x < objetivo.position.x);
  polvo.dispose();
});

test('200 contactos reutilizan los objetos y materiales del quinto y comparten la textura del humo', t => {
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) })
  };
  t.after(() => { delete globalThis.document; });
  const escena = new THREE.Scene(), humo = new SmokePuffs(escena), polvo = new PolvoGolpes(escena);
  const atacante = persona(0, 0, 0), objetivo = persona(0, 0, 1);
  const mapa = humo.group.children[0].material.map;
  assert.ok(mapa?.isTexture);
  const recursos = () => {
    const ids = [];
    escena.traverse(objeto => ids.push([objeto.id, objeto.material?.id]));
    return ids;
  };
  const golpear = () => { polvo.emitir(atacante, objetivo); polvo.update(.003); };
  for (let i = 0; i < 5; i++) golpear();
  const trasCinco = recursos();
  for (let i = 5; i < 200; i++) golpear();
  assert.deepEqual(recursos(), trasCinco);
  assert.ok(visibles(escena).length > 1);
  for (const nube of visibles(escena)) assert.equal(nube.material.map, mapa);
  const liberacion = t.mock.fn();
  mapa.addEventListener('dispose', liberacion);
  polvo.dispose();
  assert.equal(liberacion.mock.callCount(), 0, 'el humo conserva su textura compartida');
  mapa.removeEventListener('dispose', liberacion);
  humo.dispose();
});

test('cruzar a otra zona o distrito retira las nubes y detener el juego libera cada material una vez', () => {
  const escena = new THREE.Scene(), polvo = new PolvoGolpes(escena);
  const atacante = { ...persona(0, 0, 0), polvoGolpes: polvo }, objetivo = persona(0, 0, 1);
  const doc = { createElement: () => ({}), getElementById: () => ({ append() {} }) };
  const barrio = { _zoneAt: x => x < 10 ? 'andenes' : 'parque' };
  const juego = Object.assign(Object.create(Game.prototype), {
    player: atacante, world: { active: barrio }, zonaAviso: new ZonaAviso({ doc })
  });
  juego._actualizarZona(.01);
  polvo.emitir(atacante, objetivo);
  juego._actualizarZona(.01);
  assert.equal(visibles(escena).length, 1);
  atacante.position.x = 12;
  juego._actualizarZona(.01);
  assert.equal(escena.getObjectByName('polvo-golpes'), undefined);
  polvo.emitir(atacante, objetivo);
  juego.world.active = { ...barrio };
  juego._actualizarZona(.01);
  assert.equal(escena.getObjectByName('polvo-golpes'), undefined, 'otro distrito aunque la zona tenga el mismo nombre');
  polvo.emitir(atacante, objetivo);
  const grupo = escena.getObjectByName('polvo-golpes');
  const liberados = new Set();
  for (const { material } of grupo.children) material.addEventListener('dispose', () => {
    assert.ok(!liberados.has(material));
    liberados.add(material);
  });
  const cantidad = grupo.children.length;
  juego.stop();
  juego.stop();
  assert.equal(liberados.size, cantidad);
  polvo.emitir(atacante, objetivo);
  assert.equal(escena.getObjectByName('polvo-golpes'), undefined);
});

test('el movimiento reducido apaga el temblor y el polvo, incluso si se pide durante el impacto', t => {
  t.after(() => { preferencia.matches = false; });
  const escena = new THREE.Scene(), polvo = new PolvoGolpes(escena);
  const atacante = persona(0, 0, 0), objetivo = persona(0, 0, 1);
  const camara = Object.assign(Object.create(CameraRig.prototype), {
    camera: new THREE.PerspectiveCamera(), shakeEnabled: true, trauma: 0, _shakeTime: 0
  });
  const impacto = () => { polvo.emitir(atacante, objetivo); camara.addTrauma(.25); };
  preferencia.matches = true;
  impacto();
  assert.equal(polvo.grupo, null, 'antes del primer contacto visible no hace falta la reserva');
  assert.equal(camara.trauma, 0);
  preferencia.matches = false;
  impacto();
  assert.equal(camara.trauma, .25);
  assert.equal(visibles(escena).length, 1);
  preferencia.matches = true;
  polvo.update(.01);
  camara._applyShake(.01);
  impacto();
  assert.equal(visibles(escena).length, 0);
  assert.equal(camara.trauma, 0);
  assert.equal(camara.camera.quaternion.angleTo(new THREE.Quaternion()), 0);
  preferencia.matches = false;
  impacto();
  assert.equal(visibles(escena).length, 1);
  assert.equal(camara.trauma, .25);
  polvo.dispose();
});

class SonidoCargado {
  state() { return 'loaded'; }
  playing() { return false; }
  stop() {}
  unload() {}
}

function oirGolpes(t) {
  const { ctx, created, master } = createFakeAudioContext();
  const crearGanancia = ctx.createGain;
  ctx.createGain = () => Object.assign(crearGanancia(), { context: ctx });
  const audio = new AudioSystem({
    HowlClass: SonidoCargado, howler: { ctx, masterGain: master, volume() {} }, eventTarget: new EventTarget()
  });
  audio.setMix('effects', .4);
  t.after(() => audio.dispose());
  return (arma, remate) => {
    const desde = created.length;
    audio.playPunchHit(arma, remate);
    const capas = created.slice(desde).filter(nodo => nodo.kind === 'oscillator');
    assert.ok(capas.length > 0, arma);
    return capas.map(oscilador => {
      const [envolvente] = oscilador.connections;
      assert.equal(oscilador.started, true);
      assert.equal(envolvente.connections[0], audio._effectsBus);
      assert.equal(audio._effectsBus.gain.value, .4);
      assert.deepEqual(audio._effectsBus.connections, [master]);
      assert.ok(oscilador.stopAt > 0 && oscilador.stopAt < .2);
      return {
        onda: oscilador.type, frecuencia: oscilador.frequency.events[0].value, duracion: oscilador.stopAt,
        frecuenciaFinal: oscilador.frequency.events.at(-1).value, barrido: oscilador.frequency.events.at(-1).time,
        volumen: Math.max(...envolvente.gain.events.map(evento => evento.value))
      };
    }).sort((a, b) => a.frecuencia - b.frecuencia);
  };
}

test('el puño es seco, la tabla tiene más graves y el metal y el vidrio dejan resonancias distintas', t => {
  const oir = oirGolpes(t);
  const puno = oir('punos'), tabla = oir('arma'), filo = oir('cuchillo'), vidrio = oir('botella_picada');
  assert.ok(puno.every(capa => capa.duracion < .1 && capa.frecuencia < 500));
  assert.ok(tabla[0].frecuencia < puno[0].frecuencia && tabla[0].duracion > puno[0].duracion);
  const agudos = capas => capas.filter(capa => capa.frecuencia > 800);
  assert.ok(agudos(filo).length >= 2 && agudos(vidrio).length >= 2);
  assert.ok(agudos(filo)[0].frecuencia > agudos(vidrio)[0].frecuencia * 1.25);
  assert.ok(agudos(vidrio)[0].duracion > agudos(filo)[0].duracion);
});

test('el golpe que recibe el jugador conserva sus dos ondas, su envolvente y su afinación original', t => {
  const oir = oirGolpes(t);
  const original = [
    { onda: 'sine', frecuencia: 120, frecuenciaFinal: 30, barrido: .15, duracion: .15, volumen: .55 },
    { onda: 'square', frecuencia: 180, frecuenciaFinal: 50, barrido: .08, duracion: .15, volumen: .55 }
  ];
  assert.deepEqual(oir(), original);
  oir('punos', true);
  assert.deepEqual(oir(), original);
});

test('cada arma varía poco de tono y volumen sin gastar azar global y todo remate es más grave y fuerte', t => {
  const oir = oirGolpes(t), azar = t.mock.method(Math, 'random', () => .5);
  for (const arma of ['punos', 'cuchillo', 'botella_picada', 'arma']) {
    const normales = Array.from({ length: 18 }, () => oir(arma, false));
    const remates = Array.from({ length: 18 }, () => oir(arma, true));
    for (let i = 0; i < normales[0].length; i++) {
      const tonos = normales.map(capas => capas[i].frecuencia);
      const niveles = normales.map(capas => capas[i].volumen);
      assert.ok(Math.max(...tonos) / Math.min(...tonos) > 1.02 && Math.max(...tonos) / Math.min(...tonos) < 1.10, arma);
      assert.ok(Math.max(...niveles) / Math.min(...niveles) > 1.03 && Math.max(...niveles) / Math.min(...niveles) < 1.12, arma);
      assert.ok(remates.every(capas => capas[i].frecuencia < Math.min(...tonos)), arma);
      assert.ok(remates.every(capas => capas[i].volumen > Math.max(...niveles)), arma);
    }
  }
  assert.equal(azar.mock.callCount(), 0);
});
