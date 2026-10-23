import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { SceneManager } from '../src/core/Scene.js';
import { cerros, articulatedBus, tree, neonSign } from '../src/world/bogota/props.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';
import { Car } from '../src/entities/Car.js';
import { facade } from '../src/world/bogota/textures.js';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { Player } from '../src/entities/Player.js';
import { OutdoorUrbanEnvironment, Renderer } from '../src/core/Renderer.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('Salto Gráfico 1: SceneManager cuenta con Bóveda Celeste (SkyDome) dinámica', () => {
  const sceneMgr = new SceneManager();
  assert.ok(sceneMgr.skyDome, 'SceneManager debe poseer skyDome');
  assert.equal(sceneMgr.skyDome.userData.isSkyDome, true);
  assert.equal(sceneMgr.skyDome.renderOrder, -1000);

  // Comportamiento de día
  sceneMgr.setTimeOfDay(12.0, false, 0);
  assert.equal(sceneMgr.skyDome.material.uniforms.nightFactor.value, 0);

  // Comportamiento de noche
  sceneMgr.setTimeOfDay(0.0, false, 0);
  assert.ok(sceneMgr.skyDome.material.uniforms.nightFactor.value > 0.8, 'Noche activa factor nocturno con estrellas');

  // Seguimiento al jugador
  const target = new THREE.Vector3(85, 0, 110);
  sceneMgr.followTarget(target, 12.0);
  assert.equal(sceneMgr.skyDome.position.x, 85);
  assert.equal(sceneMgr.skyDome.position.z, 110);

  // Animación del shader
  const tBefore = sceneMgr.skyDome.material.uniforms.time.value;
  sceneMgr.update(0.16);
  assert.ok(sceneMgr.skyDome.material.uniforms.time.value > tBefore);
});

test('Salto Gráfico 2: Cerros Orientales con Santuario de Monserrate y faro nocturno reactivo', () => {
  const mountains = cerros(200);
  assert.ok(mountains);
  assert.ok(typeof mountains.userData.setNight === 'function', 'Los cerros deben tener setNight');

  // Activa modo noche: la cruz de Monserrate se ilumina al 100%
  mountains.userData.setNight(true);
  const crossMesh = mountains.children.find(c => c.userData.isCross);
  assert.ok(crossMesh, 'Debe existir la cruz de Monserrate');
  assert.equal(crossMesh.material.opacity, 1.0);

  // Modo día: se atenúa
  mountains.userData.setNight(false);
  assert.equal(crossMesh.material.opacity, 0.25);
});

test('Salto Gráfico 3: Bus TransMilenio articulado con faros, haz de luz y luces traseras', () => {
  const bus = articulatedBus();
  assert.equal(bus.userData.wheels.length, 8, 'Conserva 8 ruedas intactas');

  // Buscar haz de luz frontal sobre el asfalto
  const beamMesh = bus.children.find(c => c.geometry?.parameters?.width === 6.5);
  assert.ok(beamMesh, 'El bus articulado proyecta haz de luz frontal');
  assert.equal(beamMesh.rotation.x, -Math.PI / 2);

  // Luces traseras y delanteras
  const headLights = bus.children.filter(c => c.geometry?.parameters?.width === 0.3 && c.position.z < -9);
  assert.equal(headLights.length, 2, 'Cuenta con 2 faros delanteros');
  const tailLights = bus.children.filter(c => c.geometry?.parameters?.width === 0.28 && c.position.z > 9);
  assert.equal(tailLights.length, 2, 'Cuenta con 2 faros traseros rojos');
});

test('Salto Gráfico 4: Árboles con vaivén orgánico por viento andino', () => {
  const t = tree(1.2);
  assert.ok(typeof t.userData.update === 'function', 'El árbol debe tener update de viento');

  const foliage = t.children.find(c => c.isGroup);
  assert.ok(foliage, 'Debe tener subgrupo de follaje');
  const initZ = foliage.rotation.z;

  t.userData.update(0.05, 1.5);
  assert.notEqual(foliage.rotation.z, initZ, 'El viento andino oscila la copa del árbol');
});

test('Salto Gráfico 5: Charcos y ondas de lluvia (Puddle Ripples) en WeatherSystem', () => {
  const scene = new THREE.Scene();
  const weather = new WeatherSystem(scene);

  assert.ok(weather.rippleMesh, 'WeatherSystem inicializa malla de ondas de charcos');
  assert.equal(weather.rippleMesh.count, 36);

  weather.setWeather('llovizna', false);
  const playerPos = new THREE.Vector3(50, 0, 50);
  weather.update(0.1, playerPos);
  assert.equal(weather.rippleMesh.visible, true);

  weather.dispose();
  assert.equal(scene.children.length, 0, 'La limpieza elimina todas las partículas y charcos');
});

test('Salto Gráfico 6: Vehículos con faros volumétricos y luces de freno reactivas', () => {
  const scene = new THREE.Scene();
  const car = new Car(scene, new THREE.Vector3(10, 0, 10), 0, { traffic: true });

  assert.ok(car.vehicle.beam, 'Carro de tráfico cuenta con haz de luz');
  car.setNight(true, false);
  assert.equal(car.vehicle.beam.visible, true);

  // Freno intensifica el rojo de las luces traseras
  const baseColor = car.vehicle.tailMat.color.r;
  car.animateDrive(0.5, true);
  const brakeColor = car.vehicle.tailMat.color.r;
  assert.ok(brakeColor >= baseColor, 'El frenado intensifica el color de los stops');

  car.dispose();
  assert.equal(scene.children.length, 0);
});

test('Salto Gráfico 7: Letreros de neón comerciales con parpadeo y visibilidad nocturna', () => {
  const neon = neonSign({ title: 'DROGUERÍA', sub: '24 HORAS', color: '#00ff88' });
  assert.ok(neon);
  assert.equal(neon.userData.noMerge, true);
  assert.ok(typeof neon.userData.update === 'function');

  // Update ejecuta parpadeo
  neon.userData.update(0.016, 2.0);
  assert.ok(neon.children.length >= 3);
});

test('Salto Gráfico 8: Texturas PBR de fachadas con roughnessMap y bumpMap diferenciados', () => {
  const tex = facade({ seed: 42, width: 6, floors: 3, pxPerM: 36, shopFront: true, style: 'ladrillo' });
  assert.ok(tex.map, 'Debe generar diffuse map');
  assert.ok(tex.emissiveMap, 'Debe generar emissive map');
  assert.ok(tex.bumpMap, 'Debe generar bump map');
  assert.ok(tex.roughnessMap, 'Debe generar roughness map PBR');
});

test('Salto Gráfico 9: Sombras proyectadas dinámicas en vehículos y jugador', () => {
  // Vehículo con proyección de sombras
  const v = makeVehicle('carro', 1);
  const meshWithShadow = v.group.children.find(c => c.castShadow);
  assert.ok(meshWithShadow, 'Vehículo debe proyectar sombras dinámicas');

  // Jugador con silueta e iluminación correcta
  const scene = new THREE.Scene();
  const player = new Player(scene, { getAction: () => null });
  assert.ok(player.root, 'Jugador inicializa su contenedor de escena');
  assert.equal(player.root.position.y, 0);
  player.update(0.016, null, null, () => 0);
  assert.equal(player.root.visible, true);
});

test('Salto Gráfico 10: Entorno PBR y preparación de Renderer', () => {
  const env = new OutdoorUrbanEnvironment();
  assert.equal(env.name, 'OutdoorUrbanEnvironment');
  assert.ok(env.children.length >= 5, 'El entorno urbano contiene bóveda, horizonte, sol y siluetas');
  const sunLight = env.children.find(c => c.isPointLight);
  assert.ok(sunLight, 'Cuenta con sol de alta intensidad para brillos especulares');

  assert.ok(typeof Renderer.prototype.setupPostprocessing === 'function');
  env.dispose();
});
