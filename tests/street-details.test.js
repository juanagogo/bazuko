import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addStreetDetails, curbRuns, planPoles } from '../src/world/bogota/StreetDetails.js';
import { activateSunField } from '../src/world/bogota/SunField.js';
import { planPuddles, setPuddles } from '../src/world/bogota/StreetPuddles.js';

const T = 2;
const ROADS = new Set(['road', 'busway']);

function district() {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  Object.assign(city, { props: [], treePlan: [], vegetationPlan: { clusters: [] }, vendors: [], fireBarrels: [],
    signals: { poles: [] }, renderSectors: [], isNearReserved: () => false, buildingVisibility: { buildings: [] } });
  return city;
}

test('los tramos de andén salen del mapa: un barrio nuevo no necesita lista', () => {
  const map = [
    ['building', 'building', 'building', 'building', 'building', 'building'],
    ['sidewalk', 'sidewalk', 'sidewalk', 'sidewalk', 'sidewalk', 'sidewalk'],
    ['road', 'road', 'road', 'road', 'road', 'road'],
    ['sidewalk', 'sidewalk', 'grass', 'sidewalk', 'sidewalk', 'sidewalk']
  ];
  const runs = curbRuns(map);
  assert.ok(runs.some(r => r.axis === 'x' && r.fixed === 1 && r.side === 1 && r.a === 0 && r.b === 5));
  assert.ok(runs.some(r => r.axis === 'x' && r.fixed === 3 && r.side === -1 && r.a === 3 && r.b === 5), 'el pasto corta el tramo');
});

test('hay un poste cada 20 a 30 m, sobre el andén, y esquiva lo que ya está ocupado', () => {
  const { map } = district();
  const poles = planPoles(map, () => true);
  assert.ok(poles.length > 100);
  for (const pole of poles) {
    assert.ok(['sidewalk', 'plaza', 'floor'].includes(map[Math.round(pole.z / T)][Math.round(pole.x / T)]), 'siempre sobre el andén');
    if (pole.previous) {
      const gap = Math.hypot(pole.x - pole.previous.x, pole.z - pole.previous.z);
      assert.ok(gap >= 14 && gap <= 36, `separación ${gap}`);
    }
  }
  assert.deepEqual(planPoles(map, () => true).map(p => [p.x, p.z]), poles.map(p => [p.x, p.z]), 'determinista');
  const blocked = planPoles(map, (x, z) => !(x > 60 && x < 120 && z > 40 && z < 110));
  assert.ok(blocked.every(p => !(p.x > 60 && p.x < 120 && p.z > 40 && p.z < 110)));
});

test('los objetos nuevos no invaden la calzada ni agregan colisiones, y entran a los sectores', () => {
  const city = district();
  const collisions = { colliders: [], queryStatic: () => [] };
  addStreetDetails(city, collisions);
  assert.equal(collisions.colliders.length, 0);
  assert.ok(city.renderSectors.length > 20);
  assert.ok(city.streetPoles.length > 100);
  const group = city.group.children.find(child => child.name === 'Calle: cables y mobiliario');
  assert.ok(group);
  assert.equal(group.matrixAutoUpdate, false, 'la ciudad queda congelada, sin matrices por cuadro');
  const materials = new Set();
  let lines = 0, meshes = 0;
  group.traverse(object => {
    if (object.isLineSegments) lines++;
    if (!object.isMesh) return;
    meshes++;
    materials.add(object.material);
    if (object.name !== 'Calle') return;
    const p = object.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      // Altura de un peatón o un carro: nada de lo que se agregó puede estar ahí sobre la vía.
      if (y < .3 || y > 2.15) continue;
      const tile = city.map[Math.round(p.getZ(i) / T)]?.[Math.round(p.getX(i) / T)];
      assert.ok(!ROADS.has(tile), `objeto a ${y.toFixed(2)} m sobre ${tile} en ${p.getX(i).toFixed(1)},${p.getZ(i).toFixed(1)}`);
    }
  });
  assert.ok(lines > 10, 'cables en líneas por sector');
  assert.ok(materials.size <= 3, 'un material para lo sólido, otro para la luz de los faroles y otro para los charcos');
  group.traverse(object => { assert.ok(!object.isLight); });
  activateSunField(null);
});

test('se puede construir dos veces igual y sin documento: no hay azar ni Canvas obligatorio', () => {
  assert.equal(typeof document, 'undefined');
  const dump = () => {
    const city = district(), out = [];
    addStreetDetails(city);
    city.group.traverse(object => { if (object.isMesh || object.isLineSegments) out.push(Array.from(object.geometry.attributes.position.array)); });
    return out;
  };
  const first = dump();
  assert.ok(first.length > 10);
  assert.deepEqual(dump(), first);
  activateSunField(null);
});

test('los charcos no gastan nada en seco y solo aparecen sobre suelo plano', () => {
  const city = district();
  addStreetDetails(city);
  const puddles = [];
  city.group.traverse(object => { if (object.name === 'Charcos') puddles.push(object); });
  assert.ok(puddles.length > 5, 'una malla por sector');
  const { material } = puddles[0];
  assert.ok(puddles.every(mesh => mesh.material === material));
  setPuddles(0);
  assert.equal(material.visible, false, 'sin llamadas de dibujo con el suelo seco');
  setPuddles(.2);
  assert.equal(material.visible, false, 'una llovizna recién empezada no encharca');
  setPuddles(1);
  assert.equal(material.visible, true);
  assert.ok(material.opacity > .8);
  setPuddles(0);
  const plan = planPuddles(city.map, curbRuns(city.map), (x, z) => city.getGroundHeight(x, z));
  assert.ok(plan.length > 60);
  for (const { x, z, width, depth, axis } of plan) {
    const [dx, dz] = axis === 'x' ? [width / 2, depth / 2] : [depth / 2, width / 2];
    const heights = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => city.getGroundHeight(x + a * dx, z + b * dz));
    assert.ok(Math.max(...heights) - Math.min(...heights) <= .025, `charco cruzando un escalón en ${x},${z}`);
  }
  activateSunField(null);
});
