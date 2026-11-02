import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { ARCHETYPES, LOW_STANCES, SEARCH_ACTION, ZONE_WEIGHTS, normalizeTalla, personLook, pickArchetype, pickStop, pickWalk, rollPerson } from '../src/character/archetypes.js';
import { STANCE_NAMES } from '../src/character/stances.js';
import { GAIT_FAMILIES } from '../src/character/gaitFamilies.js';
import { isStreetProp } from '../src/character/props.js';
import { normalizeReal, optionsFor } from '../src/character/RealisticCharacter.js';

const catalog = JSON.parse(readFileSync(new URL('../public/models/personaje/catalogo.json', import.meta.url), 'utf8'));
const ids = Object.keys(ARCHETYPES);

/** Generador con semilla: las pruebas de reparto no deben fallar por azar. */
function seeded(seed = 1) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

const has = (cat, sexo, id) => optionsFor(catalog, cat, sexo).some(piece => piece.id === id);
const HEX = /^#[0-9a-f]{6}$/;

test('están las ocho personas de Bogotá y todas sus piezas existen en el catálogo real para su sexo', () => {
  assert.deepEqual(ids.sort(), ['abuelo', 'estudiante', 'habitante', 'obrero', 'oficinista', 'reciclador', 'senora', 'vendedor']);
  for (const [id, spec] of Object.entries(ARCHETYPES)) {
    for (const sexo of ['hombre', 'mujer']) {
      if (sexo === 'mujer' ? spec.mujer <= 0 : spec.mujer >= 1) continue;
      for (const ropa of spec.ropa[sexo]) assert.ok(has('ropa', sexo, ropa), `${id}: ${sexo} sin ${ropa}`);
      for (const pelo of spec.pelo[sexo]) assert.ok(has('pelo', sexo, pelo), `${id}: ${sexo} sin pelo ${pelo}`);
      for (const calzado of Object.keys(spec.calzado)) assert.ok(has('calzado', sexo, calzado), `${id}: ${sexo} sin ${calzado}`);
      for (const cabeza of Object.keys(spec.cabeza)) assert.ok(has('cabeza', sexo, cabeza), `${id}: ${sexo} sin ${cabeza}`);
    }
    for (const barba of Object.keys(spec.barba)) assert.ok(has('barba', 'hombre', barba), `${id}: sin barba ${barba}`);
  }
});

test('la apariencia sale entera del catálogo: normalizeReal no tiene nada que corregir', () => {
  const random = seeded(7);
  for (const id of ids) for (let i = 0; i < 80; i++) {
    const person = rollPerson(id, { random });
    const before = structuredClone(person.real);
    const real = normalizeReal(catalog, person.real);
    for (const key of ['sexo', 'edad', 'pelo', 'barba', 'ropa', 'calzado', 'cabeza']) assert.equal(real[key], before[key], `${id}: ${key}`);
    assert.deepEqual(real.accesorios, before.accesorios);
    assert.ok(person.piel >= 0 && person.piel <= 5);
    assert.ok(Number.isInteger(person.peloColor));
    if (person.sexo === 'mujer') assert.equal(real.barba, 'ninguna');
  }
});

// Los nombres van cifrados para que este archivo tampoco los contenga.
const uncode = (names) => names.map(name => Buffer.from(name, 'base64').toString('utf8'));
const BRANDS = uncode([
  'YWRpZGFz', 'bmlrZQ==', 'cHVtYQ==', 'cmVlYm9r', 'bmV3IGJhbGFuY2U=', 'dmFucw==', 'dW1icm8=', 'a2FwcGE=',
  'bGFjb3N0ZQ==', 'bGV2aXM=', 'bGV2aSdz', 'emFyYQ==', 'Z3VjY2k=', 'dGhlIG5vcnRoIGZhY2U=', 'dW5kZXIgYXJtb3Vy',
  'dGltYmVybGFuZA==', 'Y2FsdmluIGtsZWlu', 'cmFscGggbGF1cmVu', 'dG9tbXkgaGlsZmlnZXI=', 'Y29jYS1jb2xh',
  'Y29jYSBjb2xh', 'cGVwc2k=', 'cG9zdG9ib24=', 'anVhbiB2YWxkZXo=', 'Y2FydWxsYQ==', 'cmFwcGk=', 'bW92aXN0YXI=',
  'c2Ftc29uaXRl', 'dG90dG8=', 'Y3JvY3M=', 'Y2F0ZXJwaWxsYXI=', 'd3JhbmdsZXI=', 'aGFuZXM=', 'YmltYm8=',
  'Y29sYW50YQ==', 'YmF2YXJpYQ==', 'b3h4bw==', 'dGlnbw==', 'YXZpYW5jYQ==', 'dWJlcg==', 'aXBob25l',
  'c2Ftc3VuZw==', 'bW90b3JvbGE=', 'bWFybGJvcm8=', 'bHVja3kgc3RyaWtl', 'YmVsbW9udA==', 'bXVzdGFuZw==',
  'dGVycGVs', 'ZXNzbw==', 'cHJpbWF4', 'YmlvbWF4', 'YmFuY29sb21iaWE=', 'ZGF2aXZpZW5kYQ==', 'YWxwaW5h',
  'YnVkd2Vpc2Vy', 'aGVpbmVrZW4=', 'Y2x1YiBjb2xvbWJpYQ==', 'bmVzdGxl', 'bWNkb25hbGQ=', 'YnVyZ2VyIGtpbmc=',
  'a2Zj', 'c3RhcmJ1Y2tz', 'ZnJpc2J5', 'c29ueQ==', 'bm9raWE=', 'aHVhd2Vp', 'eGlhb21p', 'ZmFjZWJvb2s=',
  'd2hhdHNhcHA=', 'aW5zdGFncmFt', 'dGlrdG9r', 'bmV0ZmxpeA==', 'c3BvdGlmeQ==', 'bWFzdGVyY2FyZA==', 'cm9sZXg=',
  'Y2FzaW8=', 'cmF5LWJhbg==', 'cmF5YmFu', 'b2FrbGV5', 'aHVtbWVs', 'YXNpY3M=', 'bWl6dW5v', 'c2tlY2hlcnM=',
  'ZHIuIG1hcnRlbnM=', 'Y2xhcmtz', 'aHVzaCBwdXBwaWVz', 'ZWNrbw==', 'aG9sbGlzdGVy', 'aCZt', 'YmVyc2hrYQ==',
  'cHVsbCZiZWFy', 'c3RyYWRpdmFyaXVz', 'YXJ0dXJvIGNhbGxl', 'b2ZmY29yc3M=', 'cHVudG8gYmxhbmNv', 'Y2hldnJvbGV0',
  'cmVuYXVsdA==', 'bWF6ZGE=', 'dG95b3Rh', 'dm9sa3N3YWdlbg==', 'eWFtYWhh', 'c3V6dWtp', 'Ym13', 'ZmVycmFyaQ==',
  'aHl1bmRhaQ==', 'bmlzc2Fu', 'emlwcG8=', 'cmVkIGJ1bGw=', 'Z2F0b3JhZGU=', 'ZmFudGE=', 'bmVzY2FmZQ==',
  'Y29sZ2F0ZQ==', 'dGV4YWNv', 'cG9rZXI='
]);
// Estas también son palabras de todos los días o de código (la fila de un menú, el mango de un paraguas):
// solo cuentan pegadas a una prenda, a un objeto de la calle o a la palabra marca.
const COMMON_WORDS = uncode([
  'ZmlsYQ==', 'Y29udmVyc2U=', 'ZGllc2Vs', 'ZXhpdG8=', 'Y2xhcm8=', 'YWd1aWxh', 'aG9uZGE=', 'Y29yb25h',
  'bWFuZ28=', 'c3ByaXRl', 'c2hlbGw=', 'Z2Fw', 'cG9sbw==', 'dG9tbXk=', 'bWVyY2VkZXM=', 'Y29sdW1iaWE=',
  'cGF0YWdvbmlh', 'dmlzYQ==', 'Zm9yZA==', 'Ymlj', 'a2lh', 'YXBwbGU=', 'Z29vZ2xl', 'bW9iaWw=', 'YXJh', 'b21h',
  'Z2Vm', 'dmVsZXo='
]);
// La estación de servicio viene de antes de la gente y se queda como está; en ningún otro lugar vale.
const ALLOWED = new Map([['src/world/bogota/GasStation.js', uncode(['dGV4YWNv'])]]);
const TEXT_FILE = /\.(?:js|mjs|css|html|json|md|txt|glsl)$/;
const ROOT = new URL('../', import.meta.url);

function textFilesUnder(dir) {
  return readdirSync(new URL(dir, ROOT), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return textFilesUnder(path);
    return TEXT_FILE.test(entry.name) ? [path] : [];
  });
}
const plain = (text) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const escaped = (name) => plain(name).replace(/[-/\\^$*+?.()|[\]{}&]/g, '\\$&');
const WORD_END = '(?:s|es)?(?![a-z0-9_])';
const STREET_THING = '(?:unos|unas|tenis|zapatos?|zapatillas?|botas?|gorras?|sacos?|camisetas?|camisas?|chaquetas?|buzos?|pantalon(?:es)?|jeans?|morral(?:es)?|bolsos?|bolsas?|maletin(?:es)?|gaseosas?|marcas?)';
const brandPatterns = [
  ...BRANDS.map(name => [name, new RegExp(`(?<![a-z0-9_])${escaped(name)}${WORD_END}`)]),
  ...COMMON_WORDS.map(name => [name, new RegExp(`(?<![a-z0-9_])${STREET_THING}\\s+(?:(?:de|la|el|marca)\\s+)*${escaped(name)}${WORD_END}`)])
];
const brandsIn = (text, path = '') => {
  const allowed = ALLOWED.get(path) ?? [];
  const lowered = plain(text);
  return brandPatterns.filter(([name, pattern]) => !allowed.includes(name) && pattern.test(lowered)).map(([name]) => name);
};

test('ni el código, ni la documentación, ni las guías de piezas nombran una marca, tampoco en plural', () => {
  const files = [
    ...textFilesUnder('src'), ...textFilesUnder('docs'), ...textFilesUnder('tools/personaje').filter(path => path.endsWith('.md')),
    'README.md', 'AGENTS.md'
  ];
  assert.ok(files.length > 200, `solo se revisaron ${files.length} archivos`);
  for (const path of files) assert.deepEqual(brandsIn(readFileSync(new URL(path, ROOT), 'utf8'), path), [], `${path} nombra una marca`);
});

test('la prueba de marcas ve plurales, acentos y mayúsculas, y no se confunde con palabras comunes', () => {
  const [first, second] = BRANDS, [common] = COMMON_WORDS, [excepted] = ALLOWED.get('src/world/bogota/GasStation.js');
  assert.deepEqual(brandsIn(`Lleva unos ${first.toUpperCase()} viejos`), [first]);
  assert.deepEqual(brandsIn(`dos pares de ${second}s`), [second]);
  assert.deepEqual(brandsIn(`la ${common} del menú`), [], 'una palabra común sola no es marca');
  assert.deepEqual(brandsIn(`una gorra ${common}`), [common]);
  assert.deepEqual(brandsIn(`un letrero ${excepted}`), [excepted], 'la excepción vale solo en su archivo');
  assert.deepEqual(brandsIn(`un letrero ${excepted}`, 'src/world/bogota/GasStation.js'), []);
});

test('las texturas del juego son las limpias: una exportación sin limpiar hace caer esto', () => {
  const table = JSON.parse(readFileSync(new URL('tools/personaje/texturas-limpias.json', ROOT), 'utf8'));
  for (const name of [
    'male_casualsuit02_diffuse.webp', 'male_casualsuit03_diffuse.webp', 'male_casualsuit05_diffuse.webp', 'male_casualsuit06_diffuse.webp',
    'female_casualsuit01_diffuse.webp', 'female_casualsuit02_diffuse.webp', 'male_worksuit01_diffuse.webp', 'shoes06_diffuse.webp', 'brown_eye.webp'
  ]) assert.ok(table[name], `${name} no está en la tabla`);
  for (const [name, { original, limpia }] of Object.entries(table)) {
    const bytes = readFileSync(new URL(`public/models/personaje/texturas/${name}`, ROOT));
    assert.notEqual(original, limpia, `${name}: la limpia no puede ser la original`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), limpia, `${name} no es la textura limpia: hay que correr limpiar_marcas.py`);
  }
});

test('el reparto depende de la zona: en El Cartucho casi todos viven de la calle y en los andenes hay de todo', () => {
  for (const [zone, table] of Object.entries(ZONE_WEIGHTS)) {
    const total = Object.values(table).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${zone} suma ${total}`);
    for (const id of Object.keys(table)) assert.ok(ARCHETYPES[id], `${zone}: ${id}`);
  }
  const share = (zone) => {
    const random = seeded(11), counts = {};
    for (let i = 0; i < 4000; i++) { const id = pickArchetype(zone, random); counts[id] = (counts[id] ?? 0) + 1; }
    return Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, n / 4000]));
  };
  const cartucho = share('cartucho');
  assert.ok(cartucho.habitante + cartucho.reciclador > .7, 'El Cartucho es de quien vive en la calle');
  assert.equal(cartucho.oficinista ?? 0, 0);
  const andenes = share('andenes');
  assert.equal(Object.keys(andenes).length, 8, 'en el andén se ve de todo');
  assert.ok(Math.max(...Object.values(andenes)) < .25, 'nadie domina el andén');
  assert.ok(andenes.habitante + andenes.reciclador < .3);
  assert.ok(share('chapinero').oficinista > share('barrio').oficinista);
  assert.ok(share('barrio').senora > share('chapinero').oficinista - .2);
  assert.deepEqual(share('zona-que-no-existe'), share('andenes'));
});

test('los tonos siguen el contrato con el material y sin ellos no aparece nada', () => {
  const random = seeded(3);
  for (const id of ids) for (let i = 0; i < 60; i++) {
    const { tonos, desgaste } = rollPerson(id, { random }).real;
    assert.match(tonos.arriba, HEX);
    assert.match(tonos.abajo, HEX);
    assert.match(tonos.patronColor, HEX);
    assert.ok(['liso', 'rayas', 'franela'].includes(tonos.patron));
    assert.ok(Number.isInteger(desgaste) && desgaste >= 0 && desgaste <= 2);
  }
  // Sin tonos, ni el jugador ni un viejo guardado se inventan colores, talla ni accesorios.
  const plain = normalizeReal(catalog, { sexo: 'hombre', edad: 'adulto', ropa: 'chaqueta' });
  assert.equal(plain.tonos, undefined);
  assert.equal(plain.talla, undefined);
  assert.deepEqual(plain.accesorios ?? [], []);
});

test('quien vive en la calle se ve gastado y el oficinista no', () => {
  const random = seeded(5);
  for (let i = 0; i < 60; i++) {
    assert.equal(rollPerson('habitante', { random }).real.desgaste, 2);
    assert.equal(rollPerson('oficinista', { random }).real.desgaste, 0);
    assert.ok(rollPerson('reciclador', { random }).real.accesorios.some(item => item.id === 'costal'), 'el reciclador lleva su costal');
  }
  const look = personLook(rollPerson('habitante', { random }));
  assert.equal(look.desgaste, 2);
  assert.equal(look.real.desgaste, 2);
});

test('posturas, pasos y frases existen: nadie pide lo que el cuerpo no sabe hacer', () => {
  for (const [id, spec] of Object.entries(ARCHETYPES)) {
    assert.ok(GAIT_FAMILIES[spec.andar], `${id}: paso ${spec.andar}`);
    for (const stance of Object.keys(spec.paradas)) assert.ok(stance === SEARCH_ACTION || STANCE_NAMES.includes(stance), `${id}: ${stance}`);
    for (const stance of Object.keys(spec.marcha)) assert.ok(STANCE_NAMES.includes(stance), `${id}: ${stance}`);
    if (spec.lluvia) assert.ok(STANCE_NAMES.includes(spec.lluvia), `${id}: ${spec.lluvia}`);
    assert.ok(spec.frases.length > 0, id);
    for (const { opciones } of spec.accesorios) for (const item of opciones) assert.ok(isStreetProp(item.id), `${id}: ${item.id}`);
    const [low, high] = spec.velocidad;
    assert.ok(low > .5 && high < 1.7 && low < high, `${id}: velocidad`);
  }
  for (const stance of LOW_STANCES) assert.ok(STANCE_NAMES.includes(stance), stance);
});

test('la mano ocupada manda: no se cruza de brazos con un maletín ni abre un paraguas con el bastón', () => {
  const both = ['bolsillos', 'brazos-cruzados', 'manos-atras', 'hablar', 'fumar-quieto', 'atender', 'barriga', 'frotarse', SEARCH_ACTION];
  const right = ['telefono', 'celular', 'paraguas', 'cubrirse', 'nariz', 'rascarse'];
  const random = seeded(9);
  let seen = 0;
  for (const id of ids) for (let i = 0; i < 200; i++) {
    const person = rollPerson(id, { random });
    const carried = person.real.accesorios.map(item => item.id);
    if (carried.includes('maletin') || carried.includes('bolsa')) {
      seen++;
      assert.equal(person.style?.carry, 'izquierda');
      for (const stance of both) assert.ok(!(stance in person.paradas) && !(stance in person.marcha), `${id}: ${stance} con la izquierda ocupada`);
    }
    if (carried.includes('baston-calle')) {
      seen++;
      assert.equal(person.style?.carry, 'derecha');
      assert.equal(person.paraguas, null);
      assert.equal(person.nariz, false);
      for (const stance of [...both, ...right]) assert.ok(!(stance in person.paradas), `${id}: ${stance} con el bastón`);
    }
  }
  assert.ok(seen > 50, 'la prueba de verdad vio gente cargando');
});

test('quien se sienta o duerme no sostiene nada y en la banca conserva la talla con la que se midió', () => {
  const random = seeded(13);
  for (const id of ids) for (let i = 0; i < 40; i++) {
    const person = rollPerson(id, { random, sinCarga: true, tallaFija: true });
    for (const item of person.real.accesorios) assert.equal(item.id, 'casco');
    assert.deepEqual(person.real.talla, { alto: 1, ancho: 1 });
  }
});

test('el casco no va con melena ni con sombrero', () => {
  const random = seeded(17);
  let cascos = 0;
  for (let i = 0; i < 400; i++) {
    const { real } = rollPerson('obrero', { random });
    if (!real.accesorios.some(item => item.id === 'casco')) continue;
    cascos++;
    assert.equal(real.cabeza, 'sin-sombrero');
    assert.ok(['corto', 'rapado', 'calvo'].includes(real.pelo));
  }
  assert.ok(cascos > 100);
});

test('las tallas van por persona y dentro de lo que el cuerpo aguanta', () => {
  const random = seeded(19);
  const altos = new Set();
  for (const id of ids) for (let i = 0; i < 80; i++) {
    const { alto, ancho } = rollPerson(id, { random }).real.talla;
    assert.ok(alto >= .94 && alto <= 1.06, `${id}: alto ${alto}`);
    assert.ok(ancho >= .94 && ancho <= 1.1, `${id}: ancho ${ancho}`);
    altos.add(alto);
  }
  assert.ok(altos.size > 100, 'no son todos iguales');
  assert.deepEqual(normalizeTalla({ alto: 3, ancho: .2 }), { alto: 1.06, ancho: .94 });
  assert.deepEqual(normalizeTalla({ alto: Number.NaN }), { alto: 1, ancho: 1 });
  assert.equal(normalizeTalla(null), null);
  // El jugador pasa sin talla y se queda sin ella; una talla absurda no sale del rango.
  assert.equal(normalizeReal(catalog, { sexo: 'mujer' }).talla, undefined);
  assert.deepEqual(normalizeReal(catalog, { sexo: 'mujer', talla: { alto: 9, ancho: 9 } }).talla, { alto: 1.06, ancho: 1.1 });
});

test('elegir parada y marcha respeta las tablas de cada persona', () => {
  const random = seeded(23);
  const person = rollPerson('oficinista', { random });
  const stops = new Set();
  for (let i = 0; i < 300; i++) stops.add(pickStop(person, random));
  for (const stance of stops) assert.ok(stance in person.paradas);
  assert.ok(stops.size > 2);
  for (let i = 0; i < 300; i++) {
    const walking = pickWalk(person, random);
    assert.ok(walking === null || walking in person.marcha);
  }
  assert.equal(pickStop({ paradas: {} }, random), null);
  assert.equal(pickWalk({ marcha: {} }, random), null);
});
