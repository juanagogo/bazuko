import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { Player } from '../src/entities/Player.js';
import { curbRuns } from '../src/world/bogota/StreetDetails.js';
import { activateSunField } from '../src/world/bogota/SunField.js';
import { addStreetPuddles, gutterBands, planPuddles, setPuddles } from '../src/world/bogota/StreetPuddles.js';
import { asphaltPatches } from '../src/world/bogota/StreetMarkings.js';

const sorteos = run => {
  const original = Math.random;
  let pedidos = 0;
  Math.random = () => { pedidos++; return original(); };
  try { run(); } finally { Math.random = original; }
  return pedidos;
};

function ciudad() {
  const city = new Bogota();
  city.map = city._layout();
  city.renderSectors = [];
  return city;
}

const charcos = city => {
  const out = [];
  city.group.traverse(object => { if (object.name === 'Charcos') out.push(object); });
  return out;
};

const compilar = material => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
};

test('los charcos toman del azar de la ciudad lo mismo que antes, cuantos charcos haya', () => {
  // Antes: la textura (8), el material (4), diez lotes con geometría y malla (80) y cuatro sectores solo de charcos (16).
  const city = ciudad(), street = new THREE.Group();
  assert.equal(sorteos(() => addStreetPuddles(street, city, curbRuns(city.map))), 108);
  assert.equal(street.children.length, 0, 'los lotes no caen en los sectores de la calle: no abren uno nuevo con el azar de la ciudad');
  const puddles = charcos(city);
  assert.ok(puddles.length > 5);
  assert.ok(city.renderSectors.length > 0 && city.renderSectors.every(sector => sector.children.every(mesh => mesh.name === 'Charcos')),
    'los charcos se descartan por sector como el resto de la calle');
  const tiny = { map: [['sidewalk', 'road', 'road', 'sidewalk']], group: new THREE.Group(), renderSectors: [], getGroundHeight: () => 0 };
  const tinyStreet = new THREE.Group();
  assert.equal(sorteos(() => addStreetPuddles(tinyStreet, tiny, curbRuns(tiny.map))), 108, 'con otro plan, lo mismo');
  activateSunField(null);
});

test('de noche el piso mojado y los charcos casi no devuelven el entorno fijo; de día y en seco, igual que antes', () => {
  const city = ciudad();
  const road = new THREE.MeshStandardMaterial(), sidewalk = new THREE.MeshStandardMaterial(), grass = new THREE.MeshStandardMaterial();
  city.groundMaterials = { road, sidewalk, grass };
  city.graphicsQuality = 'media';
  addStreetPuddles(new THREE.Group(), city, curbRuns(city.map));
  assert.ok(road.userData.wetFloor && sidewalk.userData.wetFloor && !grass.userData.wetFloor);
  const floor = compilar(road);
  assert.ok(floor.fragmentShader.includes('reflectedLight.indirectSpecular *= uWetFloorEnv'));
  assert.ok(floor.fragmentShader.includes('sunFieldSky'), 'conserva la sombra del campo de sol');
  const [puddle] = charcos(city), water = compilar(puddle.material);
  const noche = { userData: { environmentDay: 0 } }, dia = { userData: { environmentDay: 1 } };
  const entorno = (material, shader, scene) => { material.onBeforeRender(null, scene); return shader.uniforms.uWetFloorEnv.value; };
  city.setWetness(1);
  assert.ok(entorno(road, floor, noche) < .32, 'mojado de noche: el reflejo de las vitrinas del entorno baja a menos de un tercio');
  assert.equal(entorno(road, floor, dia), 1);
  assert.ok(entorno(puddle.material, water, noche) < .26);
  assert.equal(entorno(puddle.material, water, dia), 1);
  city.setWetness(0);
  assert.equal(entorno(road, floor, noche), 1, 'en seco la noche queda como estaba');
  city.graphicsQuality = 'baja';
  city.setWetness(1);
  const baja = entorno(road, floor, noche);
  assert.ok(baja > .32 && baja < 1, 'en baja el mojado sigue recortado');
  city.setWetness(0);
  activateSunField(null);
});

test('los anillos de gota son finos y discretos, y de lejos se apagan en vez de titilar', () => {
  const city = ciudad();
  addStreetPuddles(new THREE.Group(), city, curbRuns(city.map));
  const shader = compilar(charcos(city)[0].material).fragmentShader;
  const grueso = Number(/\( pr - life \* \.3 \) \/ ([\d.]+)/.exec(shader)?.[1]);
  // La celda mide 42 cm: el anillo queda en medio centímetro.
  assert.ok(grueso > 0 && grueso * .42 <= .006, `anillo de ${(grueso * 42).toFixed(1)} cm`);
  assert.ok(Number(/puddleRing \* ([\d.]+);/.exec(shader)?.[1]) <= .2, 'inclina poco la normal');
  assert.ok(Number(/puddleRing \* puddleBody \* ([\d.]+);/.exec(shader)?.[1]) <= .04, 'casi no aclara el agua');
  assert.ok(shader.includes('fwidth( pg )'), 'se apaga cuando el anillo es más fino que un píxel');
  setPuddles(0);
  activateSunField(null);
});

test('el agua de la cuneta toca el sardinel y cada charco se come el borde a su manera', () => {
  const row = type => Array.from({ length: 60 }, () => type);
  const map = [row('sidewalk'), row('road'), row('road'), row('road'), row('sidewalk')];
  // Bordes del andén con la calzada, en metros (tiles de 2 m).
  const borders = [1, 7];
  const pegados = planPuddles(map, curbRuns(map)).filter(({ z, depth, axis }) => axis === 'x' &&
    borders.some(border => Math.abs(Math.abs(z - border) - depth / 2) <= .05));
  assert.ok(pegados.length >= 3, `solo ${pegados.length} charcos contra el sardinel`);
  const city = ciudad();
  addStreetPuddles(new THREE.Group(), city, curbRuns(city.map));
  const shader = compilar(charcos(city)[0].material).fragmentShader;
  assert.match(shader, /float puddleEdge = [^;]*vPuddleXZ/, 'el borde cambia con el sitio');
  assert.match(shader, /specularColor = vec3\( mix\( \.04, [\d.]+, puddleBody \* smoothstep/, 'lo bajito de la orilla casi no refleja: no es una lámina pareja');
  setPuddles(0);
  activateSunField(null);
});

test('el charco refleja el cielo nublado sin pasar de 1,3 veces el valor del asfalto mojado de al lado', () => {
  const city = ciudad();
  const road = new THREE.MeshStandardMaterial();
  city.groundMaterials = { road };
  addStreetPuddles(new THREE.Group(), city, curbRuns(city.map));
  city.setWetness(1);
  const [puddle] = charcos(city), shader = compilar(puddle.material).fragmentShader;
  const f0 = Number(/specularColor = vec3\( mix\( \.04, ([\d.]+), puddleBody/.exec(shader)?.[1]);
  // Cielo nublado de radiancia 1 y luz difusa de 0,25; asfalto de albedo 0,1 con el reflejo de cuando está mojado.
  const water = puddle.geometry.attributes.color.getX(0);
  const lit = (albedo, f, env) => albedo * .25 + f * env;
  const ratio = (lit(water, f0, puddle.material.envMapIntensity) / lit(.1, .04, road.envMapIntensity)) ** (1 / 2.2);
  assert.ok(ratio <= 1.3, `el charco queda ${ratio.toFixed(2)} veces más claro que el asfalto mojado`);
  assert.ok(ratio > 1, 'pero se sigue leyendo como agua');
  city.setWetness(0);
  setPuddles(0);
  activateSunField(null);
});

test('una banda de agua de 20 a 30 cm corre pegada al sardinel, y los remiendos guardan charcos', () => {
  const row = type => Array.from({ length: 60 }, () => type);
  const map = [row('sidewalk'), row('road'), row('road'), row('road'), row('sidewalk')];
  const bands = gutterBands(map, curbRuns(map));
  assert.ok(bands.length >= 200, `${bands.length} tramos`);
  for (const band of bands) {
    assert.ok([1, 7].some(border => Math.abs(band.curb - border) <= .05), 'la banda arranca en el sardinel');
    for (const width of band.widths) assert.ok(width >= .2 && width <= .3, `banda de ${width} m`);
  }
  const city = ciudad();
  const patches = asphaltPatches(city.map);
  const onPatch = planPuddles(city.map, curbRuns(city.map)).filter(({ x, z }) => patches.some(p => Math.hypot(p.x - x, p.z - z) < .01));
  assert.ok(onPatch.length >= patches.length * .25, `${onPatch.length} charcos en ${patches.length} remiendos`);
});

function calleParaPisar() {
  const row = type => Array.from({ length: 24 }, (_, i) => i > 1 && i < 23 ? type : 'wall');
  const city = { map: [row('sidewalk'), row('road'), row('road'), row('road'), row('sidewalk')], group: new THREE.Group(),
    getGroundHeight: (_x, z) => z < 1 || z > 7 ? .13 : 0 };
  addStreetPuddles(new THREE.Group(), city, curbRuns(city.map));
  const { material } = charcos(city)[0];
  return { city, material, uniforms: compilar(material).uniforms };
}

test('la huella, la altura y la continuidad de la malla deciden qué agua alcanza la pisada', () => {
  const { city, material, uniforms } = calleParaPisar();
  const step = (x, y, z) => city.streetPuddles.step(x, y, z);
  const { uPuddleSteps: { value: waves }, uPuddleStepCount: count } = uniforms;
  setPuddles(0);
  assert.equal(step(4.95, 0, 1.12), false);
  setPuddles(1);
  assert.equal(step(4.95, .13, 1.12), false, 'una suela en el andén tiene otra cota');
  assert.equal(step(4.95, 0, 1.36), false, 'junto a la cuneta todavía puede estar seco');
  const pozo = planPuddles(city.map, curbRuns(city.map), city.getGroundHeight).find(puddle => puddle.axis === 'z' && puddle.x < 5);
  assert.equal(step(pozo.x, 0, pozo.z), true, 'la huella de un pozo girado');
  assert.equal(step(pozo.x, 0, pozo.z + pozo.width / 2 - .01), false, 'extremo de su geometría sin agua');
  assert.equal(step(4.95, 0, 1.12), true);
  assert.equal(step(5.05, 0, 1.12), true);
  assert.equal(count.value, 3);
  assert.equal(waves[7], waves[11], 'entre dos tramos de un metro la onda sigue en la cuneta');
  assert.notEqual(waves[3], waves[7], 'el pozo y la cuneta llevan impulsos distintos');
  assert.ok(Math.abs(waves[4] - 4.95) < 1e-5 && Math.abs(waves[5] - 1.12) < 1e-5, 'nace donde toca la suela');
  assert.equal(waves[6], 0);
  material.onBeforeRender(null, { userData: {} });
  assert.equal(waves[6], 0, 'dibujar con la simulación pausada no envejece la onda');
  setPuddles(1, 0, .13);
  assert.ok(waves[6] > 0 && waves[6] < 1);
  setPuddles(1, 0, .8);
  assert.equal(count.value, 0);
  setPuddles(0);
  activateSunField(null);
});

test('el jugador deja ondas al caminar sobre agua quieta y omite el aterrizaje y el tablero', () => {
  const { city, uniforms } = calleParaPisar();
  let jump = false;
  const input = { axis: { x: 1, z: 0 }, keys: {},
    consumePress(key) {
      if (!jump || key !== 'Space') return false;
      jump = false;
      return true;
    }
  };
  const player = new Player(new THREE.Scene(), input);
  const camera = new THREE.PerspectiveCamera(60);
  player.position.set(10, 0, 1.26);
  player.root.rotation.y = Math.PI / 2;
  let steps = 0;
  const puddles = city.streetPuddles;
  const original = puddles.step;
  puddles.step = (...args) => {
    steps++;
    return original.call(puddles, ...args);
  };
  setPuddles(1);
  const frame = (layer, height) => {
    const wasGrounded = player.isGrounded;
    player.update(1 / 30, camera, null, () => ({ height, layer }));
    setPuddles(1, 0, 1 / 30);
    puddles.updateFootfalls(player, wasGrounded);
    return uniforms.uPuddleStepCount.value;
  };
  let waves = 0;
  for (let tick = 0; tick < 60; tick++) waves += frame('ground', 0);
  assert.ok(steps > 0 && waves > 0);
  const before = steps;
  jump = true;
  frame('ground', 0);
  assert.equal(player.isGrounded, false);
  for (let tick = 0; tick < 30 && !player.isGrounded; tick++) frame('ground', 0);
  assert.equal(player.isGrounded, true);
  assert.equal(steps, before, 'el salto y el cuadro de aterrizaje no cuentan como pisada');
  player.position.y = 7.8;
  for (let tick = 0; tick < 24; tick++) frame('viaduct', 7.8);
  assert.equal(steps, before);
  assert.equal(uniforms.uPuddleStepCount.value, 0);
  setPuddles(0);
  activateSunField(null);
});
