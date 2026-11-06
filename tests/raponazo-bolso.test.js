// tests/raponazo-bolso.test.js
// El raponazo se lleva el bolso de verdad: al contacto deja de verse en la víctima y aparece en la mano del
// tirón, con el cuerpo procedural y con el realista; al final del gesto se guarda y no queda nada repetido.
// Si el tirón falla o se corta, el bolso se queda con ella. Sin bolso, el siguiente tirón va al bolsillo.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

// Los modelos de la víctima, de mentira: cada uno lleva su bolsa y sabe esconderla (setPropVisible).
const modelos = [];
const modelo = (look, { lod }) => {
  const group = new THREE.Group();
  const props = (look?.real?.accesorios ?? []).map(({ id }) => Object.assign(new THREE.Mesh(), { name: `prop-${id}` }));
  if (props.length) group.add(...props);
  const m = { group, lod, props, update() {}, snapPose() {}, hold() { return true; }, motionState() { return {}; }, applyMotion() {}, setSmoking() {}, dispose() {},
    setPropVisible(id, on) { for (const p of props) if (p.name === `prop-${id}`) p.visible = on; } };
  modelos.push(m);
  return m;
};
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async (look, opts = {}) => modelo(look, opts), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, real) => real, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });

const { Npc } = await import('../src/entities/Npc.js');
const { StealSystem } = await import('../src/features/steal.js');
const { manosOcupadas } = await import('../src/features/stealReactions.js');
const { GUARDA_RAPONAZO } = await import('../src/character/hurto.js');
const { createCharacter } = await import('../src/character/character.js');
const { attachStreetProps, sharedPropMaterial } = await import('../src/character/props.js');

beforeEach(() => { globalThis.window = new EventTarget(); modelos.length = 0; });

const conAzar = (valor, fn) => {
  const random = Math.random;
  Math.random = () => valor;
  try { return fn(); } finally { Math.random = random; }
};

/** Una víctima con su modelo completo: cadera, columna, cuello y el bolso de hombro de la calle. */
function victimaConBolso(escena, at = [0, 0, 1]) {
  const group = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; hips.position.y = 1;
  const spine = new THREE.Bone(); spine.name = 'mixamorigSpine2'; spine.position.y = .35;
  const neck = new THREE.Bone(); neck.name = 'mixamorigNeck'; neck.position.y = .2;
  hips.add(spine); spine.add(neck); group.add(hips);
  escena.add(group);
  group.position.set(...at);
  group.updateMatrixWorld(true);
  const bones = new Map([[hips.name, hips], [spine.name, spine], [neck.name, neck]]);
  const [bolso] = attachStreetProps(group, bones, [{ id: 'bolso', color: '#5a2f35' }], null, 'mujer');
  const quitado = [];
  const character = { group };
  const npc = {
    position: new THREE.Vector3(...at), radius: .4, _robadoTimer: 0, alerta: .5, character, fullChar: character,
    root: Object.assign(new THREE.Group(), { name: 'raiz-victima' }), look: { real: { edad: 'joven', accesorios: [{ id: 'bolso' }] } },
    alarmedByTheft() {}, quitarCarga(id) { quitado.push(id); }
  };
  return { npc, bolso, quitado };
}

/** El jugador con el cuerpo procedural de verdad, mirando a la víctima (+Z). */
function jugador(escena) {
  const root = new THREE.Group();
  const character = createCharacter();
  root.add(character.group);
  escena.add(root);
  return { position: root.position, root, character, velocity: new THREE.Vector3(), stealPose: null, faceTowards() {}, isStunned: false };
}

function juego() {
  const escena = new THREE.Scene();
  const player = jugador(escena);
  const game = { player, stats: { dinero: 0, salud: 100 }, inventory: { add: () => true }, world: { active: { npcs: [] } },
    input: { consumePress: () => false, axis: { x: 0, z: 0 } }, interaction: {} };
  return { escena, game, player, steal: new StealSystem(game) };
}

/** Las mallas de bolso que se ven en toda la escena: la de ella y la de la mano. */
function bolsosVisibles(escena) {
  const out = [];
  escena.traverseVisible(o => { if (o.isMesh && o.name.startsWith('prop-bolso')) out.push(o); });
  return out;
}

const avanzar = (steal, segundos, paso = 1 / 60) => { for (let t = 0; t < segundos - 1e-9; t += paso) steal.update(paso); };

test('al contacto el bolso deja de verse en ella y aparece en la mano del tirón; al guardarlo no queda nada', () => {
  const { escena, game, player, steal } = juego();
  const { npc, bolso, quitado } = victimaConBolso(escena);
  game.world.active.npcs.push(npc);
  conAzar(.9, () => steal.startRaponazo(npc));
  const lado = player.stealPose.lado;
  assert.equal(bolsosVisibles(escena).length, 1, 'antes del contacto lo tiene ella');
  conAzar(.9, () => avanzar(steal, .3));
  assert.ok(game.stats.dinero > 0, 'el tirón llegó');
  assert.equal(bolso.visible, false, 'ya no cuelga de ella');
  assert.deepEqual(quitado, ['bolso'], 'y la víctima lo sabe, para sus dos modelos');
  const visibles = bolsosVisibles(escena);
  assert.equal(visibles.length, 1, 'uno solo: el de la mano');
  const enLaMano = visibles[0];
  assert.equal(enLaMano.name, 'prop-bolso-arrancado');
  assert.equal(enLaMano.material, bolso.material, 'el mismo bolso, del mismo color, sin otro material');
  // En el antebrazo del lado del tirón: el procedural tiene el izquierdo en +X y el derecho en -X.
  const codo = enLaMano.parent;
  assert.equal(Math.sign(codo.parent.position.x), lado > 0 ? -1 : 1, 'en la mano que fue a buscarlo');
  // Cuelga derecho aunque el brazo vaya contra el pecho.
  avanzar(steal, .4);
  enLaMano.updateWorldMatrix(true, false);
  const arriba = new THREE.Vector3(0, 1, 0).applyQuaternion(enLaMano.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(arriba.y > .98, `cuelga derecho: ${arriba.toArray()}`);
  // Se guarda al final del gesto, antes de que el brazo vuelva al clip.
  avanzar(steal, GUARDA_RAPONAZO - .7 + .05);
  assert.equal(enLaMano.parent, null, 'guardado');
  assert.equal(bolsosVisibles(escena).length, 0, 'sin bolso repetido en ninguna parte');
  avanzar(steal, 1);
  assert.equal(player.stealPose, null);
  assert.equal(bolsosVisibles(escena).length, 0);
  player.character.dispose();
});

test('a quien ya le arrancaron el bolso, el siguiente tirón le va al bolsillo', () => {
  const { escena, game, player, steal } = juego();
  const { npc, bolso } = victimaConBolso(escena);
  game.world.active.npcs.push(npc);
  const tipos = [];
  const directo = steal.executeRoboDirecto.bind(steal);
  steal.executeRoboDirecto = (n, tipo) => { tipos.push(tipo); return directo(n, tipo); };
  conAzar(.9, () => steal.startRaponazo(npc));
  const alBolso = player.stealPose.objetivo.clone();
  const dondeEstaba = new THREE.Box3().setFromObject(bolso).getCenter(new THREE.Vector3()); // el cuerpo del bolso, junto a la cadera
  assert.ok(alBolso.distanceTo(dondeEstaba) < .25, 'el primero va al bolso');
  conAzar(.9, () => avanzar(steal, 3));
  assert.equal(bolso.visible, false);
  steal.cooldown = 0;
  conAzar(.9, () => steal.startRaponazo(npc));
  assert.ok(player.stealPose.objetivo.distanceTo(dondeEstaba) > .3, `ya no lo busca: ${player.stealPose.objetivo.toArray()}`);
  assert.ok(player.stealPose.objetivo.y < 1.2 && player.stealPose.objetivo.y > .9, 'al bolsillo, a la altura de la cadera');
  conAzar(.9, () => avanzar(steal, .3));
  assert.equal(bolsosVisibles(escena).length, 0, 'del bolsillo no sale ningún bolso');
  assert.equal(steal.coreo.arrancarBolsa(npc), null);
  // La víctima grita por lo que le quitaron: el bolso la primera vez, el bolsillo la segunda.
  assert.deepEqual(tipos, ['raponazo', 'raponazo-sin-bolso']);
  player.character.dispose();
});

test('si el tirón falla o se corta antes del contacto, el bolso se queda con ella', () => {
  // Falla: se alejó antes de que llegara la mano.
  const a = juego();
  const va = victimaConBolso(a.escena);
  a.game.world.active.npcs.push(va.npc);
  conAzar(.9, () => a.steal.startRaponazo(va.npc));
  va.npc.position.set(0, 0, 4);
  conAzar(.9, () => avanzar(a.steal, .5));
  assert.equal(a.game.stats.dinero, 0);
  assert.equal(va.bolso.visible, true, 'sigue colgado de ella');
  assert.deepEqual(va.quitado, []);
  assert.deepEqual(bolsosVisibles(a.escena), [va.bolso]);
  // Se corta: al volante o nadando, el tirón en vuelo se suelta sin robo.
  const b = juego();
  const vb = victimaConBolso(b.escena);
  b.game.world.active.npcs.push(vb.npc);
  conAzar(.9, () => b.steal.startRaponazo(vb.npc));
  b.steal.update(.1);
  b.steal.tick(.1);
  conAzar(.9, () => avanzar(b.steal, 1));
  assert.equal(b.game.stats.dinero, 0);
  assert.deepEqual(bolsosVisibles(b.escena), [vb.bolso]);
  // Ya en la mano, un arresto lo corta todo: se guarda y ella no lo recupera (ya se lo llevó).
  const c = juego();
  const vc = victimaConBolso(c.escena);
  c.game.world.active.npcs.push(vc.npc);
  conAzar(.9, () => c.steal.startRaponazo(vc.npc));
  conAzar(.9, () => avanzar(c.steal, .3));
  assert.equal(bolsosVisibles(c.escena).length, 1);
  c.steal.reiniciar();
  assert.equal(bolsosVisibles(c.escena).length, 0);
  for (const g of [a, b, c]) g.player.character.dispose();
});

test('con el cuerpo realista va en el marco de la mano y cuelga derecho aunque la muñeca esté torcida', () => {
  const { escena, game, player, steal } = juego();
  player.character.dispose();
  // Un cuerpo realista de mentira: `hold` lo ata al hueso de la mano, como RealisticCharacter.
  const group = new THREE.Group(), mano = new THREE.Bone();
  mano.position.set(-.3, 1.2, .3);
  mano.rotation.set(1.1, .4, -.7);
  group.add(mano);
  player.root.add(group);
  const poses = [];
  player.character = { group, hold(objeto, pose) { poses.push(pose); mano.add(objeto); return true; } };
  player.root.rotation.y = .5;
  const { npc } = victimaConBolso(escena, [Math.sin(.5), 0, Math.cos(.5)]);
  game.world.active.npcs.push(npc);
  conAzar(.9, () => steal.startRaponazo(npc));
  conAzar(.9, () => avanzar(steal, .9));
  const [enLaMano] = bolsosVisibles(escena);
  assert.equal(enLaMano?.parent, mano);
  assert.deepEqual(poses, [player.stealPose.lado > 0 ? 'cargar-derecha' : 'cargar-izquierda']);
  const q = enLaMano.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(q).y > .98, 'derecho');
  // Atravesado contra el pecho: su largo (Z del bolso) va de lado a lado del jugador.
  const largo = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const derecha = new THREE.Vector3(1, 0, 0).applyQuaternion(player.root.quaternion);
  assert.ok(Math.abs(largo.dot(derecha)) > .98, `atravesado: ${largo.toArray()}`);
  const escala = enLaMano.getWorldScale(new THREE.Vector3());
  assert.ok(Math.abs(escala.x - 1) < 1e-3 && Math.abs(escala.y - 1) < 1e-3, `del tamaño que tenía en ella: ${escala.toArray()}`);
});

test('quitarCarga lo esconde en el modelo liviano, en el completo y en el completo que llegue después', async () => {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(), { arquetipo: 'oficinista', groundHeight: () => 0 });
  await npc.ready;
  npc.person.real.accesorios = [{ id: 'maletin', color: '#2b2622' }];
  npc.style = npc.person.style = { carry: 'izquierda', swing: .3 };
  // El liviano ya está; el completo todavía no llega.
  const liviano = modelo({ real: npc.person.real }, { lod: true });
  npc.lodChar = liviano;
  assert.deepEqual(manosOcupadas(npc), { derecha: false, izquierda: true });
  npc.quitarCarga('maletin');
  assert.equal(liviano.props[0].visible, false, 'el liviano ya no lo lleva');
  npc.look = { real: npc.person.real };
  await npc._loadFull();
  assert.equal(npc.fullChar.lod, false);
  assert.equal(npc.fullChar.props[0].visible, false, 'el completo llega sin el maletín');
  assert.equal(npc.style.carry, null, 'el brazo deja de ir cargando');
  assert.equal(npc.style.swing, .3, 'lo demás de su andar sigue igual');
  assert.equal(npc.person.style.carry, null);
  assert.deepEqual(manosOcupadas(npc), { derecha: false, izquierda: false }, 'esa mano queda libre para cubrirse');
  // A otra persona no le pasa nada.
  const otra = new Npc(new THREE.Scene(), new THREE.Vector3(), { arquetipo: 'oficinista', groundHeight: () => 0 });
  await otra.ready;
  otra.person.real.accesorios = [{ id: 'maletin', color: '#2b2622' }];
  otra.style = otra.person.style = { carry: 'izquierda' };
  assert.equal(otra.style.carry, 'izquierda');
  assert.deepEqual(manosOcupadas(otra), { derecha: false, izquierda: true });
});

test('el bolso de la mano usa el material compartido de la víctima: guardarlo no libera nada', () => {
  const material = sharedPropMaterial('#5a2f35', .6);
  let liberado = false;
  material.addEventListener('dispose', () => { liberado = true; });
  const { escena, game, steal } = juego();
  const { npc } = victimaConBolso(escena);
  game.world.active.npcs.push(npc);
  conAzar(.9, () => steal.startRaponazo(npc));
  conAzar(.9, () => avanzar(steal, 3));
  assert.equal(liberado, false);
  game.player.character.dispose?.();
});
