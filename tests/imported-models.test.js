import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { IMPORTED_MODELS, fitImportedModel } from '../src/utils/ImportedModels.js';
import * as textures from '../src/world/bogota/textures.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { Car } = await import('../src/entities/Car.js');
const { Cambuche } = await import('../src/entities/Cambuche.js');
const { BusService } = await import('../src/world/bogota/BusService.js');
mock.module('../src/utils/signs.js',{namedExports:{signTexture:()=>new THREE.Texture(),signMesh:()=>new THREE.Group()}});
const { TrafficSignals } = await import('../src/world/bogota/TrafficSignals.js');
const { Pickup } = await import('../src/entities/Pickup.js');
const { instanceBatches, disposeInstanceBatches } = await import('../src/graphics/InstanceBatches.js');

// Lee posiciones e índices reales del GLB; las imágenes no requieren decodificador de navegador.
function geometryFromAsset(file) {
  const data = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  assert.equal(data.toString('ascii', 0, 4), 'glTF');
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));
  const binary = data.subarray(28 + jsonLength);
  assert.equal(json.nodes.length, 1);
  assert.equal(json.meshes[0].primitives.length, 1);
  const primitive = json.meshes[0].primitives[0];
  const geometry = new THREE.BufferGeometry();
  const accessor = json.accessors[primitive.attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const positions = new Float32Array(accessor.count * 3);
  for (let i = 0; i < accessor.count; i++) for (let axis = 0; axis < 3; axis++) {
    positions[i * 3 + axis] = binary.readFloatLE((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 12) + axis * 4);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const indices = json.accessors[primitive.indices];
  const indexView = json.bufferViews[indices.bufferView];
  const offset = (indexView.byteOffset ?? 0) + (indices.byteOffset ?? 0);
  const values = new Uint32Array(indices.count);
  for (let i = 0; i < indices.count; i++) values[i] = indices.componentType === 5125
    ? binary.readUInt32LE(offset + i * 4) : binary.readUInt16LE(offset + i * 2);
  geometry.setIndex(new THREE.BufferAttribute(values, 1));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: new THREE.Texture() })));
  return root;
}

const loads = new Map();
mock.method(GLTFLoader.prototype, 'loadAsync', async function(url) {
  const file = url.split('/').pop();
  loads.set(file, (loads.get(file) ?? 0) + 1);
  return { scene: geometryFromAsset(file) };
});

test('los GLB reales caben en las dimensiones actuales y descansan sobre Y=0', () => {
  for (const spec of Object.values(IMPORTED_MODELS)) {
    const model = fitImportedModel(geometryFromAsset(spec.file), spec);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    size.toArray().forEach((value, axis) => assert.ok(Math.abs(value - spec.size[axis]) < 1e-5));
    assert.ok(Math.abs(box.min.y) < 1e-6);
    if (!spec.anchor) {
      assert.ok(Math.abs(box.min.x + box.max.x) < 1e-6);
      assert.ok(Math.abs(box.min.z + box.max.z) < 1e-6);
    }
    model.traverse(object => { if (object.isMesh) assert.equal(object.userData.sharedImportedModel, true); });
  }
  const front = new THREE.Vector3(-1, 0, 0);
  assert.ok(front.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), IMPORTED_MODELS.car1.yaw).x > .99);
  assert.ok(front.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), IMPORTED_MODELS.transmilenio.yaw).z < -.99);
});

test('los carros usan la carrocería procedural del donante, comparten geometría y conservan rumbo y robo', async () => {
  const scene = new THREE.Scene();
  const cars = [new Car(scene, new THREE.Vector3(5, .1, 6), .7, { variant: 'sedan' }), new Car(scene, new THREE.Vector3(12, 0, 6), 0, { variant: 'sedan' })];
  // El modo antiguo (GLB) ya no existe: 'actual' y 'slop' dibujan el mismo vehículo del donante.
  await Promise.all(cars.map(car => car.setVisualMode('actual')));
  assert.equal(loads.get('car1.opt.glb'), undefined, 'no se cargan los modelos antiguos');
  const [first, second] = cars.map(car => car.vehicle.headlightFrame);
  assert.equal(first.geometry, second.geometry);
  assert.notEqual(first.material, second.material, 'cada carro conserva su pintura y estado de luces');
  let disposed = false;
  first.geometry.addEventListener('dispose', () => { disposed = true; });
  assert.equal(cars[0].group.rotation.y, .7);
  assert.deepEqual(cars[0].position.toArray(), [5, .1, 6]);
  assert.ok(cars[0].steal());
  cars[0].animateDrive(1, true);
  cars[0].dispose();
  assert.equal(disposed, false);
  assert.ok(scene.children.includes(cars[1].group));
  cars[1].dispose();
});

test('TransMilenio usa el GLB sin modificar su ruta y mantiene el desvanecimiento aislado', async () => {
  const a = new BusService({ x: 10, startZ: 100, stationZ: 50, endZ: 0 });
  const b = new BusService({ x: 16, startZ: 100, stationZ: 50, endZ: 0 });
  await Promise.all([a.preloadModel(), b.preloadModel()]);
  assert.equal(loads.get('tm.opt.glb'), 1);
  const firstMaterial = [...a.materials.keys()][0], secondMaterial = [...b.materials.keys()][0];
  assert.notEqual(firstMaterial, secondMaterial);
  a.position.z = 70; a._updateVisibility();
  assert.equal(firstMaterial.opacity, 1);
  assert.equal(secondMaterial.opacity, 0);
  for (let i = 0; i < 100; i++) a.update(.1);
  assert.ok(a.position.z < 70);
  assert.equal(a.position.x, 10);
  let disposed = false;
  secondMaterial.addEventListener('dispose', () => { disposed = true; });
  a.dispose(); assert.equal(disposed, false); b.dispose();
});

test('el cambuche permanece oculto hasta construir base y techo y conserva las mejoras', async () => {
  const shelter = new Cambuche(new THREE.Scene(), new THREE.Vector3());
  shelter.setBuilt({});
  await shelter.preloadModel();
  assert.equal(shelter.model.visible, false);
  assert.equal(shelter.markerPile.visible, true);
  assert.equal(shelter.pieces.base.visible, false);
  assert.deepEqual(shelter.built, {});
  shelter.setBuilt({ base: true });
  assert.equal(shelter.markerPile.visible, false);
  assert.equal(shelter.model.visible, false);
  assert.equal(shelter.pieces.base.visible, true);
  shelter.setBuilt({ base: true, techo: true, fogon: true });
  assert.equal(shelter.model.visible, true);
  assert.equal(shelter.pieces.techo.visible, false);
  assert.equal(shelter.pieces.base.visible, false);
  assert.equal(shelter.pieces.fogon.visible, true);
  assert.equal(shelter.built.paredes, undefined);
  assert.equal(shelter.built.cama, undefined);
  shelter.setBuilt({ base: true, cama: true });
  assert.equal(shelter.model.visible, false);
  assert.equal(shelter.pieces.cama.visible, true);
  assert.equal(shelter.built.cama, true);
  shelter.dispose();
});

test('las lentes del semáforo se iluminan sobre el GLB, sin discos flotantes ni luces dinámicas', async () => {
  const signals = new TrafficSignals();
  await signals.preloadModel();
  assert.equal(signals.poleMeshes.reduce((sum, mesh) => sum + mesh.count, 0), signals.poles.length);
  assert.ok(signals.poleMeshes.length > 1, 'los semáforos se reparten por celdas para que el descarte y las sombras los separen');
  assert.equal(signals.group.children.length, signals.poleMeshes.length + (signals.stopSigns?.length ?? 0));
  for (const pole of signals.poles) {
    const batch = signals.poleMeshes[pole.batchIndex];
    assert.equal(batch.geometry.getAttribute('trafficAxis').getX(pole.instanceIndex), pole.axis);
    assert.equal(batch.material, signals.poleMesh.material);
  }
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 50);
  camera.position.set(75, 8, 95); camera.lookAt(75, 0, 70); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const visible = signals.poleMeshes.filter(mesh => frustum.intersectsObject(mesh));
  // Con lotes de 96 m (STATIC_CHUNK_SIZE) la vista no dibuja todos los semáforos de la ciudad.
  assert.ok(visible.reduce((sum, mesh) => sum + mesh.count, 0) < signals.poles.length);
  assert.ok(signals.poleMeshes.every(mesh => mesh.frustumCulled && mesh.boundingSphere));
  let pointLights = 0;
  signals.group.traverse(object => { if (object.isLight) pointLights++; });
  assert.equal(pointLights, 0);
  const before = signals.lensStates.value.clone();
  signals.update(25);
  assert.ok(!signals.lensStates.value.equals(before));
  assert.equal(signals.poleMesh.material.isMeshStandardNodeMaterial,true);
  assert.equal(signals.poleMesh.material.userData.trafficStates.value,signals.lensStates.value);
  assert.ok(signals.poleMesh.material.colorNode);assert.ok(signals.poleMesh.material.emissiveNode);
  const bounds = new THREE.Box3().setFromObject(signals.group);
  assert.ok(Number.isFinite(bounds.min.x));
  assert.ok(bounds.max.y > 4);
  signals.dispose();
});

test('bolsas y contenedores se dibujan en lotes que siguen recogida, reaparición y reubicación', async () => {
  const scene = new THREE.Scene();
  const bags = [new Pickup(scene, new THREE.Vector3(1, 0, 1)), new Pickup(scene, new THREE.Vector3(9, 0, 4))];
  const bin = new Pickup(scene, new THREE.Vector3(20, 0, 2), { modelKind: 'contenedor', cooldown: 5 });
  await Promise.all([...bags, bin].map(p => p.preloadModel()));
  const batches = instanceBatches(scene);
  batches.sync();
  const lot = mesh => [...batches.groups.values()].find(g => g.members.has(mesh)).mesh;
  const bagModel = bags[0].mesh.getObjectByProperty('isMesh', true), binModel = bin.mesh.getObjectByProperty('isMesh', true);
  assert.equal(lot(bagModel), lot(bags[1].mesh.getObjectByProperty('isMesh', true)), 'las bolsas comparten un lote');
  assert.notEqual(lot(bagModel), lot(binModel));
  assert.equal(lot(bagModel).count, 2);assert.equal(lot(binModel).count, 1);assert.equal(lot(bags[0].marker).count, 3);
  assert.equal(lot(bagModel).castShadow, true);
  assert.ok([bagModel, binModel, bags[0].marker].every(o => o.layers.mask === 0 && o.visible), 'el estado visible se conserva; solo el lote se dibuja');
  const matrix = new THREE.Matrix4();lot(binModel).getMatrixAt(0, matrix);
  binModel.updateWorldMatrix(true, false);assert.ok(matrix.elements.every((v, i) => Math.abs(v - binModel.matrixWorld.elements[i]) < 1e-5));

  assert.ok(bin.harvest());batches.sync();
  assert.equal(lot(binModel).count, 0, 'recogido: desaparece del lote');assert.equal(lot(bags[0].marker).count, 2);
  bin.onRespawn = pickup => pickup.relocate(new THREE.Vector3(40, 0, 8));
  bin.update(6);batches.sync();
  assert.equal(lot(binModel).count, 1, 'reaparece');lot(binModel).getMatrixAt(0, matrix);
  binModel.updateWorldMatrix(true, false);
  assert.ok(Math.abs(matrix.elements[12] - binModel.matrixWorld.elements[12]) < 1e-5 && Math.abs(bin.position.x - 40) < 1e-9, 'en su nuevo sitio');

  bags[1].group.visible = false;batches.sync();
  assert.equal(lot(bagModel).count, 1, 'lo descartado por el frustum no entra en el lote');bags[1].group.visible = true;

  bags[0].dispose();batches.sync();
  assert.equal(bagModel.layers.mask, 1);assert.equal(lot(bags[1].mesh.getObjectByProperty('isMesh', true)).count, 1);
  bags[1].dispose();bin.dispose();disposeInstanceBatches(scene);
  assert.equal(batches.root.parent, null);
});

test('los objetos sueltos lejanos se dibujan sin sombra y los lotes vacíos se ocultan tras el calentamiento', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const mesh = (x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); m.castShadow = true; m.position.x = x; scene.add(m); m.updateMatrixWorld(); return m; };
  const nearOne = mesh(5), farOne = mesh(200);
  const batches = instanceBatches(scene);
  batches.add(nearOne, 'k');batches.add(farOne, 'k');
  batches.sync(camera);
  const group = [...batches.groups.values()][0];
  assert.equal(group.mesh.count, 1);assert.equal(group.mesh.castShadow, true);
  assert.equal(group.far.count, 1);assert.equal(group.far.castShadow, false, 'el lejano se dibuja sin sombra');
  assert.equal(group.far.visible, true, 'durante el calentamiento los lotes se dibujan aunque estén vacíos');
  scene.userData.skipEmptyBatches = true;
  farOne.visible = false;
  batches.sync(camera);
  assert.equal(group.far.visible, false, 'tras el calentamiento un lote vacío no cuesta dibujo');
  disposeInstanceBatches(scene);
});
