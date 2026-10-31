// src/character/props.js
// Accesorios rígidos del personaje realista (bastón, mochila, pasamontañas, gorra) y armas en mano
// (cuchillo, botella picada, pistola). No son ropa de MakeHuman:
// se arman con geometría simple y se atan a un hueso del esqueleto Mixamo, así siguen la animación.
import * as THREE from 'three';

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
export const FAR_ACCESSORIES = new Set(['pasamontanas', 'gorra']);

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

const WEAPON_BUILDERS = { cuchillo: knife, botella_picada: brokenBottle, pistola: pistol };

const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _wr = new THREE.Quaternion();

/**
 * Pone un arma en la mano derecha. Devuelve { object, dispose } o null si no existe el arma o el hueso.
 * Las geometrías son compartidas; `dispose` solo libera los materiales de esta instancia.
 */
export function attachWeapon(root, bones, id) {
  const build = WEAPON_BUILDERS[id];
  const hand = findBone(bones, 'RightHand');
  if (!build || !hand) return null;
  const object = build();
  object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  // el objeto nace con los ejes de la mano, en el espacio de la raíz; attach() lo pasa al hueso sin mover nada
  root.updateMatrixWorld(true);
  root.worldToLocal(hand.getWorldPosition(_wp));
  root.getWorldQuaternion(_wr).invert();
  object.position.copy(_wp);
  object.quaternion.copy(_wr.multiply(hand.getWorldQuaternion(_wq)));
  root.add(object);
  hand.attach(object);
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
