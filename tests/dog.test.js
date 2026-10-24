import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Dog, CENTRAL_PARK_BOUNDS, deriveDogPalette } from '../src/entities/Dog.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); }
  };
});

test('Dog inicializa con posición, anatomía articulada y estado neutral', () => {
  const scene = new THREE.Scene();
  const dog = new Dog(scene, new THREE.Vector3(10, 0, 20));

  assert.equal(dog.kind, 'dog');
  assert.equal(dog.title, 'El Chato');
  assert.equal(dog.isFriend, false);
  assert.equal(dog.position.x, 10);
  assert.equal(dog.position.z, 20);
  assert.ok(dog.group.children.length > 5, 'El modelo 3D tiene tórax, abdomen, cuello, cabeza, patas y cola');
  assert.ok(dog.body && dog.abdomen && dog.chestPatch && dog.neck && dog.head && dog.tail);
  assert.ok(dog.legFL?.userData?.lowerJoint && dog.legBL?.userData?.lowerJoint, 'Las patas tienen articulación inferior (carpo/corvejón)');
});

test('Dog merodea con vida dentro del parque sin salir a la calle cuando aún no es amigo', () => {
  const scene = new THREE.Scene();
  const start = new THREE.Vector3(114, 0, 98);
  const dog = new Dog(scene, start);
  const playerFar = new THREE.Vector3(40, 0, 40);

  let moved = false;
  for (let i = 0; i < 240; i++) {
    dog.update(0.1, playerFar, []);
    if (dog.position.distanceTo(start) > 0.3) moved = true;
    assert.ok(
      dog.position.x >= CENTRAL_PARK_BOUNDS.minX && dog.position.x <= CENTRAL_PARK_BOUNDS.maxX &&
      dog.position.z >= CENTRAL_PARK_BOUNDS.minZ && dog.position.z <= CENTRAL_PARK_BOUNDS.maxZ,
      `El Chato nunca sale de los límites del parque: (${dog.position.x}, ${dog.position.z})`
    );
  }
  assert.equal(moved, true, 'El Chato camina y explora orgánicamente dentro del parque');
});

test('Dog se hace amigo, reacciona a caricias y flexiona articulaciones al caminar', () => {
  const scene = new THREE.Scene();
  const dog = new Dog(scene, new THREE.Vector3(0, 0, 0));

  dog.pet();
  assert.equal(dog.isFriend, false);

  dog.befriend();
  assert.equal(dog.isFriend, true);

  // Al estar lejos (>2.4m), camina hacia el jugador y articula hombros/corvejones
  const playerPos = new THREE.Vector3(10, 0, 0);
  dog.update(0.1, playerPos, []);
  assert.ok(dog.position.x > 0, 'El perro se acerca al jugador');
  assert.notEqual(dog.legFL.rotation.x, 0, 'El hombro delantero rota al caminar');
});

test('Dog emite alerta e inclina la cabeza al olfatear basura cercana', () => {
  const scene = new THREE.Scene();
  const dog = new Dog(scene, new THREE.Vector3(0, 0, 0));
  dog.befriend();

  let alerted = false;
  const listener = (e) => {
    if (e.detail?.text?.includes('El Chato')) alerted = true;
  };
  globalThis.window.addEventListener('toast', listener);

  dog._barkTimer = 11;
  const pickups = [{ position: new THREE.Vector3(3, 0, 3) }];
  dog.update(0.1, new THREE.Vector3(1, 0, 1), pickups);

  assert.equal(alerted, true, 'El perro avisa cuando hay loot cerca');
  assert.ok(dog._sniffTimer > 0, 'Activa animación de olfateo');
  globalThis.window.removeEventListener('toast', listener);
});

test('Dog permite personalizar pelaje, nombre, accesorio y deriva paleta de tonos', () => {
  const scene = new THREE.Scene();
  const dog = new Dog(scene, new THREE.Vector3(0, 0, 0));
  const palette = deriveDogPalette('#965a28');
  assert.notEqual(palette.coat, palette.undercoat);
  assert.notEqual(palette.coat, palette.saddle);

  dog.applyCustomization({
    nombre: 'Chandoso',
    color: '#2b2623',
    accesorio: 'collar',
    tamano: 1.15
  });

  assert.equal(dog.title, 'Chandoso');
  assert.equal(dog.color, '#2b2623');
  assert.equal(dog.accesorio, 'collar');
  assert.equal(dog.tamano, 1.15);
  assert.ok(Math.abs(dog.group.scale.x - 1.15) < 1e-6);
});

test('Dog esquiva bancas y obstaculos en el parque sin quedarse trabado', () => {
  const scene = new THREE.Scene();
  const dog = new Dog(scene, new THREE.Vector3(113, 0, 98));

  const benchBox = new THREE.Box3(
    new THREE.Vector3(112.2, 0.06, 100.075),
    new THREE.Vector3(113.8, 0.96, 100.725)
  );
  dog.navigation = {
    collisions: {
      colliders: [{ box: benchBox }],
      resolveMove(pos, delta, radius, outPos) {
        const nextX = pos.x + delta.x;
        const nextZ = pos.z + delta.z;
        if (nextX > benchBox.min.x - radius && nextX < benchBox.max.x + radius &&
            nextZ > benchBox.min.z - radius && nextZ < benchBox.max.z + radius) {
          outPos.copy(pos);
        } else {
          outPos.set(nextX, pos.y, nextZ);
        }
      }
    },
    district: {
      map: Array.from({ length: 80 }, () => Array(80).fill('grass')),
      getGroundHeight: () => 0
    }
  };

  dog._roamState = 'wander';
  dog._roamTimer = 5.0;
  dog._roamTarget = new THREE.Vector3(113, 0, 102);

  let transitioned = false;
  let stayedFree = true;

  for (let f = 0; f < 35; f++) {
    dog.update(0.05, new THREE.Vector3(50, 0, 50), []);
    if (dog._roamState === 'sniff' || dog._roamState === 'look') {
      transitioned = true;
    }
    const inside = dog.position.x > benchBox.min.x && dog.position.x < benchBox.max.x &&
                   dog.position.z > benchBox.min.z && dog.position.z < benchBox.max.z;
    if (inside) stayedFree = false;
  }

  assert.equal(stayedFree, true, 'El perro nunca atraviesa la banca');
  assert.ok(transitioned || Math.abs(dog.position.x - 113) > 0.8, 'El perro bordea la banca o cambia de rumbo olfateando');
});
