import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BuildingVisibility, CLOSED_CHUNK_SIZE, createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { vestirRelleno } from '../src/world/bogota/texturasAzotea.js';

const UV = { brick: [2.88, 2.88], slab: [4, 4] };
const TAMANOS = [[2, 2], [4, 2], [4, 6], [8, 8], [6, 4], [8, 2]];

/** Una ciudad mínima: una casa con ladrillo, losa y vida de azotea, como las que ya existen al llegar al relleno. */
function ciudad() {
  const visibilidad = new BuildingVisibility();
  const ladrillo = new THREE.MeshStandardMaterial(), losa = new THREE.MeshStandardMaterial(), vida = new THREE.MeshStandardMaterial();
  const casa = createBuildingShell(new THREE.BoxGeometry(6, 9, 6), [ladrillo, ladrillo, losa, losa, ladrillo, ladrillo],
    { x: 6, z: 6, height: 9, interiorMaterial: losa });
  const tanque = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), vida);
  tanque.name = 'Azotea con vida';
  tanque.castShadow = tanque.receiveShadow = true;
  tanque.position.y = 9.5;
  casa.roof.add(tanque);
  visibilidad.register(casa);
  return { visibilidad, ladrillo, losa, vida };
}
// Todos en el trozo de la casa, como en la ciudad real, donde cada trozo ya tiene ladrillo, losa y vida de azotea.
const PASO = (CLOSED_CHUNK_SIZE - 24) / 6;
const bloque = (losa, i, alto) => {
  const [ancho, fondo] = TAMANOS[i % TAMANOS.length];
  return { ancho, fondo, alto, shell: createBuildingShell(new THREE.BoxGeometry(ancho, alto, fondo), Array(6).fill(losa),
    { x: 18 + (i % 6) * PASO, z: 18 + Math.floor(i / 6) * PASO, height: alto, interiorMaterial: losa }) };
};
function contarAzar(hacer) {
  const real = Math.random;
  let gastado = 0;
  Math.random = () => { gastado++; return real(); };
  try { hacer(); } finally { Math.random = real; }
  return gastado;
}
function vestidos(cuantos = 36) {
  const { visibilidad, ladrillo, losa, vida } = ciudad(), bloques = [];
  for (let i = 0; i < cuantos; i++) {
    const ruina = i % 9 === 0, b = bloque(losa, i, ruina ? 4.5 : 6.5);
    b.edificio = vestirRelleno({ shell: b.shell, visibilidad, x: 30 + i * 3, z: 40 + (i % 5), ancho: b.ancho, fondo: b.fondo,
      alto: b.alto, ruina, ladrillo, uv: UV });
    bloques.push(b);
  }
  return { visibilidad, ladrillo, losa, vida, bloques };
}

test('vestir los bloques de relleno gasta el mismo azar del juego y deja los mismos lotes que registrarlos sin vestir', () => {
  let lisos, conVestido;
  const sinVestir = contarAzar(() => {
    const { visibilidad, losa } = ciudad();
    for (let i = 0; i < 36; i++) visibilidad.register(bloque(losa, i, i % 9 === 0 ? 4.5 : 6.5).shell);
    lisos = visibilidad.buildClosedView().children.length;
  });
  const vestido = contarAzar(() => { conVestido = vestidos().visibilidad.buildClosedView().children.length; });
  assert.equal(vestido, sinVestir, 'ni un número más ni uno menos: la gente nace donde siempre');
  assert.ok(conVestido <= lisos, 'ningún lote cerrado nuevo');
});

test('cada bloque queda con ladrillo en las cuatro paredes y una sola malla de techo dentro de su huella', () => {
  const { ladrillo, losa, vida, bloques } = vestidos();
  let latas = 0, losas = 0;
  for (const { shell, edificio, ancho, fondo, alto } of bloques) {
    for (const pared of shell.walls.values()) {
      assert.equal(pared.children.length, 1);
      assert.ok(pared.children[0].material.userData.staticBatchKey.startsWith(ladrillo.uuid), 'pared de ladrillo');
      const muro = new THREE.Box3().setFromBufferAttribute(pared.children[0].geometry.attributes.position);
      assert.ok(muro.max.y <= alto + .6 && Math.max(-muro.min.x, muro.max.x) <= ancho / 2 + 1e-3
        && Math.max(-muro.min.z, muro.max.z) <= fondo / 2 + 1e-3, 'el antepecho no se sale de la huella ni pasa de 60 cm');
    }
    assert.equal(shell.roof.children.length, 1, 'el techo sigue siendo una sola malla');
    const techo = shell.roof.children[0], clave = techo.material.userData.staticBatchKey;
    assert.ok(edificio.roofPart.materials.includes(techo.material), 'el techo se atenúa con su edificio');
    assert.deepEqual(edificio.roofPart.meshes, [techo]);
    if (clave.startsWith(vida.uuid)) latas++;
    else { assert.ok(clave.startsWith(losa.uuid)); losas++; }
    const caja = new THREE.Box3().setFromBufferAttribute(techo.geometry.attributes.position);
    assert.ok(caja.min.x >= -ancho / 2 - 1e-3 && caja.max.x <= ancho / 2 + 1e-3, 'no se sale a lo ancho');
    assert.ok(caja.min.z >= -fondo / 2 - 1e-3 && caja.max.z <= fondo / 2 + 1e-3, 'no se sale a lo largo');
    assert.ok(caja.min.y >= alto - 1e-3 && caja.max.y <= alto + 3.8, 'nace en la azotea');
    assert.ok(techo.geometry.index.count / 3 <= 700, 'como mucho 700 triángulos por azotea');
    assert.deepEqual(Object.keys(techo.geometry.attributes).sort(), ['normal', 'position', 'uv']);
  }
  assert.ok(latas >= 8 && losas >= 2, `hay azoteas con el atlas de detalles (${latas}) y de losa (${losas})`);
});

test('la azotea de cada bloque sale de su posición, no del azar del juego', () => {
  const real = Math.random;
  const armar = (azar) => {
    Math.random = azar;
    try { return vestidos(12).bloques.map(b => Array.from(b.shell.roof.children[0].geometry.attributes.position.array)); }
    finally { Math.random = real; }
  };
  assert.deepEqual(armar(() => .1), armar(() => .9));
});
