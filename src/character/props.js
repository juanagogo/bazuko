// src/character/props.js
// Accesorios rígidos del personaje realista (bastón, mochila). No son ropa de MakeHuman:
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
function findBone(bones, name) {
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

const BUILDERS = { baston: cane, mochila: backpack };

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
