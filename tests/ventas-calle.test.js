import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';

// Los avisos se pintan en un lienzo al cargar el módulo: aquí se anota lo que se escribe en ellos.
const rotulos = [];
const pincel = new Proxy({ measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop() {} }), fillText: (texto) => rotulos.push(texto) },
  { get: (objeto, clave) => objeto[clave] ?? (() => {}), set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => pincel }) };

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
// Con el azar sembrado desde antes de cargar el juego, como en las pruebas de navegador.
let sorteosAlCargar = 0;
const azarDelJuego = Math.random;
Math.random = () => { sorteosAlCargar++; return azarDelJuego(); };
const { lonaDe } = await import('../src/world/bogota/ventasCalle.js');
Math.random = azarDelJuego;
const { chaza, fritanga, umbrella } = await import('../src/world/bogota/props.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { buildMarket } = await import('../src/world/bogota/EastLandmarks.js');
const { Npc } = await import('../src/entities/Npc.js');
delete globalThis.document;

// Los ocho puestos de la ciudad, con el sitio, el nombre y lo que vende cada uno (Bogota.js).
const PUESTOS = [
  ['chaza', 'Chaza de don Efraín', ['cigarrillo', 'cafe', 'pan', 'agua', 'empanada'], 'dulces', 54.9, 48.5],
  ['fritanga', 'Fritanga La Mona', ['empanada', 'morcilla', 'papaCriolla', 'aguapanela', 'refresco'], 'fritanga', 95, 71],
  ['chaza', 'Dulces y minutos', ['cigarrillo', 'refresco', 'agua', 'empanada'], 'dulces', 118.6, 96.1],
  ['chaza', 'Chaza del callejón', ['cigarrillo', 'pan', 'agua'], 'dulces', 49, 55],
  ['chaza', 'Chaza de la Carrera 8', ['agua', 'pan', 'cafe', 'empanada'], 'tinto', 164.9, 109.5],
  ['fritanga', 'Fritanga del Sur', ['empanada', 'morcilla', 'papaCriolla', 'aguapanela', 'refresco'], 'fritanga', 104, 141],
  ['chaza', 'Tinto de la plaza', ['cafe', 'pan', 'agua', 'cigarrillo'], 'tinto', 279.4, 73],
  ['fritanga', 'Fritanga de la Calle 7', ['empanada', 'morcilla', 'papaCriolla', 'aguapanela', 'refresco'], 'fritanga', 288, 185]
];
const armar = ([kind, title, items]) => (kind === 'fritanga' ? fritanga({ title, items }) : chaza({ title, items }));
const mallas = (objeto) => { const lista = []; objeto.traverse((o) => { if (o.isMesh) lista.push(o); }); return lista; };
const triangulos = (objeto) => mallas(objeto).reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
const caja = (objeto) => { objeto.updateMatrixWorld(true); return new THREE.Box3().setFromObject(objeto); };
const huella = (objeto) => mallas(objeto).map((o) => Array.from(o.geometry.attributes.position.array).concat(Array.from(o.geometry.attributes.color?.array ?? [])).join()).join('|');

/** Corre algo con el azar del juego sembrado y cuenta cuántos números pidió. */
function conAzar(semilla, hacer) {
  const random = Math.random;
  let s = semilla >>> 0, sorteos = 0;
  try {
    Math.random = () => { sorteos++; return (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
    return { resultado: hacer(), sorteos };
  } finally {
    Math.random = random;
  }
}
/** Funde lo estático como lo hace la ciudad al armarse. */
const fundir = (group) => { Bogota.prototype._mergeStatic.call({ group }); return group; };

function vendorDistrict(save) {
  return Object.assign(new Bogota(save), {
    scene: new THREE.Scene(), _add: object => object, _takesRoom() {}, getGroundHeight: () => .12
  });
}

test('cada puesto de la calle se dibuja con cuatro llamadas como mucho y no pasa de 2.500 triángulos', () => {
  for (const puesto of PUESTOS) {
    const ciudad = new THREE.Group(), objeto = armar(puesto);
    objeto.position.set(puesto[4], 0.12, puesto[5]);
    ciudad.add(objeto);
    fundir(ciudad);
    assert.ok(mallas(ciudad).length <= 4, `${puesto[1]}: ${mallas(ciudad).length} llamadas de dibujo`);
    assert.ok(triangulos(ciudad) > 1500 && triangulos(ciudad) <= 2500, `${puesto[1]}: ${triangulos(ciudad)} triángulos`);
    let luces = 0;
    ciudad.traverse((o) => { if (o.isLight) luces++; });
    assert.equal(luces, puesto[0] === 'fritanga' ? 1 : 0, `${puesto[1]}: la fritanga conserva su luz y la chaza no suma ninguna`);
  }
});

test('el delantal corresponde al puesto atendido, no al arquetipo de sus transeúntes', async () => {
  const district = vendorDistrict();
  for (const [kind, title, items, , x, z] of PUESTOS) {
    district._vendor(x, z, 0, kind, title, items);
  }
  const walker = new Npc(district.scene, new THREE.Vector3(), { arquetipo: 'vendedor' });
  await Promise.all([...district.npcs, walker].map(person => person.preload()));
  assert.equal(district.npcs.length, PUESTOS.length);
  assert.equal(district.vendors.length, PUESTOS.length);
  assert.equal(walker.look.delantal, undefined);
  for (const [index, [kind, title, items, variant, x, z]] of PUESTOS.entries()) {
    const seller = district.npcs[index], stall = district.vendors[index];
    assert.ok(seller.isVendor && seller.fijo.stance === 'atender', title);
    assert.equal(seller.person.arquetipo, 'vendedor', title);
    assert.equal(seller.look.delantal, variant === 'dulces' ? undefined : variant, title);
    assert.deepEqual([stall.kind, stall.stall, stall.title, stall.items, stall.position], ['shop', kind, title, items, new THREE.Vector3(x, 0, z)]);
    assert.equal(stall.attendant, seller);
    assert.equal(stall.interactDistance(stall.position), 0);
  }
});

test('el puesto cierra junto al fallecido y lo atiende otra persona después de que ambos salen de vista', async t => {
  const browser = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.window = browser; });
  let deaths = 0, changes = 0;
  const open = (save, move = 0) => {
    const city = vendorDistrict(save);
    const ids = ['efrain', 'mona'];
    for (const [index, [kind, title, items, , x, z]] of PUESTOS.slice(0, 2).entries()) {
      city._vendor(x + move, z, 0, kind, title, items, ids[index]);
    }
    city.trafficPedestrians = [...city.npcs];
    return city;
  };
  let city = open({ seed: 4181 });
  window.addEventListener('npc-death', event => { deaths++; city.recordNpcDeath(event.detail.victim); });
  window.addEventListener('population-changed', () => { changes++; });
  const stall = city.vendors[0], original = stall.attendant, nextDoorId = city.vendors[1].attendant.stableId;
  await original.preload();
  assert.ok(original.takeHit({ damage: original.health }) > 0);
  assert.equal(stall.interactDistance(stall.position), Infinity);
  assert.equal(deaths, 1);
  const atDeath = JSON.parse(JSON.stringify(city.getPopulationSaveData()));
  city.npcs.forEach(npc => npc.dispose());
  city = open(atDeath);
  const closed = city.vendors[0], body = closed.attendant;
  await body.preload();
  assert.equal(body.stableId, original.stableId);
  assert.equal(body.deathSettled, true);
  assert.equal(closed.interactDistance(closed.position), Infinity);
  assert.equal(deaths, 1);
  const gone = { intersectsSphere: () => false }, visible = { intersectsSphere: () => true };
  const nearby = closed.position.clone(), far = nearby.clone().add(new THREE.Vector3(65, 0, 0));
  city.population.sweep(1, nearby, gone, Infinity, city._retireResident);
  city.population.sweep(2, far, visible, Infinity, city._retireResident);
  assert.equal(closed.attendant, body);
  assert.ok(!body._disposed);
  assert.equal(changes, 0);
  city.population.sweep(3, far, gone, Infinity, city._retireResident);
  assert.equal(changes, 1, 'avisa para guardar el relevo');
  assert.equal(city.npcs.includes(body), false);
  assert.equal(city.trafficPedestrians.includes(body), false);
  assert.equal(body._disposed, true);
  const replacement = closed.attendant;
  await replacement.preload();
  assert.notEqual(replacement.stableId, body.stableId);
  assert.notDeepEqual(replacement.person.real, body.person.real);
  assert.ok(!replacement.isDead && !replacement.looted && replacement.health === replacement.maxHealth);
  assert.equal(closed.interactDistance(closed.position), 0);
  assert.ok(city.npcs.includes(replacement) && city.trafficPedestrians.includes(replacement));
  assert.deepEqual(city.vendors[0].items, PUESTOS[0][2]);
  assert.equal(city.vendors[1].attendant.stableId, nextDoorId);
  const after = JSON.parse(JSON.stringify(city.getPopulationSaveData()));
  assert.equal(Object.values(after.people).length, 1);
  assert.equal(Object.values(after.people)[0].generation, 1);
  city.npcs.forEach(npc => npc.dispose());
  city = open(after, 2);
  assert.equal(city.vendors[0].attendant.stableId, replacement.stableId);
  assert.deepEqual(city.vendors[0].attendant.person.real, replacement.person.real);
  assert.equal(city.vendors[0].attendant.isDead, false);
  assert.equal(city.vendors[1].attendant.stableId, nextDoorId);
  assert.equal(deaths, 1);
  city.npcs.forEach(npc => npc.dispose());
});

test('los ocho puestos renuevan sus titulares fuera de vista y guardan todos los relevos en un solo barrido', async t => {
  const browser = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.window = browser; });
  const city = vendorDistrict({ seed: 3528 });
  for (const [kind, title, items, , x, z] of PUESTOS) city._vendor(x, z, 0, kind, title, items);
  const staff = [...city.npcs], oldIds = new Set(staff.map(npc => npc.stableId));
  city.trafficPedestrians = [...staff];
  let changes = 0;
  window.addEventListener('npc-death', event => city.recordNpcDeath(event.detail.victim));
  window.addEventListener('population-changed', () => { changes++; });
  await Promise.all(staff.map(npc => npc.ready));
  for (const npc of staff) npc.takeHit({ damage: npc.health });
  assert.ok(city.vendors.every(stall => stall.interactDistance(stall.position) === Infinity));
  const away = new THREE.Vector3(900, 0, 500);
  for (let i = 0; i < 24; i++) city.update(.1, away, null);
  assert.equal(changes, 1);
  assert.equal(city.npcs.length, 8);
  assert.deepEqual(new Set(city.npcs), new Set(city.trafficPedestrians));
  assert.deepEqual(new Set(city.npcs), new Set(city.vendors.map(stall => stall.attendant)));
  assert.ok(staff.every(npc => npc._disposed));
  assert.ok(city.npcs.every(npc => !npc.isDead && !oldIds.has(npc.stableId)));
  assert.ok(city.vendors.every(stall => stall.interactDistance(stall.position) === 0));
  city.minds?.dispose();
  city.npcs.forEach(npc => npc.dispose());
});

test('los puestos y la sombrilla ocupan la misma caja que antes', () => {
  // Las cajas de antes: el parasol de 1,2 m de radio con la punta a 2,475 m; en la fritanga, además, la caneca a 1,25 m.
  const iguales = (objeto, min, max, nombre) => {
    const b = caja(objeto);
    for (const [valor, esperado] of [...b.min.toArray().map((v, i) => [v, min[i]]), ...b.max.toArray().map((v, i) => [v, max[i]])]) {
      assert.ok(Math.abs(valor - esperado) < 1e-5, `${nombre}: caja ${b.min.toArray()} … ${b.max.toArray()}`);
    }
  };
  for (const puesto of PUESTOS) {
    if (puesto[0] === 'fritanga') iguales(armar(puesto), [-1.2, 0, -1.1], [1.25, 2.475, 1.3], puesto[1]);
    else iguales(armar(puesto), [-0.9, 0, -1], [1.5, 2.475, 1.4], puesto[1]);
  }
  iguales(umbrella(['#2e7d32', '#ecf0f1']), [-1.2, 0, -1.2], [1.2, 2.475, 1.2], 'sombrilla');
});

test('un puesto sale igual en cada partida y distinto de su vecino: su aspecto viene del nombre, no del azar del juego', () => {
  for (const puesto of PUESTOS) {
    const a = conAzar(1, () => armar(puesto)).resultado, b = conAzar(987654, () => armar(puesto)).resultado;
    assert.equal(huella(a), huella(b), `${puesto[1]} cambia con el azar del juego`);
  }
  assert.notEqual(huella(armar(PUESTOS[0])), huella(armar(PUESTOS[3])), 'dos chazas de dulces salen idénticas');
  assert.notEqual(huella(armar(PUESTOS[1])), huella(armar(PUESTOS[5])), 'dos fritangas salen idénticas');
});

test('armar los ocho puestos no escribe errores en la consola', () => {
  const errores = mock.method(console, 'error', () => {});
  try {
    for (const puesto of PUESTOS) armar(puesto);
    chaza({ withUmbrella: false, title: 'Chaza', items: ['cigarrillo'] });
    assert.deepEqual(errores.mock.calls.map((llamada) => llamada.arguments.join(' ')), []);
  } finally { errores.mock.restore(); }
});

test('las sombrillas conservan el color de la calle: varias combinaciones, varios tonos y ninguna igual a la del vecino', () => {
  const combinaciones = PUESTOS.map(([, title]) => lonaDe(title).join());
  assert.ok(new Set(combinaciones).size >= 4, `solo hay ${new Set(combinaciones).size} combinaciones de color entre los ocho puestos`);
  PUESTOS.forEach(([, title, , , x, z], i) => {
    const distancia = ([, , , , a, b]) => Math.hypot(a - x, b - z);
    const vecino = PUESTOS.filter((_, k) => k !== i).reduce((cerca, otro) => (distancia(otro) < distancia(cerca) ? otro : cerca));
    assert.notEqual(combinaciones[i], lonaDe(vecino[1]).join(), `${title} repite la sombrilla de ${vecino[1]}`);
  });
  // Lo que de verdad se ve: el matiz de cada punto vivo de la lona, por encima del alero, en franjas de 30 grados.
  const tonos = new Set(), hsl = {}, color = new THREE.Color();
  for (const puesto of PUESTOS) {
    const propios = new Set();
    for (const malla of mallas(armar(puesto))) {
      const p = malla.geometry.attributes.position, c = malla.geometry.attributes.color;
      malla.updateWorldMatrix(true, false);
      for (let i = 0; c && i < p.count; i++) {
        if (new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(malla.matrixWorld).y < 2.12) continue;
        color.fromBufferAttribute(c, i).getHSL(hsl, THREE.SRGBColorSpace);
        if (hsl.s > .2 && hsl.l > .2) propios.add(Math.floor(hsl.h * 12) % 12);
      }
    }
    assert.ok(propios.size >= 1, `${puesto[1]}: la sombrilla salió lavada, sin un solo tono vivo`);
    for (const tono of propios) tonos.add(tono);
  }
  assert.ok(tonos.size >= 3, `entre los ocho puestos solo se ven ${tonos.size} tonos`);
});

test('lo que se ve cuadra con lo que vende', () => {
  const variante = (objeto) => { let v; objeto.traverse((o) => { v ??= o.userData.variante; }); return v; };
  for (const puesto of PUESTOS) assert.equal(variante(armar(puesto)), puesto[3], puesto[1]);
  // La comida de la vitrina es la de la lista: sin morcilla ni papa criolla hay menos que mostrar.
  const completa = triangulos(fritanga({ title: 'Fritanga', items: ['empanada', 'morcilla', 'papaCriolla'] }));
  assert.ok(triangulos(fritanga({ title: 'Fritanga', items: ['empanada'] })) < completa);
  // Quien vende tinto lleva sus termos aunque sea chaza de dulces.
  const sinCafe = triangulos(chaza({ title: 'Chaza', items: ['cigarrillo'] }));
  assert.ok(triangulos(chaza({ title: 'Chaza', items: ['cigarrillo', 'cafe'] })) > sinCafe);
  assert.ok(triangulos(chaza({ title: 'Chaza', items: ['cigarrillo', 'refresco'] })) > sinCafe);
});

test('los puestos piden el mismo azar que antes al armarse y al fundirse en la ciudad', () => {
  armar(PUESTOS[0]); armar(PUESTOS[1]);
  // Las pruebas de tráfico y de gente siembran el azar y arman la ciudad: si un puesto pide otra cantidad, todo lo que
  // se sortea después cambia. Antes la chaza pedía 321 números y la fritanga 238.
  for (const puesto of PUESTOS) assert.equal(conAzar(5, () => armar(puesto)).sorteos, puesto[0] === 'fritanga' ? 238 : 321, puesto[1]);
  // Al fundir lo estático la ciudad vuelve a sortear por cada malla y por cada lote. Antes cada chaza eran 26 mallas y,
  // por sector, diez lotes comunes más dos por cada paraguas distinto; el paraguas era el sorteo 209 de la chaza. Las
  // tres primeras chazas comparten sector y las otras dos van solas.
  const paraguasDistintos = new Set();
  for (let semilla = 1; semilla <= 12; semilla++) {
    const ciudad = new THREE.Group(), paraguas = [];
    conAzar(semilla, () => {
      const sembrado = Math.random;
      for (const puesto of PUESTOS) {
        let n = 0;
        Math.random = () => { const valor = sembrado(); if (++n === 209 && puesto[0] === 'chaza') paraguas.push(valor < .5); return valor; };
        const objeto = armar(puesto);
        objeto.position.set(puesto[4], 0.12, puesto[5]);
        ciudad.add(objeto);
      }
      Math.random = sembrado;
    });
    const distintos = new Set(paraguas.slice(0, 3)).size;
    paraguasDistintos.add(distintos);
    assert.equal(conAzar(semilla, () => fundir(ciudad)).sorteos, 5 * 26 * 4 + (3 * 10 + 2 * (distintos + 2)) * 8, `semilla ${semilla}`);
  }
  assert.deepEqual([...paraguasDistintos].sort(), [1, 2], 'entre las semillas hay sectores con un paraguas y con dos');
});

test('cargar las ventas de la calle no gasta azar del juego', () => {
  assert.equal(sorteosAlCargar, 0, 'los materiales y el lienzo compartidos no corren lo que se sortea después con una semilla fija');
});

test('con un lienzo a medias, como el de otras pruebas, los puestos cargan sin avisos en vez de romperse', async () => {
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) };
  try {
    await assert.doesNotReject(import('../src/world/bogota/ventasCalle.js?lienzo-a-medias'));
    globalThis.document = { createElement: () => ({}) };
    await assert.doesNotReject(import('../src/world/bogota/ventasCalle.js?sin-lienzo'));
  } finally { delete globalThis.document; }
});

test('de noche se prenden las brasas, el bombillo y la linterna de la chaza, sin luces nuevas', () => {
  const puesto = fritanga({ title: 'Fritanga La Mona', items: PUESTOS[1][2] });
  const brasas = mallas(puesto).find((o) => o.material.isMeshBasicMaterial);
  const brillo = (noche) => {
    puesto.userData.setNight(noche);
    for (let i = 0; i < 600; i++) puesto.userData.update(1 / 60, i / 60);
    brasas.onBeforeRender();
    return brasas.material.color.r;
  };
  const dia = brillo(false), noche = brillo(true);
  assert.ok(dia < .9, `de día el bombillo está apagado (${dia})`);
  assert.ok(noche > 1.8, `de noche las brasas y el bombillo brillan (${noche})`);
  const tienda = chaza({ title: 'Dulces y minutos', items: PUESTOS[2][2] });
  const linterna = mallas(tienda).find((o) => o.material.emissiveIntensity !== undefined && o.material.emissive.getHex() !== 0);
  assert.ok(linterna, 'la chaza no tiene linterna');
  tienda.userData.setNight(true);
  assert.ok(linterna.material.emissiveIntensity > 1);
  tienda.userData.setNight(false);
  assert.ok(linterna.material.emissiveIntensity < .1);
});

test('al quitar un puesto se libera lo suyo y los demás siguen con sus materiales', () => {
  for (const puesto of [PUESTOS[0], PUESTOS[1]]) {
    // Con el mismo azar a los dos les toca el mismo juego de materiales compartidos.
    const objeto = conAzar(7, () => armar(puesto)).resultado, vecino = conAzar(7, () => armar(puesto)).resultado, liberados = new Set();
    const propios = new Set(mallas(objeto).flatMap((o) => [o.geometry, o.material]));
    const ajenos = new Set(mallas(vecino).map((o) => o.material));
    for (const recurso of [...propios, ...ajenos]) recurso.addEventListener('dispose', () => liberados.add(recurso));
    assert.equal(typeof objeto.userData.dispose, 'function', `${puesto[1]} no sabe soltarse`);
    objeto.userData.dispose();
    for (const recurso of propios) if (!ajenos.has(recurso)) assert.ok(liberados.has(recurso), `${puesto[1]}: queda algo sin liberar`);
    for (const recurso of ajenos) if (propios.has(recurso)) assert.ok(!liberados.has(recurso), `${puesto[1]}: se llevó un material del vecino`);
    assert.equal(mallas(objeto).length, 0);
  }
});

test('los avisos son pintados a mano y ninguno nombra una marca de verdad', () => {
  // El letrero grande se pinta letra por letra.
  const texto = rotulos.join('').toLowerCase();
  for (const palabra of ['minutos', 'tinto', 'empanadas']) assert.ok(texto.includes(palabra), `falta el aviso de ${palabra}`);
  // Gaseosas, cervezas, cigarrillos, operadores, dulces y cafés de verdad; van cifrados para que este archivo tampoco los contenga.
  const marcas = [
    'Y29jYQ==', 'cGVwc2k=', 'cG9zdG9ib24=', 'cG9zdG9iw7Nu', 'Y29sb21iaWFuYQ==', 'cG9ueQ==', 'YnJldGHDsWE=', 'YWd1aWxh', 'w6FndWlsYQ==',
    'cG9rZXI=', 'cMOza2Vy', 'Y2x1YiBjb2xvbWJpYQ==', 'bWFybGJvcm8=', 'Ym9zdG9u', 'bHVja3k=', 'Y2xhcm8=', 'bW92aXN0YXI=', 'dGlnbw==',
    'd29t', 'dmlyZ2lu', 'Ym9uIGJvbg==', 'Y2hvY29yYW1v', 'cmFtbw==', 'amV0', 'bWFyZ2FyaXRh', 'ZGUgdG9kaXRv', 'c2VsbG8gcm9qbw==',
    'b21h', 'anVhbiB2YWxkZXo=', 'bmVzY2Fmw6k=', 'bmVzY2FmZQ==', 'YmltYm8=', 'dHJpZGVudA==', 'aGFsbHM='
  ].map((nombre) => Buffer.from(nombre, 'base64').toString('utf8'));
  for (const marca of marcas) assert.ok(!new RegExp(`(^|[^a-záéíóúñ])${marca}([^a-záéíóúñ]|$)`).test(texto), `el aviso nombra «${marca}»`);
});

test('la plaza de mercado conserva sus colisiones y gana toldos colgados y remendados, montones de fruta, racimos y básculas', () => {
  const { group, colliders, blockedTiles } = buildMarket({ detail: new THREE.MeshStandardMaterial() });
  // Las mesas de siempre: seis, con el mismo sitio y tamaño (lo que detiene a la gente no cambia).
  assert.deepEqual(colliders.map((c) => [+c.x.toFixed(3), c.z, c.w, c.d, c.h]), [
    [325.146, 166.32, 3.5, 1.7000000000000002, 1.3], [330.853, 166.32, 3.5, 1.7000000000000002, 1.3], [337.14, 166.32, 3.5, 1.7000000000000002, 1.3],
    [324.868, 175.68, 3.5, 1.7000000000000002, 1.3], [331.102, 175.68, 3.5, 1.7000000000000002, 1.3], [337.126, 175.68, 3.5, 1.7000000000000002, 1.3]
  ]);
  assert.equal(blockedTiles.join(' '), '162,83 162,84 163,83 163,84 164,83 164,84 164,83 164,84 165,83 165,84 166,83 166,84 168,83 168,84 169,83 169,84 170,83 170,84 ' +
    '161,87 161,88 162,87 162,88 163,87 163,88 165,87 165,88 166,87 166,88 167,87 167,88 168,87 168,88 169,87 169,88 170,87 170,88');
  assert.equal(mallas(group).length, 1, 'la plaza sigue siendo una sola malla');
  const total = triangulos(group);
  assert.ok(total > 2500 && total <= 7000, `${total} triángulos en los seis puestos`);
  // La lona cuelga: hay puntos del toldo por debajo de la recta entre el alero y la cumbrera.
  const p = mallas(group)[0].geometry.attributes.position;
  let colgados = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), fila = p.getZ(i) < 171 ? 166.32 : 175.68, lejos = Math.abs(p.getZ(i) - fila);
    if (y > 2.4 && y < 2.9 && lejos > .3 && lejos < 1.2 && y < 2.95 - lejos * (2.95 - 2.32) / 1.45 - .03) colgados++;
  }
  assert.ok(colgados > 20, `el toldo está tieso (${colgados} puntos colgados)`);
});
