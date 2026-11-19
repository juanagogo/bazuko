import * as THREE from 'three';

const SEED = 0x6a09e667;
const STEPS = 440, STRETCH_CELLS = 40;
const BLADES = ['#5b744c', '#75885c', '#6b7d51', '#7b8054'].map(color => new THREE.Color(color));
const DRY = new THREE.Color('#a79665'), MUD = new THREE.Color('#424832'), HEAD = new THREE.Color('#664635');
const SHOOT = new THREE.Color('#6e8256'), SEDGE = new THREE.Color('#667c4e');

// Azar propio: nunca gasta el de la ciudad.
const rand = (i, k) => {
  let n = Math.imul(i + 1, 374761393) ^ Math.imul(k + 1, 668265263) ^ SEED;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** Tramos con juncos y tramos limpios a lo largo de la orilla. */
function stretch(i) {
  const t = i / STEPS * STRETCH_CELLS, cell = Math.floor(t), f = t - cell;
  const s = f * f * (3 - 2 * f);
  const a = rand(cell % STRETCH_CELLS, 9001), b = rand((cell + 1) % STRETCH_CELLS, 9001);
  return a + (b - a) * s;
}

/** Matas de junco y enea en la línea de agua: solo se ven, no estorban el paso. */
export function planLakeReeds(lake, heightAt, skip = () => false) {
  const clumps = [];
  for (let i = 0; i < STEPS; i++) {
    if (stretch(i) < .54 || rand(i, 0) < .22) continue;
    const angle = (i + rand(i, 1) * .8) / STEPS * Math.PI * 2;
    const radius = .972 + rand(i, 2) * .05;
    const x = lake.lakeX + Math.cos(angle) * lake.radiusX * radius;
    const z = lake.lakeZ + Math.sin(angle) * lake.radiusZ * radius;
    if (skip(x, z)) continue;
    const ground = heightAt(x, z);
    if (!Number.isFinite(ground)) continue;
    clumps.push({ x, z, y: Math.min(ground, lake.surfaceY + .12) - .04, seed: i,
      scale: .75 + rand(i, 3) * .6, blades: 6 + Math.floor(rand(i, 4) * 5) });
  }
  return clumps;
}

/** Hojas de una mata: salen de una cepa apretada y se abren hacia afuera; las de la orilla, más cortas y más caídas. */
export function reedBlades(clump) {
  const blades = [];
  for (let b = 0; b < clump.blades + 2; b++) {
    const k = b * 12 + 10, spread = rand(clump.seed, k) * Math.PI * 2, out = Math.sqrt(rand(clump.seed, k + 1));
    const bx = clump.x + Math.cos(spread) * out * .11, bz = clump.z + Math.sin(spread) * out * .11;
    const length = (.42 + rand(clump.seed, k + 2) * 1.08) * clump.scale * (1 - .38 * out);
    const lean = Math.min(.72, .1 + out * .32 + rand(clump.seed, k + 4) * .3);
    const leanYaw = spread + (rand(clump.seed, k + 5) - .5) * 1.2;
    const lx = Math.cos(leanYaw) * lean * length, lz = Math.sin(leanYaw) * lean * length;
    blades.push({ k, bx, bz, length, lean, leanYaw, lx, lz, height: length * (1 - .5 * lean * lean) });
  }
  return blades;
}

export function buildLakeReeds(lake, heightAt, skip = () => false) {
  const positions = [], normals = [], colors = [], indices = [];
  const color = new THREE.Color(), root = new THREE.Color(), tip = new THREE.Color();
  const vertex = (x, y, z, nx, ny, nz, tint, shade = 1) => {
    positions.push(x, y, z); normals.push(nx, ny, nz);
    colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
    return positions.length / 3 - 1;
  };

  function blade(x, y, z, dx, dz, height, yaw, width, tint, drying, curved) {
    const sideX = Math.cos(yaw), sideZ = Math.sin(yaw);
    const nx = -sideZ, nz = sideX;
    root.copy(tint).lerp(MUD, .32);
    tip.copy(tint).lerp(DRY, drying);
    const left = vertex(x - sideX * width * .58, y, z - sideZ * width * .58, nx, .58, nz, root, .84);
    const right = vertex(x + sideX * width * .58, y, z + sideZ * width * .58, nx, .58, nz, root, .95);
    const end = vertex(x + dx, y + height, z + dz, nx, .67, nz, tip);
    if (!curved) {
      const middle = vertex(x + dx * .48 + sideX * width, y + height * .57,
        z + dz * .48 + sideZ * width, nx, .55, nz, tint);
      indices.push(left, right, middle, left, middle, end);
      return;
    }

    // Dos quiebres suaves acercan la forma a una cinta doblada, con el hombro más ancho.
    const loX = x + dx * .23, loZ = z + dz * .23;
    const hiX = x + dx * .59, hiZ = z + dz * .59;
    const loY = y + height * .49, hiY = y + height * .83;
    const a = vertex(loX - sideX * width, loY, loZ - sideZ * width, nx, .52, nz, tint, .86);
    const b = vertex(loX + sideX * width, loY, loZ + sideZ * width, nx, .61, nz, tint, 1.08);
    const c = vertex(hiX - sideX * width * .68, hiY, hiZ - sideZ * width * .68, nx, .57, nz, tint, .89);
    const d = vertex(hiX + sideX * width * .68, hiY, hiZ + sideZ * width * .68, nx, .73, nz, tint, 1.04);
    indices.push(left, right, a, right, b, a, a, b, c, b, d, c, c, d, end);
  }

  function seedHead(x, y, z, yaw, radius, height) {
    const first = positions.length / 3;
    for (let i = 0; i < 3; i++) {
      const angle = yaw + i * Math.PI * 2 / 3;
      const nx = Math.cos(angle), nz = Math.sin(angle), shade = .84 + i * .085;
      vertex(x + radius * nx, y, z + radius * nz, nx, .12, nz, HEAD, shade);
      vertex(x + radius * .86 * nx, y + height, z + radius * .86 * nz, nx, .28, nz, HEAD, shade);
    }
    for (let i = 0; i < 3; i++) {
      const a = first + i * 2, b = first + ((i + 1) % 3) * 2;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    indices.push(first + 1, first + 5, first + 3);
  }

  function stalkWithHead(x, y, z, dx, dz, height, yaw) {
    for (let i = 0; i < 2; i++) {
      const angle = yaw + i * Math.PI / 2, sx = Math.cos(angle), sz = Math.sin(angle);
      const a = vertex(x - sx * .019, y, z - sz * .019, -sz, .55, sx, SHOOT, .82);
      const b = vertex(x + sx * .019, y, z + sz * .019, -sz, .55, sx, SHOOT);
      const c = vertex(x + dx - sx * .012, y + height, z + dz - sz * .012, -sz, .55, sx, SHOOT, .92);
      const d = vertex(x + dx + sx * .012, y + height, z + dz + sz * .012, -sz, .55, sx, SHOOT);
      indices.push(a, b, c, b, d, c);
    }
    seedHead(x + dx * .95, y + height * .95, z + dz * .95, yaw, .024, .115);
  }

  for (const clump of planLakeReeds(lake, heightAt, skip)) {
    const enea = rand(Math.floor(clump.seed / 4), 9812) < .56;
    const leaves = reedBlades(clump).sort((a, b) => b.height - a.height);
    for (const [i, { k, bx, bz, leanYaw, lx, lz, height }] of leaves.entries()) {
      const yaw = leanYaw + Math.PI / 2 + (rand(clump.seed, k + 3) - .5) * .95;
      const spread = enea ? 1.24 : .93;
      const start = heightAt(bx, bz);
      const y = Number.isFinite(start) ? Math.min(start - .032, clump.y) : clump.y;
      const hasHead = i === 0 && enea && rand(clump.seed, 8120) > .26;
      if (hasHead || (!enea && i < 3)) {
        const h = Math.min(1.52, Math.max(.83, height * 1.14));
        if (hasHead) stalkWithHead(bx, y, bz, lx * .22, lz * .22, h * .89, yaw);
        else blade(bx, y, bz, lx * .24, lz * .24, h, yaw, .016, SHOOT, .24, false);
        continue;
      }
      const curved = enea ? i === 1 || i === 2 : i === 3 || i === 4;
      const width = (curved ? .023 : .014) + rand(clump.seed, k + 9) * .014;
      color.copy(BLADES[Math.floor(rand(clump.seed, k + 6) * BLADES.length)]);
      if (rand(clump.seed, k + 10) < .19) color.lerp(DRY, .74);
      blade(bx, y, bz, lx * spread, lz * spread, Math.min(1.38, height * .96),
        yaw, width, color, .12 + rand(clump.seed, k + 7) * .33, curved);
    }

    // Brotes bajos en la misma mancha, en barro somero. Quedan libres los claros entre matas.
    if (stretch(clump.seed) < .64 || rand(clump.seed, 6100) < .42) continue;
    const outward = Math.atan2((clump.z - lake.lakeZ) / lake.radiusZ ** 2,
      (clump.x - lake.lakeX) / lake.radiusX ** 2);
    const offset = outward + Math.PI + (rand(clump.seed, 6101) - .5) * 1.9;
    const distance = .36 + rand(clump.seed, 6102) * .43;
    const x = clump.x + Math.cos(offset) * distance, z = clump.z + Math.sin(offset) * distance;
    const y = heightAt(x, z);
    if (!Number.isFinite(y) || y < lake.surfaceY - .28 || y > lake.surfaceY + .18 || skip(x, z)) continue;
    for (let i = 0; i < 4; i++) {
      const heading = i * Math.PI / 2 + rand(clump.seed, 6120 + i) * .9;
      const length = .22 + rand(clump.seed, 6124 + i) * .30;
      blade(x, y - .024, z, Math.cos(heading) * length * .65, Math.sin(heading) * length * .65,
        length, heading + Math.PI / 2, .022, SEDGE, .14, false);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.normalizeNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({ name: 'Juncos de la orilla', vertexColors: true, side: THREE.DoubleSide });
  const reeds = new THREE.Mesh(geometry, material);
  reeds.name = 'Juncos y eneas de la orilla del lago';
  reeds.receiveShadow = true;
  reeds.userData.noMerge = true;
  return reeds;
}
