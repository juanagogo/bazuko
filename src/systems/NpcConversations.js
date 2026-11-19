// src/systems/NpcConversations.js
// Dos peatones que ya están juntos en el andén se ponen a conversar: se acercan a distancia de charla, se miran,
// quien habla gesticula y quien escucha espera a su manera. Suena el intérprete asignado y se oye como
// una charla ajena: clara al lado, un murmullo a pocos metros.
import { LOW_STANCES } from '../character/archetypes.js';
import { CONVERSATION_FLOOR_GAP, canFace, conversationPath, findPasser, onSidewalk, passageSpot } from '../entities/npc/conversationSpace.js';
import { npcSexo, voiceGain } from './StreetVoices.js';
import { RepartoVocal, puedeHablar } from './voces/identidad.js';
import { setPan, voicePan } from './voiceVariety.js';

// Dos personas hablando entre ellas, no hacia el jugador: claras al lado, un murmullo a 6-8 m y nada a 12.
const RANGE = 12, FULL = 2;               // metros: pleno hasta FULL, mudo desde RANGE
const VOLUME = .6;                        // por debajo de los conductores (.7) y el robo (.75)
const START_RANGE = 8;                    // solo empieza si el jugador está cerca de la pareja
const PAIR_MAX = 3.5;                     // metros entre los dos para que se pongan a hablar
const TALK_DISTANCE = 1.1;                // metros entre los dos ya conversando, de frente
const SETTLED_DISTANCE = 2.2;             // si el andén no los deja acercarse más, todavía se oyen de cerca
const GAP_MIN = 35000, GAP_MAX = 70000;   // ms entre conversación y conversación
const CONVERSATION_COOLDOWN = 8 * 60000;  // ms antes de repetir la misma conversación
const NPC_COOLDOWN = 3 * 60000;           // ms antes de que la misma persona vuelva a conversar
const TURN_GAP = 350;                     // ms entre un turno y el siguiente
const QUESTION_GAP = 500;                 // una pregunta deja un momento para contestar
const FIRST_PAUSE = 450;                  // ms ya frente a frente antes de la primera frase
const SETTLE_TIMEOUT = 5000;              // ms para llegar a su sitio y tener los audios; si no, desiste
const RETRY = 2000;                       // sin pareja posible, no vuelve a buscar cada cuadro
const PASS_CLEAR = 550;                  // ms con el paso libre antes de retomar la frase
const PASS_TIMEOUT = 4000;               // ms esperando que el paso se despeje
// Cómo espera quien escucha. Quien carga algo no cruza los brazos ni gesticula: tiene las manos ocupadas.
const LISTEN_STANCES = ['brazos-cruzados', 'cambiar-peso', 'bolsillos', 'manos-atras'];
const SPEAK_STANCE = 'hablar';
// Con la vista o las manos en otra cosa no se pone a conversar.
const BUSY_STANCES = new Set(['telefono', 'celular', 'fumar-quieto', 'atender', 'nariz', 'huir']);

/** Edad de una persona, con la misma fuente que su sexo. */
export function npcEdad(npc) {
  return npc?.look?.real?.edad ?? npc?.person?.real?.edad ?? null;
}

/** Puede mantener una charla de pie, sin descuidar su puesto, el cruce ni lo que haya llamado su atención. */
function available(npc) {
  if (!npc?.person || !puedeHablar(npc) || npc.deathResponse || npc.isVendor || npc.fijo?.out) return false;
  if (npc.walkVisit?.stance === 'atender' && npc.wait > 0 && npc._atVisit()) return false;
  if (npc.fleeTimer > 0 || npc.panicTimer > 0 || npc.staggerTimer > 0 || npc._riseLeft > 0 || npc._counter || npc.action || npc._witness || npc.witnessing) return false;
  if (npc.mind?.busy?.() || npc.mind?.asideLeft > 0) return false;
  if (LOW_STANCES.has(npc.stance) || BUSY_STANCES.has(npc.stance)) return false;
  // Nunca en la calzada ni en un cruce: parados ahí frenan a los carros.
  if (!npc.fijo?.pareja) return onSidewalk(npc);
  const node = npc.navigation?.nodeAt?.(npc.position.x, npc.position.z);
  return !npc.navigation?.nodes?.[node]?.crossing;
}

const roleMatches = (npc, role) => npcSexo(npc) === role.sexo && (!role.arquetipo || npc.person.arquetipo === role.arquetipo);

function contextScore({ contexto }, context, point) {
  if (!contexto || !context) return 0;
  let score = 0;
  for (const key of ['lluvia', 'noche']) {
    if (contexto[key] === undefined || context[key] === undefined) continue;
    if (contexto[key] !== context[key]) return -Infinity;
    score += 1.5;
  }
  if (contexto.lugar && context.sitioCerca) {
    if (!context.sitioCerca(contexto.lugar, point)) return -Infinity;
    score += 1.5;
  }
  return score;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const fixedPair = (a, b) => a.fijo?.pareja === b || b.fijo?.pareja === a;

export class NpcConversations {
  /**
   * @param {{ conversations: Array<{ id: string, hablantes: Record<string, { sexo: string, edad?: string, arquetipo?: string }>,
   *   contexto?: { lluvia?: boolean, noche?: boolean, lugar?: string, parejaFija?: boolean },
   *   lineas: Array<{ hablante: string, texto: string, file: string }> }>,
   *   load: (file: string, isCurrent: () => boolean) => object, random?: () => number }} options
   */
  constructor({ conversations = [], load, random = Math.random, reparto = new RepartoVocal() } = {}) {
    this.conversations = conversations;
    this.load = load;
    this.random = random;
    this.reparto = reparto;
    this.camera = null;
    this.levels = { voices: 1 };
    // Otra voz en curso (robo, conductor o frase de la calle) impide empezar.
    this.externalVoiceActive = () => false;
    this.paused = false;
    this._npcAt = new WeakMap();
    this._convAt = new Map();
    this._nextAt = 0;
    this._current = null;
    this._player = { position: null, x: 0, z: 0, vx: 0, vz: 0, at: -Infinity };
  }

  /** Hay una conversación en curso, también mientras se acercan o entre turnos: el canal de voz sigue ocupado. */
  get busy() { return !!this._current; }

  /** Una línea sonando ahora mismo. */
  get active() {
    const line = this._current?.playing;
    return !!line?.sound && !line.paused && line.sound.playing(line.id);
  }

  /**
   * `now` es el reloj de la simulación en ms (AudioSystem lo avanza con el dt): con pocos cuadros por segundo la
   * gente camina más lento en tiempo real, y los plazos para llegar, los turnos y los enfriamientos se estiran igual.
   */
  update(position, pedestrians, now = performance.now(), context) {
    this._now = now;
    if (this.paused) return;
    if (!position) { this._end(now); return; }
    pedestrians ??= [];
    this._trackPlayer(position, now);
    const player = context?.jugador === false ? null : this._player;
    if (this._current) { this._advance(position, pedestrians, player, now); return; }
    if (now < this._nextAt || this.externalVoiceActive()) return;
    const chosen = this._pick(position, pedestrians, player, now, context);
    if (!chosen) { this._nextAt = now + RETRY; return; }
    this._start(chosen, now);
  }

  _trackPlayer(position, now) {
    const player = this._player, seconds = (now - player.at) / 1000;
    const dx = position.x - player.x, dz = position.z - player.z;
    // Un viaje rápido o un fotograma en pausa no anuncian que el jugador va corriendo hacia la pareja.
    const speed = seconds > 0 && seconds <= .25 ? Math.hypot(dx, dz) / seconds : Infinity;
    player.vx = speed <= 7 ? dx / seconds : 0;
    player.vz = speed <= 7 ? dz / seconds : 0;
    player.position = position;
    player.x = position.x;
    player.z = position.z;
    player.at = now;
  }

  /**
   * La pareja que más parece estar ya junta: cerca uno del otro, mejor si los dos están quietos y si la edad
   * coincide con la conversación. No la más cercana al jugador: dos que esperan juntas ganan a uno que pasa.
   */
  _pick(position, pedestrians, player, now, context) {
    const near = [];
    for (const npc of pedestrians ?? []) {
      if ((this._npcAt.get(npc) ?? -Infinity) > now || !available(npc) || npc.talk || npc._bubbleEl || !npcSexo(npc)) continue;
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
        if (apart < .48 || apart > PAIR_MAX) continue;
        if ((a.fijo?.pareja && a.fijo.pareja !== b) || (b.fijo?.pareja && b.fijo.pareja !== a)) continue;
        const paired = fixedPair(a, b);
        if (!canFace(a, b, paired) || findPasser(a, b, pedestrians, player, false)) continue;
        const fits = this._fitting(free, a, b, context);
        if (!fits.length) continue;
        const match = Math.max(...fits.map(f => f.score));
        const still = (a.moving ? 0 : 1) + (b.moving ? 0 : 1);
        // Una pareja fija ya estaba conversando con gestos: es la primera en ponerle voz.
        const score = (paired ? 3 : 0) + still * 1.5 + match - apart * .6;
        if (!best || score > best.score) best = { score, match, fits };
      }
    }
    if (!best) return null;
    const options = best.fits.filter(f => f.score === best.match);
    return options[Math.floor(this.random() * options.length)];
  }

  /** Conversaciones que esta pareja puede tener, con quién hace de cada hablante. */
  _fitting(conversations, a, b, context) {
    const fits = [];
    const paired = fixedPair(a, b);
    const point = { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2, z: (a.position.z + b.position.z) / 2 };
    for (const conversation of conversations) {
      if (conversation.contexto?.parejaFija && !paired) continue;
      const roles = Object.keys(conversation.hablantes);
      if (roles.length !== 2 || !conversation.lineas.length) continue;
      const contextual = contextScore(conversation, context, point);
      if (contextual === -Infinity) continue;
      const [r1, r2] = roles;
      const h1 = conversation.hablantes[r1], h2 = conversation.hablantes[r2];
      let fit = null;
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!roleMatches(x, h1) || !roleMatches(y, h2)) continue;
        const voces = Number(h1.voz === this.reparto.vozDe(x)) + Number(h2.voz === this.reparto.vozDe(y));
        const score = contextual + voces * 2 + (npcEdad(x) === h1.edad ? 1 : 0) + (npcEdad(y) === h2.edad ? 1 : 0);
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
      return conversationPath(npc, point) ? point : null;
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
    const people = Object.values(roles);
    const [a, b] = people;
    const [spotA, spotB] = this._spots(a, b);
    const current = { conversation, roles, people, sounds: [], index: -1, playing: null, settling: true, deadline: now + SETTLE_TIMEOUT };
    current.leave = () => { if (this._current === current) this._end(); };
    this._current = current;
    const isCurrent = () => this._current === current;
    for (const line of conversation.lineas) {
      const voz = conversation.hablantes[line.hablante].voz;
      const propia = voz && voz === this.reparto.vozDe(roles[line.hablante]);
      current.sounds.push(propia && line.file ? this.load?.(line.file, isCurrent) : null);
    }
    for (const [npc, partner, spot] of [[a, b, spotA], [b, a, spotB]]) {
      const listen = this._listenStance(npc);
      npc.talk = { partner, spot, ready: !spot, listen, stance: listen, leave: current.leave, yielding: false, attention: null, nod: 0 };
    }
    this._convAt.set(conversation.id, now + CONVERSATION_COOLDOWN);
    for (const npc of people) this._npcAt.set(npc, now + NPC_COOLDOWN);
  }

  _advance(position, pedestrians, player, now) {
    const current = this._current;
    const [a, b] = current.people;
    // Un susto, un golpe, una voz prioritaria o que desaparezca uno de los dos cortan la charla.
    const together = current.people.every(npc => pedestrians.includes(npc) && npc.talk?.leave === current.leave && available(npc));
    if (!together || this.externalVoiceActive()) { this._end(now); return; }
    const heard = current.people.some(npc => distance(npc.position, position) <= RANGE);
    if (!heard || flat(a.position, b.position) > PAIR_MAX || Math.abs(a.position.y - b.position.y) > CONVERSATION_FLOOR_GAP) { this._end(now); return; }

    const line = current.playing;
    if (line && !line.paused && (line.sound ? !line.sound.playing(line.id) : now >= line.until)) this._finishLine(now);
    const passer = findPasser(a, b, pedestrians, player, !!current.passage);
    if (passer || current.passage) { this._giveWay(passer, now); return; }

    if (current.settling) {
      if (a.talk.blocked || b.talk.blocked) { this._end(now); return; }
      const loaded = current.sounds.every(sound => !sound || sound.loadFailed || sound.state() === 'loaded');
      const arrived = current.people.every(npc => npc.talk.ready);
      if (!arrived || (!loaded && now < current.deadline)) {
        if (!arrived && now > current.deadline) this._end(now);
        return;
      }
      if (flat(a.position, b.position) > SETTLED_DISTANCE || !canFace(a, b, fixedPair(a, b))) { this._end(now); return; }
      current.settling = false;
      current.waitUntil = now + FIRST_PAUSE;
    }
    if (current.reaction) {
      const { npc, start, strength } = current.reaction;
      const part = Math.min(1, (now - start) / (current.waitUntil - start));
      npc.talk.nod = Math.sin(Math.PI * part) ** 2 * strength;
      if (part >= 1) { npc.talk.nod = 0; current.reaction = null; }
    }
    if (current.playing) {
      if (!current.playing.paused) { this._setLineVolume(current.playing, position); return; }
      if (now >= current.waitUntil) this._resumeLine(current.playing, position);
      return;
    }
    if (now < current.waitUntil) return;
    if (current.index + 1 >= current.conversation.lineas.length) { this._end(now); return; }
    this._playLine(++current.index, position);
  }

  /** La persona de paso se gana una mirada y espacio. Si se queda en medio, cada uno sigue con lo suyo. */
  _giveWay(passer, now) {
    const current = this._current;
    if (!current.passage) {
      current.passage = { until: now + PASS_TIMEOUT, clearAfter: now + PASS_CLEAR, started: now };
      const [a, b] = current.people;
      const spots = [passageSpot(a, b), passageSpot(b, a)];
      const line = current.playing;
      if (line && !line.sound) {
        line.remaining = Math.max(0, line.until - now);
        line.paused = true;
        line.npc.callar?.(line.text);
      } else if (line?.sound?.pause) {
        line.sound.pause(line.id);
        line.paused = true;
        line.npc.callar?.(line.text);
      } else if (line) {
        line.sound.stop(line.id);
        this._finishLine(now);
      }
      current.reaction = null;
      current.people.forEach((npc, i) => {
        const talk = npc.talk;
        talk.spot = spots[i];
        talk.ready = !talk.spot;
        talk.blocked = false;
        talk.yielding = true;
        talk.stance = talk.listen;
        talk.nod = 0;
      });
    }
    const passage = current.passage;
    if (now >= passage.until) { this._end(now); return; }
    if (passer) passage.clearAfter = now + PASS_CLEAR;
    for (const npc of current.people) npc.talk.attention = passer;
    if (now < passage.clearAfter || !current.people.every(npc => npc.talk.ready)) return;

    const [a, b] = current.people;
    if (!canFace(a, b, fixedPair(a, b))) { this._end(now); return; }
    if (current.settling) {
      const [spotA, spotB] = this._spots(a, b);
      a.talk.spot = spotA; a.talk.ready = !spotA;
      b.talk.spot = spotB; b.talk.ready = !spotB;
      current.deadline += now - passage.started;
    }
    for (const npc of current.people) npc.talk.yielding = false;
    current.passage = null;
    current.waitUntil = now;
  }

  _finishLine(now) {
    const current = this._current;
    const { npc, text } = current.playing;
    npc.callar?.(text);
    npc.talk.stance = npc.talk.listen;
    current.playing = null;
    const question = /[¿?]/.test(text);
    current.waitUntil = now + (question ? QUESTION_GAP : TURN_GAP);
    current.reaction = { npc: npc.talk.partner, start: now, strength: question ? .09 : .13 };
  }

  _playLine(index, position) {
    const current = this._current;
    const data = current.conversation.lineas[index];
    const npc = current.roles[data.hablante];
    const voz = current.conversation.hablantes[data.hablante].voz;
    const toma = current.sounds[index];
    const sound = toma?.state() === 'loaded' && !toma.loadFailed && this.reparto.disponible(npc, voz) ? toma : null;
    const id = sound?.play();
    if (sound) this.reparto.registrar(npc, voz);
    current.playing = { sound, id, npc, text: data.texto, paused: false,
      remaining: Math.min(6000, Math.max(1500, 650 + data.texto.length * 55)) };
    this._showLine(current.playing, position);
  }

  _resumeLine(line, position) {
    line.sound?.play(line.id);
    line.paused = false;
    this._showLine(line, position);
  }

  _showLine(line, position) {
    const { npc, sound, id, text } = line;
    this._setLineVolume(line, position);
    if (!npc.person?.style?.carry) npc.talk.stance = SPEAK_STANCE;
    if (sound) {
      const offset = sound.seek?.(id);
      const remaining = (sound.duration() || 2) - (Number.isFinite(offset) ? offset : 0);
      npc.say?.(text, Math.max(.5, remaining + .4));
    } else {
      line.until = this._now + line.remaining;
      npc.say?.(text, line.remaining / 1000 + .1);
    }
  }

  _setLineVolume(line, position) {
    if (!line.sound) return;
    line.sound.volume(this._volume(line.npc, position), line.id);
    setPan(line.sound, voicePan(position, this.camera, line.npc.position), line.id);
  }
  _volume(npc, position) { return VOLUME * this.levels.voices * voiceGain(distance(npc.position, position), FULL, RANGE); }

  _end(now = this._now ?? 0) {
    const current = this._current;
    if (!current) return;
    this._current = null;
    if (current.playing) {
      const { sound, id, npc, text } = current.playing;
      sound?.stop(id);
      npc.callar?.(text);
    }
    for (const sound of current.sounds) sound?.unload?.();
    // Cada uno sigue con lo suyo: quien iba de camino retoma su ruta.
    for (const npc of current.people) if (npc.talk?.leave === current.leave) npc.talk = null;
    this._nextAt = now + GAP_MIN + this.random() * (GAP_MAX - GAP_MIN);
  }

  /** Cede el canal: la reclama quien habla más fuerte (el reclamo por robo). */
  cancel(npc = null) {
    if (!npc || this._current?.people.includes(npc)) this._end();
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) { this._end(); this._player.at = -Infinity; }
  }

  clear() {
    this._end();
    this._convAt.clear();
    this._npcAt = new WeakMap();
    this._player.at = -Infinity;
    this._nextAt = 0;
  }
}
