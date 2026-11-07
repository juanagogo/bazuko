// Comprime sin pérdida los .bin de los personajes con EXT_meshopt_compression.
// Lo usa `npm run build` sobre dist/models/personaje (ver vite.config.js): el repositorio, el
// exportador de Blender y las pruebas siguen trabajando con los archivos sin comprimir.
//   node tools/personaje/comprimir-mallas.mjs <carpeta|archivo.gltf> ...
// Solo cambia cómo se guardan los bufferViews y quita la sangría del JSON: nodos, materiales,
// texturas externas y extras quedan iguales, y cada vista, al decodificarla, devuelve exactamente
// los mismos bytes (se comprueba al escribir). Atributos en modo ATTRIBUTES e índices en INDICES:
// TRIANGLES rota los vértices dentro de cada triángulo, así que no se usa.
// Un archivo ya comprimido se deja como está.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { esPrincipal } from '../esPrincipal.mjs';

const EXT = 'EXT_meshopt_compression';
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const pad4 = n => (n + 3) & ~3;

export async function compressGltf(file) {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (json.extensionsUsed?.includes(EXT)) return null;
  if (json.buffers.length !== 1 || !json.buffers[0].uri) throw new Error(`${file}: se espera un único .bin externo.`);
  const binPath = join(dirname(file), decodeURIComponent(json.buffers[0].uri));
  const source = readFileSync(binPath);
  const indexViews = new Set();
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    if (primitive.indices !== undefined) indexViews.add(json.accessors[primitive.indices].bufferView);
  }
  const accessorOf = new Map();
  json.accessors.forEach(accessor => {
    if (accessor.bufferView === undefined || accessor.sparse) return;
    if (accessorOf.has(accessor.bufferView)) accessorOf.set(accessor.bufferView, false);
    else accessorOf.set(accessor.bufferView, accessor);
  });
  const chunks = [];
  let offset = 0, fallbackLength = 0;
  json.bufferViews.forEach((view, index) => {
    const accessor = accessorOf.get(index);
    const bytes = source.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    let encoded = null, extension = null;
    if (accessor && !view.byteStride) {
      const stride = COMPONENT_BYTES[accessor.componentType] * TYPE_SIZE[accessor.type];
      const isIndex = indexViews.has(index);
      const mode = isIndex ? 'INDICES' : 'ATTRIBUTES';
      const valid = accessor.count * stride === view.byteLength && (isIndex ? stride === 2 || stride === 4 : stride % 4 === 0 && stride <= 256);
      if (valid) {
        encoded = MeshoptEncoder.encodeGltfBuffer(bytes, accessor.count, stride, mode);
        const check = new Uint8Array(view.byteLength);
        MeshoptDecoder.decodeGltfBuffer(check, accessor.count, stride, encoded, mode);
        if (!Buffer.from(check).equals(bytes)) throw new Error(`${file}: la vista ${index} no se decodifica igual.`);
        extension = { buffer: 0, byteOffset: offset, byteLength: encoded.length, byteStride: stride, count: accessor.count, mode };
      }
    }
    const data = encoded ?? bytes;
    if (extension) {
      view.buffer = 1;
      view.byteOffset = fallbackLength;
      fallbackLength += pad4(view.byteLength);
      view.extensions = { ...view.extensions, [EXT]: extension };
    } else {
      view.buffer = 0;
      view.byteOffset = offset;
    }
    chunks.push(Buffer.from(data), Buffer.alloc(pad4(data.length) - data.length));
    offset += pad4(data.length);
  });
  const output = Buffer.concat(chunks);
  json.buffers[0].byteLength = output.length;
  // Búfer de respaldo sin datos: el cargador lo reserva y lo llena al decodificar.
  json.buffers[1] = { byteLength: fallbackLength, extensions: { [EXT]: { fallback: true } } };
  json.extensionsUsed = [...(json.extensionsUsed ?? []), EXT];
  json.extensionsRequired = [...(json.extensionsRequired ?? []), EXT];
  writeFileSync(binPath, output);
  writeFileSync(file, JSON.stringify(json));
  return { before: source.length, after: output.length };
}

export async function compressPaths(paths) {
  let before = 0, after = 0, files = 0;
  for (const file of paths.flatMap(path => statSync(path).isDirectory() ? walk(path) : [path])) {
    const result = await compressGltf(file);
    if (!result) continue;
    files++; before += result.before; after += result.after;
  }
  return { files, before, after };
}

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.gltf') ? [path] : [];
});

if (esPrincipal(import.meta.url)) {
  if (process.argv.length < 3) throw new Error('Indicar carpetas o archivos .gltf; normalmente lo hace npm run build sobre dist/.');
  const { files, before, after } = await compressPaths(process.argv.slice(2));
  console.log(`${files} archivos: ${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB.`);
}
