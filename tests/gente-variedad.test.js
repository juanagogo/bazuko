import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { ARCHETYPES, ZONE_WEIGHTS, pickArchetype, rollPerson } from '../src/character/archetypes.js';
import { PALETTES, SKIN_ALBEDO } from '../src/character/look.js';
import {
  CONTEXTURAS, ETIQUETAS, NINO, POBLACION, RASGOS, RASGOS_CREADOR, RASGOS_IDS, TALLA, estatura, hashSeed, normalizeRostro,
  rollAscendencia, seededRandom
} from '../src/character/people.js';
import { buildFaceGeometry } from '../src/character/faceParts.js';

const crowd = (count, seed = 7) => {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => rollPerson(pickArchetype('andenes', random), { seed: `gente:${i}` }));
};
const people = crowd(4000);
const share = (list, test) => list.filter(test).length / list.length;

test('la misma semilla da la misma persona, y semillas distintas dan personas distintas', () => {
  for (const id of Object.keys(ARCHETYPES)) {
    const again = JSON.stringify(rollPerson(id, { seed: 'a' }));
    assert.equal(again, JSON.stringify(rollPerson(id, { seed: 'a' })), id);
    assert.notEqual(again, JSON.stringify(rollPerson(id, { seed: 'b' })), id);
  }
  assert.equal(hashSeed('bogota:3'), hashSeed('bogota:3'));
  assert.notEqual(hashSeed('bogota:3'), hashSeed('bogota:4'));
  const random = seededRandom(5);
  assert.deepEqual([random(), random()], [seededRandom(5)(), (() => { const r = seededRandom(5); r(); return r(); })()]);
});

test('toda la gente sale con rostro y talla dentro de los rangos, y los rasgos existen en el creador', () => {
  for (const person of people) {
    const { rostro, talla } = person.real;
    for (const [rasgo, ids] of Object.entries(RASGOS_IDS)) assert.ok(ids.includes(rostro[rasgo]), `${rasgo}: ${rostro[rasgo]}`);
    assert.ok(talla.alto >= TALLA.alto[0] && talla.alto <= TALLA.alto[1], `alto ${talla.alto}`);
    assert.ok(talla.ancho >= TALLA.ancho[0] && talla.ancho <= TALLA.ancho[1], `ancho ${talla.ancho}`);
    assert.ok(talla.cabeza >= TALLA.cabeza[0] && talla.cabeza <= TALLA.cabeza[1], `cabeza ${talla.cabeza}`);
    assert.ok(person.piel >= 0 && person.piel < PALETTES.piel.length && SKIN_ALBEDO[person.piel], `piel ${person.piel}`);
    assert.deepEqual(normalizeRostro(rostro), rostro);
  }
  for (const rasgo of RASGOS_CREADOR) assert.deepEqual(Object.keys(ETIQUETAS[rasgo]).sort(), [...RASGOS_IDS[rasgo]].sort(), `etiquetas de ${rasgo}`);
});

test('aparecen todas las variantes de cada rasgo, y todos los tonos de piel', () => {
  for (const [rasgo, ids] of Object.entries(RASGOS_IDS)) {
    for (const id of ids) {
      const found = people.some(person => person.real.rostro[rasgo] === id && (rasgo !== 'patillas' || person.sexo === 'hombre'));
      assert.ok(found, `nunca sale ${rasgo}: ${id}`);
    }
  }
  const tones = new Set(people.map(person => person.piel));
  for (let tone = 0; tone < PALETTES.piel.length; tone++) assert.ok(tones.has(tone), `nunca sale el tono ${tone}`);
});

test('contextura, estatura y edad: hay delgados, normales y robustos, bajos y altos, niños y mayores', () => {
  const adults = people.filter(person => !person.nino);
  for (const name of Object.keys(CONTEXTURAS)) {
    const part = share(adults, person => person.real.contextura === name);
    assert.ok(part > .12 && part < .58, `${name}: ${part}`);
  }
  const [thin, normal, heavy] = ['delgado', 'normal', 'robusto'].map(name => adults.filter(person => person.real.contextura === name));
  const mean = list => list.reduce((sum, person) => sum + person.real.talla.ancho, 0) / list.length;
  assert.ok(mean(thin) < .93 && mean(normal) > .93 && mean(normal) < 1.08 && mean(heavy) > 1.15, `${mean(thin)} ${mean(normal)} ${mean(heavy)}`);
  const heights = adults.map(person => person.real.talla.alto);
  assert.ok(Math.min(...heights) < .85 && Math.max(...heights) > 1.08, `${Math.min(...heights)} ${Math.max(...heights)}`);
  const short = share(adults, person => estatura(person.real.talla.alto) === 'baja');
  const tall = share(adults, person => estatura(person.real.talla.alto) === 'alta');
  assert.ok(short > .05 && short < .35 && tall > .05 && tall < .35, `bajos ${short}, altos ${tall}`);
  const kids = people.filter(person => person.nino);
  assert.ok(kids.length > 40, `${kids.length} niños`);
  for (const kid of kids) {
    assert.ok(kid.real.talla.alto >= NINO.alto[0] && kid.real.talla.alto <= NINO.alto[1]);
    assert.ok(kid.real.talla.cabeza >= NINO.cabeza[0], 'cabeza grande para el cuerpo');
    assert.equal(kid.real.barba, 'ninguna');
  }
  assert.ok(share(people, person => person.edad === 'mayor') > .08, 'hay mayores');
  const elderly = adults.filter(person => person.edad === 'mayor'), young = adults.filter(person => person.edad === 'adulto');
  const meanHeight = list => list.reduce((sum, person) => sum + person.real.talla.alto, 0) / list.length;
  assert.ok(meanHeight(elderly) < meanHeight(young), 'los mayores son un poco más bajos');
});

test('los tonos de piel cubren de muy clara a muy oscura, y cada ascendencia se reparte entre varios tonos', () => {
  const dark = new Set([4, 5, 10, 11]), light = new Set([0, 1, 6]);
  assert.ok(share(people, person => dark.has(person.piel)) > .1, 'pieles oscuras');
  assert.ok(share(people, person => light.has(person.piel)) > .15, 'pieles claras');
  assert.ok(share(people, person => !dark.has(person.piel) && !light.has(person.piel)) > .3, 'pieles medias');
  const random = seededRandom(3);
  for (const name of Object.keys(POBLACION)) {
    const tones = new Map();
    for (let i = 0; i < 1500; i++) {
      const { linaje, piel } = rollAscendencia(random, { sexo: 'mujer', edad: 'adulto', pesos: { [name]: 1 } });
      if (linaje.length === 1) tones.set(piel, (tones.get(piel) ?? 0) + 1);
    }
    assert.ok(tones.size >= 5, `${name} solo da ${tones.size} tonos`);
    assert.ok(Math.max(...tones.values()) / [...tones.values()].reduce((a, b) => a + b) < .5, `${name}: un solo tono domina`);
  }
});

test('ningún rasgo es de un solo grupo: toda variante tiene peso para toda ascendencia, y se reparte entre todas', () => {
  const random = seededRandom(9);
  for (const [rasgo, spec] of Object.entries(RASGOS)) {
    for (const [id, weight] of Object.entries(spec.base)) assert.ok(weight >= 1, `${rasgo}/${id} tiene piso`);
    for (const [name, extra] of Object.entries(spec)) {
      if (name === 'base') continue;
      for (const id of Object.keys(extra)) assert.ok(id in spec.base, `${rasgo}/${name}: ${id}`);
    }
  }
  for (const name of Object.keys(POBLACION)) {
    const seen = { nariz: new Set(), ojos: new Set(), boca: new Set() };
    for (let i = 0; i < 1500; i++) {
      const { rostro } = rollAscendencia(random, { sexo: 'hombre', edad: 'adulto', pesos: { [name]: 1 } });
      for (const rasgo of Object.keys(seen)) seen[rasgo].add(rostro[rasgo]);
    }
    for (const rasgo of Object.keys(seen)) assert.equal(seen[rasgo].size, RASGOS_IDS[rasgo].length, `${name}: ${rasgo}`);
  }
  // Y el reparto de la ciudad sí mezcla: hay quien tiene dos ascendencias.
  assert.ok(share(people, person => person.linaje.length === 2) > .25);
  assert.ok(Math.abs(Object.values(POBLACION).reduce((a, b) => a + b) - 1) < 1e-9);
});

test('el pelo crespo sale sobre todo en quien lo tiene por ascendencia, y el rubio nunca en piel que no le va', () => {
  const afro = people.filter(person => person.linaje[0][0] === 'afro' && person.linaje.length === 1 && person.real.pelo !== 'rapado' && person.real.pelo !== 'calvo');
  const asian = people.filter(person => person.linaje[0][0] === 'asiatica' && person.linaje.length === 1 && person.real.pelo !== 'rapado' && person.real.pelo !== 'calvo');
  assert.ok(share(afro, person => person.real.pelo === 'crespo') > .5, 'pelo crespo');
  assert.ok(share(asian, person => person.real.pelo === 'crespo') < .12);
  assert.ok(afro.length > 100 && asian.length > 40);
});

test('las caras no cuestan más de lo debido: cada variante es una malla chica y sale una sola por persona', () => {
  const frame = { u: .06, eyeR: .015, eyeFront: .01, eyeX: .03, noseY: -.04, noseZ: .03, mouthY: -.07, chinY: -.1, earX: .08, earY: -.025, earZ: -.05, depth: () => .02, side: () => .075 };
  const color = new THREE.Color('#a87a5a');
  const colors = { skin: color, lip: color, hair: color };
  let worst = 0;
  for (const person of people.slice(0, 600)) {
    const geometry = buildFaceGeometry(frame, person.real.rostro, colors);
    if (!geometry) continue;
    worst = Math.max(worst, geometry.index.count / 3);
    for (const value of geometry.attributes.position.array) assert.ok(Number.isFinite(value));
    assert.ok(geometry.attributes.color && !geometry.attributes.uv);
    geometry.dispose();
  }
  assert.ok(worst > 0 && worst < 1500, `${worst} triángulos`);
  const plain = buildFaceGeometry(frame, normalizeRostro({}), colors);
  assert.equal(plain, null, 'la cara de base no agrega nada');
});

test('las esquineras: de noche, mujeres adultas, con el contoneo, en pocas zonas y vestidas del catálogo', () => {
  const spec = ARCHETYPES.esquinera;
  assert.equal(spec.noche, true);
  assert.equal(spec.mujer, 1);
  assert.ok(!spec.edad.joven, 'ninguna es joven');
  for (const zone of Object.values(ZONE_WEIGHTS)) assert.equal(zone.esquinera, undefined, 'no salen del reparto al azar: Bogotá las pone en sus esquinas');
  const group = Array.from({ length: 300 }, (_, i) => rollPerson('esquinera', { seed: `e${i}` }));
  for (const person of group) {
    assert.equal(person.sexo, 'mujer');
    assert.ok(person.noche && person.arraigo > 0);
    assert.ok(person.style.caderas >= 1 && person.style.caderas <= 1.6, `caderas ${person.style.caderas}`);
    assert.ok(['short', 'blusa', 'sudadera'].includes(person.real.ropa), person.real.ropa);
    assert.equal(person.real.barba, 'ninguna');
    assert.equal(person.nino, false);
    assert.deepEqual(person.real.accesorios.filter(item => item.id !== 'bolso'), []);
  }
  assert.ok(group.some(person => person.real.ropa === 'short') && group.some(person => person.real.ropa === 'blusa'));
  assert.ok(new Set(group.map(person => person.piel)).size >= 5, 'cada una es distinta');
  for (const frase of spec.frases) assert.ok(!/—|–/.test(frase));
});
