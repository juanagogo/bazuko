import * as THREE from 'three';
import { Batch, FACES, NO_BACK } from './ZoneGeometry.js';
import { rng } from './textures.js';
import { withVisualRandom } from './VisualRandom.js';
import { patchSunFieldShader } from './SunFieldShader.js';

// Pan de las Cinco, en la Carrera 6. El paño del costado conserva su persiana.
const SOLAR = 4260001612;
const GLASS_DEPTH = -.177;
const BACK = -1.48;
const LAMP = { color: '#ffe5ba', surface: 0, night: 1.42, sky: .04 };
const PLASTER = { color: '#8a8070', surface: 0, night: .20, sky: .025 };
const TILE = { color: '#958f7f', surface: 0, night: .29, sky: .031 };
const FRAME = { color: '#634530', surface: 1, night: .20, sky: .042 };
const OAK = { color: '#9c6f40', surface: 1, night: .24, sky: .053 };
const OAK_EDGE = { color: '#c1955b', surface: 1, night: .32, sky: .068 };
const STEEL = { color: '#9ca9a7', surface: 2, night: .48, sky: .091 };
const RIM = { color: '#bfcbc7', surface: 2, night: .59, sky: .116 };
const BREAD = { surface: 3, night: .93, sky: .19 };
const BAKES = {
  alinado: { length: .37, width: .184, height: .127, side: '#ce8f49', crust: '#9a5428', crumb: '#efc590', score: .26 },
  mogolla: { length: .228, width: .203, height: .135, side: '#a97345', crust: '#694023', crumb: '#db9a64', score: .12 },
  queso: { length: .181, width: .159, height: .107, side: '#e5bd81', crust: '#c98d4a', crumb: '#f2d8ac', score: .19 }
};

export function bakeryOpening(local, seed, center, width, top) {
  return seed === SOLAR && local.id === 'panaderia' && local.estado === 'abierta' && width >= 2.8
    ? { left: center - width / 2, right: center + width / 2, bottom: .656, top } : null;
}

/** Las cuatro piezas que rodean el vano, con el recorte correspondiente de la pintura original. */
export function panelsAround([left, bottom, right, top], hole, [u0, v0, u1, v1]) {
  const a = Math.max(left, hole.left), b = Math.min(right, hole.right);
  const low = Math.max(bottom, hole.bottom), high = Math.min(top, hole.top);
  if (a >= b || low >= high) return [[left, bottom, right, top, [u0, v0, u1, v1]]];
  const u = x => THREE.MathUtils.lerp(u0, u1, (x - left) / (right - left));
  const v = y => THREE.MathUtils.lerp(v0, v1, (y - bottom) / (top - bottom));
  return [[left, bottom, a, top], [b, bottom, right, top], [a, bottom, b, low], [a, high, b, top]]
    .filter(([l, y, r, t]) => r > l && t > y)
    .map(([l, y, r, t]) => [l, y, r, t, [u(l), v(y), u(r), v(t)]]);
}

/** Raspa sólo los dos planos originales de la cara alta, por delante y por dentro. */
function cutWall(wall, face, length, plane, hole) {
  const batch = new Batch(), frame = batch.frame(face, plane);
  const origin = frame.P(0, 0, 0), end = frame.P(0, 0, 1);
  for (const mesh of wall.children.slice(0, 2)) {
    if (!mesh.isMesh || mesh.position.y !== 0) continue;
    const { position, uv } = mesh.geometry.attributes;
    if (position.count !== 4) continue;
    const px = position.getX(0) - origin[0], pz = position.getZ(0) - origin[2];
    const inset = px * (end[0] - origin[0]) + pz * (end[2] - origin[2]);
    const x = [...uv.array].filter((_, i) => i % 2 === 0), y = [...uv.array].filter((_, i) => i % 2 === 1);
    const low = Math.min(position.getY(0), position.getY(2)), high = Math.max(position.getY(0), position.getY(2));
    const rect = [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
    for (const [left, bottom, right, top, crop] of panelsAround([-length / 2, low, length / 2, high], hole, rect)) {
      frame.panel(mesh, (left + right) / 2, bottom, inset, right - left, top - bottom, crop);
    }
    const data = batch.groups.get(mesh);
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
    mesh.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
    mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    mesh.geometry.setIndex(data.index);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
}

const STATIONS = [[-1, .025], [-.84, .55], [-.48, .93], [.02, 1], [.55, .91], [.85, .54], [1, .025]];
// Dos puntos cerca de la greña por lado; los demás redondean el costado y la base del pan.
const SLICE = [-.16, 0, .16, .43, .88, 1.44, 2.0, 2.59, Math.PI, 3.75, 4.38, 4.97, 5.49, 5.88];

function loaf(batch, frame, random, type, u, y, n) {
  const { length, width, height, side, crust, crumb, score } = BAKES[type];
  const size = .92 + .16 * random(), turn = (random() - .5) * (type === 'alinado' ? .61 : 1.5);
  const sway = random() * Math.PI * 2, c = Math.cos(turn), s = Math.sin(turn);
  const positions = [], vertices = [], uv = [], index = [], colors = [];
  const color = new THREE.Color(), base = new THREE.Color(side), top = new THREE.Color(crust), cut = new THREE.Color(crumb);
  const baked = .91 + random() * .18;
  for (const [t, radius] of STATIONS) for (const angle of SLICE) {
    const ring = radius * (1 + .045 * Math.sin(angle * 3 + t * 4 + sway));
    const slit = Math.max(0, 1 - Math.abs(angle) / .18) * Math.max(0, 1 - t * t * 1.8);
    const x = length * t * size / 2, z = Math.sin(angle) * ring * width * size / 2;
    const crown = Math.cos(angle) * ring;
    const lift = Math.max(.01, .39 + .61 * crown - score * slit);
    const point = frame.P(u + x * c - z * s, y + lift * height * size, n + x * s + z * c);
    positions.push(point);
    vertices.push(...point);
    uv.push([(t + 1) / 2, angle / (2 * Math.PI)]);
    color.copy(base).lerp(top, THREE.MathUtils.clamp((crown - .05) * .66 + Math.sin(t * 9 + angle * 5 + sway) * .13, 0, .92));
    color.lerp(cut, slit * (type === 'queso' ? .63 : .76)).multiplyScalar(baked);
    colors.push(color.r, color.g, color.b);
  }
  const sides = SLICE.length;
  for (let i = 0; i < STATIONS.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    index.push(a, b, a + sides, b, b + sides, a + sides);
  }
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  shape.setIndex(index);
  shape.computeVertexNormals();
  const normals = Array.from({ length: positions.length }, (_, i) => [...shape.attributes.normal.array.slice(i * 3, i * 3 + 3)]);
  batch.indexed(BREAD, positions, normals, uv, index);
  const bread = batch.groups.get(BREAD);
  (bread.colors ??= []).push(...colors);
  shape.dispose();
}

function shelves(batch, f, u, random) {
  // Las bandejas inferiores se adelantan; entre familias queda visible el fondo de la vitrina.
  const trays = [
    [-.68, 1.035, -.52, 1.42, .49, 'alinado', [[-.43, .114], [-.02, .11], [.43, .102], [-.36, -.12], [.05, -.11], [.46, -.111]]],
    [.67, 1.035, -.49, .92, .43, 'queso', [[-.27, .082], [-.055, .097], [.18, .07], [-.22, -.11], [.017, -.119], [.266, -.101]]],
    [-.76, 1.39, -.713, 1.11, .44, 'mogolla', [[-.31, .082], [-.061, .111], [.192, .097], [-.28, -.140], [.005, -.136], [.277, -.133]]],
    [.54, 1.39, -.721, 1.21, .377, 'alinado', [[-.38, .004], [.007, -.063], [.397, .021]]],
    [-.40, 1.72, -.886, .82, .323, 'queso', [[-.23, .037], [.022, .059], [.266, -.045]]],
    [.62, 1.72, -.885, .88, .347, 'mogolla', [[-.263, -.021], [.015, .02], [.261, -.029]]]
  ];
  for (const [offset, y, n, w, depth, type, pieces] of trays) {
    const x = u + offset;
    f.box(STEEL, x, y, n, w, .021, depth);
    for (const edge of [-1, 1]) {
      f.box(RIM, x + edge * (w / 2 - .009), y + .017, n, .018, .032, depth, null, NO_BACK);
      f.box(RIM, x, y + .018, n + edge * (depth / 2 - .008), w, .029, .016, null, NO_BACK);
    }
    for (const [left, front] of pieces) loaf(batch, f, random, type, x + left, y + .021, n + front);
  }
}

class BakeryMaterial extends THREE.MeshStandardMaterial {
  onBeforeCompile(shader) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bakerySurface; varying vec3 vBakerySurface; varying vec2 vBakeryUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakerySurface = bakerySurface; vBakeryUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBakerySurface; varying vec2 vBakeryUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wood = max(0., 1. - abs(vBakerySurface.x - 1.));
        float steel = max(0., 1. - abs(vBakerySurface.x - 2.));
        float crust = max(0., 1. - abs(vBakerySurface.x - 3.));
        float grain = sin(vBakeryUv.x * 31. + sin(vBakeryUv.y * 10.) + .44 * sin(vBakeryUv.x * 46.));
        float brushing = sin(vBakeryUv.y * 75. + vBakeryUv.x * 1.5);
        float pores = sin(vBakeryUv.y * 112.) * sin(vBakeryUv.x * 162.);
        float fade = 1. - smoothstep(.02, .07, max(fwidth(vBakeryUv.x), fwidth(vBakeryUv.y)));
        diffuseColor.rgb *= 1. + grain * wood * .055 + fade * (brushing * steel * .027 + pores * crust * .045);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .34 + .035 * brushing, steel);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = .59 * steel;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 reflectedSky = vec3(.74, .83, 1.) * vBakerySurface.z;
        totalEmissiveRadiance = diffuseColor.rgb * (totalEmissiveRadiance * vBakerySurface.y + reflectedSky);`);
    patchSunFieldShader(shader);
  }
}

function finishDisplay(batch, parent, f, u) {
  const position = [], normal = [], uv = [], color = [], surface = [], index = [];
  const lamp = f.P(u, 2.03, -.60), end = f.P(u + 1, 2.03, -.60);
  const tx = end[0] - lamp[0], tz = end[2] - lamp[2];
  for (const [paint, data] of batch.groups) {
    const first = position.length / 3, tint = paint.color && new THREE.Color(paint.color);
    position.push(...data.position); normal.push(...data.normal); uv.push(...data.uv);
    for (let i = 0; i < data.position.length; i += 3) {
      const dx = data.position[i] - lamp[0], dy = data.position[i + 1] - lamp[1], dz = data.position[i + 2] - lamp[2];
      // El tubo alumbra las caras altas de pan y bandejas. Los paños de atrás reciben el rebote.
      const along = THREE.MathUtils.clamp(dx * tx + dz * tz, -.86, .86);
      const d2 = (dx - along * tx) ** 2 + dy ** 2 + (dz - along * tz) ** 2;
      const up = Math.max(0, data.normal[i + 1]);
      const fill = paint.night * (.13 + (.47 + .43 * up) / (1 + 1.6 * d2));
      const bounce = .93 + .15 * up;
      const sky = paint.sky * (.36 + .64 * up);
      if (tint) color.push(tint.r * bounce, tint.g * bounce, tint.b * bounce);
      else color.push(data.colors[i] * bounce, data.colors[i + 1] * bounce, data.colors[i + 2] * bounce);
      surface.push(paint.surface, paint === LAMP ? paint.night : fill, sky);
    }
    for (const i of data.index) index.push(first + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('bakerySurface', new THREE.Float32BufferAttribute(surface, 3));
  geometry.setIndex(index);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new BakeryMaterial({ vertexColors: true, roughness: .88, emissive: '#ffdfb7', emissiveIntensity: 0 });
  material.userData.batchAttributes = ['color', 'bakerySurface'];
  material.userData.windowGlow = .95;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Mostrador y bandejas de Pan de las Cinco';
  mesh.userData.visualOnly = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

export function addBakeryDisplay(wall, face, length, plane, opening, seed) {
  withVisualRandom(() => {
    cutWall(wall, face, length, plane, opening);
    const { left, right, bottom, top } = opening, u = (left + right) / 2, w = right - left;
    const opaque = new Batch(), f = opaque.frame(face, plane);
    for (const edge of [left + .042, right - .042]) f.box(FRAME, edge, bottom, -.115, .084, top - bottom, .264, null, NO_BACK);
    f.box(OAK_EDGE, u, bottom - .016, -.115, w, .087, .282, null, NO_BACK);
    f.box(FRAME, u, top - .065, -.104, w, .065, .254, null, NO_BACK);
    f.box(PLASTER, u, bottom, BACK, w - .12, top - bottom, .046);
    for (const edge of [left + .07, right - .07]) f.box(PLASTER, edge, bottom, -.828, .051, top - bottom, 1.319);
    for (const y of [.99, 1.32, 1.65]) for (let i = 0; i < 6; i++) {
      const x = left + .3 + i * .5 + (y === 1.32 ? .085 : 0);
      f.panel(TILE, x, y, BACK + .027, Math.min(.48, (right - x) * 2), .313);
    }
    f.box(PLASTER, u, top - .056, -.822, w - .14, .043, 1.32, null, FACES.bottom);
    f.box(STEEL, u, top - .101, -.602, 1.98, .047, .117, null, NO_BACK);
    f.box(LAMP, u, top - .108, -.607, 1.87, .013, .084, null, FACES.bottom | FACES.front);
    f.box(FRAME, u, bottom + .045, -.556, w - .29, .267, .664);
    for (const dx of [-.96, -.32, .32, .96]) {
      f.box(OAK, u + dx, bottom + .084, -.218, .568, .182, .025, null, NO_BACK);
    }
    f.box(OAK_EDGE, u, 1.001, -.562, w - .25, .032, .681, null, NO_BACK);
    for (const dx of [-1.23, 1.23]) f.box(STEEL, u + dx, 1.029, -.943, .031, .739, .039, null, NO_BACK);
    for (const [y, n] of [[1.36, -.713], [1.692, -.885]]) {
      f.box(STEEL, u, y, n, w - .36, .027, .45, null, NO_BACK);
    }
    shelves(opaque, f, u, rng((seed ^ 0x50ad1a1) >>> 0));
    // Un solo cristal limpio, detrás de dos listones. Ni el pan ni las bandejas salen de su plano.
    for (const dx of [-.44, .46]) f.box(FRAME, u + dx, bottom + .071, -.137, .035, top - bottom - .136, .087, null, NO_BACK);
    const glass = new THREE.MeshStandardMaterial({ color: '#adc1ba', metalness: .08, roughness: .32, opacity: .13,
      transparent: true, depthWrite: false, forceSinglePass: true, envMapIntensity: .55 });
    const glazing = new Batch();
    glazing.frame(face, plane).panel(glass, u, bottom + .068, GLASS_DEPTH, w - .147, top - bottom - .13);
    glazing.finish(wall, { name: 'Vidrio de Pan de las Cinco', castShadow: false, visualOnly: true });
    finishDisplay(opaque, wall, f, u);
  });
}
