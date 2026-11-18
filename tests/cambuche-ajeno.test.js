import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';

// Se comprueba la geometría real sin necesitar Canvas para las texturas.
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture() });
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, cardboard: textureSet, trashBag: textureSet } });
const { shack } = await import('../src/world/bogota/props.js');

/** Arma un cambuche ajeno con un azar de semilla y cuenta cuántos números pidió. */
function armar(semilla) {
  const random = Math.random;
  let s = semilla >>> 0, sorteos = 0;
  try {
    Math.random = () => { sorteos++; return (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
    const refugio = shack();
    refugio.updateMatrixWorld(true);
    return { refugio, sorteos };
  } finally {
    Math.random = random;
  }
}
const mallas = refugio => refugio.children.filter(o => o.isMesh);
const caja = objeto => new THREE.Box3().setFromObject(objeto);
const triangulos = refugio => mallas(refugio).reduce((n, o) => n + o.geometry.index.count / 3, 0);
armar(1); // La primera vez se crean las texturas compartidas: no cuenta.

test('el cambuche ajeno tiene la lona doble y colgada, una cobija encima, tablas que la sujetan, espaldar y tendido', () => {
  const { refugio } = armar(7);
  const lona = mallas(refugio).find(o => o.material.side === THREE.DoubleSide);
  // Dos pedazos montados en una sola malla, colgados entre las varas: en el medio quedan más bajos que el plano
  // entre sus bordes.
  const puntos = lona.geometry.attributes.position;
  assert.equal(puntos.count, 2 * 5 * 7, 'la lona de siempre y otro pedazo encima');
  let comba = 0;
  for (let i = 0; i < puntos.count; i++) comba = Math.max(comba, -Math.tan(0.2) * puntos.getZ(i) - puntos.getY(i));
  assert.ok(comba > 0.04, `la lona está tiesa (${comba})`);
  const carton = refugio.children.find(o => o.geometry?.parameters?.width === 1.9);
  const cobija = mallas(refugio).find(o => o !== carton && o !== lona && o.material.color.getHex() !== 0x4a3a28);
  assert.ok(caja(cobija).max.y > 1 && caja(cobija).min.y < 0.1, 'la cobija está en el piso y hay otra tendida en el techo');
  const madera = mallas(refugio).filter(o => o.material.color.getHex() === 0x4a3a28);
  assert.equal(madera.length, 4, 'palos, tablas del techo, espaldar y costado');
  assert.equal(new Set(madera.map(o => o.material)).size, 1, 'la madera comparte material');
  assert.ok(madera.some(o => caja(o).min.y > 0.9), 'faltan las tablas que sujetan el techo');
  const espaldar = madera.find(o => caja(o).max.z < -0.6 && caja(o).max.x - caja(o).min.x > 1.6);
  assert.ok(espaldar && caja(espaldar).max.y > 0.6 && caja(espaldar).max.y < 0.95, 'falta el espaldar de tablas');
  assert.ok(triangulos(refugio) > 300 && triangulos(refugio) < 450, `${triangulos(refugio)} triángulos`);
});

test('el cambuche ajeno ocupa la misma caja, pisa lo mismo y pide el mismo azar que antes', () => {
  for (const semilla of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { refugio, sorteos } = armar(semilla);
    // Las pruebas de tráfico y de gente siembran el azar y arman la ciudad: si el cambuche pide otra cantidad, todo
    // lo que se sortea después cambia. Antes pedía 78 números y eran siete mallas con cuatro materiales (al unir las
    // mallas estáticas, la ciudad vuelve a sortear por cada una y por cada material distinto).
    assert.equal(sorteos, 78);
    assert.equal(mallas(refugio).length, 7);
    assert.equal(new Set(mallas(refugio).map(o => o.material)).size, 4);
    // La caja de antes: la lona de 2,3 × 1,9 inclinada 0,2 sobre los palos. La usa la ciudad para lo que cae encima.
    const todo = caja(refugio), fondo = 0.95 * Math.cos(0.2), alto = 1.12 + 0.95 * Math.sin(0.2);
    for (const [valor, esperado] of [[todo.min.x, -1.15], [todo.max.x, 1.15], [todo.min.y, 0], [todo.max.y, alto], [todo.min.z, -fondo], [todo.max.z, fondo]]) {
      assert.ok(Math.abs(valor - esperado) < 1e-5, `caja ${todo.min.toArray()} … ${todo.max.toArray()}`);
    }
    for (const malla of mallas(refugio)) {
      // Lo que toca el piso no pasa de los palos: el andén vecino no lo levanta.
      const b = caja(malla);
      if (b.min.y <= 0.15) assert.ok(b.min.x >= -1.0301 && b.max.x <= 1.0301 && b.min.z >= -0.8301 && b.max.z <= 0.8301, 'un apoyo se sale de los palos');
      assert.ok(malla.geometry.attributes.uv && malla.geometry.attributes.normal && malla.geometry.index, 'no entra a los lotes de la ciudad');
      assert.ok(malla.material.userData.staticMergeKey, 'material fuera de los lotes');
      assert.ok(malla.castShadow && malla.receiveShadow);
    }
    // El cartón del piso sigue siendo la caja de 1,9 de ancho, libre donde el piso se compara con él.
    const carton = refugio.children.find(o => o.geometry?.parameters?.width === 1.9);
    assert.equal(carton.geometry.parameters.height, 0.04);
    const rayo = new THREE.Raycaster(new THREE.Vector3(0.63, 0.2, 0.27), new THREE.Vector3(0, -1, 0));
    assert.equal(rayo.intersectObject(refugio, true)[0].object, carton);
  }
});

test('los cambuches ajenos no salen todos iguales, y las caras de sus cajas miran hacia afuera', () => {
  const firma = semilla => mallas(armar(semilla).refugio).map(o => Array.from(o.geometry.attributes.position.array.slice(0, 60), n => n.toFixed(3)).join(',')).join('|');
  assert.notEqual(firma(1), firma(2));
  assert.equal(firma(1), firma(1));
  const { refugio } = armar(3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (const malla of mallas(refugio).filter(o => o.geometry.type === 'BufferGeometry' && o.material.side === THREE.FrontSide)) {
    const { position, normal: normals, index } = { ...malla.geometry.attributes, index: malla.geometry.index };
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i)); b.fromBufferAttribute(position, index.getX(i + 1)); c.fromBufferAttribute(position, index.getX(i + 2));
      normal.fromBufferAttribute(normals, index.getX(i));
      assert.ok(b.sub(a).cross(c.sub(a)).normalize().dot(normal) > 0.99, 'una cara quedó al revés');
    }
  }
});
