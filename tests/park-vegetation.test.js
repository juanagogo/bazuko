import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { LAKE_PARK, buildLakeWater, onLakeBridge } from '../src/world/bogota/LakePark.js';
import { freezeStaticTransforms, createRenderSectors } from '../src/world/bogota/StaticGeometry.js';
import { PARK_VEGETATION, planParkVegetation, buildParkVegetation, lakeVegetationMask } from '../src/world/bogota/ParkVegetation.js';

function parkMap() {
  return new Bogota()._layout();
}
const city = new Bogota(); city.map = parkMap();
const groundHeight = (x, z) => city.getGroundHeight(x, z);
const tileAt = (map, x, z) => map[Math.round(z / 2)]?.[Math.round(x / 2)];
const lakeRadius = (x, z) => Math.hypot((x - LAKE_PARK.lakeX) / LAKE_PARK.radiusX,
  (z - LAKE_PARK.lakeZ) / LAKE_PARK.radiusZ);
const waterAt = (x, z) => lakeRadius(x, z) < 1 || tileAt(city.map, x, z) === 'water';
const options = () => ({ map: parkMap(), groundHeight, getWaterInfo: waterAt });
const fullPlan = () => planParkVegetation(options());

function sampleFootprint(cluster, callback) {
  const radius = cluster.radius + PARK_VEGETATION.windBounds + PARK_VEGETATION.clearance;
  for (let iz = 0; iz <= 8; iz++) for (let ix = 0; ix <= 8; ix++) {
    callback(cluster.x - radius + 2 * radius * ix / 8, cluster.z - radius + 2 * radius * iz / 8);
  }
}

test('la vegetación usa semilla propia, deja claros y reparte el presupuesto entre parques', () => {
  const opts = options(), before = structuredClone(opts.map), originalRandom = Math.random;
  let plan;
  try {
    Math.random = () => { throw new Error('La planificación no puede consumir el azar del juego'); };
    plan = planParkVegetation(opts);
  } finally { Math.random = originalRandom; }
  const group = buildParkVegetation(plan);
  assert.deepEqual(planParkVegetation(opts), plan, 'crear materiales/UUID no cambia la distribución');
  assert.deepEqual(opts.map, before, 'no pinta tiles ni altera navegación');
  assert.equal(plan.clusters.length, PARK_VEGETATION.maxClusters);
  assert.ok(plan.metrics.maxHeight < .7);
  assert.ok(plan.metrics.coveredArea < 150, 'conserva amplias zonas de césped libre');
  assert.ok(plan.clusters.filter(plant => plant.z >= LAKE_PARK.z0).length > 150);
  assert.ok(plan.clusters.filter(plant => plant.z < 222 && plant.x > 180).length > 10);
  assert.ok(plan.clusters.filter(plant => plant.z > 150 && plant.z < 222).length > 10);
  assert.ok(plan.metrics.kinds.flowers > 0 && plan.metrics.kinds.flowers <= plan.clusters.length * .1);
  assert.ok(plan.metrics.kinds.reeds > 0 && plan.metrics.kinds.shrub > 0);
  const perSector = new Map();
  for (const plant of plan.clusters) perSector.set(plant.sector, (perSector.get(plant.sector) ?? 0) + 1);
  assert.ok([...perSector.values()].every(count => count <= PARK_VEGETATION.maxPerSector));
  assert.ok(plan.clusters.filter(plant => plan.clusters.some(other => other !== plant &&
    Math.hypot(other.x - plant.x, other.z - plant.z) < 2.5)).length > plan.clusters.length * .8,
  'los ejemplares se agrupan en lugar de formar una cuadrícula dispersa');
  group.userData.dispose();
});

test('toda la huella, incluido el viento, respeta césped, agua, paseos y reserva del cambuche', () => {
  const opts = options(), plan = planParkVegetation(opts), shelter = PARK_VEGETATION.shelter;
  for (const plant of plan.clusters) {
    assert.ok(Number.isFinite(plant.y) && plant.y <= 1.2 && plant.y >= -.18);
    sampleFootprint(plant, (x, z) => {
      assert.equal(tileAt(opts.map, x, z), 'grass', `${plant.kind} invade un tile de ${tileAt(opts.map, x, z)}`);
      assert.equal(waterAt(x, z), false, `${plant.kind} invade el agua`);
      assert.equal(onLakeBridge(x, z), false, `${plant.kind} invade la rampa del puente`);
      assert.ok(Math.hypot(x - shelter.x, z - shelter.z) > 7);
    });
    if (plant.kind === 'reeds') assert.ok(lakeRadius(plant.x, plant.z) > 1 && lakeRadius(plant.x, plant.z) < 1.095);
  }
});

test('la máscara predeterminada protege la elipse visual sin necesitar física ni profundidad de agua', () => {
  const material = new THREE.MeshStandardMaterial(), water = buildLakeWater(material);
  assert.equal(water.position.y, -.18);
  assert.equal(lakeVegetationMask(water.position.x, water.position.z), true);
  assert.equal(lakeVegetationMask(water.position.x + water.scale.x + .01, water.position.z), false);
  const map = parkMap();
  for (let row = 112; row < map.length - 1; row++) {
    for (let col = 1; col < map[row].length - 1; col++) if (map[row][col] === 'water') map[row][col] = 'grass';
  }
  const plan = planParkVegetation({ map, groundHeight: () => .06 });
  assert.ok(plan.clusters.length > 0);
  for (const plant of plan.clusters) sampleFootprint(plant, (x, z) => assert.ok(lakeRadius(x, z) >= 1));
  water.geometry.dispose(); material.dispose();
});

test('la rampa baja permanece libre incluso cuando el mapa contiene césped sobre el tablero', () => {
  const map = Array.from({ length: 165 }, () => Array(55).fill('road'));
  for (let row = 155; row <= 161; row++) for (let col = 29; col <= 47; col++) map[row][col] = 'grass';
  const plan = planParkVegetation({ map, groundHeight: () => .06, getWaterInfo: () => null });
  assert.ok(plan.clusters.length > 0, 'conserva vegetación en el césped contiguo');
  for (const plant of plan.clusters) sampleFootprint(plant, (x, z) => {
    assert.equal(onLakeBridge(x, z), false, 'la huella y su margen dejan libre el acceso bajo');
  });
});

test('reservas adicionales y agua no pintada en el mapa también excluyen todas las huellas', () => {
  const opts = options(), reserved = (x, z, radius = 0) => Math.hypot(x - 154, z - 308) <= 9 + radius;
  const water = (x, z) => x > 180 && z > 265 || waterAt(x, z);
  const plan = planParkVegetation({ ...opts, isReserved: reserved, getWaterInfo: water });
  assert.ok(plan.clusters.length > 200);
  for (const plant of plan.clusters) sampleFootprint(plant, (x, z) => {
    assert.equal(reserved(x, z), false);
    assert.equal(water(x, z), false);
  });
  assert.equal(planParkVegetation({ ...opts, isReserved: () => true }).clusters.length, 0);
});

test('no planta sobre agua, calles, desniveles fuertes ni suelo elevado', () => {
  const opts = options();
  for (const type of ['road', 'busway', 'plaza', 'sidewalk', 'water', 'building']) {
    assert.equal(planParkVegetation({ map: Array.from({ length: 12 }, () => Array(12).fill(type)) }).clusters.length, 0);
  }
  for (const height of [2, -.5, NaN, Infinity]) {
    assert.equal(planParkVegetation({ ...opts, groundHeight: () => height }).clusters.length, 0);
  }
  const steep = planParkVegetation({ map: Array.from({ length: 15 }, () => Array(15).fill('grass')),
    groundHeight: x => Math.sin(x * 8) * .4, getWaterInfo: () => null });
  assert.equal(steep.clusters.length, 0);
  assert.deepEqual(planParkVegetation().clusters, []);
  const empty = buildParkVegetation(planParkVegetation());
  assert.equal(empty.children.length, 0);
  assert.equal(empty.userData.metrics.materials, 0);
  empty.userData.dispose();
});

test('los lotes conservan detalle bajo, un material opaco y descarte por sectores de 32 m', () => {
  const plan = fullPlan(), group = buildParkVegetation(plan);
  assert.equal(group.children.length, plan.metrics.sectors);
  assert.equal(group.userData.metrics.materials, 1);
  assert.equal(group.userData.metrics.textures, 0);
  assert.ok(group.userData.metrics.triangles < 22000);
  const materials = new Set();
  for (const mesh of group.children) {
    assert.equal(mesh.isMesh, true);
    assert.equal(mesh.children.length, 0);
    assert.equal(mesh.userData.noMerge, true);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.frustumCulled, true);
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.isMeshStandardMaterial, true);
    assert.equal(mesh.customDepthMaterial, undefined);
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.emissive.getHex(), 0);
    assert.equal(mesh.userData.update, undefined);
    materials.add(mesh.material);
    const geometry = mesh.geometry, rawBounds = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(size.x < 34 && size.z < 34);
    assert.ok(geometry.boundingBox.min.x <= rawBounds.min.x - PARK_VEGETATION.windBounds + 1e-7);
    assert.ok(geometry.boundingBox.max.z >= rawBounds.max.z + PARK_VEGETATION.windBounds - 1e-7);
    const position = geometry.attributes.position;
    let furthest = 0;
    for (let i = 0; i < position.count; i++) {
      furthest = Math.max(furthest, new THREE.Vector3().fromBufferAttribute(position, i).distanceTo(geometry.boundingSphere.center));
      assert.ok(position.getY(i) - groundHeight(position.getX(i), position.getZ(i)) < PARK_VEGETATION.maxHeight);
      assert.equal(waterAt(position.getX(i), position.getZ(i)), false);
    }
    assert.ok(geometry.boundingSphere.radius >= furthest + PARK_VEGETATION.windBounds - 1e-7);
    for (const attribute of Object.values(geometry.attributes)) assert.ok([...attribute.array].every(Number.isFinite));
  }
  assert.equal(materials.size, 1);
  group.userData.dispose();
});

test('viento compartido conserva PBR y permite congelar matrices sin tareas por ejemplar', () => {
  const windTime = { value: 0 }, plan = fullPlan(), group = buildParkVegetation(plan, { windTime });
  const city = new THREE.Group(), meshes = [...group.children];
  city.add(...meshes); createRenderSectors(city); freezeStaticTransforms(city);
  const first = meshes[0], previous = first.matrixWorld.clone(), shader = {
    uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader
  };
  first.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.parkWindTime, windTime);
  assert.ok(shader.vertexShader.includes('attribute vec3 treeWind'));
  for (const chunk of ['<lights_fragment_begin>', '<shadowmap_pars_fragment>', '<tonemapping_fragment>', '<fog_fragment>']) {
    assert.ok(shader.fragmentShader.includes(chunk));
  }
  windTime.value = 20;
  assert.equal(shader.uniforms.parkWindTime.value, 20);
  assert.ok(first.matrixWorld.equals(previous));
  assert.equal(first.matrixAutoUpdate, false);
  for (const mesh of meshes) {
    const wind = mesh.geometry.attributes.treeWind, position = mesh.geometry.attributes.position;
    assert.equal(wind.count, position.count);
    for (let i = 0; i < wind.count; i++) assert.ok(wind.getZ(i) >= 0 && wind.getZ(i) <= PARK_VEGETATION.windAmplitude + 1e-7);
  }
  group.userData.dispose();
});

test('dispose es idempotente incluso tras transferir lotes y no libera recursos de otro propietario', () => {
  const windTime = { value: 5 }, plan = fullPlan();
  const a = buildParkVegetation(plan, { windTime }), b = buildParkVegetation(plan, { windTime });
  const city = new THREE.Group(), meshes = [...a.children]; city.add(...meshes);
  let geometries = 0, materials = 0, other = 0;
  for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => geometries++);
  meshes[0].material.addEventListener('dispose', () => materials++);
  b.children[0].material.addEventListener('dispose', () => other++);
  a.userData.dispose(); a.userData.dispose();
  assert.equal(geometries, meshes.length);
  assert.equal(materials, 1);
  assert.equal(other, 0);
  assert.equal(windTime.value, 5);
  b.userData.dispose(); assert.equal(other, 1);
});
