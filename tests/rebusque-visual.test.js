// Lo que se ve del rebusque: pelotas que vuelan entre las manos, espuma y rodillo sobre el parabrisas del modelo, la mano
// del conductor con la moneda. Pocas mallas, propias, sin sombras, y nada sin escena.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { RebusqueVisual } from '../src/systems/rebusque/RebusqueVisual.js';
import { Ritmo, BEAT, VUELO, ALTURA, esAlta } from '../src/systems/rebusque/ritmo.js';
import { getCarBody } from '../src/world/bogota/VehicleBody.js';

/** Un personaje con huesos de mano Mixamo (y su dedo medio) frente al +Z, en el origen. */
function personaje() {
  const group = new THREE.Group();
  const inst = new THREE.Group();
  group.add(inst);
  for (const [lado, x] of [['Right', -.25], ['Left', .25]]) {
    const mano = new THREE.Bone(); mano.name = `mixamorig${lado}Hand`; mano.position.set(x, 1.2, .3);
    const dedo = new THREE.Bone(); dedo.name = `mixamorig${lado}HandMiddle1`; dedo.position.set(0, 0, .08);
    mano.add(dedo); inst.add(mano);
  }
  const root = new THREE.Group(); root.add(group);
  root.updateMatrixWorld(true);
  return { group, root, inst };
}

function montar(extra = {}) {
  const scene = new THREE.Scene();
  const ch = personaje();
  scene.add(ch.root);
  const game = { player: { position: new THREE.Vector3(), root: ch.root, character: { group: ch.group }, modelScale: 1 }, rebusque: { escena: null }, traffic: { vehicles: [] }, ...extra };
  return { scene, game, ch, visual: new RebusqueVisual(scene, game) };
}

test('sin escena no hay ninguna malla', () => {
  const { visual, scene } = montar();
  for (let i = 0; i < 10; i++) visual.update(1 / 60);
  assert.equal(visual.mallas, 0);
  assert.equal(visual.group, null);
  assert.equal(scene.getObjectByName('Rebusque: props'), undefined);
});

test('malabares: tres pelotas que salen de una mano, suben y caen en la otra; la alta sube más', () => {
  const { visual, game } = montar();
  const escena = { tipo: 'malabares', tiempo: 0, dur: 5, ritmo: new Ritmo(5), reacciones: [] };
  game.rebusque.escena = escena;
  let maxNormal = 0, maxAlta = 0;
  for (let t = 0; t < 4.6; t += 1 / 60) {
    escena.tiempo = t;
    visual.update(1 / 60);
    const k = Math.floor(t / BEAT);
    for (const b of visual._bolas) {
      assert.ok(b.mesh.visible);
      const p = b.mesh.position;
      assert.ok(Math.hypot(p.x, p.z - .34) < .5, `pelota cerca de las manos: ${p.toArray()}`);
      assert.ok(p.y >= 1.15 && p.y < 1.25 + ALTURA * 1.8 + .1, `altura ${p.y}`);
      if (b.k >= 0 && (t - b.k * BEAT) < VUELO) (esAlta(b.k) ? (maxAlta = Math.max(maxAlta, p.y)) : (maxNormal = Math.max(maxNormal, p.y)));
    }
    if (k > 3) assert.equal(new Set(visual._bolas.map(b => b.k)).size, 3, 'cada pelota en su lanzamiento');
  }
  assert.ok(maxNormal > 1.2 + ALTURA * .9, `arco normal ${maxNormal}`);
  assert.ok(maxAlta > maxNormal + .4, `la alta sube más: ${maxAlta}`);
  assert.equal(visual.mallas, 3);
  const mallas = visual.group.children;
  assert.ok(mallas.every(m => !m.castShadow && !m.receiveShadow));
  // Antes del primer lanzamiento la tercera espera encima de la primera, no en el mismo punto.
  escena.tiempo = 0;
  game.rebusque.escena = { ...escena, tiempo: 0 };
  visual.update(1 / 60);
  assert.ok(visual._bolas[0].mesh.position.distanceTo(visual._bolas[2].mesh.position) > .05);
});

test('una pelota que se cae llega al piso y se queda ahí', () => {
  const { visual, game } = montar();
  const ritmo = new Ritmo(5);
  ritmo.golpe(.3); ritmo.golpe(.6);
  const escena = { tipo: 'malabares', tiempo: 0, dur: 5, ritmo, reacciones: [] };
  game.rebusque.escena = escena;
  let k = -1;
  for (let t = 0; t < 4.5; t += 1 / 60) {
    escena.tiempo = t;
    const c = ritmo.avanzar(t);
    if (c >= 0) k = c;
    visual.update(1 / 60);
  }
  assert.ok(k >= 0);
  const bola = visual._bolas[k % 3];
  assert.ok(bola.mesh.position.y < .06, `en el piso: ${bola.mesh.position.y}`);
});

test('parabrisas: la espuma cubre el vidrio del modelo, el rodillo lo recorre y lo deja limpio', () => {
  const carroceria = new THREE.Group();
  carroceria.position.set(5, 0, 0);
  carroceria.rotation.y = Math.PI; // de frente al jugador
  const car = { position: carroceria.position, group: { rotation: { y: Math.PI } }, length: 4.2, width: 1.8, vehicle: { model: 'sedanPopular', bodyVisual: carroceria } };
  const vehicle = { car };
  const { visual, game, ch } = montar({ traffic: { vehicles: [vehicle] } });
  ch.root.position.set(3.2, 0, 0); ch.root.rotation.y = Math.PI / 2; ch.root.updateMatrixWorld(true);
  const escena = { tipo: 'vidrios', car, vehicle, tiempo: 0, dur: 6, ritmo: null, reacciones: [] };
  game.rebusque.escena = escena;
  const body = getCarBody('sedanPopular');
  const local = new THREE.Vector3();
  let alfaInicio = null, alfaFin = null;
  for (let t = 0; t <= 6; t += 1 / 30) {
    escena.tiempo = t;
    visual.update(1 / 30);
    const espuma = visual._espuma;
    assert.ok(espuma.mesh.visible);
    // La hoja está sobre el vidrio: entre la base y el techo del parabrisas, pegada a la superficie.
    carroceria.worldToLocal(local.copy(visual._hoja.position));
    const [arriba, abajo] = body.spec.windshield;
    assert.ok(local.x >= arriba - .05 && local.x <= abajo + .05, `x ${local.x}`);
    assert.ok(Math.abs(local.y - body.topY(local.x, local.z)) < .08, `pegada al vidrio: ${local.y} vs ${body.topY(local.x, local.z)}`);
    assert.ok(visual._palo.visible && visual._palo.scale.y > .05);
    const alfa = espuma.mesh.geometry.attributes.color.array.filter((_, i) => i % 4 === 3).reduce((a, b) => a + b, 0);
    if (t > .55 && alfaInicio === null) alfaInicio = alfa;
    alfaFin = alfa;
  }
  assert.ok(alfaInicio > 0, 'primero se enjabona');
  assert.ok(alfaFin < alfaInicio * .4, `y queda limpio: ${alfaFin} de ${alfaInicio}`);
  // La espuma usa la matriz de la carrocería y no toca el carro.
  assert.ok(visual._espuma.mesh.matrix.equals(carroceria.matrixWorld));
  assert.equal(carroceria.children.length, 0);
  // Si el carro sale de la circulación, desaparece.
  game.traffic.vehicles.length = 0;
  escena.tiempo = 1;
  visual.update(1 / 30);
  game.rebusque.escena = { ...escena };
  visual.update(1 / 30);
  assert.ok(!visual._espuma.mesh.visible);
});

test('cobro: la mano del conductor sale por su ventana y la moneda vuela a la mano del jugador', () => {
  const carroceria = new THREE.Group();
  carroceria.position.set(0, 0, 3);
  carroceria.updateMatrixWorld(true);
  const car = { position: carroceria.position, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8,
    vehicle: { model: 'sedanPopular', bodyVisual: carroceria, driverAnchor: { x: .1 }, driverDoor: { side: -1 } } };
  const vehicle = { car };
  const otro = { position: new THREE.Vector3(6, 0, 3), group: { rotation: { y: 0 } }, vehicle: {} };
  const { visual, game } = montar({ traffic: { vehicles: [vehicle] } });
  const escena = { tipo: 'cobro', trabajo: 'malabares', tiempo: 0, dur: 2.6, reacciones: [
    { car, vehicle, tipo: 'paga', t0: 0, pesos: 500 },
    { car: otro, vehicle: null, tipo: 'ignora', t0: .35, pesos: 0 }
  ] };
  game.rebusque.escena = escena;
  const palma = new THREE.Vector3();
  let cerca = Infinity, sale = false;
  for (let t = 0; t < 2.5; t += 1 / 60) {
    escena.tiempo = t;
    visual.update(1 / 60);
    const slot = visual._manosConductor[0];
    if (slot.mano.visible) {
      sale = true;
      // Por el lado del conductor (−Z local del carro = −1) y a la altura de la ventana.
      assert.ok(slot.mano.position.z < 3 - .8, `${slot.mano.position.z}`);
      assert.ok(slot.mano.position.y > .9 && slot.mano.position.y < 1.4);
    }
    if (slot.moneda.visible) cerca = Math.min(cerca, slot.moneda.position.distanceTo(visual._palmaDe(0, palma)));
  }
  assert.ok(sale);
  assert.ok(cerca < .1, `la moneda llega a la mano: ${cerca}`);
  assert.equal(visual._manosConductor.length, 1, 'el que no mira no saca la mano');
});

test('cobro: el antebrazo sale de adentro de la cabina hasta la mano, a media ventana', () => {
  const carroceria = new THREE.Group();
  carroceria.position.set(0, 0, 3);
  carroceria.updateMatrixWorld(true);
  const car = { position: carroceria.position, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8,
    vehicle: { model: 'sedanPopular', bodyVisual: carroceria, driverAnchor: { x: .1 }, driverDoor: { side: -1 } } };
  const { visual, game } = montar({ traffic: { vehicles: [{ car }] } });
  const escena = { tipo: 'cobro', trabajo: 'vidrios', tiempo: .9, dur: 2.6, reacciones: [{ car, vehicle: null, tipo: 'paga', t0: 0, pesos: 500 }] };
  game.rebusque.escena = escena;
  visual.update(1 / 60);
  const slot = visual._manosConductor[0];
  assert.ok(slot.mano.visible && slot.brazo.visible && slot.manga.visible);
  const body = getCarBody('sedanPopular');
  const local = new THREE.Vector3();
  // El codo, adentro de la carrocería; la mano, afuera y por encima de la línea de la puerta.
  carroceria.worldToLocal(local.copy(slot.brazo.position));
  assert.ok(Math.abs(local.z) < body.sideZ(.1, local.y), `codo adentro: ${local.z}`);
  carroceria.worldToLocal(local.copy(slot.mano.position));
  assert.ok(Math.abs(local.z) > body.sideZ(.1, body.belt(.1)), `mano afuera: ${local.z}`);
  assert.ok(local.y > body.belt(.1) + .1, `a media ventana: ${local.y} (puerta ${body.belt(.1)})`);
  // La buseta se aborda por la derecha (driverDoor.side 1) pero se maneja por la izquierda: la mano sale del lado del puesto.
  car.vehicle.driverAnchor = { x: .1, z: -.4 };
  car.vehicle.driverDoor = { x: 1, side: 1 };
  escena.tiempo = .95;
  game.rebusque.escena = { ...escena };
  visual.update(1 / 60);
  carroceria.worldToLocal(local.copy(slot.mano.position));
  assert.ok(local.z < -body.sideZ(.1, body.belt(.1)), `del lado del conductor: ${local.z}`);
  // El antebrazo llega hasta la muñeca.
  const punta = new THREE.Vector3(0, 1, 0).applyQuaternion(slot.brazo.quaternion).multiplyScalar(slot.brazo.scale.y).add(slot.brazo.position);
  assert.ok(punta.distanceTo(slot.mano.position) < .08, `${punta.distanceTo(slot.mano.position)}`);
});

test('al cobrar los malabares, las pelotas en el aire terminan su vuelo en las manos y luego se guardan', () => {
  const { visual, game } = montar();
  const show = { tipo: 'malabares', tiempo: 0, dur: 5, ritmo: new Ritmo(5), reacciones: [] };
  game.rebusque.escena = show;
  const fin = 3.1; // a mitad de un vuelo
  for (let t = 0; t <= fin + 1e-9; t += 1 / 60) { show.tiempo = t; visual.update(1 / 60); }
  const antes = visual._bolas.map(b => b.mesh.position.clone());
  assert.ok(antes.some(p => p.y > 1.4), 'había una en el aire');
  const cobro = { tipo: 'cobro', trabajo: 'malabares', tiempo: 0, dur: 2.6, reacciones: [] };
  game.rebusque.escena = cobro;
  let salto = 0, previas = antes;
  const palma = [new THREE.Vector3(), new THREE.Vector3()];
  let enManos = false;
  for (let s = 1 / 60; s < 2; s += 1 / 60) {
    cobro.tiempo = s;
    visual.update(1 / 60);
    if (s < VUELO + .2) {
      assert.ok(visual._bolas.every(b => b.mesh.visible), `siguen a la vista a los ${s}`);
      salto = Math.max(salto, ...visual._bolas.map((b, i) => b.mesh.position.distanceTo(previas[i])));
      previas = visual._bolas.map(b => b.mesh.position.clone());
    }
    if (Math.abs(s - (VUELO + .1)) < 1 / 120) {
      visual._palmaDe(0, palma[0]); visual._palmaDe(1, palma[1]);
      enManos = visual._bolas.every(b => Math.min(b.mesh.position.distanceTo(palma[0]), b.mesh.position.distanceTo(palma[1])) < .08);
    }
  }
  assert.ok(salto < .15, `sin saltos: ${salto}`);
  assert.ok(enManos, 'las tres quedan en las manos');
  assert.ok(visual._bolas.every(b => !b.mesh.visible), 'y después se guardan');
});

test('las manos se vuelven a buscar si el modelo se reconstruye, y dispose lo libera todo', () => {
  const { visual, game, ch, scene } = montar();
  game.rebusque.escena = { tipo: 'dulces', tiempo: 0, dur: 3, reacciones: [] };
  visual.update(1 / 60);
  const vieja = visual._manos[0];
  assert.equal(vieja.name, 'mixamorigRightHand');
  // El modelo nuevo llega al mismo grupo y el viejo se va.
  ch.group.remove(ch.inst);
  const nuevo = personaje().inst;
  ch.group.add(nuevo);
  visual.update(1 / 60);
  assert.notEqual(visual._manos[0], vieja);
  assert.ok(nuevo.children.includes(visual._manos[0]));
  assert.ok(visual._chaza.visible && visual._dulce.visible);
  visual.dispose();
  assert.equal(visual.mallas, 0);
  assert.equal(scene.getObjectByName('Rebusque: props'), undefined);
});

/**
 * La clave del programa que three compilaría para esta malla (renderer y luces de mentira). Con `sombras` apagadas
 * también se apagan las luces de punto, como hace Renderer._setShadows en baja.
 */
function claveDePrograma({ sombras = true } = {}) {
  const renderer = { getRenderTarget: () => null, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace,
    shadowMap: { enabled: sombras, type: THREE.PCFSoftShadowMap }, localClippingEnabled: false, getContext: () => ({}),
    state: { buffers: { depth: { getReversed: () => false } } }, capabilities: {} };
  const capacidades = { precision: 'highp', logarithmicDepthBuffer: false, reversedDepthBuffer: false, vertexTextures: true, maxBones: 1024 };
  const programas = new WebGLPrograms(renderer, { get: t => t }, { has: () => true }, capacidades, {}, { numPlanes: 0, numIntersection: 0 });
  const luces = { sun: [], directional: [1], point: sombras ? [1, 1] : [], spot: [], spotLightMap: [], rectArea: [], hemi: [1], sunShadowMap: [],
    directionalShadowMap: [1], pointShadowMap: [], spotShadowMap: [], numSpotLightShadowsWithMaps: 0, numLightProbes: 0 };
  const escena = new THREE.Scene(); escena.fog = new THREE.Fog(0, 1, 100);
  return mesh => programas.getProgramCacheKey(programas.getParameters(mesh.material, luces, [1], escena, mesh, []));
}

test('precarga: cada malla del rebusque tiene su programa listo en la carga, la espuma RGBA incluida, y game.js lo pide', () => {
  const carroceria = new THREE.Group();
  carroceria.position.set(5, 0, 0); carroceria.rotation.y = Math.PI; carroceria.updateMatrixWorld(true);
  const car = { position: carroceria.position, group: { rotation: { y: Math.PI } }, length: 4.2, width: 1.8,
    vehicle: { model: 'sedanPopular', bodyVisual: carroceria, driverAnchor: { x: .1 }, driverDoor: { side: -1 } } };
  const { visual, game, scene } = montar({ traffic: { vehicles: [{ car }] } });
  // Pedir la precarga no arma los props ni cuenta como malla del rebusque: cuelga de la escena, apagada.
  const precarga = visual.preloadables;
  assert.ok(Array.isArray(precarga) && precarga.length > 0 && precarga.every(o => o.isObject3D));
  assert.equal(visual.mallas, 0);
  assert.equal(scene.getObjectByName('Rebusque: props'), undefined);
  assert.ok(precarga.every(o => o.parent === scene && !o.visible && !o.matrixWorldAutoUpdate), 'cuelga de la escena, apagada');
  assert.strictEqual(visual.preloadables[0], precarga[0], 'se arma una sola vez');
  assert.equal(scene.children.filter(o => o === precarga[0]).length, 1);
  // Lo que compilan prepareVariant y la subida automática de calidad: compileAsync(escena), que recorre aunque esté apagado.
  const enEscena = [];
  scene.traverse(o => { if (o.isMesh) enEscena.push(o); });
  // Se juegan todas las escenas para que existan todas las mallas de verdad.
  for (const escena of [
    { tipo: 'malabares', tiempo: 1, dur: 5, ritmo: new Ritmo(5), reacciones: [] },
    { tipo: 'vidrios', car, tiempo: 2, dur: 6, ritmo: null, reacciones: [] },
    { tipo: 'dulces', tiempo: 0, dur: 3, reacciones: [] },
    { tipo: 'cobro', trabajo: 'vidrios', tiempo: .9, dur: 2.6, reacciones: [{ car, vehicle: null, tipo: 'propina', t0: 0, pesos: 2000 }] }
  ]) { game.rebusque.escena = escena; visual.update(1 / 60); }
  const clave = claveDePrograma();
  const listas = new Set();
  for (const raiz of precarga) raiz.traverse(o => { if (o.isMesh) listas.add(`${o.material.uuid} ${clave(o)}`); });
  const reales = visual.group.children.filter(o => o.isMesh);
  assert.ok(reales.length >= 10, `${reales.length} mallas`);
  for (const mesh of reales) assert.ok(listas.has(`${mesh.material.uuid} ${clave(mesh)}`), `sin precarga: ${mesh.name}`);
  // Al cambiar las sombras (baja ↔ media) cambia el programa: la escena de antes del primer show ya tiene las dos variantes.
  for (const sombras of [true, false]) {
    const k = claveDePrograma({ sombras });
    const variante = new Set(enEscena.map(o => `${o.material.uuid} ${k(o)}`));
    for (const mesh of reales) assert.ok(variante.has(`${mesh.material.uuid} ${k(mesh)}`), `sin variante (sombras ${sombras}): ${mesh.name}`);
  }
  assert.notEqual(claveDePrograma({ sombras: true })(visual._espuma.mesh), claveDePrograma({ sombras: false })(visual._espuma.mesh),
    'las sombras cambian el programa de la espuma');
  // La espuma es la que no tenía con quién compartir programa: su variante RGBA tiene que estar.
  const espuma = visual._espuma.mesh;
  assert.equal(espuma.geometry.attributes.color.itemSize, 4);
  const opaca = new THREE.Mesh(new THREE.BoxGeometry(), espuma.material);
  assert.notEqual(clave(opaca), clave(espuma), 'sin el color RGBA sería otro programa');
  // El juego mete la precarga del rebusque en los modelos que compila Renderer.prepare.
  const fuente = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  const carga = fuente.slice(fuente.indexOf('const extraModels'), fuente.indexOf('this.renderer.prepare('));
  assert.match(carga, /extraModels\.push\(\.\.\.\(this\.rebusqueVisual\?\.preloadables/);
  visual.dispose();
  assert.equal(visual._precarga, null);
  assert.ok(precarga.every(o => o.parent === null), 'dispose la saca de la escena');
});
