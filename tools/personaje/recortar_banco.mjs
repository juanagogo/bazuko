// Deja en un GLB solo el esqueleto y los clips pedidos, sin mallas ni texturas, para que el juego
// no descargue lo que no anima. Se conservan las rotaciones de todos los huesos y la traslación de
// la cadera; nada más hace falta para adaptar un clip a otro cuerpo.
//
//   node tools/personaje/recortar_banco.mjs entrada.glb salida.glb Clip1 Clip2:nombreNuevo ...
import fs from 'node:fs';

const [input, output, ...requested] = process.argv.slice(2);
if (!input || !output || !requested.length) throw new Error('Uso: recortar_banco.mjs entrada.glb salida.glb Clip1 Clip2:nombreNuevo ...');

const data = fs.readFileSync(input);
if (data.readUInt32LE(0) !== 0x46546c67) throw new Error(`${input} no es un GLB`);
const jsonLength = data.readUInt32LE(12);
const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;

const wanted = new Map(requested.map(item => {
  const [name, rename] = item.split(':');
  return [name, rename ?? name];
}));
const isHips = name => /hips$/i.test((name ?? '').replace(/[^a-z0-9]/gi, ''));
const bytes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

const accessors = [], views = [], chunks = [];
let offset = 0;
const accessorIndex = new Map();
function keep(index) {
  if (accessorIndex.has(index)) return accessorIndex.get(index);
  const source = gltf.accessors[index];
  const view = gltf.bufferViews[source.bufferView];
  const size = sizes[source.componentType] * bytes[source.type];
  const stride = view.byteStride ?? size;
  const start = binStart + (view.byteOffset ?? 0) + (source.byteOffset ?? 0);
  // Se reescribe sin relleno entre elementos, aunque la vista original tuviera otro paso.
  const chunk = Buffer.alloc(source.count * size);
  for (let i = 0; i < source.count; i++) data.copy(chunk, i * size, start + i * stride, start + i * stride + size);
  const padding = (4 - offset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
  views.push({ buffer: 0, byteOffset: offset, byteLength: chunk.length });
  chunks.push(chunk);
  offset += chunk.length;
  const { sparse, ...plain } = source;
  if (sparse) throw new Error('Accesor disperso sin soporte');
  accessors.push({ ...plain, bufferView: views.length - 1, byteOffset: 0 });
  accessorIndex.set(index, accessors.length - 1);
  return accessors.length - 1;
}

const animations = [];
for (const animation of gltf.animations ?? []) {
  if (!wanted.has(animation.name)) continue;
  const samplers = [], channels = [], remap = new Map();
  for (const channel of animation.channels) {
    const { node, path } = channel.target;
    if (path === 'scale' || (path === 'translation' && !isHips(gltf.nodes[node].name))) continue;
    if (!remap.has(channel.sampler)) {
      const sampler = animation.samplers[channel.sampler];
      remap.set(channel.sampler, samplers.length);
      samplers.push({ ...sampler, input: keep(sampler.input), output: keep(sampler.output) });
    }
    channels.push({ sampler: remap.get(channel.sampler), target: channel.target });
  }
  animations.push({ ...animation, name: wanted.get(animation.name), samplers, channels });
  wanted.delete(animation.name);
}
if (wanted.size) throw new Error(`Clips que no están en ${input}: ${[...wanted.keys()].join(', ')}`);

const nodes = gltf.nodes.map(({ mesh, skin, ...node }) => node);
// Sin una piel el cargador no reconoce los huesos: se deja la lista de articulaciones, sin matrices.
const skins = (gltf.skins ?? []).slice(0, 1).map(({ joints, skeleton, name }) => ({ joints, ...(skeleton != null ? { skeleton } : {}), ...(name ? { name } : {}) }));
const out = {
  asset: { version: '2.0', generator: 'Vagabundo animation bank' },
  scene: gltf.scene ?? 0, scenes: gltf.scenes, nodes, skins, animations, accessors,
  bufferViews: views, buffers: [{ byteLength: offset }]
};
const json = Buffer.from(JSON.stringify(out));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
const chunkHeader = (length, type) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(length, 0); head.writeUInt32LE(type, 4);
  return head;
};
fs.writeFileSync(output, Buffer.concat([header, chunkHeader(jsonPadded.length, 0x4e4f534a), jsonPadded, chunkHeader(binPadded.length, 0x004e4942), binPadded]));
console.log(`${output}: ${animations.map(a => a.name).join(', ')}; ${(fs.statSync(output).size / 1024).toFixed(0)} KiB`);
