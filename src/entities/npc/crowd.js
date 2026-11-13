// src/entities/npc/crowd.js
// Quién anda cerca de quién: una rejilla por celdas de 4 m que se arma una vez por cuadro con los peatones, el
// jugador, el perro y cualquier agente de `trafficPedestrians` (un conductor bravo, un agente a pie). No asigna
// memoria por cuadro: las listas son arreglos tipados que se reutilizan y crecen solo si llega más gente.
//
// De dónde venía cada agente, para estimar su velocidad, se guarda en la rejilla y no en el agente: un puesto fijo
// por agente (un WeakMap lo encuentra) en arreglos tipados. Escribir campos nuevos en objetos de tantas formas
// distintas (peatones, perro, conductor, el jugador) obliga al motor a empaquetar cada número y asigna memoria en
// cada cuadro. Las posiciones se leen vivas: quien ya se movió en este cuadro se ve donde está.

import { hypot } from './hypot.js';

export const CROWD_CELL = 4;
const BUCKETS = 1024; // potencia de 2: el índice de la celda se dobla con una máscara
const TELEPORT = 3;   // m en un cuadro: lo pusieron ahí, no corrió
const FORGET = 600;   // cuadros sin verlo para que su puesto pase a otro agente

export class CrowdGrid {
  constructor(capacity = 128) {
    this.head = new Int32Array(BUCKETS).fill(-1);
    this._grow(capacity);
    this.count = 0;
    this.frame = 0;
    this.pinned = -1; // índice del agente que no se cae de una consulta llena (el jugador), -1 si no hay
    this._slotOf = new WeakMap();
    this._slotAgent = [];
    this._growSlots(capacity);
  }

  _growSlots(capacity) {
    const keep = (Type, prev) => { const next = new Type(capacity); if (prev) next.set(prev); return next; };
    this._px = keep(Float64Array, this._px);
    this._pz = keep(Float64Array, this._pz);
    this._pvx = keep(Float64Array, this._pvx);
    this._pvz = keep(Float64Array, this._pvz);
    this._seenAt = keep(Int32Array, this._seenAt);
  }

  /** El puesto de `agent`: el suyo, uno que dejó alguien que ya no aparece o uno nuevo. Solo asigna al llegar alguien. */
  _slot(agent) {
    const slot = this._slotOf.get(agent);
    if (slot !== undefined && this._slotAgent[slot] === agent) return slot;
    let free = -1;
    for (let k = 0; k < this._slotAgent.length; k++) if (this.frame - this._seenAt[k] > FORGET) { free = k; break; }
    if (free < 0) {
      free = this._slotAgent.length;
      if (free >= this._px.length) this._growSlots(this._px.length * 2);
      this._slotAgent.push(null);
    }
    this._slotAgent[free] = agent;
    this._slotOf.set(agent, free);
    this._seenAt[free] = -FORGET - 1; // sin cuadro anterior: no hay velocidad que estimar
    return free;
  }

  /** Velocidad estimada de `agent` en el último cuadro en que se metió (m/s), 0 si no está. */
  velocityX(agent) { const s = this._slotOf.get(agent); return s !== undefined && this._slotAgent[s] === agent ? this._pvx[s] : 0; }
  velocityZ(agent) { const s = this._slotOf.get(agent); return s !== undefined && this._slotAgent[s] === agent ? this._pvz[s] : 0; }

  _grow(capacity) {
    const old = this.agents;
    this.capacity = capacity;
    const keep = (Type, prev) => { const next = new Type(capacity); if (prev) next.set(prev.subarray(0, Math.min(prev.length, capacity))); return next; };
    this.next = keep(Int32Array, this.next);
    this.vx = keep(Float32Array, this.vx);
    this.vz = keep(Float32Array, this.vz);
    this.speed = keep(Float32Array, this.speed);
    this.agents = new Array(capacity).fill(null);
    if (old) for (let i = 0; i < old.length && i < capacity; i++) this.agents[i] = old[i];
  }

  static bucket(x, z) {
    const cx = Math.floor(x / CROWD_CELL), cz = Math.floor(z / CROWD_CELL);
    return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & (BUCKETS - 1);
  }

  clear() {
    this.frame++;
    this.head.fill(-1);
    for (let i = 0; i < this.count; i++) this.agents[i] = null;
    this.count = 0;
    this.pinned = -1;
  }

  /**
   * Mete un agente con su velocidad estimada desde el cuadro anterior. `position` es la del agente (se lee viva).
   * Devuelve su índice en la rejilla de este cuadro.
   */
  add(agent, position, dt) {
    if (this.count >= this.capacity) this._grow(this.capacity * 2);
    const i = this.count++;
    let vx = 0, vz = 0;
    const s = this._slot(agent), x = position.x, z = position.z;
    if (this.frame - this._seenAt[s] <= FORGET && dt > 0) {
      const dx = x - this._px[s], dz = z - this._pz[s];
      if (dx * dx + dz * dz < TELEPORT * TELEPORT) {
        // Suavizado corto: un cuadro lento o un paso de ruta no vuelven loca la estimación.
        vx = this._pvx[s] * .5 + dx / dt * .5;
        vz = this._pvz[s] * .5 + dz / dt * .5;
      }
    }
    this._px[s] = x; this._pz[s] = z;
    this._pvx[s] = vx; this._pvz[s] = vz;
    this._seenAt[s] = this.frame;
    this.agents[i] = agent;
    this.vx[i] = vx; this.vz[i] = vz;
    this.speed[i] = hypot(vx, vz);
    const b = CrowdGrid.bucket(position.x, position.z);
    this.next[i] = this.head[b];
    this.head[b] = i;
    return i;
  }

  /**
   * Índices de los agentes en las celdas que tocan el círculo (x, z, radius), en `out`. Puede traer alguno de más
   * (una celda lejana que cae en la misma cubeta): quien pregunta mide la distancia de todos modos. Si `out` se
   * llena, el agente fijado (`pinned`, el jugador) entra igual en el último puesto cuando su celda está entre las
   * consultadas: en un gentío nadie deja de verlo.
   */
  query(x, z, radius, out) {
    let n = 0, visited = 0, pinnedIn = false;
    const pinned = this.pinned;
    const seen = this._seen ??= new Int32Array(16);
    const c0x = Math.floor((x - radius) / CROWD_CELL), c1x = Math.floor((x + radius) / CROWD_CELL);
    const c0z = Math.floor((z - radius) / CROWD_CELL), c1z = Math.floor((z + radius) / CROWD_CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const b = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & (BUCKETS - 1);
        // Dos celdas en la misma cubeta: la cadena ya se recorrió.
        let repeated = false;
        for (let k = 0; k < visited; k++) if (seen[k] === b) { repeated = true; break; }
        if (repeated) continue;
        if (visited < seen.length) seen[visited++] = b;
        for (let i = this.head[b]; i >= 0; i = this.next[i]) {
          if (i === pinned) { if (pinnedIn) continue; pinnedIn = true; if (n === out.length) { out[n - 1] = i; continue; } }
          if (n < out.length) out[n++] = i;
        }
      }
    }
    return n;
  }
}
