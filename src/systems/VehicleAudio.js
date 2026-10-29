const MAX_NEARBY_VEHICLES = 6;
// Atenuación por volumen, sin panners: pleno hasta NEAR y silencio en FAR.
const ENGINE_NEAR = 6, CAR_ENGINE_FAR = 40, BUS_ENGINE_FAR = 55;
const HORN_NEAR = 5, HORN_FAR = 30, HORN_VOLUME = .4;
const AMBIENT_HORN_FAR = 25, AMBIENT_HORN_VOLUME = .22, AMBIENT_HORN_GAP = 9;
// Presupuesto global: evita coros de pitos cuando varios carros esperan a la vez.
const MAX_ACTIVE_HORNS = 2, HORN_GAP = 1.5;
// Por encima de esta suma de ganancias los motores se compensan para no saturar.
const ENGINE_CROWD = 2;

export function distanceGain(distance, near, far) {
  const t = Math.max(0, Math.min(1, (far - distance) / (far - near)));
  return t * t;
}

/** Buffers compartidos; identificadores, mezcla y claxon independientes por vehículo. */
export class VehicleAudio {
  constructor(sounds, random = Math.random, driverSounds = []) {
    this.sounds = sounds;
    this.random = random;
    this.driverSounds = driverSounds;
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
    sound.volume(volume, id);
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
    if (distance >= AMBIENT_HORN_FAR || this._hornClock - this._lastAmbientHornAt < AMBIENT_HORN_GAP || !this._hornAllowed()) return false;
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

  update(dt, position, vehicles = [], bus = null) {
    const present = new Set(vehicles.map(vehicle => vehicle.car));
    const buses = [bus].flat().filter(Boolean);
    for (const vehicle of buses) present.add(vehicle);
    for (const [car, state] of this.instances) if (!present.has(car)) {
      this._stop(state); this.instances.delete(car);
    }
    if (this.paused) return;
    this._hornClock += dt;
    const entries = vehicles.map(vehicle => ({ source: vehicle, car: vehicle.car, bus: false }));
    for (const vehicle of buses) entries.push({ source: vehicle, car: vehicle, bus: true });
    for (const entry of entries) {
      const dx = entry.car.position.x - position.x, dz = entry.car.position.z - position.z;
      entry.distance = Math.hypot(dx, dz);
      entry.voiceDistance = Math.hypot(dx, entry.car.position.y - position.y, dz);
    }
    // La visibilidad del render no determina si un vehículo se puede oír.
    const nearby = new Set(entries.filter(entry => entry.voiceDistance < (entry.bus ? BUS_ENGINE_FAR : CAR_ENGINE_FAR))
      .sort((a, b) => a.distance - b.distance).slice(0, MAX_NEARBY_VEHICLES).map(entry => entry.car));
    let crowd = 0;
    for (const entry of entries) {
      entry.gain = distanceGain(entry.voiceDistance, ENGINE_NEAR, entry.bus ? BUS_ENGINE_FAR : CAR_ENGINE_FAR);
      if (nearby.has(entry.car)) crowd += entry.gain;
    }
    const crowdScale = crowd > ENGINE_CROWD ? Math.sqrt(ENGINE_CROWD / crowd) : 1;
    for (const entry of entries) {
      let state = this.instances.get(entry.car);
      if (!state) {
        state = { phase: this.random(), pitch: .96 + this.random() * .08,
          hornIndex: Math.floor(this.random() * 3), patience: .7 + this.random() * .8,
          blockedFor: 0, cooldown: 0, idleVolume: 0, driveVolume: 0 };
        this.instances.set(entry.car, state);
      }
      state.cooldown = Math.max(0, state.cooldown - dt);
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
          // Una sola voz a la vez: si otro conductor o el reclamo por robo ya hablan, solo pita.
          if (!entry.bus && entry.voiceDistance < 8 && this.driverSounds.length
            && !this.remarkPlaying(state) && !this.externalVoiceActive()) {
            const index = Math.min(this.driverSounds.length - 1, Math.floor(this.random() * this.driverSounds.length));
            const remark = this.driverSounds[index];
            if (remark.state() === 'loaded') {
              if (state.remark) state.remark.sound.stop(state.remark.id);
              state.remark = { sound: remark, id: remark.play() };
            }
          }
          state.cooldown = 6 + this.random() * 5;
        }
      }
      if (state.remark) {
        const { sound, id } = state.remark;
        if (!sound.playing(id)) state.remark = null;
        else sound.volume(.7 * this.levels.voices * Math.max(0, Math.min(1, (8 - entry.voiceDistance) / 6)), id);
      }
    }
  }
}
