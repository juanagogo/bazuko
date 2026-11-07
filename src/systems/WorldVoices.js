// src/systems/WorldVoices.js
// Las voces que no son de un peatón: la Policía (gritos desde la patrulla que persigue, megáfono y la radio con la
// operadora), el jíbaro que ofrece en susurro de noche y el voceador del bus cuando para. Cada una sale de donde está
// por el mismo canal que la gente de la calle (AudioSystem.playNpcVoice): una sola voz a la vez y más bajo de lejos.
import { FRASES, frasesDe } from '../data/vocesCalle.js';
import { ShuffleBag } from './voiceVariety.js';
import { PRIORIDAD_VOZ } from './voces/prioridad.js';

const POLICE_VOICES = ['policia_a', 'policia_b'];
// Gritos de la patrulla que persigue: cada tanto, y de lejos más megáfono que grito.
export const POLICE_SHOUT = { range: 26, level: .95, min: 5, extra: 4, megaphoneFrom: 11, megaphoneChance: .35, first: 1.5 };
// La radio se oye desde la patrulla más cercana; sin una cerca, nadie la oye.
export const POLICE_RADIO = { range: 35, level: .7, gap: .5, ttl: 6 };
export const DEALER_WHISPER = { range: 7, level: .9, min: 11, extra: 9 };
export const BUS_CALLER = { range: 20, level: .85 };

const BY_ID = new Map(FRASES.map(frase => [frase.id, frase]));

export class WorldVoices {
  constructor({ audio, eventTarget = globalThis.window, random = Math.random } = {}) {
    this.audio = audio;
    this.random = random;
    this.eventTarget = eventTarget;
    this.dealer = null;               // lo pone el juego: el jíbaro del distrito
    this._patrolVoice = new WeakMap(); // patrulla → policia_a o policia_b, fija
    this._nextPatrol = 0;
    this._bags = new Map();
    this._shoutIn = POLICE_SHOUT.first;
    this._dealerIn = DEALER_WHISPER.min * .3;
    this._queue = [];                 // lo que sigue en la radio: { start, wait, ttl }
    this._busCalled = new WeakSet();  // bus que ya voceó en esta parada
    this._vehicles = [];
    this._listener = null;
    // Subtítulo de lo que se oye (lo pone VoiceDirector): (frase, posición, { radio, segundos, fuente }).
    this.onLine = null;
    this._handlers = {
      'police-chase': () => this._radio([['operadora_radio_1']]),
      'police-radio': event => this._radio(event?.detail?.reason === 'llamada'
        ? [['operadora_radio_2']]
        : [['radio_1', true], ['operadora_radio_3']]),
      'police-escaped': () => this._radio([[this.random() < .5 ? 'escape_1' : 'radio_2', true], ['operadora_radio_4']], false),
      'police-arrest': () => this._arrest(),
    };
    for (const [type, handler] of Object.entries(this._handlers)) eventTarget?.addEventListener?.(type, handler);
  }

  /** La patrulla queda con una de las dos voces de policía, una y otra por turnos. */
  patrolVoice(car) {
    if (!this._patrolVoice.has(car)) this._patrolVoice.set(car, POLICE_VOICES[this._nextPatrol++ % POLICE_VOICES.length]);
    return this._patrolVoice.get(car);
  }

  _line(situacion, voz) {
    const key = `${voz}_${situacion}`;
    if (!this._bags.has(key)) this._bags.set(key, new ShuffleBag(this.random));
    return this._bags.get(key).draw(frasesDe(situacion, voz), frase => frase.id);
  }

  /** Dice la frase desde `position`; su subtítulo sale cuando de verdad empieza a sonar. */
  _say(frase, position, { range, level, force = false, priority = 0, allowPaused = false, radio = false, source = null }) {
    if (!frase || !position) return false;
    const onStart = seconds => this.onLine?.(frase, position, { radio, seconds, source });
    return this.audio.playNpcVoice(frase.audio, { position }, { range, level, force, priority, allowPaused, onStart });
  }

  /** La patrulla más cercana al jugador dentro de `range`; con `chasing`, solo las que persiguen. */
  _nearestPatrol(range, chasing = false) {
    const listener = this._listener;
    if (!listener) return null;
    let best = null, bestDistance = range;
    for (const vehicle of this._vehicles) {
      const car = vehicle?.car;
      if (!vehicle.police || !car?.position) continue;
      if (chasing && vehicle.state !== 'chase' && !car.pursuit) continue;
      const distance = car.position.distanceTo(listener);
      if (distance < bestDistance) { best = vehicle; bestDistance = distance; }
    }
    return best ? { car: best.car, distance: bestDistance } : null;
  }

  /**
   * Una conversación por radio desde la patrulla más cercana: cada paso es [id o situación, ¿la dice el policía?].
   * Los pasos del policía usan su voz; los demás son frases fijas (la operadora). `chasing` exige una que persiga.
   */
  _radio(steps, chasing = true) {
    const patrol = this._nearestPatrol(POLICE_RADIO.range, chasing) ?? this._nearestPatrol(POLICE_RADIO.range);
    if (!patrol) return false;
    const voz = this.patrolVoice(patrol.car);
    this._queue = steps.map(([id, police]) => {
      const frase = police ? BY_ID.get(`${voz}_${id}`) : BY_ID.get(id);
      this.audio.prefetchVoice?.(frase?.audio);
      return { frase, car: patrol.car, wait: POLICE_RADIO.gap, ttl: POLICE_RADIO.ttl };
    }).filter(step => step.frase);
    return this._queue.length > 0;
  }

  /**
   * Lo cogieron: la patrulla que llega lo dice, aunque otra voz estuviera sonando. El juego se pausa en el mismo
   * evento (Game._policeArrest), así que la frase puede sonar en pausa y, si aún no cargó, sale al cargar.
   */
  _arrest() {
    const patrol = this._nearestPatrol(POLICE_RADIO.range, true) ?? this._nearestPatrol(POLICE_RADIO.range);
    if (!patrol) return false;
    this._queue = [];
    return this._say(this._line('arresto', this.patrolVoice(patrol.car)), patrol.car.position,
      { range: POLICE_RADIO.range, level: POLICE_SHOUT.level, force: true, allowPaused: true, priority: PRIORIDAD_VOZ.arrest, source: patrol.car });
  }

  update(dt, listener, vehicles = [], buses = null) {
    this._listener = listener;
    this._vehicles = vehicles ?? [];
    if (!listener || this.audio._paused) return;
    this._updateRadio(dt);
    this._updateShouts(dt);
    this._updateDealer(dt);
    this._updateBuses([buses].flat().filter(Boolean));
  }

  _busy() { return this.audio._voiceActive?.() || !!this.audio._pendingVoice; }

  _updateRadio(dt) {
    const step = this._queue[0];
    if (!step) return;
    if ((step.ttl -= dt) <= 0) { this._queue.shift(); return; }
    if (this._busy() || (step.wait -= dt) > 0) return;
    this._queue.shift();
    this._say(step.frase, step.car.position, { range: POLICE_RADIO.range, level: POLICE_RADIO.level, priority: PRIORIDAD_VOZ.radio, radio: true, source: step.car });
  }

  _updateShouts(dt) {
    const patrol = this._nearestPatrol(POLICE_SHOUT.range, true);
    if (!patrol) { this._shoutIn = Math.max(this._shoutIn, POLICE_SHOUT.first); return; }
    if ((this._shoutIn -= dt) > 0 || this._queue.length || this._busy()) return;
    this._shoutIn = POLICE_SHOUT.min + this.random() * POLICE_SHOUT.extra;
    const megaphone = patrol.distance > POLICE_SHOUT.megaphoneFrom && this.random() < POLICE_SHOUT.megaphoneChance;
    this._say(this._line(megaphone ? 'megafono' : 'grito', this.patrolVoice(patrol.car)), patrol.car.position,
      { range: POLICE_SHOUT.range, level: POLICE_SHOUT.level, priority: PRIORIDAD_VOZ.policeShout, source: patrol.car });
  }

  /** De noche, el jíbaro le ofrece en susurro a quien pasa cerca. */
  _updateDealer(dt) {
    const dealer = this.dealer, position = dealer?.position;
    if (!position || dealer._disposed || !dealer.isNight) return;
    if ((this._dealerIn -= dt) > 0) return;
    if (position.distanceTo(this._listener) > DEALER_WHISPER.range || this._busy()) return;
    this._dealerIn = DEALER_WHISPER.min + this.random() * DEALER_WHISPER.extra;
    this._say(this._line('ofrece', 'jibaro'), position, { range: DEALER_WHISPER.range, level: DEALER_WHISPER.level, priority: PRIORIDAD_VOZ.dealerWhisper, source: dealer });
  }

  /** El bus que para vocea una vez por parada si el jugador está cerca. */
  _updateBuses(buses) {
    for (const bus of buses) {
      if (!(bus.dwellRemaining > 0)) { this._busCalled.delete(bus); continue; }
      if (this._busCalled.has(bus) || !bus.position || bus.group?.visible === false) continue;
      if (bus.position.distanceTo(this._listener) > BUS_CALLER.range || this._busy()) continue;
      this._busCalled.add(bus);
      this._say(this._line('voceador', 'busetero'), bus.position, { range: BUS_CALLER.range, level: BUS_CALLER.level, priority: PRIORIDAD_VOZ.busCaller, source: bus });
    }
  }

  dispose() {
    for (const [type, handler] of Object.entries(this._handlers)) this.eventTarget?.removeEventListener?.(type, handler);
    this._queue = [];
  }
}
