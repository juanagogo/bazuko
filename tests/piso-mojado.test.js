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
