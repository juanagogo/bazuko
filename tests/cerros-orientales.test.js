import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBackdropTerrain, FIGURE_ANGLE, PEAK_ANGLE } from '../src/world/bogota/BackdropTerrain.js';
import { buildCityBackdrop } from '../src/world/bogota/CityBackdrop.js';

const MAPA = { width: 400, height: 322, corridors: [] };

test('Monserrate y Guadalupe conservan sus apoyos sobre triángulos de la cresta', () => {
  const fondo = buildCityBackdrop(MAPA);
  const terreno = fondo.children.find(mesh => mesh.name === 'Suelo y cerros');
  const { peak, figurePeak } = fondo.userData;
  assert.ok(peak.z < MAPA.height / 2 && figurePeak.z > MAPA.height / 2);
  assert.ok(peak.x > MAPA.width && figurePeak.x > MAPA.width && figurePeak.y > peak.y);
  const rayo = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (const cumbre of [peak, figurePeak]) {
    rayo.ray.origin.set(cumbre.x, 300, cumbre.z);
    const [contacto] = rayo.intersectObject(terreno);
    assert.ok(contacto, 'la cumbre tiene suelo dibujado');
    assert.ok(Math.abs(contacto.point.y - cumbre.y - 1) < .01, 'la base se entierra un metro');
  }
});

test('el boquerón conserva una falda entre los dos lomos y la malla cierra al occidente', () => {
  const { surface } = buildBackdropTerrain(MAPA);
  const paso = -.06;
  const alturaPaso = surface(paso, 1).y;
  assert.ok(alturaPaso < surface(PEAK_ANGLE, 1).y - 45);
  assert.ok(alturaPaso < surface(FIGURE_ANGLE, 1).y - 50);
  assert.ok(surface(paso, .46).y > surface(paso, .26).y + 3);
  assert.ok(surface(paso, .46).y < surface(PEAK_ANGLE, .46).y - 30);
  for (const t of [.1, .45, 1, 1.7]) {
    assert.ok(Math.abs(surface(-Math.PI, t).y - surface(Math.PI, t).y) < .01);
  }
});

test('el cordón lejano tiene una falda y una contrapendiente en la misma pasada de cerros', () => {
  const { geometry, cx, cz } = buildBackdropTerrain(MAPA);
  const { position, terrainCover } = geometry.attributes;
  const perfil = [];
  for (let i = 0; i < position.count; i++) {
    if (terrainCover.getY(i) < 1 || Math.abs(position.getZ(i) - cz) > .01 || position.getX(i) < cx) continue;
    perfil.push({ x: position.getX(i), y: position.getY(i) });
  }
  perfil.sort((a, b) => a.x - b.x);
  const pie = perfil[0], ladera = perfil[1], fondo = perfil.at(-1);
  const cumbre = perfil.reduce((a, b) => a.y > b.y ? a : b);
  assert.ok(cumbre.x - pie.x > 250 && fondo.x - cumbre.x > 90);
  assert.ok(pie.y < ladera.y && ladera.y < cumbre.y && fondo.y < cumbre.y);
  assert.equal(geometry.groups.length, 2);
  assert.ok(geometry.groups[1].count / 3 < 10000);
});

test('las viviendas de ladera salen en cotas escalonadas y apoyan toda su huella', () => {
  const fondo = buildCityBackdrop(MAPA);
  const { heightAt, cx, cz } = buildBackdropTerrain(MAPA);
  const matrix = new THREE.Matrix4(), punto = new THREE.Vector3(), centros = [];
  for (const malla of fondo.children.filter(objeto => objeto.isInstancedMesh)) {
    const perfil = malla.geometry.attributes.instanceSettlement;
    for (let i = 0; i < malla.count; i++) {
      if (perfil.getY(i) !== 1) continue;
      malla.getMatrixAt(i, matrix);
      const centro = punto.setFromMatrixPosition(matrix).clone();
      const rumbo = Math.atan2(centro.z - cz, centro.x - cx);
      assert.ok(centro.z > MAPA.height && rumbo > .9 && rumbo < 2.15);
      assert.ok(perfil.getX(i) > 0);
      for (const x of [-.5, -.25, 0, .25, .5]) for (const z of [-.5, -.25, 0, .25, .5]) {
        punto.set(x, 0, z).applyMatrix4(matrix);
        const cota = heightAt(punto.x, punto.z);
        assert.ok(cota !== null && cota - punto.y > .05, 'el cimiento entra incluso en el lado cuesta abajo');
      }
      assert.ok(centros.every(otro => Math.hypot(otro.x - centro.x, otro.z - centro.z) > 2));
      centros.push(centro);
    }
  }
  assert.ok(centros.length > 300);
  assert.ok(Math.max(...centros.map(p => p.y)) - Math.min(...centros.map(p => p.y)) > 35);
});

test('las vías de ladera siguen las caras del cerro entre vértices', () => {
  const terrain = buildBackdropTerrain(MAPA).geometry;
  const cerro = new THREE.Mesh(terrain);
  const { index, attributes } = buildCityBackdrop(MAPA).getObjectByName('Suelo y cerros').geometry;
  const { position, terrainCover } = attributes;
  const inicio = terrain.index.count;
  assert.deepEqual(index.array.slice(0, inicio), terrain.index.array);
  for (const name of ['position', 'normal', 'color', 'terrainCover']) {
    const original = terrain.attributes[name].array;
    assert.deepEqual(attributes[name].array.slice(0, original.length), original);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const centro = new THREE.Vector3(), vertice = new THREE.Vector3();
  assert.ok((index.count - inicio) / 3 > 1000 && (index.count - inicio) / 3 < 9500);
  for (let i = inicio; i < index.count; i += 3 * 89) {
    centro.set(0, 0, 0);
    for (let j = 0; j < 3; j++) {
      const vertexIndex = index.getX(i + j);
      assert.equal(terrainCover.getX(vertexIndex), -1);
      centro.add(vertice.fromBufferAttribute(position, vertexIndex));
    }
    centro.multiplyScalar(1 / 3);
    assert.ok(centro.z > MAPA.height);
    ray.ray.origin.set(centro.x, 300, centro.z);
    const [contacto] = ray.intersectObject(cerro);
    assert.ok(contacto && Math.abs(centro.y - contacto.point.y - .08) < .002, 'la cara de la calle apoya en la ladera');
  }
});
