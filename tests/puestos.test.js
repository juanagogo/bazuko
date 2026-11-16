// Los puestos de la calle: lo que el juego usa de cada uno, lo que cuestan de dibujar y que al quitarlos no queda nada.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { DrugDealer } from '../src/entities/DrugDealer.js';
import { SellPoint } from '../src/entities/SellPoint.js';
import { CraftingStation } from '../src/entities/CraftingStation.js';
import { ITEMS } from '../src/data/items.js';

/** Mallas, triángulos, luces y caja de un puesto, en metros desde su centro. */
function censo(puesto) {
  const mallas = [], luces = [], geometrias = new Set(), materiales = new Set();
  let triangulos = 0;
  puesto.group.updateMatrixWorld(true);
  puesto.group.traverse((o) => {
    if (o.isLight) luces.push(o);
    if (!o.isMesh) return;
    mallas.push(o);
    geometrias.add(o.geometry);
    materiales.add(o.material);
    triangulos += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  const caja = new THREE.Box3();
  for (const malla of mallas) if (malla !== puesto.marker) caja.expandByObject(malla);
  caja.translate(puesto.position.clone().negate());
  return { mallas, luces, geometrias, materiales, triangulos, caja };
}

/** Destruye el puesto y dice qué geometrías y materiales se quedaron sin liberar. */
function sinLiberar(puesto, scene) {
  const { geometrias, materiales } = censo(puesto);
  const vivos = new Set([...geometrias, ...materiales]);
  for (const recurso of vivos) recurso.addEventListener('dispose', () => vivos.delete(recurso));
  puesto.dispose();
  assert.equal(puesto.group.parent, null, 'sale de la escena');
  assert.equal(scene.children.length, 0, 'la escena queda vacía');
  return vivos.size;
}

const armar = (Clase, t) => {
  const scene = new THREE.Scene();
  const puesto = new Clase(scene, new THREE.Vector3(41, 0, 55));
  t?.after(() => puesto.dispose());
  return { scene, puesto };
};

test('el dealer conserva lo que el juego usa de él', (t) => {
  const { puesto: dealer } = armar(DrugDealer, t);
  assert.deepEqual(dealer.position.toArray(), [41, 0, 55]);
  assert.equal(dealer.position, dealer.group.position);
  assert.equal(dealer.kind, undefined, 'el juego lo reconoce por sellSubstances, no por kind');
  for (const metodo of ['sellSubstances', 'buySubstance', 'getProducts', 'update', 'setNight', 'dispose']) assert.equal(typeof dealer[metodo], 'function', metodo);
  assert.deepEqual(dealer.getProducts(), [ITEMS.tintico, ITEMS.pegante, ITEMS.pastilla, ITEMS.basuco]);
  // El círculo del piso que el modo foto esconde.
  const { innerRadius, outerRadius } = dealer.marker.geometry.parameters;
  assert.deepEqual([innerRadius, outerRadius, dealer.marker.position.y], [1.0, 1.3, 0.05]);
  const giro = dealer.marker.rotation.z;
  dealer.update(0.5);
  assert.ok(Math.abs(dealer.marker.rotation.z - giro - 0.3) < 1e-9, 'el círculo sigue girando');
});

test('la esquina del dealer se dibuja con cinco mallas, una sola luz y una figura de persona', (t) => {
  const { puesto: dealer } = armar(DrugDealer, t);
  const { mallas, luces, materiales, triangulos, caja } = censo(dealer);
  assert.equal(mallas.length, 5, 'sitio, cabeza, llama, bombilla y círculo');
  assert.ok(triangulos > 1200 && triangulos <= 2600, `${triangulos} triángulos`);
  assert.equal(luces.length, 1, 'la luz morada de siempre y ninguna más');
  assert.ok(luces[0].isPointLight);
  assert.equal(dealer.sitio.material, dealer.cabeza.material, 'el sitio y la cabeza comparten material');
  assert.ok(materiales.size <= 4);
  assert.ok(dealer.sitio.castShadow && dealer.sitio.receiveShadow);
  // La cabeza, con capucha, queda a la altura de una persona de pie recostada en el muro.
  const cabeza = new THREE.Box3().setFromObject(dealer.cabeza);
  assert.ok(cabeza.max.y > 1.7 && cabeza.max.y < 1.9, `coronilla a ${cabeza.max.y.toFixed(2)} m`);
  assert.ok(cabeza.max.x - cabeza.min.x < 0.4, 'una cabeza, no una caja');
  // El muro es más alto que el hombre y todo cabe en el patio de la olla.
  assert.ok(caja.max.y > 2.6 && caja.max.y < 3.5);
  assert.ok(caja.min.x > -2.4 && caja.max.x < 2.8 && caja.min.z > -1.4 && caja.max.z < 2.2, JSON.stringify(caja));
  assert.ok(caja.min.y >= -1e-6, 'el muro arranca del suelo, no de más abajo');
});

test('de noche se prenden la bombilla y el fogón del dealer; de día la luz no gasta', (t) => {
  const { puesto: dealer } = armar(DrugDealer, t);
  const paso = (segundos) => { for (let i = 0; i < segundos * 30; i++) dealer.update(1 / 30); };
  assert.equal(dealer.isNight, false);
  assert.equal(dealer.luz.intensity, 0, 'de día la luz queda fuera del reparto de luces');
  assert.equal(dealer.marker.material.opacity, 0.3);
  const apagada = dealer.bombilla.material.color.getHex();
  paso(4);
  const brasa = dealer.llama.scale.y;
  dealer.setNight(true);
  assert.equal(dealer.isNight, true);
  assert.ok(dealer.luz.intensity > 2);
  assert.equal(dealer.luz.color.getHex(), 0x9b59b6, 'sigue siendo morada');
  assert.equal(dealer.marker.material.opacity, 0.9);
  assert.notEqual(dealer.bombilla.material.color.getHex(), apagada);
  const alturas = [];
  for (let i = 0; i < 120; i++) { dealer.update(1 / 30); if (i >= 90) alturas.push(dealer.llama.scale.y); }
  assert.ok(Math.min(...alturas) > brasa * 1.3, 'el fuego crece de noche');
  assert.ok(Math.max(...alturas) - Math.min(...alturas) > 0.05, 'la llama titila');
  const mira = dealer.cabeza.rotation.y;
  paso(2);
  assert.notEqual(dealer.cabeza.rotation.y, mira, 'el hombre vigila');
  dealer.setNight(false);
  assert.equal(dealer.luz.intensity, 0);
  assert.equal(dealer.bombilla.material.color.getHex(), apagada);
});

test('al quitar al dealer se libera todo lo que creó', () => {
  const { scene, puesto } = armar(DrugDealer);
  assert.equal(sinLiberar(puesto, scene), 0);
});

test('la recicladora conserva su interfaz y se arma sin navegador', (t) => {
  const { puesto: recicladora } = armar(SellPoint, t);
  assert.equal(recicladora.kind, 'recycler');
  assert.equal(recicladora.position, recicladora.group.position);
  const pedidos = [];
  assert.equal(recicladora.sell({ sellAll: (mult) => { pedidos.push(mult); return 1200; } }, 1.5), 1200);
  assert.equal(recicladora.sell({ sellAll: (mult) => { pedidos.push(mult); return 0; } }), 0);
  assert.deepEqual(pedidos, [1.5, 1]);
});

test('la recicladora se dibuja con tres mallas, sin luces, y cabe en el portón de la bodega', (t) => {
  const { puesto: recicladora } = armar(SellPoint, t);
  const { mallas, luces, triangulos, caja } = censo(recicladora);
  assert.equal(mallas.length, 3, 'bodega, aviso y bombilla');
  assert.ok(triangulos > 1200 && triangulos <= 2600, `${triangulos} triángulos`);
  assert.equal(luces.length, 0);
  // El portón mide 8 m de ancho por 6 de fondo y su piso está a 12 cm: nada atraviesa los muros ni queda bajo el piso.
  assert.ok(caja.min.x > -3.95 && caja.max.x < 3.95, `x de ${caja.min.x.toFixed(2)} a ${caja.max.x.toFixed(2)}`);
  assert.ok(caja.min.z > -2.95 && caja.max.z < 2.95, `z de ${caja.min.z.toFixed(2)} a ${caja.max.z.toFixed(2)}`);
  assert.ok(caja.min.y >= 0.12 - 1e-6, `lo más bajo está a ${caja.min.y.toFixed(3)} m`);
  // El aviso se lee desde la calle, que queda en -z, y está por encima de las cabezas.
  const aviso = mallas.find((malla) => malla.name === 'Aviso de la recicladora');
  const frente = new THREE.Vector3(0, 0, 1).applyQuaternion(aviso.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(frente.z < -0.99, 'mira a la calle');
  assert.equal(aviso.material.side, THREE.FrontSide, 'por detrás no se lee al revés');
  const bajo = aviso.position.y - aviso.geometry.parameters.height / 2;
  assert.ok(bajo > 1.9, `el borde de abajo queda a ${bajo.toFixed(2)} m`);
  assert.ok(aviso.position.y <= 0.12 + 2.25 + 1e-6, 'más arriba tapa el letrero del local del fondo');
});

test('al quitar la recicladora se libera todo lo que creó', () => {
  const { scene, puesto } = armar(SellPoint);
  assert.equal(sinLiberar(puesto, scene), 0);
});

test('la mesa conserva su interfaz y su círculo', (t) => {
  const { puesto: mesa } = armar(CraftingStation, t);
  assert.equal(mesa.kind, 'mesa');
  assert.equal(mesa.position, mesa.group.position);
  const { innerRadius, outerRadius } = mesa.marker.geometry.parameters;
  assert.deepEqual([innerRadius, outerRadius, mesa.marker.position.y], [1.2, 1.5, 0.05]);
  const giro = mesa.marker.rotation.z;
  mesa.update(0.5);
  assert.ok(Math.abs(mesa.marker.rotation.z - giro - 0.3) < 1e-9);
});

test('la mesa se dibuja con dos mallas, sin luces, y no se mete en los muros de la esquina', (t) => {
  const { puesto: mesa } = armar(CraftingStation, t);
  const { mallas, luces, triangulos, caja } = censo(mesa);
  assert.equal(mallas.length, 2, 'banco de trabajo y círculo');
  assert.ok(triangulos > 1200 && triangulos <= 2600, `${triangulos} triángulos`);
  assert.equal(luces.length, 0);
  assert.ok(mesa.banco.castShadow && mesa.banco.receiveShadow);
  // Los muros de la esquina quedan a 2 m al oriente (+x) y al sur (+z).
  assert.ok(caja.max.x < 1.95 && caja.max.z < 1.95 && caja.min.x > -1.95 && caja.min.z > -1.95, JSON.stringify(caja));
  // La lona queda por encima de una persona y hay tablas a la altura de trabajar.
  assert.ok(caja.max.y > 2.1 && caja.max.y < 2.6, `lo más alto está a ${caja.max.y.toFixed(2)} m`);
  assert.ok(caja.min.y >= 0.04 - 0.005, `lo más bajo está a ${caja.min.y.toFixed(3)} m`);
});

test('al quitar la mesa se libera todo lo que creó', () => {
  const { scene, puesto } = armar(CraftingStation);
  assert.equal(sinLiberar(puesto, scene), 0);
});
