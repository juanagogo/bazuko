import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeParkedMotos, MOTO_SIZE } from '../src/world/bogota/motos.js';

// Los diez grupos que arma el juego: de una a tres motos, con la semilla y el grupo que les pone.
function gruposDelJuego() {
  const motos = [];
  for (let grupo = 1; grupo <= 10; grupo++) {
    const cuantas = 1 + (grupo * 7) % 3;
    for (let i = 0; i < cuantas; i++) motos.push({ x: grupo * 20 + i * .95, z: 0, rot: .22, seed: motos.length * 3 + grupo, group: grupo });
  }
  return motos;
}

const gastado = crear => {
  const delJuego = Math.random;
  let veces = 0;
  Math.random = () => { veces++; return delJuego(); };
  try { return [crear(), veces]; } finally { Math.random = delJuego; }
};

test('las motos gastan del azar del juego lo mismo que antes de tener cajón', () => {
  // Va de primera: mide también la vez en que se arman el modelo y el material (42 identificadores de cuatro tiradas).
  const [, primera] = gastado(() => makeParkedMotos([{ x: 0, z: 0, rot: 0 }]));
  assert.equal(primera, 168);
  // Después solo gastan la raíz, el auxiliar y un lote por grupo; los cajones no suman nada.
  const [fila, conCajones] = gastado(() => makeParkedMotos([0, 1, 2].map(i => ({ x: i, z: 0, rot: 0, seed: i }))));
  assert.equal(fila.children[0].children.length, 1, 'la fila de tres lleva cajones');
  assert.equal(conCajones, 12);
  const [, juego] = gastado(() => makeParkedMotos(gruposDelJuego()));
  assert.equal(juego, 48);
});

test('la mitad de los grupos del juego es de domicilio y cada cajón va sobre su moto', () => {
  const root = makeParkedMotos(gruposDelJuego());
  assert.equal(root.children.length, 10, 'un lote por grupo, como siempre');
  const deReparto = root.children.filter(lote => lote.children.length);
  assert.equal(deReparto.length, 5);
  assert.deepEqual(root.children.map(lote => lote.children[0]?.count ?? 0), [0, 2, 0, 1, 2, 0, 0, 2, 0, 1]);
  const moto = new THREE.Matrix4(), cajon = new THREE.Matrix4();
  for (const lote of deReparto) {
    const [kit] = lote.children;
    assert.equal(lote.children.length, 1);
    assert.equal(kit.material, lote.material, 'mismo material: el campo de sol y la mugre son los de la moto');
    assert.ok(kit.castShadow && kit.frustumCulled);
    // En una fila de reparto la segunda moto queda sin cajón.
    const cargadas = Array.from({ length: lote.count }, (_, i) => i).filter(i => i % 3 !== 1);
    cargadas.forEach((i, k) => {
      lote.getMatrixAt(i, moto); kit.getMatrixAt(k, cajon);
      assert.deepEqual(cajon.elements, moto.elements);
    });
    assert.ok(lote.boundingSphere.radius < 3 && kit.boundingSphere.radius < 3);
  }
  // Sin grupo, como en la sala: una fila de cuatro muestra las dos motos, con cajón y sin él.
  const sala = makeParkedMotos([0, 1, 2, 3].map(i => ({ x: -i * 1.1, z: 0, rot: 1.8, seed: i * 3 })));
  assert.equal(sala.children.length, 1);
  assert.equal(sala.children[0].children[0].count, 3);

  const liberados = [];
  for (const lote of root.children) for (const objeto of [lote, ...lote.children]) objeto.addEventListener('dispose', () => liberados.push(objeto.name));
  root.dispose();
  assert.equal(liberados.filter(nombre => nombre === 'Grupo de motos').length, 10);
  assert.equal(liberados.filter(nombre => nombre === 'Cajones de domicilio').length, 5);
});

test('la moto detallada y su cajón caben en la huella y tienen normales válidas', () => {
  const [lote] = makeParkedMotos([0, 1, 2].map(i => ({ x: i, z: 0, rot: 0 }))).children;
  const moto = lote.geometry, cajon = lote.children[0].geometry;
  for (const [nombre, geometria] of [['moto', moto], ['cajón', cajon]]) {
    geometria.computeBoundingBox();
    const { min, max } = geometria.boundingBox;
    assert.ok(min.x >= -MOTO_SIZE.length / 2 && max.x <= MOTO_SIZE.length / 2, `${nombre}: largo ${min.x} a ${max.x}`);
    assert.ok(min.z >= -MOTO_SIZE.width / 2 - .005 && max.z <= MOTO_SIZE.width / 2 + .005, `${nombre}: ancho ${min.z} a ${max.z}`);
    assert.ok(min.y > -.001, `${nombre}: nada bajo el piso`);
    const normales = geometria.getAttribute('normal');
    for (let i = 0; i < normales.count; i++) {
      const longitud = Math.hypot(normales.getX(i), normales.getY(i), normales.getZ(i));
      assert.ok(Math.abs(longitud - 1) < .001, `${nombre}: normal inválida en el vértice ${i}`);
    }
  }
  // La llanta se ve redonda: ningún lado del borde pasa de 20 grados.
  const p = moto.attributes.position, angulos = new Set();
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) - .66, dy = p.getY(i) - .3;
    if (Math.abs(Math.hypot(dx, dy) - .3) < 1e-4 && Math.abs(p.getZ(i)) < 1e-4) angulos.add(Math.round(Math.atan2(dy, dx) * 180 / Math.PI));
  }
  assert.ok(angulos.size >= 18, `lados del borde de la llanta: ${angulos.size}`);
});

test('de noche la llanta no se empolva beige, la placa lleva trazos finos y el casco no es una bola clara', async () => {
  const { COLOR } = await import('../src/world/bogota/carParts.js');
  const [lote] = makeParkedMotos([0, 1, 2].map(i => ({ x: i, z: 0, rot: 0 }))).children;
  const moto = lote.geometry, cajon = lote.children[0].geometry;
  // El caucho va marcado en el alfa del lote, entre el plástico (0) y el metal (.3).
  const color = moto.attributes.color, caucho = [];
  for (let i = 0; i < color.count; i++) {
    const igual = [color.getX(i), color.getY(i), color.getZ(i)].every((v, k) => Math.abs(v - COLOR.rubber[k]) < 1e-4);
    if (igual) caucho.push(color.getW(i));
  }
  assert.ok(caucho.length >= 2 * 6 * 20, `vértices de caucho: ${caucho.length}`);
  assert.ok(caucho.every(a => a > .05 && a < .15), 'llantas, puños y estriberas marcadas como caucho');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  lote.material.onBeforeCompile(shader, { });
  const tope = shader.fragmentShader.match(/motoMugre \*= 1\. - ([0-9.]+) \* motoCaucho;/);
  assert.ok(tope && Number(tope[1]) >= .6, 'el caucho guarda poco polvo');
  assert.match(shader.fragmentShader, /mix\(vec3\(\.13, \.11, \.085\), vec3\(\.035, \.033, \.03\), motoCaucho\)/, 'y su polvo es gris oscuro');

  // Placa: los caracteres son trazos, ninguno un cuadro lleno.
  const p = moto.attributes.position, index = moto.index;
  let trazos = 0;
  for (let t = 0; t < index.count; t += 3) {
    const v = [0, 1, 2].map(k => index.getX(t + k));
    if (!v.every(i => Math.abs(p.getX(i) + .944) < 1e-5)) continue;
    const ys = v.map(i => p.getY(i)), zs = v.map(i => p.getZ(i));
    const alto = Math.max(...ys) - Math.min(...ys), ancho = Math.max(...zs) - Math.min(...zs);
    assert.ok(Math.min(alto, ancho) <= .008, `marca de ${alto.toFixed(3)} × ${ancho.toFixed(3)} m en la placa`);
    trazos++;
  }
  assert.ok(trazos >= 24, `triángulos de los caracteres: ${trazos}`);

  // Casco: calota gris apagada y borde oscuro abajo.
  const q = cajon.attributes.position, c = cajon.attributes.color;
  let calota = 0, borde = 0;
  for (let i = 0; i < q.count; i++) {
    const dx = q.getX(i) - .30, dy = q.getY(i) - .90, dz = q.getZ(i) - .235;
    if (Math.hypot(dx / 1.12, dy, dz) > .13) continue;
    const luz = .2126 * c.getX(i) + .7152 * c.getY(i) + .0722 * c.getZ(i);
    if (dy > .02) { calota++; assert.ok(luz <= .12, `casco claro: ${luz.toFixed(3)}`); }
    if (dy < -.06 && luz < .01) borde++;
  }
  assert.ok(calota > 20 && borde >= 9, `calota ${calota}, borde ${borde}`);
});
