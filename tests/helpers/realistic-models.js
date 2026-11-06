// Carga los modelos realistas desde el disco en Node: catálogo por fetch y GLTF sin texturas WebP.
// Igual a los simulacros de tests/character-action-integration.test.js, para pruebas nuevas.
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = fileURLToPath(new URL('../../public/models/', import.meta.url));

export function mockRealisticModels(test) {
  const originalFetch = globalThis.fetch;
  test.before(() => {
    mock.method(globalThis, 'fetch', (url, ...rest) => url === '/models/personaje/catalogo.json'
      ? Promise.resolve(new Response(readFileSync(path.join(models, 'personaje/catalogo.json'))))
      : originalFetch(url, ...rest));
    mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
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
    });
  });
  test.after(() => mock.restoreAll());
}

/** Compila a medias un material como lo haría el renderer: corre sus onBeforeCompile sobre el shader estándar. */
export function fakeCompile(material) {
  const lib = material.isMeshLambertMaterial ? THREE.ShaderLib.lambert : THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile?.(shader, null);
  return shader;
}
