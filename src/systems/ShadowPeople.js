// src/systems/ShadowPeople.js
import * as THREE from 'three';
import { createRealisticCharacter } from '../character/RealisticCharacter.js';
import { randomStreetLook } from '../entities/Npc.js';

export const SOMBRAS = Object.freeze({
  max: 7,               // tope de hombres sombra vivos a la vez, y de figuras en reserva
  opacidad: 0.55,
  color: 0x000000,
  // Peso de cada tamaño de ola: casi siempre 1 a 3, a veces 4 o 5, rara vez 6 o 7.
  pesos: [30, 28, 20, 10, 7, 3, 2],
  espera: [6, 14],      // s sin sombras ambientales entre una ola y la siguiente
  aparicion: 0.6        // s promedio entre una sombra y la siguiente de la misma ola
});

/** Cuántos hombres sombra trae una ola: independiente de la anterior, de 1 a SOMBRAS.max. */
export function cantidadOla(random = Math.random) {
  const total = SOMBRAS.pesos.reduce((a, b) => a + b, 0);
  let punto = random() * total;
  for (let i = 0; i < SOMBRAS.pesos.length; i++) {
    punto -= SOMBRAS.pesos[i];
    if (punto < 0) return i + 1;
  }
  return SOMBRAS.pesos.length;
}

/** Una persona de la calle del generador normal, pintada de negro y a medio transparentar. */
export async function crearFiguraSombra() {
  const character = await createRealisticCharacter(await randomStreetLook(), { lod: true });
  const material = new THREE.MeshBasicMaterial({
    color: SOMBRAS.color, transparent: true, opacity: SOMBRAS.opacidad, depthWrite: false
  });
  character.group.traverse((o) => {
    if (!o.isMesh) return;
    o.material = material;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return { character, group: character.group, material };
}

export function liberarFigura(figura) {
  figura.character.dispose?.();
  figura.material.dispose();
}
