import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { prepararDetalleMotos } from '../src/world/bogota/detalleMotos.js';
import { motoDistante, kitDistante } from '../src/world/bogota/motoDistante.js';
import { makeParkedMotos } from '../src/world/bogota/motos.js';

test('cada fila elige el detalle por la cámara y conserva el estado entre los umbrales', () => {
  const raiz = makeParkedMotos([
    { x: 0, z: 0, rot: 0, group: 4 },
    { x: 100, z: 0, rot: 0, group: 1 }
  ]);
  raiz.position.x = 45;
  raiz.updateMatrixWorld();
  const [fila, distante] = raiz.children, [kit] = fila.children;
  const motoCerca = fila.geometry, kitCerca = kit.geometry;
  const camara = new PerspectiveCamera(55, 1, .1, 300);
  const original = Math.random;
  try {
    Math.random = () => { throw new Error('el detalle consume azar de la partida'); };
    const actualizar = prepararDetalleMotos(raiz);
    const mirar = distancia => {
      camara.position.set(45, .7, distancia);
      camara.updateMatrixWorld();
      actualizar(camara);
    };
    assert.equal(fila.geometry, motoCerca);
    mirar(3);
    assert.equal(distante.geometry, motoDistante());
    assert.equal(fila.geometry, motoCerca);
    mirar(40);
    assert.equal(fila.geometry, distante.geometry);
    assert.equal(kit.geometry, kitDistante());
    mirar(27);
    assert.equal(fila.geometry, motoDistante());
    mirar(19);
    assert.equal(fila.geometry, motoCerca);
    assert.equal(kit.geometry, kitCerca);
    mirar(27);
    assert.equal(fila.geometry, motoCerca);
    mirar(50);
    camara.zoom = 3;
    camara.updateProjectionMatrix();
    mirar(50);
    assert.equal(fila.geometry, motoCerca, 'el teleobjetivo acerca las piezas');
  } finally {
    Math.random = original;
    raiz.dispose();
  }
});

test('una cámara ortográfica cambia el detalle con el zoom aunque su posición sea la misma', () => {
  const raiz = makeParkedMotos([{ x: 0, z: 0, rot: 0 }]);
  const [moto] = raiz.children, cerca = moto.geometry;
  const actualizar = prepararDetalleMotos(raiz);
  const camara = new OrthographicCamera(-32, 32, 32, -32, .1, 300);
  camara.position.z = 100;
  camara.updateMatrixWorld();
  actualizar(camara);
  assert.equal(moto.geometry, motoDistante());
  camara.zoom = 4;
  camara.updateProjectionMatrix();
  actualizar(camara);
  assert.equal(moto.geometry, cerca);
  raiz.dispose();
});
