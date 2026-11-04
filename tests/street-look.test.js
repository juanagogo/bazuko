import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARCHETYPES, SHOE_TONES, SKIN_CLEARANCE, UNCOVERED_GARMENTS, garmentAllowed, rollPerson, skinDistance } from '../src/character/archetypes.js';
import { SKIN_ALBEDO } from '../src/character/look.js';
import { FAR_ACCESSORIES, attachStreetProps, swayStreetProps } from '../src/character/props.js';
import { createRealisticCharacter, normalizeReal, optionsFor, randomReal } from '../src/character/RealisticCharacter.js';
import { streetSkinColor } from '../src/character/streetMaterials.js';

const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(models, 'personaje/catalogo.json')));
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const everyone = (rounds = 1500) => Object.keys(ARCHETYPES).flatMap((id, n) => {
  const random = seeded(n * 7919 + 13);
  return Array.from({ length: rounds }, () => rollPerson(id, { random }));
});
const people = everyone();

test('nadie viste un tono que de lejos se confunda con su piel', () => {
  // El último, una blusa coral: a 20 m se fundía con brazos y cuello en piel clara aunque pasara la distancia.
  for (const hex of ['#a88a6a', '#b58b7e', '#8c6f4c', '#7a5a45', '#b5655a']) {
    for (const [id, spec] of Object.entries(ARCHETYPES)) {
      assert.ok(!spec.tonos.arriba.includes(hex) && !spec.tonos.abajo.includes(hex), `${id} volvió a vestir ${hex}`);
    }
  }
  // Toda lista deja al menos un tono libre con cualquier piel: el filtro nunca se queda sin opciones.
  for (const [id, { tonos }] of Object.entries(ARCHETYPES)) {
    for (let piel = 0; piel < SKIN_ALBEDO.length; piel++) {
      for (const list of [tonos.arriba, tonos.abajo, tonos.patronColor ?? tonos.abajo]) {
        assert.ok(list.some(hex => skinDistance(hex, piel) >= SKIN_CLEARANCE), `${id}, piel ${piel}: ${list}`);
      }
    }
  }
  for (const { arquetipo, piel, real: { tonos } } of people) {
    assert.ok(skinDistance(tonos.arriba, piel) >= SKIN_CLEARANCE, `${arquetipo}, piel ${piel}: arriba ${tonos.arriba}`);
    assert.ok(skinDistance(tonos.abajo, piel) >= SKIN_CLEARANCE, `${arquetipo}, piel ${piel}: abajo ${tonos.abajo}`);
    assert.ok(skinDistance(tonos.patronColor, piel) >= SKIN_CLEARANCE, `${arquetipo}, piel ${piel}: patrón ${tonos.patronColor}`);
  }
});

test('las prendas se siguen repartiendo: el filtro de tono no deja a un oficio con un solo color', () => {
  for (const id of Object.keys(ARCHETYPES)) {
    const mine = people.filter(person => person.arquetipo === id);
    assert.ok(new Set(mine.map(person => person.real.tonos.arriba)).size >= Math.min(3, ARCHETYPES[id].tonos.arriba.length), id);
  }
});

test('ningún cuerpo joven lleva prendas que dejen al aire el torso o las piernas, ni en la calle, ni en el creador, ni en una partida guardada', () => {
  assert.deepEqual(ARCHETYPES.estudiante.ropa.mujer, ['blusa', 'blusa', 'saco', 'saco']);
  assert.ok(ARCHETYPES.estudiante.alto[0] >= 1, 'las estudiantes se leen como gente adulta');
  const young = people.filter(person => person.real.edad === 'joven');
  assert.ok(young.length > 500, `solo ${young.length} jóvenes`);
  for (const { arquetipo, real } of young) {
    assert.ok(real.ropa, `${arquetipo}: se quedó sin prenda`);
    assert.ok(!UNCOVERED_GARMENTS.has(real.ropa), `${arquetipo}: ${real.ropa}`);
  }
  for (const sexo of ['hombre', 'mujer']) {
    for (const ropa of UNCOVERED_GARMENTS) {
      if (!optionsFor(catalog, 'ropa', sexo).some(option => option.id === ropa)) continue;
      const saved = normalizeReal(catalog, { sexo, edad: 'joven', ropa });
      assert.ok(garmentAllowed(saved.ropa, 'joven'), `${sexo}: una partida guardada con ${ropa} se cuela: ${saved.ropa}`);
      assert.equal(normalizeReal(catalog, { sexo, edad: 'adulto', ropa }).ropa, ropa, 'en un adulto queda como estaba');
    }
    for (let i = 0; i < 300; i++) {
      const real = randomReal(catalog, { sexo });
      assert.ok(garmentAllowed(real.ropa, real.edad), `al azar: ${real.edad} con ${real.ropa}`);
    }
  }
});

// Lee la malla del cuerpo tal como la guarda el archivo.
function bodyMesh(id) {
  const folder = path.join(models, 'personaje', id);
  const file = JSON.parse(readFileSync(path.join(folder, 'cuerpo.gltf')));
  const bytes = readFileSync(path.join(folder, file.buffers[0].uri));
  const primitive = file.meshes.find(mesh => mesh.name === 'base').primitives[0];
  const SIZE = { SCALAR: 1, VEC3: 3 };
  const read = (at) => {
    const accessor = file.accessors[at], start = bytes.byteOffset + file.bufferViews[accessor.bufferView].byteOffset + (accessor.byteOffset ?? 0);
    const Type = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[accessor.componentType];
    const count = accessor.count * SIZE[accessor.type];
    return new Type(bytes.buffer.slice(start, start + count * Type.BYTES_PER_ELEMENT));
  };
  return { vid: read(primitive.attributes._VID), position: read(primitive.attributes.POSITION), index: read(primitive.indices) };
}

/** Qué parte del torso y de las piernas queda a la vista con esa prenda: el cuerpo se recorta por triángulos, como en el juego. */
function skinShown({ vid, position, index }, hidden) {
  let low = Infinity, high = -Infinity;
  for (let i = 1; i < position.length; i += 3) { low = Math.min(low, position[i]); high = Math.max(high, position[i]); }
  const height = high - low, gone = new Set(hidden), zones = { torso: [0, 0], piernas: [0, 0] };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < index.length; i += 3) {
    const corners = [index[i], index[i + 1], index[i + 2]];
    a.fromArray(position, corners[0] * 3); b.fromArray(position, corners[1] * 3); c.fromArray(position, corners[2] * 3);
    const x = (a.x + b.x + c.x) / 3, up = ((a.y + b.y + c.y) / 3 - low) / height;
    if (Math.abs(x) > .19 * height / 1.7 * 1.1 * 1.6) continue; // Los brazos, en la pose de reposo, caen fuera.
    const zone = up > .53 && up < .8 && Math.abs(x) < .19 * height / 1.7 * 1.1 ? zones.torso : up > .06 && up <= .53 ? zones.piernas : null;
    if (!zone) continue;
    const area = c.sub(b).cross(a.sub(b)).length() / 2;
    zone[0] += area;
    if (!corners.some(corner => gone.has(Math.round(vid[corner])))) zone[1] += area;
  }
  return { torso: zones.torso[1] / zones.torso[0], piernas: zones.piernas[1] / zones.piernas[0] };
}

test('la lista de prendas descubiertas está completa: se mide con la piel que de verdad queda a la vista', () => {
  for (const body of catalog.cuerpos.filter(({ edad }) => edad === 'joven')) {
    const mesh = bodyMesh(body.id);
    for (const { id } of optionsFor(catalog, 'ropa', body.sexo)) {
      const piece = body.piezas[id];
      if (!piece?.file) continue;
      const { torso, piernas } = skinShown(mesh, piece.oculta);
      if (UNCOVERED_GARMENTS.has(id) && id !== 'rota') assert.ok(torso > .2 || piernas > .2, `${body.id}, ${id} ya no descubre nada: torso ${torso}, piernas ${piernas}`);
      if (!UNCOVERED_GARMENTS.has(id)) assert.ok(torso < .05 && piernas < .05, `${body.id}, ${id} deja al aire torso ${torso.toFixed(3)}, piernas ${piernas.toFixed(3)}`);
    }
  }
  // La misma medida sin recorte: si la cuenta se dañara, todo saldría cubierto.
  const bare = skinShown(bodyMesh('mujer-joven'), []);
  assert.ok(bare.torso > .99 && bare.piernas > .99, JSON.stringify(bare));
});

test('el zapato de cuero sale negro, café oscuro o gris, y solo ese zapato lleva tinte', () => {
  const chroma = (hex) => {
    const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  for (const hex of SHOE_TONES) {
    assert.ok(chroma(hex) <= 26, `${hex} tiene color de más`);
    assert.ok(parseInt(hex.slice(1, 3), 16) < 90, `${hex} es muy claro`);
  }
  const shod = people.filter(person => person.real.calzado === 'zapatos');
  assert.ok(shod.length > 100);
  for (const { real } of shod) assert.ok(SHOE_TONES.includes(real.tonos.calzado), real.tonos.calzado);
  for (const { real } of people) if (real.calzado !== 'zapatos') assert.equal(real.tonos.calzado, undefined);
  const saved = normalizeReal(catalog, { sexo: 'hombre', edad: 'adulto', calzado: 'zapatos', tonos: { arriba: '#223344', abajo: '#556677', calzado: '#26201d' } });
  assert.equal(saved.tonos.calzado, '#26201d', 'el tinte sobrevive a normalizar');
  assert.equal(normalizeReal(catalog, { sexo: 'hombre', edad: 'adulto', calzado: 'zapatos', tonos: { arriba: '#223344', abajo: '#556677', calzado: 'naranja' } }).tonos?.calzado, undefined, 'lo que no es un color no entra');
});

test('el pelo rubio solo sale en piel clara y el cobrizo nunca en la más oscura', () => {
  const RUBIO = 4, COBRIZO = 3;
  for (const { piel, peloColor, arquetipo } of people) {
    assert.ok(peloColor !== RUBIO || piel < 3, `${arquetipo}: rubio con piel ${piel}`);
    assert.ok(peloColor !== COBRIZO || piel < 5, `${arquetipo}: cobrizo con piel ${piel}`);
  }
});

test('las pieles oscuras reciben luz suficiente para que se les vea la cara, y siguen en orden de clara a oscura', () => {
  const light = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
  const shades = SKIN_ALBEDO.map(light);
  shades.reduce((previous, shade) => { assert.ok(shade < previous, `${shades}`); return shade; });
  assert.ok(shades[4] >= .1, `piel 4: ${shades[4]}`);
  assert.ok(shades[5] >= .07, `piel 5: ${shades[5]}`);
  assert.ok(shades[4] - shades[5] > .02, 'no son la misma piel');
});

test('el sol y el desgaste de la cara pesan menos cuanto más oscura es la piel', async () => {
  const character = await createRealisticCharacter({ desgaste: 2, real: { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'ninguna', ropa: 'camisa', calzado: 'tenis', cabeza: 'sin-sombrero', desgaste: 2 } }, { lod: false });
  let skin = null;
  character.group.traverse(node => { if (node.isSkinnedMesh && node.material.userData.streetSurface === 'skin') skin = node; });
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  skin.material.onBeforeCompile(shader, {});
  const code = shader.fragmentShader;
  const ramp = code.match(/float weathered = uStreetWear \* mix\(([\d.]+), 1\., smoothstep\(([\d.]+), ([\d.]+), skinLum\)\);/);
  assert.ok(ramp, 'el desgaste de la cara no mira el tono');
  assert.match(code, /sun \* \(\.22 \+ \.4 \* weathered\)/, 'el sol de altura usa ese desgaste');
  assert.match(code, /face \* weathered \* \.7/, 'y también el tono de la cara');
  const [floor, from, to] = ramp.slice(1).map(Number);
  assert.ok(floor < .5, `en la piel más oscura pesa menos de la mitad: ${floor}`);
  const weight = (tone, body) => {
    const { r, g, b } = streetSkinColor(tone, body);
    const x = Math.min(1, Math.max(0, (.2126 * r + .7152 * g + .0722 * b - from) / (to - from)));
    return floor + (1 - floor) * x * x * (3 - 2 * x);
  };
  for (const body of ['hombre-joven', 'hombre-adulto', 'hombre-mayor', 'mujer-joven', 'mujer-adulta', 'mujer-mayor']) {
    assert.ok(weight(5, body) < .55, `piel 5, ${body}: ${weight(5, body)}`);
    assert.ok(weight(1, body) > .95, `la piel clara se curte igual, ${body}: ${weight(1, body)}`);
    for (let tone = 1; tone < 6; tone++) assert.ok(weight(tone, body) <= weight(tone - 1, body) + 1e-9, `${body}: tono ${tone}`);
  }
  character.dispose();
});

function skeleton() {
  const root = new THREE.Group(), bones = new Map();
  for (const [name, y] of [['mixamorig:Spine2', 1.2], ['mixamorig:Neck', 1.45], ['mixamorig:Head', 1.5], ['mixamorig:LeftHand', 1]]) {
    const bone = new THREE.Bone();
    bone.position.y = y;
    root.add(bone);
    bones.set(name, bone);
  }
  return { root, bones, holds: { 'cargar-izquierda': { boneName: 'mixamorig:LeftHand', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1), height: 1 } } };
}
const carried = (id, sexo = 'hombre', color = '#55503f') => {
  const { root, bones, holds } = skeleton();
  return attachStreetProps(root, bones, [{ id, color }], holds, sexo)[0];
};
const boxOf = (geometry) => { geometry.computeBoundingBox(); return geometry.boundingBox; };

test('el costal y la bolsa tienen tamaño de cosa que se carga, y lo pequeño se queda pequeño', () => {
  const sack = boxOf(carried('costal').geometry).getSize(new THREE.Vector3());
  assert.ok(sack.x > .3 && sack.x < .42, `costal de ancho ${sack.x}`);
  assert.ok(sack.y > .45 && sack.y < .56, `costal de alto ${sack.y}`);
  const bag = boxOf(carried('bolsa').geometry).getSize(new THREE.Vector3());
  assert.ok(bag.x < .25 && bag.y < .3 && bag.z < .26, `bolsa de ${bag.x} x ${bag.y} x ${bag.z}`);
  assert.ok(bag.x > .12 && bag.z > .12, 'tampoco un sobre');
});

test('lo que se balancea gira con el paso y vuelve a su sitio, sin mover nada más ni repartir mallas por persona', () => {
  for (const id of ['costal', 'bolsa']) {
    const mesh = carried(id), start = mesh.position.clone(), { rest } = mesh.userData.sway;
    const turns = [];
    for (let i = 0; i < 16; i++) {
      swayStreetProps([mesh], i / 16, 1);
      turns.push(mesh.quaternion.angleTo(rest));
      assert.ok(mesh.position.equals(start), `${id} se movió`);
    }
    assert.ok(Math.max(...turns) > .02, `${id} no se balancea`);
    assert.ok(Math.max(...turns) < .22, `${id} se sacude: ${Math.max(...turns)} rad`);
    swayStreetProps([mesh], .3, 0);
    assert.ok(mesh.quaternion.angleTo(rest) < 1e-6, `${id} no vuelve a su sitio`);
    const other = carried(id);
    assert.equal(other.geometry, mesh.geometry, `${id}: geometría por persona`);
    assert.equal(other.material, mesh.material, `${id}: material por persona`);
  }
  for (const id of ['maletin', 'morral', 'bolso', 'casco', 'baston-calle']) assert.equal(carried(id)?.userData.sway, undefined, id);
});

test('morral y costal se ajustan a la espalda de una mujer con su propia geometría, compartida entre todas', () => {
  for (const id of ['morral', 'costal']) {
    const man = carried(id, 'hombre').geometry, woman = carried(id, 'mujer').geometry;
    assert.notEqual(man, woman, id);
    assert.equal(carried(id, 'mujer').geometry, woman, id);
    assert.ok(Math.abs(boxOf(woman).min.z - boxOf(man).min.z - .045) < .005, `${id}: ${boxOf(woman).min.z} frente a ${boxOf(man).min.z}`);
  }
});

// Con los cuerpos reales: es donde se ve si un objeto pasa de la cabeza.
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const originalFetch = globalThis.fetch;
async function parseAsset(url) {
  const file = path.join(models, url.replace(/^\/models\//, ''));
  const parser = new GLTFLoader();
  parser.register(() => ({ name: 'CHECK_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  if (file.endsWith('.glb')) {
    const bytes = readFileSync(file);
    return parser.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }
  const json = JSON.parse(readFileSync(file));
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(name => name !== 'EXT_texture_webp');
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  for (const texture of json.textures ?? []) {
    texture.source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    delete texture.extensions;
  }
  for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + readFileSync(path.join(path.dirname(file), buffer.uri)).toString('base64');
  return parser.parseAsync(JSON.stringify(json), '');
}

test.before(() => {
  mock.method(globalThis, 'fetch', (url, ...rest) => url === '/models/personaje/catalogo.json'
    ? Promise.resolve(new Response(readFileSync(path.join(models, 'personaje/catalogo.json'))))
    : originalFetch(url, ...rest));
  mock.method(GLTFLoader.prototype, 'loadAsync', parseAsset);
  mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => new THREE.Texture());
});
test.after(() => mock.restoreAll());

test('el zapato de cuero se pinta del tono de esa persona, sin programa propio; el tenis conserva su textura', async () => {
  const shoes = async (calzado, tonos) => {
    const character = await createRealisticCharacter({ real: { sexo: 'hombre', edad: 'adulto', pelo: 'calvo', barba: 'ninguna', ropa: 'camisa', calzado, cabeza: 'sin-sombrero', tonos } });
    let found = null;
    character.group.traverse(node => { if (node.isSkinnedMesh && node.material.userData.streetSurface === 'shoes') found = node; });
    const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
    found.material.onBeforeCompile(shader, {});
    const result = { uniforms: shader.uniforms, key: found.material.customProgramCacheKey() };
    character.dispose();
    return result;
  };
  const clothes = { arriba: '#223344', abajo: '#556677' };
  const black = await shoes('zapatos', { ...clothes, calzado: '#1d1c1c' }), grey = await shoes('zapatos', { ...clothes, calzado: '#4a4a4b' });
  assert.equal(black.uniforms.uStreetTint.value, 1);
  assert.equal(`#${black.uniforms.uStreetTop.value.getHexString()}`, '#1d1c1c');
  assert.equal(`#${grey.uniforms.uStreetTop.value.getHexString()}`, '#4a4a4b');
  assert.equal(black.key, grey.key, 'el mismo programa para todos los tonos');
  const plain = await shoes('zapatos', undefined);
  assert.equal(plain.uniforms.uStreetTint.value, 1, 'quien no tiene tono tampoco lleva el naranja');
  const sneakers = await shoes('tenis', { ...clothes, calzado: '#1d1c1c' });
  assert.equal(sneakers.uniforms.uStreetTint.value, 0);
  assert.equal(sneakers.key, black.key, 'el mismo programa también para el tenis');
});

test('el costal puesto en cada cuerpo no pasa de la cabeza, y al andar se mece', async () => {
  for (const [sexo, edad] of [['hombre', 'adulto'], ['hombre', 'mayor'], ['mujer', 'adulto'], ['mujer', 'mayor']]) {
    const character = await createRealisticCharacter({ real: { sexo, edad, pelo: 'calvo', barba: 'ninguna', ropa: 'saco', calzado: 'tenis', cabeza: 'sin-sombrero', accesorios: [{ id: 'costal', color: '#55503f' }] } });
    character.group.updateMatrixWorld(true);
    const sack = character.group.getObjectByName('prop-costal');
    assert.ok(sack, `${sexo} ${edad} sin costal`);
    const top = new THREE.Box3().setFromObject(sack).max.y;
    let skin = null;
    character.group.traverse(node => { if (node.isSkinnedMesh && node.material.userData.streetSurface === 'skin') skin = node; });
    skin.geometry.computeBoundingBox();
    const head = new THREE.Box3().copy(skin.geometry.boundingBox).applyMatrix4(skin.matrixWorld).max.y;
    assert.ok(top < head - .02, `${sexo} ${edad}: el costal llega a ${top.toFixed(3)} y la cabeza a ${head.toFixed(3)}`);
    const rest = sack.userData.sway.rest;
    for (let i = 0; i < 30; i++) character.update(1 / 30, { speed: 0 });
    assert.ok(sack.quaternion.angleTo(rest) < .01, `${sexo} ${edad}: quieto no se mece (${sack.quaternion.angleTo(rest)})`);
    let swing = 0;
    for (let i = 0; i < 90; i++) {
      character.update(1 / 30, { speed: 1, movement: { speed: 1 } });
      swing = Math.max(swing, sack.quaternion.angleTo(rest));
    }
    assert.ok(swing > .02, `${sexo} ${edad}: andando no se mece (${swing})`);
    character.dispose();
  }
});

test('el modelo liviano solo lleva los accesorios que se notan de lejos; el completo, todos', async () => {
  const real = { sexo: 'hombre', edad: 'adulto', pelo: 'calvo', barba: 'ninguna', ropa: 'camisa', calzado: 'tenis', cabeza: 'sin-sombrero', accesorios: [{ id: 'casco', color: '#d8a020' }, { id: 'morral', color: '#223344' }] };
  const names = async (options) => {
    const character = await createRealisticCharacter({ real, accesorios: ['gorra', 'baston'] }, options);
    const found = [];
    character.group.traverse(node => { if (/^prop-/.test(node.name)) found.push(node.name); });
    character.dispose();
    return found.sort();
  };
  FAR_ACCESSORIES.delete('casco');
  try {
    const far = await names({ lod: true }), near = await names({});
    assert.ok(far.includes('prop-morral') && far.includes('prop-gorra'), `liviano: ${far}`);
    assert.ok(!far.includes('prop-casco'), `lo que no está en la lista no va en el liviano: ${far}`);
    assert.ok(!far.includes('prop-baston'), `liviano: ${far}`);
    assert.ok(near.includes('prop-casco') && near.includes('prop-morral'), `completo: ${near}`);
  } finally { FAR_ACCESSORIES.add('casco'); }
});

test('la sombra pintada en el asiento del pantalón se apaga con la ropa nueva y vuelve con el desgaste', async () => {
  const character = await createRealisticCharacter({ desgaste: 0, real: { sexo: 'mujer', edad: 'adulto', pelo: 'cola', barba: 'ninguna', ropa: 'blusa', calzado: 'tenis', cabeza: 'sin-sombrero', desgaste: 0, tonos: { arriba: '#223344', abajo: '#556677' } } });
  let cloth = null;
  character.group.traverse(node => { if (node.isSkinnedMesh && node.material.userData.streetSurface === 'fabric') cloth = node; });
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  cloth.material.onBeforeCompile(shader, {});
  const seat = shader.fragmentShader.match(/float seat = ([^;]+);/);
  assert.ok(seat, 'la tela no trata el asiento');
  assert.match(seat[1], /below/, 'solo en lo de abajo');
  assert.match(seat[1], /1\. - uStreetWear/, 'y según el desgaste');
  character.dispose();
});
