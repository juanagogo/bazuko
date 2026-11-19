import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingShell, BuildingVisibility } from '../src/world/bogota/BuildingVisibility.js';
import { addBuildingDetails } from '../src/world/bogota/BuildingDetails.js';
import { localDelSolar } from '../src/world/bogota/Locales.js';

const SEED = 4260001612;
const SITE = { x: 204, z: 5, height: 6 };

function shop(state = 'abierta', id = 'panaderia') {
  const material = new THREE.MeshStandardMaterial();
  const shell = createBuildingShell(new THREE.BoxGeometry(6, SITE.height, 8), Array(6).fill(material), {
    ...SITE, interiorMaterial: material, facadeFace: 0, wallInteriorMaterial: material, wallInteriorUV: [3, 3]
  });
  const local = { ...localDelSolar({ seed: SEED, paso: 1, x: SITE.x, z: SITE.z }), estado: state, id, conAviso: false };
  addBuildingDetails({ shell, width: 6, depth: 8, height: SITE.height, floors: 2, face: 0, seed: SEED, local });
  shell.root.updateMatrixWorld(true);
  return shell;
}

function sight(wall, height, z) {
  const ray = new THREE.Raycaster(new THREE.Vector3(209.5, height, z), new THREE.Vector3(-1, 0, 0));
  return ray.intersectObject(wall, true);
}

test('el vano abierto de Pan de las Cinco tiene profundidad y conserva la persiana vecina', () => {
  const shell = shop(), wall = shell.walls.get(0);
  assert.equal(shell.root.userData.local.nombre, 'PAN DE LAS CINCO');
  const front = sight(wall, 1.44, 6.37);
  const closedSide = sight(wall, 1.44, 2.53);
  assert.equal(front[0].object.name, 'Vidrio de Pan de las Cinco');
  assert.equal(front[1].object.name, 'Mostrador y bandejas de Pan de las Cinco');
  assert.ok(front[0].point.x - front[1].point.x > .14, 'el volumen queda detrás del vidrio y de la fachada antigua');
  assert.equal(closedSide[0].object.name, 'Fachada con vida');
  for (const control of [shop('media'), shop('cerrada'), shop('abierta', 'cafeteria')]) {
    assert.equal(sight(control.walls.get(0), 1.44, 6.37)[0].object.name, 'Fachada con vida');
  }
});

test('panes, carpintería y bandejas reúnen su geometría y acabado en la vista agrupada', () => {
  const shell = shop(), visibility = new BuildingVisibility();
  visibility.register(shell);
  const batch = visibility.buildClosedView().children.find(mesh => mesh.geometry.attributes.bakerySurface);
  assert.ok(batch, 'la vista agrupada que usa tercera persona conserva la vitrina');
  const { bakerySurface, position, color } = batch.geometry.attributes;
  assert.equal(bakerySurface.count, position.count);
  assert.equal(color.count, position.count);
  let nearBread = -Infinity, breadLight = 0, backLight = 0;
  const finishes = new Set();
  for (let i = 0; i < bakerySurface.count; i++) {
    const type = bakerySurface.getX(i);
    finishes.add(type);
    if (type === 3) {
      nearBread = Math.max(nearBread, position.getX(i));
      breadLight = Math.max(breadLight, bakerySurface.getY(i));
    } else if (type === 0 && position.getX(i) < 205.58) {
      backLight = Math.max(backLight, bakerySurface.getY(i));
    }
  }
  assert.deepEqual([...finishes].sort(), [0, 1, 2, 3]);
  assert.ok(nearBread < 206.78, 'el pan queda detrás del cristal situado en X206,823');
  assert.ok(backLight > 0 && breadLight > backLight * 2.4, 'el tubo se concentra en la mercancía, con rebote tenue atrás');
  assert.ok(batch.geometry.index.count / 3 <= 5_400, 'la profundidad se concentra en un solo lote opaco');
  assert.ok(position.array.every(Number.isFinite) && color.array.every(Number.isFinite));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  batch.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /vBakerySurface = bakerySurface/);
  assert.match(shader.fragmentShader, /metalnessFactor = \.59 \* steel/);
  assert.equal(batch.material.emissiveIntensity, 0);
  assert.ok(batch.material.userData.windowGlow > 0, 'entra al mismo encendido de vitrinas de la ciudad');
});
