import * as THREE from 'three';

/** Tiempo común: el distrito lo avanza una vez, incluso después de fusionar las copas. */
export const foliageWind = { value: 0 };

// Siluetas inspiradas en arbolado urbano andino; no son modelos botánicos de las especies.
export const URBAN_TREE_SPECIES = Object.freeze(['urapan', 'eucalipto', 'arrayan']);
const SHAPES = {
  urapan: { height: 5.9, radius: 1.95, trunk: .19, fork: 2.45, branches: 8, leaves: 20, centerLeaves: 48, innerLeaves: 8,
    foliage: '#687c52', bark: '#8a7a63', spread: .66, card: .79, atlas: 0 },
  eucalipto: { height: 7.2, radius: 1.4, trunk: .17, fork: 3.15, branches: 9, leaves: 13, centerLeaves: 27, innerLeaves: 0,
    foliage: '#748674', bark: '#aaa38c', spread: .55, card: .89, atlas: 1 },
  arrayan: { height: 4.5, radius: 1.65, trunk: .16, fork: 1.9, branches: 7, leaves: 20, centerLeaves: 60, innerLeaves: 10,
    foliage: '#58704c', bark: '#857560', spread: .6, card: .70, atlas: 2 }
};

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function leafAtlas() {
  const size = 256, cell = size / 2, pixels = new Uint8Array(size * size * 4);
  for (let species = 0; species < 3; species++) {
    const leaves = [], rows = species === 2 ? 6 : 4;
    for (let row = 0; row < rows; row++) for (const side of [-1, 1]) {
      const y = .20 + row * (species === 2 ? .105 : .16);
      leaves.push({ x: .5 + side * (species === 1 ? .16 : .17), y: y + (species === 1 ? -.045 : .05),
        angle: side < 0 ? (species === 1 ? 3.7 : 2.55) : (species === 1 ? -.55 : .6),
        length: species === 1 ? .37 : species === 2 ? .22 : .30,
        width: species === 1 ? .043 : species === 2 ? .065 : .085 });
    }
    leaves.push({ x: .5, y: .85, angle: Math.PI / 2, length: .24, width: species === 1 ? .036 : .065 });
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const px = (x + .5) / cell, py = (y + .5) / cell;
      let alpha = 0, shade = 225;
      // Ramilla central fina: el conjunto se lee como hojas individuales, no como un recorte ovalado.
      if (Math.abs(px - (.5 + Math.sin(py * 5) * .012)) < .004 && py > .09 && py < .88) {
        alpha = 220; shade = 190;
      }
      for (const leaf of leaves) {
        const dx = px - leaf.x, dy = py - leaf.y, c = Math.cos(leaf.angle), s = Math.sin(leaf.angle);
        const u = (dx * c + dy * s) / leaf.length + .5;
        if (u <= 0 || u >= 1) continue;
        const v = Math.abs(-dx * s + dy * c) / leaf.width;
        const outline = Math.sin(u * Math.PI) ** .78 * (1 + .035 * Math.sin(u * 29));
        if (v > outline) continue;
        const edge = Math.min(1, (outline - v) * leaf.width * cell);
        const leafAlpha = Math.round(edge * 255);
        if (leafAlpha >= alpha) {
          alpha = leafAlpha;
          shade = Math.round(217 + 27 * (1 - v / outline) + (v < .045 ? 6 : 0));
        }
      }
      const index = (((species >> 1) * cell + y) * size + (species % 2) * cell + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = shade;
      pixels[index + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.name = 'Hojas urbanas · atlas compartido'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}

function barkTexture() {
  const width = 64, height = 128, pixels = new Uint8Array(width * height * 4), r = random(405);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const groove = Math.sin(x * .8 + Math.sin(y * .055) * .8) * 8 + Math.sin(x * 2.1 + y * .018) * 5;
    const shade = Math.round(225 + groove + (r() - .5) * 11), index = (y * width + x) * 4;
    pixels[index] = shade; pixels[index + 1] = shade - 2; pixels[index + 2] = shade - 6; pixels[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.name = 'Corteza urbana · compartida'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

const WIND_DISPLACEMENT = `
  transformed.x += sin(foliageTime * treeWind.y + treeWind.x) * treeWind.z;
  transformed.z += cos(foliageTime * treeWind.y * .8 + treeWind.x) * treeWind.z * .72;
`;

function withWind(material, key) {
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = shader => {
    shader.uniforms.foliageTime = foliageWind;
    shader.vertexShader = 'uniform float foliageTime;\nattribute vec3 treeWind;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_DISPLACEMENT}`);
  };
  return material;
}

let shared;
function materials() {
  if (shared) return shared;
  const atlas = leafAtlas();
  const leaves = withWind(new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, roughness: .96, metalness: 0, side: THREE.DoubleSide,
    alphaTest: .38, transparent: false
  }), 'urban-tree-foliage-v1');
  leaves.name = 'Hojas urbanas'; leaves.userData.staticMergeKey = 'urban-tree:foliage-v1|wind';
  const depth = withWind(new THREE.MeshDepthMaterial({
    map: atlas, alphaTest: .38, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking
  }), 'urban-tree-foliage-depth-v1');
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), vertexColors: true, roughness: .96 });
  bark.name = 'Troncos urbanos'; bark.userData.staticMergeKey = 'urban-tree:bark-v1';
  shared = { leaves, depth, bark };
  // El distrito libera el banco una vez. Una nueva ciudad construye un banco fresco.
  for (const material of [leaves, depth, bark]) material.addEventListener('dispose', () => {
    if (shared?.leaves === leaves) shared = null;
  });
  return shared;
}

function buffers(wind = false) {
  return { positions: [], normals: [], uv: [], colors: [], indices: [], ...(wind ? { wind: [] } : {}) };
}

function geometry(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  if (data.wind) g.setAttribute('treeWind', new THREE.Float32BufferAttribute(data.wind, 3));
  g.setIndex(data.indices); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function branch(data, points, radii, sides, color) {
  const base = data.positions.length / 3;
  for (let ring = 0; ring < points.length; ring++) {
    const point = points[ring];
    const tangent = points[Math.min(ring + 1, points.length - 1)].clone()
      .sub(points[Math.max(0, ring - 1)]).normalize();
    const right = new THREE.Vector3(tangent.y > .94 ? 1 : 0, tangent.y > .94 ? 0 : 1, 0).cross(tangent).normalize();
    const forward = new THREE.Vector3().crossVectors(tangent, right);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const normal = right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(forward, Math.sin(angle));
      const p = point.clone().addScaledVector(normal, radii[ring]);
      data.positions.push(p.x, p.y, p.z); data.normals.push(normal.x, normal.y, normal.z);
      data.uv.push(side / sides, point.y * .7);
      data.colors.push(color.r, color.g, color.b);
      if (ring < points.length - 1 && side < sides) {
        const a = base + ring * (sides + 1) + side, b = a + sides + 1;
        data.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
}

function leafCard(data, center, width, height, yaw, tilt, roll, profile, phase, frequency, amplitude, color) {
  const first = data.positions.length / 3;
  const across = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const along = new THREE.Vector3(-Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt));
  // Girar también dentro del plano evita que todas las ramillas del atlas apunten hacia arriba.
  const right = across.clone().multiplyScalar(Math.cos(roll)).addScaledVector(along, Math.sin(roll));
  const up = along.clone().multiplyScalar(Math.cos(roll)).addScaledVector(across, -Math.sin(roll));
  const normal = new THREE.Vector3().crossVectors(right, up).normalize();
  const slotX = profile.atlas % 2, slotY = profile.atlas >> 1;
  for (const [u, v] of [[0,0], [1,0], [1,1], [0,1]]) {
    const p = center.clone().addScaledVector(right, (u - .5) * width).addScaledVector(up, (v - .5) * height);
    data.positions.push(p.x, p.y, p.z); data.normals.push(normal.x, normal.y, normal.z);
    data.uv.push((slotX + .008 + u * .984) * .5, (slotY + .008 + v * .984) * .5);
    data.colors.push(color.r, color.g, color.b);
    data.wind.push(phase, frequency, amplitude * (.45 + v * .55));
  }
  data.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
}

/**
 * Dos mallas agrupables por árbol: corteza y hojas recortadas sin transparencia mezclada.
 * `seed` controla toda la forma; `species` admite urapan, eucalipto o arrayan.
 * Cada ejemplar tiene 288–544 triángulos de hojas, más tronco/ramas (menos de 900 en total).
 */
export function createUrbanTree(scale = 1, { seed = 1, species = 'urapan' } = {}) {
  species = URBAN_TREE_SPECIES.includes(species) ? species : 'urapan';
  scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const profile = SHAPES[species], r = random(seed), h = profile.height * (.94 + r() * .12);
  const trunkData = buffers(), leafData = buffers(true), barkColor = new THREE.Color(profile.bark);
  const phase = r() * Math.PI * 2, frequency = 1.05 + r() * .45, lean = (r() - .5) * .3;
  const trunk = [new THREE.Vector3(), new THREE.Vector3(lean * .3, h * .28, 0),
    new THREE.Vector3(lean, h * .55, .07), new THREE.Vector3(lean * .6, h * .8, .12), new THREE.Vector3(lean * .4, h * .97, .08)];
  branch(trunkData, trunk, [profile.trunk * 1.3, profile.trunk, profile.trunk * .7, profile.trunk * .35, .025], 7, barkColor);
  const tips = [];
  for (let i = 0; i < profile.branches; i++) {
    const t = i / (profile.branches - 1), angle = i * 2.39996 + r() * .5;
    const radius = profile.radius * (.72 + r() * .28) * (species === 'eucalipto' ? 1 - t * .35 : 1 - t * .18);
    const y = profile.fork + (h - profile.fork) * t * .65;
    const start = new THREE.Vector3(lean, y, .05);
    const end = new THREE.Vector3(Math.cos(angle) * radius, y + .65 + r() * .55, Math.sin(angle) * radius);
    const middle = start.clone().lerp(end, .55); middle.y -= .12;
    const thickness = profile.trunk * (.42 - t * .2);
    branch(trunkData, [start, middle, end], [thickness, thickness * .65, .012], 5, barkColor);
    const twig = end.clone().add(new THREE.Vector3(Math.sin(angle) * .35, .3, Math.cos(angle) * .35));
    branch(trunkData, [middle, twig], [thickness * .35, .009], 3, barkColor);
    tips.push(end);
  }
  if (species === 'arrayan') {
    for (const sign of [-1, 1]) branch(trunkData, [new THREE.Vector3(sign * .1, 0, 0),
      new THREE.Vector3(sign * .35, 1.5, .1), new THREE.Vector3(sign * .7, 2.8, .2)], [.11, .07, .022], 5, barkColor);
  }
  const leafColor = new THREE.Color(profile.foliage);
  const addCluster = (center, count, spread) => {
    for (let i = 0; i < count; i++) {
      const angle = r() * Math.PI * 2, radius = Math.sqrt(r()) * spread;
      const position = center.clone().add(new THREE.Vector3(Math.cos(angle) * radius, (r() - .4) * spread * 1.2, Math.sin(angle) * radius));
      const size = profile.card * (.75 + r() * .45);
      const color = leafColor.clone().multiplyScalar(.87 + r() * .23);
      leafCard(leafData, position, size, size * (species === 'eucalipto' ? 1.2 : 1), r() * Math.PI * 2,
        (r() - .5) * 2.5, (r() - .5) * (species === 'eucalipto' ? 2.4 : Math.PI * 2),
        profile, phase, frequency, (.045 + r() * .025) * scale, color);
    }
  };
  for (const tip of tips) {
    addCluster(tip, profile.leaves, profile.spread);
    // Las copas anchas conservan follaje entre tronco y extremos, sin tapar el fuste inferior.
    addCluster(new THREE.Vector3(tip.x * .48, tip.y + .16, tip.z * .48), profile.innerLeaves, profile.spread * 1.1);
  }
  addCluster(new THREE.Vector3(lean * .5, h * .9, .1), profile.centerLeaves, profile.spread * .85);
  const shared = materials(), root = new THREE.Group(), canopy = new THREE.Group();
  const wood = new THREE.Mesh(geometry(trunkData), shared.bark), leaves = new THREE.Mesh(geometry(leafData), shared.leaves);
  wood.name = 'Tronco y ramas'; leaves.name = 'Ramillas con hojas'; canopy.name = 'Copa';
  wood.castShadow = wood.receiveShadow = leaves.castShadow = leaves.receiveShadow = true;
  leaves.customDepthMaterial = shared.depth;
  canopy.add(leaves); root.add(wood, canopy); root.scale.setScalar(scale);
  root.name = `Árbol urbano · ${species}`;
  root.userData.tree = { seed: seed >>> 0, species, leafCards: leafData.indices.length / 6,
    triangles: (trunkData.indices.length + leafData.indices.length) / 3 };
  return root;
}
