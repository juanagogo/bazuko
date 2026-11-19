import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addContactShade, caidaContacto, CONTACTO } from '../src/world/bogota/sombraContacto.js';

const T = 2;
const MUROS = new Set(['building', 'wall', 'smallBuilding', 'storeD69', 'colpatria', 'colpatriaAnnex']);

function district() {
  const city = new Bogota();
  city.map = city._layout();
  Object.assign(city, { props: [], vendors: [], signals: { poles: [] } });
  return city;
}

function armar(city, poles = []) {
  let sorteos = 0;
  const delJuego = Math.random;
  Math.random = () => { sorteos++; return delJuego(); };
  try { return { group: addContactShade(city, poles), sorteos: () => sorteos }; } finally { Math.random = delJuego; }
}

test('las dos platinas de una banca del Lago imprimen su apoyo sobre el adoquín real', () => {
  const city = district();
  const x = 118, z = 236, y = city.getGroundHeight(x, z);
  city.benchSpots = [{ x, y, z, rot: Math.PI / 2 }];
  const { group } = armar(city);
  const sides = new Set();
  for (const mesh of group.children) {
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
      if (Math.hypot(px - x, pz - z) > .95) continue;
      assert.ok(Math.abs(py - city.getMovementGroundHeight(px, pz, y) - .007) < 1e-5);
      sides.add(Math.sign(pz - z));
    }
  }
  assert.deepEqual([...sides].sort(), [-1, 1], 'una huella por cada lado de la banca, aunque esté dentro de la ribera');
});
