import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRealisticCharacter } from '../src/character/RealisticCharacter.js';
import { shareImages } from '../src/character/sharedImages.js';

// Con los glTF reales y el camino real del cargador; lo único falso es decodificar: la imagen que sale
// recuerda de qué URL vino, y así se comprueba que a cada material le llegó la suya.
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
globalThis.self ??= globalThis;
const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const originalFetch = globalThis.fetch;
const downloads = [];
const decodes = [];
const loaded = new Map();
const skinDetail = new THREE.Texture();

function parseAsset(loader, url) {
  const file = path.join(models, url.replace(/^\/models\//, ''));
  if (file.endsWith('.glb')) {
    const bytes = readFileSync(file);
    return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }
  const json = JSON.parse(readFileSync(file));
  for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + readFileSync(path.join(path.dirname(file), buffer.uri)).toString('base64');
  return loader.parseAsync(JSON.stringify(json), `${path.posix.dirname(url)}/`);
}

test.before(() => {
  globalThis.createImageBitmap = async blob => {
    const url = await blob.text();
    decodes.push(url);
    return { url, width: 4, height: 4 };
  };
  mock.method(globalThis, 'fetch', (url, ...rest) => {
    if (url === '/models/personaje/catalogo.json') return Promise.resolve(new Response(readFileSync(path.join(models, 'personaje/catalogo.json'))));
    if (typeof url === 'string' && url.endsWith('.webp')) {
      downloads.push(url);
      return Promise.resolve(new Response(new Blob([url])));
    }
    return originalFetch(url, ...rest);
  });
  // `this` es el cargador del módulo, con lo que tenga registrado: es justo lo que se prueba.
  mock.method(GLTFLoader.prototype, 'loadAsync', function (url) {
    const result = parseAsset(this, url);
    loaded.set(url, result);
    return result;
  });
  mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => skinDetail);
});
test.after(() => {
  mock.restoreAll();
  delete globalThis.createImageBitmap;
});

const SIMPLE = { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'ninguna', ropa: 'buzo', calzado: 'tenis', cabeza: 'sin-sombrero' };
const LOOKS = [
  [SIMPLE, {}],
  [SIMPLE, { lod: true }],
  [{ ...SIMPLE, ropa: 'camiseta', calzado: 'tenis-rotos', pelo: 'crespo' }, {}],
  [{ ...SIMPLE, ropa: 'camiseta', calzado: 'tenis-rotos', pelo: 'crespo' }, { lod: true }],
  [{ ...SIMPLE, edad: 'joven', barba: 'descuidada' }, {}],
  [{ ...SIMPLE, sexo: 'mujer', edad: 'adulto', pelo: 'melena', ropa: 'short', calzado: 'tenis' }, {}]
];

const fileName = url => url.split('/').pop();
const SLOTS = { map: 'pbrMetallicRoughness.baseColorTexture', normalMap: 'normalTexture', roughnessMap: 'pbrMetallicRoughness.metallicRoughnessTexture', emissiveMap: 'emissiveTexture', aoMap: 'occlusionTexture' };
const slotIn = (material, route) => route.split('.').reduce((node, key) => node?.[key], material);

/** Cada textura de cada material de todos los glTF ya cargados, con la imagen que su archivo pide. */
async function everyTexture() {
  const out = [];
  for (const [url, result] of loaded) {
    const { parser } = await result;
    const { json } = parser;
    for (let i = 0; i < (json.materials ?? []).length; i++) {
      const material = await parser.getDependency('material', i);
      for (const [slot, route] of Object.entries(SLOTS)) {
        const reference = slotIn(json.materials[i], route);
        if (!reference) continue;
        const declared = json.textures[reference.index];
        const image = json.images[declared.extensions?.EXT_texture_webp?.source ?? declared.source];
        out.push({ gltf: url, slot, texture: material[slot], wanted: fileName(image.uri) });
      }
    }
  }
  return out;
}

test('cada imagen se descarga y se decodifica una vez, y a cada material le llega la que pide su archivo', async () => {
  const people = [];
  for (const [real, options] of LOOKS) people.push(await createRealisticCharacter({ real }, options));
  const urls = downloads.map(url => new URL(url, 'http://x/').pathname);
  assert.ok(new Set(urls).size > 10, 'se pidieron varias imágenes');
  assert.equal(urls.length, new Set(urls).size, 'ninguna imagen se pide dos veces');
  assert.equal(decodes.length, urls.length, 'ninguna imagen se decodifica dos veces');
  assert.ok(urls.every(url => url.startsWith('/models/personaje/texturas/')), 'todas las rutas quedan normalizadas');

  const all = await everyTexture();
  assert.ok(all.length > 20);
  const sourceOf = new Map(), gltfsOf = new Map();
  for (const { gltf, slot, texture, wanted } of all) {
    assert.ok(texture, `${gltf}: ${slot} sin textura`);
    assert.equal(fileName(texture.image.url), wanted, `${gltf}: ${slot} tiene otra imagen`);
    if (!sourceOf.has(wanted)) sourceOf.set(wanted, texture.source);
    assert.equal(texture.source, sourceOf.get(wanted), `${wanted}: más de una copia de la imagen`);
    assert.equal(texture.flipY, false, `${gltf}: ${slot} quedaría invertida`);
    assert.equal(texture.colorSpace, slot === 'map' || slot === 'emissiveMap' ? THREE.SRGBColorSpace : THREE.NoColorSpace, `${gltf}: ${slot}`);
    if (!gltfsOf.has(texture)) gltfsOf.set(texture, gltf);
    assert.equal(gltfsOf.get(texture), gltf, 'cada glTF conserva su textura, con sus ajustes');
  }
  assert.ok([...new Set(all.map(item => item.wanted))].some(wanted => new Set(all.filter(item => item.wanted === wanted).map(item => item.gltf)).size > 1),
    'hay imágenes que usan varios archivos: si no, esta prueba no comprueba nada');
  for (const source of sourceOf.values()) assert.equal(source.version, 1, 'copiar no marca la imagen como cambiada: no se vuelve a subir');
  for (const person of people) person.dispose();
});

test('desechar a alguien no libera ninguna textura compartida, y el siguiente no vuelve a descargar nada', async () => {
  const person = await createRealisticCharacter({ real: SIMPLE });
  const textures = new Set();
  person.group.traverse(node => {
    if (!node.isMesh) return;
    for (const slot of Object.keys(SLOTS)) if (node.material[slot]?.source?.data?.url) textures.add(node.material[slot]);
  });
  assert.ok(textures.size > 3);
  let released = 0;
  for (const texture of textures) texture.addEventListener('dispose', () => { released++; });
  const before = downloads.length;
  person.dispose();
  const again = await createRealisticCharacter({ real: SIMPLE });
  assert.equal(released, 0, 'las texturas son de todos los que llevan esa ropa');
  assert.equal(downloads.length, before);
  const after = new Set();
  again.group.traverse(node => { if (node.isMesh && node.material.map) after.add(node.material.map); });
  assert.ok([...textures].some(texture => after.has(texture)), 'el segundo usa las mismas texturas');
  again.dispose();
});

test('con un cargador que entrega texturas y con uno que entrega imágenes, la copia es la misma imagen', async () => {
  for (const isImageBitmapLoader of [false, true]) {
    const loads = [];
    const parser = { textureLoader: { isImageBitmapLoader, load(url, onLoad) {
      loads.push(url);
      const image = { width: 2, height: 2 };
      onLoad(isImageBitmapLoader ? image : Object.assign(new THREE.Texture(image), { needsUpdate: true }));
    } } };
    assert.ok(shareImages(parser).name);
    const get = url => new Promise((resolve, reject) => parser.textureLoader.load(url, resolve, undefined, reject));
    const tag = isImageBitmapLoader ? 'mapa' : 'textura';
    const near = await get(`/m/cuerpo/../texturas/${tag}.webp`);
    const far = await get(`/m/cuerpo/lod/../../texturas/${tag}.webp`);
    assert.equal(loads.length, 1, 'las dos rutas son la misma imagen');
    assert.ok(near.isTexture && far.isTexture);
    assert.notEqual(near, far);
    assert.equal(near.source, far.source);
    assert.ok(near.version > 0 && far.version > 0, 'las dos se suben a la GPU, si nadie más lo hizo');
    near.flipY = false; near.colorSpace = THREE.SRGBColorSpace;
    assert.equal(far.flipY, true, 'los ajustes son de cada copia');
    assert.equal(far.colorSpace, THREE.NoColorSpace);
  }
});

test('un fallo de red se puede reintentar, y las imágenes embebidas no se comparten', async () => {
  let fail = true, calls = 0;
  const parser = { textureLoader: { isImageBitmapLoader: true, load(url, onLoad, onProgress, onError) {
    calls++;
    if (fail && !url.startsWith('data:')) onError(new Error('sin red'));
    else onLoad({ width: 2, height: 2 });
  } } };
  shareImages(parser);
  const get = url => new Promise((resolve, reject) => parser.textureLoader.load(url, resolve, undefined, reject));
  await assert.rejects(get('/m/texturas/falla.webp'), /sin red/);
  // El borrado corre en el rechazo de la misma promesa: basta con dejar pasar ese turno.
  await new Promise(resolve => setImmediate(resolve));
  fail = false;
  const texture = await get('/m/texturas/falla.webp');
  assert.ok(texture.isTexture);
  assert.equal(calls, 2);

  const inline = 'data:image/webp;base64,AAAA';
  const first = await get(inline), second = await get(inline);
  assert.equal(calls, 4);
  assert.notEqual(first.source, second.source);
});
