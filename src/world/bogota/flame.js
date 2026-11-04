// src/world/bogota/flame.js
// Llama de fogata: un sprite por fuego con textura y material compartidos, sin luces nuevas.
import * as THREE from 'three';
import { flameAtlas } from './textures.js';

const COLUMNS = 6, ROWS = 2, FRAMES = COLUMNS * ROWS, FPS = 14;
let material = null;

export function createFlame(width, height) {
  material ??= new THREE.SpriteMaterial({ map: flameAtlas(COLUMNS, ROWS), depthWrite: false, fog: false, toneMapped: false });
  const flame = new THREE.Sprite(material);
  flame.name = 'Llama';
  flame.center.set(.5, 0);
  flame.scale.set(width, height, 1);
  // No escribe profundidad: las sombras de contacto (1) dibujadas después la mancharían aunque estén detrás.
  flame.renderOrder = 2;
  // El fuego no es sólido, y un Sprite exige cámara al rayo que lo toca: sin esto revienta la consulta.
  flame.raycast = () => {};
  return flame;
}

/** Cambia la forma sin cambiar el brillo. Con el mismo t da igual cuántas fogatas la llamen. */
export function stepFlames(t) {
  const frame = Math.floor(t * FPS) % FRAMES;
  material?.map.offset.set((frame % COLUMNS) / COLUMNS, 1 - (Math.floor(frame / COLUMNS) + 1) / ROWS);
}

/**
 * Al sol un fuego apenas alumbra: de día no le pinta la cara de naranja a quien está al lado.
 * `step` da la parte de la luz que le toca ahora; al anochecer y al amanecer cambia sin saltos, en unos segundos.
 */
export function fireGlow() {
  const DAY = .12;
  let glow = null, target = 1;
  return {
    // El primer aviso llega antes de mostrarse: quien entra de día no lo ve bajando.
    setNight: isNight => { target = isNight ? 1 : DAY; glow ??= target; },
    step: dt => { glow ??= target; return glow += (target - glow) * Math.min(1, dt * .8); }
  };
}
