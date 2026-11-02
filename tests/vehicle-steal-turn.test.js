import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.window ??= new EventTarget();
const { Car } = await import('../src/entities/Car.js');
const { InteractionSystem } = await import('../src/systems/InteractionSystem.js');
const { StealSystem, CONFIG } = await import('../src/features/steal.js');
const { CAR_COOLDOWN, INTERACT_RANGE } = await import('../src/utils/constants.js');

const same = (a, b, message) => assert.ok(a === b, message);
const clock = { isNight: false };

/** Interacción y robo a peatones reales, en el orden en que los llama el juego, con el enlace del juego entre ambos. */
function scene({ npcs = [], targets = [], player = new THREE.Vector3() } = {}) {
  const pressed = new Set();
  const input = { consumePress: code => pressed.delete(code), isDown: () => false };
  const interaction = new InteractionSystem({ position: player }, { add: () => true }, { salud: 100, dinero: 0, addXP() {} }, { play() {} }, null, { getEffect: (_key, base) => base }, null);
  for (const target of targets) interaction.register(target);
  const steal = new StealSystem({ player: { position: player }, world: { active: { npcs } }, input, interaction, paused: false });
  interaction.personCloserThan = distance => steal.personCloserThan(distance);
  const frame = (key = null) => {
    if (key) pressed.add(key);
    interaction.update(.016, input, clock);
    steal.update(.016);
  };
  return { interaction, steal, frame };
}

function parkedCar(options = {}) {
  return new Car(new THREE.Scene(), new THREE.Vector3(), 0, { kind: 'carro', model: 'sedanPopular', variant: 3, ...options });
}

// Parado a 1,3 m del centro, frente a la puerta del carro.
const beside = () => new THREE.Vector3(0, 0, 1.3);

test('con una persona más cerca que el carro, el aviso y la E son del cosquilleo', () => {
  const car = parkedCar(), player = beside(), npc = { position: player.clone().add(new THREE.Vector3(.6, 0, 0)) };
  assert.ok(player.distanceTo(npc.position) < car.interactDistance(player), 'de partida la persona está más cerca');
  const { interaction, steal, frame } = scene({ npcs: [npc], targets: [car], player });
  frame(); frame();
  same(steal.targetNpc, npc);
  same(interaction.currentTarget, null, 'el carro cede el turno');
  assert.equal(interaction.currentTargetType, null);
  assert.match(interaction.stealPrompt, /Cosquilleo/, 'el aviso es el de la persona');
  frame('KeyE');
  assert.equal(steal.minigameActive, true, 'E empieza el cosquilleo');
  assert.equal(car.used, false, 'y no roba el espejo');
  car.dispose();
});

test('con la persona más lejos que el carro, el carro conserva su turno', () => {
  const car = parkedCar(), player = beside(), npc = { position: player.clone().add(new THREE.Vector3(1.6, 0, 0)) };
  assert.ok(player.distanceTo(npc.position) > car.interactDistance(player));
  const { interaction, steal, frame } = scene({ npcs: [npc], targets: [car], player });
  frame(); frame();
  same(interaction.currentTarget, car);
  frame('KeyE');
  assert.equal(car.used, true);
  assert.equal(steal.minigameActive, false);
  car.dispose();
});

test('mientras el cosquilleo está en enfriamiento el carro no cede: nadie más atendería la tecla', () => {
  const car = parkedCar(), player = beside(), npc = { position: player.clone().add(new THREE.Vector3(.6, 0, 0)) };
  const { interaction, steal, frame } = scene({ npcs: [npc], targets: [car], player });
  frame();
  steal.cooldown = CONFIG.globalCooldown;
  frame(); frame();
  same(interaction.currentTarget, car);
  assert.equal(interaction.stealPrompt, null);
  frame('KeyE');
  assert.equal(car.used, true);
  car.dispose();
});

test('sin ningún objetivo cerca, la E llega al cosquilleo', () => {
  const player = new THREE.Vector3(), npc = { position: new THREE.Vector3(1, 0, 0) };
  const { steal, frame } = scene({ npcs: [npc], player });
  frame();
  frame('KeyE');
  assert.equal(steal.minigameActive, true);
});

test('basura y tienda conservan su turno aunque la persona esté más cerca', () => {
  const player = new THREE.Vector3(), npc = { position: new THREE.Vector3(.4, 0, 0) };
  const trash = { position: new THREE.Vector3(1, 0, 0), harvest() {} };
  const shop = { kind: 'shop', position: new THREE.Vector3(1, 0, 0) };
  for (const target of [trash, shop]) {
    const { interaction, steal, frame } = scene({ npcs: [npc], targets: [target], player });
    frame(); frame();
    same(interaction.currentTarget, target);
    if (target === shop) {
      let opened = 0;
      const open = () => opened++;
      window.addEventListener('open-shop', open);
      frame('KeyE');
      window.removeEventListener('open-shop', open);
      assert.equal(opened, 1);
      assert.equal(steal.minigameActive, false);
    }
  }
});

test('una patrulla no da aviso de robo ni le quita el turno a lo que tenga al lado', () => {
  const car = parkedCar({ kind: 'police', traffic: true }), mirror = car.mirrors[0].position;
  const player = new THREE.Vector3(mirror.x, 0, mirror.z - .3);
  assert.equal(car.steal(), null);
  assert.ok(player.distanceTo(car.position) < INTERACT_RANGE, 'a la distancia de un carro robable');
  assert.ok(car.interactDistance(player) === player.distanceTo(car.position), 'sin el alcance extra del espejo');
  const { interaction, frame } = scene({ targets: [car], player });
  frame();
  same(interaction.currentTarget, null, 'sin aviso');
  const trash = { position: player.clone().add(new THREE.Vector3(1.5, 0, 0)), harvest() {} };
  interaction.register(trash);
  frame();
  same(interaction.currentTarget, trash, 'la basura tiene el turno');
  car.dispose();
});

test('un carro ya robado no da aviso hasta que reponen sus espejos', () => {
  const car = parkedCar(), player = beside();
  const { interaction, frame } = scene({ targets: [car], player });
  frame();
  same(interaction.currentTarget, car);
  frame('KeyE');
  assert.equal(car.used, true);
  frame();
  same(interaction.currentTarget, null, 'junto al centro ya no hay aviso');
  car.update(CAR_COOLDOWN + .1);
  frame();
  same(interaction.currentTarget, car, 'con espejos, vuelve');
  car.dispose();
});

test('con una persona más cerca que el perro, la E es del cosquilleo y no de la caricia', () => {
  const dog = { kind: 'dog', position: new THREE.Vector3(1.6, 0, 0) };
  const npc = { position: new THREE.Vector3(.8, 0, 0), _robadoTimer: 0, alerta: .3 };
  const { interaction, steal, frame } = scene({ npcs: [npc], targets: [dog] });
  frame();
  frame('KeyE');
  assert.equal(interaction.currentTargetType, null);
  assert.equal(steal.minigameActive, true);
});
