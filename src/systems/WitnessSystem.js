import { hasClearCombatLine } from './CombatGeometry.js';
import { LOW_STANCES } from '../character/archetypes.js';

/**
 * Testigos de robos y peleas. Quien ve el delito desde cerca y sin nada en medio reacciona: uno saca el celular y
 * llama a la Policía, otro se queda grabando y los demás salen corriendo, alguno gritando. La llamada que termina sube
 * «te tienen fichado» y manda una patrulla al sitio; el jugador la corta si llega hasta quien llama, o si lo golpea.
 * El video que termina deja el fichado sin bajar un buen rato.
 */
export const WITNESS = {
  radius: 16,          // metros a los que alguien alcanza a ver bien lo que pasó
  maxWitnesses: 6,
  callSeconds: 6,      // lo que tarda en contar dónde y qué
  filmSeconds: 8,
  callChance: .7,
  filmChance: .5,
  interruptRange: 2,   // llegar hasta quien llama le hace colgar
  cooldown: 4,         // cada golpe de una pelea no arma una escena nueva
  heightTolerance: 1.2,
};

// Lo que gritan los que huyen y lo que dicen los del celular. Sin tuteo: en la calle se trata de usted.
export const GRITOS = {
  robo: ['¡Ladrón!', '¡Cójanlo, que robó!', '¡Auxilio, un ladrón!'],
  pelea: ['¡Pelea, pelea!', '¡Lo van a matar!', '¡Sepárenlos!'],
  carro: ['¡Se robó ese carro!', '¡Ladrón de carros!'],
  llamar: ['Aló, ¿Policía? Aquí están robando.', 'Sí, aquí en la esquina, vengan rápido.'],
  grabar: ['Esto va para las redes.', 'Lo tengo grabado, ¿oyó?'],
  colgar: ['¡Ya, ya, ya colgué!', 'Tranquilo, no llamé a nadie.'],
};

const any = (list) => list[Math.floor(Math.random() * list.length)];

function emit(type, detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch {}
}

export class WitnessSystem {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.random = random;
    this.calls = [];   // { npc, position }
    this.films = [];   // { npc }
    this._cooldown = 0;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._onFight = () => this.report('pelea');
      window.addEventListener('street-fight', this._onFight);
    }
  }

  /** Quien puede verlo: cerca, en la misma planta, sin muro en medio, de pie y libre. */
  _witnesses(playerPos, victim) {
    const npcs = this.game?.world?.active?.npcs ?? [];
    const collisions = this.game?.collisions;
    const r2 = WITNESS.radius * WITNESS.radius;
    const list = [];
    for (const npc of npcs) {
      if (!npc?.position || npc === victim || npc._disposed || npc.hp <= 0 || npc.koState) continue;
      if (npc.isVendor || npc.fijo || LOW_STANCES.has(npc.stance) || npc.witnessing) continue;
      if (npc.combatAI && npc.combatAI.state !== 'libre') continue;
      if (Math.abs(npc.position.y - playerPos.y) > WITNESS.heightTolerance) continue;
      const dx = npc.position.x - playerPos.x, dz = npc.position.z - playerPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      if (collisions && !hasClearCombatLine({ from: npc.position, to: playerPos, collisions })) continue;
      list.push({ npc, d2 });
    }
    list.sort((a, b) => a.d2 - b.d2);
    return list.slice(0, WITNESS.maxWitnesses).map((w) => w.npc);
  }

  /** Un robo, una pelea o un carro robado delante de la gente. Devuelve cuántos lo vieron. */
  report(kind, victim = null) {
    const playerPos = this.game?.player?.position;
    if (!playerPos || this._cooldown > 0) return 0;
    const witnesses = this._witnesses(playerPos, victim);
    if (!witnesses.length) return 0;
    this._cooldown = WITNESS.cooldown;
    let caller = false, filmer = false, screamed = false;
    for (const npc of witnesses) {
      if (!caller && !this.calls.length && this.random() < WITNESS.callChance && npc.witness?.('llamar', WITNESS.callSeconds)) {
        caller = true;
        this.calls.push({ npc, position: playerPos.clone?.() ?? { ...playerPos } });
        npc.say?.(any(GRITOS.llamar));
        continue;
      }
      if (!filmer && this.random() < WITNESS.filmChance && npc.witness?.('grabar', WITNESS.filmSeconds)) {
        filmer = true;
        this.films.push({ npc });
        npc.say?.(any(GRITOS.grabar));
        continue;
      }
      npc._fleeFrom?.(playerPos);
      if (!screamed) { screamed = true; npc.say?.(any(GRITOS[kind] ?? GRITOS.robo)); }
    }
    if (caller) this._toast('Alguien está llamando a la Policía: tengo que llegarle antes de que cuelgue', 'warn');
    else if (filmer) this._toast('Me están grabando con el celular', 'warn');
    emit('witnesses', { kind, count: witnesses.length, caller, filmer });
    return witnesses.length;
  }

  update(dt) {
    if (this._cooldown > 0) this._cooldown = Math.max(0, this._cooldown - dt);
    const player = this.game?.player?.position;
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const call = this.calls[i], npc = call.npc;
      if (player && npc.witnessing === 'llamar'
        && Math.hypot(npc.position.x - player.x, npc.position.z - player.z) <= WITNESS.interruptRange) {
        npc.stopWitness?.();
        npc._fleeFrom?.(player);
        npc.say?.(any(GRITOS.colgar));
        this.calls.splice(i, 1);
        this._toast('Le hice colgar', 'info');
        continue;
      }
      if (npc.witnessing === 'llamar') continue;
      this.calls.splice(i, 1);
      // Terminó la llamada solo si nadie lo interrumpió: un golpe, un susto o un derribo le quitan el celular.
      if (!npc.koState && !(npc.hp <= 0) && !(npc.fleeTimer > 0) && npc._witnessFinished) this._callCompleted(call);
    }
    for (let i = this.films.length - 1; i >= 0; i--) {
      const film = this.films[i], npc = film.npc;
      if (npc.witnessing === 'grabar') continue;
      this.films.splice(i, 1);
      if (npc._witnessFinished && !npc.koState && !(npc.fleeTimer > 0)) {
        const steal = this.game?.steal;
        if (steal) steal._calma = 0;
        this._toast('Me grabaron: ese video va a dar vueltas', 'warn');
      }
    }
  }

  _callCompleted(call) {
    const steal = this.game?.steal;
    if (steal && typeof steal.buscado === 'number') {
      steal.buscado = Math.min(3, steal.buscado + 1);
      steal._calma = 0;
      if (this.game.traffic) this.game.traffic.wantedLevel = steal.buscado;
    }
    this.game?.traffic?.dispatchTo?.(call.position);
    this._toast('Un testigo llamó a la Policía', 'death');
    emit('witness-call', { x: call.position.x, z: call.position.z });
  }

  /** Muerte, arresto o cambio de distrito: nadie sigue llamando ni grabando. */
  reset() {
    for (const { npc } of [...this.calls, ...this.films]) npc.stopWitness?.();
    this.calls.length = 0;
    this.films.length = 0;
    this._cooldown = 0;
  }

  dispose() {
    this.reset();
    if (this._onFight && typeof window !== 'undefined') window.removeEventListener('street-fight', this._onFight);
  }

  _toast(text, type) { emit('toast', { text, type }); }
}
