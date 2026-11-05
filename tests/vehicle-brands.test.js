import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { CAR_MODELS } from '../src/world/bogota/carModels.js';

// Los carros imitan formas, nunca marcas. Los nombres van cifrados para que este archivo tampoco los contenga.
const CODED = [
  'cmVuYXVsdA==', 'Y2hldnJvbGV0', 'bWF6ZGE=', 'dG95b3Rh', 'a2lh', 'aHl1bmRhaQ==', 'bmlzc2Fu', 'c3V6dWtp', 'Zm9yZA==',
  'aG9uZGE=', 'ZGFjaWE=', 'dm9sa3N3YWdlbg==', 'c3Bhcmsg', 'cGljYW50bw==', 'bG9nYW4=', 'c2FuZGVybw==', 'c3RlcHdheQ==',
  'ZHVzdGVy', 'dHJhY2tlcg==', 'aGlsdXg=', 'ZC1tYXg=', 'ZnJvbnRpZXI=', 'YXZlbw==', 'bjMwMA==', 'Y29vcGNhc3Vy',
  'c2l0cCBwcm92aXNpb25hbA==', 'eWFtYWhh', 'YmFqYWo=', 'cHVsc2Fy', 'Ym94ZXI=',
  // Apodos con los que se conocen en Colombia algunos modelos: tampoco sirven de identificador.
  'YW1pZ29maWVs', 'YW1pZ28gZmllbA==', 'emFwYXRpY28=', 'aHVldml0bw==',
].map(name => Buffer.from(name, 'base64').toString('utf8').trim());

const here = new URL('../src/world/bogota/', import.meta.url);
const FILES = readdirSync(here).filter(name => /^(car[A-Z].*|vehicles|VehicleBody|suv|motos)\.js$/.test(name)).map(name => new URL(name, here));
FILES.push(new URL('../src/entities/Car.js', import.meta.url), new URL('../docs/vehiculos-bogota.md', import.meta.url));

test('ningún archivo de la flota nombra una marca real', () => {
  assert.ok(FILES.length >= 9, 'la lista de archivos sigue encontrando la flota');
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const name of CODED) {
      // Palabras enteras: un nombre metido dentro de otra palabra no cuenta.
      const found = new RegExp(`(^|[^a-záéíóúñ])${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}($|[^a-záéíóúñ])`).test(text);
      assert.ok(!found, `${file} contiene un nombre vetado`);
    }
  }
});

/** Piezas sueltas de un lote: las que no comparten ningún vértice. El emblema de un carro siempre es una pieza aparte de la parrilla. */
function pieces(geometry) {
  const { position } = geometry.attributes, index = geometry.index, parent = Array.from({ length: position.count }, (_, i) => i);
  const root = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < index.count; i += 3) {
    parent[root(index.getX(i))] = root(index.getX(i + 1));
    parent[root(index.getX(i + 2))] = root(index.getX(i + 1));
  }
  const boxes = new Map(), point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const key = root(i);
    if (!boxes.has(key)) boxes.set(key, new THREE.Box3());
    boxes.get(key).expandByPoint(point.fromBufferAttribute(position, i));
  }
  return [...boxes.values()];
}

/**
 * Lo que tendría forma de emblema: en la nariz o la cola, centrado sobre el eje del carro y de 4 a 28 cm de ancho, con otros 4 cm
 * de alto o de fondo. Quedan fuera las placas y sus marcos (más anchos), las antenas (planas) y las manijas (muy bajas).
 */
function emblems(geometry, length) {
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  return pieces(geometry).filter(box => {
    box.getSize(size); box.getCenter(center);
    return Math.abs(center.x) > length / 2 - .9 && Math.abs(center.z) < .01 && size.z >= .04 && size.z < .28 && Math.max(size.y, size.x) >= .04;
  });
}

function fakeBatch(...quads) {
  const position = [], index = [];
  for (const [x, y, z, w, h] of quads) {
    const first = position.length / 3;
    position.push(x, y - h / 2, z, x, y, z + w / 2, x, y + h / 2, z, x, y, z - w / 2);
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(position, 3)).setIndex(index);
}

test('la búsqueda de emblemas reconoce uno cuando lo hay, y no confunde placas ni manijas', () => {
  const L = 4;
  const found = geometry => emblems(geometry, L).length;
  assert.equal(found(fakeBatch([2, .7, 0, .12, .12])), 1, 'un rombo en la parrilla');
  assert.equal(found(fakeBatch([-2, .9, 0, .24, .06])), 1, 'unas alas en la cola');
  assert.equal(found(fakeBatch([2, .7, 0, .32, .155])), 0, 'una placa');
  assert.equal(found(fakeBatch([-2, 1.1, 0, .23, .027])), 0, 'una manija');
  assert.equal(found(fakeBatch([2, .7, .4, .12, .12])), 0, 'una pieza a un lado, como un faro');
  assert.equal(found(fakeBatch([0, 1.5, 0, .12, .12])), 0, 'lejos de los extremos');
});

test('ningún modelo lleva un emblema en la nariz ni en la cola', () => {
  const KINDS = { citadino: ['carro', 'taxi'], sedanPopular: ['carro', 'taxi', 'police'], suv: ['carro', 'police'], buseta: ['buseta'] };
  for (const [id, spec] of Object.entries(CAR_MODELS)) {
    for (const kind of KINDS[id] ?? ['carro']) {
      const v = makeVehicle(kind, 3, { beams: false, model: id });
      for (const mesh of [v.bodyVisual, ...v.bodyVisual.children]) {
        if (!['Carrocería suspendida', 'Molduras e interior', 'Lámparas y placas'].includes(mesh.name)) continue;
        assert.deepEqual(emblems(mesh.geometry, spec.L), [], `${id}/${kind}: pieza con forma de emblema en ${mesh.name}`);
      }
      v.dispose();
    }
  }
});
