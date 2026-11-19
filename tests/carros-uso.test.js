import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle, CAR_MODEL_IDS } from '../src/world/bogota/vehicles.js';
import { CAR_MODELS, MODEL_PAINTS } from '../src/world/bogota/carModels.js';
import { getCarBody } from '../src/world/bogota/VehicleBody.js';
import { getDetailMap } from '../src/world/bogota/carDetail.js';
import { EDAD, edadDe, acabadoConEdad, mugreDe, pintarUso, leerPolvo, REFLEJO_CALLE, SIN_MATIZ } from '../src/world/bogota/carUso.js';
import { AMARILLOS_TAXI, amarilloDe, matizDe, conRinDeAcero } from '../src/world/bogota/carVariantes.js';
import { libreaDe } from '../src/world/bogota/carLibreas.js';

/** Corre `fn` contando cuántos números le pide al azar del juego. */
const azarGastado = fn => {
  const real = Math.random; let cuenta = 0;
  Math.random = () => { cuenta++; return real(); };
  try { fn(); } finally { Math.random = real; }
  return cuenta;
};

test('la variante es un gancho: sin ella no cambia nada y con ella hay un mapa y un esmalte aparte', () => {
  // Con un furgón: el taxi y la buseta ya traen su librea como variante.
  const spec = CAR_MODELS.furgon, body = getCarBody('furgon');
  const base = makeVehicle('carro', 12, { beams: false, model: 'furgon' }), otra = makeVehicle('carro', 12, { beams: false, model: 'furgon', variante: '' });
  assert.equal(base.wetMaterials[0], otra.wetMaterials[0]);
  assert.equal(getDetailMap(spec, body), getDetailMap(spec, body, ''));
  assert.equal(base.wetMaterials[0].map, getDetailMap(spec, body));
  const librea = makeVehicle('carro', 12, { beams: false, model: 'furgon', variante: 'prueba' });
  assert.notEqual(librea.wetMaterials[0], base.wetMaterials[0]);
  assert.equal(librea.wetMaterials[0].map, getDetailMap(spec, body, 'prueba'));
  assert.notEqual(getDetailMap(spec, body, 'prueba'), getDetailMap(spec, body));
  assert.equal(makeVehicle('carro', 16, { beams: false, model: 'furgon', variante: 'prueba' }).wetMaterials[0].map, librea.wetMaterials[0].map);
  // Ya creados el esmalte y el mapa, un carro con variante gasta el mismo azar del juego que uno sin ella.
  const sin = azarGastado(() => makeVehicle('carro', 12, { beams: false, model: 'furgon' })), con = azarGastado(() => makeVehicle('carro', 12, { beams: false, model: 'furgon', variante: 'prueba' }));
  assert.equal(con, sin);
});

test('cada particular lleva su matiz y algunos populares rin de acero: el tono oficial no cambia y el juego gasta lo mismo', () => {
  const matices = new Map(), rines = new Set(), tonos = new Set(), oficiales = MODEL_PAINTS.hatchPopular.map(hex => new THREE.Color(hex).getHexString());
  for (let seed = 0; seed < 400; seed++) {
    const v = makeVehicle('carro', seed, { model: 'hatchPopular', beams: false }), paint = v.wetMaterials[0];
    matices.set(paint.userData.matiz.join(), paint.userData.matiz); rines.add(v.trimMaterial); tonos.add(paint.color.getHexString());
    v.dispose();
  }
  assert.ok(matices.size >= 4, `solo ${matices.size} matices`);
  assert.ok(matices.has(SIN_MATIZ.join()));
  for (const [claridad, viveza, laca] of matices.values())
    assert.ok(claridad >= .9 && claridad <= 1.1 && viveza >= .75 && viveza <= 1.06 && laca >= .6 && laca <= 1.2, `matiz ${[claridad, viveza, laca]}`);
  assert.equal(rines.size, 2, 'unos populares llevan aleación y otros rin de acero');
  for (const hex of tonos) assert.ok(oficiales.includes(hex), `tono ${hex} fuera de la carta del modelo`);
  assert.equal(matizDe(77), matizDe(77));
  assert.equal(typeof conRinDeAcero(77), 'boolean');
  // El matiz es un valor del material: mismo mapa, mismo programa y misma laca de fábrica que su gemelo sin matiz.
  const valor = material => { const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader }; material.onBeforeCompile(shader); return shader.uniforms.uUsoMatiz.value; };
  const porTono = new Map();
  let pareja = null;
  for (let seed = 0; seed < 400 && !pareja; seed++) {
    const paint = makeVehicle('carro', seed, { model: 'citadino', beams: false }).wetMaterials[0], tono = paint.color.getHexString(), otro = porTono.get(tono);
    if (otro && otro.userData.matiz !== paint.userData.matiz) pareja = [otro, paint];
    else if (!otro) porTono.set(tono, paint);
  }
  assert.ok(pareja, 'no salieron dos matices en un mismo tono');
  assert.notEqual(pareja[0], pareja[1]);
  assert.equal(pareja[0].map, pareja[1].map);
  assert.equal(pareja[0].clearcoat, pareja[1].clearcoat);
  assert.equal(pareja[0].customProgramCacheKey(), pareja[1].customProgramCacheKey());
  assert.deepEqual([valor(pareja[0]), valor(pareja[1])], [pareja[0].userData.matiz, pareja[1].userData.matiz]);
  // Taxi, patrulla y buseta van sin matiz; los cuidados no pierden la aleación y los viejos nunca la llevan.
  for (let seed = 0; seed < 60; seed++) {
    for (const kind of ['taxi', 'police', 'buseta']) assert.equal(makeVehicle(kind, seed, { beams: false }).wetMaterials[0].userData.matiz, SIN_MATIZ);
    const cuidado = makeVehicle('carro', seed, { model: 'suv', beams: false }), viejo = makeVehicle('carro', seed, { model: 'sedanNoventero', beams: false });
    assert.notEqual(cuidado.trimMaterial, viejo.trimMaterial);
    assert.equal(cuidado.trimMaterial, makeVehicle('carro', 0, { model: 'sedanDeportivo', beams: false }).trimMaterial);
  }
  // Con los matices ya creados o por crear, cada carro le pide lo mismo al azar del juego.
  const gasto = new Set();
  for (let seed = 400; seed < 460; seed++) gasto.add(azarGastado(() => makeVehicle('carro', seed, { model: 'hatchPopular', beams: false }).dispose()));
  assert.equal(gasto.size, 1, `gasto desigual: ${[...gasto]}`);
});
