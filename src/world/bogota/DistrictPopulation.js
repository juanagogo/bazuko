import { Sphere, Vector3 } from 'three';
import { rng } from './textures.js';

// Cerca del jugador se conserva el cuerpo incluso si gira la cámara.
const KEEP_DISTANCE = 36;
const bodyBounds = new Sphere(new Vector3(), 2.2);
const isSeed = value => Number.isInteger(value) && value >= 0 && value < 2 ** 32;
const isPosition = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function personSeed(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function readRecord(data = {}) {
  const generation = Number.isSafeInteger(data.generation) && data.generation > 0 ? data.generation : 0;
  const body = data.dead && isPosition(data.body?.at)
    ? { at: data.body.at.slice(), facing: Number.isFinite(data.body.facing) ? data.body.facing : 0,
      plan: data.body.plan, from: data.body.from } : null;
  return { generation, dead: data.dead === true, body, health: data.health, looted: data.looted === true,
    reported: data.reported === true, aided: data.aided === true,
    npc: null, refill: null };
}

function outsideView(position, player, frustum, drawDistance) {
  const dx = position.x - player.x, dz = position.z - player.z, dy = position.y - (player.y ?? position.y);
  const distance = dx * dx + dy * dy + dz * dz;
  if (distance <= KEEP_DISTANCE ** 2) return false;
  if (!frustum || distance > (drawDistance + bodyBounds.radius) ** 2) return true;
  bodyBounds.center.copy(position);
  return !frustum.intersectsSphere(bodyBounds);
}

/** Cada sitio de origen conserva una identidad de partida. En un puesto, sólo el relevo abre una vida nueva. */
export class DistrictPopulation {
  constructor(data) {
    const restoring = isSeed(data?.seed);
    this.seed = restoring ? data.seed : Math.floor(Math.random() * 2 ** 32);
    this.records = new Map();
    this.byNpc = new WeakMap();
    this.bodies = new Set();
    this.nextCheck = 0;
    if (restoring && data.people && typeof data.people === 'object' && !Array.isArray(data.people)) {
      for (const [slot, record] of Object.entries(data.people)) {
        if (record && typeof record === 'object') this.records.set(slot, readRecord(record));
      }
    }
  }

  spawn(slot, create, refill = null) {
    const record = this.records.get(slot) ?? readRecord();
    this.records.set(slot, record);
    if (record.npc) return record.npc;
    if (record.dead && !record.body) {
      if (!refill) return null;
      record.generation++;
      record.dead = false;
      record.health = null;
      record.looted = false;
    }
    const id = `bogota:${this.seed.toString(36)}:${slot}:${record.generation}`;
    const seed = personSeed(id);
    const npc = create(rng(seed));
    npc.stableId = id;
    npc.mindSeed = seed ^ 0x5bd1e995;
    record.npc = npc;
    record.refill = refill;
    this.byNpc.set(npc, record);
    if (record.dead) {
      npc.position.fromArray(record.body.at);
      npc.root.position.copy(npc.position);
      npc.root.rotation.y = record.body.facing;
      npc.restoreDeath(record.body);
      npc.emergencyReported = record.reported;
      npc.emergencyAided = record.aided;
      this.bodies.add(record);
    } else {
      if (Number.isFinite(record.health) && record.health > 0) npc.health = Math.min(npc.maxHealth, record.health);
      if (record.looted) npc.looted = true;
    }
    return npc;
  }

  recordDeath(npc) {
    const record = this.byNpc.get(npc);
    if (!record || record.npc !== npc || record.dead || !npc.isDead) return false;
    record.dead = true;
    this.bodies.add(record);
    return true;
  }

  sweep(time, player, frustum, drawDistance, retire) {
    if (!this.bodies.size || !player || time < this.nextCheck) return;
    this.nextCheck = time + 1;
    let changed = false;
    for (const record of this.bodies) {
      const npc = record.npc;
      if (!npc.deathSettled || !outsideView(npc.position, player, frustum, drawDistance)) continue;
      if (record.refill && !outsideView(npc.home, player, frustum, drawDistance)) continue;
      this.bodies.delete(record);
      this.byNpc.delete(npc);
      record.npc = null;
      record.body = null;
      record.reported = false;
      record.aided = false;
      retire(npc);
      changed = true;
      if (record.refill) {
        record.generation++;
        record.dead = false;
        record.health = null;
        record.looted = false;
        record.refill();
      }
    }
    if (changed) globalThis.window?.dispatchEvent?.(new Event('population-changed'));
  }

  serialize() {
    const people = Object.create(null);
    for (const [slot, record] of this.records) {
      const npc = record.npc;
      const state = {};
      if (record.generation) state.generation = record.generation;
      if (record.dead) {
        state.dead = true;
        if (npc) state.body = { at: npc.position.toArray(), facing: npc._fallYaw ?? npc.root.rotation.y,
          plan: npc._koPlan, from: npc._koFrom };
        else if (record.body) state.body = { ...record.body, at: record.body.at.slice() };
        if (npc ? npc.emergencyReported : record.reported) state.reported = true;
        if (npc ? npc.emergencyAided : record.aided) state.aided = true;
      } else {
        const health = npc ? npc.health : record.health;
        if (health > 0 && (!npc || health < npc.maxHealth)) state.health = health;
        if (npc ? npc.looted : record.looted) state.looted = true;
      }
      if (Object.keys(state).length) people[slot] = state;
    }
    return { seed: this.seed, people };
  }
}
