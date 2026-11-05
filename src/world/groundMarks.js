// src/world/groundMarks.js
// Las marcas del piso hechas a mano: un círculo de tiza o marcador en vez de un aro perfecto que gira.
// Solo geometría (sin lienzo ni textura), así que se construye igual en el navegador y en las pruebas.
import * as THREE from 'three';

/** Azar con semilla: el mismo sitio dibuja siempre el mismo trazo. */
function seeded(seed) {
  let s = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Un círculo trazado a mano sobre el plano XY, del mismo tamaño que `RingGeometry(inner, outer)`: una vuelta que
 * pasa un poco de largo, con el radio que se mece y el grueso que cambia como la presión de la mano, y que
 * se adelgaza al empezar y al terminar. Se acuesta igual que un aro: `rotation.x = −π/2`.
 * @param {number} inner radio interior
 * @param {number} outer radio exterior
 * @param {number} [seed] cambia el trazo; dos marcas juntas no salen iguales
 */
export function handDrawnRing(inner, outer, seed = 1) {
  const rand = seeded(seed);
  const mid = (inner + outer) / 2;
  const width = outer - inner;
  const segments = Math.max(48, Math.round(mid * 40));
  const start = rand() * Math.PI * 2;
  const sweep = Math.PI * 2 * (1.06 + rand() * .08); // pasa de largo, como quien cierra el círculo de afán
  // Dos o tres ondas lentas de radio y de grueso, con fases propias.
  const waves = [1, 2, 3].map(k => ({ k, a: (rand() - .5) * .07 / k, p: rand() * Math.PI * 2 }));
  const press = [2, 5].map(k => ({ k, a: .12 + rand() * .1, p: rand() * Math.PI * 2 }));
  const drift = (rand() - .5) * .05; // la vuelta no cierra justo: sube o baja un poco al final

  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = start + sweep * t;
    let r = mid * (1 + drift * t);
    for (const w of waves) r += mid * w.a * Math.sin(angle * w.k + w.p);
    let half = width / 2;
    for (const p of press) half *= 1 + p.a * Math.sin(angle * p.k + p.p);
    half *= Math.min(1, .25 + t * 9, .25 + (1 - t) * 9); // punta fina al apoyar y al levantar
    const c = Math.cos(angle), s = Math.sin(angle);
    positions.push(c * (r - half), s * (r - half), 0, c * (r + half), s * (r + half), 0);
    uvs.push(t, 0, t, 1);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length / 3).fill([0, 0, 1]).flat(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Semilla estable por posición, para que cada marca del mapa tenga su trazo. */
export const markSeed = (x = 0, z = 0) => Math.abs(Math.round(x * 13.7 + z * 7.3)) + 1;
