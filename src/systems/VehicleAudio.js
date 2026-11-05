import { ShuffleBag, setPan, setRate, takeVariation, voicePan } from './voiceVariety.js';

const MAX_NEARBY_VEHICLES = 6;
// Atenuación por volumen, sin panners: pleno hasta NEAR y silencio en FAR.
const ENGINE_NEAR = 6, CAR_ENGINE_FAR = 40, BUS_ENGINE_FAR = 55;
const HORN_NEAR = 5, HORN_FAR = 30, HORN_VOLUME = .4;
const AMBIENT_HORN_FAR = 25, AMBIENT_HORN_VOLUME = .22, AMBIENT_HORN_GAP = 9;
// Presupuesto global: evita coros de pitos cuando varios carros esperan a la vez.
const MAX_ACTIVE_HORNS = 2, HORN_GAP = 1.5;
// Con más carros a la vista los pitos entre carros se siguen más de cerca, pero la ganancia total no sube.
const AMBIENT_HORN_GAP_MIN = 3.5, AMBIENT_HORN_CROWD_STEP = .6;
// Por encima de esta suma de ganancias los motores se compensan para no saturar.
const ENGINE_CROWD = 2;

export function distanceGain(distance, near, far) {
  const t = Math.max(0, Math.min(1, (far - distance) / (far - near)));
  return t * t;
}

/** Buffers compartidos; identificadores, mezcla y claxon independientes por vehículo. */
export class VehicleAudio {
  /** `driverVoices[i]` dice quién habla en `driverSounds[i]`; sin decirlo, todas son del mismo conductor. */
  constructor(sounds, random = Math.random, driverSounds = [], driverVoices = []) {
    this.sounds = sounds;
    this.random = random;
    this.driverSounds = driverSounds;
    this.driverVoices = driverSounds.map((_, index) => driverVoices[index] ?? 'conductor');
    // Cada carro conserva su conductor aunque salga y vuelva a entrar al grupo de los cercanos.
    this._driverOf = new WeakMap();
    this._remarkBags = new Map();
    this.camera = null;
    this.instances = new Map();
    this.paused = false;
    // Multiplicadores de la mezcla (volumen por categoría y atenuación mientras alguien habla).
    this.levels = { traffic: 1, voices: 1 };
    // Otra voz ajena a los conductores (p. ej. el reclamo por robo) que impide empezar frases.
    this.externalVoiceActive = () => false;
    this._hornClock = 0;
    this._lastHornAt = -Infinity;
    this._lastAmbientHornAt = -Infinity;
    this._ambientHorns = [];
    // Vistas reutilizadas: con la flota llena no se reserva memoria por vehículo en cada cuadro.
    this._pool = [];
    this._seen = new Set();
    this._nearby = new Set();
    this._order = [];
    this._byDistance = (a, b) => this._pool[a].distance - this._pool[b].distance;
    this._audible = 0;
  }

  /** El conductor de ese carro; el primero que lo pide (frase o robo) lo deja fijo. */
  driverVoice(car, preferred = null) {
    if (!this._driverOf.has(car)) {
      const voices = [...new Set(this.driverVoices)];
      const voice = preferred && voices.includes(preferred) ? preferred
        : voices[Math.min(voices.length - 1, Math.floor(this.random() * voices.length))];
      this._driverOf.set(car, voice ?? null);
    }
    return this._driverOf.get(car);
  }

  /** Siguiente frase de ese conductor: no repite ninguna hasta haber dicho todas las suyas. */
  _nextRemark(car) {
    const voice = this.driverVoice(car);
    let bag = this._remarkBags.get(voice);
    if (!bag) { bag = new ShuffleBag(() => this.random()); this._remarkBags.set(voice, bag); }
    const own = this.driverSounds.filter((_, index) => this.driverVoices[index] === voice);
    return bag.draw(own);
  }

  _activeHorns() {
    let count = 0;
    for (const state of this.instances.values()) {
      if (state.horn && state.horn.sound.playing(state.horn.id)) count++;
    }
    this._ambientHorns = this._ambientHorns.filter(voice => voice.sound.playing(voice.id));
    return count + this._ambientHorns.length;
  }

  _hornAllowed() {
    return this._hornClock - this._lastHornAt >= HORN_GAP && this._activeHorns() < MAX_ACTIVE_HORNS;
  }

  _startHorn(index, volume, rate) {
    const sound = this.sounds[`horn${index + 1}`];
    if (!sound || sound.state() !== 'loaded') return null;
    const id = sound.play('honk');
    // Cada pito que ya suena baja el suyo: el total no crece con la flota.
    sound.volume(volume / Math.sqrt(1 + this._activeHorns()), id);
    sound.rate(rate, id);
    this._lastHornAt = this._hornClock;
    return { sound, id };
  }

  /** Hay una frase de conductor sonando; con except se ignora la del propio carro. */
  remarkPlaying(except = null) {
    for (const state of this.instances.values()) {
      if (state !== except && state.remark && state.remark.sound.playing(state.remark.id)) return true;
    }
    return false;
  }

  stopRemarks() {
    for (const state of this.instances.values()) {
      if (state.remark) { state.remark.sound.stop(state.remark.id); state.remark = null; }
    }
  }

  /** Pitada de tráfico entre carros: rara, cercana y sujeta al mismo presupuesto. */
  ambientHonk(x, z, listener) {
    if (this.paused || !listener) return false;
    const distance = Math.hypot(x - listener.x, z - listener.z);
    // Donde hay más motores a la vista los pitos se siguen más de cerca, sin subir el techo de voces ni de ganancia.
    const gap = Math.max(AMBIENT_HORN_GAP_MIN, AMBIENT_HORN_GAP - this._audible * AMBIENT_HORN_CROWD_STEP);
    if (distance >= AMBIENT_HORN_FAR || this._hornClock - this._lastAmbientHornAt < gap || !this._hornAllowed()) return false;
    const voice = this._startHorn(Math.floor(this.random() * 3),
      AMBIENT_HORN_VOLUME * this.levels.traffic * distanceGain(distance, HORN_NEAR, AMBIENT_HORN_FAR), .94 + this.random() * .12);
    if (!voice) return false;
    this._lastAmbientHornAt = this._hornClock;
    this._ambientHorns.push(voice);
    return true;
  }

  _stop(state) {
    for (const key of ['idle', 'drive', 'horn', 'remark']) {
      if (state[key]) state[key].sound.stop(state[key].id);
      state[key] = null;
    }
    state.idleVolume = state.driveVolume = 0;
  }

  clear() {
    for (const state of this.instances.values()) this._stop(state);
    this.instances.clear();
    for (const voice of this._ambientHorns) voice.sound.stop(voice.id);
    this._ambientHorns = [];
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    for (const state of this.instances.values()) {
      for (const key of ['idle', 'drive']) {
        const voice = state[key];
        if (voice) paused ? voice.sound.pause(voice.id) : voice.sound.play(voice.id);
      }
      // Un claxon interrumpido por un menú no se repite al volver.
      if (paused && state.horn) { state.horn.sound.stop(state.horn.id); state.horn = null; }
      if (paused && state.remark) { state.remark.sound.stop(state.remark.id); state.remark = null; }
    }
    if (paused) {
      for (const voice of this._ambientHorns) voice.sound.stop(voice.id);
      this._ambientHorns = [];
    }
  }

  _loop(state, key, sound) {
    if (!state[key] && sound.state() === 'loaded') {
      const id = sound.play();
      state[key] = { sound, id };
      sound.volume(0, id);
      sound.seek(state.phase * sound.duration(), id);
    }
    return state[key];
  }

  /** Mete un vehículo en las voces del cuadro si se alcanza a oír. Devuelve el nuevo tope de la lista. */
  _offer(count, source, car, position, isBus) {
    const dx = car.position.x - position.x, dz = car.position.z - position.z;
    const voiceDistance = Math.hypot(dx, car.position.y - position.y, dz);
    if (voiceDistance > (isBus ? BUS_ENGINE_FAR : CAR_ENGINE_FAR)) return count;
    const entry = this._pool[count] ??= { source: null, car: null, bus: false, distance: 0, voiceDistance: 0, gain: 0 };
    entry.source = source; entry.car = car; entry.bus = isBus;
    entry.distance = Math.hypot(dx, dz);
    entry.voiceDistance = voiceDistance;
    this._seen.add(car);
    return count + 1;
  }

  update(dt, position, vehicles = [], bus = null) {
    const pool = this._pool, seen = this._seen;
    seen.clear();
    let count = 0;
    // Más allá del alcance del motor no hay voz ni claxon que mantener: la flota lejana no cuesta nada.
    for (const vehicle of vehicles) count = this._offer(count, vehicle, vehicle.car, position, false);
    if (bus) {
      if (Array.isArray(bus)) for (const vehicle of bus) count = this._offer(count, vehicle, vehicle, position, true);
      else count = this._offer(count, bus, bus, position, true);
    }
    // Sin entrada se calla y se olvida: el banco de voces sigue al tráfico que se oye, no a la flota entera.
    for (const [car, state] of this.instances) if (!seen.has(car)) {
      this._stop(state); this.instances.delete(car);
    }
    this._audible = count;
    if (this.paused) return;
    this._hornClock += dt;
    // La visibilidad del render no determina si un vehículo se puede oír.
    const nearby = this._nearby, order = this._order;
    nearby.clear();
    order.length = 0;
    for (let index = 0; index < count; index++) order.push(index);
    order.sort(this._byDistance);
    for (let index = 0; index < order.length && index < MAX_NEARBY_VEHICLES; index++) nearby.add(pool[order[index]].car);
    let crowd = 0;
    for (let index = 0; index < count; index++) {
      const entry = pool[index];
      entry.gain = distanceGain(entry.voiceDistance, ENGINE_NEAR, entry.bus ? BUS_ENGINE_FAR : CAR_ENGINE_FAR);
      if (nearby.has(entry.car)) crowd += entry.gain;
    }
    const crowdScale = crowd > ENGINE_CROWD ? Math.sqrt(ENGINE_CROWD / crowd) : 1;
    for (let index = 0; index < count; index++) {
      const entry = pool[index];
      let state = this.instances.get(entry.car);
      if (!state) {
        state = { phase: this.random(), pitch: .96 + this.random() * .08,
          hornIndex: Math.floor(this.random() * 3), patience: .7 + this.random() * .8,
          blockedFor: 0, cooldown: 0, remarkCooldown: 0, idleVolume: 0, driveVolume: 0 };
        this.instances.set(entry.car, state);
        if (!entry.bus && this.driverSounds.length) this.driverVoice(entry.car);
      }
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.remarkCooldown = Math.max(0, state.remarkCooldown - dt);
      state.blockedFor = entry.source.personBlocked ? state.blockedFor + dt : 0;
      if (!nearby.has(entry.car)) { this._stop(state); continue; }
      const idle = this._loop(state, 'idle', this.sounds[entry.bus ? 'busIdle' : 'carIdle']);
      const drive = this._loop(state, 'drive', this.sounds[entry.bus ? 'busDrive' : 'carDrive']);
      const mix = Math.min(1, Math.max(0, entry.source.speed) / 2.5);
      const smoothing = 1 - Math.exp(-dt * 7);
      const level = entry.gain * crowdScale * this.levels.traffic;
      state.idleVolume += ((1 - mix) * (entry.bus ? .38 : .34) * level - state.idleVolume) * smoothing;
      state.driveVolume += (mix * (entry.bus ? .42 : .40) * level - state.driveVolume) * smoothing;
      for (const [voice, volume, rate] of [[idle, state.idleVolume, state.pitch],
        [drive, state.driveVolume, state.pitch * (.85 + Math.min(entry.source.speed, 5) * .065)]]) {
        if (!voice) continue;
        voice.sound.volume(volume, voice.id);
        voice.sound.rate(rate, voice.id);
      }
      // Fuera del alcance del claxon el conductor espera sin pitar; sigue pudiendo hacerlo al acercarse.
      if (state.blockedFor >= state.patience && state.cooldown === 0 && entry.voiceDistance < HORN_FAR && this._hornAllowed()) {
        if (state.horn) state.horn.sound.stop(state.horn.id);
        const horn = this._startHorn(state.hornIndex, HORN_VOLUME * this.levels.traffic * distanceGain(entry.voiceDistance, HORN_NEAR, HORN_FAR), state.pitch);
        if (horn) {
          state.horn = horn;
          state.cooldown = 6 + this.random() * 5;
        }
      }
      // La frase no depende del claxon: este puede no estar cargado o el presupuesto estar ocupado.
      if (!entry.bus && entry.source.personBlocked && state.blockedFor >= state.patience && state.remarkCooldown === 0
        && entry.voiceDistance < 8 && this.driverSounds.length
        && !state.remark && !this.remarkPlaying(state) && !this.externalVoiceActive()) {
        const remark = this._nextRemark(entry.car);
        if (remark?.state() === 'loaded') {
          if (state.remark) state.remark.sound.stop(state.remark.id);
          const { rate, gain } = takeVariation(this.random);
          state.remark = { sound: remark, id: remark.play(), gain };
          setRate(remark, rate, state.remark.id);
          state.remarkCooldown = 6 + this.random() * 5;
        }
      }
      if (state.remark) {
        const { sound, id, gain = 1 } = state.remark;
        if (!sound.playing(id)) state.remark = null;
        else {
          sound.volume(.7 * gain * this.levels.voices * Math.max(0, Math.min(1, (8 - entry.voiceDistance) / 6)), id);
          setPan(sound, voicePan(position, this.camera, entry.car.position), id);
        }
      }
    }
  }
}
