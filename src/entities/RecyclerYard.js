import * as THREE from 'three';
import { rng } from '../world/bogota/textures.js';
import { withVisualRandom } from '../world/bogota/VisualRandom.js';

const TAU = Math.PI * 2;
const PAPER = 0, EDGE = 1, WEAVE = 2, PET = 3, GLASS = 4, STEEL = 5, RUST = 6, STRAP = 7;
const ROUGHNESS = [.93, .97, .89, .38, .28, .51, .82, .67];
const METALNESS = [0, 0, 0, 0, 0, .42, .12, .09];
const tones = (...values) => values.map(value => new THREE.Color(value));
const cardboard = tones('#a48155', '#b69163', '#967049', '#9a784f', '#c4a472', '#806449', '#aa8459');
const tape = tones('#aa9271', '#c6b396', '#9d8f75');
const strapping = tones('#36372b', '#555448', '#334638', '#7b776b');
const bags = tones('#b7b9a4', '#c7b69a', '#b1b7a5', '#a09a85', '#686553', '#6a7465');
const plastic = tones('#b8cdca', '#8aafb2', '#a2bca8', '#93a98a', '#ced5c4', '#7d9b79');
const glass = tones('#586e48', '#779377', '#896549', '#765133', '#a5afa1', '#687c4b');
const labels = tones('#abb5a3', '#608698', '#926149', '#e1d5b8', '#6b8772', '#b1a37b');
const metals = tones('#8d9691', '#aeb4a9', '#6e7777', '#6c7369', '#866d56', '#9e6e50', '#a98060', '#655046');

export const RECYCLER_CART = { x: -3.05, z: -.7, yaw: Math.PI / 2 - .12, wheelX: -.1, track: .39 * 1.22, footX: .68 };

const spread = (random, amount) => (random() - .5) * amount;
const choose = (set, random) => set[Math.floor(random() * set.length)];
const degrees = (i, count) => TAU * i / count;
const rgba = (data, offset, r, g = r, b = r) => data.set([r, g, b, 255], offset);

/** Atlas local. Una textura da las fibras y el color, la otra reúne relieve, rugosidad y metalicidad. */
function maps() {
  const width = 128, rows = 64, height = rows * 8, length = width * height * 4;
  const color = new Uint8Array(length), properties = new Uint8Array(length), random = rng(80216);
  for (let band = 0; band < 8; band++) for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / rows, grain = spread(random, 22);
    const stain = Math.sin(TAU * (u * 2.7 + v * 1.8)) * Math.sin(TAU * (u * 3.3 - v * 4.1));
    let relief = .5 + grain * .006, value = 233 + grain * .50 + stain * 11;
    if (band === PAPER) {
      const fold = Math.sin(TAU * (v * 3.5 + u * .37));
      relief += Math.max(0, fold) ** 14 * .17;
      value += fold * 2 - 9 * Math.max(0, fold) ** 9;
    }
    if (band === EDGE) {
      const wave = Math.sin(TAU * (u * 37.4 + .055 * Math.sin(TAU * v * 4)));
      const plies = Math.cos(TAU * (v * 6.7 + u * .07));
      relief += .18 * wave + .095 * plies;
      value += wave * 9 + plies * 10 - 23 * Math.max(0, -wave * plies);
    }
    if (band === WEAVE) {
      const fiber = Math.sin(TAU * u * 31) * Math.sin(TAU * v * 33);
      const pleat = Math.cos(TAU * (u * 10 + Math.sin(TAU * v) * .14));
      relief += fiber * .14 + pleat * .07;
      value += fiber * 10 + pleat * 8 + stain * 5;
    }
    if (band === PET || band === GLASS) {
      const scuff = Math.cos(TAU * (u * 5 + v * .4));
      relief += scuff * .015;
      value += scuff * 8 + grain * (band === GLASS ? .17 : .31);
    }
    if (band === STEEL || band === RUST) {
      const scratch = Math.sin(TAU * (u * 15 + v * .41));
      relief += stain * .1 + scratch * (band === STEEL ? .055 : .025);
      value += scratch * 4 + stain * (band === STEEL ? 15 : 26);
    }
    const offset = ((band * rows + y) * width + x) * 4;
    rgba(color, offset, THREE.MathUtils.clamp(Math.round(value), 172, 255));
    rgba(properties, offset, Math.round(255 * relief), Math.round(255 * (ROUGHNESS[band] + grain * .0017)),
      Math.round(255 * METALNESS[band]));
  }
  const texture = (pixels, space) => {
    const map = new THREE.DataTexture(pixels, width, height);
    map.colorSpace = space;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = 4;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
  };
  const surface = texture(properties, THREE.NoColorSpace);
  return { map: texture(color, THREE.SRGBColorSpace), roughnessMap: surface, metalnessMap: surface, bumpMap: surface };
}

const vertical = new THREE.Vector3(0, 1, 0);
const rotation = angles => new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles));
const transform = (origin, angles) => {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...origin), rotation(angles), new THREE.Vector3(1, 1, 1));
  const p = new THREE.Vector3();
  return local => p.fromArray(local).applyMatrix4(matrix).toArray();
};

class YardMesh {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uv = [];
    this.color = [];
    this.index = [];
  }

  vertex(point, normal, material, tone, u, v, light = 1) {
    const index = this.positions.length / 3;
    this.positions.push(...point);
    this.normals.push(...normal);
    this.color.push(tone.r * light, tone.g * light, tone.b * light);
    this.uv.push(.026 + .948 * u, (material + .078 + .844 * v) / 8);
    return index;
  }

  face(points, material, tone, uv = [[0, 0], [1, 0], [1, 1], [0, 1]], light = 1) {
    const eye = new THREE.Vector3(...points[0]), edge = new THREE.Vector3(...points[1]).sub(eye);
    const normal = edge.cross(new THREE.Vector3(...points.at(-1)).sub(eye)).normalize().toArray();
    const indices = points.map((p, i) => this.vertex(p, normal, material, tone, ...uv[i], light));
    this.index.push(...indices.slice(0, 3));
    if (indices.length === 4) this.index.push(indices[0], indices[2], indices[3]);
  }

  /** Superficie continua. La costura del UV duplica el punto, con la misma normal a ambos lados. */
  profile(rings, material, tone, shading = () => 1) {
    const sides = rings[0].length, across = new THREE.Vector3(), along = new THREE.Vector3(), p = new THREE.Vector3();
    const vertices = rings.map((ring, j) => Array.from({ length: sides + 1 }, (_, i) => {
      const k = i % sides, u = i / sides, v = j / (rings.length - 1);
      across.fromArray(ring[(k + 1) % sides]).sub(p.fromArray(ring[(k + sides - 1) % sides]));
      along.fromArray(rings[Math.min(j + 1, rings.length - 1)][k]).sub(p.fromArray(rings[Math.max(j - 1, 0)][k]));
      return this.vertex(ring[k], across.cross(along).normalize().toArray(),
        material, typeof tone === 'function' ? tone(j) : tone, u, v, shading(j, k));
    }));
    for (let j = 1; j < vertices.length; j++) for (let i = 0; i < sides; i++) {
      const a = vertices[j - 1][i], b = vertices[j - 1][i + 1], c = vertices[j][i + 1], d = vertices[j][i];
      this.index.push(a, b, c, a, c, d);
    }
  }

  piece(geometry, material, tone, position, quaternion = new THREE.Quaternion()) {
    const base = this.positions.length / 3, p = new THREE.Vector3(), n = new THREE.Vector3(), offset = new THREE.Vector3(...position);
    const { position: point, normal, uv } = geometry.attributes;
    for (let i = 0; i < point.count; i++) {
      p.fromBufferAttribute(point, i).applyQuaternion(quaternion).add(offset);
      n.fromBufferAttribute(normal, i).applyQuaternion(quaternion);
      this.vertex(p.toArray(), n.toArray(), material, tone, uv?.getX(i) ?? .5, uv?.getY(i) ?? .5);
    }
    if (geometry.index) for (const index of geometry.index.array) this.index.push(base + index);
    else for (let i = 0; i < point.count; i++) this.index.push(base + i);
    geometry.dispose();
  }

  box(size, material, tone, point, angles = [0, 0, 0]) {
    this.piece(new THREE.BoxGeometry(...size), material, tone, point, rotation(angles));
  }

  mesh() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    geometry.setIndex(this.index);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ ...maps(), vertexColors: true, roughness: 1, metalness: 1,
      bumpScale: .006, envMapIntensity: .32 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Material clasificado de la recicladora';
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.visualOnly = true;
    return mesh;
  }
}

const CORNERS = [[-.8, 1], [-.28, 1], [.29, 1], [.8, 1], [1, .74], [1, -.73], [.78, -1], [.24, -1], [-.32, -1], [-.8, -1], [-1, -.72], [-1, .74]];

/** Canto roto y caras de una plancha doblada. Las fibras se ven de frente, en varios estratos del fardo. */
function cardboardLayer(mesh, at, x, y, z, width, depth, height, tone, random, facing = false) {
  const points = CORNERS.map(([u, v], i) => {
    const px = x + u * width / 2 + spread(random, .029) * (1 - Math.abs(u) / 2);
    const pz = z + v * depth / 2 + spread(random, .043) * (1 - Math.abs(v) / 2);
    const ripple = spread(random, Math.min(.018, height * .52)) + .006 * Math.cos(i * 2);
    return [px, pz, ripple];
  });
  const upper = points.map(([px, pz, ripple]) => at([px, y + height + ripple, pz]));
  const lower = points.map(([px, pz, ripple]) => at([px, y + (y > .01 ? ripple * .38 : 0), pz]));
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    mesh.face([lower[i], lower[j], upper[j], upper[i]], EDGE, tone, undefined, .90 + random() * .20);
    if (facing) {
      const paperUv = index => [(points[index][0] - x) / width * .88 + .5, (points[index][1] - z) / depth * .88 + .5];
      mesh.face([at([x, y + height + .003, z]), upper[i], upper[j]], PAPER, tone, [[.5, .5], paperUv(i), paperUv(j)]);
    }
  }
}

function bale(mesh, floor, x, y, z, yaw, width, height, depth, seed) {
  const at = transform([x, floor + y, z], [0, yaw, 0]), random = rng(seed);
  const parts = 14, step = height / parts;
  for (let layer = 0; layer < parts; layer++) {
    const t = layer / (parts - 1), bulge = Math.sin(t * Math.PI) * .036;
    cardboardLayer(mesh, at, spread(random, .026), layer * step, spread(random, .027),
      width - .039 + bulge + spread(random, .029), depth - .037 + bulge + spread(random, .026),
      step * (.91 + random() * .20), choose(cardboard, random), random, true);
  }
  for (const strapX of [-width * .246, width * .249]) {
    const belt = choose(strapping.slice(0, 3), random), halfD = depth / 2;
    const points = [[.014, -halfD + .015], [.14 * height, -halfD - .004], [.49 * height, -halfD - .013],
      [.87 * height, -halfD + .004], [height - .012, -halfD + .021], [height + .013, -halfD + .06],
      [height + .017, halfD - .062], [height - .013, halfD - .017], [.57 * height, halfD + .012], [.014, halfD - .019]];
    const rim = (i, side) => at([strapX + side * .019 + .009 * Math.sin(i * .84 + seed), ...points[i]]);
    for (let i = 1; i < points.length; i++) mesh.face([rim(i - 1, 1), rim(i - 1, -1), rim(i, -1), rim(i, 1)], STRAP, belt);
    mesh.box([.054, .012, .035], STEEL, metals[2], at([strapX, height + .023, .072]), [0, yaw, 0]);
  }
  if (seed % 2 === 0) {
    // Un trozo de cinta vieja queda pegado sobre las láminas, con los extremos partidos.
    const top = height + .004;
    const points = [[-.144, top, -.067], [-.131, top, .015], [.16, top, .028], [.151, top, -.051]];
    mesh.face(points.map(at), PAPER, tape[seed % 3]);
  }
}

function cartLoad(mesh, floor) {
  const { x, z, yaw: angle } = RECYCLER_CART;
  const root = transform([x, floor, z], [0, angle, 0]), random = rng(13218);
  for (let i = 0; i < 8; i++) {
    const at = transform(root([spread(random, .10), .549 + i * .031, spread(random, .07)]), [0, angle + spread(random, .18), 0]);
    cardboardLayer(mesh, at, -.05, 0, 0, 1.18 + spread(random, .18), .65 + spread(random, .079), .034,
      choose(cardboard, random), random, true);
  }
  const at = transform(root([-.31, .785, -.025]), [0, angle - .15, .09]);
  cardboardLayer(mesh, at, 0, 0, 0, .62, .47, .076, cardboard[5], random, true);
  cardboardLayer(mesh, at, .016, .075, 0, .59, .43, .037, cardboard[4], random, true);
}

/** Penumbra corta que parte del punto real de contacto de las llantas y la pata de apoyo. */
export function buildCartContact(floor) {
  return withVisualRandom(() => {
    const { x, z, yaw, wheelX, track, footX } = RECYCLER_CART;
    const at = transform([x, floor + .004, z], [0, yaw, 0]);
    const positions = [], colors = [], index = [], sides = 12;
    for (const [px, pz, width, depth, strength] of [[wheelX, -track, .218, .142, .70], [wheelX, track, .218, .142, .70], [footX, 0, .119, .108, .55]]) {
      const rings = [0, .27, .55, .79, 1].map(r => Array.from({ length: sides }, (_, i) => {
        const a = degrees(i, sides), id = positions.length / 3;
        positions.push(...at([px + r * width * Math.sin(a), 0, pz + r * depth * Math.cos(a)]));
        colors.push(1, 1, 1, strength * (1 - r) ** 1.8);
        return id;
      }));
      for (let ring = 1; ring < rings.length; ring++) for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const [a, b, c, d] = [rings[ring - 1][i], rings[ring][i], rings[ring][j], rings[ring - 1][j]];
        index.push(a, b, c);
        if (ring > 1) index.push(a, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicMaterial({ color: '#281e17', vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Apoyo de la carreta';
    mesh.userData.visualOnly = true;
    mesh.renderOrder = 1;
    mesh.onBeforeRender = (_renderer, scene) => { material.opacity = .70 + .30 * (scene.userData.environmentDay ?? 1); };
    return mesh;
  });
}

const PET_PROFILE = [[0, .65], [.03, .93], [.09, 1], [.16, .91], [.23, .98], [.35, .95],
  [.46, .97], [.57, .87], [.66, .93], [.74, .90], [.83, .60], [.91, .35], [.965, .30], [.99, .31], [1, .14], [.974, .12]];
const GLASS_PROFILE = [[0, .78], [.026, .93], [.085, .99], [.22, 1], [.47, 1], [.61, .94], [.72, .58], [.80, .34],
  [.935, .29], [.958, .38], [.991, .38], [1, .23], [.972, .17], [.906, .16]];

/** Envase de vidrio con labio hueco o PET aplastado, con hombro, gollete y etiqueta desgarrada. */
function bottle(mesh, where, angles, length, radius, type, paint, random) {
  const rigid = type === GLASS, at = transform(where, angles), sides = rigid ? 10 : 9;
  const flat = rigid ? 1 : .47 + random() * .4, phase = random() * TAU;
  const dent = rigid ? .013 : .12 + random() * .12;
  const path = rigid ? GLASS_PROFILE : PET_PROFILE;
  const point = (t, r, angle) => {
    const side = Math.sin(angle), back = Math.cos(angle), body = Math.sin(Math.PI * t) ** 2;
    const pressed = 1 + dent * body * Math.cos(angle * 2 + phase + t * 8) + dent * .45 * Math.sin(angle * 3 - t * 17);
    const toe = !rigid && t < .1 ? .003 * Math.cos(angle * 5) : 0;
    return at([radius * r * side * pressed, length * (t - .5) + toe, radius * r * back * pressed * flat]);
  };
  const rings = path.map(([t, r]) => Array.from({ length: sides }, (_, i) => point(t, r, degrees(i, sides))));
  const cavity = paint.clone().multiplyScalar(.50);
  mesh.profile(rings, type, j => j >= path.length - 2 ? cavity : paint,
    (j, i) => .90 + .15 * Math.sin(i * TAU / sides + phase) ** 2 + .09 * Math.cos(j + i));
  // Se ven etiquetas viejas a pedazos y tapas en unos envases, con la misma curvatura de la botella.
  if (random() < (rigid ? .42 : .65)) {
    const label = choose(labels, random), start = random() * TAU, panels = rigid ? 6 : 5;
    const a = rigid ? .23 : .29, b = rigid ? .49 : .52;
    for (let i = 0; i < panels; i++) {
      const theta = start + i * .39, next = theta + .39;
      const pluck = t => i % 3 ? t : t + .011;
      mesh.face([point(a, 1.024, theta), point(pluck(a), 1.024, next), point(pluck(b), 1.020, next), point(b, 1.020, theta)],
        PAPER, label, [[i / panels, 0], [(i + 1) / panels, 0], [(i + 1) / panels, 1], [i / panels, 1]]);
    }
  }
  if (!rigid && random() < .55) {
    const cap = choose(labels, random);
    mesh.piece(new THREE.CylinderGeometry(radius * .34, radius * .35, .016, 9), STRAP, cap,
      at([0, length * .497, 0]), rotation(angles));
  }
}

function sack(mesh, floor, x, z, height, yaw, type, tone, seed) {
  const at = transform([x, floor, z], [0, yaw, 0]), random = rng(seed), phase = random() * TAU;
  const heavy = type === GLASS, rx = heavy ? .50 : .53, rz = heavy ? .48 : .49;
  const openness = heavy ? .067 : .083;
  const path = [[0, .75], [.042, .92], [.16, 1], [.34, .985], [.55, 1.002], [.75, .944], [.90, .902],
    [.97, .926], [1, .912], [1, .883], [.96, .834], [.84, .808], [.68, .73]];
  const cloth = (t, r, a, offset = 0) => {
    const dx = Math.sin(a), dz = Math.cos(a);
    const shape = a => Math.sign(a) * Math.abs(a) ** (heavy ? .71 : .86);
    const pull = (.024 * Math.sin(a * 4 + t * 6 + phase) + .021 * Math.cos(a * 9 - t * 5)) * Math.sin(Math.PI * .83 * t);
    const edge = t ** 3.1 * (openness * Math.cos(a - phase) + .044 * Math.cos(a * 3 + phase) + .025 * Math.sin(a * 6));
    return at([rx * (r + pull + offset) * shape(dx) + .053 * t * t, height * t + edge,
      rz * (r + pull + offset) * shape(dz) - .028 * t]);
  };
  const sideCount = 32;
  mesh.profile(path.map(([t, r]) => Array.from({ length: sideCount }, (_, i) => cloth(t, r, degrees(i, sideCount)))),
    WEAVE, j => j > 9 ? bags[3] : tone, (j, i) => {
      const folds = Math.sin(i * 2.1 + j * .38) * Math.cos(i * .93 - j * .24);
      return .82 + .17 * Math.min(1, j / 5) + .09 * folds + (j === 8 || j === 9 ? .095 : 0);
    });

  // Costuras cosidas a los costados y asas vencidas hacia fuera, sujetas al mismo tejido.
  for (const center of [2.55, 4.53]) {
    for (let t = .10; t < .84; t += .069) {
      const r = THREE.MathUtils.lerp(.991, .942, t);
      const p = (y, angle, add = .008) => cloth(y, r, center + angle, add);
      mesh.face([p(t, -.022), p(t, .028), p(t + .043, .028), p(t + .043, -.022)], WEAVE, bags[5]);
      mesh.face([p(t + .023, -.034, .014), p(t + .015, .034, .014), p(t + .021, .034, .014), p(t + .030, -.03, .014)],
        STRAP, bags[1]);
    }
  }
  for (const angle of [1.43, 4.54]) {
    const handle = (s, side) => {
      const a = angle + (s - .5) * .42;
      const p = cloth(.90, .933, a, .016);
      const slack = Math.sin(Math.PI * s) * (heavy ? .074 : .104);
      p[0] += slack * Math.sin(a + yaw);
      p[2] += slack * Math.cos(a + yaw);
      p[1] += side * .021 - slack * .70;
      return p;
    };
    for (let i = 0; i < 6; i++) {
      const s = i / 6, t = (i + 1) / 6;
      const face = [handle(s, -1), handle(t, -1), handle(t, 1), handle(s, 1)];
      mesh.face(face, WEAVE, bags[3]);
      mesh.face(face.toReversed(), WEAVE, tone);
    }
  }

  // El fondo en sombra queda debajo de los envases. Las piezas visibles se apoyan entre sí al llenar la abertura.
  const liner = Array.from({ length: sideCount }, (_, i) => cloth(heavy ? .814 : .829, .783, degrees(i, sideCount)));
  for (let i = 0; i < sideCount; i++) mesh.face([at([.026, height * .824, -.02]), liner[i], liner[(i + 1) % sideCount]], WEAVE, bags[4]);
  const colors = heavy ? glass : plastic;
  const rows = heavy ? 2 : 3, columns = heavy ? 4 : 5;
  const bodyY = height * (heavy ? .872 : .893);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const px = (col + .5 - columns / 2) * .149 + spread(random, .056) + .045;
    const pz = (row + .5 - rows / 2) * .22 + spread(random, .074);
    const length = (heavy ? .226 : .282) + random() * (heavy ? .065 : .096);
    const radius = (heavy ? .044 : .05) + random() * .02;
    const pitch = (row % 2 ? -1 : 1) * (1.13 + random() * .48);
    bottle(mesh, at([px, bodyY + spread(random, .07), pz]), [pitch, spread(random, .95) + yaw, spread(random, .97)],
      length, radius, type, choose(colors, random), random);
  }
  for (const [xx, zz, lean, turn] of [[-.18, -.02, 1.14, -.84], [.19, -.16, -1.03, -.4], [.08, .18, 1.46, 1.06], [.025, -.022, -1.1, .42]]) {
    bottle(mesh, at([xx, height * .925 + .044 + spread(random, .033), zz]), [lean + spread(random, .23), yaw + turn, spread(random, .35)],
      (heavy ? .251 : .305) + random() * .063, heavy ? .047 : .061, type, choose(colors, random), random);
  }
}

function glassCrate(mesh, floor) {
  // Junto al almacenamiento de vidrio, fuera de la llegada diagonal al pesaje.
  const x = 2.45, z = .42, w = .62, d = .43, h = .23, angle = -.19;
  const at = transform([x, floor, z], [0, angle, 0]), col = new THREE.Color('#4e6255'), inner = new THREE.Color('#3b5045');
  const random = rng(72901);
  mesh.box([w, .036, d], PET, inner, at([0, .026, 0]), [0, angle, 0]);
  for (const side of [-1, 1]) {
    for (const y of [.057, h]) {
      mesh.box([w, .044, .022], PET, col, at([0, y, d * .48 * side]), [0, angle, 0]);
      mesh.box([.022, .044, d], PET, col, at([w * .48 * side, y, 0]), [0, angle, 0]);
    }
    for (const dx of [-.28, -.142, 0, .142, .28]) mesh.box([.029, .16, .018], PET, col, at([dx, .142, d * .476 * side]), [0, angle, 0]);
    for (const dz of [-.193, -.07, .07, .193]) mesh.box([.018, .16, .029], PET, col, at([w * .474 * side, .142, dz]), [0, angle, 0]);
  }
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
    const length = .23 + random() * .073;
    bottle(mesh, at([(.5 + col - 2) * .119 + spread(random, .022), .053 + length * .49, (row - 1) * .118]),
      [spread(random, .28), angle + random() * TAU, spread(random, .25)], length, .045 + random() * .011, GLASS,
      glass[(col + row * 3) % glass.length], random);
  }
}

const along = (from, to) => {
  const origin = new THREE.Vector3(...from), axis = new THREE.Vector3(...to).sub(origin), length = axis.length();
  const turn = new THREE.Quaternion().setFromUnitVectors(vertical, axis.normalize());
  const point = new THREE.Vector3();
  return { length, at: coordinates => point.fromArray(coordinates).applyQuaternion(turn).add(origin).toArray(), turn };
};

function pipe(mesh, a, b, radius, wall, band, paint, sides = 10) {
  const { at, length } = along(a, b);
  const shape = [[0, radius - wall], [0, radius], [length, radius], [length, radius - wall], [0, radius - wall]];
  const rings = shape.map(([y, r]) => Array.from({ length: sides }, (_, i) => {
    const angle = degrees(i, sides);
    return at([Math.sin(angle) * r, y, Math.cos(angle) * r]);
  }));
  mesh.profile(rings, band, paint, (ring, side) => (ring === 4 ? .60 : 1) + .12 * Math.cos(side));
}

/** Teja usada, con acanaladuras de zinc y uno o dos bordes abollados. */
function corrugatedSteel(mesh, floor, x, z, height, width, lean, pitch, color, band) {
  const columns = 32, lines = 5;
  const surface = (u, v) => {
    const fold = .027 * Math.sin(TAU * (u * 7.25 + pitch)) - .016 * Math.sin(TAU * u * 2) * v ** 3;
    const buckle = .038 * Math.sin(u * 6.7 + pitch * 5) * v * v;
    return [x + v * lean + fold + buckle, floor + .018 + height * v + Math.sin(u * 14 + pitch) * v ** 7 * .033,
      z + width * u + pitch * .22 * v + u ** 6 * v * .028];
  };
  for (let j = 0; j < lines; j++) for (let i = 0; i < columns; i++) {
    const u0 = i / columns, u1 = (i + 1) / columns, v0 = j / lines, v1 = (j + 1) / lines;
    const points = [surface(u0, v0), surface(u1, v0), surface(u1, v1), surface(u0, v1)];
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const shade = .88 + .15 * Math.sin(i * .84 + j * .71) ** 2 + .067 * Math.cos(i * 2.2);
    mesh.face(points, band, color, uv, shade);
    mesh.face(points.toReversed(), band, color, uv.toReversed(), shade * .84);
  }
}

function drum(mesh, floor) {
  const { at, length } = along([2.69, floor + .295, -1.84], [2.95, floor + .292, -.96]);
  const body = [[0, .253], [0, .278], [.027, .284], [.057, .269], [.19, .268], [.22, .287], [.253, .286], [.286, .266],
    [.63, .265], [.66, .286], [.692, .282], [.72, .265], [.93, .27], [.98, .282], [1, .277]];
  const sides = 22, inside = new Set([0, 1, 13, 14]);
  const rings = body.map(([t, r]) => Array.from({ length: sides }, (_, i) => {
    const a = degrees(i, sides), billow = .009 * Math.cos(a * 3 + .24) * Math.sin(Math.PI * t);
    const crushed = .016 * Math.max(0, Math.cos(a - 1.02)) * (1 - t) ** 6;
    return at([Math.sin(a) * (r + billow - crushed), t * length + .024 * (1 - t) ** 6 * Math.sin(a * 2),
      Math.cos(a) * (r + billow - crushed)]);
  }));
  mesh.profile(rings, RUST, j => inside.has(j) ? metals[4] : metals[5],
    (j, i) => .72 + .27 * Math.sin(i * 1.22 + j * .46) ** 2 + .15 * Math.cos(i * .2 + j * .81));
  const liner = [[.67 * length, .235], [.048, .243], [0, .253]].map(([y, r]) => Array.from({ length: sides }, (_, i) => {
    const a = degrees(i, sides);
    return at([r * Math.sin(a), y, r * Math.cos(a)]);
  }));
  mesh.profile(liner, RUST, metals[7], (j, i) => .56 + .055 * j + .17 * Math.sin(i * .63) ** 2);
  for (let i = 0; i < sides; i++) {
    mesh.face([at([0, .68 * length, 0]), liner[0][(i + 1) % sides], liner[0][i]], RUST, metals[7], undefined, .58);
  }
}

function foundryScrap(mesh, floor) {
  corrugatedSteel(mesh, floor, 3.14, -1.83, 1.44, .84, .55, .12, metals[0], STEEL);
  corrugatedSteel(mesh, floor, 3.27, -1.92, 1.55, .91, .55, -.20, metals[2], STEEL);
  corrugatedSteel(mesh, floor, 3.26, -1.17, 1.13, .59, .52, .40, metals[6], RUST);
  drum(mesh, floor);

  const rim = [2.38, floor + .294, -1.67], edge = rotation([0, .38, .16]);
  const at = transform(rim, [0, .38, .16]);
  mesh.piece(new THREE.TorusGeometry(.239, .045, 6, 22), STEEL, metals[2], rim, edge);
  mesh.piece(new THREE.TorusGeometry(.25, .019, 5, 22), RUST, metals[5], at([0, 0, .098]), edge);
  pipe(mesh, at([0, 0, -.047]), at([0, 0, .092]), .234, .013, STEEL, metals[2], 22);
  pipe(mesh, at([0, 0, -.095]), at([0, 0, -.004]), .068, .019, STEEL, metals[2], 12);
  for (let i = 0; i < 6; i++) {
    const th = degrees(i, 6), tip = a => at([Math.sin(a) * .23, Math.cos(a) * .23, -.011]);
    const inner = a => at([Math.sin(a) * .062, Math.cos(a) * .062, -.049]);
    const spoke = [inner(th - .25), tip(th - .16), tip(th + .16), inner(th + .25)];
    mesh.face(spoke.toReversed(), STEEL, metals[0]);
    mesh.face(spoke, RUST, metals[4], undefined, .90);
  }

  // Los tubos descansan atravesados sobre dos trozos de madera, con los cortes hacia la calle.
  const metalStand = new THREE.Color('#745949');
  for (const z of [-.37, .21]) mesh.box([.76, .068, .13], PAPER, metalStand, [2.989, floor + .034, z], [0, -.11, 0]);
  const tubes = [[2.72, .057, .99], [2.825, .047, .74], [2.95, .066, 1.03], [3.08, .037, .81], [3.19, .055, .93],
    [2.87, .036, 1.18], [3.01, .028, .83]];
  for (const [i, [x, r, len]] of tubes.entries()) {
    const y = floor + .061 + r + (i > 4 ? .10 : 0), z = -.14 - len * .60;
    pipe(mesh, [x, y, z], [x + .121 - .024 * i, y - .009, z + len], r, Math.max(.006, r * .17),
      i % 3 === 0 ? RUST : STEEL, metals[i % 3 === 0 ? 5 : i % 4]);
  }
  for (const x of [3.31, 3.41]) {
    const angle = -.24 + (x - 3.31), length = .82 + (x - 3.31) * .91, at = transform([x, floor + .083, -.3], [0, angle, 0]);
    mesh.box([.071, .011, length], STEEL, metals[1], at([0, 0, 0]), [0, angle, 0]);
    mesh.box([.012, .057, length], RUST, metals[4], at([-.031, .026, 0]), [0, angle, 0]);
  }
}

/** Se conserva el plato, columna y reloj del pesaje. Los relieves dan lectura de acero y escala graduada. */
function scaleDetail(mesh, floor) {
  const x = .36, y = floor + 1.45, z = .51;
  mesh.piece(new THREE.TorusGeometry(.195, .009, 5, 32), STEEL, metals[3], [x, y, z]);
  const ink = new THREE.Color('#464840');
  for (let i = 0; i <= 30; i++) {
    const angle = -Math.PI * .78 + i * Math.PI * 1.56 / 30, big = i % 5 === 0;
    const point = (r, n) => [x + r * Math.sin(angle + n), y + r * Math.cos(angle + n), z - .003];
    const outer = .170, inner = big ? .145 : .158, width = big ? .016 : .009;
    mesh.face([point(inner, -width), point(outer, -width), point(outer, width), point(inner, width)], STRAP, ink);
  }
  const plate = new THREE.Color('#a0a29a'), accent = new THREE.Color('#757d78');
  for (let row = 0; row < 7; row++) for (let col = 0; col < 9; col++) {
    const px = (col - 4) * .102 + (row % 2 ? .017 : 0), pz = .15 + (row - 3) * .106, py = floor + .124;
    const diamond = [[px -.029, py, pz], [px, py + .006, pz + .014], [px + .030, py, pz], [px, py, pz - .012]];
    mesh.face(diamond, STEEL, (row + col) % 3 ? plate : accent);
  }
}

export function buildRecyclerYard(floor) {
  return withVisualRandom(() => {
    const mesh = new YardMesh();
    for (const [x, y, z, yaw, w, h, d, seed] of [
      [-3.35, 0, 2.45, .03, .95, .592, .70, 8713], [-2.30, 0, 2.40, -.05, .95, .581, .70, 29],
      [-1.25, 0, 2.50, .06, .94, .607, .69, 1843], [-2.85, .584, 2.46, .074, .94, .516, .69, 3310],
      [-1.79, .585, 2.46, -.055, .94, .547, .69, 3394], [-3.27, 0, 1.55, 1.43, .85, .54, .68, 22]
    ]) bale(mesh, floor, x, y, z, yaw, w, h, d, seed);
    cartLoad(mesh, floor);
    sack(mesh, floor, 1.95, 2.29, 1.025, .20, PET, bags[0], 1724);
    sack(mesh, floor, 3.15, 2.15, 1.15, .90, PET, bags[2], 22879);
    sack(mesh, floor, 3.2, .98, .884, .50, GLASS, bags[1], 7473);
    glassCrate(mesh, floor);
    foundryScrap(mesh, floor);
    scaleDetail(mesh, floor);
    return mesh.mesh();
  });
}
