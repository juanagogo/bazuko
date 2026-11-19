import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addStreetDetails } from '../src/world/bogota/StreetDetails.js';
import { activateSunField } from '../src/world/bogota/SunField.js';
import { CLASES, FRANJA, HUELLA, MEZCLA, addMobiliarioDenso, claseDe } from '../src/world/bogota/mobiliarioDenso.js';
import { CAR_MODELS, PRIVATE_MIX } from '../src/world/bogota/carModels.js';
import { parkedCarOffset } from '../src/world/bogota/parkedCars.js';
import { crossings } from '../src/world/bogota/StreetMarkings.js';

const T = 2;
const ROADS = new Set(['road', 'busway']);
const UV = new Proxy({}, { get: () => [0, 0, 1, 1] });

function distrito() {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  Object.assign(city, { props: [], treePlan: [], vegetationPlan: { clusters: [] }, vendors: [], fireBarrels: [],
    signals: { poles: [] }, renderSectors: [], isNearReserved: () => false, buildingVisibility: { buildings: [] } });
  return city;
}

/** Lote de mentira: anota cada caja y cada cilindro en vez de armar geometría. */
function lote({ sectores = true } = {}) {
  const formas = [];
  return {
    formas, chunkSize: 32, chunks: { has: () => sectores },
    box(x, y, z, w, h, d) { formas.push({ x, y, z, radio: Math.hypot(w, d) / 2, alto: h }); },
    cylinder(x, y, z, r0, r1, h) { formas.push({ x, y, z, radio: Math.max(r0, r1), alto: h }); }
  };
}
const libres = () => ({ free: () => true, add() {} });

test('el mobiliario denso llena la franja del sardinel sin salirse de ella', () => {
  const city = distrito(), street = lote();
  const { cuenta, piezas } = addMobiliarioDenso(street, city, UV, libres());
  assert.ok(piezas.length > 400, `piezas: ${piezas.length}`);
  for (const clase of CLASES) assert.ok(cuenta[clase] > 5, `${clase}: ${cuenta[clase]}`);
  assert.ok(cuenta.bolardo > 100);
  const reglas = city._pedestrianRules();
  for (const { clase, x, z, tx, tz, dx, dz } of piezas) {
    assert.equal(city.map[tz][tx], 'sidewalk');
    assert.ok(ROADS.has(city.map[tz + dz][tx + dx]));
    assert.ok(!reglas.isCrossing(tx + dx, tz + dz), `${clase} frente a un paso peatonal en ${x},${z}`);
    // Del borde del sardinel al centro de la pieza, y de ahí a cada lado, siempre dentro de la franja.
    const alBorde = T / 2 - ((x - tx * T) * dx + (z - tz * T) * dz), { fondo } = HUELLA[clase];
    assert.ok(alBorde - fondo >= .33 && alBorde + fondo <= .71, `${clase} a ${alBorde.toFixed(2)} m del sardinel`);
  }
  for (const { x, z, y, radio, alto } of street.formas) {
    assert.ok(y >= .12 && y + alto < 1.7, 'nada enterrado ni más alto que una persona');
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const tile = city.map[Math.round((z + j * radio * .71) / T)]?.[Math.round((x + i * radio * .71) / T)];
      assert.equal(tile, 'sidewalk', `forma sobre ${tile} en ${x.toFixed(1)},${z.toFixed(1)}`);
    }
  }
});

test('cada barrio deja lo suyo: basura y escombro en El Cartucho, canecas y armarios en el centro', () => {
  const { piezas } = addMobiliarioDenso(lote(), distrito(), UV, libres());
  const de = (barrio, ...clases) => piezas.filter(p => p.barrio === barrio && clases.includes(p.clase)).length;
  assert.ok(de('cambuche', 'bolsas', 'escombro') > de('cambuche', 'caneca', 'armario', 'hidrante', 'matera', 'bici'));
  assert.ok(de('centro', 'caneca', 'armario') > de('centro', 'bolsas', 'escombro'));
  assert.equal(de('cambuche', 'matera', 'bici'), 0);
  assert.equal(claseDe(MEZCLA.centro, 0), 'caneca');
  assert.equal(claseDe(MEZCLA.cambuche, .999), 'escombro');
});

test('el mobiliario denso no gasta azar, no abre sectores nuevos y respeta lo que ya está puesto', () => {
  const azar = Math.random;
  let gastos = 0;
  Math.random = () => { gastos++; return azar(); };
  try {
    const primero = addMobiliarioDenso(lote(), distrito(), UV, libres());
    const segundo = addMobiliarioDenso(lote(), distrito(), UV, libres());
    assert.deepEqual(segundo.piezas, primero.piezas, 'determinista');
    const city = distrito(), antes = gastos;
    assert.ok(addMobiliarioDenso(lote(), city, UV, libres()).piezas.length > 400);
    assert.equal(gastos, antes, 'ni un número del azar sembrado');
  } finally { Math.random = azar; }
  const sinSector = lote({ sectores: false });
  assert.equal(addMobiliarioDenso(sinSector, distrito(), UV, libres()).piezas.length, 0);
  assert.equal(sinSector.formas.length, 0, 'donde el lote no tiene sector no nace una malla');
  const ocupado = lote();
  assert.equal(addMobiliarioDenso(ocupado, distrito(), UV, { free: () => false, add() {} }).piezas.length, 0);
  assert.equal(ocupado.formas.length, 0);
});

test('con el mobiliario denso la calle conserva sus mallas y no suma colisiones', () => {
  const city = distrito();
  const collisions = { colliders: [], fall: 0, queryStatic: () => [], addFallObstacle() { this.fall++; } };
  addStreetDetails(city, collisions);
  assert.equal(collisions.colliders.length, 0);
  const calle = [];
  city.group.traverse(object => { if (object.isMesh && object.name === 'Calle') calle.push(object); });
  const triangulos = calle.reduce((n, mesh) => n + mesh.geometry.index.count / 3, 0);
  console.log(`mallas de calle: ${calle.length}; triángulos: ${triangulos}`);
  assert.ok(triangulos < 420000);
  activateSunField(null);
});

/** Lote de mentira que guarda la planta de cada caja y cada cilindro, con su giro. */
function plantas() {
  const puntos = [];
  return {
    puntos, chunkSize: 32, chunks: { has: () => true },
    box(x, y, z, w, h, d, a = 0) {
      const c = Math.cos(a), s = Math.sin(a);
      for (const i of [-w / 2, w / 2]) for (const j of [-d / 2, d / 2]) puntos.push([x + i * c + j * s, z - i * s + j * c]);
    },
    cylinder(x, y, z, r0, r1) {
      const r = Math.max(r0, r1);
      for (let k = 0; k < 12; k++) puntos.push([x + r * Math.cos(k * Math.PI / 6), z + r * Math.sin(k * Math.PI / 6)]);
    }
  };
}

test('ninguna pieza se mete en el paso de la gente, ni encima de un carro parqueado ni en la entrada de un cruce', () => {
  const city = distrito(), street = plantas();
  const { piezas } = addMobiliarioDenso(street, city, UV, libres());
  assert.ok(piezas.length > 400);
  // Distancia de cada punto de la planta al borde del sardinel: lo más cerca que queda una baldosa de calzada.
  const alSardinel = (x, z) => {
    let menor = Infinity;
    for (let tz = Math.round(z / T) - 2; tz <= Math.round(z / T) + 2; tz++) for (let tx = Math.round(x / T) - 2; tx <= Math.round(x / T) + 2; tx++) {
      if (!ROADS.has(city.map[tz]?.[tx])) continue;
      menor = Math.min(menor, Math.hypot(Math.max(Math.abs(x - tx * T) - T / 2, 0), Math.max(Math.abs(z - tz * T) - T / 2, 0)));
    }
    return menor;
  };
  let lejos = 0, cerca = Infinity;
  for (const [x, z] of street.puntos) {
    const d = alSardinel(x, z);
    lejos = Math.max(lejos, d); cerca = Math.min(cerca, d);
    assert.ok(d <= .7 + 1e-6, `pieza a ${d.toFixed(3)} m del sardinel en ${x.toFixed(2)}, ${z.toFixed(2)}`);
    assert.ok(d >= FRANJA.desde - 1e-6, `pieza a ${d.toFixed(3)} m del sardinel en ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
  assert.ok(lejos > .6 && cerca < .4, `de ${cerca.toFixed(2)} a ${lejos.toFixed(2)} m`);

  // El carro más ancho y el más largo de los que se parquean, con 10 cm de espejo a cada lado, en cada puesto posible.
  const modelos = [...PRIVATE_MIX.map(([id]) => id), 'citadino', 'sedanPopular'].map(id => CAR_MODELS[id]);
  const ancho = Math.max(...modelos.map(m => m.W)), largo = Math.max(...modelos.map(m => m.L));
  const puestos = city.getParkingSpots();
  assert.ok(puestos.length > 100, `puestos: ${puestos.length}`);
  for (const puesto of puestos) {
    const corre = parkedCarOffset(puesto, ancho), cx = puesto.x + corre.x, cz = puesto.z + corre.z;
    const [mx, mz] = Math.abs(puesto.rot - Math.PI / 2) < .01 ? [ancho / 2 + .1, largo / 2] : [largo / 2, ancho / 2 + .1];
    for (const [x, z] of street.puntos) {
      assert.ok(Math.abs(x - cx) >= mx || Math.abs(z - cz) >= mz, `pieza bajo un carro parqueado en ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }

  // La entrada al cruce: la rampa al final de cada cebra, de 1,9 m de ancho, y el andén que lleva a ella.
  const rampas = [], banda = 2 * T;
  for (const { x0, x1, z0, z1 } of crossings()) {
    for (const z of [z0 - banda / 2, z1 + banda / 2]) rampas.push([x0, z, 1, 0], [x1, z, -1, 0]);
    for (const x of [x0 - banda / 2, x1 + banda / 2]) rampas.push([x, z0, 0, 1], [x, z1, 0, -1]);
  }
  for (const [x, z] of street.puntos) {
    for (const [rx, rz, dx, dz] of rampas) {
      const along = (x - rx) * dz + (z - rz) * dx, into = (x - rx) * dx + (z - rz) * dz;
      assert.ok(!(Math.abs(along) < 1.3 && into > -1.6 && into < 1), `pieza en la entrada del cruce en ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }
});
