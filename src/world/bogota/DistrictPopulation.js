import { rng } from './textures.js';

function personSeed(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Cada sitio conserva una identidad de partida, independiente del azar de la decoración. */
export class DistrictPopulation {
  constructor() {
    this.seed = Math.floor(Math.random() * 2 ** 32);
    this.records = new Map();
  }

  spawn(slot, create) {
    if (this.records.has(slot)) return this.records.get(slot);
    const id = `bogota:${this.seed.toString(36)}:${slot}:0`;
    const seed = personSeed(id);
    const npc = create(rng(seed));
    npc.stableId = id;
    npc.mindSeed = seed ^ 0x5bd1e995;
    this.records.set(slot, npc);
    return npc;
  }
}
