import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { buildD69Store } from '../src/world/bogota/D69Store.js';

const construir = () => {
  const azar = Math.random;
  let sorteos = 0;
  Math.random = () => { sorteos++; return azar(); };
  let tienda;
  try { tienda = buildD69Store({ createSign: () => new THREE.Texture() }); } finally { Math.random = azar; }
  const malla = tienda.getObjectByName('Edificio D69');
  return { tienda, sorteos, geometria: malla.geometry };
};

const huella = (geometria, cuales) => {
  const pos = geometria.attributes.position, hash = createHash('sha256');
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (!cuales(i)) continue;
    n++;
    hash.update([pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => v.toFixed(4)).join(',') + ';');
  }
  return [n, hash.digest('hex').slice(0, 16)];
};

test('Doña Inés gasta el mismo azar de la ciudad y conserva la góndola norte y la fruta', () => {
  const { sorteos, geometria } = construir();
  assert.equal(sorteos, 56);
  const pos = geometria.attributes.position, color = geometria.attributes.color;
  assert.deepEqual(huella(geometria, i => Math.abs(color.getW(i) - 1.7) < 1e-6 && pos.getZ(i) < 159), [220, 'fc4680dd6b16c175']);
  const fruta = i => pos.getX(i) > 52.4 && pos.getX(i) < 53.1 && pos.getY(i) > .74 && pos.getY(i) < 1.1 && pos.getZ(i) > 163.4 && pos.getZ(i) < 165.3;
  assert.deepEqual(huella(geometria, fruta), [672, 'a6b23fedffd63827']);
});

const vertices = geometria => {
  const pos = geometria.attributes.position, color = geometria.attributes.color, lista = [];
  for (let i = 0; i < pos.count; i++) {
    lista.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), c: [color.getX(i), color.getY(i), color.getZ(i)], a: color.getW(i) });
  }
  return lista;
};
const cerca = (a, b, tolerancia = 2e-4) => Math.abs(a - b) < tolerancia;
const luz = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
const mezcla = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

test('el barro sube del zócalo de los muros que dan al andén y se pierde en la pintura, sin brillar de noche', () => {
  const lista = vertices(construir().geometria);
  // La pared norte del local: sus esquinas dicen de qué color es a cada altura.
  const pared = lista.filter(v => cerca(v.z, 159) && cerca(v.x, 43) && (cerca(v.y, 0) || cerca(v.y, 3.8)));
  const pie = pared.find(v => cerca(v.y, 0)).c, alto = pared.find(v => cerca(v.y, 3.8)).c;
  assert.ok(luz(pie) < luz(alto) * .8, 'el muro se ensucia hacia abajo');
  const zocalo = .42, barro = lista.filter(v => cerca(v.z, 158.99) && v.y < 1.05);
  assert.ok(barro.length >= 40);
  for (const v of barro) {
    assert.equal(v.a, 0);
    assert.ok(v.x < 45.151 || v.x > 50.849, `sin barro frente al vidrio: x ${v.x}`);
    if (v.y < zocalo) assert.ok(luz(v.c) < luz(mezcla(pie, alto, v.y / 3.8)) * .75, 'barro donde termina el zócalo');
    else mezcla(pie, alto, v.y / 3.8).forEach((k, i) => assert.ok(cerca(v.c[i], k, 1e-3), 'el borde de arriba es la misma pintura'));
  }
  const oriente = lista.filter(v => cerca(v.x, 53.01) && v.y < 1.05);
  for (const [z0, z1] of [[159.6, 160.2], [168.5, 168.9], [171.8, 172.4]]) {
    assert.ok(oriente.some(v => v.z > z0 - .01 && v.z < z1 + .01 && v.y < zocalo), `machón ${z0}`);
    assert.ok(oriente.some(v => v.z > z0 - .01 && v.z < z1 + .01 && v.y > .6), `machón ${z0}: sube sobre el zócalo`);
  }
});

test('chorreones oscuros bajan del remate sobre el verde y del antepecho sobre el muro, nunca sobre el vidrio', () => {
  const lista = vertices(construir().geometria);
  for (const [cara, cuantos] of [[v => cerca(v.x, 53.068), 14], [v => cerca(v.z, 158.932), 10]]) {
    const chorros = lista.filter(cara);
    assert.equal(chorros.length, cuantos * 4);
    const arriba = chorros.filter(v => cerca(v.y, 5.1)), abajo = chorros.filter(v => v.y < 5.1 - .3);
    assert.equal(arriba.length, cuantos * 2);
    assert.equal(abajo.length, cuantos * 2);
    assert.ok(chorros.every(v => v.a === 0 && v.y > 4.1));
    assert.ok(Math.max(...arriba.map(v => luz(v.c))) < Math.min(...abajo.map(v => luz(v.c))), 'más oscuros arriba');
  }
  const muro = lista.filter(v => cerca(v.z, 158.99) && v.y > 2.6);
  assert.ok(muro.some(v => cerca(v.y, 3.8)));
  assert.ok(muro.every(v => v.x < 45.151 || v.x > 50.849));
});

test('el verde está más claro arriba, donde le pega el sol, y la mugre cabe en el presupuesto', () => {
  const { geometria } = construir();
  const lista = vertices(geometria);
  const antepecho = lista.filter(v => cerca(v.x, 53.06) && v.z > 159 && v.z < 173.1 && (cerca(v.y, 3.8) || cerca(v.y, 5.1)));
  const abajo = antepecho.find(v => cerca(v.y, 3.8)).c, arriba = antepecho.find(v => cerca(v.y, 5.1)).c;
  assert.ok(luz(arriba) > luz(abajo) * 1.2);
  const esMugre = ({ x, y, z, a }) => a === 0 && (
    ((cerca(z, 158.99) || cerca(x, 53.01)) && y < 1.055) ||
    cerca(x, 53.068) || cerca(z, 158.932) || (cerca(z, 158.99) && y > 2.6));
  const index = geometria.index.array;
  let triangles = 0;
  for (let i = 0; i < index.length; i += 3) {
    if (esMugre(lista[index[i]]) && esMugre(lista[index[i + 1]]) && esMugre(lista[index[i + 2]])) triangles++;
  }
  assert.equal(triangles, 112);
});

test('de noche el porche alumbra la vitrina y el alero, no el muro del fondo', () => {
  const lista = vertices(construir().geometria);
  const fondo = lista.filter(v => cerca(v.x, 52.561) || cerca(v.x, 51.911));
  assert.ok(fondo.length >= 8);
  assert.ok(fondo.every(v => v.a <= .06 + 1e-6));
  const cielo = lista.filter(v => cerca(v.y, 3.72) && v.x > 51.8 && v.x < 53.4 && v.z > 160 && v.z < 172);
  assert.ok(cielo.length >= 8);
  assert.ok(cielo.every(v => v.a <= .1 + 1e-6));
  assert.ok(lista.some(v => cerca(v.a, 2.4, 1e-5)) && lista.some(v => cerca(v.a, 3, 1e-5)));
});

test('ambos costados conservan el tono del cielo y el reflejo en diagonal', () => {
  const { tienda, geometria } = construir();
  const norte = vertices(geometria).filter(v => cerca(v.a, 2.4, 1e-5));
  const oriente = vertices(tienda.getObjectByName('Vidrio oriental de Doña Inés').geometry);
  const caras = [
    { vidrio: norte.filter(v => cerca(v.z, 158.9)), brillo: norte.filter(v => cerca(v.z, 158.896)), u: v => v.x, n: 4 },
    { vidrio: oriente.filter(v => cerca(v.x, 52.63)), brillo: oriente.filter(v => cerca(v.x, 52.633)), u: v => v.z, n: 8 }
  ];
  for (const { vidrio, brillo, u, n } of caras) {
    assert.equal(vidrio.length, n);
    assert.equal(brillo.length, n);
    const pie = Math.min(...vidrio.map(v => v.y)), techo = Math.max(...vidrio.map(v => v.y));
    const abajo = vidrio.find(v => cerca(v.y, pie)).c, arriba = vidrio.find(v => cerca(v.y, techo)).c;
    assert.ok(luz(arriba) > luz(abajo) * 1.3, 'más claro arriba');
    for (const v of brillo) assert.ok(luz(v.c) > luz(cerca(v.y, pie) ? abajo : arriba), 'el reflejo es más claro que el vidrio');
    const bajo = brillo.filter(v => cerca(v.y, pie)).map(u), alto = brillo.filter(v => cerca(v.y, techo)).map(u);
    assert.ok(Math.abs(Math.min(...bajo) - Math.min(...alto)) > .3, 'en diagonal');
  }
});

test('el lote de Doña Inés arma los mismos choques', () => {
  const city = new Bogota(); city.map = city._layout();
  const collisions = new CollisionSystem(); city._buildCollisions(city.map, collisions);
  const lote = new THREE.Box3(new THREE.Vector3(42.5, -1, 158.5), new THREE.Vector3(53.5, 10, 173.5));
  const cajas = collisions.colliders.filter(({ box }) => box.intersectsBox(lote))
    .map(({ box }) => [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(v => +v.toFixed(3)));
  assert.deepEqual(cajas, [
    [29, 0, 159, 43, 8, 161], [43, 0, 159, 53, 5, 161], [41, 0, 161, 43, 8, 163], [43, 0, 161, 53, 5, 163],
    [41, 0, 163, 43, 8, 165], [43, 0, 163, 53, 5, 165], [41, 0, 165, 43, 8, 167], [43, 0, 165, 53, 5, 167],
    [41, 0, 167, 43, 8, 169], [43, 0, 167, 53, 5, 169], [41, 0, 169, 43, 8, 171], [43, 0, 169, 53, 5, 171],
    [41, 0, 171, 43, 8, 173], [43, 0, 171, 53, 5, 173], [29, 0, 173, 53, 8, 175]
  ]);
});
