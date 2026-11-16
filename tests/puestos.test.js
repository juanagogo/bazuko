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

test('la esquina del dealer se dibuja con cuatro mallas, una sola luz y nada macizo que tape a quien pase por detrás', (t) => {
  const { puesto: dealer } = armar(DrugDealer, t);
  const { mallas, luces, materiales, triangulos, caja } = censo(dealer);
  assert.equal(mallas.length, 4, 'sitio, figura de mientras, bombilla con brasas y círculo');
  assert.ok(triangulos > 1200 && triangulos <= 2600, `${triangulos} triángulos`);
  assert.equal(luces.length, 1, 'la luz morada de siempre y ninguna más');
  assert.ok(luces[0].isPointLight);
  assert.equal(dealer.sitio.material, dealer.figura.material, 'el sitio y la figura comparten material');
  assert.ok(materiales.size <= 3);
  assert.ok(dealer.sitio.castShadow && dealer.sitio.receiveShadow);
  // La figura de mientras mide lo que una persona de pie.
  const figura = new THREE.Box3().setFromObject(dealer.figura);
  assert.ok(figura.max.y > 1.7 && figura.max.y < 1.9, `coronilla a ${figura.max.y.toFixed(2)} m`);
  assert.ok(figura.max.x - figura.min.x < 0.8, 'una persona, no una caja');
  // Por encima de 1,2 m solo queda lo delgado (postes, cable, bombilla, varillas): el muro no esconde a nadie.
  const posicion = dealer.sitio.geometry.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let lona = 0;
  for (let i = 0; i < posicion.count; i += 3) {
    a.fromBufferAttribute(posicion, i); b.fromBufferAttribute(posicion, i + 1); c.fromBufferAttribute(posicion, i + 2);
    if (Math.min(a.y, b.y, c.y) < 1.25) continue;
    lona = Math.max(lona, new THREE.Triangle(a, b, c).getArea());
  }
  assert.ok(lona < 0.2, `la cara más grande por encima de 1,25 m mide ${lona.toFixed(2)} m²`);
  const macizo = new THREE.Box3();
  for (let i = 0; i < posicion.count; i += 3) {
    a.fromBufferAttribute(posicion, i); b.fromBufferAttribute(posicion, i + 1); c.fromBufferAttribute(posicion, i + 2);
    if (new THREE.Triangle(a, b, c).getArea() > 0.2) macizo.expandByPoint(a).expandByPoint(b).expandByPoint(c);
  }
  assert.ok(macizo.max.y <= 1.2 + 1e-6, `lo macizo llega a ${macizo.max.y.toFixed(2)} m`);
  // Lo delgado sí sube, y todo cabe en el patio de la olla.
  assert.ok(caja.max.y > 2.6 && caja.max.y < 3.5);
  assert.ok(caja.min.x > -2.8 && caja.max.x < 2.8 && caja.min.z > -2.0 && caja.max.z < 2.2, JSON.stringify(caja));
  assert.ok(caja.min.y >= -1e-6, 'el muro arranca del suelo, no de más abajo');
});

test('de noche se prenden la bombilla y las brasas del dealer; de día la luz no gasta', (t) => {
  const { puesto: dealer } = armar(DrugDealer, t);
  assert.equal(dealer.isNight, false);
  assert.equal(dealer.luz.intensity, 0, 'de día la luz queda fuera del reparto de luces');
  assert.equal(dealer.marker.material.opacity, 0.3);
  const brillo = () => { const { r, g, b } = dealer.brillos.material.color; return r + g + b; };
  const apagado = brillo();
  dealer.setNight(true);
  assert.equal(dealer.isNight, true);
  assert.ok(dealer.luz.intensity > 2);
  assert.equal(dealer.luz.color.getHex(), 0x9b59b6, 'sigue siendo morada');
  assert.equal(dealer.marker.material.opacity, 0.9);
  assert.ok(brillo() > apagado * 2, 'la bombilla y las brasas brillan más');
  assert.equal(dealer.brillos.material.isMeshBasicMaterial, true, 'brillan sin luces nuevas');
  // No es una fogata: no hay llama (ni sprite ni malla que crezca), solo el rescoldo.
  let llamas = 0;
  dealer.group.traverse((o) => { if (o.isSprite || /llama/i.test(o.name)) llamas++; });
  assert.equal(llamas, 0);
  dealer.setNight(false);
  assert.equal(dealer.luz.intensity, 0);
  assert.equal(brillo(), apagado);
});

/** Un peatón de mentira con su hueso del cuello, como el que entrega el sistema de personajes. */
function peatonFalso() {
  const group = new THREE.Group(), cuello = new THREE.Bone();
  cuello.name = 'mixamorigNeck';
  cuello.position.y = 1.5;
  group.add(cuello);
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3), new THREE.MeshBasicMaterial());
  group.add(cuerpo);
  const persona = { group, cuerpo, pedidos: [], liberado: 0, update(dt, estado) { persona.pedidos.push([dt, estado]); }, dispose() { persona.liberado++; group.removeFromParent(); } };
  return persona;
}

test('el dealer es un peatón de la calle: llega el modelo, se quita la figura de mientras y se le amarra el pañuelo', async () => {
  const { scene, puesto: dealer } = armar(DrugDealer);
  assert.equal(dealer.persona, null, 'sin navegador no pide el modelo solo');
  const figura = dealer.figura.geometry;
  let liberada = false;
  figura.addEventListener('dispose', () => { liberada = true; });
  const persona = peatonFalso();
  let pedido = null;
  const carga = dealer.preloadModel(async (apariencia, opciones) => { pedido = { apariencia, opciones }; return persona; });
  assert.equal(dealer.preloadModel(), carga, 'se pide una sola vez');
  await carga;
  assert.deepEqual(pedido.opciones, { lod: true }, 'el cuerpo liviano de la gente de la calle');
  assert.equal(pedido.apariencia.real.sexo, 'hombre');
  assert.match(pedido.apariencia.real.tonos.arriba, /^#[0-3]/, 'ropa oscura');
  assert.equal(dealer.persona, persona);
  assert.equal(dealer.figura, null);
  assert.ok(liberada, 'la figura de mientras se libera');
  assert.equal(persona.group.parent, dealer.group);
  assert.ok(persona.group.position.distanceTo(new THREE.Vector3(0, 0, 0)) < 1, 'dentro del círculo, donde se le compra');
  assert.ok(persona.pedidos.length > 0 && persona.pedidos.every(([, estado]) => estado.speed === 0 && estado.stance === 'brazos-cruzados'), 'quieto, de brazos cruzados');
  // El morado es un detalle: el pañuelo, colgado del cuello.
  assert.equal(dealer.panuelo.parent.name, 'mixamorigNeck');
  const panuelo = new THREE.Box3().setFromObject(dealer.panuelo).getSize(new THREE.Vector3());
  assert.ok(Math.max(panuelo.x, panuelo.y, panuelo.z) < 0.3, 'un pañuelo, no una capa');
  const mundo = dealer.panuelo.getWorldPosition(new THREE.Vector3());
  assert.ok(mundo.y > 1.4 && mundo.y < 1.7, `pañuelo a ${mundo.y.toFixed(2)} m`);
  // Se anima a 30 cuadros por segundo como mucho.
  const antes = persona.pedidos.length;
  for (let i = 0; i < 60; i++) dealer.update(1 / 60);
  const hechos = persona.pedidos.length - antes;
  assert.ok(hechos >= 28 && hechos <= 31, `${hechos} pasos de animación en un segundo`);
  // Al quitarlo, el personaje se suelta por su cuenta y lo de aquí se libera.
  const vivos = new Set([dealer.panuelo.geometry, dealer.panuelo.material, dealer.sitio.geometry, dealer.sitio.material]);
  for (const recurso of vivos) recurso.addEventListener('dispose', () => vivos.delete(recurso));
  let ajeno = false;
  persona.cuerpo.geometry.addEventListener('dispose', () => { ajeno = true; });
  dealer.dispose();
  assert.equal(persona.liberado, 1);
  assert.equal(vivos.size, 0);
  assert.equal(ajeno, false, 'no libera el cuerpo compartido de los peatones');
  assert.equal(scene.children.length, 0);
});

test('si el modelo del dealer llega tarde o no llega, no queda nada colgado', async () => {
  const { scene, puesto: tarde } = armar(DrugDealer);
  const persona = peatonFalso();
  const carga = tarde.preloadModel(async () => persona);
  tarde.dispose();
  await carga;
  assert.equal(persona.liberado, 1, 'el que llega después de quitar el puesto se suelta');
  assert.equal(scene.children.length, 0);
  const { puesto: sinModelo } = armar(DrugDealer);
  const aviso = console.warn;
  console.warn = () => {};
  try { await sinModelo.preloadModel(async () => { throw new Error('sin red'); }); } finally { console.warn = aviso; }
  assert.ok(sinModelo.figura?.parent, 'queda la figura de mientras');
  sinModelo.dispose();
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
