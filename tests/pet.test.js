// tests/pet.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Pet, CONFIG } from '../src/features/pet.js';
import { Dog } from '../src/entities/Dog.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); }
  };
});

test('Pet sigue suavemente al jugador y se teletransporta si queda muy lejos', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0) };
  const pet = new Pet(scene, player);

  pet.position.set(3, 0, 0);
  pet.update(0.1, player.position, []);
  assert.equal(pet.state, 'follow');
  assert.ok(pet.position.x < 3);

  pet.position.set(40, 0, 0);
  pet.update(0.1, player.position, []);
  assert.ok(pet.position.distanceTo(player.position) < CONFIG.teleportDist);
});

test('Pet entra en alerta si hay un NPC sospechoso cerca', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0) };
  const pet = new Pet(scene, player);
  pet.position.set(0, 0, 0);
  const suspiciousNpc = { position: new THREE.Vector3(1, 0, 1), alerta: 0.8 };

  pet.update(0.1, player.position, [suspiciousNpc]);
  assert.equal(pet.state, 'alerta');
});

test('Pet aplica y persiste personalización de nombre, color y accesorios', () => {
  const scene = new THREE.Scene();
  const pet = new Pet(scene, { position: new THREE.Vector3() });

  pet.applyCustomization({
    nombre: 'Rex',
    color: '#3498db',
    accesorio: 'collar',
    tamano: 1.2
  });

  assert.equal(pet.nombre, 'Rex');
  assert.equal(pet.color, '#3498db');
  assert.equal(pet.accesorio, 'collar');
  assert.equal(pet.tamano, 1.2);
  assert.equal(pet.getDistractionBonus(), 0.10);

  const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey));
  assert.equal(saved.nombre, 'Rex');
  assert.equal(saved.accesorio, 'collar');
});

test('Pet vinculado a Dog unifica el modelo en escena sin duplicar mallas', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0) };
  const pet = new Pet(null, player);
  const dog = new Dog(scene, new THREE.Vector3(4, 0, 4));

  pet.attachDog(dog);
  assert.equal(scene.children.length, 1, 'Solo existe un perro en la escena 3D');
  assert.equal(pet.group, dog.group);
  assert.equal(pet.getDistractionBonus(), 0, 'Sin amistad aún no da bono de distracción');

  dog.befriend();
  assert.equal(pet.getDistractionBonus(), 0.10, 'Al hacerse amigo otorga bono de distracción');

  pet.applyCustomization({ nombre: 'Parcerito', color: '#5c3317', accesorio: 'gorra', tamano: 1.1 });
  assert.equal(dog.title, 'Parcerito');
  assert.equal(dog.accesorio, 'gorra');
});
