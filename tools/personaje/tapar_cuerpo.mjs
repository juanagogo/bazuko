// Anota en el catálogo qué parte del cuerpo queda tapada por cada prenda, para no dibujarla.
//
// La piel que queda debajo de la ropa no se ve de pie, pero al sentarse o arrodillarse la rodilla y la
// cadera atraviesan la tela. `exportar_variantes.py` deja dos huecos: el cuerpo liviano no tiene lista
// alguna (la gente lejana enseñaba parches de piel enormes) y al completo le faltan las prendas que no
// traen grupos de borrado, como el saco y la camiseta rota con su pantalón cargo.
//
// Un vértice se da por tapado si todos los rayos que salen de él hacia afuera, en abanico, chocan con la
// prenda: el borde de una manga o un agujero de la tela dejan escapar alguno y esa piel se conserva. Se
// comparan los dos en su pose de atadura. `ocultaLod` usa los índices del cuerpo liviano y `oculta` sigue
// usando `_VID`. Se corre después de `exportar_variantes.py`; correrlo otra vez no cambia nada:
//
//   node tools/personaje/tapar_cuerpo.mjs
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'public/models/personaje';
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const COMPONENT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

const REACH = .16; // hasta dónde puede quedar la tela de un pantalón ancho
const BEHIND = .02; // la tela ceñida puede quedar un poco por debajo de la piel
const FAN = 50 * Math.PI / 180; // abertura del abanico alrededor de la normal
const FAN_RAYS = 6;

function readGltf(file) {
  const gltf = JSON.parse(fs.readFileSync(file));
  const bin = fs.readFileSync(path.join(path.dirname(file), gltf.buffers[0].uri));
  const read = index => {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    const Type = COMPONENT[accessor.componentType];
    const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const length = accessor.count * SIZES[accessor.type];
    return new Type(bin.buffer.slice(start, start + length * Type.BYTES_PER_ELEMENT));
  };
  return { gltf, read };
}

function readBody(file, nodeName) {
  const { gltf, read } = readGltf(file);
  const node = gltf.nodes.find(item => item.name === nodeName);
  if (!node) throw new Error(`${file} no trae ${nodeName}`);
  const { attributes } = gltf.meshes[node.mesh].primitives[0];
  return {
    positions: read(attributes.POSITION),
    normals: read(attributes.NORMAL),
    ids: attributes._VID == null ? null : read(attributes._VID)
  };
}

/** Todos los triángulos de una prenda como lista plana de nueve números por triángulo. */
function readTriangles(file) {
  const { gltf, read } = readGltf(file);
  const out = [];
  for (const node of gltf.nodes) {
    if (node.mesh == null) continue;
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const positions = read(primitive.attributes.POSITION);
      for (const index of read(primitive.indices)) out.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    }
  }
  return Float32Array.from(out);
}

/** Choque de un rayo con un triángulo (Möller-Trumbore); la tela se ve por las dos caras. */
function hits(ox, oy, oz, dx, dy, dz, t, i) {
  const ax = t[i], ay = t[i + 1], az = t[i + 2];
  const ex = t[i + 3] - ax, ey = t[i + 4] - ay, ez = t[i + 5] - az;
  const fx = t[i + 6] - ax, fy = t[i + 7] - ay, fz = t[i + 8] - az;
  const px = dy * fz - dz * fy, py = dz * fx - dx * fz, pz = dx * fy - dy * fx;
  const det = ex * px + ey * py + ez * pz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * ez - sz * ey, qy = sz * ex - sx * ez, qz = sx * ey - sy * ex;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const distance = (fx * qx + fy * qy + fz * qz) * inv;
  return distance > 0 && distance < REACH + BEHIND;
}

/** Índices de los vértices del cuerpo a los que la prenda envuelve por completo. */
function enclosed(body, triangles) {
  const covered = [];
  const count = body.positions.length / 3;
  const total = triangles.length / 9;
  const near = new Int32Array(total);
  const reach = REACH + BEHIND;
  for (let vertex = 0; vertex < count; vertex++) {
    const x = body.positions[vertex * 3], y = body.positions[vertex * 3 + 1], z = body.positions[vertex * 3 + 2];
    const nx = body.normals[vertex * 3], ny = body.normals[vertex * 3 + 1], nz = body.normals[vertex * 3 + 2];
    // Solo interesan los triángulos al alcance del vértice.
    let nearCount = 0;
    for (let index = 0; index < total; index++) {
      const i = index * 9;
      const low = (a, b, c, o) => Math.min(a, b, c) > o + reach;
      const high = (a, b, c, o) => Math.max(a, b, c) < o - reach;
      const ax = triangles[i], ay = triangles[i + 1], az = triangles[i + 2];
      const bx = triangles[i + 3], by = triangles[i + 4], bz = triangles[i + 5];
      const cx = triangles[i + 6], cy = triangles[i + 7], cz = triangles[i + 8];
      if (low(ax, bx, cx, x) || high(ax, bx, cx, x) || low(ay, by, cy, y) || high(ay, by, cy, y) || low(az, bz, cz, z) || high(az, bz, cz, z)) continue;
      near[nearCount++] = i;
    }
    if (!nearCount) continue;
    // Dos ejes de la tangente para abrir el abanico.
    const hx = Math.abs(ny) < .9 ? 0 : 1, hy = Math.abs(ny) < .9 ? 1 : 0;
    let tx = ny * 0 - nz * hy, ty = nz * hx - nx * 0, tz = nx * hy - ny * hx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const ox = x - nx * BEHIND, oy = y - ny * BEHIND, oz = z - nz * BEHIND;
    let all = true;
    for (let ray = 0; ray <= FAN_RAYS && all; ray++) {
      let dx = nx, dy = ny, dz = nz;
      if (ray) {
        const angle = (ray - 1) / FAN_RAYS * Math.PI * 2;
        const a = Math.sin(FAN) * Math.cos(angle), b = Math.sin(FAN) * Math.sin(angle), c = Math.cos(FAN);
        dx = nx * c + tx * a + bx * b; dy = ny * c + ty * a + by * b; dz = nz * c + tz * a + bz * b;
      }
      let hit = false;
      for (let k = 0; k < nearCount && !hit; k++) hit = hits(ox, oy, oz, dx, dy, dz, triangles, near[k]);
      all = hit;
    }
    if (all) covered.push(vertex);
  }
  return covered;
}

const WEARABLE = new Set();
const catalogFile = path.join(BASE, 'catalogo.json');
const catalog = JSON.parse(fs.readFileSync(catalogFile));
for (const cat of ['ropa', 'calzado']) for (const item of catalog.piezas[cat]) WEARABLE.add(item.id);

for (const body of catalog.cuerpos) {
  const folder = path.join(BASE, body.id);
  const full = readBody(path.join(folder, 'cuerpo.gltf'), 'personaje.body');
  const light = readBody(path.join(folder, 'lod', 'cuerpo.gltf'), 'personaje.body_lod');
  const report = [];
  for (const [id, piece] of Object.entries(body.piezas)) {
    if (!WEARABLE.has(id) || !piece.file) continue;
    const before = piece.oculta.length;
    const hidden = new Set(piece.oculta);
    for (const vertex of enclosed(full, readTriangles(path.join(folder, piece.file)))) hidden.add(Math.round(full.ids[vertex]));
    piece.oculta = [...hidden].sort((a, b) => a - b);
    if (piece.lod) piece.ocultaLod = enclosed(light, readTriangles(path.join(folder, piece.lod)));
    report.push(`${id} ${before}→${piece.oculta.length}/${piece.ocultaLod?.length ?? 0}`);
  }
  console.log(body.id, report.join(', '));
}
fs.writeFileSync(catalogFile, JSON.stringify(catalog));
