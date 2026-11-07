// src/systems/PeoplePool.js
// Un grupo fijo de personas reales de la calle (el mismo generador de los peatones, en su versión liviana) que se
// precargan durante la carga y se prestan a quien las necesite cerca de la cámara: los pasajeros de las busetas y la
// gente del andén. Se posan una vez y quedan quietas (sin mezclador), no echan sombra y vuelven al grupo al alejarse.
import { createRealisticCharacter } from '../character/RealisticCharacter.js';
import { randomStreetLook } from '../entities/Npc.js';

export const POOL_SIZE = 120;
const SETTLE_STEPS = 2, SETTLE_DT = .6;

async function streetFigure() {
  const character = await createRealisticCharacter(await randomStreetLook(), { lod: true });
  return { character, group: character.group };
}

export class PeoplePool {
  /** `factory` entrega `{ character, group }`; las pruebas pasan una de mentira. */
  constructor(scene, { size = POOL_SIZE, factory = streetFigure } = {}) {
    this.scene = scene;
    this.size = size;
    this.factory = factory;
    this.figures = [];
    this.free = [];
  }

  /** Una tarea de precarga por persona, para la pantalla de carga. */
  tasks() {
    return Array.from({ length: this.size }, () => async () => {
      const figure = await this.factory();
      figure.pose = null;
      figure.live = false;
      figure.group.visible = false;
      figure.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.scene.add(figure.group);
      this.figures.push(figure);
      this.free.push(figure);
    });
  }

  get groups() { return this.figures.map(f => f.group); }
  get available() { return this.free.length; }
  get inUse() { return this.figures.length - this.free.length; }

  acquire() {
    const figure = this.free.pop();
    if (!figure) return null;
    figure.group.visible = true;
    return figure;
  }

  release(figure) {
    if (!figure || this.free.includes(figure)) return;
    figure.group.visible = false;
    // Quien iba colgado de un bus vuelve a la escena: el siguiente que lo use lo pone en coordenadas del mundo.
    if (figure.group.parent !== this.scene) this.scene.add(figure.group);
    figure.pose = null;
    figure.live = false;
    this.free.push(figure);
  }

  /**
   * Posa a la persona: la pone en `stance` (o `action`, como el saludo del cobrador) y la deja asentada sin
   * transición. Las quietas no vuelven a actualizarse; las `live` sí, cada cuadro, con `animate`.
   */
  pose(figure, { stance = null, action = null, live = false }) {
    const key = `${stance}|${action}`;
    if (figure.pose === key) return;
    figure.pose = key;
    figure.live = live;
    const { character } = figure;
    for (let i = 0; i < SETTLE_STEPS; i++) character.update(SETTLE_DT, { speed: 0, stance, action, stanceWeight: 1 });
    character.snapPose?.();
  }

  animate(figure, dt, { stance = null, action = null } = {}) {
    if (figure.live) figure.character.update(dt, { speed: 0, stance, action, stanceWeight: 1 });
  }

  dispose() {
    for (const f of this.figures) { f.character.dispose?.(); f.group.removeFromParent(); }
    this.figures.length = 0; this.free.length = 0;
  }
}
