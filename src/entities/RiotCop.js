// src/entities/RiotCop.js
// Antimotines de la protesta: la misma persona de la calle (versión liviana) de uniforme oscuro, con casco, escudo y bolillo.
// Se entrega como figura del PeoplePool: `{ character, group }`, con el grupo ya vestido.
import * as THREE from 'three';
import { createRealisticCharacter, loadCatalog, normalizeReal } from '../character/RealisticCharacter.js';
import { DEFAULT_LOOK } from '../character/look.js';

// Casco, visor, escudo y bolillo comparten geometría y material entre los 22, pero cada uno va colgado del hueso que lo lleva: si el tombo cae, cae con todo.
let kit = null;
function copKit() {
  if (kit) return kit;
  const dark = new THREE.MeshLambertMaterial({ color: 0x15181d, flatShading: true });
  const visor = new THREE.MeshLambertMaterial({ color: 0x4a6a78, transparent: true, opacity: .75 });
  const polycarbonate = new THREE.MeshLambertMaterial({ color: 0x8fb0bf, transparent: true, opacity: .62, side: THREE.DoubleSide });
  const helmet = new THREE.SphereGeometry(.15, 10, 8);
  helmet.scale(1, 1.05, 1.1);
  kit = {
    helmet: [helmet, dark], visor: [new THREE.BoxGeometry(.2, .09, .05), visor],
    shield: [new THREE.BoxGeometry(.62, 1.1, .05), polycarbonate], baton: [new THREE.CylinderGeometry(.025, .025, .6, 6), dark]
  };
  return kit;
}

// Cada pieza se acomoda en el espacio del grupo con el cuerpo en reposo y luego se cuelga del hueso sin mover su lugar en el mundo.
function hang(group, bone, [geometry, material], position, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.rotation.set(...rotation);
  group.add(mesh);
  group.updateMatrixWorld(true);
  bone.attach(mesh);
  return mesh;
}

export async function riotCopFigure() {
  const look = {
    ...DEFAULT_LOOK,
    piel: 1 + Math.floor(Math.random() * 4),
    desgaste: 0,
    uniforme: '#14161a',
    accesorios: [],
    real: normalizeReal(await loadCatalog(), { sexo: 'hombre', edad: 'adulto', pelo: 'calvo', barba: 'ninguna', ropa: 'buzo', calzado: 'botas', cabeza: 'sin-sombrero' })
  };
  const character = await createRealisticCharacter(look, { lod: true });
  const group = new THREE.Group();
  group.name = 'Antimotín';
  group.add(character.group);
  const bones = [];
  character.group.traverse(o => { if (o.isBone) bones.push(o); });
  const find = name => bones.find(o => o.name.endsWith(name));
  const head = find('Head'), left = find('LeftHand'), right = find('RightHand'), hips = find('Hips');
  if (!head || !left || !right || !hips) throw new Error('El antimotín necesita cabeza y manos en su esqueleto');
  for (let i = 0; i < 2; i++) character.update(.6, { speed: 0, stance: null, stanceWeight: 1 });
  character.snapPose?.();
  group.updateMatrixWorld(true);
  const at = bone => group.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  const { helmet, visor, shield, baton } = copKit();
  const h = at(head), l = at(left), r = at(right);
  hang(group, head, helmet, new THREE.Vector3(h.x, h.y + .1, h.z + .02));
  hang(group, head, visor, new THREE.Vector3(h.x, h.y + .08, h.z + .15));
  const plate = hang(group, left, shield, new THREE.Vector3(l.x - .02, l.y + .12, l.z + .18));
  hang(group, right, baton, new THREE.Vector3(r.x, r.y + .05, r.z + .15), [.9, 0, 0]);
  // El brazo se balancea al caminar pero el escudo no: queda derecho respecto al cuerpo, agarrado de la mano.
  const hold = hips.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(plate.getWorldQuaternion(new THREE.Quaternion()));
  const handQ = new THREE.Quaternion(), hipsQ = new THREE.Quaternion();
  const update = character.update.bind(character);
  character.update = (...args) => {
    const result = update(...args);
    group.updateMatrixWorld(true);
    plate.quaternion.copy(left.getWorldQuaternion(handQ).invert()).multiply(hips.getWorldQuaternion(hipsQ)).multiply(hold);
    return result;
  };
  return { character, group };
}
