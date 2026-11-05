// src/character/props.js
// Accesorios rígidos del personaje realista (bastón, mochila, pasamontañas, gorra), lo que carga la gente
// de la calle (maletín, bolsa de mercado, costal, casco…) y armas en mano (cuchillo, botella picada,
// pistola). No son ropa de MakeHuman: se arman con geometría simple y se atan a un hueso del esqueleto
// Mixamo, así siguen la animación.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  // costal blando: esfera aplastada contra la espalda, más ancha abajo
  const bag = new THREE.SphereGeometry(1, 14, 10);
  const pos = bag.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setXYZ(i, pos.getX(i) * 0.15 * (1.05 - y * 0.15), y * 0.2, pos.getZ(i) * 0.08);
  }
  bag.computeVertexNormals();
  shared = {
    shaft: new THREE.CylinderGeometry(0.012, 0.015, SHAFT, 8),
    handle,
    bag,
    knot: new THREE.SphereGeometry(0.045, 8, 6),
    strap: new THREE.TorusGeometry(0.1, 0.012, 4, 10, Math.PI * 1.2),
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

function backpack(wear) {
  const g = geometries();
  const cloth = new THREE.MeshStandardMaterial({ color: tone('#3d4a3a', wear), roughness: 1 });
  const strapMat = new THREE.MeshStandardMaterial({ color: tone('#222018', wear), roughness: 1 });
  const group = new THREE.Group();
  group.name = 'prop-mochila';
  const bag = new THREE.Mesh(g.bag, cloth);
  const knot = new THREE.Mesh(g.knot, cloth);
  knot.position.set(0, 0.2, 0);
  group.add(bag, knot);
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(g.strap, strapMat);
    strap.rotation.y = Math.PI / 2;
    strap.position.set(side * 0.1, 0.1, 0.1);
    group.add(strap);
  }
  // en el espacio del personaje (mira a +Z): detrás de la espalda, a la altura del pecho
  group.position.set(0, -0.08, -0.2);
  return { bone: 'Spine2', object: group, space: 'body' };
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

const BUILDERS = { baston: cane, mochila: backpack, pasamontanas: balaclava, gorra: cap };
/** Accesorios baratos que también lleva el modelo lejano (se notan a distancia) */
export const FAR_ACCESSORIES = new Set(['pasamontanas', 'gorra', 'maletin', 'bolsa', 'bolso', 'morral', 'costal', 'casco', 'baston-calle']);

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
// Sin vertexColors ni dos caras: así usan el mismo programa que cualquier objeto liso de la ciudad.

const sharedMaterials = new Map();

/** Material liso compartido entre todos los que usen ese color y esa aspereza. */
export function sharedPropMaterial(color, roughness = .85) {
  const key = `${color}|${roughness}`;
  let material = sharedMaterials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness });
    material.name = 'prop-compartido';
    material.userData.shared = true;
    sharedMaterials.set(key, material);
  }
  return material;
}

/** Junta piezas en una sola geometría; las primitivas pierden las UV, que un color liso no usa. */
function fused(parts) {
  for (const part of parts) if (part.attributes.uv) part.deleteAttribute('uv');
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

/** Bastón de una pieza: a diferencia del `baston` del creador, no hace trabajo por cuadro. Su largo se ajusta a la mano. */
const BASTON_LARGO = .8;
// El palo se mide con la mano en reposo, y al andar la mano sube. Se pasa de largo hasta casi rozar el piso en lo más bajo.
const BASTON_DE_MAS = .033;
function bastonCalleGeometry() {
  const crook = new THREE.TorusGeometry(CROOK * .85, .011, 4, 7, Math.PI);
  crook.rotateY(-Math.PI / 2);
  crook.translate(0, -.075, CROOK * .85);
  return fused([crook, new THREE.CylinderGeometry(.011, .014, BASTON_LARGO - .075, 5).translate(0, -(BASTON_LARGO + .075) / 2, 0)]);
}

// A la espalda o de lado: cuelgan de Spine2 en ejes del personaje, con el origen en el cuello, que es lo que menos
// cambia de un cuerpo a otro: desde ahí el hombro queda a la misma altura, con 1 o 2 cm de diferencia, en los seis.

// `forward`: cuánto se acerca a una espalda que, medida desde el cuello, queda más adelante (la de los cuerpos de mujer).

function morralGeometry(forward = 0) {
  const pack = soft(new THREE.SphereGeometry(1, 10, 6), (v) => {
    const flat = Math.sign(v.z) * Math.abs(v.z) ** .75;
    v.set(Math.sign(v.x) * Math.abs(v.x) ** .7 * .15, -.23 + Math.sign(v.y) * Math.abs(v.y) ** .7 * .19, -.19 + forward + flat * .08);
  });
  const strap = (x) => cord([[x * .95, -.1, -.12 + forward], [x, -.03, -.09 + forward * .6], [x * 1.04, .012, -.02], [x * 1.1, -.03, .06], [x * 1.2, -.13, .118], [x * 1.55, -.25, .09]], .012, 8);
  return fused([pack, strap(.095), strap(-.095)]);
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

// En la cabeza: atados a Head. La frente va hasta +,13 en z y la coronilla llega a +,21, y son unos 2 cm menos en las mujeres.

/** Casco de obra: copa ceñida, ala corta con visera y un lomo de refuerzo que sigue la copa. */
function cascoGeometry() {
  // Medido con el pelo corto y el rapado de los tres cuerpos de hombre: la copa los tapa a todos, también atrás.
  const y = .106, z = .018;
  const crown = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  crown.scale(.118, .128, .142).translate(0, y, z);
  const brim = new THREE.CylinderGeometry(1, 1, .008, 20);
  const pos = brim.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * .124, y + pos.getY(i), z + pos.getZ(i) * (pos.getZ(i) > 0 ? .172 : .146));
  brim.computeVertexNormals();
  const ridge = new THREE.SphereGeometry(1, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  ridge.scale(.016, .136, .15).translate(0, y, z);
  return fused([crown, brim, ridge]);
}

// `hold`: postura cuyo marco de la mano usa. `bone`: hueso al que se ata, en ejes del personaje; `anchor`: de dónde se
// mide si no es ese hueso. `mujer`: escala para las cabezas de mujer, algo más pequeñas. `forward`: lo que se acerca a la
// espalda de un cuerpo de mujer, con su propia geometría de módulo. `sway`: balanceo con el paso, en radianes [de lado, de frente].
const STREET_PROPS = {
  maletin: { build: maletinGeometry, hold: 'cargar-izquierda', roughness: .55 },
  bolsa: { build: bolsaGeometry, hold: 'cargar-izquierda', roughness: .62, sway: [.1, .12] },
  'baston-calle': { build: bastonCalleGeometry, hold: 'cargar-derecha', roughness: .7, reach: BASTON_LARGO },
  morral: { build: morralGeometry, bone: 'Spine2', anchor: 'Neck', roughness: .9, forward: .045 },
  bolso: { build: bolsoGeometry, bone: 'Spine2', anchor: 'Neck', roughness: .6 },
  costal: { build: costalGeometry, bone: 'Spine2', anchor: 'Neck', roughness: 1, forward: .045, sway: [.05, .035] },
  casco: { build: cascoGeometry, bone: 'Head', roughness: .4, mujer: [.96, .93, .94] }
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
    const mesh = new THREE.Mesh(streetGeometry(id, sexo), sharedPropMaterial(color ?? '#3a3a3a', spec.roughness));
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
  const mesh = new THREE.Mesh(streetGeometry('baston-calle'), sharedPropMaterial(color ?? '#3a3a3a', STREET_PROPS['baston-calle'].roughness));
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

// Colores apagados, como casi todo lo que se ve bajo la lluvia de Bogotá.
const UMBRELLA_COLORS = ['#181a20', '#27364d', '#5a2430', '#2f3f36', '#4a4a50'];

/** Domo de varillas, por fuera y por dentro (sin DoubleSide, que pide otro programa), con su palo y su mango. */
function umbrellaGeometry() {
  const ribs = 8, radius = .62, rise = .21;
  const ring = (fraction, drop) => {
    const out = [];
    for (let i = 0; i < ribs * 2; i++) {
      const angle = i / (ribs * 2) * Math.PI * 2, mid = i % 2 ? 1 - .09 * fraction : 1;
      out.push([Math.sin(angle) * radius * fraction * mid, rise * (1 - fraction ** 1.7) - (i % 2 ? drop : 0), Math.cos(angle) * radius * fraction * mid]);
    }
    return out;
  };
  const rings = [ring(.42, 0), ring(.76, .004), ring(1, .012)];
  const sides = [];
  for (const inside of [false, true]) {
    const tri = [];
    const face = (a, b, c) => { if (inside) tri.push(...a, ...b, ...c); else tri.push(...a, ...c, ...b); };
    const n = ribs * 2;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      face([0, rise, 0], rings[0][i], rings[0][next]);
      for (let r = 0; r < rings.length - 1; r++) {
        face(rings[r][i], rings[r + 1][i], rings[r + 1][next]);
        face(rings[r][i], rings[r + 1][next], rings[r][next]);
      }
    }
    const side = new THREE.BufferGeometry();
    side.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const welded = mergeVertices(side, 1e-4);
    side.dispose();
    welded.computeVertexNormals();
    sides.push(welded);
  }
  const canopy = mergeGeometries(sides);
  for (const side of sides) side.dispose();
  canopy.translate(0, .5, 0);
  const shaft = new THREE.CylinderGeometry(.008, .008, .86, 5).translate(0, .3, 0);
  shaft.deleteAttribute('uv');
  const handle = new THREE.CylinderGeometry(.016, .016, .1, 5).translate(0, -.09, 0);
  handle.deleteAttribute('uv');
  const out = mergeGeometries([canopy, shaft, handle]);
  canopy.dispose(); shaft.dispose(); handle.dispose();
  // El palo sale del puño y se recuesta un poco hacia atrás, para que el domo quede sobre la cabeza.
  out.rotateX(-.17).rotateZ(-.09).translate(.06, 0, .055);
  return out;
}

let umbrellaShape = null;

// Paraguas en el piso, con la escala del personaje: se recuesta en el borde del domo y en la punta del mango.
export const UMBRELLA_REST = { tilt: .98, lift: .166 };

/** Paraguas de una persona: una malla con geometría y material compartidos. */
export function createUmbrella(variant = 0) {
  umbrellaShape ??= umbrellaGeometry();
  const mesh = new THREE.Mesh(umbrellaShape, sharedPropMaterial(UMBRELLA_COLORS[variant % UMBRELLA_COLORS.length] ?? UMBRELLA_COLORS[0], .62));
  mesh.name = 'prop-paraguas';
  return mesh;
}

/** El palo y el mango del paraguas cerrado: el bastón de la calle puesto de pie, con el color de la tela. */
export function createClosedStick(variant = 0) {
  const mesh = new THREE.Mesh(streetGeometry('baston-calle'), sharedPropMaterial(UMBRELLA_COLORS[variant % UMBRELLA_COLORS.length] ?? UMBRELLA_COLORS[0], .62));
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
// El origen del objeto es la muñeca y +Y va hacia donde apuntan los dedos; el mango queda dentro del puño.

let weaponShared = null;
function weaponGeometries() {
  if (weaponShared) return weaponShared;
  const blade = new THREE.BoxGeometry(0.022, 0.17, 0.005);
  blade.translate(0, 0.075 + 0.085, 0); // sale del mango
  // punta: se afina con un triángulo apilado sobre la hoja
  const tip = new THREE.ConeGeometry(0.0125, 0.04, 3);
  tip.rotateY(Math.PI / 2);
  tip.scale(1, 1, 0.25);
  tip.translate(0, 0.245 + 0.02, 0);
  weaponShared = {
    grip: new THREE.CylinderGeometry(0.014, 0.016, 0.11, 8).translate(0, 0.02, 0),
    guard: new THREE.BoxGeometry(0.05, 0.012, 0.016).translate(0, 0.078, 0),
    blade, tip,
    neck: new THREE.CylinderGeometry(0.013, 0.017, 0.1, 8).translate(0, 0.01, 0),
    shoulder: new THREE.CylinderGeometry(0.033, 0.017, 0.05, 8).translate(0, 0.085, 0),
    body: new THREE.CylinderGeometry(0.033, 0.033, 0.1, 8).translate(0, 0.16, 0),
    shard: new THREE.ConeGeometry(0.011, 0.045, 4).translate(0, 0.0225, 0)
  };
  return weaponShared;
}

function knife() {
  const g = weaponGeometries();
  const steel = new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.85, roughness: 0.3 });
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.85 });
  const group = new THREE.Group();
  group.name = 'weapon-cuchillo';
  group.add(new THREE.Mesh(g.grip, wood), new THREE.Mesh(g.guard, steel), new THREE.Mesh(g.blade, steel), new THREE.Mesh(g.tip, steel));
  return group;
}

function brokenBottle() {
  const g = weaponGeometries();
  const glass = new THREE.MeshStandardMaterial({ color: '#2f6b3a', transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1 });
  const group = new THREE.Group();
  group.name = 'weapon-botella_picada';
  group.add(new THREE.Mesh(g.neck, glass), new THREE.Mesh(g.shoulder, glass), new THREE.Mesh(g.body, glass));
  // boca rota: picos de vidrio alrededor del borde
  const rim = 0.21, n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const shard = new THREE.Mesh(g.shard, glass);
    shard.position.set(Math.cos(a) * 0.026, rim, Math.sin(a) * 0.026);
    shard.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    shard.scale.y = i % 2 ? 1.4 : 0.8; // alternan para que el borde sea irregular
    group.add(shard);
  }
  return group;
}

/** Pistola corta empuñada: el cañón sale hacia los dedos (+Y) y la cacha baja por la palma */
function pistol() {
  const g = weaponGeometries();
  g.slide ??= new THREE.BoxGeometry(0.026, 0.17, 0.034).translate(0, 0.085, 0.045);
  g.butt ??= new THREE.BoxGeometry(0.024, 0.04, 0.1).rotateX(0.25).translate(0, 0.015, 0.0);
  g.guardRing ??= new THREE.TorusGeometry(0.018, 0.004, 4, 8, Math.PI).rotateY(Math.PI / 2).translate(0, 0.045, 0.02);
  const steel = new THREE.MeshStandardMaterial({ color: '#17181a', metalness: 0.7, roughness: 0.4 });
  const group = new THREE.Group();
  group.name = 'weapon-pistola';
  group.add(new THREE.Mesh(g.slide, steel), new THREE.Mesh(g.butt, steel), new THREE.Mesh(g.guardRing, steel));
  return group;
}

/** Arma casera: tabla con láminas de chatarra y puntillas, amarradas con cable de cobre */
function club() {
  const g = weaponGeometries();
  g.plank ??= new THREE.BoxGeometry(0.05, 0.7, 0.024).translate(0, 0.29, 0);
  g.wrap ??= new THREE.CylinderGeometry(0.031, 0.031, 0.15, 6).translate(0, 0.015, 0);
  g.plate ??= new THREE.BoxGeometry(0.07, 0.15, 0.006);
  g.nail ??= new THREE.CylinderGeometry(0.0035, 0.0035, 0.09, 4).rotateZ(Math.PI / 2);
  g.wire ??= new THREE.TorusGeometry(0.04, 0.003, 4, 10).rotateX(Math.PI / 2).scale(1, 1, 0.7);
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9 });
  const tape = new THREE.MeshStandardMaterial({ color: '#262626', roughness: 1 });
  const rust = new THREE.MeshStandardMaterial({ color: '#7a4526', metalness: 0.55, roughness: 0.75 });
  const steel = new THREE.MeshStandardMaterial({ color: '#8a8f94', metalness: 0.8, roughness: 0.4 });
  const copper = new THREE.MeshStandardMaterial({ color: '#b8733a', metalness: 0.8, roughness: 0.35 });
  const group = new THREE.Group();
  group.name = 'weapon-arma';
  group.add(new THREE.Mesh(g.plank, wood), new THREE.Mesh(g.wrap, tape));
  // láminas a cada lado de la punta, torcidas como quedaron al amarrarlas
  for (const [z, y, tilt] of [[0.015, 0.5, 0.12], [-0.015, 0.55, -0.18]]) {
    const plate = new THREE.Mesh(g.plate, rust);
    plate.position.set(0, y, z);
    plate.rotation.z = tilt;
    group.add(plate);
  }
  for (const [y, turn] of [[0.6, 0.1], [0.45, -0.15]]) {
    const nail = new THREE.Mesh(g.nail, steel);
    nail.position.y = y;
    nail.rotation.y = turn;
    group.add(nail);
  }
  for (const y of [0.42, 0.5, 0.62]) {
    const wire = new THREE.Mesh(g.wire, copper);
    wire.position.y = y;
    group.add(wire);
  }
  return group;
}

const WEAPON_BUILDERS = { cuchillo: knife, botella_picada: brokenBottle, arma: club, pistola: pistol };

const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _wr = new THREE.Quaternion();

/**
 * Pone un arma en la mano derecha. Devuelve { object, dispose } o null si no existe el arma o el hueso.
 * Las geometrías son compartidas; `dispose` solo libera los materiales de esta instancia.
 */
export function attachWeapon(root, bones, id) {
  const hand = findBone(bones, 'RightHand');
  if (!hand) return null;
  const weapon = createWeapon(id);
  if (!weapon) return null;
  const { object } = weapon;
  object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  // el objeto nace con los ejes de la mano, en el espacio de la raíz; attach() lo pasa al hueso sin mover nada
  root.updateMatrixWorld(true);
  root.worldToLocal(hand.getWorldPosition(_wp));
  root.getWorldQuaternion(_wr).invert();
  object.position.copy(_wp);
  object.quaternion.copy(_wr.multiply(hand.getWorldQuaternion(_wq)));
  root.add(object);
  hand.attach(object);
  return weapon;
}

/** La misma arma para ambos rigs; sus geometrías permanecen compartidas. */
export function createWeapon(id) {
  const build = WEAPON_BUILDERS[id];
  if (!build) return null;
  const object = build();
  object.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return {
    object,
    dispose() {
      const materials = new Set();
      object.traverse((o) => { if (o.isMesh) materials.add(o.material); });
      for (const m of materials) m.dispose();
      object.removeFromParent();
    }
  };
}
