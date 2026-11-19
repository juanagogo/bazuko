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

test('cada modelo tiene su edad: los viejos son viejos, el taxi está trabajado y los nuevos se cuidan', () => {
  for (const id of CAR_MODEL_IDS) assert.ok(EDAD[id] >= 0 && EDAD[id] <= 1, `${id} sin edad`);
  assert.ok(EDAD.cajaSetentera > EDAD.sedanNoventero && EDAD.sedanNoventero > EDAD.citadino);
  assert.ok(EDAD.citadino > EDAD.suv && EDAD.suv > EDAD.sedanDeportivo);
  assert.ok(edadDe('citadino', 'taxi') >= .6 && edadDe('sedanPopular', 'taxi') >= .6);
  assert.ok(edadDe('suv', 'police') <= .2 && edadDe('sedanPopular', 'police') <= .2);
  assert.equal(edadDe('camionetaNegra'), 0, 'la camioneta negra va impecable');
});

test('la laca se apaga con la edad y el tono del esmalte no cambia', () => {
  const nuevo = { metalness: .22, roughness: .4, clearcoat: 1, clearcoatRoughness: .18, envMapIntensity: 1 };
  assert.equal(acabadoConEdad(nuevo, 0), nuevo);
  const viejo = acabadoConEdad(nuevo, 1);
  assert.ok(viejo.clearcoat >= .15 && viejo.clearcoat <= .45 && viejo.roughness >= .5 && viejo.roughness <= .65);

  const laca = (kind, model) => { const v = makeVehicle(kind, 7, { model, beams: false }), paint = v.wetMaterials[0]; v.dispose(); return paint; };
  const caja = laca('carro', 'cajaSetentera'), deportivo = laca('carro', 'sedanDeportivo'), taxi = laca('taxi', 'citadino');
  assert.ok(caja.clearcoat <= .45 && caja.roughness >= .5, `cajaSetentera: laca ${caja.clearcoat}`);
  assert.ok(deportivo.clearcoat >= .65, `sedanDeportivo: laca ${deportivo.clearcoat}`);
  assert.ok(taxi.clearcoat < deportivo.clearcoat && taxi.clearcoat > caja.clearcoat);
  // La lluvia parte de la rugosidad de seco: ni el más viejo queda espejo mojado.
  assert.equal(caja.userData.dryRoughness, caja.roughness);
  assert.ok(caja.roughness * .75 > .35);
  assert.ok(AMARILLOS_TAXI.map(hex => new THREE.Color(hex).getHexString()).includes(taxi.color.getHexString()));
});

test('chapa y vidrio llevan el reflejo de la calle, solo la chapa lee el polvo y a las ruedas les sube desde el piso', () => {
  const v = makeVehicle('carro', 7, { model: 'sedanPopular', beams: false }), [paint, glass] = v.wetMaterials;
  const compilar = material => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    material.onBeforeCompile(shader);
    return shader.fragmentShader;
  };
  const chapa = compilar(paint), vidrio = compilar(glass);
  for (const trozo of ['( 1. - sampledDiffuseColor.a ) * uUsoMugre', 'diffuseColor.a = opacity', 'material.clearcoat * uUsoMatiz.z', 'usoRayo', 'uSunSkyFloor', 'vSunFieldPos'])
    assert.ok(chapa.includes(trozo), `la chapa no lleva «${trozo}»`);
  assert.ok(vidrio.includes('usoRayo') && !vidrio.includes('usoPolvo'));
  assert.ok(!glass.color.equals(new THREE.Color('#000000')) && glass.transparent && glass.opacity < .9, 'el vidrio no es una lámina negra');
  // El panorámico va más claro que los demás vidrios, en el mismo material, y el vidrio de canto se vuelve espejo.
  assert.ok(vidrio.includes('usoPanoramico') && !chapa.includes('usoPanoramico'));
  assert.ok(vidrio.includes('diffuseColor.a = min( diffuseColor.a + usoFuerza'));
  // El reflejo se ve de frente, lo sube el carro recién lavado y de noche lleva el matiz del esmalte.
  for (const trozo of ['float usoFrente = .13', 'uUsoMugre - .5', 'usoTono * dot( usoEntorno', 'usoNube'])
    assert.ok(REFLEJO_CALLE.includes(trozo), `el reflejo no lleva «${trozo}»`);
  assert.notEqual(paint.customProgramCacheKey(), glass.customProgramCacheKey());
  // Cada ancla del sombreador existe en esta versión de three: si una desaparece, el polvo dejaría de verse sin avisar.
  const suelto = { uniforms: {}, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  leerPolvo(suelto);
  assert.equal(suelto.fragmentShader.split('usoPolvo').length - 1, 7);
  assert.ok(suelto.fragmentShader.includes('usoVivo * usoClaro * saturate( ( uSunSkyFloor'), 'el esmalte vivo aguanta la noche');
  assert.ok(REFLEJO_CALLE.includes('reflectedLight.indirectSpecular +='));
  // Molduras, llantas y rines: el polvo les sube desde el piso, sin mapa.
  const molduras = compilar(v.trimMaterial);
  assert.ok(molduras.includes('usoBajo') && molduras.includes('metalnessFactor *= 1. - usoBajo'));
  assert.ok(v.wheels.every(wheel => wheel.material === v.trimMaterial));
  // Dos juegos de molduras para toda la flota, con el mismo programa: los carros con años llevan rin de acero.
  const viejo = makeVehicle('carro', 7, { model: 'cajaSetentera', beams: false }), taxi = makeVehicle('taxi', 4, { beams: false });
  assert.notEqual(viejo.trimMaterial, v.trimMaterial);
  assert.equal(taxi.trimMaterial, viejo.trimMaterial);
  assert.equal(makeVehicle('carro', 9, { model: 'sedanDeportivo', beams: false }).trimMaterial, v.trimMaterial);
  assert.equal(viejo.trimMaterial.customProgramCacheKey(), v.trimMaterial.customProgramCacheKey());
  assert.ok(viejo.wheels.every(wheel => wheel.material === viejo.trimMaterial));
  const valor = material => { const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader }; material.onBeforeCompile(shader); return shader.uniforms.uUsoRin.value; };
  assert.deepEqual([valor(v.trimMaterial), valor(viejo.trimMaterial)], [0, 1]);
  v.dispose();
});

test('el uso se pinta con azar propio: no gasta el del juego y sale igual cada vez', () => {
  const W = 1024, H = 512, spec = CAR_MODELS.sedanNoventero, body = getCarBody('sedanNoventero');
  const lienzo = (trazos, relleno) => new Proxy({}, {
    get: (_, nombre) => {
      if (nombre === 'createLinearGradient' || nombre === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (nombre === 'getImageData') return () => ({ data: new Uint8ClampedArray(W * H * 4).fill(relleno) });
      if (nombre === 'putImageData') return imagen => { trazos.imagen = imagen; };
      return (...args) => { trazos.push(`${String(nombre)}:${args.map(a => typeof a === 'number' ? a.toFixed(2) : a).join(',')}`); };
    },
    set: (_, nombre, valor) => { trazos.push(`${String(nombre)}=${valor}`); return true; },
  });
  const carta = { sx: x => (x - body.xTail) / spec.L * W, sy: y => H - .7 * y / body.chartH * H, tx: x => body.topUv(x, 0)[0] * W,
    ty: z => H - (.72 + .28 * z / body.chartZ) * H, pxX: W / spec.L, pxY: .7 * H / body.chartH, W, H };
  const pintar = () => {
    const trazos = [], velo = [];
    globalThis.document = { createElement: () => ({ getContext: () => lienzo(velo, 255) }) };
    try { pintarUso(lienzo(trazos, 0), spec, body, carta); } finally { delete globalThis.document; }
    return { trazos, velo };
  };
  let primera;
  assert.equal(azarGastado(() => { primera = pintar(); }), 0, 'pintar el uso gasta azar del juego');
  const segunda = pintar();
  assert.deepEqual(segunda.trazos, primera.trazos);
  assert.ok(primera.trazos.length > 300, 'barro y rayones van en el color');
  // Con el velo de polvo a tope, el alfa no baja del 20 %: el color del carro sigue mandando.
  const alfa = primera.trazos.imagen.data[3];
  assert.ok(alfa >= 50 && alfa < 80, `alfa mínimo ${alfa}`);
});

test('dos carros del mismo modelo y color pueden ir uno más limpio y otro más sucio, sin gastar azar del juego', () => {
  const niveles = new Set(Array.from({ length: 64 }, (_, i) => mugreDe(i << 23)));
  assert.ok(niveles.size >= 3 && Math.min(...niveles) >= .4 && Math.max(...niveles) <= 1.5);
  const vistos = new Map();
  let pareja = null;
  for (let seed = 0; seed < 400 && !pareja; seed++) {
    const v = makeVehicle('carro', seed, { model: 'sedanPopular', beams: false }), paint = v.wetMaterials[0], tono = paint.color.getHexString();
    const otro = vistos.get(tono);
    if (otro && otro.userData.mugre !== paint.userData.mugre) pareja = [otro, paint, seed];
    else if (!otro) vistos.set(tono, paint);
    v.dispose();
  }
  assert.ok(pareja, 'no salieron dos niveles de mugre en un mismo tono');
  const [uno, dos, seed] = pareja;
  assert.notEqual(uno, dos);
  assert.equal(uno.map, dos.map, 'el mapa de detalle es uno solo por modelo');
  assert.equal(uno.customProgramCacheKey(), dos.customProgramCacheKey());
  assert.equal(uno.clearcoat, dos.clearcoat);
  const valor = material => { const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader }; material.onBeforeCompile(shader); return shader.uniforms.uUsoMugre.value; };
  assert.deepEqual([valor(uno), valor(dos)], [uno.userData.mugre, dos.userData.mugre]);
  // La misma semilla da siempre el mismo esmalte, y la patrulla va siempre igual de limpia.
  assert.equal(makeVehicle('carro', seed, { model: 'sedanPopular', beams: false }).wetMaterials[0], dos);
  for (let s = 0; s < 40; s++) assert.equal(makeVehicle('police', s, { beams: false }).wetMaterials[0].userData.mugre, 1);
  // Un nivel nuevo de un tono que ya existe no le pide nada al azar del juego: con los 12 tonos y sus niveles ya creados
  // en otro modelo, cada carro gasta lo mismo que el primero.
  const gasto = [];
  for (let s = 0; s < 300; s++) makeVehicle('carro', s, { model: 'suv', beams: false, parked: true }).dispose();
  for (let s = 300; s < 330; s++) gasto.push(azarGastado(() => makeVehicle('carro', s, { model: 'suv', beams: false, parked: true }).dispose()));
  assert.equal(new Set(gasto).size, 1, `gasto desigual: ${gasto}`);
});

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

test('el taxi y la patrulla llevan el polvo de su tipo y el taxi sale en tres amarillos, sin gastar azar del juego', () => {
  // Un mapa de detalle propio por tipo cuando su edad no es la del modelo; el del modelo sigue siendo el de los particulares.
  for (const [kind, model] of [['taxi', 'citadino'], ['taxi', 'sedanPopular'], ['police', 'sedanPopular']]) {
    // El taxi trae además su librea (carLibreas.js): su mapa es el de la librea con el polvo de su edad.
    const spec = CAR_MODELS[model], body = getCarBody(model), edad = edadDe(model, kind), librea = libreaDe(kind, 3);
    const propio = makeVehicle(kind, 3, { model, beams: false }), particular = makeVehicle('carro', 3, { model, beams: false });
    assert.notEqual(edad, edadDe(model));
    assert.equal(propio.wetMaterials[0].map, getDetailMap(spec, body, librea, edad), `${kind} ${model}`);
    assert.equal(particular.wetMaterials[0].map, getDetailMap(spec, body));
    assert.notEqual(propio.wetMaterials[0].map, particular.wetMaterials[0].map);
    assert.equal(propio.wetMaterials[0].map.name, `Detalle ${model}${librea ? `:${librea}` : ''}@${edad}`);
  }
  // La patrulla en camioneta ya tiene la edad de su modelo: no gasta un mapa más.
  assert.equal(makeVehicle('police', 1, { model: 'suv', beams: false }).wetMaterials[0].map, getDetailMap(CAR_MODELS.suv, getCarBody('suv')));

  const tonos = new Map();
  for (let seed = 0; seed < 600; seed++) {
    const taxi = makeVehicle('taxi', seed, { beams: false, model: seed % 2 ? 'citadino' : undefined }), hex = taxi.wetMaterials[0].color.getHexString();
    tonos.set(hex, (tonos.get(hex) ?? 0) + 1); taxi.dispose();
  }
  assert.deepEqual([...tonos.keys()].sort(), AMARILLOS_TAXI.map(hex => new THREE.Color(hex).getHexString()).sort());
  for (const [hex, cuenta] of tonos) assert.ok(cuenta > 120, `amarillo ${hex}: ${cuenta} de 600`);
  assert.equal(amarilloDe(12345), amarilloDe(12345));
  // Con los tres amarillos y sus niveles de mugre ya creados, cada taxi le pide lo mismo al azar del juego.
  const gasto = new Set();
  for (let seed = 600; seed < 660; seed++) gasto.add(azarGastado(() => makeVehicle('taxi', seed, { beams: false, model: 'citadino' }).dispose()));
  assert.equal(gasto.size, 1, `gasto desigual: ${[...gasto]}`);
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
