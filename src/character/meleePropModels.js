import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { returnLabelMap, satinMap, timberMap } from './meleePropSurfaces.js';

const shapes = {};
const TAU = Math.PI * 2;

function mesh(name, geometry, finish) {
  const material = new THREE.MeshStandardMaterial(finish);
  material.name = name;
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  return part;
}

function lathe(outline, sides) {
  return new THREE.LatheGeometry(outline.map(([r, y]) => new THREE.Vector2(r, y)), sides);
}

function knifeHandle() {
  const grip = lathe([
    [.0001, -.069], [.010, -.068], [.016, -.063], [.0195, -.052], [.019, -.030],
    [.016, .011], [.016, .033], [.018, .047], [.016, .052], [.0001, .052]
  ], 16).scale(1, 1, .69);
  const uv = grip.attributes.uv, pos = grip.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, .765 + .218 * uv.getX(i), .1 + (pos.getY(i) + .069) * 6.2);
  return grip;
}

function steelDetails() {
  const rows = [
    [.051, -.014, .013], [.064, -.017, .015], [.072, -.018, .027],
    [.102, -.0185, .028], [.159, -.016, .024], [.202, -.012, .016],
    [.237, -.008, .005], [.265, -.0045, -.004]
  ];
  // Bandas longitudinales con normales independientes para lomo, cara ancha y bisel.
  const cross = [[0, .0013], [.08, .0027], [.84, .0022], [1, 0], [.84, -.0022], [.08, -.0027], [0, -.0013]];
  const tints = ['#a5adae', '#c5cbca', '#e6e9db', '#e3e5da', '#bfc6c5', '#9fa6a5', '#969a95'];
  const position = [], color = [], tone = new THREE.Color();
  const point = (row, band) => {
    const [y, spine, edge] = rows[row], [u, height] = cross[band];
    const tip = THREE.MathUtils.clamp((.265 - y) / .042, .10, 1);
    return [THREE.MathUtils.lerp(spine, edge, u), y, height * tip];
  };
  for (let row = 0; row < rows.length - 1; row++) for (let band = 0; band < cross.length; band++) {
    const next = (band + 1) % cross.length;
    const a = point(row, band), b = point(row, next), c = point(row + 1, band), d = point(row + 1, next);
    tone.set(tints[band]);
    for (const p of [a, b, c, b, d, c]) {
      position.push(...p);
      color.push(tone.r, tone.g, tone.b);
    }
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  blade.computeVertexNormals();
  const bolster = lathe([[.016, .045], [.018, .049], [.017, .057], [.014, .066], [.001, .066]], 14).scale(1, 1, .68);
  const pins = [[-.039, .0288], [.025, .024]].map(([y, width]) => new THREE.CylinderGeometry(.0045, .0045, width, 10)
    .rotateX(Math.PI / 2).translate(0, y, 0));
  const details = [bolster, ...pins].map((part, i) => {
    const plain = part.toNonIndexed();
    part.dispose();
    const colors = new Float32Array(plain.attributes.position.count * 3);
    tone.set(i ? '#c1a581' : '#a79b85');
    for (let k = 0; k < colors.length; k += 3) tone.toArray(colors, k);
    plain.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    plain.deleteAttribute('uv');
    return plain;
  });
  const pieces = [blade, ...details], steel = mergeGeometries(pieces);
  for (const part of pieces) part.dispose();
  const uv = [], p = steel.attributes.position;
  for (let i = 0; i < p.count; i++) uv.push((p.getX(i) + .027) / .06, (p.getY(i) + .07) / .34);
  steel.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return steel;
}

export function knife() {
  const group = new THREE.Group();
  group.add(mesh('mango-de-madera', shapes.grip ??= knifeHandle(), { color: '#b58b69', map: timberMap(), roughness: .69 }));
  group.add(mesh('acero-satinado', shapes.steel ??= steelDetails(), {
    map: satinMap(), vertexColors: true, roughness: .39, metalness: .53
  }));
  return group;
}

const CHIPS = [0, .006, -.005, -.002, .012, -.004, .003, -.011, .005, -.004, .014, -.001,
  -.007, .004, -.003, .012, -.006, .003, -.008, .005, .003, -.009, .010, .002];
const fracture = (angle, i) => .026 * Math.cos(angle - .32) + .009 * Math.sin(angle * 3 + .7) + CHIPS[i % CHIPS.length];
const bottleRadius = (r, a) => r * (1 + .014 * Math.cos(a * 8) * THREE.MathUtils.smoothstep(r, .025, .045));

/** El perfil baja de nuevo por dentro. Ambos extremos son abiertos y el canto roto tiene espesor. */
function glassShell() {
  const profile = [
    [.012, -.062, '#384f26'], [.015, -.065, '#adc789'], [.021, -.062, '#78924a'],
    [.021, -.056, '#698b3c'], [.018, -.052, '#3c632d'], [.0185, -.048, '#6f8e46'],
    [.015, -.044, '#4c6e32'], [.0145, .024, '#4d7435'], [.018, .055, '#4b7133'],
    [.030, .091, '#466b30'], [.041, .116, '#456b32'], [.045, .133, '#557c39'],
    [.045, .150, '#497032'], [.045, .209, '#699546', true], [.0448, .212, '#acc884', true],
    [.0413, .212, '#abc67e', true], [.0408, .209, '#6a8e48', true], [.041, .136, '#344d27'],
    [.037, .119, '#3f592a'], [.025, .093, '#344d27'], [.014, .057, '#39532a'],
    [.0108, .022, '#354b28'], [.0108, -.054, '#2e4124'], [.012, -.062, '#384f26']
  ];
  const position = [], color = [], index = [], tone = new THREE.Color();
  const sides = CHIPS.length, stride = sides + 1;
  for (let row = 0; row < profile.length; row++) {
    const [r, height, tint, broken] = profile[row];
    for (let i = 0; i <= sides; i++) {
      const a = i % sides * TAU / sides, radius = bottleRadius(r, a);
      position.push(Math.sin(a) * radius, height + (broken ? fracture(a, i) : 0), Math.cos(a) * radius);
      tone.set(tint).multiplyScalar(.98 + .14 * Math.cos(a * 7 + .25));
      color.push(tone.r, tone.g, tone.b);
      if (row === profile.length - 1 || i === sides) continue;
      const p = row * stride + i, q = p + stride;
      index.push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
  const glass = new THREE.BufferGeometry();
  glass.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  glass.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  glass.setIndex(index);
  glass.computeVertexNormals();
  const normals = glass.attributes.normal, average = new THREE.Vector3(), other = new THREE.Vector3();
  for (let row = 0; row < profile.length; row++) {
    const a = row * stride, b = a + sides;
    average.fromBufferAttribute(normals, a).add(other.fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, average.x, average.y, average.z);
    normals.setXYZ(b, average.x, average.y, average.z);
  }
  return glass;
}

function bottleLabel() {
  // Comparte los vértices angulares del cuerpo para que el papel siga su contorno.
  const position = [], normal = [], uv = [], index = [], sides = CHIPS.length;
  for (let i = 0; i <= sides; i++) {
    const a = i % sides * TAU / sides;
    const r = bottleRadius(.045, a) + .00065;
    const low = .139 + .002 * Math.sin(a * 5) + .21 * CHIPS[i % sides];
    const high = Math.min(.193 + .005 * Math.cos(a * 3) + .4 * CHIPS[i % sides], .205 + fracture(a, i));
    for (const [y, v] of [[low, 0], [high, 1]]) {
      position.push(Math.sin(a) * r, y, Math.cos(a) * r);
      normal.push(Math.sin(a), 0, Math.cos(a));
      uv.push(i / sides, v);
    }
    if (i < sides) {
      const p = i * 2;
      index.push(p, p + 2, p + 1, p + 2, p + 3, p + 1);
    }
  }
  const paper = new THREE.BufferGeometry();
  paper.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  paper.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  paper.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  paper.setIndex(index);
  return paper;
}

export function brokenBottle() {
  const group = new THREE.Group();
  group.add(mesh('vidrio-verde', shapes.glass ??= glassShell(), {
    vertexColors: true, metalness: .12, roughness: .20, transparent: true, opacity: .9
  }));
  group.add(mesh('papel-crema-y-ocre', shapes.label ??= bottleLabel(), { map: returnLabelMap(), roughness: .93 }));
  return group;
}

function signboard() {
  // El recorte continúa en las caras y el canto. Los dos agujeros dejan ver el fondo.
  const outline = [
    [-.039, -.068], [-.021, -.064], [-.015, -.076], [.005, -.073], [.012, -.079], [.039, -.071],
    [.035, .025], [.053, .106], [.071, .221], [.074, .414], [.076, .530], [.068, .565],
    [.056, .556], [.049, .602], [.042, .617], [.030, .611], [.022, .581], [.016, .565],
    [.013, .602], [.002, .621], [-.005, .616], [-.014, .632], [-.026, .623],
    [-.035, .582], [-.040, .549], [-.049, .578], [-.064, .553], [-.068, .489],
    [-.073, .426], [-.069, .324], [-.062, .213], [-.041, .077]
  ];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const [x, y, r] of [[.031, .539, .009], [-.012, -.040, .006]]) {
    const hole = new THREE.Path();
    hole.absellipse(x, y, r, r * .91, .14, TAU + .14, true);
    shape.holes.push(hole);
  }
  const plank = new THREE.ExtrudeGeometry(shape, {
    depth: .019, bevelEnabled: true, bevelSize: .0014, bevelThickness: .0016, bevelSegments: 1, curveSegments: 5
  }).translate(0, 0, -.0095);
  plank.clearGroups();
  const { position, normal, uv } = plank.attributes;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const face = normal.getZ(i);
    const u = THREE.MathUtils.clamp((x + .075) / .152, .003, .997);
    const s = Math.abs(face) > .93 ? .74 * (face > 0 ? u : 1 - u) : .87 + 3.8 * z;
    uv.setXY(i, s, (y + .082) / .719);
  }
  return plank;
}

export function club() {
  const group = new THREE.Group();
  group.add(mesh('tabla-de-letrero', shapes.board ??= signboard(), { map: timberMap(), roughness: .89 }));
  return group;
}
