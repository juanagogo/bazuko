// Los avisos de local comparten un atlas con el texto: cada aviso es un plano que apunta a su
// celda y lleva su color de fondo en los vértices, las celdas no se pisan entre sí y la ciudad
// pone los mismos avisos en los mismos sitios y colores que con una textura por aviso.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { rng } from '../src/world/bogota/textures.js';
// El original se carga antes de sustituirlo: sirve para comparar lo que pinta cada aviso.
import { signTexture as originalSignTexture } from '../src/utils/signs.js';

// Cada aviso con textura propia pasa por aquí; el lienzo de mentira no pinta nada.
const ownSigns = [];
mock.module('../src/utils/signs.js', { namedExports: {
  signTexture: options => { ownSigns.push(options); return new THREE.Texture(); }
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { AVISOS_GRANDES } = await import('../src/world/bogota/Locales.js');
const atlasModule = () => import('../src/utils/signAtlas.js');

function canvasDocument(shared) {
  return { createElement() {
    const calls = shared ?? [];
    const context = new Proxy({
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      translate: (...args) => calls.push(['translate', ...args]),
      fillText: (...args) => calls.push(['fillText', ...args])
    }, { get: (object, key) => object[key] ?? (() => {}) });
    return { width: 0, height: 0, getContext: () => context, calls };
  } };
}

function withDocument(doc, build) {
  const previous = globalThis.document;
  globalThis.document = doc;
  try { return build(); } finally { globalThis.document = previous; }
}

test('cada entrada del atlas tiene su celda, dentro de la imagen y sin pisar las demás', async () => {
  const { signTextAtlas } = await atlasModule();
  const entries = Array.from({ length: 32 }, (_, i) => ({ title: `LOCAL ${i}`, sub: 'SUB', fg: i % 2 ? '#fff3da' : '#26302e' }));
  const { texture, cells } = withDocument(canvasDocument(), () => signTextAtlas(entries, { w: 768, h: 192 }));
  assert.equal(cells.length, entries.length);
  assert.equal(texture.image.width, (768 + 64) * 4);
  assert.equal(texture.image.height, (192 + 16) * 8);
  for (const [u0, v0, u1, v1] of cells) {
    assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1 && u0 < u1 && v0 < v1);
    assert.ok(Math.abs((u1 - u0) / (v1 - v0) * texture.image.width / texture.image.height - 4) < 1e-9, 'la celda guarda la proporción 4:1');
  }
  // A lo ancho, 64 px entre dos avisos vecinos: vistos de lado, el filtro no alcanza el borde del otro.
  const width = texture.image.width;
  for (let i = 0; i + 1 < cells.length; i++) if (i % 4 !== 3) assert.equal(Math.round((cells[i + 1][0] - cells[i][2]) * width), 64);
  cells.forEach((a, i) => cells.slice(i + 1).forEach(b => {
    const overlap = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    assert.ok(!overlap, 'dos celdas se pisan');
  }));
});

test('un nombre largo o con tildes y eñes se escribe tal cual y no se sale de su celda', async () => {
  const { signTextAtlas } = await atlasModule();
  const title = 'PELUQUERÍA Y CAFETERÍA LA ÑAPA DEL SEÑOR ÁLVARO MUÑOZ', sub = 'ÚNICOS EN BOGOTÁ · AÑO 1985';
  const calls = [];
  const { cells } = withDocument(canvasDocument(calls), () =>
    signTextAtlas([{ title: 'A' }, { title, sub }], { w: 768, h: 192 }));
  const texts = calls.filter(([kind]) => kind === 'fillText');
  assert.deepEqual(texts.slice(1).map(([, text]) => text), [title, sub], 'el texto llega entero al lienzo');
  // El ancho máximo de fillText comprime el texto largo dentro del aviso, como signTexture.
  assert.equal(texts[1][4], 768 * 0.9);
  assert.equal(texts[2][4], 768 * 0.88);
  assert.deepEqual(calls.filter(([kind]) => kind === 'translate')[1], ['translate', 832 + 32, 8], 'el segundo aviso se pinta en su celda');
  const [u0, , u1] = cells[1];
  assert.ok(Math.abs((u1 - u0) * 832 * 4 - 768) < 1e-6, 'la celda mide lo que el aviso');
});

test('las entradas que no caben en el atlas quedan sin celda y el lienzo no crece', async () => {
  const { signTextAtlas } = await atlasModule();
  const entries = Array.from({ length: 40 }, (_, i) => ({ title: `LOCAL ${i}` }));
  const { texture, cells } = withDocument(canvasDocument(), () => signTextAtlas(entries, { w: 768, h: 192, maxSize: 4 * 208 }));
  assert.equal(texture.image.height, 4 * 208);
  assert.equal(cells.filter(Boolean).length, 16);
  assert.ok(cells.slice(16).every(cell => cell === null));
});

test('el plano del aviso lleva las UV de su celda y su color de fondo en cada vértice', async () => {
  const { atlasPlane } = await atlasModule();
  const rect = [.25, .5, .5, .625];
  const geometry = atlasPlane(3.6, .9, rect, new THREE.Color('#c84236'));
  const uv = geometry.attributes.uv;
  const us = new Set(), vs = new Set();
  for (let i = 0; i < uv.count; i++) { us.add(uv.getX(i)); vs.add(uv.getY(i)); }
  assert.deepEqual([...us].sort(), [.25, .5]);
  assert.deepEqual([...vs].sort(), [.5, .625]);
  // En lineal, como queda #c84236 al decodificar una textura sRGB: 200, 66 y 54 de 255.
  const back = geometry.attributes.signBack;
  assert.equal(back.count, uv.count);
  for (let i = 0; i < back.count; i++) {
    [0.577581, 0.054480, 0.036889].forEach((value, k) => assert.ok(Math.abs(back.array[i * 3 + k] - value) < 1e-5, `vértice ${i}, canal ${k}`));
  }
  assert.equal(atlasPlane(3.6, .9, rect).attributes.signBack, undefined, 'sin color no hay atributo');
});

function buildBlocks(doc, prepare = () => {}) {
  const random = Math.random;
  ownSigns.length = 0;
  try {
    Math.random = rng(7);
    return withDocument(doc, () => {
      const city = new Bogota();
      prepare(city);
      city.map = city._layout();
      city._buildBlocks(city.map);
      const signs = [];
      city.group.updateMatrixWorld(true);
      city.group.traverse(object => {
        const material = object.material;
        const isSign = object.isMesh && object.geometry?.type === 'PlaneGeometry'
          && material?.isMeshBasicMaterial && Math.abs(object.position.y - 3.05) < 1e-9;
        if (isSign) signs.push({ object, at: object.matrixWorld.elements.map(v => +v.toFixed(5)).join() });
      });
      return { city, signs, own: [...ownSigns] };
    });
  } finally { Math.random = random; }
}

// Color de fondo del aviso, en sRGB como lo pinta signTexture, leído de sus vértices.
const backOf = mesh => {
  const back = mesh.geometry.attributes.signBack;
  const hexes = new Set(Array.from({ length: back.count }, (_, i) => new THREE.Color().fromBufferAttribute(back, i).getHexString()));
  assert.equal(hexes.size, 1, 'los cuatro vértices llevan el mismo fondo');
  return `#${[...hexes][0]}`;
};
const uvOf = mesh => { const uv = mesh.geometry.attributes.uv; return [uv.getX(2), uv.getY(2), uv.getX(1), uv.getY(1)]; };

test('sin lienzo cada aviso conserva su textura propia', () => {
  const { signs, own } = buildBlocks(undefined);
  assert.ok(own.length > 50, `hay avisos (${own.length})`);
  assert.equal(signs.length, own.length);
  assert.equal(new Set(signs.map(s => s.object.material.map)).size, own.length, 'una textura por aviso');
});

test('con lienzo todos los avisos comparten una textura y salen en los mismos sitios y colores', () => {
  const plain = buildBlocks(undefined);
  const { city, signs, own } = buildBlocks(canvasDocument());
  assert.equal(own.length, 0, 'ningún aviso de local pide su propia textura');
  assert.equal(signs.length, plain.own.length, 'una sola malla por aviso, como con textura propia');
  // Cada casa lleva copias propias de los materiales (para atenuarse sola); el original es uno.
  const original = s => s.object.material.userData.staticBatchKey.split(':')[0];
  assert.equal(new Set(signs.map(original)).size, 1, 'un material para todos los avisos');
  assert.equal(new Set(signs.map(s => s.object.material.map)).size, 1, 'una textura para todos los avisos');
  assert.deepEqual(signs.map(s => s.at), plain.signs.map(s => s.at), 'los avisos quedan donde estaban');
  assert.deepEqual(signs.map(s => backOf(s.object)), plain.own.map(o => o.bg), 'mismos colores de fondo');
  // Entradas del atlas en orden: una por oficio y nombre (AVISOS_GRANDES), con la letra de su oficio.
  const texts = [], calls = city._shopSigns.material.map.image.calls;
  calls.forEach((call, i) => { if (call[0] === 'translate') texts.push(`${calls[i + 1][1]}|${calls[i + 2]?.[0] === 'fillText' ? calls[i + 2][1] : ''}`); });
  signs.forEach((s, i) => {
    const { title, sub, fg } = plain.own[i];
    const index = texts.indexOf(`${title}|${sub}`);
    const cell = city._shopSigns.cells[index];
    assert.ok(cell && uvOf(s.object).every((v, k) => Math.abs(v - cell[k]) < 1e-6), `aviso ${i}: ${title} ${sub}`);
    assert.equal(AVISOS_GRANDES[index].oficio.tinta, fg, `aviso ${i}: ${title} con letra ${fg}`);
  });
});

test('si el atlas se llena, los avisos que no caben llevan textura propia', () => {
  const plain = buildBlocks(undefined);
  const { signs, own } = buildBlocks(canvasDocument(), city => {
    const build = city._shopSignAtlas;
    city._shopSignAtlas = function () {
      const atlas = build.call(this);
      if (atlas && !atlas.full) { atlas.cells = atlas.cells.map((cell, i) => i < 10 ? cell : null); atlas.full = true; }
      return atlas;
    };
  });
  assert.ok(own.length > 0 && own.length < plain.own.length, `parte de los avisos con textura propia (${own.length} de ${plain.own.length})`);
  assert.equal(signs.length, plain.own.length, 'los demás, con el atlas, siguen siendo una malla por aviso');
  assert.equal(signs.filter(s => s.object.geometry.attributes.signBack).length, plain.own.length - own.length);
});

test('soltar la ciudad libera el atlas y su material una sola vez', () => {
  const { city } = buildBlocks(canvasDocument());
  const atlas = city._shopSigns;
  const counts = new Map();
  const count = target => counts.set(target, (counts.get(target) ?? 0) + 1);
  const textureDispose = THREE.Texture.prototype.dispose, materialDispose = THREE.Material.prototype.dispose;
  THREE.Texture.prototype.dispose = function () { count(this); return textureDispose.call(this); };
  THREE.Material.prototype.dispose = function () { count(this); return materialDispose.call(this); };
  try { city.dispose(new THREE.Scene()); } finally {
    THREE.Texture.prototype.dispose = textureDispose; THREE.Material.prototype.dispose = materialDispose;
  }
  assert.equal(counts.get(atlas.material.map), 1, 'la textura del atlas');
  assert.equal(counts.get(atlas.material), 1, 'el material de los avisos');
  assert.ok([...counts.values()].every(n => n === 1), 'nada se libera dos veces');
  assert.equal(city._shopSigns, undefined, 'una ciudad nueva arma su propio atlas');
});

// Lienzo que anota cada orden de dibujo y cada ajuste, en orden.
function recordingDocument() {
  return { createElement() {
    const log = [];
    const context = new Proxy({}, {
      get: (_, key) => (...args) => { log.push([key, ...args]); },
      set: (_, key, value) => { log.push(['=', key, value]); return true; }
    });
    return { width: 0, height: 0, getContext: () => context, log };
  } };
}

test('cada celda del atlas pinta lo mismo que el aviso con su propia textura, sin el fondo', async () => {
  const { signTextAtlas } = await atlasModule();
  const cases = [
    { title: 'ASADERO', sub: 'POLLO DORADO', fg: '#fff3da', bg: '#c84236' },
    { title: 'TIENDA', sub: 'DONDE PACHO', fg: '#26302e', bg: '#eeebeb' },
    { title: 'FRUVER', sub: 'LA COSECHA', fg: '#f2e9c4', bg: '#5f8a3e', accent: '#e2863a' }
  ];
  for (const { title, sub, fg, bg, accent } of cases) {
    const own = withDocument(recordingDocument(), () => originalSignTexture({ title, sub, bg, fg, accent, w: 768, h: 192 }));
    // Lo que pinta signTexture menos el fondo, que en el atlas es un plano de color.
    const expected = own.image.log.filter(([key, , value]) => !(key === '=' && value === bg) && key !== 'fillRect');
    // Seis celdas antes de esta: la celda empieza fuera del origen del lienzo.
    const entries = [...Array(6).fill({ title: 'X' }), { title, sub, fg, accent }];
    const { texture } = withDocument(recordingDocument(), () => signTextAtlas(entries, { w: 768, h: 192 }));
    const log = texture.image.log, start = log.findIndex(([key, ...args]) => key === 'translate' && args[0] === 2 * 832 + 32 && args[1] === 208 + 8);
    assert.ok(start > 0, 'la séptima celda se pinta en la tercera columna de la segunda fila');
    const cell = log.slice(start + 1, log.findIndex((entry, i) => i > start && entry[0] === 'restore'));
    assert.deepEqual(cell, expected, `${title}: letra, grosor, posición, colores y borde`);
  }
  // Valores de develop, escritos a mano, por si signTexture también cambiara.
  const { texture } = withDocument(recordingDocument(), () => signTextAtlas([{ title: 'ASADERO', sub: 'POLLO DORADO', fg: '#fff3da' }], { w: 768, h: 192 }));
  const cell = texture.image.log.filter(([key]) => !['save', 'translate', 'restore'].includes(key));
  assert.deepEqual(cell, [
    ['=', 'strokeStyle', '#fff3da'], ['=', 'lineWidth', 10], ['strokeRect', 18, 18, 732, 156],
    ['=', 'fillStyle', '#fff3da'], ['=', 'textAlign', 'center'], ['=', 'textBaseline', 'middle'],
    ['=', 'font', '900 69px system-ui, sans-serif'], ['fillText', 'ASADERO', 384, 192 * 0.42, 768 * 0.9],
    ['=', 'fillStyle', '#f6c400'], ['=', 'font', '800 29px system-ui, sans-serif'], ['fillText', 'POLLO DORADO', 384, 192 * 0.76, 768 * 0.88]
  ]);
});

test('el fondo, el nombre y el color de letra de cada aviso son los del oficio de cada local', () => {
  const { city, signs } = buildBlocks(canvasDocument());
  const calls = city._shopSigns.material.map.image.calls, titles = [];
  calls.forEach((call, i) => { if (call[0] === 'translate') titles.push([calls[i + 1][1], calls[i + 2]?.[0] === 'fillText' ? calls[i + 2][1] : '']); });
  const cells = city._shopSigns.cells;
  const list = signs.map(s => {
    const index = cells.findIndex(cell => cell && uvOf(s.object).every((v, k) => Math.abs(v - cell[k]) < 1e-6));
    // Una entrada por oficio y nombre, con la letra de su oficio.
    return [...titles[index], backOf(s.object), AVISOS_GRANDES[index].oficio.tinta];
  });
  // Los doce primeros avisos de la ciudad, con el oficio que el solar le da a cada local.
  assert.deepEqual(list.slice(0, 12), [
    ['CHATARRERÍA', 'EL COBRE', '#5a4a3c', '#e8d49a'], ['CHANCE', 'EL PÁLPITO', '#3f7a4a', '#f3ecc8'],
    ['PAPELERÍA', 'EL TAJALÁPIZ', '#d8cf9e', '#273f73'], ['PANADERÍA', 'EL TRIGAL', '#c79a4a', '#5a2a16'],
    ['BILLARES', 'EL TACO', '#2f5f48', '#ead9a0'], ['LICORERA', 'LA ÚLTIMA', '#3a3f6a', '#ecd98a'],
    ['ASADERO', 'EL FOGÓN', '#c68a2a', '#6a1c14'], ['FRUVER', 'LA COSECHA', '#5f8a3e', '#f2e9c4'],
    ['COMPRAVENTA', 'LA PRENDA', '#b3a03a', '#2a2a26'], ['MISCELÁNEA', 'LA CHUCHERÍA', '#4f7fa0', '#f3e7c0'],
    ['MISCELÁNEA', 'DOÑA FLOR', '#4f7fa0', '#f3e7c0'], ['TALLER DE MOTOS', 'LA BIELA', '#2f3a36', '#e2863a']
  ]);
  // Los mismos 131 avisos de siempre (el sorteo de cuáles casas llevan aviso no cambió), cada uno con el fondo y la
  // letra de su oficio y un texto de los avisos grandes, y la lista entera igual.
  assert.equal(list.length, 131);
  for (const [title, sub, bg, fg] of list) {
    const entry = AVISOS_GRANDES.find(e => e.oficio.titulo === title && e.nombre === sub);
    assert.ok(entry, `${title} ${sub} es un aviso grande`);
    assert.deepEqual([bg, fg], [entry.oficio.fondo, entry.oficio.tinta], `${title} ${sub}: fondo y letra de su oficio`);
  }
  assert.equal(createHash('sha256').update(JSON.stringify(list)).digest('hex'),
    'c1cc1bbaf3e8733708026827dca07ceac0a9ee206d1a6bb6078a764c68809b8e', 'la lista entera');
});

test('el aviso es opaco y sus copias de cada casa se atenúan en isométrica como un aviso con textura propia', async () => {
  const { SignTextMaterial } = await atlasModule();
  const { city, signs } = buildBlocks(canvasDocument());
  const { material } = city._shopSigns, texture = material.map;
  // La imagen sube premultiplicada (mipmaps sin el negro del fondo transparente) y sin decodificar.
  assert.equal(texture.premultiplyAlpha, true);
  assert.equal(texture.colorSpace, THREE.NoColorSpace);
  assert.equal(texture.anisotropy, 8);
  // De lejos el aviso sale de los mipmaps, con niebla y mapeo de tono como cualquier aviso de develop.
  assert.deepEqual([texture.generateMipmaps, texture.minFilter], [true, THREE.LinearMipmapLinearFilter]);
  assert.ok(material instanceof SignTextMaterial);
  assert.deepEqual([material.fog, material.toneMapped], [true, true]);
  // Opaco como el MeshBasicMaterial de develop: no se mezcla con lo que hay detrás.
  assert.deepEqual([material.transparent, material.premultipliedAlpha, material.depthWrite, material.polygonOffset,
    material.opacity, material.vertexColors], [false, false, true, false, 1, false]);
  assert.deepEqual(material.userData.batchAttributes, ['signBack']);
  // Las copias de cada casa (BuildingVisibility) conservan la clase, su shader y lo opaco de fábrica.
  const copies = signs.map(s => s.object.material);
  assert.ok(copies.length > 50 && copies.every(m => m instanceof SignTextMaterial && m !== material));
  assert.ok(copies.every(m => m.userData.fadeBase.transparent === false && m.userData.fadeBase.depthWrite === true));
  assert.equal(copies[0].customProgramCacheKey(), 'aviso-atlas');
  // Al atenuarse la pared, el aviso se vuelve transparente con ella y luego vuelve a ser opaco.
  const sign = signs[0].object;
  const part = city.buildingVisibility.buildings.flatMap(b => b.parts).find(p => p.materials.includes(sign.material));
  city.buildingVisibility._fade(part, true, 0.1);
  assert.ok(sign.material.transparent && sign.material.opacity < 1 && !sign.material.depthWrite, 'atenuado');
  city.buildingVisibility._fade(part, false, 0, true);
  assert.deepEqual([sign.material.transparent, sign.material.opacity, sign.material.depthWrite], [false, 1, true], 'restaurado');
});

test('el shader mezcla el fondo de los vértices con la letra del atlas en luz lineal', async () => {
  const { SignTextMaterial } = await atlasModule();
  // Sobre el shader de MeshBasicMaterial de three: si cambiaran sus puntos de anclaje, falla.
  const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  new SignTextMaterial().onBeforeCompile(shader);
  assert.match(shader.vertexShader, /attribute vec3 signBack;\s*varying vec3 vSignBack;/);
  assert.match(shader.vertexShader, /#include <uv_vertex>\s*vSignBack = signBack;/);
  assert.match(shader.fragmentShader, /varying vec3 vSignBack;/);
  assert.ok(!shader.fragmentShader.includes('#include <map_fragment>'));
  // Deshace el premultiplicado, decodifica la letra a lineal y la mezcla con el fondo por su cobertura.
  assert.match(shader.fragmentShader, /vec3 signLetter = sRGBTransferEOTF\( vec4\( signTexel\.rgb \/ max\( signTexel\.a, 1e-4 \), 1\.0 \) \)\.rgb;/);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb \*= mix\( vSignBack, signLetter, signTexel\.a \);/);
});

test('los avisos agrupados de tercera persona conservan su color de fondo', async () => {
  const { SignTextMaterial } = await atlasModule();
  const { city, signs } = buildBlocks(canvasDocument());
  const group = city.buildingVisibility.buildClosedView();
  const merged = group.children.filter(mesh => mesh.material instanceof SignTextMaterial);
  assert.ok(merged.length > 0 && merged.length < signs.length, `los avisos se agrupan (${merged.length} lotes para ${signs.length})`);
  let vertices = 0;
  const colors = new Set();
  for (const mesh of merged) {
    const back = mesh.geometry.attributes.signBack;
    assert.ok(back, 'el lote conserva signBack');
    assert.equal(back.count, mesh.geometry.attributes.position.count);
    vertices += back.count;
    for (let i = 0; i < back.count; i++) colors.add(new THREE.Color().fromBufferAttribute(back, i).getHexString());
  }
  assert.equal(vertices, signs.length * 4);
  assert.deepEqual([...colors].sort(), [...new Set(signs.map(s => backOf(s.object).slice(1)))].sort());
});
