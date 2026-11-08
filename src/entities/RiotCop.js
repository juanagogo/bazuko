// src/entities/RiotCop.js
// Antimotines de la protesta: la misma persona de la calle (versión liviana) de uniforme oscuro, con casco, escudo y bolillo.
// Se entrega como figura del PeoplePool: `{ character, group }`, con el grupo ya vestido.
import * as THREE from 'three';
import { createRealisticCharacter, loadCatalog, normalizeReal } from '../character/RealisticCharacter.js';
import { DEFAULT_LOOK } from '../character/look.js';

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
  const dark = new THREE.MeshLambertMaterial({ color: 0x15181d, flatShading: true });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 8), dark);
  helmet.scale.set(1, 1.05, 1.1);
  helmet.position.set(0, 1.72, .02);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.2, .09, .05), new THREE.MeshLambertMaterial({ color: 0x4a6a78, transparent: true, opacity: .75 }));
  visor.position.set(0, 1.7, .15);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(.62, 1.1, .05), new THREE.MeshLambertMaterial({ color: 0x8fb0bf, transparent: true, opacity: .62 }));
  shield.position.set(.2, 1.02, .42);
  const baton = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .6, 6), dark);
  baton.position.set(-.3, 1.0, .3);
  baton.rotation.x = .9;
  group.add(helmet, visor, shield, baton);
  return { character, group };
}
