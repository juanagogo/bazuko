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

test('postes, bancas y puestos dejan su mancha, y la penumbra se apaga hacia afuera', () => {
  const city = district();
  const sola = armar(city).group.children.reduce((n, mesh) => n + mesh.geometry.index.count, 0);
  const otra = district();
  otra.benchSpots = [{ x: 40, y: .12, z: 40, rot: 0 }];
  otra.vendors = [{ position: new THREE.Vector3(60, 0, 60) }];
  const con = armar(otra, [{ x: 20, z: 20 }]).group.children.reduce((n, mesh) => n + mesh.geometry.index.count, 0);
  assert.ok(con >= sola, 'nunca menos');
  assert.equal(caidaContacto(0), 1);
  assert.equal(caidaContacto(1), 0);
  assert.ok(caidaContacto(.4) > caidaContacto(.7));
  assert.ok(CONTACTO.noche < CONTACTO.dia && CONTACTO.dia <= .7, 'de noche pesa menos y de día no tapa el piso');
});

test('la opacidad sigue la hora de la escena', () => {
  const { group } = armar(district());
  const mesh = group.children[0];
  mesh.onBeforeRender(null, { userData: { environmentDay: 0 } });
  assert.equal(mesh.material.opacity, CONTACTO.noche);
  mesh.onBeforeRender(null, { userData: { environmentDay: 1 } });
  assert.ok(Math.abs(mesh.material.opacity - CONTACTO.dia) < 1e-9);
});
