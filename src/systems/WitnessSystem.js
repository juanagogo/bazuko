import { hasClearCombatLine } from './CombatGeometry.js';
import { Vector3 } from 'three';
import { LOW_STANCES } from '../character/archetypes.js';
import { DeathWitnesses } from './DeathWitnesses.js';
import { seesPerson, sightRange } from '../entities/npc/perception.js';

/**
 * Testigos de robos y peleas. Quien ve el delito desde cerca y sin nada en medio reacciona: uno saca el celular y
 * llama a la Policía y otro se queda grabando. Los peatones con mente que no sacan el celular reaccionan según lo que
 * perciben; los demás salen corriendo. La llamada que termina sube
 * «te tienen fichado» y manda una patrulla al sitio; el jugador la corta si llega hasta quien llama, o si lo golpea.
 * El video que termina deja el fichado sin bajar un buen rato. Lo que dicen sale con su voz grabada si la tienen lista
 * (AudioSystem.voces) y, si no, solo en la burbuja.
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
  slack: 1,            // s de más que se le da al peatón antes de soltarlo a la fuerza
  prepararCada: 1,     // s entre una petición de voces y la siguiente mientras hay alguien a tiro de robo
};

// Lo que gritan los que huyen y lo que dicen los del celular, en la burbuja, cuando no lo dicen con su voz grabada.
// Sin tuteo: en la calle se trata de usted.
export const GRITOS = {
  robo: ['¡Ladrón!', '¡Cójanlo, que robó!', '¡Auxilio, un ladrón!'],
  pelea: ['¡Pelea, pelea!', '¡Lo van a matar!', '¡Sepárenlos!'],
  llamar: ['Aló, ¿Policía? Aquí están robando.', 'Sí, aquí en la esquina, vengan rápido.'],
  grabar: ['Esto va para las redes.', 'Lo tengo grabado, ¿oyó?'],
  colgar: ['¡Ya, ya, ya colgué!', 'Tranquilo, no llamé a nadie.'],
  alertaMuerte: ['Alguien cayó. ¡Llamen al 123!', '¡Hay una persona en el suelo!'],
  hallazgo: ['¿Me escucha? Ya estamos aquí.', 'Hay alguien en el suelo.'],
  auxilio: ['Aló, 123. Necesitamos una ambulancia en esta esquina.'],
};

const any = (list) => list[Math.floor(Math.random() * list.length)];

export class WitnessSystem {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.random = random;
    this.calls = [];   // { npc, kind, position, left }
    this.films = [];   // { npc, left }
    this._cooldown = 0;
    this._prepararEn = 0;
    this.deaths = new DeathWitnesses(this);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._onFight = (e) => this._fight(e.detail ?? {});
      this._onDeath = (e) => this.reportDeath(e.detail);
      window.addEventListener('street-fight', this._onFight);
      window.addEventListener('npc-death', this._onDeath);
    }
  }

  get callSeconds() { return WITNESS.callSeconds; }

  reportDeath(detail) { return this.deaths.report(detail); }

  _fight({ hits = [], results, attacker } = {}) {
    this.deaths.fightAt(attacker?.position);
    if (results ? attacker !== this.game.player : attacker && attacker !== this.game.player && attacker.position !== this.game.player?.position) return;
    if (results) {
      const civilian = results.filter(r => !r.wasAggressor && r.health !== 0 && !r.target?.isDead);
      if (!civilian.length) return;
      const fall = this.deaths.incidents.find(s => s.attacker === attacker && s.attackId === civilian[0].attackId && hits.includes(s.victim));
      this.report('pelea', hits, civilian, fall?.group);
      return;
    }
    if (hits.length && hits.every(n => n.isDead || n.isAggressor)) return;
    this.report('pelea', hits);
  }

  _cancelFightAbout(victim) {
    for (const list of [this.calls, this.films]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        if (item.kind !== 'pelea' || (item.injured ? item.injured !== victim : !item.victims?.includes(victim))) continue;
        item.npc.stopWitness?.();
        this._voces()?.cortarTestigo?.(item.npc, list === this.calls ? 'llamar' : 'grabar');
        list.splice(i, 1);
      }
    }
  }

  /**
   * Quien puede verlo: cerca, en la misma planta, sin muro en medio, de pie y libre. No cuentan las víctimas (la del
   * robo o los golpeados de la pelea) ni quien ya huye o se está sacudiendo por un golpe.
   */
  _witnesses(playerPos, victims, positions = null) {
    const npcs = this.game?.world?.active?.npcs ?? [];
    const collisions = this.game?.collisions;
    const r2 = WITNESS.radius * WITNESS.radius;
    const list = [];
    for (const npc of npcs) {
      if (!npc?.position || victims.includes(npc) || npc.isDead || npc._disposed || npc.koState || npc.deathResponse) continue;
      if (npc.fleeTimer > 0 || npc._hitReactionRemaining > 0) continue;
      if (npc.isVendor || npc.fijo || LOW_STANCES.has(npc.stance) || npc.witnessing) continue;
      if (Math.abs(npc.position.y - playerPos.y) > WITNESS.heightTolerance) continue;
      const dx = npc.position.x - playerPos.x, dz = npc.position.z - playerPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      if (collisions && !hasClearCombatLine({ from: npc.position, to: playerPos, collisions })) continue;
      if (positions) {
        const range = sightRange(this.game.clock?.isNight, this.game.weather?.isRaining);
        if (!seesPerson(npc, playerPos, range, collisions) || !positions.some(p => seesPerson(npc, p, range, collisions))) continue;
      }
      list.push({ npc, d2 });
    }
    list.sort((a, b) => a.d2 - b.d2);
    return list.slice(0, WITNESS.maxWitnesses).map((w) => w.npc);
  }

  /** Un robo o una pelea delante de la gente; `victim` es una persona o la lista de golpeados. Devuelve cuántos lo vieron. */
  report(kind, victim = null, contacts = null, deathGroup = null) {
    const playerPos = this.game?.player?.position;
    if (!playerPos || this._cooldown > 0) return 0;
    const victims = Array.isArray(victim) ? victim : [victim];
    const positions = contacts?.map(r => r.position ?? r.target?.position);
    const injured = contacts?.map(r => r.target) ?? victims;
    const witnesses = this._witnesses(playerPos, victims, positions);
    if (!witnesses.length) return 0;
    this._cooldown = WITNESS.cooldown;
    // Los que no alcancen a tener su voz lista ahora la tendrán para colgar o para la próxima escena.
    for (const npc of witnesses) this._voces()?.prepararTestigo?.(npc);
    let caller = false, filmer = false, screamed = false;
    const filmingFight = kind === 'pelea' && this.films.length > 0;
    // En un robo la víctima grita en este mismo instante: la voz del testigo va después de la suya (VoiceDirector).
    this._trasLaVictima = kind === 'robo' && !!victim && !Array.isArray(victim);
    for (const npc of witnesses) {
      if (!caller && !this.calls.length && this.random() < WITNESS.callChance && npc.witness?.('llamar', WITNESS.callSeconds)) {
        caller = true;
        const range = sightRange(this.game.clock?.isNight, this.game.weather?.isRaining);
        const seen = contacts?.find(r => seesPerson(npc, r.position ?? r.target?.position, range, this.game.collisions));
        const position = new Vector3().copy(seen?.position ?? seen?.target?.position ?? playerPos);
        this.calls.push({ npc, kind, victims: injured, position, deathGroup, injured: seen?.target, left: WITNESS.callSeconds + WITNESS.slack });
        this._decir(npc, 'llamar');
        continue;
      }
      if (!filmer && !filmingFight && this.random() < WITNESS.filmChance && npc.witness?.('grabar', WITNESS.filmSeconds)) {
        filmer = true;
        this.films.push({ npc, kind, victims: injured, left: WITNESS.filmSeconds + WITNESS.slack });
        this._decir(npc, 'grabar');
        continue;
      }
      if (!npc.mind) npc._fleeFrom?.(playerPos);
      if (!screamed) { screamed = true; this._decir(npc, kind); }
    }
    this._trasLaVictima = false;
    if (caller) this._toast('Alguien está llamando a la Policía: tengo que llegarle antes de que cuelgue', 'warn');
    else if (filmer) this._toast('Me están grabando con el celular', 'warn');
    return witnesses.length;
  }

  /**
   * Sigue las llamadas y los videos. Si el peatón salió del mundo o no avanzó su propio tiempo, se le suelta el
   * celular aquí: ningún testigo se queda quieto para siempre.
   */
  update(dt) {
    if (this._cooldown > 0) this._cooldown = Math.max(0, this._cooldown - dt);
    this._prepararVoces(dt);
    this.deaths.update(dt);
    const player = this.game?.player?.position;
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const call = this.calls[i], npc = call.npc;
      const voice = call.job ? 'auxilio' : 'llamar';
      if (call.job?.released) {
        this._voces()?.cortarTestigo?.(npc, voice);
        this.calls.splice(i, 1); continue;
      }
      if (this._expired(call, dt, voice)) {
        if (call.job) this.deaths.finishCall(call.job, false);
        this.calls.splice(i, 1); continue;
      }
      if (!call.job && player && npc.witnessing === 'llamar'
        && Math.hypot(npc.position.x - player.x, npc.position.z - player.z) <= WITNESS.interruptRange) {
        npc.stopWitness?.();
        npc._fleeFrom?.(player);
        this._voces()?.cortarTestigo?.(npc, 'llamar');
        this._decir(npc, 'colgar');
        this.calls.splice(i, 1);
        this._toast('Le hice colgar', 'info');
        continue;
      }
      if (npc.witnessing === 'llamar') continue;
      this.calls.splice(i, 1);
      // Terminó la llamada solo si nadie lo interrumpió: un golpe, un susto o un derribo le quitan el celular.
      const completed = !npc.isDead && !npc.koState && !(npc.fleeTimer > 0) && npc._witnessFinished;
      if (call.job) this.deaths.finishCall(call.job, completed);
      else if (completed && call.deathGroup) this.deaths.finishFightCall(call);
      else if (completed) this._callCompleted(call);
      if (!completed) this._voces()?.cortarTestigo?.(npc, voice);
    }
    for (let i = this.films.length - 1; i >= 0; i--) {
      const film = this.films[i], npc = film.npc;
      if (this._expired(film, dt, 'grabar')) { this.films.splice(i, 1); continue; }
      if (npc.witnessing === 'grabar') continue;
      this.films.splice(i, 1);
      if (npc._witnessFinished && !npc.koState && !(npc.fleeTimer > 0)) {
        const steal = this.game?.steal;
        if (steal) steal._calma = 0;
        this._toast('Me grabaron: ese video va a dar vueltas', 'warn');
      } else this._voces()?.cortarTestigo?.(npc, 'grabar');
    }
  }

  /** Lo que dice el testigo: con su voz grabada y su burbuja si la tiene lista; si no, la burbuja de siempre. */
  _decir(npc, situacion) {
    // El texto se sortea siempre: así el azar del juego es el mismo con voz o sin ella.
    const texto = any(GRITOS[situacion]);
    // Si queda esperando su turno detrás de la víctima y no le llega, pone ese texto: nunca se queda mudo.
    if (this._voces()?.decirTestigo?.(npc, situacion, { trasLaVictima: !!this._trasLaVictima, sinTurno: () => npc.say?.(texto) }) === true) return;
    npc.say?.(texto);
  }

  _voces() { return this.game?.audio?.voces ?? null; }

  /**
   * Antes del robo: mientras hay alguien a tiro (el aviso de E y Q a la vista), cada segundo se piden las voces de
   * quienes lo verían, para que estén cargadas si sale mal. Al arrancar el juego no se pide ninguna.
   */
  _prepararVoces(dt) {
    const voces = this._voces(), objetivo = this.game?.steal?.targetNpc, playerPos = this.game?.player?.position;
    if (!voces?.prepararTestigo || !objetivo || !playerPos) { this._prepararEn = 0; return; }
    if ((this._prepararEn -= dt) > 0) return;
    this._prepararEn = WITNESS.prepararCada;
    for (const npc of this._witnesses(playerPos, [objetivo])) voces.prepararTestigo(npc);
  }

  /** El peatón ya no está en el mundo, o se pasó de su tiempo sin terminar: se le suelta sin que cuente. */
  _expired(entry, dt, mode) {
    entry.left -= dt;
    if (!entry.npc._disposed && !entry.npc.isDead && entry.left > 0) return false;
    entry.npc.stopWitness?.();
    this._voces()?.cortarTestigo?.(entry.npc, mode);
    return true;
  }

  _callCompleted(call) {
    const steal = this.game?.steal;
    if (steal && typeof steal.buscado === 'number') {
      steal.buscado = Math.min(3, steal.buscado + 1);
      steal._calma = 0;
      if (this.game.traffic) this.game.traffic.wantedLevel = steal.buscado;
    }
    // El motivo de la llamada (robo, pelea) solo le sirve a la radio para decir una frase que cuadre.
    this.game?.traffic?.dispatchTo?.(call.position, this.game?.player?.position, call.kind);
    this._toast('Un testigo llamó a la Policía', 'death');
  }

  /** Muerte, arresto, dormir, viajar o salir de la partida: nadie sigue llamando ni grabando. */
  reset() {
    for (const call of this.calls) { call.npc.stopWitness?.(); this._voces()?.cortarTestigo?.(call.npc, call.job ? 'auxilio' : 'llamar'); }
    for (const film of this.films) { film.npc.stopWitness?.(); this._voces()?.cortarTestigo?.(film.npc, 'grabar'); }
    this.deaths.reset();
    this.calls.length = 0;
    this.films.length = 0;
    this._cooldown = 0;
  }

  dispose() {
    this.reset();
    if (this._onFight && typeof window !== 'undefined') {
      window.removeEventListener('street-fight', this._onFight);
      window.removeEventListener('npc-death', this._onDeath);
    }
  }

  _toast(text, type) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try { window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } })); } catch {}
  }
}
