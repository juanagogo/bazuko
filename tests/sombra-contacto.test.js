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

test('la sombra de contacto no gasta el azar con que se arma la ciudad', () => {
  const { group, sorteos } = armar(district(), [{ x: 40, z: 40 }]);
  assert.equal(sorteos(), 0, 'ni un sorteo del juego: Three sortea identificadores y deben salir del azar propio');
  assert.ok(group.children.length > 0);
});

test('va en su lote, sobre el suelo pintado y bajo las manchas de la gente, sin escribir profundidad', () => {
  const city = district(), { group } = armar(city);
  assert.equal(group.parent, city.group);
  assert.ok(group.userData.noMerge);
  const materiales = new Set(group.children.map(mesh => mesh.material));
  assert.equal(materiales.size, 1);
  const [material] = materiales;
  assert.equal(material.depthWrite, false);
  assert.equal(material.transparent, true);
  assert.ok(material.polygonOffset && material.polygonOffsetFactor < 0);
  for (const mesh of group.children) {
    assert.equal(mesh.renderOrder, 0);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.matrixAutoUpdate, false, 'quieta: no entra al recorrido de matrices');
  }
  // Trozos grandes: pocas llamadas en toda la ciudad.
  assert.ok(group.children.length <= 16, `${group.children.length} trozos`);
});

test('cada franja está pegada a un muro y cuesta poco', () => {
  const city = district(), { group } = armar(city), { map } = city;
  let triangulos = 0, vertices = 0;
  const cercaDeMuro = (x, z) => {
    for (let tz = Math.round(z / T) - 1; tz <= Math.round(z / T) + 1; tz++) for (let tx = Math.round(x / T) - 1; tx <= Math.round(x / T) + 1; tx++) {
      if (MUROS.has(map[tz]?.[tx])) return true;
    }
    return false;
  };
  for (const mesh of group.children) {
    const p = mesh.geometry.attributes.position, c = mesh.geometry.attributes.color;
    assert.equal(c.itemSize, 4, 'la carga de cada tramo va en el cuarto canal');
    triangulos += mesh.geometry.index.count / 3;
    for (let i = 0; i < p.count; i++) {
      vertices++;
      assert.ok(cercaDeMuro(p.getX(i), p.getZ(i)), `franja lejos de todo muro en ${p.getX(i)}, ${p.getZ(i)}`);
      assert.ok(p.getY(i) > 0 && p.getY(i) < 1.2, 'a ras de piso');
    }
  }
  assert.ok(vertices > 1000, 'la ciudad tiene muros');
  assert.ok(triangulos < 16000, `${triangulos} triángulos en toda la ciudad`);
});

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

test('la reja de la orilla no oscurece el piso: deja ver a través', () => {
  const city = district(), { map } = city, { group } = armar(city);
  // Orilla sur con prado o plaza al frente: ahí el borde es reja y no hay franja acostada contra él.
  const filas = map.length, cols = map[0].length, abiertos = new Set(['grass', 'plaza']);
  const medioZ = (filas - 1.5) * T + (CONTACTO.dentro - CONTACTO.ancho) / 2, centros = [];
  for (let tx = 1; tx < cols - 1; tx++) if (map[filas - 1][tx] === 'wall' && abiertos.has(map[filas - 2][tx])) centros.push(tx * T);
  assert.ok(centros.length > 0, 'la orilla sur tiene reja');
  for (const mesh of group.children) {
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i + 3 < p.count; i += 4) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2) + p.getX(i + 3)) / 4, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2) + p.getZ(i + 3)) / 4;
      if (Math.abs(z - medioZ) > .2) continue;
      assert.ok(!centros.some(cx => Math.abs(cx - x) < .3), `franja al pie de la reja en ${x}, ${z}`);
    }
  }
});
