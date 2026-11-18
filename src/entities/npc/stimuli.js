// src/entities/npc/stimuli.js
// Lo que pasa en la calle y se puede ver u oír: un robo, una pelea, un golpe, una popó, un grito, una sirena, un pito,
// un choque, una persecución, un arresto. Cada estímulo es `{ tipo, posición, radio, intensidad, origen }`; lo
// dejan los sistemas que ya existen (eventos del juego y cambios que se notan en los NPC) y cada peatón lo lee en su
// turno de mirar. Una pelea, un arresto o un choque arman además una escena: el sitio al que se arriman los curiosos.
//
// Todo vive en arreglos de tamaño fijo: emitir no crea objetos.

import { hypot } from './hypot.js';

/**
 * Cómo se percibe cada tipo. `sound`: m a los que se oye (0 = solo se ve). `sight`: si se puede ver. `weight`:
 * cuánto asusta (0..1). `life`: s que dura en el aire. `scene`: s que dura la escena para los curiosos (0 = no arma).
 * `bad`: lo hizo alguien contra alguien (lo que la gente recuerda del que lo hizo).
 */
export const STIMULI = {
  robo:        { sound: 0,  sight: true,  weight: .8,  life: 3,   scene: 0,  bad: true },
  pelea:       { sound: 14, sight: true,  weight: .9,  life: 4,   scene: 8,  bad: true },
  golpe:       { sound: 12, sight: true,  weight: .85, life: 3,   scene: 6,  bad: true },
  popo:        { sound: 12, sight: true,  weight: .7,  life: 3,   scene: 0,  bad: true },
  grito:       { sound: 16, sight: false, weight: .45, life: 2,   scene: 0,  bad: false },
  sirena:      { sound: 35, sight: false, weight: .2,  life: 1.5, scene: 0,  bad: false },
  pito:        { sound: 22, sight: false, weight: .2,  life: 1.5, scene: 0,  bad: false },
  choque:      { sound: 25, sight: true,  weight: .6,  life: 3,   scene: 6,  bad: false },
  persecucion: { sound: 0,  sight: true,  weight: .55, life: 2,   scene: 0,  bad: false },
  arresto:     { sound: 10, sight: true,  weight: .5,  life: 3,   scene: 12, bad: false }
};

const CAPACITY = 64;
const SCENES = 4;
const SCENE_MERGE = 8; // m: dos golpes de la misma pelea son la misma escena
export const OUTER = 8; // puestos del anillo de afuera de una escena (el tope del corrillo)

/** Canal de estímulos de un distrito: anillo de los últimos 64, y hasta 4 escenas a la vez. */
export class StimulusBus {
  constructor() {
    this.count = 0; // estímulos emitidos desde el principio: el número del siguiente
    this.kind = new Array(CAPACITY).fill(null);
    this.x = new Float32Array(CAPACITY);
    this.z = new Float32Array(CAPACITY);
    this.radius = new Float32Array(CAPACITY);
    this.intensity = new Float32Array(CAPACITY);
    this.born = new Float64Array(CAPACITY);
    this.origin = new Array(CAPACITY).fill(null);
    // Escenas: sitios donde algo sigue pasando un rato (una pelea, un arresto).
    // `slots` y `slots2`: los puestos tomados de cada fila del corrillo (awareness.js); `outMask`, `outX` y `outZ`: los
    // de quienes miran desde el anillo de afuera, cada uno donde quedó; `born`: cuándo empezó; `hits`: cuántos
    // estímulos lleva (un golpe suelto no es todavía una pelea).
    this.scenes = Array.from({ length: SCENES }, () => ({ kind: null, x: 0, z: 0, until: -Infinity, origin: null, slots: 0, slots2: 0,
      outMask: 0, outX: new Float32Array(OUTER), outZ: new Float32Array(OUTER), watchers: 0, id: 0, born: 0, hits: 0 }));
    this._sceneIds = 0;
  }

  /**
   * Deja un estímulo. `radio`: hasta dónde llega (m; 0 = el de su tipo). `intensidad`: 0..1. `origen`: quién lo
   * causó (el agente del jugador, un NPC, un carro) o null. `time`: el reloj de las mentes.
   */
  emit(tipo, x, z, radio, intensidad, origen, time) {
    const spec = STIMULI[tipo];
    if (!spec) return -1;
    const id = this.count++, i = id % CAPACITY;
    this.kind[i] = tipo;
    this.x[i] = x; this.z[i] = z;
    this.radius[i] = radio || Math.max(spec.sound, 16);
    this.intensity[i] = intensidad;
    this.born[i] = time;
    this.origin[i] = origen ?? null;
    if (spec.scene) this._scene(tipo, x, z, time + spec.scene, origen, time);
    return id;
  }

  /** ¿Sigue vigente el estímulo número `id` a la hora `time`? (No se pisó en el anillo ni se apagó.) */
  alive(id, time) {
    if (id < this.count - CAPACITY || id >= this.count) return false;
    const i = id % CAPACITY;
    return time - this.born[i] <= STIMULI[this.kind[i]].life;
  }

  /** El número más viejo que todavía puede estar en el anillo. */
  get oldest() { return Math.max(0, this.count - CAPACITY); }

  slot(id) { return id % CAPACITY; }

  _scene(kind, x, z, until, origin, time) {
    // La misma escena si sigue viva y es cerca: se alarga y se corre con quien pelea.
    for (const scene of this.scenes) {
      if (!scene.kind || scene.until < time || hypot(scene.x - x, scene.z - z) > SCENE_MERGE) continue;
      scene.x = x; scene.z = z; scene.until = Math.max(scene.until, until); scene.hits++;
      if (origin) scene.origin = origin;
      return scene;
    }
    // Una nueva, en el puesto de la que se acaba primero (o ya se acabó).
    let scene = this.scenes[0];
    for (const other of this.scenes) if (other.until < scene.until) scene = other;
    scene.kind = kind; scene.x = x; scene.z = z; scene.until = until; scene.origin = origin ?? null;
    scene.slots = 0; scene.slots2 = 0; scene.outMask = 0; scene.watchers = 0; scene.id = ++this._sceneIds; scene.born = time; scene.hits = 1;
    return scene;
  }

  /** La escena vigente más cercana a (x, z) dentro de `reach` m, o null. */
  sceneNear(x, z, reach, time) {
    let best = null, bestD = reach;
    for (const scene of this.scenes) {
      if (!scene.kind || scene.until < time) continue;
      const d = hypot(scene.x - x, scene.z - z);
      if (d < bestD) { bestD = d; best = scene; }
    }
    return best;
  }

  clear() {
    this.count = 0;
    this.kind.fill(null);
    this.origin.fill(null);
    for (const scene of this.scenes) { scene.kind = null; scene.until = -Infinity; scene.origin = null; scene.slots = 0; scene.slots2 = 0; scene.outMask = 0; scene.watchers = 0; scene.hits = 0; }
  }
}
