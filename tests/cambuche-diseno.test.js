import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Cambuche, STRUCTURE } from '../src/entities/Cambuche.js';
import { CAMBUCHE } from '../src/data/cambuche.js';
import { cloneFinishedShelter } from '../src/ui/ShelterPreview.js';
import { alturasDelModelo, cubierta } from '../src/entities/cambuche/patio.js';

const TODO = Object.fromEntries(CAMBUCHE.map(piece => [piece.id, true]));
const SITIO = new THREE.Vector3(112.98, 0.06, 94.64);
const nuevo = (scene = new THREE.Scene()) => new Cambuche(scene, SITIO.clone());
/** Lo que el renderizador tendría que dibujar: mallas y llamas visibles, con sus triángulos. */
function dibujo(shelter) {
  let mallas = 0, triangulos = 0, luces = 0;
  shelter.group.traverseVisible(node => {
    if (node.isPointLight) luces++;
    if (!node.isMesh && !node.isSprite) return;
    mallas++;
    if (node.isMesh) triangulos += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  });
  return { mallas, triangulos, luces };
}
/** Un modelo de mentira del tamaño del importado, para probar lo que se le apoya encima sin cargar el GLB. */
function conModelo(shelter) {
  shelter.model = new THREE.Mesh(new THREE.BoxGeometry(3.9, 1.6, 2.8).translate(0, 0.8, 0), new THREE.MeshStandardMaterial());
  shelter.group.add(shelter.model);
  shelter.encima.add(new THREE.Mesh(cubierta(alturasDelModelo(shelter.model, shelter.group)).geometria(), shelter.pieces.techo.material));
  return shelter;
}

test('el cambuche conserva lo que usa el juego: piezas, anillo, fuego y métodos', () => {
  const scene = new THREE.Scene(), shelter = nuevo(scene);
  assert.equal(shelter.kind, 'cambuche');
  assert.deepEqual(shelter.position.toArray(), SITIO.toArray());
  assert.equal(shelter.group.rotation.y, Math.PI * 0.08);
  assert.deepEqual(Object.keys(shelter.pieces), CAMBUCHE.map(piece => piece.id));
  assert.deepEqual(STRUCTURE, ['base', 'techo', 'paredes', 'cama']);
  const root = shelter.group.children[0];
  assert.deepEqual(root.children, [shelter.markerPile, ...Object.values(shelter.pieces)], 'el orden que espera la vista previa');
  assert.equal(shelter.group.children[1], shelter.marker);
  for (const method of ['preloadModel', 'setBuilt', 'update', 'setNight', 'dispose']) assert.equal(typeof shelter[method], 'function', method);
  assert.ok(shelter.fire.isSprite && shelter.fireLight.isPointLight && shelter.flame.isMesh);
  // El fuego sigue donde estaba: la luz del fogón no cambia de sitio.
  assert.deepEqual(shelter.pieces.fogon.position.toArray(), [1, 0, 1.3]);
  shelter.dispose();
});

test('cada etapa se dibuja con pocas mallas y sin luces nuevas', () => {
  const shelter = nuevo();
  const etapas = [{}, { base: true }, { base: true, techo: true }, { base: true, techo: true, paredes: true }, TODO];
  // Anillo, cartones sueltos o base, y lo que suma cada pieza: una malla por pieza, más la tinta y la llama.
  const tope = [2, 3, 5, 7, 14];
  etapas.forEach((built, i) => {
    shelter.setBuilt(built);
    shelter.setNight(false); shelter.update(1 / 60);
    const { mallas, luces } = dibujo(shelter);
    assert.ok(mallas <= tope[i], `etapa ${i}: ${mallas} mallas`);
    assert.equal(luces, built.fogon ? 1 : 0, 'la única luz es la del fogón');
  });
  // Terminado, con el modelo: lo de encima suma dos mallas y el modelo reemplaza cuatro piezas.
  conModelo(shelter).setBuilt(TODO);
  shelter.update(1 / 60);
  const { mallas, triangulos } = dibujo(shelter);
  assert.ok(mallas <= 13, `terminado: ${mallas} mallas`);
  assert.ok(triangulos - 12 < 6000, `terminado: ${triangulos - 12} triángulos sin contar el modelo`);
  const materiales = new Set();
  shelter.group.traverse(node => { if (node.isMesh && node !== shelter.model) materiales.add(node.material); });
  assert.ok(materiales.size <= 7, `${materiales.size} materiales`);
  shelter.dispose();
});

test('el patio se va poblando y las capas del techo llegan con la estructura completa', () => {
  const shelter = conModelo(nuevo());
  const patio = () => Object.entries(shelter.patio).filter(([, part]) => part.visible).map(([id]) => id);
  shelter.setBuilt({});
  assert.deepEqual(patio(), []);
  assert.equal(shelter.encima.visible, false);
  shelter.setBuilt({ base: true });
  assert.deepEqual(patio(), ['rincon']);
  shelter.setBuilt({ base: true, fogon: true });
  assert.deepEqual(patio(), ['rincon', 'tendedero']);
  shelter.setBuilt({ base: true, techo: true, paredes: true });
  assert.deepEqual(patio(), ['rincon', 'tendedero']);
  assert.equal(shelter.encima.visible, false, 'sin colchón todavía no es el cambuche entero');
  assert.equal(shelter.pieces.techo.visible, true);
  shelter.setBuilt({ base: true, techo: true, paredes: true, cama: true });
  assert.deepEqual(patio(), ['rincon', 'tendedero', 'reciclaje']);
  assert.equal(shelter.encima.visible, true);
  assert.equal(shelter.model.visible, true);
  // La teja y la llanta quedan encima del modelo, no hundidas en él.
  const box = new THREE.Box3().setFromObject(shelter.encima);
  assert.ok(box.max.y > SITIO.y + 1.6 && box.max.y < SITIO.y + 2.3, `tope ${box.max.y}`);
  shelter.dispose();
});

test('de noche sale luz por la entrada solo si hay vela y paredes, y sube y baja de a poco', () => {
  const shelter = nuevo();
  const pasa = segundos => { for (let i = 0; i < segundos * 30; i++) shelter.update(1 / 30); };
  shelter.setBuilt({ base: true, techo: true, paredes: true, vela: true });
  shelter.setNight(false); pasa(1);
  assert.equal(shelter.resplandor.visible, false);
  assert.equal(shelter.rendijas.visible, false);
  shelter.setNight(true); shelter.update(1 / 30);
  assert.ok(shelter.resplandor.material.color.r < 0.1, 'no salta al anochecer');
  pasa(10);
  assert.equal(shelter.resplandor.visible, true);
  assert.equal(shelter.rendijas.visible, true);
  assert.ok(shelter.resplandor.material.color.r > 0.85);
  assert.equal(shelter.resplandor.material.blending, THREE.AdditiveBlending);
  shelter.setBuilt({ base: true, techo: true, paredes: true });
  pasa(1);
  assert.equal(shelter.resplandor.visible, false, 'sin vela no hay luz adentro');
  shelter.setBuilt({ base: true, techo: true, vela: true });
  pasa(1);
  assert.equal(shelter.resplandor.visible, false, 'sin paredes la luz no se encierra');
  shelter.setNight(false); shelter.setBuilt(TODO); pasa(10);
  assert.equal(shelter.resplandor.visible, false);
  shelter.dispose();
});

test('lo que toca el piso pisa las mismas baldosas que ya pisaba el anillo', () => {
  const shelter = conModelo(nuevo());
  shelter.setBuilt(TODO);
  shelter.group.updateWorldMatrix(true, true);
  // La misma cuenta que hace la ciudad para apoyar el cambuche (`getGroundHeightUnder`), con baldosas de 2 m.
  const baldosas = (solo) => {
    const piso = new THREE.Box3(), box = new THREE.Box3();
    shelter.group.traverse(node => {
      if (!node.isMesh || node === shelter.model || (solo && node !== solo)) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      box.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
      if (box.min.y <= SITIO.y + 0.15) piso.union(box);
    });
    return [Math.floor((piso.min.x + 1) / 2), Math.ceil((piso.max.x + 1) / 2) - 1, Math.floor((piso.min.z + 1) / 2), Math.ceil((piso.max.z + 1) / 2) - 1];
  };
  assert.deepEqual(baldosas(), baldosas(shelter.marker));
  shelter.dispose();
});

test('el cambuche sale igual cada vez y la vista previa muestra lo mismo que el mundo', () => {
  const a = nuevo(), b = conModelo(nuevo());
  for (const id of Object.keys(a.pieces)) {
    const first = [], second = [];
    a.pieces[id].traverse(node => { if (node.isMesh) first.push(...node.geometry.attributes.position.array.slice(0, 60)); });
    b.pieces[id].traverse(node => { if (node.isMesh) second.push(...node.geometry.attributes.position.array.slice(0, 60)); });
    assert.deepEqual(first, second, id);
  }
  b.setBuilt({ base: true });
  const preview = cloneFinishedShelter(b), copies = [], originals = [];
  b.group.traverse(node => originals.push(node));
  preview.traverse(node => copies.push(node));
  const copy = node => copies[originals.indexOf(node)];
  for (const part of Object.values(b.patio)) assert.equal(copy(part).visible, true);
  assert.equal(copy(b.encima).visible, true);
  assert.equal(copy(b.resplandor).visible, false, 'la foto es de día');
  assert.equal(copy(b.rendijas).visible, false);
  assert.equal(b.patio.tendedero.visible, false, 'el cambuche real no cambia');
  assert.equal(b.encima.visible, false);
  a.dispose(); b.dispose();
});

test('al destruirlo se libera todo lo que creó y la escena queda vacía', () => {
  const scene = new THREE.Scene(), shelter = conModelo(nuevo(scene));
  const modelo = shelter.model;
  shelter.setBuilt(TODO);
  const recursos = new Set();
  shelter.group.traverse(node => {
    if (node === modelo || node.isSprite) return;
    if (node.geometry) recursos.add(node.geometry);
    if (node.material) { recursos.add(node.material); if (node.material.map) recursos.add(node.material.map); }
  });
  assert.ok(recursos.size > 20);
  const liberados = new Set();
  for (const recurso of recursos) recurso.addEventListener('dispose', () => liberados.add(recurso));
  let delModelo = 0;
  modelo.geometry.addEventListener('dispose', () => delModelo++);
  shelter.dispose();
  assert.equal(liberados.size, recursos.size);
  assert.equal(delModelo, 0, 'el modelo importado es compartido: no se libera');
  assert.equal(scene.children.length, 0);
});
