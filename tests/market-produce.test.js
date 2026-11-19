import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildMarket } from '../src/world/bogota/EastLandmarks.js';

const market = () => buildMarket({ detail: new THREE.MeshStandardMaterial() });
const produce = ({ group }) => group.children.find(mesh => mesh.name === 'Surtido del mercado');
const skinAt = (uv, i) => Math.floor(uv.getY(i) * 8);

test('los seis puestos tienen surtido de varias familias y tonos dentro de cada guacal', () => {
  const plaza = market(), mesh = produce(plaza);
  assert.ok(mesh?.material.vertexColors && mesh.castShadow && mesh.receiveShadow);
  const { position, color, uv } = mesh.geometry.attributes;
  const papayaStalls = [];
  for (const [stall, { x, z }] of plaza.colliders.entries()) {
    const bySkin = new Map(), baskets = new Set(), hanging = new Set(), aisles = new Set();
    let piled = false, cut = false;
    for (let i = 0; i < position.count; i++) {
      const fromCenter = position.getZ(i) - z;
      if (Math.abs(position.getX(i) - x) > 2 || Math.abs(fromCenter) > 1.3) continue;
      const y = position.getY(i), skin = skinAt(uv, i);
      if (y < .6) baskets.add(skin);
      if (y > 1.6) hanging.add(skin);
      if (y < 1.15 || y > 1.6 || skin === 6) continue;
      const tones = bySkin.get(skin) ?? new Set();
      tones.add([color.getX(i), color.getY(i), color.getZ(i)].map(v => Math.round(v * 80)).join(','));
      bySkin.set(skin, tones);
      if (fromCenter * (stall < 3 ? 1 : -1) <= 0) continue;
      aisles.add(skin);
      if (skin <= 2 && y > 1.34) piled = true;
      if (skin === 7 && color.getX(i) > color.getY(i) * 2 && color.getX(i) > .3) cut = true;
    }
    assert.ok(bySkin.size >= 4, `escaso surtido en ${x}, ${z}`);
    assert.ok([...bySkin.values()].every(tones => tones.size > 6), `un alimento de un solo tono en ${x}, ${z}`);
    assert.ok(baskets.size && hanging.has(5), `canastos o plátanos faltantes en ${x}, ${z}`);
    assert.ok(aisles.size > 1 && piled, `faltan familias al pasillo o frutos sobre la primera capa de ${stall}`);
    if (cut) papayaStalls.push(stall);
  }
  assert.deepEqual(papayaStalls, [0, 3], 'la papaya entera y partida caracteriza los puestos del extremo occidental');
});

test('la piel se muestrea a lo ancho y las normales de frutos y hojas acompañan la superficie', () => {
  const mesh = produce(market()), { geometry, material } = mesh;
  const { position, normal, uv } = geometry.attributes, { data, width, height } = material.map.image;
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.ok(material.map.generateMipmaps);
  const uBounds = Array.from({ length: 8 }, () => [1, 0]);
  const a = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const average = new THREE.Vector3(), value = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const u = uv.getX(i), range = uBounds[skinAt(uv, i)];
    range[0] = Math.min(range[0], u);
    range[1] = Math.max(range[1], u);
    assert.ok(Math.abs(value.fromBufferAttribute(normal, i).lengthSq() - 1) < 1e-5);
  }
  for (const skin of [0, 1, 2, 3, 4, 5, 7]) {
    const [u0, u1] = uBounds[skin];
    assert.ok(u1 - u0 > .85, `muestra de piel demasiado estrecha en banda ${skin}`);
    const shades = new Set(), start = skin * width * height / 8 * 4, end = start + width * height / 8 * 4;
    for (let i = start; i < end; i += 4) shades.add(data[i]);
    assert.ok(shades.size > 12, `no se distingue el relieve de piel ${skin}`);
  }
  for (let i = 0; i < geometry.index.count; i += 3) {
    const v0 = geometry.index.getX(i), v1 = geometry.index.getX(i + 1), v2 = geometry.index.getX(i + 2);
    a.fromBufferAttribute(position, v0);
    ab.fromBufferAttribute(position, v1).sub(a);
    ac.fromBufferAttribute(position, v2).sub(a);
    average.fromBufferAttribute(normal, v0).add(value.fromBufferAttribute(normal, v1)).add(value.fromBufferAttribute(normal, v2));
    assert.ok(ab.cross(ac).dot(average) > -1e-9, `cara invertida en ${i / 3}`);
  }
});

test('la pulpa y el tomate tienen menos rugosidad que los cítricos y las papas', () => {
  const { material } = produce(market()), roughness = material.roughnessMap;
  assert.equal(roughness.colorSpace, THREE.NoColorSpace);
  assert.ok(roughness.generateMipmaps);
  const { width, height, data } = roughness.image;
  const sample = (band, offset) => data[(Math.floor((band + offset) * height / 8) * width + Math.floor(width / 2)) * 4 + 1];
  assert.ok(sample(1, .5) < sample(0, .5) && sample(0, .5) < sample(2, .5));
  assert.ok(sample(7, .81) < sample(7, .36) && sample(7, .36) < sample(2, .5));
});

test('las manos de plátano caben dentro de las envolventes originales de cámara', () => {
  const plaza = market(), boxes = plaza.cameraDisplays.filter(display => display.approach === 1).map(display => display.box);
  const coords = boxes.map(box => [...box.min.toArray(), ...box.max.toArray()].map(n => Math.round(n * 1e5)));
  assert.equal(boxes.length, 18);
  assert.equal(createHash('sha256').update(JSON.stringify(coords)).digest('hex'),
    '1c3717cd0f35b47567f24ad00c9074a74635745c3cee7c4b489edfcb011920fc');
  const { position, uv } = produce(plaza).geometry.attributes;
  const point = new THREE.Vector3();
  for (const box of boxes) box.expandByScalar(.00005);
  for (let i = 0; i < position.count; i++) {
    if (skinAt(uv, i) !== 5) continue;
    point.fromBufferAttribute(position, i);
    assert.ok(boxes.some(box => box.containsPoint(point)), `plátano fuera de la caja en ${point.toArray()}`);
  }
});

test('armar dos veces el surtido reproduce posiciones, tonos y UV', () => {
  const a = produce(market()).geometry, b = produce(market()).geometry;
  for (const field of ['position', 'color', 'uv']) assert.deepEqual(a.attributes[field].array, b.attributes[field].array);
});
