import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRealisticCharacter, loadCatalog, normalizeReal, optionsFor } from '../src/character/RealisticCharacter.js';
import { GARMENTS } from '../src/character/streetMaterials.js';

// Con los cuerpos y las prendas reales del catálogo: es donde un plano de cintura o un filtro de medias fallaría.
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const originalFetch = globalThis.fetch;
const skinDetail = new THREE.Texture();
const detailLoads = [];

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
  mock.method(THREE.TextureLoader.prototype, 'loadAsync', async url => {
    detailLoads.push(url);
    return skinDetail;
  });
});
test.after(() => mock.restoreAll());

const TONOS = { arriba: '#223344', abajo: '#556677', patron: 'rayas', patronColor: '#8a2a20' };
const SIMPLE = { pelo: 'calvo', barba: 'ninguna', calzado: 'tenis', cabeza: 'sin-sombrero' };

function compiled(material) {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader, {});
  return shader;
}
const meshesOf = (character, surface) => {
  const meshes = [];
  character.group.traverse(node => { if (node.isSkinnedMesh && node.material.userData.streetSurface === surface) meshes.push(node); });
  return meshes;
};
const triangles = meshes => meshes.reduce((total, mesh) => total + mesh.geometry.index.count / 3, 0);

/** Altura media en reposo, por área y en fracción de la estatura, de cada zona: no depende de cuántos vértices tenga la malla. */
function zoneHeights(meshes) {
  const zones = [{ y: 0, area: 0 }, { y: 0, area: 0 }], triangle = new THREE.Triangle();
  for (const mesh of meshes) {
    const rest = compiled(mesh.material).uniforms.uStreetRestMatrix.value;
    const { index, attributes: { position, streetZone } } = mesh.geometry;
    assert.ok(streetZone, `${mesh.name} sin zonas`);
    assert.equal(streetZone.count, position.count);
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      triangle.setFromAttributeAndIndices(position, a, index.getX(i + 1), index.getX(i + 2));
      for (const corner of [triangle.a, triangle.b, triangle.c]) corner.applyMatrix4(rest);
      const zone = zones[streetZone.array[a] > 127 ? 1 : 0], area = triangle.getArea();
      zone.y += area * (triangle.a.y + triangle.b.y + triangle.c.y) / 3;
      zone.area += area;
    }
  }
  return zones.map(({ y, area }) => area ? y / area : null);
}

test('el modelo liviano no descarga los poros, y el completo los trae', async () => {
  const far = await createRealisticCharacter({ real: SIMPLE }, { lod: true });
  assert.deepEqual(detailLoads, [], 'los poros solo son del modelo completo');
  assert.equal(meshesOf(far, 'skin')[0].material.normalMap, null);
  const near = await createRealisticCharacter({ real: SIMPLE });
  assert.equal(meshesOf(near, 'skin')[0].material.normalMap, skinDetail);
  far.dispose();
  near.dispose();
});

test('la misma persona lleva los mismos colores en los dos modelos, y el liviano se pinta las cejas', async () => {
  const look = { piel: 3, peloColor: 2, desgaste: 2, real: { sexo: 'hombre', edad: 'mayor', pelo: 'corto', barba: 'ninguna', ropa: 'camisa', calzado: 'botas', tonos: TONOS } };
  const near = await createRealisticCharacter(look);
  const far = await createRealisticCharacter(look, { lod: true });
  const skin = character => meshesOf(character, 'skin')[0].material;
  assert.equal(skin(near).color.getHexString(), skin(far).color.getHexString());
  const { uniforms: nearSkin } = compiled(skin(near)), { uniforms: farSkin } = compiled(skin(far));
  for (const name of ['uStreetWear', 'uStreetSeed', 'uStreetStubble']) assert.equal(nearSkin[name].value, farSkin[name].value, name);
  assert.deepEqual(nearSkin.uStreetFaceTint.value.toArray(), farSkin.uStreetFaceTint.value.toArray());
  assert.equal(nearSkin.uStreetBrows.value.w, 0, 'el completo tiene cejas de verdad');
  assert.ok(farSkin.uStreetBrows.value.w > .5);
  const hair = meshesOf(near, 'hair').find(mesh => !/eyebrow/i.test(mesh.name)).material;
  const farHair = meshesOf(far, 'hair').find(mesh => !/eyebrow/i.test(mesh.name)).material;
  assert.equal(hair.color.getHexString(), farHair.color.getHexString());
  assert.equal(farSkin.uStreetBrows.value.x, hair.color.r);
  const cloth = character => compiled(meshesOf(character, 'fabric')[0].material).uniforms;
  for (const name of ['uStreetTop', 'uStreetBottom', 'uStreetPatternColor']) assert.equal(cloth(near)[name].value.getHexString(), cloth(far)[name].value.getHexString());
  near.dispose();
  far.dispose();
});

test('toda prenda de cada cuerpo separa arriba y abajo, igual en los dos modelos', async () => {
  const catalog = await loadCatalog();
  for (const { sexo, edad } of catalog.cuerpos) {
    for (const { id: ropa } of optionsFor(catalog, 'ropa', sexo)) {
      const label = `${sexo} ${edad} ${ropa}`;
      assert.ok(GARMENTS[ropa], `${label}: falta en la tabla de prendas`);
      const real = { ...SIMPLE, sexo, edad, ropa, tonos: TONOS };
      const near = await createRealisticCharacter({ real });
      const far = await createRealisticCharacter({ real }, { lod: true });
      const [nearTop, nearBottom] = zoneHeights(meshesOf(near, 'fabric'));
      const [farTop, farBottom] = zoneHeights(meshesOf(far, 'fabric'));
      assert.ok(nearTop !== null && nearBottom !== null, `${label}: le falta una zona`);
      assert.ok(farTop !== null && farBottom !== null, `${label} liviano: le falta una zona`);
      assert.ok(nearTop > nearBottom + .12 && nearTop > .55, `${label}: arriba ${nearTop}, abajo ${nearBottom}`);
      assert.ok(Math.abs(nearTop - farTop) < .05 && Math.abs(nearBottom - farBottom) < .05,
        `${label}: completo ${nearTop} y ${nearBottom}, liviano ${farTop} y ${farBottom}`);
      near.dispose();
      far.dispose();
    }
  }
});

test('los programas no se multiplican con la persona, los tonos ni el modelo', async () => {
  const looks = [
    { piel: 0, desgaste: 0, real: { sexo: 'hombre', edad: 'joven', pelo: 'corto', barba: 'bigote', ropa: 'buzo', calzado: 'tenis' } },
    { piel: 4, desgaste: 2, real: { sexo: 'hombre', edad: 'mayor', pelo: 'desordenado', barba: 'larga', ropa: 'overol', calzado: 'botas', tonos: TONOS } },
    { piel: 2, desgaste: 1, real: { sexo: 'mujer', edad: 'adulto', pelo: 'cola', ropa: 'blusa', calzado: 'zapatos', tonos: { ...TONOS, patron: 'franela' } } }
  ];
  const keys = new Map();
  for (const lod of [false, true]) for (const look of looks) {
    const character = await createRealisticCharacter(look, { lod });
    character.group.traverse(node => {
      const kind = node.isSkinnedMesh && node.material.userData.streetSurface;
      if (!kind || kind === 'eyes') return;
      if (!keys.has(kind)) keys.set(kind, new Set());
      keys.get(kind).add(node.material.customProgramCacheKey());
    });
    character.dispose();
  }
  assert.deepEqual([...keys.keys()].sort(), ['beard', 'fabric', 'hair', 'shoes', 'skin']);
  for (const [kind, values] of keys) assert.equal(values.size, 1, `${kind}: ${[...values]}`);
});

test('las medias se quitan bajo el pantalón largo, se quedan con el short, y las botas no pierden nada', async () => {
  const shoes = async (ropa, calzado, options) => {
    const character = await createRealisticCharacter({ real: { ...SIMPLE, sexo: 'mujer', edad: 'adulto', ropa, calzado } }, options);
    const value = meshesOf(character, 'shoes');
    character.dispose();
    return value;
  };
  for (const options of [{}, { lod: true }]) {
    for (const calzado of ['tenis', 'tenis-rotos', 'zapatos']) {
      const covered = await shoes('blusa', calzado, options), bare = await shoes('short', calzado, options);
      assert.ok(triangles(covered) < triangles(bare), `${calzado}: ${triangles(covered)} contra ${triangles(bare)}`);
      assert.ok(triangles(covered) > triangles(bare) * .3, 'el zapato sigue ahí');
      assert.equal(covered[0].geometry.attributes.position, bare[0].geometry.attributes.position, 'comparte los datos del zapato');
    }
    assert.equal(triangles(await shoes('blusa', 'botas', options)), triangles(await shoes('short', 'botas', options)));
  }
  const again = await shoes('blusa', 'tenis');
  assert.equal(again[0].geometry, (await shoes('saco', 'tenis'))[0].geometry, 'una sola geometría recortada por zapato');
});

test('el pelo es sólido y el crespo pierde los cuadritos sueltos', async () => {
  const hairOf = async pelo => {
    const character = await createRealisticCharacter({ real: { ...SIMPLE, pelo } });
    const hair = meshesOf(character, 'hair').filter(mesh => !/eyebrow/i.test(mesh.name));
    return { character, hair };
  };
  const { character, hair } = await hairOf('crespo');
  assert.equal(hair[0].material.depthWrite, true);
  assert.equal(hair[0].material.transparent, false);
  assert.equal(hair[0].material.side, THREE.DoubleSide);
  const catalog = await loadCatalog();
  const { piezas } = catalog.cuerpos.find(body => body.sexo === 'hombre' && body.edad === 'adulto');
  const source = await parseAsset(`/models/personaje/hombre-adulto/${piezas.crespo.file}`);
  let sourceTriangles = 0;
  source.scene.traverse(node => { if (node.isSkinnedMesh) sourceTriangles += node.geometry.index.count / 3; });
  assert.ok(triangles(hair) < sourceTriangles, `${triangles(hair)} contra ${sourceTriangles}`);
  assert.ok(triangles(hair) > sourceTriangles * .3, 'la mata de pelo sigue ahí');
  character.dispose();
  const straight = await hairOf('corto');
  assert.ok(straight.hair.every(mesh => mesh.material.depthWrite));
  straight.character.dispose();
});

test('el pelo que lo pide lleva su ajuste, y los demás no', async () => {
  const uniformsOf = async pelo => {
    const character = await createRealisticCharacter({ real: { ...SIMPLE, pelo } });
    const { uniforms } = compiled(meshesOf(character, 'hair').find(mesh => !/eyebrow/i.test(mesh.name)).material);
    character.dispose();
    return uniforms;
  };
  assert.equal((await uniformsOf('crespo')).uStreetCurl.value, 1);
  assert.equal((await uniformsOf('corto')).uStreetCurl.value, 0);
  assert.equal((await uniformsOf('rapado')).uHairContrast.value, .4, 'parches que serían camuflado en las canas');
  assert.equal((await uniformsOf('corto')).uHairContrast.value, 1);
});

test('el pantalón ancho queda debajo de la prenda y solo el saco le mete la pretina', async () => {
  const waists = async ropa => {
    const character = await createRealisticCharacter({ real: { ...SIMPLE, ropa } });
    const value = meshesOf(character, 'fabric').map(mesh => ({ pants: /pants/i.test(mesh.name), mesh, waist: compiled(mesh.material).uniforms.uStreetWaist.value, margin: compiled(mesh.material).uniforms.uStreetMargin.value }));
    character.dispose();
    return value;
  };
  for (const ropa of ['saco', 'rota']) {
    const parts = await waists(ropa), pants = parts.find(part => part.pants), top = parts.find(part => !part.pants);
    assert.ok(pants && top, ropa);
    assert.ok(pants.margin < top.margin, 'la camisa va por fuera');
    assert.ok(pants.waist.x < pants.mesh.geometry.boundingBox.max.y, 'la pretina baja');
    assert.equal(top.waist.x, 1e6, 'la camisa no se recorta');
    assert.equal(pants.waist.z > 0, ropa === 'saco', 'en la rota, se vería la piel por los dientes');
  }
});

test('el desgaste sale de la apariencia, y el de las piezas manda si lo traen', async () => {
  const wear = async look => {
    const character = await createRealisticCharacter(look);
    const value = meshesOf(character, 'fabric').map(mesh => compiled(mesh.material).uniforms.uStreetWear.value);
    character.dispose();
    return value[0];
  };
  assert.equal(await wear({ real: SIMPLE }), 1, 'sin dato, el inicial');
  assert.equal(await wear({ desgaste: 1, real: SIMPLE }), .5);
  assert.equal(await wear({ desgaste: 2, real: { ...SIMPLE, desgaste: 0 } }), 0);
});

test('tonos: pasan por el catálogo, los rotos se quitan y el uniforme manda', async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(normalizeReal(catalog, { tonos: TONOS }).tonos, TONOS);
  assert.equal('tonos' in normalizeReal(catalog, {}), false);
  assert.equal('tonos' in normalizeReal(catalog, { tonos: { arriba: 'azul', abajo: '#556677' } }), false);
  const tint = async look => {
    const character = await createRealisticCharacter(look);
    const { uniforms } = compiled(meshesOf(character, 'fabric')[0].material);
    character.dispose();
    return uniforms.uStreetTint.value;
  };
  assert.equal(await tint({ real: { ...SIMPLE, ropa: 'camisa', tonos: TONOS } }), 1);
  assert.equal(await tint({ real: { ...SIMPLE, ropa: 'camisa' } }), 0, 'sin tonos queda la textura original');
  assert.equal(await tint({ uniforme: '#112233', real: { ...SIMPLE, ropa: 'camisa', tonos: TONOS } }), 0, 'el uniforme ya tiene su color');
});
