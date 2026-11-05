import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { compressPaths } from '../tools/personaje/comprimir-mallas.mjs';

// FileLoader informa el progreso de los data URI largos con ProgressEvent, que Node no trae.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {};

const SOURCE = new URL('../public/models/personaje/hombre-joven/', import.meta.url);

/** glTF en memoria: búfer como data URI y texturas sustituidas, como en el resto de pruebas. */
async function parse(dir, name) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  for (const buffer of json.buffers) {
    if (buffer.uri) buffer.uri = 'data:application/octet-stream;base64,' + fs.readFileSync(path.join(dir, buffer.uri)).toString('base64');
  }
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) for (const key of Object.keys(material)) if (/Texture$/.test(key)) delete material[key];
  for (const material of json.materials ?? []) if (material.pbrMetallicRoughness) for (const key of Object.keys(material.pbrMetallicRoughness)) if (/Texture$/.test(key)) delete material.pbrMetallicRoughness[key];
  json.extensionsUsed = json.extensionsUsed?.filter(ext => ext !== 'EXT_texture_webp');
  json.extensionsRequired = json.extensionsRequired?.filter(ext => ext !== 'EXT_texture_webp');
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), '');
}

function meshes(gltf) {
  const out = [];
  gltf.scene.traverse(object => { if (object.isMesh) out.push(object); });
  return out;
}

test('la compresión de las mallas de personaje devuelve los mismos vértices, índices y esqueleto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mallas-'));
  try {
    for (const name of ['cuerpo', 'camisa', 'cola']) {
      for (const ext of ['gltf', 'bin']) fs.copyFileSync(new URL(`${name}.${ext}`, SOURCE), path.join(dir, `${name}.${ext}`));
    }
    const { files, before, after } = await compressPaths([dir]);
    assert.equal(files, 3);
    assert.ok(after < before * .8, `los .bin bajan al menos un 20 % (${before} → ${after})`);
    assert.equal((await compressPaths([dir])).files, 0, 'un archivo ya comprimido no se vuelve a tocar');
    for (const name of ['cuerpo.gltf', 'camisa.gltf', 'cola.gltf']) {
      const original = meshes(await parse(SOURCE.pathname, name));
      const packed = meshes(await parse(dir, name));
      assert.deepEqual(packed.map(m => m.name), original.map(m => m.name));
      packed.forEach((mesh, i) => {
        const expected = original[i].geometry;
        assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(), Object.keys(expected.attributes).sort());
        for (const [key, attribute] of Object.entries(expected.attributes)) {
          assert.equal(mesh.geometry.attributes[key].array.constructor, attribute.array.constructor, `${name} ${key}`);
          assert.deepEqual(mesh.geometry.attributes[key].array, attribute.array, `${name} ${key}`);
        }
        assert.deepEqual(mesh.geometry.index?.array, expected.index?.array);
        if (mesh.isSkinnedMesh) {
          assert.deepEqual(mesh.skeleton.bones.map(b => b.name), original[i].skeleton.bones.map(b => b.name));
          assert.deepEqual(mesh.skeleton.boneInverses.map(m => m.elements), original[i].skeleton.boneInverses.map(m => m.elements));
        }
        assert.equal(mesh.material.name, original[i].material.name);
      });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
