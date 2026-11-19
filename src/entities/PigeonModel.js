import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { withVisualRandom } from '../world/bogota/VisualRandom.js';
import { chainSunField } from '../world/bogota/SunFieldShader.js';

const TAU = Math.PI * 2;
const buffers = () => ({ position: [], color: [], index: [] });
const paint = hex => new THREE.Color(hex);

function vertex(data, x, y, z, color, light = 1) {
  data.position.push(x, y, z);
  data.color.push(color.r * light, color.g * light, color.b * light);
}

function finish(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
  geometry.setIndex(data.index);
  geometry.computeVertexNormals();
  return geometry;
}

function connect(data, start, rows, columns, { wrap = false, reverse = false } = {}) {
  for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns - (wrap ? 0 : 1); column++) {
    const a = start + row * columns + column, b = start + row * columns + (column + 1) % columns;
    const c = a + columns, d = b + columns;
    if (reverse) data.index.push(a, c, b, b, c, d);
    else data.index.push(a, b, c, b, d, c);
  }
}

function part(geometry, color, position, scale, pitch = 0) {
  geometry.scale(...scale).rotateX(pitch).translate(...position);
  geometry.deleteAttribute('uv');
  const rgb = paint(color), colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// La sección gira con el eje del ave. Pecho, garganta y nuca forman una superficie continua.
// Las últimas dos columnas indican cuánto cuello se dobla y el color del plumaje.
const PROFILE = [
  [.162, -.197, .008, .01, 0, '#53575e'],
  [.18, -.154, .055, .046, 0, '#686d72'],
  [.194, -.098, .086, .074, 0, '#797f84'],
  [.203, -.025, .107, .101, 0, '#8b8e90'],
  [.22, .052, .104, .113, 0, '#939496'],
  [.251, .088, .086, .101, .1, '#84868d'],
  [.29, .106, .065, .079, .32, '#585369'],
  [.332, .107, .052, .064, .66, '#3c645e'],
  [.37, .12, .056, .061, .94, '#52596a'],
  [.399, .144, .053, .052, 1, '#555963'],
  [.405, .168, .034, .033, 1, '#5b5d63'],
  [.397, .186, .006, .006, 1, '#4c4c52']
];

function plumage() {
  const sides = 12, data = buffers(), bends = [], shade = new THREE.Color();
  const green = paint('#507263'), violet = paint('#62516d');
  PROFILE.forEach(([y, z, width, radius, bend, hex], row) => {
    const prev = PROFILE[Math.max(0, row - 1)], next = PROFILE[Math.min(PROFILE.length - 1, row + 1)];
    const dy = next[0] - prev[0], dz = next[1] - prev[1], length = Math.hypot(dy, dz), tint = paint(hex);
    for (let side = 0; side < sides; side++) {
      const angle = TAU * side / sides, around = Math.sin(angle);
      const offset = radius * around;
      shade.copy(tint);
      if (row === 6 || row === 7) shade.lerp(around < 0 ? violet : green, .32 + .27 * Math.abs(around));
      vertex(data, width * Math.cos(angle), y + offset * dz / length, z - offset * dy / length,
        shade, .94 + .09 * around);
      bends.push(bend);
    }
  });
  connect(data, 0, PROFILE.length, sides, { wrap: true });
  const last = (PROFILE.length - 1) * sides;
  for (let i = 1; i < sides - 1; i++) data.index.push(0, i + 1, i, last, last + i, last + i + 1);
  return { geometry: finish(data), bends };
}

function tail() {
  const data = buffers();
  const root = paint('#777d83'), cover = paint('#65696c'), tips = paint('#40424a');
  const rows = [
    [0, .042, root], [.38, .058, cover], [.65, .061, cover], [.72, .06, tips], [1, .054, tips]
  ];
  const barbs = 9;
  for (const [length, width, color] of rows) for (let i = 0; i < barbs; i++) {
    const u = i / (barbs - 1) * 2 - 1;
    const seam = i % 2 ? 1 : .91;
    vertex(data, width * u, .193 - length * .047 + (1 - u * u) * .009,
      -.118 - length * .179 + length * length * (.024 * u * u + (i % 2 ? 0 : .008)), color, seam);
  }
  connect(data, 0, rows.length, barbs);
  return finish(data);
}

function eye(side) {
  const cx = side * .0485, cy = .405, cz = .153;
  const piece = part(new THREE.SphereGeometry(1, 6, 4), '#a16a40', [cx, cy, cz], [.0075, .0108, .0103]);
  const points = piece.attributes.position, colors = piece.attributes.color, pupil = paint('#191a1c');
  for (let i = 0; i < points.count; i++) {
    if ((points.getX(i) - cx) * side > .0061) colors.setXYZ(i, pupil.r, pupil.g, pupil.b);
  }
  return piece;
}

export function pigeonBody() {
  const { geometry: core, bends } = plumage();
  const upper = part(new THREE.ConeGeometry(.015, .053, 7), '#3c3a41', [0, .395, .201], [1, 1, .64], Math.PI / 2 + .10);
  const lower = part(new THREE.ConeGeometry(.013, .044, 7), '#4c4347', [0, .387, .199], [1, 1, .48], Math.PI / 2 - .09);
  const cere = part(new THREE.SphereGeometry(1, 6, 4), '#c0b5a4', [0, .404, .18], [.014, .008, .014]);
  const parts = [core, upper, lower, cere, tail(), eye(-1), eye(1)];
  for (const [i, piece] of parts.entries()) {
    const weight = i === 0 ? bends : new Float32Array(piece.attributes.position.count).fill(i === 4 ? 0 : 1);
    piece.setAttribute('neckBend', new THREE.Float32BufferAttribute(weight, 1));
  }
  const geometry = mergeGeometries(parts);
  for (const piece of parts) piece.dispose();
  // El picoteo guarda una sola postura de destino. El color y la sombra leen el mismo peso por ave.
  const dipped = withVisualRandom(() => geometry.clone());
  const positions = dipped.attributes.position, weight = dipped.attributes.neckBend;
  const neckY = .224, neckZ = .085;
  for (let i = 0; i < positions.count; i++) {
    const angle = weight.getX(i) * 1.86;
    const y = positions.getY(i) - neckY, z = positions.getZ(i) - neckZ;
    positions.setY(i, neckY + Math.cos(angle) * y - Math.sin(angle) * z);
    positions.setZ(i, neckZ + Math.sin(angle) * y + Math.cos(angle) * z);
  }
  dipped.computeVertexNormals();
  geometry.setAttribute('pigeonDippedPosition', positions);
  geometry.setAttribute('pigeonDippedNormal', dipped.attributes.normal);
  geometry.deleteAttribute('neckBend');
  dipped.dispose();
  return geometry;
}

// Ala abierta con curvatura en el hombro y borde de rémiges. El giro de la instancia la guarda contra el costado.
export function pigeonWing(side) {
  const data = buffers(), gray = paint('#91969c'), bars = paint('#40424a'), feathers = paint('#626771');
  const sections = [
    [.003, .077, -.091, .011], [.032, .089, -.132, .017], [.067, .086, -.153, .022],
    [.113, .064, -.156, .023], [.153, .037, -.163, .02], [.192, .009, -.149, .016],
    [.225, -.035, -.139, .012], [.253, -.083, -.108, .008]
  ];
  const chord = [0, .21, .39, .47, .52, .59, .65, .72, .79, .88, 1];
  sections.forEach(([span, leading, trailing, arch], row) => {
    for (const t of chord) {
      const band = (t >= .47 && t <= .52) || (t >= .72 && t <= .79);
      const material = band ? bars : t >= .88 || row >= 6 ? feathers : gray;
      const notch = t ** 5 * ((row === 3 || row === 5) ? .012 : 0);
      const bowed = Math.sin(Math.PI * t) * (.02 - row * .0019);
      vertex(data, side * span, arch + bowed, leading + (trailing - leading) * t + notch, material,
        .91 + .1 * (1 - t) - (row % 2 ? .01 : 0));
    }
  });
  connect(data, 0, sections.length, chord.length, { reverse: side > 0 });
  return finish(data);
}

export function pigeonFoot() {
  const data = buffers(), rose = paint('#94696d'), foot = paint('#a97373'), claw = paint('#554c4e');
  function toe(a, b, c, radius, sides) {
    const start = data.position.length / 3;
    const axis = new THREE.Vector3().subVectors(c, a).normalize();
    const right = new THREE.Vector3(1, 0, 0).cross(axis).normalize(), up = axis.clone().cross(right);
    const rings = [[a, radius, rose], [b, radius * .68, foot], [c, radius * .24, claw]];
    for (const [point, r, color] of rings) for (let i = 0; i < sides; i++) {
      const angle = i / sides * TAU;
      const p = point.clone().addScaledVector(right, Math.cos(angle) * r).addScaledVector(up, Math.sin(angle) * r);
      vertex(data, p.x, p.y, p.z, color);
    }
    connect(data, start, rings.length, sides, { wrap: true });
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z), ankle = V(0, -.088, .013);
  toe(V(0, .004, -.009), V(.002, -.046, .009), ankle, .011, 5);
  for (const side of [-1, 0, 1]) {
    toe(ankle, V(side * .016, -.095, .03), V(side * .023, -.098, .048 - Math.abs(side) * .008), .006, 3);
  }
  toe(ankle, V(.006, -.095, -.003), V(.009, -.098, -.014), .005, 3);
  return finish(data);
}

/** El peso viaja en un atributo de instancia como la matriz, también en la pasada de sombra. */
export function posePigeonMaterial(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        attribute vec3 pigeonDippedPosition;
        attribute vec3 pigeonDippedNormal;
        attribute float pigeonDip;`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, pigeonDippedNormal, pigeonDip));')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = mix(transformed, pigeonDippedPosition, pigeonDip);');
  };
  material.customProgramCacheKey = () => 'paloma-picoteo';
  return chainSunField(material);
}
