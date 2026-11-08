// src/entities/RiotCop.js
// Antimotines de la protesta: la misma persona de la calle (versión liviana) de uniforme oscuro, con casco, escudo y bolillo.
// Se entrega como figura del PeoplePool: `{ character, group }`, con el grupo ya vestido.
import * as THREE from 'three';
import { createRealisticCharacter, loadCatalog, normalizeReal } from '../character/RealisticCharacter.js';
import { DEFAULT_LOOK } from '../character/look.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Casco y bolillo en una malla oscura y visor y escudo en otra translúcida, iguales para los 22: la gente de la protesta cuesta lo que cuestan sus dibujos.
let kit = null;
function placed(geometry, [x, y, z], [rx = 0, ry = 0, rz = 0] = [], scale = [1, 1, 1], color = 0xffffff) {
  geometry.scale(...scale);
  geometry.rotateX(rx); geometry.rotateY(ry); geometry.rotateZ(rz);
  geometry.translate(x, y, z);
  const c = new THREE.Color(color), n = geometry.attributes.position.count, rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return geometry.toNonIndexed();
}
function copKit() {
  if (kit) return kit;
  const dark = new THREE.Mesh(
    mergeGeometries([placed(new THREE.SphereGeometry(.15, 10, 8), [0, 1.72, .02], [], [1, 1.05, 1.1]), placed(new THREE.CylinderGeometry(.025, .025, .6, 6), [-.3, 1.0, .3], [.9])]),
    new THREE.MeshLambertMaterial({ color: 0x15181d, flatShading: true })
  );
  const glass = new THREE.Mesh(
    mergeGeometries([placed(new THREE.BoxGeometry(.2, .09, .05), [0, 1.7, .15], [], [1, 1, 1], 0x4a6a78), placed(new THREE.BoxGeometry(.62, 1.1, .05), [.2, 1.02, .42], [], [1, 1, 1], 0x8fb0bf)]),
    new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .65 })
  );
  kit = { dark: dark.geometry, glass: glass.geometry, darkMaterial: dark.material, glassMaterial: glass.material };
  return kit;
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
  const { dark, glass, darkMaterial, glassMaterial } = copKit();
  group.add(new THREE.Mesh(dark, darkMaterial), new THREE.Mesh(glass, glassMaterial));
  return { character, group };
}
