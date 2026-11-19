import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BuildingVisibility, createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { Batch } from '../src/world/bogota/ZoneGeometry.js';
import { withVisualRandom } from '../src/world/bogota/VisualRandom.js';
import { rng } from '../src/world/bogota/textures.js';

function mount(decorate) {
  const original = Math.random;
  Math.random = rng(27176);
  try {
    const wall = new THREE.MeshStandardMaterial(), roof = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry(8, 5, 8);
    const shell = createBuildingShell(geometry, [wall, wall, roof, roof, wall, wall], { x: 1, z: 1, height: 5, interiorMaterial: wall });
    if (decorate) {
      const colored = withVisualRandom(() => new THREE.MeshStandardMaterial());
      for (const id of [0, 1]) {
        const batch = new Batch(), f = batch.frame(id, 4);
        f.panel(wall, 0, 1, .1, .6, 2);
        f.panel(roof, 1, 1, .1, .6, 2);
        f.panel(colored, -1, 1, .1, .6, 2);
        batch.finish(shell.walls.get(id), { visualOnly: true });
      }
    }
    const visibility = new BuildingVisibility();
    visibility.register(shell);
    const closed = visibility.buildClosedView();
    const state = Array.from({ length: 8 }, () => Math.random());
    const resources = new Set();
    for (const tree of [shell.root, closed]) tree.traverse(object => {
      resources.add(object);
      if (object.isMesh) { resources.add(object.geometry); resources.add(object.material); }
    });
    assert.equal(new Set([...resources].map(resource => resource.uuid)).size, resources.size);
    return state;
  } finally { Math.random = original; }
}

test('agregar un detalle a un lote mixto o propio conserva la secuencia del juego y deja UUID únicos', () => {
  assert.deepEqual(mount(true), mount(false));
});

test('se restaura la fuente de azar al fallar una construcción visual anidada', () => {
  const original = Math.random;
  assert.throws(() => withVisualRandom(() => withVisualRandom(() => { throw new Error('fallo de montaje'); })), /fallo de montaje/);
  assert.equal(Math.random, original);
});
