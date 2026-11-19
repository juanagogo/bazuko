import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildLakeTerrain, buildLakeWater, LAKE_PARK, lakeRadius, onLakeBridge, lakeTerrainHeight } from '../src/world/bogota/LakePark.js';
import { createLakeWaterMaterial, createLakeRippleTexture, withLakeRandom } from '../src/world/bogota/LakeWaterMaterial.js';
import { buildLakeReeds, planLakeReeds } from '../src/world/bogota/LakeReeds.js';
import { attachLakeBridgeReflection } from '../src/world/bogota/LakeBridgeReflection.js';

const sinAzarDeCiudad = run => {
  const original = Math.random;
  Math.random = () => { throw new Error('el lago no puede gastar el azar sembrado de la ciudad'); };
  try { return run(); } finally { Math.random = original; }
};
const sorteos = run => {
  const original = Math.random; let pedidos = 0;
  Math.random = () => { pedidos++; return original(); };
  try { run(); } finally { Math.random = original; }
  return pedidos;
};

test('el agua nueva gasta del azar de la ciudad lo mismo que la de antes: un material, una geometría y una malla', () => {
  // Three pide cuatro números por identificador. La textura del rizo y los juncos usan azar propio.
  let material, water;
  assert.equal(sorteos(() => { material = createLakeWaterMaterial(); }), 4);
  assert.equal(sorteos(() => { water = buildLakeWater(material); }), 8);
  assert.equal(water.children.length, 1);
  water.children[0].geometry.dispose(); water.children[0].material.dispose();
  water.geometry.dispose(); material.dispose();
});

test('el rizado del agua se pinta igual cada vez y empalma sin costura', () => {
  const [a, b] = withLakeRandom(() => [createLakeRippleTexture(), createLakeRippleTexture()]);
  assert.deepEqual(a.image.data, b.image.data);
  assert.equal(a.image.width, 128); assert.equal(a.image.height, 128);
  assert.equal(a.wrapS, THREE.RepeatWrapping); assert.equal(a.wrapT, THREE.RepeatWrapping);
  assert.equal(a.colorSpace, THREE.NoColorSpace);
  let slopeX = 0, slopeZ = 0;
  for (let i = 0; i < a.image.data.length; i += 4) { slopeX += a.image.data[i]; slopeZ += a.image.data[i + 1]; }
  const pixels = a.image.data.length / 4;
  assert.ok(Math.abs(slopeX / pixels - 127.5) < 3, 'la pendiente media del rizo es cero');
  assert.ok(Math.abs(slopeZ / pixels - 127.5) < 3);
  a.dispose(); b.dispose();
});

test('el agua lee tres veces su textura, atenúa el entorno y de noche refleja los faroles cercanos', () => {
  const material = createLakeWaterMaterial(), uniforms = material.userData.uniforms;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal((shader.fragmentShader.match(/texture2D\(lakeRipples/g) ?? []).length, 3);
  assert.ok(shader.fragmentShader.includes('texture2D(lakeBridgeTexture'));
  assert.ok(shader.fragmentShader.includes('radiance *= lakeEnvGain'));
  for (const chunk of ['<lights_fragment_maps>', '<normal_fragment_maps>', '<color_fragment>']) {
    assert.ok(shader.fragmentShader.includes(chunk), `falta ${chunk}`);
  }
  assert.equal(uniforms.lakeLamps.value.length, 6);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xa9cae8, 50, 180);
  const cerca = new THREE.PointLight(0xffd29a, 0, 12), lejos = new THREE.PointLight(0xffd29a, 0, 12);
  cerca.position.set(30, 6, 225); lejos.position.set(300, 6, 80);
  scene.add(cerca, lejos); scene.updateMatrixWorld(true);
  material.userData.syncScene(scene, { toneMappingExposure: .8 });
  assert.equal(uniforms.lakeNight.value, 0);
  assert.ok(uniforms.lakeEnvGain.value > .4);
  assert.deepEqual(uniforms.lakeSky.value.toArray(), scene.fog.color.toArray());
  assert.deepEqual(uniforms.lakeLamps.value.map(lamp => lamp.w), [1, 0, 0, 0, 0, 0]);
  assert.deepEqual(uniforms.lakeLamps.value[0].toArray(), [30, 6, 225, 1]);
  assert.equal(uniforms.lakeLampRadiance.value[0].getHex(), 0, 'un farol apagado no deja destello');

  scene.fog.color.set(0x26394a);
  cerca.intensity = 22;
  material.userData.syncScene(scene, { toneMappingExposure: 1.22 });
  assert.equal(uniforms.lakeNight.value, 1);
  assert.ok(uniforms.lakeLampRadiance.value[0].equals(cerca.color.clone().multiplyScalar(22)));
  assert.ok(uniforms.lakeEnvGain.value < .1, 'de noche el entorno casi no se refleja');
  let liberadas = 0;
  uniforms.lakeRipples.value.addEventListener('dispose', () => liberadas++);
  material.dispose(); material.dispose();
  assert.equal(liberadas, 1);
});

test('el agua refleja el cielo actual y las ondas de lluvia respetan las cubiertas', () => {
  const material = createLakeWaterMaterial(), uniforms = material.userData.uniforms;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  const scene = new THREE.Scene(), dome = new THREE.Object3D();
  const cloudNoise = new THREE.Texture(), coverTexture = new THREE.Texture();
  const sky = {
    topColor: { value: new THREE.Color(0x356cab) }, cloudCover: { value: .82 }, cloudNoise: { value: cloudNoise },
    cloudLight: { value: new THREE.Color(0xa9bcd4) }, cloudShadow: { value: new THREE.Color(0x717b8a) },
    cloudOffset: { value: new THREE.Vector2(1.2, 2.3) }
  };
  dome.material = { uniforms: sky }; dome.userData.isSkyDome = true;
  scene.add(dome);
  material.userData.syncScene(scene);
  assert.ok(uniforms.lakeSkyTop.value.equals(sky.topColor.value));
  assert.ok(uniforms.lakeCloudDrift.value.equals(sky.cloudOffset.value));
  assert.equal(uniforms.lakeCloudCover.value, .82);
  assert.equal(uniforms.lakeCloudNoise.value, cloudNoise);
  sky.cloudOffset.value.set(4.3, 6.2);
  material.userData.syncScene(scene);
  assert.ok(uniforms.lakeCloudDrift.value.equals(sky.cloudOffset.value));

  material.userData.setRain(1.5);
  assert.equal(shader.uniforms.lakeRain.value, 1);
  const rect = new THREE.Vector4(65, 210, .04, .01);
  material.userData.setRainCover({ texture: coverTexture, maxHeight: 16, rect });
  assert.equal(shader.uniforms.uRainCoverMap.value, coverTexture);
  assert.equal(shader.uniforms.uRainCoverHeight.value, 16);
  assert.ok(shader.uniforms.uRainCoverRect.value.equals(rect));
  assert.ok(shader.fragmentShader.includes('rainCoverAt(lakeXZ) < vLakeWorld.y'));
  material.userData.setRain(0);
  assert.equal(shader.uniforms.lakeRain.value, 0);
  material.userData.setRainCover(null);
  assert.equal(shader.uniforms.uRainCoverHeight.value, 0);
  material.dispose(); cloudNoise.dispose(); coverTexture.dispose();
});

test('el lecho y la superficie comparten las crestas, el reloj y el sol del lago', () => {
  const water = createLakeWaterMaterial();
  const terrain = buildLakeTerrain(undefined, { waterUniforms: water.userData.uniforms });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  terrain.material.onBeforeCompile(shader);
  for (const key of ['lakeTime', 'lakeRain', 'lakeSunDirection', 'lakeSunAmount']) {
    assert.equal(shader.uniforms[key], water.userData.uniforms[key]);
  }
  water.userData.update(.47);
  assert.equal(shader.uniforms.lakeTime.value, .47);
  assert.ok(shader.fragmentShader.includes('refract(-bedToEye'));
  assert.ok(shader.fragmentShader.includes('reflectedLight.directDiffuse *= mix(1.0, focus'));
  terrain.geometry.dispose(); terrain.material.dispose(); water.dispose();
});

test('al pasar a alta el reflejo toma la lente, el haz, las candelas y el encendido del alumbrado real', () => {
  const water = createLakeWaterMaterial(), u = water.userData.uniforms;
  const scene = new THREE.Scene(), point = new THREE.PointLight(0xffa03d, 12);
  point.position.set(37, 6, 238);
  scene.add(point);
  const map = scene.userData.streetLightMap = {
    sources: [{ x: 38.1, y: 6.5, z: 237, range: 15.5, shape: 0, radiance: [12, 18, 25] }], windowLevel: .4
  };
  water.userData.syncScene(scene);
  assert.deepEqual(u.lakeLamps.value[0].toArray(), [38.1, 6.5, 237, 1]);
  assert.deepEqual(u.lakeLampRadiance.value[0].toArray(), [12 * .4, 18 * .4, 25 * .4]);
  assert.deepEqual(u.lakeLampBeam.value[0].toArray(), [15.5, 1]);
  map.windowLevel = .9;
  water.userData.syncScene(scene);
  assert.deepEqual(u.lakeLampRadiance.value[0].toArray(), [12 * .9, 18 * .9, 25 * .9]);
  map.windowLevel = null;
  water.userData.syncScene(scene);
  assert.deepEqual(u.lakeLamps.value[0].toArray(), [37, 6, 238, 1]);
  assert.deepEqual(u.lakeLampBeam.value[0].toArray(), [0, 0]);
  water.dispose();
});

test('la misma pasada refleja las pilas, los tableros y la vegetación de orilla, recortados al nivel del agua', () => {
  const water = buildLakeWater();
  const bus = new THREE.Group(), metro = new THREE.Group(), district = new THREE.Group();
  district.add(water, bus, metro);
  const concrete = new THREE.MeshStandardMaterial({ name: 'ConcretoMetro' });
  const bark = new THREE.MeshStandardMaterial();
  const treeGeometry = new THREE.BoxGeometry(.3, 3, .3);
  for (const x of [78, 232]) {
    const root = new THREE.Group();
    root.userData.tree = { seed: x };
    root.position.set(x, .5, 235);
    root.add(new THREE.Mesh(treeGeometry, bark));
    district.add(root);
  }
  const pier = new THREE.Mesh(new THREE.BoxGeometry(1.3, 12, 1.3), concrete);
  pier.position.set(75, 2, 248);
  metro.add(pier);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(14, .65, 40), concrete);
  deck.name = 'Tablero de concreto';
  deck.position.set(75, 7.5, 248);
  bus.add(deck);
  const reflection = sinAzarDeCiudad(() => attachLakeBridgeReflection(water, LAKE_PARK, bus, metro));
  const reflected = new Map(reflection.meshes.map(mesh => [mesh.material, mesh.geometry.index.count]));
  assert.equal(reflected.size, 3);
  assert.equal(reflected.get(concrete), pier.geometry.index.count + deck.geometry.index.count);
  assert.equal(reflected.get(bark), treeGeometry.index.count, 'solo se refleja arbolado cercano');
  assert.equal(reflected.get(water.userData.reeds.material), water.userData.reeds.geometry.index.count);
  const camera = new THREE.PerspectiveCamera(55, 1.6, .1, 180);
  camera.position.set(42, 2, 248);
  camera.lookAt(75, -.15, 248);
  camera.updateMatrixWorld();
  assert.ok(reflection._project(camera));
  assert.equal(reflection.camera.position.y, 2 * LAKE_PARK.surfaceY - camera.position.y);
  const nearPlane = new THREE.Vector3(75, LAKE_PARK.surfaceY, 248).project(reflection.camera);
  assert.ok(Math.abs(nearPlane.z + 1) < 1e-6);
  assert.ok(new THREE.Vector3(75, LAKE_PARK.surfaceY - .1, 248).project(reflection.camera).z < -1);
  assert.ok(new THREE.Vector3(75, LAKE_PARK.surfaceY + .1, 248).project(reflection.camera).z > -1);
  assert.ok(reflection.target.depthTexture.isDepthTexture);
  // La textura de profundidad usa la proyección oblicua. Invertir la proyección
  // normal daría una distancia distinta al pie y al extremo superior de la pila.
  for (const y of [LAKE_PARK.surfaceY, 4.2]) {
    const point = new THREE.Vector3(75, y, 248);
    const ndc = point.clone().project(reflection.camera);
    assert.ok(ndc.applyMatrix4(reflection.inverseViewProjection).distanceTo(point) < 1e-8);
  }
  camera.position.y = LAKE_PARK.surfaceY - .2;
  camera.updateMatrixWorld();
  assert.equal(reflection._project(camera), false);
  let released = 0;
  reflection.target.addEventListener('dispose', () => released++);
  water.material.dispose();
  water.material.dispose();
  assert.equal(released, 1);
  water.children[0].geometry.dispose();
  water.children[0].material.dispose();
  water.geometry.dispose();
  pier.geometry.dispose();
  deck.geometry.dispose();
  concrete.dispose(); treeGeometry.dispose(); bark.dispose();
});

test('el horizonte reflejado comparte las mismas instancias sin moverlas ni desecharlas al cerrar el agua', () => {
  const water = buildLakeWater(), bus = new THREE.Group(), metro = new THREE.Group();
  const backdrop = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const houses = new THREE.InstancedMesh(geometry, material, 2);
  houses.setMatrixAt(0, new THREE.Matrix4().makeTranslation(32, 5, 225));
  houses.setMatrixAt(1, new THREE.Matrix4().makeTranslation(36, 7, 226));
  houses.setColorAt(0, new THREE.Color(0x8f6646));
  backdrop.add(houses);
  const reflection = sinAzarDeCiudad(() => attachLakeBridgeReflection(water, LAKE_PARK, bus, metro, { backdrop }));
  const copy = reflection.landscape.children[0];
  assert.notEqual(copy, houses);
  assert.equal(copy.count, 2);
  assert.equal(copy.geometry, geometry);
  assert.equal(copy.instanceColor.array, houses.instanceColor.array);
  assert.equal(copy.instanceMatrix.array, houses.instanceMatrix.array);
  assert.notEqual(copy.instanceMatrix, houses.instanceMatrix);
  assert.equal(copy.material, material);
  let released = 0, releasedInstances = 0;
  geometry.addEventListener('dispose', () => released++);
  copy.addEventListener('dispose', () => releasedInstances++);
  water.traverse(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
  assert.equal(released, 0);
  assert.equal(releasedInstances, 1);
  assert.equal(houses.parent, backdrop);
  houses.dispose(); geometry.dispose(); material.dispose();
});

test('los juncos salen iguales cada vez, en la línea de agua, fuera del puente y sin ser obstáculo', () => {
  const height = (x, z) => lakeTerrainHeight(x, z);
  const [a, b] = sinAzarDeCiudad(() => [planLakeReeds(LAKE_PARK, height, onLakeBridge), planLakeReeds(LAKE_PARK, height, onLakeBridge)]);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 60 && a.length <= 200, `${a.length} matas`);
  for (const clump of a) {
    const radius = lakeRadius(clump.x, clump.z);
    assert.ok(radius > .96 && radius < 1.03, 'cada mata queda en la orilla');
    assert.equal(onLakeBridge(clump.x, clump.z), false);
    assert.ok(clump.y <= LAKE_PARK.surfaceY + .1);
  }
  const reeds = withLakeRandom(() => buildLakeReeds(LAKE_PARK, height, onLakeBridge));
  assert.ok(reeds.geometry.index.count / 3 < 6000, 'una sola malla liviana');
  assert.ok(reeds.geometry.boundingBox.max.y < 2.2);
  assert.equal(reeds.castShadow, false);
  const water = buildLakeWater();
  assert.equal(water.children.length, 1);
  assert.equal(water.children[0].userData.noMerge, true);
  assert.equal(typeof water.onBeforeRender, 'function');
  reeds.geometry.dispose(); reeds.material.dispose();
  water.children[0].geometry.dispose(); water.children[0].material.dispose();
  water.geometry.dispose(); water.material.dispose();
});
