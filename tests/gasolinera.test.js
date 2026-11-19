import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GAS_STATION, GAS_OBSTACLES, buildGasStation, underGasCanopy } from '../src/world/bogota/GasStation.js';
import { AVISO_DE_PRECIOS, LUMINARIAS, PRECIOS, PUERTA, piezasDeGasolinera, pintarTexturasDeGasolinera } from '../src/world/bogota/gasolineraPiezas.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

const CHOQUES = [
  [154, 114, 13, 4, 3.4],
  [149, 97, .85, 1.1, 2], [149, 103, .85, 1.1, 2], [159, 97, .85, 1.1, 2], [159, 103, .85, 1.1, 2],
  [147, 94, .4, .4, 4.8], [147, 106, .4, .4, 4.8], [161, 94, .4, .4, 4.8], [161, 106, .4, .4, 4.8],
  [146, 91, .6, .6, 9]
];
const AVISOS = [
  { sub: 'SERVICIO · COMBUSTIBLES', bg: '#bc1726', ancho: 8, alto: .42, sitio: [154, 5.07, 92.48] },
  { title: 'TIENDA', sub: 'CAFÉ · AGUA · VÍVERES', bg: '#bc1726', ancho: 8, alto: .6, sitio: [154, 3.12, 111.9] },
  { sub: 'ABIERTO 24 H', bg: '#bc1726', ancho: 1.9, alto: .8, sitio: [146, 8.4, 90.83] },
  { title: 'CORRIENTE', sub: 'EXTRA · DIÉSEL', bg: '#252c32', ancho: 1.9, alto: .8, sitio: [146, 7.1, 90.83] }
];
const NOMBRE = '282fa0f08597bc5bb14b79b72fff33444593ae409b0e1b010590787559a33f0a';
const AZAR_DE_LA_OBRA = 384, MALLAS_QUE_FUNDE_LA_CIUDAD = 39, LOTES_QUE_FUNDE_LA_CIUDAD = 10;

const redondo = n => Math.round(n * 1000) / 1000;
const enElLote = (x, z) => x >= GAS_STATION.x0 && x <= GAS_STATION.x1 && z >= GAS_STATION.z0 && z <= GAS_STATION.z1;
const orden = lista => lista.map(fila => fila.map(redondo).join(' ')).sort();

function levantar() {
  const pedidos = [], real = Math.random;
  let azar = 0;
  Math.random = () => { azar++; return real(); };
  let estacion;
  try {
    estacion = buildGasStation({ createSign: (opciones) => { pedidos.push(opciones); return new THREE.Texture(); } });
  } finally { Math.random = real; }
  return { estacion, pedidos, azar };
}

/** Lo mismo que mira la ciudad al fundir lo que no se mueve: qué mallas entran y en cuántos lotes quedan. */
function loQueFundeLaCiudad(estacion) {
  const mallas = [], lotes = new Set(), centro = new THREE.Vector3();
  estacion.updateMatrixWorld(true);
  const mirar = (o) => {
    if (o.userData.update || o.userData.noMerge) return;
    if (o.isMesh && !Array.isArray(o.material) && !o.isSkinnedMesh && !o.isInstancedMesh) {
      if (!o.geometry.attributes.uv || !o.geometry.attributes.normal) return;
      mallas.push(o);
      o.geometry.computeBoundingBox();
      o.geometry.boundingBox.getCenter(centro).applyMatrix4(o.matrixWorld);
      const trozo = `${Math.floor(centro.x / 128)},${Math.floor(centro.z / 128)}`;
      lotes.add(`${o.material.userData.staticMergeKey ?? o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${!!o.geometry.index}|${Object.keys(o.geometry.attributes).sort()}|${trozo}`);
      return;
    }
    for (const hijo of o.children) mirar(hijo);
  };
  for (const hijo of estacion.children) mirar(hijo);
  return { mallas, lotes };
}

test('los choques de la gasolinera son los diez de siempre y la ciudad no registra ninguno más en el lote', () => {
  assert.deepEqual(GAS_OBSTACLES.map(({ x, z, w, d, h }) => [x, z, w, d, h]), CHOQUES);
  const ciudad = new Bogota(); ciudad.map = ciudad._layout();
  const choques = new CollisionSystem(); ciudad._buildCollisions(ciudad.map, choques);
  const centro = new THREE.Vector3(), medida = new THREE.Vector3();
  const delLote = choques.colliders.map(({ box }) => {
    box.getCenter(centro); box.getSize(medida);
    return [centro.x, centro.z, medida.x, medida.z, medida.y];
  }).filter(([x, z]) => enElLote(x, z));
  assert.deepEqual(orden(delLote), orden(CHOQUES));
  const { estacion } = levantar();
  assert.equal(estacion.userData.colliders, undefined);
  estacion.traverse(o => assert.equal(o.userData.collider ?? o.userData.colliders, undefined, o.name));
});

test('levantar la gasolinera gasta del azar de la ciudad lo mismo que antes, y la ciudad funde las mismas mallas', () => {
  const { estacion, azar } = levantar();
  assert.equal(azar, AZAR_DE_LA_OBRA);
  const { mallas, lotes } = loQueFundeLaCiudad(estacion);
  assert.equal(mallas.length, MALLAS_QUE_FUNDE_LA_CIUDAD);
  assert.equal(lotes.size, LOTES_QUE_FUNDE_LA_CIUDAD);
});

test('los cuatro avisos conservan su texto, su tamaño y su sitio', () => {
  const { estacion, pedidos } = levantar();
  assert.equal(pedidos.length, AVISOS.length);
  const mallas = estacion.children.filter(o => o.isMesh && o.material.isMeshBasicMaterial && o.geometry.type === 'PlaneGeometry');
  assert.equal(mallas.length, AVISOS.length);
  AVISOS.forEach((aviso, i) => {
    const pedido = pedidos[i], malla = mallas[i];
    if (aviso.title) assert.equal(pedido.title, aviso.title);
    else assert.equal(createHash('sha256').update(pedido.title).digest('hex'), NOMBRE);
    assert.deepEqual({ ...pedido, title: null },
      { title: null, sub: aviso.sub, bg: aviso.bg, fg: '#ffffff', border: false, w: 512, h: 128 });
    assert.deepEqual([malla.geometry.parameters.width, malla.geometry.parameters.height], [aviso.ancho, aviso.alto]);
    assert.deepEqual(malla.position.toArray().map(redondo), aviso.sitio);
    assert.equal(malla.rotation.y, Math.PI);
    assert.equal(malla.material.side, THREE.DoubleSide);
  });
});

/** Un lienzo que no pinta: anota lo que se escribe en él y deja pasar todo lo demás. */
function conLienzoDeMentira(correr) {
  const escrito = [], degradado = { addColorStop() {} };
  const crear = () => {
    const ctx = new Proxy({}, {
      get: (propio, nombre) => nombre in propio ? propio[nombre]
        : String(nombre).startsWith('create') ? () => degradado
          : (...datos) => { if (nombre === 'fillText') escrito.push(datos[0]); },
      set: (propio, nombre, valor) => { propio[nombre] = valor; return true; }
    });
    return { width: 0, height: 0, getContext: () => ctx };
  };
  const antes = globalThis.document;
  globalThis.document = { createElement: crear };
  try { return { resultado: correr(), escrito }; } finally {
    if (antes === undefined) delete globalThis.document; else globalThis.document = antes;
  }
}

function sinAzarDeLaCiudad(correr) {
  const real = Math.random;
  Math.random = () => { throw new Error('la gasolinera nueva no puede gastar el azar sembrado de la ciudad'); };
  try { return correr(); } finally { Math.random = real; }
}

test('las texturas se pintan con azar propio y lo escrito en ellas no lleva ningún nombre', () => {
  const { resultado, escrito } = conLienzoDeMentira(() => sinAzarDeLaCiudad(pintarTexturasDeGasolinera));
  for (const [nombre, textura] of Object.entries(resultado)) assert.ok(textura?.isTexture, nombre);
  assert.equal(Object.keys(resultado).length, 9);
  for (const [combustible, precio] of PRECIOS) {
    assert.ok(escrito.includes(combustible), combustible);
    assert.ok(escrito.includes(`$ ${precio}`), precio);
    assert.match(precio, /^\d\d\.\d{3}$/);
  }
  for (const texto of escrito) for (const palabra of texto.split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/)) {
    assert.notEqual(createHash('sha256').update(palabra.toUpperCase()).digest('hex'), NOMBRE, texto);
  }
});

test('lo nuevo va fundido en mallas que la ciudad no vuelve a fundir, sin luces, sin choques y dentro del lote', () => {
  const piezas = sinAzarDeLaCiudad(() => piezasDeGasolinera());
  assert.equal(piezas.userData.noMerge, true);
  const mallas = []; piezas.traverse(o => { if (o.isMesh) mallas.push(o); assert.equal(o.isLight, undefined); });
  assert.deepEqual(mallas.map(o => o.name), ['Gasolinera: piezas', 'Gasolinera: placa']);
  const caja = new THREE.Box3().setFromObject(piezas);
  assert.ok(caja.min.x >= GAS_STATION.x0 && caja.max.x <= GAS_STATION.x1 && caja.min.z >= GAS_STATION.z0 && caja.max.z <= GAS_STATION.z1);
  assert.ok(caja.min.y >= .12 - 1e-6);
  const { estacion } = levantar();
  let triangulos = 0;
  estacion.traverse(o => { if (o.isMesh) triangulos += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; });
  assert.ok(triangulos <= 1132 + 6000, `${triangulos} triángulos`);
  assert.equal(estacion.children.filter(o => o.userData.noMerge).length, 1);
});

test('surtidores, defensas y mangueras caben en el choque de cada surtidor', () => {
  const { estacion } = levantar();
  estacion.updateMatrixWorld(true);
  const surtidores = CHOQUES.filter(([, , , , alto]) => alto === 2);
  const punto = new THREE.Vector3();
  let dentro = 0;
  estacion.traverse((o) => {
    if (!o.isMesh || o.geometry.type === 'PlaneGeometry') return;
    const posicion = o.geometry.attributes.position;
    for (let i = 0; i < posicion.count; i++) {
      punto.fromBufferAttribute(posicion, i).applyMatrix4(o.matrixWorld);
      if (punto.y < .305 || punto.y > 4) continue;
      const cerca = surtidores.find(([x, z]) => Math.abs(punto.x - x) < 1 && Math.abs(punto.z - z) < 1.2);
      if (!cerca) continue;
      const [x, z, ancho, fondo, alto] = cerca;
      assert.ok(Math.abs(punto.x - x) <= ancho / 2 + 1e-6 && Math.abs(punto.z - z) <= fondo / 2 + 1e-6 && punto.y <= .12 + alto,
        `${o.name || o.geometry.type}: ${punto.toArray().map(redondo)}`);
      dentro++;
    }
  });
  assert.ok(dentro > 400);
});

test('la isla es de concreto y solo su borde queda pintado de amarillo', () => {
  const { estacion } = levantar();
  estacion.updateMatrixWorld(true);
  const bordes = estacion.children.filter(o => o.isMesh && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.depth === 10.6);
  assert.equal(bordes.length, 2);
  const piezas = estacion.children.find(o => o.userData.noMerge);
  const posicion = piezas.children[0].geometry.attributes.position;
  for (const borde of bordes) {
    const { width, height, depth } = borde.geometry.parameters, { x, y, z } = borde.position;
    assert.deepEqual([width, height, depth, x, redondo(y), z], [2.1, .16, 10.6, x, .2, 100]);
    let tapa = new THREE.Box3();
    for (let i = 0; i < posicion.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(posicion, i);
      if (Math.abs(p.x - x) < 1.05 && Math.abs(p.y - .3) < 1e-6) tapa.expandByPoint(p);
    }
    const franja = [(width - (tapa.max.x - tapa.min.x)) / 2, (depth - (tapa.max.z - tapa.min.z)) / 2].map(redondo);
    assert.deepEqual(franja, [.12, .12]);
  }
});

test('la placa de concreto cubre el lote a ras del piso, recibe sombra y no la da', () => {
  const placa = sinAzarDeLaCiudad(() => piezasDeGasolinera()).getObjectByName('Gasolinera: placa');
  const caja = new THREE.Box3().setFromObject(placa);
  assert.deepEqual([caja.min.x, caja.max.x, caja.min.z, caja.max.z].map(redondo), [145.02, 162.98, 89.02, 116.98]);
  assert.ok(caja.min.y > .12 && caja.max.y < .13 && caja.max.y - caja.min.y < 1e-6);
  assert.deepEqual([placa.castShadow, placa.receiveShadow, placa.material.polygonOffset], [false, true, true]);
  assert.equal(placa.geometry.index.count / 3, 2);
});

test('las luminarias van bajo la cubierta y se encienden de noche sin ninguna luz real', () => {
  assert.equal(LUMINARIAS.length, 9);
  for (const [x, z] of LUMINARIAS) assert.ok(underGasCanopy(x, z), `${x}, ${z}`);
  const { resultado: estacion } = conLienzoDeMentira(() => {
    const tx = pintarTexturasDeGasolinera();
    const piezas = sinAzarDeLaCiudad(() => piezasDeGasolinera(tx));
    return piezas;
  });
  estacion.traverse(o => assert.equal(o.isLight, undefined));
  for (const nombre of ['Gasolinera: piezas', 'Gasolinera: placa']) {
    const { material } = estacion.getObjectByName(nombre);
    assert.ok(material.emissiveMap?.isTexture, nombre);
    material.onBeforeRender(null, { userData: { environmentDay: 1 } });
    const dia = material.emissiveIntensity;
    material.onBeforeRender(null, { userData: { environmentDay: 0 } });
    assert.ok(dia < .1 && material.emissiveIntensity >= .5, `${nombre}: ${dia} de día, ${material.emissiveIntensity} de noche`);
    material.onBeforeRender(null, {});
    assert.equal(material.emissiveIntensity, dia);
  }
  const posicion = estacion.getObjectByName('Gasolinera: piezas').geometry.attributes.position;
  let altas = 0;
  for (let i = 0; i < posicion.count; i++) if (posicion.getY(i) > 4.6 && underGasCanopy(posicion.getX(i), posicion.getZ(i))) { altas++; assert.ok(posicion.getY(i) < 4.76); }
  assert.equal(altas, LUMINARIAS.length * 24);
});

test('la tienda tiene tres vitrinas que de noche alumbran desde adentro y una puerta entre dos de ellas', () => {
  const { estacion } = levantar();
  const vitrinas = estacion.children.filter(o => o.isMesh && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.depth === .06);
  assert.deepEqual(vitrinas.map(o => o.position.toArray().map(redondo)), [[150, 1.72, 111.95], [154, 1.72, 111.95], [158, 1.72, 111.95]]);
  const vidrio = vitrinas[0].material;
  assert.ok(vitrinas.every(o => o.material === vidrio));
  vidrio.onBeforeRender(null, { userData: { environmentDay: 0 } });
  assert.equal(vidrio.emissiveIntensity, 1);
  vidrio.onBeforeRender(null, { userData: { environmentDay: 1 } });
  assert.equal(vidrio.emissiveIntensity, 0);
  for (const vitrina of vitrinas) assert.ok(Math.abs(vitrina.position.x - PUERTA.x) >= 2.9 / 2 + .98 / 2, 'la puerta no pisa la vitrina');
  assert.ok(PUERTA.z < 112 && PUERTA.z > 111.9);
  const tienda = CHOQUES[0];
  assert.ok(Math.abs(PUERTA.x - tienda[0]) < tienda[2] / 2);
});

test('el aviso de precios cuelga del poste que ya tiene choque, por encima de las cabezas y sin tapar los avisos de siempre', () => {
  const { x, y, z, w, h, d } = AVISO_DE_PRECIOS, poste = CHOQUES.at(-1);
  assert.deepEqual([x, z], [poste[0], poste[1]]);
  assert.ok(y - h / 2 >= 3 && y + h / 2 <= .12 + poste[4]);
  assert.ok(x - w / 2 >= GAS_STATION.x0 && x + w / 2 <= GAS_STATION.x1 && z - d / 2 >= GAS_STATION.z0);
  for (const aviso of AVISOS.slice(2)) assert.ok(aviso.sitio[1] - aviso.alto / 2 > y + h / 2, aviso.sub);
  assert.ok(!underGasCanopy(x, z + d / 2));
  assert.deepEqual(PRECIOS.map(([combustible]) => combustible), ['CORRIENTE', 'EXTRA', 'DIÉSEL']);
  const { estacion } = levantar();
  const mastil = estacion.children.find(o => o.isMesh && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.height === 8.8);
  const frente = mastil.position.z - mastil.geometry.parameters.depth / 2;
  for (const aviso of AVISOS.slice(2)) assert.ok(frente > aviso.sitio[2], 'el poste no asoma por delante de los avisos');
  assert.ok(frente > z - d / 2 && mastil.geometry.parameters.width <= poste[2] && mastil.geometry.parameters.depth <= poste[3]);
  const posicion = sinAzarDeLaCiudad(() => piezasDeGasolinera()).getObjectByName('Gasolinera: piezas').geometry.attributes.position;
  let vertices = 0;
  for (let i = 0; i < posicion.count; i++) {
    if (Math.abs(posicion.getX(i) - x) <= w / 2 + 1e-6 && Math.abs(posicion.getZ(i) - z) <= d / 2 + 1e-6 && Math.abs(posicion.getY(i) - y) <= h / 2 + 1e-6) vertices++;
  }
  assert.equal(vertices, 24);
});
