import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import * as TX from '../src/world/bogota/textures.js';

function verifySurface(maps) {
  assert.equal(maps.map.colorSpace, THREE.SRGBColorSpace);
  for (const role of ['bumpMap', 'roughnessMap']) {
    const texture = maps[role];
    assert.ok(texture?.isTexture, `${role} disponible para el material PBR`);
    assert.equal(texture.colorSpace, THREE.NoColorSpace);
    assert.notEqual(texture.image, maps.map.image, 'color y datos físicos no comparten la imagen');
    assert.equal(texture.image.width, maps.map.image.width);
    assert.equal(texture.image.height, maps.map.image.height);
  }
  assert.notEqual(maps.bumpMap.image, maps.roughnessMap.image);
  for (const texture of Object.values(maps)) texture.dispose();
}

test('los materiales de calle entregan albedo sRGB y relieve/rugosidad independientes en espacio lineal', () => {
  for (const create of [TX.asphalt, TX.sidewalk, TX.brick, TX.concrete, TX.dirt, TX.grass, TX.roofTiles, TX.slab]) {
    verifySurface(create());
  }
});

test('las fachadas mantienen emisión de color y datos físicos separados en todos los estilos', () => {
  for (const style of ['pintada', 'ladrillo', 'ruina']) {
    const maps = TX.facade({ seed: 42, width: 6, floors: 3, style });
    assert.equal(maps.emissiveMap.colorSpace, THREE.SRGBColorSpace);
    assert.notEqual(maps.emissiveMap.image, maps.map.image);
    verifySurface(maps);
  }
});

test('los perfiles de barrio son opcionales y conservan dimensiones y canales de las texturas', () => {
  const original = TX.sidewalk(11);
  for (const district of ['centro', 'cambuche', 'comercio', 'lago', 'desconocido']) {
    const walk = TX.sidewalk(11, { district });
    assert.equal(walk.map.image.width, original.map.image.width);
    verifySurface(walk);
    verifySurface(TX.facade({ seed: 12, width: 6, floors: 2, district, wallColor: '#ccc4aa' }));
  }
  for (const texture of Object.values(original)) texture.dispose();
});

test('el tamaño de mapas permanece acotado al construir torres o solicitar asfalto grande', () => {
  const road = TX.asphalt(7, 4096);
  assert.equal(road.map.image.width, 1024);
  verifySurface(road);
  const tower = TX.facade({ seed: 5, width: 60, floors: 30, pxPerM: 80 });
  assert.ok(tower.map.image.width <= 1024);
  assert.ok(tower.map.image.height <= 2048);
  verifySurface(tower);
  assert.equal(TX.BRICK_TILE.w / TX.BRICK_M.w, 8);
  assert.equal(TX.BRICK_TILE.h / TX.BRICK_M.h, 24);
});
