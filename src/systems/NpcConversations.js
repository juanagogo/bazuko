// src/systems/NpcConversations.js
// Dos peatones que ya están juntos en el andén se ponen a conversar: se acercan a distancia de charla, se miran,
// quien habla gesticula y quien escucha espera a su manera. Una voz a la vez, cada una de su sexo, y se oye como
// una charla ajena: clara al lado, un murmullo a pocos metros.
import { LOW_STANCES } from '../character/archetypes.js';
import { npcSexo, voiceGain } from './StreetVoices.js';

// Dos personas hablando entre ellas, no hacia el jugador: claras al lado, un murmullo a 6-8 m y nada a 12.
const RANGE = 12, FULL = 2;               // metros: pleno hasta FULL, mudo desde RANGE
const VOLUME = .6;                        // por debajo de los conductores (.7) y el robo (.75)
const START_RANGE = 8;                    // solo empieza si el jugador está cerca de la pareja
const PAIR_MAX = 3.5;                     // metros entre los dos para que se pongan a hablar
const TALK_DISTANCE = 1.1;                // metros entre los dos ya conversando, de frente
const GAP_MIN = 35000, GAP_MAX = 70000;   // ms entre conversación y conversación
const CONVERSATION_COOLDOWN = 8 * 60000;  // ms antes de repetir la misma conversación
const NPC_COOLDOWN = 3 * 60000;           // ms antes de que la misma persona vuelva a conversar
const TURN_GAP = 350;                     // ms entre un turno y el siguiente
const FIRST_PAUSE = 450;                  // ms ya frente a frente antes de la primera frase
const SETTLE_TIMEOUT = 5000;              // ms para llegar a su sitio y tener los audios; si no, desiste
const RETRY = 2000;                       // sin pareja posible, no vuelve a buscar cada cuadro
// Cómo espera quien escucha. Quien carga algo no cruza los brazos ni gesticula: tiene las manos ocupadas.
const LISTEN_STANCES = ['brazos-cruzados', 'cambiar-peso', 'bolsillos', 'manos-atras'];
const SPEAK_STANCE = 'hablar';
// Con la vista o las manos en otra cosa no se pone a conversar.
const BUSY_STANCES = new Set(['telefono', 'celular', 'fumar-quieto', 'atender', 'nariz', 'huir']);

/** Edad de una persona, con la misma fuente que su sexo. */
export function npcEdad(npc) {
  return npc?.look?.real?.edad ?? npc?.person?.real?.edad ?? null;
}

const onSidewalk = (npc, point = npc.position) => npc.navigation?.isSidewalkAt?.(point) ?? true;

/**
 * Puede ponerse a conversar ahora: persona de la calle, tranquila, de pie, en el andén y libre. Las parejas fijas
 * que ya conversan con gestos (en el prado o en la plaza) valen aunque su sitio no sea un andén: no se mueven de él.
 */
function canTalk(npc) {
  if (!npc?.person || npc.talk || npc._bubbleEl) return false;
  if (npc.koState || npc.fleeTimer > 0 || npc.panicTimer > 0 || npc.isVendor || npc._riseLeft > 0) return false;
  // Pendiente de otra cosa (mira una pelea o va hacia ella, se asustó): ver entities/npc/mind.js.
  if (npc.mind?.busy()) return false;
  // Sentado, acurrucado, pidiendo o dormido no entra en una charla de pie; con el celular o fumando tampoco.
  if (LOW_STANCES.has(npc.stance) || BUSY_STANCES.has(npc.stance)) return false;
  // Un fijo que va o vuelve de su sitio no se para: en la calle armaría un atasco.
  if (npc.fijo?.out) return false;
  if (npc.fijo?.pareja) return true;
  // Nunca en la calzada ni en un cruce: parados ahí frenan a los carros.
  return onSidewalk(npc);
}

/** Sigue pudiendo conversar a mitad de la charla: un susto, un golpe, pararse o dormirse la cortan. */
function stillTalking(npc) {
  return !!npc?.talk && !npc.koState && !(npc.fleeTimer > 0) && !(npc.panicTimer > 0) && !LOW_STANCES.has(npc.stance);
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class NpcConversations {
  /**
   * @param {{ conversations: Array<{ id: string, hablantes: Record<string, { sexo: string, edad?: string }>,
   *   lineas: Array<{ hablante: string, texto: string, file: string }> }>,
   *   load: (file: string) => object, random?: () => number }} options
   */
  constructor({ conversations = [], load, random = Math.random } = {}) {
    this.conversations = conversations;
    this.load = load;
    this.random = random;
    this.levels = { voices: 1 };
    // Otra voz en curso (robo, conductor o frase de la calle) impide empezar.
    this.externalVoiceActive = () => false;
    this.paused = false;
    this._npcAt = new WeakMap();
    this._convAt = new Map();
    this._nextAt = 0;
    this._current = null;
  }

  /** Hay una conversación en curso, también mientras se acercan o entre turnos: el canal de voz sigue ocupado. */
  get busy() { return !!this._current; }

  /** Una línea sonando ahora mismo. */
  get active() {
    const line = this._current?.playing;
    return !!line && line.sound.playing(line.id);
  }

  /**
   * `now` es el reloj de la simulación en ms (AudioSystem lo avanza con el dt): con pocos cuadros por segundo la
   * gente camina más lento en tiempo real, y los plazos para llegar, los turnos y los enfriamientos se estiran igual.
   */
  update(position, pedestrians, now = performance.now()) {
    this._now = now;
    if (this.paused || !position) return;
    if (this._current) { this._advance(position, now); return; }
    if (now < this._nextAt || this.externalVoiceActive() || !this.load) return;
    const chosen = this._pick(position, pedestrians, now);
    if (!chosen) { this._nextAt = now + RETRY; return; }
    this._start(chosen, now);
  }

  /**
   * La pareja que más parece estar ya junta: cerca uno del otro, mejor si los dos están quietos y si la edad
   * coincide con la conversación. No la más cercana al jugador: dos que esperan juntas ganan a uno que pasa.
   */
  _pick(position, pedestrians, now) {
    const near = [];
    for (const npc of pedestrians ?? []) {
      if ((this._npcAt.get(npc) ?? -Infinity) > now || !canTalk(npc) || !npcSexo(npc)) continue;
      if (distance(npc.position, position) <= START_RANGE) near.push(npc);
    }
    if (near.length < 2) return null;
    const free = this.conversations.filter(c => (this._convAt.get(c.id) ?? -Infinity) <= now);
    if (!free.length) return null;
    let best = null;
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const a = near[i], b = near[j];
        const apart = flat(a.position, b.position);
        if (apart > PAIR_MAX) continue;
        const fits = this._fitting(free, a, b);
        if (!fits.length) continue;
        const ageFit = Math.max(...fits.map(f => f.score));
        const still = (a.moving ? 0 : 1) + (b.moving ? 0 : 1);
        // Una pareja fija ya estaba conversando con gestos: es la primera en ponerle voz.
        const together = a.fijo?.pareja === b ? 3 : 0;
        const score = together + still * 1.5 + ageFit - apart * .6;
        if (!best || score > best.score) best = { score, ageFit, fits };
      }
    }
    if (!best) return null;
    const options = best.fits.filter(f => f.score === best.ageFit);
    return options[Math.floor(this.random() * options.length)];
  }

  /** Conversaciones que esta pareja puede tener, con quién hace de cada hablante. */
  _fitting(conversations, a, b) {
    const fits = [];
    for (const conversation of conversations) {
      const roles = Object.keys(conversation.hablantes);
      if (roles.length !== 2) continue;
      const [r1, r2] = roles;
      const h1 = conversation.hablantes[r1], h2 = conversation.hablantes[r2];
      let fit = null;
      for (const [x, y] of [[a, b], [b, a]]) {
        if (npcSexo(x) !== h1.sexo || npcSexo(y) !== h2.sexo) continue;
        const score = (npcEdad(x) === h1.edad ? 1 : 0) + (npcEdad(y) === h2.edad ? 1 : 0);
        if (!fit || score > fit.score) fit = { conversation, roles: { [r1]: x, [r2]: y }, score };
      }
      if (fit) fits.push(fit);
    }
    return fits;
  }

  /**
   * Dónde se para cada uno: a TALK_DISTANCE del otro, sobre la recta que los une. El fijo no se mueve y el otro
   * va hacia él; si ya están cerca, o el sitio cae fuera del andén, se queda donde está.
   */
  _spots(a, b) {
    const ax = a.position.x, az = a.position.z, bx = b.position.x, bz = b.position.z;
    const apart = Math.hypot(bx - ax, bz - az);
    if (apart <= TALK_DISTANCE + .15 || apart < 1e-3) return [null, null];
    const ux = (bx - ax) / apart, uz = (bz - az) / apart;
    const spot = (npc, x, z) => {
      const point = { x, y: npc.position.y, z };
      return onSidewalk(npc, point) ? point : null;
    };
    if (a.fijo && b.fijo) return [null, null];
    if (a.fijo) return [null, spot(b, ax + ux * TALK_DISTANCE, az + uz * TALK_DISTANCE)];
    if (b.fijo) return [spot(a, bx - ux * TALK_DISTANCE, bz - uz * TALK_DISTANCE), null];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, half = TALK_DISTANCE / 2;
    return [spot(a, mx - ux * half, mz - uz * half), spot(b, mx + ux * half, mz + uz * half)];
  }

  _listenStance(npc) {
    if (npc.person?.style?.carry) return null;
    return LISTEN_STANCES[Math.floor(this.random() * LISTEN_STANCES.length)];
  }

  _start({ conversation, roles }, now) {
    const sounds = conversation.lineas.map(line => this.load(line.file));
    const people = Object.values(roles);
    const [a, b] = people;
    const [spotA, spotB] = this._spots(a, b);
    for (const [npc, partner, spot] of [[a, b, spotA], [b, a, spotB]]) {
      const listen = this._listenStance(npc);
      npc.talk = { partner, spot, ready: !spot, listen, stance: listen };
    }
    this._current = { conversation, roles, people, sounds, index: -1, playing: null, settling: true, deadline: now + SETTLE_TIMEOUT };
    this._convAt.set(conversation.id, now + CONVERSATION_COOLDOWN);
    for (const npc of people) this._npcAt.set(npc, now + NPC_COOLDOWN);
  }

  _advance(position, now) {
    const current = this._current;
    // Un susto, un golpe o que el jugador se aleje cortan la charla.
    const heard = current.people.some(npc => distance(npc.position, position) <= RANGE);
    if (!heard || !current.people.every(stillTalking)) { this._end(now); return; }
    if (current.settling) {
      if (current.sounds.some(sound => sound.loadFailed)) { this._end(now); return; }
      const loaded = current.sounds.every(sound => sound.state() === 'loaded');
      const arrived = current.people.every(npc => npc.talk.ready);
      if (!loaded || !arrived) {
        if (now > current.deadline) this._end(now);
        return;
      }
      current.settling = false;
      current.waitUntil = now + FIRST_PAUSE;
    }
    const line = current.playing;
    if (line) {
      if (line.sound.playing(line.id)) { line.sound.volume(this._volume(line.npc, position), line.id); return; }
      line.npc.talk.stance = line.npc.talk.listen; // terminó su turno: vuelve a escuchar
      current.playing = null;
      current.waitUntil = now + TURN_GAP;
    }
    if (now < current.waitUntil) return;
    if (current.index + 1 >= current.conversation.lineas.length) { this._end(now); return; }
    this._playLine(++current.index, position);
  }

  _playLine(index, position) {
    const current = this._current;
    const data = current.conversation.lineas[index];
    const npc = current.roles[data.hablante];
    const sound = current.sounds[index];
    const id = sound.play();
    sound.volume(this._volume(npc, position), id);
    current.playing = { sound, id, npc };
    if (!npc.person?.style?.carry) npc.talk.stance = SPEAK_STANCE;
    npc.say?.(data.texto, Math.max(1.5, (sound.duration() || 2) + .4));
  }

  _volume(npc, position) { return VOLUME * this.levels.voices * voiceGain(distance(npc.position, position), FULL, RANGE); }

  _end(now = this._now ?? 0) {
    const current = this._current;
    if (!current) return;
    this._current = null;
    if (current.playing) current.playing.sound.stop(current.playing.id);
    for (const sound of current.sounds) sound.unload?.();
    // Cada uno sigue con lo suyo: quien iba de camino retoma su ruta.
    for (const npc of current.people) if (npc.talk && current.people.includes(npc.talk.partner)) npc.talk = null;
    this._nextAt = now + GAP_MIN + this.random() * (GAP_MAX - GAP_MIN);
  }

  /** Cede el canal: la reclama quien habla más fuerte (el reclamo por robo). */
  cancel() { this._end(); }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this._end();
  }

  clear() {
    this._end();
    this._convAt.clear();
    this._nextAt = 0;
  }
}
