// src/character/props.js
// Accesorios rígidos del personaje realista (bastón, pasamontañas, gorra), lo que carga la gente
// de la calle (maletín, bolsa de mercado, costal, casco…) y armas en mano (cuchillo, botella picada,
// pistola). No son ropa de MakeHuman: se arman con geometría simple y se atan a un hueso del esqueleto
// Mixamo, así siguen la animación.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { scarfGeometry, scarfTexture } from './scarf.js';
import { workHelmetGeometry, workHelmetMap } from './workwear.js';
import { UMBRELLA_COLORS, umbrellaGeometry, umbrellaMaterial } from './umbrella.js';
import { STREET_CANE_LENGTH, streetCaneGeometry, streetCaneMaterial } from './streetCane.js';
import { brokenBottle, club, knife } from './meleePropModels.js';

const CROOK = 0.055;
const SHAFT = 0.9;

// Geometrías compartidas entre instancias (los materiales son por instancia y se liberan con ella)
let shared = null;
function geometries() {
  if (shared) return shared;
  // mango en curva: sale de la punta superior del palo, sube y baja hacia adelante (+Z)
  const handle = new THREE.TorusGeometry(CROOK, 0.014, 6, 12, Math.PI);
  handle.rotateY(-Math.PI / 2);
  handle.translate(0, 0, CROOK);
  shared = {
    shaft: new THREE.CylinderGeometry(0.012, 0.015, SHAFT, 8),
    handle
  };
  return shared;
}

/** Busca un hueso Mixamo aunque GLTFLoader haya quitado los dos puntos ("mixamorigRightHand"). */
export function findBone(bones, name) {
  for (const [key, bone] of bones) if (key.replace(/[^a-z0-9]/gi, '').endsWith(name)) return bone;
  return null;
}

const tone = (hex, wear) => new THREE.Color(hex).multiplyScalar(1 - wear * 0.18);

function cane(wear) {
  const g = geometries();
  const wood = new THREE.MeshStandardMaterial({ color: tone('#6b4a2e', wear), roughness: 0.9 });
  const group = new THREE.Group();
  group.name = 'prop-baston';
  const shaft = new THREE.Mesh(g.shaft, wood);
  const handle = new THREE.Mesh(g.handle, wood);
  group.add(shaft, handle);
  // el origen del grupo es la punta superior del palo; el puño agarra la parte alta del mango
  const grip = new THREE.Vector3(0, 0.07, 0.02); // en el espacio del hueso de la mano
  const p = new THREE.Vector3();
  return {
    bone: 'RightHand', object: group, space: 'root',
    // vertical y apoyado: sigue al puño, pero el palo siempre llega al suelo
    update(root, hand) {
      hand.updateWorldMatrix(true, false);
      root.worldToLocal(p.copy(grip).applyMatrix4(hand.matrixWorld));
      group.position.set(p.x, p.y - CROOK, p.z - CROOK);
      const length = Math.max(0.2, group.position.y + root.position.y); // el suelo está en y = -root.position.y
      shaft.scale.y = length / SHAFT;
      shaft.position.y = -length / 2;
    }
  };
}

// ---------- pasamontañas y gorra ----------
// En el espacio del personaje con origen en el hueso Head (mira a +Z). La cabeza va de ~-0,06 (mentón)
// a +0,17 (coronilla) sobre el hueso, y los ojos quedan a ~+0,03, adelante.
export const MASK_FIT = { center: [0, 0.1, 0.035], radius: [0.105, 0.135, 0.13], front: 0.175, eyes: [0.05, 0.082], eyeWidth: 0.062 };

let headShared = null;
function headGeometries() {
  if (headShared) return headShared;
  const { center: c, radius: r, front, eyes, eyeWidth } = MASK_FIT;
  // tejido ceñido a la cabeza con la ranura de los ojos abierta adelante; la cara (nariz) sobresale más
  const ball = new THREE.SphereGeometry(1, 20, 16).toNonIndexed();
  const pos = ball.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setXYZ(i, pos.getX(i) * r[0], pos.getY(i) * r[1], z * (z > 0 ? front : r[2]));
  }
  ball.translate(c[0], c[1], c[2]);
  const src = ball.attributes.position.array;
  const keep = [];
  for (let i = 0; i < src.length; i += 9) {
    const x = (src[i] + src[i + 3] + src[i + 6]) / 3;
    const y = (src[i + 1] + src[i + 4] + src[i + 7]) / 3;
    const z = (src[i + 2] + src[i + 5] + src[i + 8]) / 3;
    if (z > c[2] && y > eyes[0] && y < eyes[1] && Math.abs(x) < eyeWidth) continue;
    for (let k = 0; k < 9; k++) keep.push(src[i + k]);
  }
  const mask = new THREE.BufferGeometry();
  mask.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  mask.computeVertexNormals();
  // cuello del pasamontañas metido en el buzo
  const neck = new THREE.CylinderGeometry(0.068, 0.078, 0.12, 14).translate(0, -0.05, 0.02);
  // gorra: copa sobre la coronilla y visera hacia adelante
  const crown = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  crown.scale(r[0] + 0.012, r[1] * 0.75, r[2] + 0.012);
  crown.translate(c[0], c[1] + 0.035, c[2]);
  const brim = new THREE.CylinderGeometry(0.085, 0.085, 0.01, 16, 1, false, -Math.PI / 2, Math.PI);
  brim.scale(1.05, 1, 0.95);
  brim.rotateX(0.12);
  brim.translate(c[0], c[1] + 0.045, c[2] + r[2] - 0.01);
  headShared = { mask, neck, crown, brim };
  return headShared;
}

const knit = () => new THREE.MeshStandardMaterial({ color: '#141416', roughness: 1 });

function balaclava() {
  const g = headGeometries();
  const m = knit();
  const group = new THREE.Group();
  group.name = 'prop-pasamontanas';
  group.add(new THREE.Mesh(g.mask, m), new THREE.Mesh(g.neck, m));
  return { bone: 'Head', object: group, space: 'body' };
}

function cap() {
  const g = headGeometries();
  const m = new THREE.MeshStandardMaterial({ color: '#0d0d0f', roughness: 0.75 });
  const group = new THREE.Group();
  group.name = 'prop-gorra';
  group.add(new THREE.Mesh(g.crown, m), new THREE.Mesh(g.brim, m));
  return { bone: 'Head', object: group, space: 'body' };
}

const BUILDERS = { baston: cane, pasamontanas: balaclava, gorra: cap };
/** Accesorios baratos que también lleva el modelo lejano (se notan a distancia) */
export const FAR_ACCESSORIES = new Set(['pasamontanas', 'gorra', 'maletin', 'bolsa', 'bolso', 'morral', 'costal', 'casco', 'baston-calle', 'bufanda']);

/**
 * Ata los accesorios elegidos al esqueleto. Devuelve los objetos creados y `update`,
 * que se llama después de animar para los que no cuelgan de un hueso (bastón).
 */
export function attachAccessories(root, bones, ids = [], wear = 0) {
  const added = [], updaters = [];
  root.updateMatrixWorld(true);
  for (const id of ids) {
    const build = BUILDERS[id];
    if (!build) continue;
    const { bone, object, space, update } = build(wear);
    const target = findBone(bones, bone);
    if (!target) continue;
    object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (space === 'root') {
      root.add(object);
      updaters.push(() => update(root, target));
      updaters.at(-1)();
    } else if (space === 'body') {
      // posición relativa al hueso pero ejes del personaje: se ubica en pose de reposo y se pasa al hueso
      const anchor = target.getWorldPosition(new THREE.Vector3());
      root.worldToLocal(anchor);
      object.position.add(anchor);
      root.add(object);
      target.attach(object);
    } else {
      target.add(object);
    }
    added.push(object);
  }
  return { objects: added, update: () => { for (const fn of updaters) fn(); } };
}

// ---------- lo que carga la gente de la calle ----------
// Una sola malla por accesorio, una sola llamada de dibujo: la geometría es de módulo y el material se
// comparte por color. Ese material lleva `userData.shared` para que liberar a una persona no lo destruya.
// Sin vertexColors ni dos caras. El morral comparte una paleta para tela, correas y cierres.

const sharedMaterials = new Map();

/** Material compartido entre todos los que usen ese color, aspereza y mapa. */
export function sharedPropMaterial(color, roughness = .85, map = null) {
  const key = `${color}|${roughness}|${map?.uuid ?? ''}`;
  let material = sharedMaterials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness, map });
    material.name = 'prop-compartido';
    material.userData.shared = true;
    sharedMaterials.set(key, material);
  }
  return material;
}

/** Junta piezas en una sola geometría y quita las UV de las primitivas cuando son de un color liso. */
function fused(parts, keepUv = false) {
  if (!keepUv) for (const part of parts) part.deleteAttribute('uv');
  const out = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return out;
}

/** Superficie blanda: sin costura en la unión de la esfera y con la forma que diga `shape(v)`. */
function soft(geometry, shape) {
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');
  const out = mergeVertices(geometry, 1e-4);
  geometry.dispose();
  const pos = out.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    shape(v.fromBufferAttribute(pos, i));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  out.computeVertexNormals();
  return out;
}

const block = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cord = (points, radius = .011, segments = 8) => new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z))), segments, radius, 3);
/** Ruido fijo y suave, para que un costal o una bolsa no parezcan esferas. */
const lump = (v, a) => Math.sin(v.x * 17 + v.y * 11) * Math.cos(v.z * 13 - v.y * 7) * a;

// En la mano: origen en la muñeca y ejes del personaje (ver `holds` en stances.js).

/** Maletín colgando de la mano, con el lado largo hacia el frente. */
const maletinGeometry = () => fused([
  block(.085, .27, .39, 0, -.27, .015),
  block(.016, .016, .13, 0, -.098, .015),
  block(.016, .04, .016, 0, -.115, -.05),
  block(.016, .04, .016, 0, -.115, .08)
]);

/** Bolsa plástica de mercado, floja: el peso se le va al fondo, se recoge arriba en arrugas y las dos asas suben a la mano. */
function bolsaGeometry() {
  const belly = soft(new THREE.SphereGeometry(1, 16, 10), (v) => {
    const around = Math.atan2(v.x, v.z), down = (1 - v.y) / 2;
    const wide = .5 + .58 * Math.sin(Math.min(1, down * 1.15) * Math.PI * .6);
    const wrinkles = 1 + Math.sin(around * 6 + v.y * 4) * .2 * (1 - down) + Math.sin(v.y * 13 + around * 3) * .07 + Math.sin(around * 11 - v.y * 6) * .06 + lump(v, .13);
    // Se aplasta contra el fondo y no llena el plástico: una cara se hunde un poco.
    const dent = 1 - .22 * Math.max(0, Math.sin(around - 1)) * (1 - down);
    v.set(v.x * .086 * wide * wrinkles * dent, -.262 + v.y * .098 + (down > .8 ? (down - .8) * .05 : 0), .012 + v.z * .104 * wide * wrinkles * dent);
  });
  return fused([belly,
    cord([[-.016, -.178, .052], [-.01, -.125, .032], [-.004, -.085, .012], [.01, -.125, -.01], [.016, -.178, -.034]], .005, 6),
    cord([[.016, -.178, .058], [.012, -.13, .044], [.004, -.09, .02], [-.01, -.13, -.002], [-.016, -.178, -.028]], .005, 6)
  ]);
}

// El largo del bastón se ajusta a la mano sin escalonarlo durante la marcha.
const BASTON_DE_MAS = .060;
function closedStickGeometry() {
  const crook = new THREE.TorusGeometry(CROOK * .85, .011, 4, 7, Math.PI);
  crook.rotateY(-Math.PI / 2);
  crook.translate(0, -.075, CROOK * .85);
  return fused([crook, new THREE.CylinderGeometry(.011, .014, .725, 5).translate(0, -.4375, 0)]);
}

// A la espalda o de lado: cuelgan de Spine2 en ejes del personaje, con el origen en el cuello, que es lo que menos
// cambia de un cuerpo a otro: desde ahí el hombro queda a la misma altura, con 1 o 2 cm de diferencia, en los seis.

// `forward`: cuánto se acerca a una espalda que, medida desde el cuello, queda más adelante (la de los cuerpos de mujer).

const MORRAL_COLORS = new THREE.DataTexture(new Uint8Array([
  255, 255, 255, 255, // cuerpo de tela
  214, 219, 222, 255, // bolsillo algo más oscuro
  133, 133, 138, 255, // cintas
  81, 82, 85, 255 // cierres
]), 4, 1, THREE.RGBAFormat);
MORRAL_COLORS.needsUpdate = true;

function morralGeometry(forward = 0) {
  const rounded = (value, curve) => Math.sign(value) * Math.abs(value) ** curve;
  const pack = soft(new THREE.SphereGeometry(1, 14, 8), v => {
    v.set(rounded(v.x, .68) * (.149 - .009 * v.y), -.23 + rounded(v.y, .7) * .19,
      -.19 + forward + rounded(v.z, .75) * .081);
  });
  const pocket = soft(new THREE.SphereGeometry(1, 10, 6), v => {
    v.set(rounded(v.x, .59) * .107, -.302 + rounded(v.y, .65) * .086,
      -.254 + forward + rounded(v.z, .66) * .048);
  });
  const onPack = points => points.map(([x, y, z]) => [x, y, z + forward]);
  const zipper = cord(onPack([
    [-.126, -.21, -.239], [-.111, -.134, -.244], [-.077, -.091, -.243], [0, -.058, -.228],
    [.077, -.091, -.243], [.111, -.134, -.244], [.126, -.21, -.239]
  ]), .005, 14);
  const pocketZipper = cord(onPack([
    [-.091, -.254, -.282], [-.066, -.234, -.297], [0, -.226, -.298], [.066, -.234, -.297], [.091, -.254, -.282]
  ]), .004, 10);
  const pull = block(.011, .022, .007, -.049, -.244, -.303 + forward);
  const handle = cord(onPack([[-.032, -.064, -.19], [-.028, -.027, -.195], [0, -.016, -.196],
    [.028, -.027, -.195], [.032, -.064, -.19]]), .006, 6);
  const strap = (x) => cord([
    [x * .95, -.10, -.12 + forward], [x, -.03, -.09 + forward * .6], [x * 1.04, .012, -.02],
    [x * 1.1, -.03, .06], [x * 1.2, -.13, .118], [x * 1.53, -.244, .102],
    [x * 1.62, -.303, .008 + forward * .3], [x * 1.26, -.372, -.141 + forward]
  ], .014, 12);
  const parts = [[pack, 0], [pocket, 1], [handle, 2], [strap(.095), 2], [strap(-.095), 2],
    [zipper, 3], [pocketZipper, 3], [pull, 3]];
  return fused(parts.map(([part, swatch]) => {
    const uv = new Float32Array(part.attributes.position.count * 2);
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = (swatch + .5) / MORRAL_COLORS.image.width;
      uv[i + 1] = .5;
    }
    part.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return part;
  }), true);
}

/** Bolso de hombro: la correa pasa por el hombro izquierdo y el bolso cae al lado de la cadera. */
function bolsoGeometry() {
  const pouch = soft(new THREE.SphereGeometry(1, 8, 5), (v) => {
    v.set(.225 + v.x * .05, -.52 + Math.sign(v.y) * Math.abs(v.y) ** .7 * .1, .01 + Math.sign(v.z) * Math.abs(v.z) ** .6 * .13);
  });
  return fused([pouch,
    cord([[.232, -.43, .1], [.2, -.24, .1], [.16, -.08, .07], [.125, .002, -.012]], .008, 6),
    cord([[.232, -.43, -.08], [.2, -.24, -.105], [.16, -.08, -.095], [.125, .002, -.012]], .008, 6)
  ]);
}

/** Costal de fibra a la espalda: una caja blanda con pliegues que salen del nudo y arrugas de lo que carga; no pasa de la cabeza. */
function costalGeometry(forward = 0) {
  const centerY = -.2, halfHeight = .228, width = .155, depth = .155, z = -.215 + forward;
  const squared = (value, power) => Math.sign(value) * Math.abs(value) ** power;
  const sack = soft(new THREE.SphereGeometry(1, 22, 14), (v) => {
    const around = Math.atan2(v.x, v.z), up = (v.y + 1) / 2;
    const x = squared(v.x, .7), y = squared(v.y, .78), back = squared(v.z, .78);
    // Lo que carga se va al fondo y arriba se recoge hacia el nudo.
    const gather = (1.05 - .14 * up) * (1 - .64 * THREE.MathUtils.smoothstep(up, .72, 1));
    const pleats = Math.sin(around * 9 + v.y * 2.5) * .24 * THREE.MathUtils.smoothstep(up, .42, .96);
    const creases = Math.sin(v.y * 10 + Math.sin(around * 2) * 2) * .07 + Math.sin(around * 5 - v.y * 7) * .06;
    const bump = 1 + lump(v, .1) + pleats + creases;
    // Plano contra la espalda, redondo hacia afuera.
    v.set(.01 + x * width * gather * bump, centerY + y * halfHeight, z + (back > 0 ? back * .6 : back) * depth * gather * bump);
  });
  const top = centerY + halfHeight;
  const knot = new THREE.ConeGeometry(.028, .056, 5).translate(.01, top + .02, z);
  const rope = (x) => cord([[x * .9, top - .05, z + .05], [x, top - .02, -.09 + forward * .6], [x * 1.06, .012, -.02], [x * 1.14, -.05, .06], [x * 1.3, -.16, .115], [x * 1.7, -.26, .08]], .009, 7);
  return fused([sack, knot, rope(.095), rope(-.095)]);
}

// `hold`: postura cuyo marco de la mano usa. `bone`: hueso al que se ata, en ejes del personaje; `anchor`: de dónde se
// mide si no es ese hueso. `mujer`: escala para las cabezas de mujer, algo más pequeñas. `forward`: lo que se acerca a la
// espalda de un cuerpo de mujer, con su propia geometría de módulo. `sway`: balanceo con el paso, en radianes [de lado, de frente].
const STREET_PROPS = {
  maletin: { build: maletinGeometry, hold: 'cargar-izquierda', roughness: .55 },
  bolsa: { build: bolsaGeometry, hold: 'cargar-izquierda', roughness: .62, sway: [.1, .12] },
  'baston-calle': { build: streetCaneGeometry, hold: 'cargar-derecha', material: streetCaneMaterial, reach: STREET_CANE_LENGTH },
  morral: { build: morralGeometry, bone: 'Spine2', anchor: 'Neck', roughness: .9, forward: .045, map: MORRAL_COLORS },
  bolso: { build: bolsoGeometry, bone: 'Spine2', anchor: 'Neck', roughness: .6 },
  costal: { build: costalGeometry, bone: 'Spine2', anchor: 'Neck', roughness: 1, forward: .045, sway: [.05, .035] },
  casco: { build: workHelmetGeometry, bone: 'Head', roughness: .49, mujer: [.96, .93, .94], get map() { return workHelmetMap(); } },
  bufanda: { build: scarfGeometry, bone: 'Spine2', anchor: 'Neck', roughness: .98, mujer: [.94, 1, .97], get map() { return scarfTexture(); } }
};

const streetGeometries = new Map();
const streetGeometry = (id, sexo) => {
  const forward = sexo === 'mujer' ? STREET_PROPS[id].forward ?? 0 : 0;
  const key = `${id}|${forward}`;
  if (!streetGeometries.has(key)) streetGeometries.set(key, STREET_PROPS[id].build(forward));
  return streetGeometries.get(key);
};

/** ¿Es un accesorio de los que lleva `look.real.accesorios`? */
export const isStreetProp = (id) => Object.hasOwn(STREET_PROPS, id ?? '');

/** Pone un objeto rígido en la mano con el marco horneado de una postura. */
export function placeInHold(object, bone, hold) {
  bone.add(object);
  object.position.copy(hold.position);
  object.quaternion.copy(hold.quaternion);
  object.scale.copy(hold.scale);
}

/**
 * Ata lo que lleva una persona, `[{ id, color }]`. Solo crea mallas: geometría y material son compartidos y
 * el hueso se lleva el objeto; lo único que se toca por cuadro es el giro de lo que se balancea (`swayStreetProps`).
 * `holds` son los marcos de las manos.
 */
export function attachStreetProps(root, bones, items = [], holds = null, sexo = 'hombre') {
  root.updateMatrixWorld(true);
  const added = [];
  for (const { id, color } of items) {
    if (!isStreetProp(id)) continue;
    const spec = STREET_PROPS[id];
    const hold = spec.hold ? holds?.[spec.hold] : null;
    const bone = hold ? bones.get(hold.boneName) : findBone(bones, spec.bone);
    if (!bone || (spec.hold && !hold)) continue;
    const pigment = color ?? '#3a3a3a';
    const material = spec.material ? spec.material(pigment) : sharedPropMaterial(pigment, spec.roughness, spec.map);
    const mesh = new THREE.Mesh(streetGeometry(id, sexo), material);
    mesh.name = `prop-${id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (hold) {
      placeInHold(mesh, bone, hold);
      if (spec.reach) mesh.scale.y *= (hold.height + BASTON_DE_MAS) / spec.reach; // el palo llega al piso, sea cual sea el cuerpo
    } else {
      // Como `space: 'body'`: ejes del personaje y origen en el hueso, en la pose de reposo.
      root.worldToLocal((spec.anchor ? findBone(bones, spec.anchor) ?? bone : bone).getWorldPosition(mesh.position));
      if (sexo === 'mujer' && spec.mujer) mesh.scale.set(...spec.mujer);
      root.add(mesh);
      bone.attach(mesh);
    }
    if (spec.sway) mesh.userData.sway = { rest: mesh.quaternion.clone(), side: spec.sway[0], front: spec.sway[1] };
    added.push(mesh);
  }
  return added;
}

/** Bastón suelto, para cuando se le cae a alguien: el mismo que tiene en la mano, sin gastar otro material. */
export function createCane(color) {
  const mesh = new THREE.Mesh(streetGeometry('baston-calle'), streetCaneMaterial(color ?? '#3a3a3a'));
  mesh.name = 'prop-baston-suelto';
  mesh.receiveShadow = true;
  return mesh;
}

const swayAngles = new THREE.Euler(), swayTurn = new THREE.Quaternion();
/**
 * La bolsa y el costal se mecen con el paso, sobre su giro de reposo: un vaivén de lado por zancada y uno de frente
 * por pisada. `amount` es cuánto está andando, de 0 a 1: quieto vuelve solo al reposo. Sin matrices de mundo ni objetos nuevos.
 */
export function swayStreetProps(props, phase, amount) {
  const turn = phase * Math.PI * 2;
  for (const mesh of props) {
    const { rest, side, front } = mesh.userData.sway;
    swayTurn.setFromEuler(swayAngles.set(Math.sin(turn * 2 + .6) * front * amount, 0, Math.sin(turn + .4) * side * amount));
    mesh.quaternion.multiplyQuaternions(rest, swayTurn);
  }
}

// ---------- paraguas y celular ----------
// Los lleva `Npc`, que los muestra con la postura. Una malla por persona, con todo lo demás compartido.

let umbrellaShape = null, closedStickShape = null;

// Paraguas en el piso, con la escala del personaje: se recuesta en el borde del domo y en la punta del mango.
export const UMBRELLA_REST = { tilt: .98, lift: .166 };

/** Paraguas de una persona: una malla con geometría y material compartidos. */
export function createUmbrella(variant = 0) {
  umbrellaShape ??= umbrellaGeometry();
  const mesh = new THREE.Mesh(umbrellaShape, umbrellaMaterial(UMBRELLA_COLORS[variant % UMBRELLA_COLORS.length] ?? UMBRELLA_COLORS[0]));
  mesh.name = 'prop-paraguas';
  return mesh;
}

/** El palo y el mango del paraguas cerrado, del color de la tela. */
export function createClosedStick(variant = 0) {
  closedStickShape ??= closedStickGeometry();
  const mesh = new THREE.Mesh(closedStickShape, sharedPropMaterial(UMBRELLA_COLORS[variant % UMBRELLA_COLORS.length] ?? UMBRELLA_COLORS[0], .62));
  mesh.name = 'prop-paraguas-cerrado';
  mesh.rotation.z = Math.PI;
  mesh.position.y = -.08;
  return mesh;
}

let phoneShape = null;

/** Celular sin marca alguna: una tablita oscura en la palma. Solo lo lleva el modelo completo. */
export function createPhone() {
  phoneShape ??= fused([block(.066, .135, .009)]);
  const mesh = new THREE.Mesh(phoneShape, sharedPropMaterial('#15171b', .35));
  mesh.name = 'prop-celular';
  return mesh;
}

// ---------- armas en mano ----------
// El centro de agarre de los tres objetos va en el origen y su extremo visible sale por +Y.
const pistolParts = {};

/** Pistola corta empuñada: el cañón sale hacia los dedos (+Y) y la cacha baja por la palma */
function pistol() {
  const g = pistolParts;
  g.slide ??= new THREE.BoxGeometry(0.026, 0.17, 0.034).translate(0, 0.085, 0.045);
  g.butt ??= new THREE.BoxGeometry(0.024, 0.04, 0.1).rotateX(0.25).translate(0, 0.015, 0.0);
  g.guardRing ??= new THREE.TorusGeometry(0.018, 0.004, 4, 8, Math.PI).rotateY(Math.PI / 2).translate(0, 0.045, 0.02);
  const steel = new THREE.MeshStandardMaterial({ color: '#17181a', metalness: 0.7, roughness: 0.4 });
  const group = new THREE.Group();
  group.name = 'weapon-pistola';
  group.add(new THREE.Mesh(g.slide, steel), new THREE.Mesh(g.butt, steel), new THREE.Mesh(g.guardRing, steel));
  return group;
}

const WEAPON_BUILDERS = { cuchillo: knife, botella_picada: brokenBottle, arma: club, pistola: pistol };
const activeWeapons = new Map();

const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _wr = new THREE.Quaternion();

/**
 * Pone un arma en la mano derecha. Devuelve { object, dispose } o null si no existe el arma o el hueso.
 * La geometría y los mapas se comparten. El último portador libera los materiales.
 */
export function attachWeapon(root, bones, id) {
  const hand = findBone(bones, 'RightHand');
  if (!hand) return null;
  const weapon = createWeapon(id);
  if (!weapon) return null;
  const { object } = weapon;
  // Pasar de la raíz al hueso conserva el tamaño del objeto con los distintos esqueletos.
  root.updateMatrixWorld(true);
  root.worldToLocal(hand.getWorldPosition(_wp));
  root.getWorldQuaternion(_wr).invert();
  object.position.copy(_wp);
  object.quaternion.copy(_wr.multiply(hand.getWorldQuaternion(_wq)));
  root.add(object);
  hand.attach(object);
  if (id !== 'pistola') {
    const middle = findBone(bones, 'RightHandMiddle1'), index = findBone(bones, 'RightHandIndex1');
    const pinky = findBone(bones, 'RightHandPinky1');
    if (middle && index && pinky) {
      const fingers = middle.position.clone().normalize();
      const axis = index.position.clone().sub(pinky.position);
      const palmWidth = axis.length();
      axis.addScaledVector(fingers, -axis.dot(fingers)).normalize();
      const palm = new THREE.Vector3().crossVectors(axis, fingers).normalize();
      object.position.copy(middle.position).multiplyScalar(.76).addScaledVector(palm, palmWidth * .27);
      // El mango cruza la palma. Una leve inclinación sigue la línea de los nudillos.
      axis.addScaledVector(fingers, .15).normalize();
      const across = new THREE.Vector3().crossVectors(axis, palm).negate().normalize();
      object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, axis, palm.negate()));
    }
  }
  return weapon;
}

/** Cada mano tiene su propia transformación y comparte el modelo con los demás portadores. */
export function createWeapon(id) {
  if (!Object.hasOwn(WEAPON_BUILDERS, id)) return null;
  let active = activeWeapons.get(id);
  if (!active) {
    const model = WEAPON_BUILDERS[id](), materials = new Set();
    model.name = `weapon-${id}`;
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      materials.add(o.material);
    });
    active = { model, materials, users: 0 };
    activeWeapons.set(id, active);
  }
  active.users++;
  const object = active.model.clone();
  let released = false;
  return {
    object,
    dispose() {
      if (released) return;
      released = true;
      object.removeFromParent();
      if (--active.users === 0) {
        for (const material of active.materials) material.dispose();
        activeWeapons.delete(id);
      }
    }
  };
}
