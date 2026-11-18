// src/entities/npc/memory.js
// Lo que cada peatón recuerda de lo malo que le vio hacer al jugador: qué fue, cuándo y qué tan fuerte. Se le
// borra en unos minutos de partida (unos 3 si lo vio, 5 si se lo hicieron a él; el chisme vale la mitad y dura 3),
// contados en tiempo de juego vivido: los segundos de simulación y, cuando el reloj salta (dormir), lo que saltó.
// Mientras se acuerda, lo reconoce: le da recelo de lejos, no le da limosna y, si fue su víctima, huye o le
// reclama según su carácter. Y lo cuenta: quien está al lado de alguien que se acuerda se entera, más flojo.
// No se guarda en la partida.

export const MEMORY = {
  witness: 180,   // s que dura lo que vio
  victim: 300,    // s que dura lo que le hicieron
  heard: 180,     // s que dura un chisme
  hearsay: .5,    // un chisme vale esta parte de lo que sabe quien lo cuenta
  floor: .15,     // por debajo de esto ya no se cuenta
  recognize: .2,  // desde aquí lo reconoce al verlo
  alms: .25,      // desde aquí no le da limosna
  gossipReach: 3, // m: se cuenta al que está al lado
  gossipEvery: 10 // s entre dos chismes de la misma persona
};
const SLOTS = 3;

// Lo que dicen. De usted y de aquí.
// La víctima que lo reconoce y se aleja, según lo que le hizo.
export const RECOGNIZE_PHRASES = {
  robo: '¡Ese es el que me robó!', golpe: '¡Ese fue el que me pegó!', popo: '¡Ese fue el de la popó!', pelea: '¡Ese es el peleonero!'
};
// La víctima brava que se lo encuentra y le reclama.
export const RECLAIM_PHRASES = ['¡Usted fue! ¡Devuélvame lo mío!', '¡Usted otra vez! ¡Esta vez no se la dejo pasar!', '¡A usted lo tengo fichado!'];
// Quien se acuerda y no le da limosna dice por qué: si fue su víctima, si lo vio o si se lo contaron, y qué hizo.
export const REFUSE_PHRASES = {
  victima: {
    robo: 'A usted no le doy nada: usted fue el que me robó.', golpe: 'Ni un peso: usted fue el que me pegó.',
    popo: 'Usted me tiró la popó. Ni un peso.', pelea: 'Ni un peso: usted fue el que se me vino a pelear.'
  },
  vio: {
    robo: 'Yo lo vi robando hace un rato. Ni un peso.', golpe: 'Yo lo vi pegándole a uno. A usted no le doy nada.',
    popo: 'Yo vi lo de la popó. Siga derecho.', pelea: 'Yo lo vi peleando. A usted no le doy nada.'
  },
  chisme: {
    robo: 'Me contaron que anda robando por aquí. No le doy nada.', golpe: 'Me dijeron que le pegó a alguien. Siga derecho.',
    popo: 'Me contaron lo de la popó. Siga derecho.', pelea: 'Me dijeron que anda buscando pelea. No le doy nada.'
  }
};
const REFUSE_OTHER = 'Ni un peso, después de lo que hizo.';

/** La frase de quien no le da limosna por `act` (lo que más le pesa del jugador). */
export function refusalFor(act) {
  const why = act?.victim ? 'victima' : act?.heard ? 'chisme' : 'vio';
  return REFUSE_PHRASES[why][act?.tipo] ?? REFUSE_OTHER;
}
// El chisme, al que está al lado.
export const GOSSIP_PHRASES = ['¿Vio a ese? Anda robando por aquí.', 'Ojo con ese, que no es de fiar.', 'Ese de allá hace rato armó un escándalo.'];

export class Memory {
  constructor() {
    // Hasta tres hechos; el nuevo pisa al que ya pesa menos.
    this.acts = Array.from({ length: SLOTS }, () => ({ tipo: null, cuando: -Infinity, intensidad: 0, life: 1, victim: false, heard: false }));
    this.gossipAt = -Infinity;
    this.recognizedAt = -Infinity;
  }

  /** Recuerda un hecho del jugador. `victim`: se lo hizo a él. `heard`: se lo contaron. */
  remember(tipo, intensidad, now, { victim = false, heard = false } = {}) {
    const value = Math.max(0, Math.min(1, intensidad));
    // El mismo hecho otra vez (el siguiente golpe de la pelea): se refresca, no ocupa otro puesto.
    for (const act of this.acts) {
      if (act.tipo !== tipo || act.victim !== victim || act.heard !== heard || this._weight(act, now) <= 0) continue;
      act.intensidad = Math.max(this._weight(act, now), value);
      act.cuando = now;
      return;
    }
    let slot = this.acts[0], weakest = Infinity;
    for (const act of this.acts) {
      const w = this._weight(act, now);
      if (w < weakest) { weakest = w; slot = act; }
    }
    slot.tipo = tipo; slot.cuando = now; slot.intensidad = value;
    slot.victim = victim; slot.heard = heard;
    slot.life = victim ? MEMORY.victim : heard ? MEMORY.heard : MEMORY.witness;
  }

  _weight(act, now) {
    if (!act.tipo) return 0;
    const age = now - act.cuando;
    return age >= act.life ? 0 : act.intensidad * (1 - age / act.life);
  }

  /** Cuánto le pesa ahora lo que sabe del jugador (0 nada, 1 se lo acaban de hacer). */
  grudge(now) {
    let best = 0;
    for (const act of this.acts) best = Math.max(best, this._weight(act, now));
    return best;
  }

  /** ¿Fue su víctima y todavía se acuerda (con más de `min` de peso)? El hecho, o null. */
  victimOf(now, min = 0) {
    for (const act of this.acts) if (act.victim && this._weight(act, now) > min) return act;
    return null;
  }

  /** Lo más fuerte que recuerda (para contarlo), o null. */
  strongest(now) {
    let best = null, weight = 0;
    for (const act of this.acts) {
      const w = this._weight(act, now);
      if (w > weight) { weight = w; best = act; }
    }
    return best;
  }

  refusesAlms(now) { return this.grudge(now) >= MEMORY.alms; }

  /** Pasaron `seconds` sin que él los viviera (el jugador durmió): todo lo que recuerda queda así de viejo. */
  age(seconds) {
    if (!(seconds > 0)) return;
    for (const act of this.acts) act.cuando -= seconds;
    this.gossipAt -= seconds;
    this.recognizedAt -= seconds;
  }

  /**
   * Le cuenta a `other` lo más fuerte que sabe, más flojo. true si le contó algo nuevo (que el otro no supiera
   * igual de fuerte). Una vez cada `gossipEvery` s.
   */
  tell(other, now) {
    if (now - this.gossipAt < MEMORY.gossipEvery) return false;
    const act = this.strongest(now);
    if (!act) return false;
    const value = this._weight(act, now) * MEMORY.hearsay;
    if (value < MEMORY.floor || other.grudge(now) >= value) return false;
    this.gossipAt = now;
    other.remember(act.tipo, value, now, { heard: true });
    return true;
  }
}

/**
 * Pedir limosna (InteractionSystem._beg): si toda la gente cerca se acuerda de algo malo del jugador, nadie le da
 * y se lo dicen. El perro no cuenta; un vendedor (sin mente) sí podría dar. true si nadie le da.
 */
export function allRefuseAlms(npcs) {
  let refusers = 0;
  for (const npc of npcs ?? []) {
    if (!npc?.person) continue;
    if (!npc.mind?.refusesAlms?.()) return false;
    refusers++;
  }
  if (!refusers) return false;
  for (const npc of npcs) if (npc?.person) npc.mind.sayRefusal();
  return true;
}
