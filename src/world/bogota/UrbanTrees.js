import * as THREE from 'three';
import { chainSunField, sunFieldUniforms } from './SunFieldShader.js';

/** Tiempo común: el distrito lo avanza una vez, incluso después de fusionar las copas. */
export const foliageWind = { value: 0 };

// Siluetas inspiradas en arbolado urbano andino; no son modelos botánicos de las especies.
export const URBAN_TREE_SPECIES = Object.freeze(['urapan', 'eucalipto', 'arrayan']);
const SHAPES = {
  urapan: { height: 5.9, radius: 1.95, trunk: .19, fork: 2.45, branches: 8, leaves: 20, centerLeaves: 48, innerLeaves: 8,
    foliage: '#687c52', deep: '#44583a', fresh: '#8f9c5a', dry: '#a8974f', bark: '#8a7a63', spread: .66, card: .79, atlas: 0 },
  eucalipto: { height: 7.2, radius: 1.4, trunk: .17, fork: 3.15, branches: 9, leaves: 13, centerLeaves: 27, innerLeaves: 0,
    foliage: '#748674', deep: '#51655a', fresh: '#97a78a', dry: '#aca273', bark: '#aaa38c', spread: .55, card: .89, atlas: 1 },
  arrayan: { height: 4.5, radius: 1.65, trunk: .16, fork: 1.9, branches: 7, leaves: 20, centerLeaves: 60, innerLeaves: 10,
    foliage: '#58704c', deep: '#384d33', fresh: '#7f914e', dry: '#9d8b49', bark: '#857560', spread: .6, card: .70, atlas: 2 }
};

// Uno de cada nueve urapanes y arrayanes está en flor, en morado o amarillo apagados; el eucalipto no.
const FLOWERING = .12;
const FLOWERS = { morada: '#7d5f8c', amarilla: '#ab9550' };

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Ramilla de cada especie en coordenadas de celda: palitos (x0, y0, x1, y1) y foliolos de 4 a 8 cm con su tono. */
function sprig(species) {
  const r = random(7103 + species * 97), twigs = [], leaves = [];
  const leaf = (x, y, angle, length, width) => leaves.push({ x, y, angle, length, width, tone: 206 + r() * 30 });
  const stem = (x0, y0, angle, length) => {
    const x1 = x0 + Math.cos(angle) * length, y1 = y0 + Math.sin(angle) * length;
    twigs.push([x0, y0, x1, y1]);
    return (t, side = 0, out = 0) => [x0 + (x1 - x0) * t - Math.sin(angle) * side * out, y0 + (y1 - y0) * t + Math.cos(angle) * side * out];
  };
  const up = Math.PI / 2, main = stem(.5, .03, up + (r() - .5) * .08, .9);
  if (species === 0) {
    // Urapán: hoja compuesta, tres o cuatro pares de foliolos y uno en la punta de cada raquis.
    for (let node = 0; node < 15; node++) {
      const side = node % 2 ? 1 : -1, t = .06 + node * .062, [x, y] = main(t);
      const angle = node === 14 ? up : up - side * (1.05 + r() * .35) + (t - .5) * side * .5, length = (node === 14 ? .12 : .25 + r() * .1) * (1 - t * .25);
      const rachis = stem(x, y, angle, length), pairs = 3 + (r() < .5 ? 1 : 0);
      for (let k = 0; k < pairs; k++) for (const hand of [-1, 1]) {
        const [lx, ly] = rachis(.22 + k * .78 / pairs, hand, .028);
        leaf(lx, ly, angle - hand * (.75 + r() * .3), .088 + r() * .02, .021 + r() * .004);
      }
      const [tx, ty] = rachis(1.12);
      leaf(tx, ty, angle + (r() - .5) * .3, .095, .022);
    }
  } else if (species === 1) {
    // Eucalipto: hoja angosta y colgante, en ramitas que se abren del eje.
    for (let node = 0; node < 9; node++) {
      const side = node % 2 ? 1 : -1, t = .1 + node * .1, [x, y] = main(t);
      const angle = up - side * (.7 + r() * .5), shoot = stem(x, y, angle, (.2 + r() * .14) * (1 - t * .3));
      for (let k = 0; k < 9; k++) {
        const [lx, ly] = shoot(.12 + k * .11, k % 2 ? 1 : -1, .012);
        leaf(lx, ly - .035, -up + (r() - .5) * .9 + side * .25, .1 + r() * .035, .0135 + r() * .003);
      }
    }
    for (let k = 0; k < 6; k++) { const [lx, ly] = main(.9 + k * .02, k % 2 ? 1 : -1, .02); leaf(lx, ly - .02, -up + (r() - .5) * 1.4, .1, .014); }
  } else {
    // Arrayán: hoja menuda y ovalada, de a pares, apretada a lo largo de cada ramita.
    for (let node = 0; node < 12; node++) {
      const side = node % 2 ? 1 : -1, t = .05 + node * .078 + (r() - .5) * .03, [x, y] = main(t);
      const angle = node === 11 ? up : up - side * (.6 + r() * .75), shoot = stem(x, y, angle, (node === 11 ? .1 : .2 + r() * .17) * (1 - t * .3));
      for (let k = 0; k < 7; k++) for (const hand of [-1, 1]) {
        const [lx, ly] = shoot(.1 + k * .145 + (r() - .5) * .05, hand, .022);
        leaf(lx, ly, angle - hand * (.8 + r() * .6), .06 + r() * .02, .02 + r() * .005);
      }
      const [tx, ty] = shoot(1.08);
      leaf(tx, ty, angle, .062, .021);
    }
  }
  return { twigs, leaves };
}

/** Carta de 256 × 256 con una ramilla por especie; las tarjetas de la copa son las mismas de antes. */
function leafPixels() {
  const size = 256, cell = size / 2, pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels[i] = pixels[i + 1] = pixels[i + 2] = 214;
  for (let species = 0; species < 3; species++) {
    const { twigs, leaves } = sprig(species), ox = (species % 2) * cell, oy = (species >> 1) * cell;
    const put = (x, y, alpha, red, green, blue) => {
      if (x < 1 || y < 1 || x >= cell - 1 || y >= cell - 1) return;
      const index = ((oy + y) * size + ox + x) * 4;
      if (alpha < pixels[index + 3]) return;
      pixels[index] = red; pixels[index + 1] = green; pixels[index + 2] = blue; pixels[index + 3] = alpha;
    };
    for (const [x0, y0, x1, y1] of twigs) {
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * cell * 1.5);
      for (let k = 0; k <= steps; k++) put(Math.round((x0 + (x1 - x0) * k / steps) * cell - .5), Math.round((y0 + (y1 - y0) * k / steps) * cell - .5), 215, 176, 160, 128);
    }
    for (const leaf of leaves) {
      const c = Math.cos(leaf.angle), s = Math.sin(leaf.angle), reach = Math.ceil(leaf.length * cell) + 1;
      const cx = (leaf.x + c * leaf.length / 2) * cell, cy = (leaf.y + s * leaf.length / 2) * cell;
      for (let y = Math.floor(cy - reach); y <= cy + reach; y++) for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
        const dx = (x + .5) / cell - leaf.x, dy = (y + .5) / cell - leaf.y, u = (dx * c + dy * s) / leaf.length;
        if (u <= 0 || u >= 1) continue;
        // Foliolo en punta de lanza, más ancho hacia la base.
        const across = (-dx * s + dy * c) * cell, half = leaf.width * cell * Math.sin(Math.PI * u ** .8) ** .8;
        const edge = half - Math.abs(across) + .5;
        if (edge <= 0) continue;
        // Nervio claro y dos tonos: la media hoja que mira al sol y la que queda en sombra.
        const shade = Math.abs(across) < .5 ? leaf.tone + 22 : leaf.tone + (across > 0 ? 12 : -22) - u * 10;
        put(x, y, Math.round(Math.min(1, edge) * 255), Math.min(252, Math.round(shade)), Math.min(252, Math.round(shade)), Math.min(252, Math.round(shade)));
      }
    }
  }
  return pixels;
}

const ALPHA_TEST = .38;

/** Reducciones de la carta: cada una conserva, celda por celda, la parte de la tarjeta que pasa el recorte. */
function leafMipmaps(pixels, size) {
  const levels = [{ data: pixels, width: size, height: size }], cut = ALPHA_TEST * 255;
  const cover = (data, width, x0, y0, span, gain) => {
    let count = 0;
    for (let y = y0; y < y0 + span; y++) for (let x = x0; x < x0 + span; x++) if (data[(y * width + x) * 4 + 3] * gain >= cut) count++;
    return count / (span * span);
  };
  const wanted = [0, 1, 2, 3].map(slot => cover(pixels, size, (slot % 2) * size / 2, (slot >> 1) * size / 2, size / 2, 1));
  for (let width = size / 2, from = pixels; width >= 1; width /= 2) {
    const data = new Uint8Array(width * width * 4), before = width * 2;
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = ((y * 2 + j) * before + x * 2 + i) * 4, a = from[k + 3] + 1;
        alpha += from[k + 3]; red += from[k] * a; green += from[k + 1] * a; blue += from[k + 2] * a;
      }
      const k = (y * width + x) * 4, weight = alpha + 4;
      data[k] = red / weight; data[k + 1] = green / weight; data[k + 2] = blue / weight; data[k + 3] = alpha / 4;
    }
    const span = Math.max(1, width / 2);
    for (let slot = 0; slot < (width > 1 ? 4 : 1); slot++) {
      if (!wanted[slot]) continue;
      const x0 = (slot % 2) * span, y0 = (slot >> 1) * span;
      let low = 1, high = 12;
      for (let pass = 0; pass < 12; pass++) {
        const gain = (low + high) / 2;
        if (cover(data, width, x0, y0, span, gain) < wanted[slot]) low = gain; else high = gain;
      }
      for (let y = y0; y < y0 + span; y++) for (let x = x0; x < x0 + span; x++) {
        const k = (y * width + x) * 4 + 3;
        data[k] = Math.min(255, data[k] * high);
      }
    }
    levels.push({ data, width, height: width });
    from = data;
  }
  return levels;
}

function leafAtlas() {
  const size = 256, pixels = leafPixels(), texture = new THREE.DataTexture(pixels, size, size);
  texture.name = 'Hojas urbanas · atlas compartido'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  // Con hoja menuda las reducciones automáticas ralean la copa de lejos: van hechas a mano.
  texture.mipmaps = leafMipmaps(pixels, size); texture.generateMipmaps = false;
  texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}

// Liquen gris verdoso (#7d8470 ya puesto sobre el pardo del tronco): la textura se multiplica por el color de la madera.
const LICHEN = [200, 236, 240];

/**
 * Dos cortezas de 128 × 256 lado a lado, las dos de la misma madera: la de la izquierda limpia, para ramas y fuste alto,
 * y la de la derecha con liquen y tierra salpicada, para el primer metro largo del tronco.
 */
function barkTexture() {
  const cell = 128, width = cell * 2, height = 256, pixels = new Uint8Array(width * height * 4), r = random(405);
  const turn = Math.PI * 2 / height, fissures = [];
  // Fisuras verticales que serpentean, se abren y se cierran, a 5–8 cm; entre dos, placas partidas por grietas al sesgo.
  for (let x = 0; x < cell - 4; x += 5.2 + r() * 3.3) {
    const fissure = { x, sway: .5 + r() * 1.1, waves: 1 + Math.floor(r() * 3), phase: r() * 6.283, width: .7 + r() * .7,
      breath: 1 + Math.floor(r() * 4), cuts: [] };
    for (let y = r() * 24; y < height - 10; y += 12 + r() * 34) {
      fissure.cuts.push({ y, tone: 172 + r() * 30, slant: (r() - .5) * 1.6, deep: r() < .6 ? 34 + r() * 22 : 8 });
    }
    fissures.push(fissure);
  }
  const patches = [];
  for (let i = 0; i < 23; i++) {
    const x = r() * cell, y = 40 + r() * 165;
    for (let k = 0; k < 3; k++) patches.push({ x: x + (r() - .5) * 11, y: y + (r() - .5) * 26, rx: 2.5 + r() * 4.5, ry: 6 + r() * 9 });
  }
  const streaks = Array.from({ length: cell }, () => (r() - .5) * 11);
  const edges = new Float32Array(fissures.length + 1), widths = new Float32Array(fissures.length + 1);
  for (let y = 0; y < height; y++) {
    fissures.forEach((f, i) => {
      edges[i] = f.x + f.sway * Math.sin(y * turn * f.waves + f.phase);
      widths[i] = f.width * (.45 + .75 * Math.abs(Math.sin(y * turn * f.breath * .5 + f.phase * 2)));
    });
    edges[fissures.length] = edges[0] + cell; widths[fissures.length] = widths[0];
    for (let x = 0; x < cell; x++) {
      const px = x < edges[0] ? x + cell : x;
      let i = 0;
      while (i < fissures.length - 1 && edges[i + 1] <= px) i++;
      const cuts = fissures[i].cuts, span = edges[i + 1] - edges[i], dl = px - edges[i], dr = edges[i + 1] - px;
      const across = 2 * dl / span - 1;
      let plate = cuts[cuts.length - 1], crack = 0;
      for (const cut of cuts) {
        const line = cut.y + across * cut.slant * 2.5;
        if (line <= y) plate = cut;
        const gap = Math.min(Math.abs(y - line), height - Math.abs(y - line));
        crack = Math.max(crack, cut.deep * Math.exp(-gap * gap / .7));
      }
      const groove = 64 * Math.max(Math.exp(-((dl / widths[i]) ** 2)), Math.exp(-((dr / widths[i + 1]) ** 2)));
      let shade = plate.tone + 13 * (1 - across * across) + streaks[x] + 6 * Math.sin(x * turn * 4 + y * turn * 2) + (r() - .5) * 12 - groove - crack;
      shade = Math.max(110, Math.min(230, Math.round(shade)));
      const clean = (y * width + x) * 4, aged = clean + cell * 4;
      pixels[clean] = shade; pixels[clean + 1] = shade - 3; pixels[clean + 2] = shade - 9; pixels[clean + 3] = 255;
      let lichen = -1;
      for (const patch of patches) {
        const dx = Math.min(Math.abs(x - patch.x), cell - Math.abs(x - patch.x)) / patch.rx, dy = (y - patch.y) / patch.ry;
        lichen = Math.max(lichen, 1 - dx * dx - dy * dy);
      }
      if (lichen + (r() - .5) * .7 > .1) {
        // La costra deja ver el relieve de la placa que cubre.
        const value = .84 + (shade - 110) / 120 * .16 + (r() - .5) * .1;
        for (let k = 0; k < 3; k++) pixels[aged + k] = Math.min(250, Math.round(LICHEN[k] * value));
      } else {
        pixels[aged] = shade; pixels[aged + 1] = shade - 3; pixels[aged + 2] = shade - 9;
      }
      // Tierra que salpica la lluvia: mancha pareja abajo y pintas sueltas hasta los 30 cm.
      if (y < 54) {
        const low = (1 - y / 54) ** 1.5, soil = 1 - .3 * low - (r() < .45 * low ? .25 + r() * .2 : 0);
        const brown = Math.min(1, low * 3);
        pixels[aged] *= soil; pixels[aged + 1] *= soil * (1 - .07 * brown); pixels[aged + 2] *= soil * (1 - .18 * brown);
      }
      pixels[aged + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.name = 'Corteza urbana · compartida'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}

const WIND_DISPLACEMENT = `
  transformed.x += sin(foliageTime * treeWind.y + treeWind.x) * treeWind.z;
  transformed.z += cos(foliageTime * treeWind.y * .8 + treeWind.x) * treeWind.z * .72;
`;

// De noche la copa vuelve a un verde oscuro y frío, también la que está en flor. El piso de cielo que comparten
// todos los materiales vale .4 de día: ahí el factor es cero y el color no cambia.
const NIGHT_GREEN = `
  float foliageNight = smoothstep( .5, 1.0, ( foliageSky - .4 ) / .22 ) * .85;
  outgoingLight = mix( outgoingLight, dot( outgoingLight, vec3( .3, .55, .15 ) ) * vec3( .75, .83, .47 ), foliageNight );
`;

function withWind(material, key) {
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = shader => {
    shader.uniforms.foliageTime = foliageWind;
    shader.vertexShader = 'uniform float foliageTime;\nattribute vec3 treeWind;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_DISPLACEMENT}`);
    if (!shader.fragmentShader?.includes('#include <opaque_fragment>')) return;
    shader.uniforms.foliageSky = sunFieldUniforms.uSunSkyFloor;
    shader.fragmentShader = 'uniform float foliageSky;\n' + shader.fragmentShader
      .replace('#include <opaque_fragment>', `${NIGHT_GREEN}\n#include <opaque_fragment>`);
  };
  return material;
}

// Más que el radio de una copa común: las hojas del lado del sol no se tapan con las de al lado.
const CANOPY_REACH = 5;
const DIRECT_LOOP = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const DIRECT_DIFFUSE = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/** Un poco de luz atraviesa la cara trasera de la hoja. Usa el sol ya atenuado por muros, nubes y sombras. */
function withLeafTransmission(material) {
  const { onBeforeCompile } = material, version = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    onBeforeCompile(shader, renderer);
    const start = shader.fragmentShader?.indexOf(DIRECT_LOOP) ?? -1;
    if (start < 0) return;
    shader.fragmentShader = shader.fragmentShader.slice(0, start) + shader.fragmentShader.slice(start)
      .replace(DIRECT_DIFFUSE, /* glsl */`${DIRECT_DIFFUSE}
      {
        float leafBack = saturate(-dot( geometryNormal, directLight.direction ));
        float towardSun = saturate(-dot( geometryViewDir, directLight.direction ));
        float throughLeaf = leafBack * (.26 + .42 * towardSun * towardSun);
        reflectedLight.directDiffuse += BRDF_Lambert( material.diffuseContribution ) * directLight.color
          * throughLeaf * vec3(1.06, 1.09, .69);
      }`);
  };
  material.customProgramCacheKey = () => `${version}|transmision-hojas`;
  return material;
}

let shared;
function materials() {
  if (shared) return shared;
  const atlas = leafAtlas();
  const leaves = withLeafTransmission(chainSunField(withWind(new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, roughness: .96, metalness: 0, side: THREE.DoubleSide,
    alphaTest: ALPHA_TEST, transparent: false
  }), 'urban-tree-foliage-v1'), CANOPY_REACH));
  leaves.name = 'Hojas urbanas'; leaves.userData.staticMergeKey = 'urban-tree:foliage-v1|wind';
  const depth = withWind(new THREE.MeshDepthMaterial({
    map: atlas, alphaTest: ALPHA_TEST, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking
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

/** `skin`: columna de la corteza (0 limpia, 1 con liquen), giro del anillo, corrimiento de la textura a lo alto y eje de cada anillo. */
function branch(data, points, radii, sides, color, { column = 0, turn = 0, lift = 0, axes = null } = {}) {
  const base = data.positions.length / 3;
  for (let ring = 0; ring < points.length; ring++) {
    const point = points[ring];
    const tangent = axes?.[ring] ?? points[Math.min(ring + 1, points.length - 1)].clone()
      .sub(points[Math.max(0, ring - 1)]).normalize();
    const right = new THREE.Vector3(tangent.y > .94 ? 1 : 0, tangent.y > .94 ? 0 : 1, 0).cross(tangent).normalize();
    const forward = new THREE.Vector3().crossVectors(tangent, right);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2 + turn;
      const normal = right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(forward, Math.sin(angle));
      const p = point.clone().addScaledVector(normal, radii[ring]);
      data.positions.push(p.x, p.y, p.z); data.normals.push(normal.x, normal.y, normal.z);
      data.uv.push((column + side / sides) * .5, point.y * .7 + lift);
      // El pie se oscurece: tierra salpicada y humedad hasta la rodilla.
      const foot = .58 + .42 * Math.min(1, point.y / .8);
      data.colors.push(color.r * foot, color.g * foot, color.b * foot);
      if (ring < points.length - 1 && side < sides) {
        const a = base + ring * (sides + 1) + side, b = a + sides + 1;
        data.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
}

/** Tres o cuatro raíces que asoman del cuello: cada una, dos caras bajas que salen del tronco y se pierden en la tierra. */
function roots(data, r, neck, turn, color) {
  const count = 3 + Math.floor(r() * 2), face = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const angle = turn + (i + r() * .6) / count * Math.PI * 2, reach = Math.min(.5, neck + .1 + r() * .12), open = .17 + r() * .07;
    const at = (a, radius, y) => new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
    const top = at(angle, neck * .86, .08 + r() * .07), tip = at(angle + (r() - .5) * .3, reach, 0);
    for (const [a, b, c] of [[top, tip, at(angle - open, neck * .96, 0)], [top, at(angle + open, neck * .96, 0), tip]]) {
      const first = data.positions.length / 3;
      face.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      for (const p of [a, b, c]) {
        // La luz la redondea: cada punta mira hacia afuera y hacia arriba, no como la cara plana.
        const round = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(.5).add(face).setY(face.y + .5).normalize();
        data.positions.push(p.x, p.y, p.z); data.normals.push(round.x, round.y, round.z);
        data.uv.push(.5 + (Math.atan2(p.z, p.x) / 6.2832 + 1) % 1 * .5, p.y * .7 + (Math.hypot(p.x, p.z) - neck) * .5);
        const foot = .58 + .42 * Math.min(1, p.y / .8);
        data.colors.push(color.r * foot, color.g * foot, color.b * foot);
      }
      data.indices.push(first, first + 1, first + 2);
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
    // La tarjeta va doblada por su diagonal: de canto muestra un filo de hojas y no una raya de papel.
    const p = center.clone().addScaledVector(right, (u - .5) * width).addScaledVector(up, (v - .5) * height)
      .addScaledVector(normal, (u === v ? -.09 : .09) * width);
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
 * Cada ejemplar tiene 288–544 triángulos de hojas, más tronco, raíces y ramas (menos de 900 en total).
 */
export function createUrbanTree(scale = 1, { seed = 1, species = 'urapan' } = {}) {
  species = URBAN_TREE_SPECIES.includes(species) ? species : 'urapan';
  scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const profile = SHAPES[species], r = random(seed), h = profile.height * (.94 + r() * .12);
  const trunkData = buffers(), leafData = buffers(true), barkColor = new THREE.Color(profile.bark);
  const phase = r() * Math.PI * 2, frequency = 1.05 + r() * .45, lean = (r() - .5) * .3;
  const trunk = [new THREE.Vector3(), new THREE.Vector3(lean * .3, h * .28, 0),
    new THREE.Vector3(lean, h * .55, .07), new THREE.Vector3(lean * .6, h * .8, .12), new THREE.Vector3(lean * .4, h * .97, .08)];
  const girths = [profile.trunk * 1.3, profile.trunk, profile.trunk * .7, profile.trunk * .35, .025];
  // La corteza de cada árbol sale de un azar aparte: más clara o más oscura, más gris o más parda, y girada.
  const skin = random((seed ^ 0x3d9a1c57) >>> 0), turn = skin() * Math.PI * 2, lift = skin();
  barkColor.lerp(new THREE.Color(skin() < .5 ? '#77766f' : '#7c6248'), skin() * .3).multiplyScalar(1.04 + skin() * .3);
  const along = y => {
    let i = 1;
    while (i < trunk.length - 1 && trunk[i].y < y) i++;
    const t = (y - trunk[i - 1].y) / (trunk[i].y - trunk[i - 1].y);
    return { point: trunk[i - 1].clone().lerp(trunk[i], t), girth: girths[i - 1] + (girths[i] - girths[i - 1]) * t,
      axis: trunk[i].clone().sub(trunk[i - 1]).normalize() };
  };
  // Los dos tramos comparten el eje del anillo donde se juntan: no queda rendija entre ellos.
  const tube = (heights, swell, sides, look) => branch(trunkData, heights.map(y => along(y).point),
    heights.map((y, i) => along(y).girth * (swell[i] ?? 1)), sides, barkColor, { ...look, axes: heights.map(y => along(y).axis) });
  // Diez lados hasta la primera horqueta: el cuello de raíz se abre abajo y el primer metro largo lleva liquen y tierra.
  tube([0, .1, .25, 1.2], [1.5, 1.2], 10, { column: 1, turn });
  tube([1.2, profile.fork], [], 10, { turn, lift });
  // El fuste alto, de siete lados, nace un poco adentro del tramo de abajo.
  branch(trunkData, [along(profile.fork - .06).point, ...trunk.slice(2)], [along(profile.fork).girth * .9, ...girths.slice(2)], 7, barkColor, { lift });
  roots(trunkData, skin, girths[0] * 1.5, turn, barkColor);
  const tips = [];
  for (let i = 0; i < profile.branches; i++) {
    const t = i / (profile.branches - 1), angle = i * 2.39996 + r() * .5;
    const radius = profile.radius * (.72 + r() * .28) * (species === 'eucalipto' ? 1 - t * .35 : 1 - t * .18);
    const y = profile.fork + (h - profile.fork) * t * .65;
    const start = new THREE.Vector3(lean, y, .05);
    const end = new THREE.Vector3(Math.cos(angle) * radius, y + .65 + r() * .55, Math.sin(angle) * radius);
    const middle = start.clone().lerp(end, .55); middle.y -= .12;
    const thickness = profile.trunk * (.42 - t * .2);
    branch(trunkData, [start, middle, end], [thickness, thickness * .65, .012], 5, barkColor, { lift });
    const twig = end.clone().add(new THREE.Vector3(Math.sin(angle) * .35, .3, Math.cos(angle) * .35));
    branch(trunkData, [middle, twig], [thickness * .35, .009], 3, barkColor, { lift });
    tips.push(end);
  }
  if (species === 'arrayan') {
    for (const sign of [-1, 1]) branch(trunkData, [new THREE.Vector3(sign * .1, 0, 0),
      new THREE.Vector3(sign * .35, 1.5, .1), new THREE.Vector3(sign * .7, 2.8, .2)], [.11, .07, .022], 5, barkColor, { lift });
  }
  // El color sale de un azar aparte: la forma de cada semilla no cambia.
  const tone = random((seed ^ 0x51ed270b) >>> 0), bias = tone() - .5;
  const deep = new THREE.Color(profile.deep), fresh = new THREE.Color(profile.fresh), dry = new THREE.Color(profile.dry);
  // Cada árbol se corre un poco hacia el verde hondo o hacia el brote: dos vecinos no quedan iguales.
  const leafColor = new THREE.Color(profile.foliage).lerp(bias > 0 ? fresh : deep, Math.abs(bias) * .7);
  // Cada copa tira a un verde propio, más amarillo o más azulado, más claro o más oscuro: una hilera no es un solo color.
  const verde = random((seed ^ 0x7c3b5e19) >>> 0), warm = verde() - .5, value = .88 + verde() * .26;
  const cast = new THREE.Color(warm > 0 ? '#a3a35a' : '#3c5a4a'), castAmount = Math.abs(warm) * .5;
  // La flor sale de otro azar: ni la forma ni los verdes de una semilla cambian por florecer.
  const flor = random((seed ^ 0x2f1a9c3d) >>> 0);
  const flower = species !== 'eucalipto' && flor() < FLOWERING ? (flor() < .5 ? 'morada' : 'amarilla') : null;
  const bloom = flower && new THREE.Color(FLOWERS[flower]);
  const heart = new THREE.Vector3(lean * .5, profile.fork + (h - profile.fork) * .35, .08), reach = profile.radius + profile.spread;
  const addCluster = (center, count, spread) => {
    for (let i = 0; i < count; i++) {
      const angle = r() * Math.PI * 2, radius = Math.sqrt(r()) * spread;
      const position = center.clone().add(new THREE.Vector3(Math.cos(angle) * radius, (r() - .4) * spread * 1.2, Math.sin(angle) * radius));
      const size = profile.card * (.75 + r() * .45);
      // Dos o tres verdes por copa: el corazón queda en sombra, afuera sale el brote y alguna hoja seca.
      const out = Math.min(1, position.distanceTo(heart) / reach), pick = tone();
      const base = pick < .035 ? dry : pick < .3 + out * .2 ? fresh : pick < .62 - out * .22 ? deep : leafColor;
      const color = base.clone().lerp(leafColor, pick < .035 ? .4 : .35).lerp(cast, castAmount);
      // Florecen las ramillas de afuera, una sí y otra no: el corazón de la copa sigue verde.
      if (bloom && out > .45 && flor() < .5) color.lerp(bloom, flower === 'morada' ? .55 : .5);
      color.multiplyScalar((.7 + .4 * out) * (.87 + r() * .23) * value);
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
  root.userData.tree = { seed: seed >>> 0, species, flower, leafCards: leafData.indices.length / 6,
    triangles: (trunkData.indices.length + leafData.indices.length) / 3 };
  return root;
}
