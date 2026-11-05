// Un fuego alumbra de noche; al sol apenas se nota, para que nadie tenga la cara naranja al mediodía.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { fireBarrel, fritanga } = await import('../src/world/bogota/props.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { Cambuche } = await import('../src/entities/Cambuche.js');

const lightOf = group => { let found = null, count = 0; group.traverse(o => { if (o.isPointLight) { found = o; count++; } }); assert.equal(count, 1, 'una sola luz'); return found; };
const run = (group, seconds, from = 0, dt = 1 / 30, each = () => {}) => {
  for (let t = from; t < from + seconds; t += dt) { group.userData.update(dt, t); each(lightOf(group).intensity, t); }
  return from + seconds;
};

for (const [name, make, night] of [['la caneca', fireBarrel, 4.5], ['la fritanga', fritanga, 1.8]]) {
  test(`${name} baja de día sin saltos y sube otra vez de noche`, () => {
    const fire = make(), light = lightOf(fire);
    let t = run(fire, 2);
    assert.ok(light.intensity > night, `noche: ${light.intensity}`);
    fire.userData.setNight(false);
    let last = light.intensity, worst = 0;
    t = run(fire, 10, t, 1 / 30, value => { worst = Math.max(worst, Math.abs(value - last)); last = value; });
    assert.ok(light.intensity < night * .2, `día: ${light.intensity}`);
    assert.ok(worst < night * .04, `un salto de ${worst} en un cuadro`);
    fire.userData.setNight(true);
    run(fire, 10, t);
    assert.ok(light.intensity > night, `otra vez de noche: ${light.intensity}`);
  });

  test(`${name} no respira más rápido que medio ciclo por segundo`, () => {
    const fire = make();
    let peaks = 0, before = null, rising = false;
    run(fire, 60, 0, 1 / 60, value => {
      if (before !== null) { if (rising && value < before) peaks++; rising = value > before; }
      before = value;
    });
    assert.ok(peaks <= 30, `${peaks} picos en un minuto`);
  });
}

test('el fogón del cambuche también baja de día, y el juego le avisa', () => {
  const shelter = new Cambuche(new THREE.Scene(), new THREE.Vector3());
  const light = shelter.fireLight;
  for (let i = 0; i < 60; i++) shelter.update(1 / 30);
  assert.ok(light.intensity > 2.5);
  shelter.setNight(false);
  for (let i = 0; i < 300; i++) shelter.update(1 / 30);
  assert.ok(light.intensity < .5, `de día ${light.intensity}`);
  shelter.setNight(true);
  for (let i = 0; i < 300; i++) shelter.update(1 / 30);
  assert.ok(light.intensity > 2.5, `de noche ${light.intensity}`);
  shelter.dispose?.();
  const game = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.equal(game.match(/this\.cambuche\?\.setNight\(/g).length, 2, 'al entrar y al cambiar la hora');
});

test('nada del fogón del cambuche respira más rápido que medio ciclo por segundo', () => {
  const shelter = new Cambuche(new THREE.Scene(), new THREE.Vector3());
  const parts = { luz: () => shelter.fireLight.intensity, llama: () => shelter.fire.scale.y, vela: () => shelter.flame.scale.x };
  for (const [name, read] of Object.entries(parts)) {
    let peaks = 0, before = null, rising = false;
    for (let i = 0; i < 3600; i++) {
      shelter.update(1 / 60);
      const value = read();
      if (before !== null) { if (rising && value < before) peaks++; rising = value > before; }
      before = value;
    }
    assert.ok(peaks <= 30, `${name}: ${peaks} picos en un minuto`);
  }
  shelter.dispose?.();
});

test('quien entra de día no ve los fuegos bajando; quien ya está, sí los ve cambiar de a poco', () => {
  const fire = fireBarrel(), light = lightOf(fire);
  fire.userData.setNight(false);
  fire.userData.update(1 / 30, 0);
  assert.ok(light.intensity < 1, `de día desde el primer cuadro: ${light.intensity}`);
  const night = fireBarrel(), lit = lightOf(night);
  night.userData.setNight(true);
  night.userData.update(1 / 30, 0);
  assert.ok(lit.intensity > 4, `de noche desde el primer cuadro: ${lit.intensity}`);
  night.userData.setNight(false);
  night.userData.update(1 / 30, 1 / 30);
  assert.ok(lit.intensity > 3.5, `el aviso siguiente no salta: ${lit.intensity}`);
});

test('en la ciudad todas las canecas y fritangas obedecen a la hora, sin luces de más', () => {
  const city = new Bogota(), scene = new THREE.Scene();
  globalThis.window = new EventTarget();
  city.build(scene, new CollisionSystem());
  const fires = [];
  city.group.traverse(o => { if (o.isPointLight && [0xff8a2a, 0xff6a2a].includes(o.color.getHex())) fires.push(o); });
  assert.equal(fires.filter(light => light.color.getHex() === 0xff8a2a).length, city.fireBarrels.length);
  assert.ok(fires.length > city.fireBarrels.length, 'también las fritangas');
  const step = () => { for (let i = 0; i < 300; i++) for (const o of city.animated) o.userData.update(1 / 30, i / 30); };
  city.setNightMode(false);
  step();
  for (const light of fires) assert.ok(light.intensity < 1, `de día ${light.intensity}`);
  city.setNightMode(true);
  step();
  for (const light of fires) assert.ok(light.intensity > 1.8, `de noche ${light.intensity}`);
  city.dispose(scene);
});
