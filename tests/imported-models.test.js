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
const { setArticulatedBusAssets } = await import('../src/world/bogota/ArticulatedBusRig.js');
const { TrafficSignals } = await import('../src/world/bogota/TrafficSignals.js');

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

test('el respaldo GLB de carros conserva rumbo, robo y recursos compartidos al eliminar una instancia', async () => {
  const scene = new THREE.Scene();
  const cars = [new Car(scene, new THREE.Vector3(5, .1, 6), .7), new Car(scene, new THREE.Vector3(12, 0, 6))];
  // El aspecto administrado se conserva normalmente; aquí se fuerza la vía heredada de respaldo.
  cars.forEach(car => { car.modelKind = 'car1'; car.vehicle.model = 'sedan'; car.vehicle.visualManaged = false; });
  await Promise.all(cars.map(car => car.preloadModel()));
  assert.equal(loads.get('car1.opt.glb'), 1);
  const first = cars[0].importedModel.children[0].children[0].children[0];
  const second = cars[1].importedModel.children[0].children[0].children[0];
  assert.equal(first.geometry, second.geometry);
  assert.equal(first.material, second.material);
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

test('TransMilenio se arma con las piezas del bus articulado, se dobla en la ruta y mantiene el desvanecimiento aislado', async () => {
  const spec = JSON.parse(readFileSync(new URL('../public/models/bus-articulado/bus.json', import.meta.url), 'utf8'));
  const piece = () => {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ name: 'metal_rojo', metalness: 0.65 });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    return group;
  };
  const bellows = () => {
    const bones = ['F', 'M', 'R'].map((name, i) => { const bone = new THREE.Bone(); bone.name = name; bone.position.z = -i; return bone; });
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const group = new THREE.Group();
    group.add(mesh, ...bones);
    mesh.bind(new THREE.Skeleton(bones));
    return group;
  };
  setArticulatedBusAssets({ spec, sections: spec.sections.map(piece), bellows: spec.accordions.map(bellows), wheels: spec.wheels.map(piece), signTexture: null });
  const pathX = (z, x) => x + 6 * Math.sin(z / 9);
  const a = new BusService({ x: 10, startZ: 100, stationZ: 50, endZ: 0, pathX });
  const b = new BusService({ x: 16, startZ: 100, stationZ: 50, endZ: 0, pathX });
  await Promise.all([a.preloadModel(), b.preloadModel()]);
  assert.equal(a.group.userData.wheels.length, 6);
  const firstMaterial = [...a.materials.keys()][0], secondMaterial = [...b.materials.keys()][0];
  assert.notEqual(firstMaterial, secondMaterial);
  assert.ok([...a.materials.keys()].every(material => (material.metalness ?? 0) <= 0.3));
  a.position.z = 70; a._updateVisibility();
  assert.equal(firstMaterial.opacity, 1);
  assert.equal(secondMaterial.opacity, 0);
  const turned = a.rig.wheels[0].rotation.x;
  for (let i = 0; i < 100; i++) a.update(.1);
  assert.ok(a.position.z < 70);
  assert.notEqual(a.rig.wheels[0].rotation.x, turned);
  // en la curva las dos secciones apuntan a rumbos distintos (el bus se dobla en la articulacion)
  const [front, rear] = a.rig.sectionRoots;
  assert.ok(Math.abs(front.quaternion.angleTo(rear.quaternion)) > 1e-3);
  let disposed = false;
  secondMaterial.addEventListener('dispose', () => { disposed = true; });
  a.dispose(); assert.equal(disposed, false); b.dispose();
  assert.equal(disposed, true);
  setArticulatedBusAssets(null);
});

test('el bus por código cabe en su presupuesto, abre por la izquierda y recupera su vidrio tras desvanecerse', async () => {
  const spec = JSON.parse(readFileSync(new URL('../public/models/bus-articulado/bus.json', import.meta.url), 'utf8'));
  const { busGeometry, busTriangleCount, busWipers } = await import('../src/world/bogota/BusBody.js');
  setArticulatedBusAssets({ spec });
  const bus = new BusService({ x: 10, startZ: 100, stationZ: 50, endZ: 0 });
  await bus.preloadModel();
  let meshes = 0;
  bus.group.traverse(object => {
    assert.equal(object.isLight, undefined);
    if (object.isMesh) meshes++;
  });
  assert.ok(meshes <= 25, `llamadas de dibujo: ${meshes}`);
  assert.ok(busTriangleCount(spec) <= 30000, `triángulos: ${busTriangleCount(spec)}`);
  // Solo se mueven piezas de las puertas, y todas están al lado izquierdo del sentido de marcha (+X del modelo).
  let sliding = 0;
  for (const section of busGeometry(spec).sections) for (const geometry of [section.matte, section.glass]) {
    const slide = geometry.getAttribute('aSlide'), position = geometry.getAttribute('position');
    for (let i = 0; i < slide.count; i++) {
      if (slide.getX(i) === 0) continue;
      sliding++;
      assert.ok(position.getX(i) > 0, `vértice ${i} en X ${position.getX(i)}`);
    }
  }
  assert.ok(sliding > 0);
  // El limpiabrisas es lo único del caucho con pivote en la UV: va al frente, abajo, y barre sin material propio.
  const [frontMatte, rearMatte] = busGeometry(spec).sections.map(section => section.matte);
  let wiperVertices = 0;
  for (let i = 0; i < frontMatte.getAttribute('uv').count; i++) {
    if (frontMatte.getAttribute('uv').getY(i) <= .5) continue;
    wiperVertices++;
    assert.ok(frontMatte.getAttribute('position').getZ(i) > 10.5 && frontMatte.getAttribute('position').getY(i) < 1.5);
  }
  assert.ok(wiperVertices > 0);
  assert.ok(Array.from(rearMatte.getAttribute('uv').array).every(value => value === 0));
  busWipers.running = true;
  bus.rig._wipe(.3);
  assert.ok(bus.rig.wiperUniform.value > 0);
  busWipers.running = false;
  for (let i = 0; i < 12; i++) bus.rig._wipe(.2);
  assert.equal(bus.rig.wiperUniform.value, 0, 'al escampar vuelve a quedar parqueado');
  // Los materiales propios del bus se desvanecen y vuelven a su transparencia original.
  bus.position.z = 70; bus._updateVisibility();
  const materials = [...bus.materials.keys()];
  const glass = materials.find(material => material.transparent), solid = materials.find(material => !material.transparent);
  const glassDepth = glass.depthWrite, solidDepth = solid.depthWrite;
  bus.position.z = 97; bus._updateVisibility();
  assert.ok(solid.opacity > 0 && solid.opacity < 1);
  assert.equal(solid.transparent, true);
  assert.equal(solid.depthWrite, false);
  bus.position.z = 70; bus._updateVisibility();
  assert.equal(solid.opacity, 1);
  assert.equal(solid.transparent, false);
  assert.equal(solid.depthWrite, solidDepth);
  assert.equal(glass.transparent, true);
  assert.equal(glass.depthWrite, glassDepth);
  // Noche, puertas y frenado no dependen de que el bus tenga texturas de navegador.
  assert.doesNotThrow(() => { bus.setNight(true); bus.setNight(false); bus.rig.setDoors(1); bus.rig.setBraking(true); });
  bus.dispose();
  setArticulatedBusAssets(null);
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

test('las lentes del semáforo se iluminan en su modelo por código, sin descargar el GLB, discos flotantes ni luces dinámicas', async () => {
  const signals = new TrafficSignals();
  await signals.preloadModel();
  assert.equal(loads.get('semaforo.opt.glb') ?? 0, 0);
  const drawn = signals.poles.filter(pole => !pole.onRoadway);
  assert.equal(signals.poleMeshes.reduce((sum, mesh) => sum + mesh.count, 0), drawn.length);
  // Dos dibujos por sector: el poste y su resplandor, con el mismo atributo de fase.
  assert.equal(signals.haloMeshes.length, signals.poleMeshes.length);
  assert.equal(signals.group.children.length, signals.poleMeshes.length * 2);
  for (const pole of drawn) {
    const batch = signals.poleMeshes[pole.batchIndex];
    assert.equal(batch.geometry.getAttribute('trafficAxis').getX(pole.instanceIndex), pole.axis);
    assert.equal(signals.haloMeshes[pole.batchIndex].geometry.getAttribute('trafficAxis'), batch.geometry.getAttribute('trafficAxis'));
    assert.equal(batch.material, signals.poleMesh.material);
  }
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 50);
  camera.position.set(75, 8, 95); camera.lookAt(75, 0, 70); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const visible = signals.poleMeshes.filter(mesh => frustum.intersectsObject(mesh));
  assert.ok(visible.reduce((sum, mesh) => sum + mesh.count, 0) < drawn.length / 2);
  assert.ok([...signals.poleMeshes, ...signals.haloMeshes].every(mesh => mesh.frustumCulled && mesh.boundingSphere));
  let pointLights = 0;
  signals.group.traverse(object => { if (object.isLight) pointLights++; });
  assert.equal(pointLights, 0);
  const before = signals.lensStates.value.clone();
  signals.update(25);
  assert.ok(!signals.lensStates.value.equals(before));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  signals.poleMesh.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.trafficStates, signals.lensStates);
  assert.ok(shader.vertexShader.includes('signalLit(signalLens, trafficAxis)'));
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance += vSignalGlow'));
  assert.ok(signals.haloMeshes[0].material.blending === THREE.AdditiveBlending);
  assert.equal(signals.haloMeshes[0].material.uniforms.trafficStates, signals.lensStates);
  const bounds = new THREE.Box3().setFromObject(signals.group);
  assert.ok(Number.isFinite(bounds.min.x));
  assert.ok(bounds.max.y > 4);
  signals.dispose();
});
