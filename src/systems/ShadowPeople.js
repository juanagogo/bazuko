// src/systems/ShadowPeople.js
import * as THREE from 'three';
import { createRealisticCharacter } from '../character/RealisticCharacter.js';

export const SOMBRAS = Object.freeze({
  max: 7,               // tope de hombres sombra vivos a la vez, y de figuras en reserva
  opacidad: 0.72,
  color: 0x000000,
  // Peso de cada tamaño de ola: casi siempre 1 a 3, a veces 4 o 5, rara vez 6 o 7.
  pesos: [30, 28, 20, 10, 7, 3, 2],
  espera: [6, 14],      // s sin sombras ambientales entre una ola y la siguiente
  aparicion: 0.6,       // s promedio entre una sombra y la siguiente de la misma ola
  // Todas salen del mismo cuerpo liso: solo cambian un poco la estatura y la contextura.
  alto: [0.95, 1.07],
  ancho: [0.94, 1.06]
});

/** Apariencia de un hombre sombra: el cuerpo base de hombre adulto sin prendas, pelo ni accesorios, de estatura y contextura apenas distintas. */
export function miradaSombra(random = Math.random) {
  const entre = ([a, b]) => a + random() * (b - a);
  return { soloCuerpo: true, real: { sexo: 'hombre', edad: 'adulto', talla: { alto: entre(SOMBRAS.alto), ancho: entre(SOMBRAS.ancho) } } };
}

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

/** El cuerpo base liso del generador de gente de la calle, pintado de negro y a medio transparentar. */
export async function crearFiguraSombra() {
  const character = await createRealisticCharacter(miradaSombra(), { lod: false });
  const material = new THREE.MeshBasicMaterial({
    color: SOMBRAS.color, transparent: true, opacity: SOMBRAS.opacidad, depthWrite: false
  });
  const figura = { character, group: character.group, material };
  pintarFigura(figura);
  return figura;
}

/** Todas las mallas de la figura con el material negro compartido; el personaje reconstruye y cambia mallas, así que se repite. */
export function pintarFigura(figura) {
  figura.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material !== figura.material) o.material = figura.material;
    o.castShadow = false;
    o.receiveShadow = false;
  });
}

export function liberarFigura(figura) {
  figura.character.dispose?.();
  figura.material.dispose();
}
