import { HORN_RANGE, HornMixer, hornAcoustics } from './HornAcoustics.js';
import { commitHonk, createDriver, hornPresses, updateDriver } from './HornBehavior.js';

const HEARING_DISTANCE = 55;
const MAX_NEARBY_VEHICLES = 8;
const MAX_HORN_VOICES = 4;
const RELEASE_SECONDS = .04;
// Un claxon sostenido se suelta y se presiona con rampas cortas para no chasquear.
const HOLD_RELEASE_SECONDS = .08;
const HOLD_ATTACK_SECONDS = .025;

/** Buffers compartidos; identificadores, mezcla y claxon independientes por vehículo. */
export class VehicleAudio {
  constructor(sounds, random = Math.random, driverSounds = [], { howler = null } = {}) {
    this.sounds = sounds;
    this.random = random;
    this.driverSounds = driverSounds;
    this.instances = new Map();
    this.paused = false;
    this.mixer = new HornMixer(howler);
    // Pitadas recientes en el radio audible; decae en unos segundos.
    this.hornActivity = 0;
  }

  _stopEngine(state) {
    for (const key of ['idle', 'drive']) {
      if (state[key]) state[key].sound.stop(state[key].id);
      state[key] = null;
    }
    state.idleVolume = state.driveVolume = 0;
  }

  _stopHorn(state) {
    if (state.horn?.id !== undefined) state.horn.sound.stop(state.horn.id);
    state.horn = null;
  }

  _stop(state) {
    this._stopEngine(state);
    this._stopHorn(state);
    if (state.remark) state.remark.sound.stop(state.remark.id);
    state.remark = null;
  }

  clear() {
    for (const state of this.instances.values()) this._stop(state);
    this.instances.clear();
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
      if (paused) this._stopHorn(state);
      if (paused && state.remark) { state.remark.sound.stop(state.remark.id); state.remark = null; }
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

  /** Cada pulsación reproduce el inicio de la pitada y se suelta con un desvanecimiento breve. */
  _updateHorn(state, entry, dt) {
    const horn = state.horn;
    horn.t += dt;
    if (horn.t < horn.delay) return;
    const t = horn.t - horn.delay;
    const press = horn.presses[horn.index];
    if (!press) {
      if (horn.id === undefined || t > horn.end + horn.release || !horn.sound.playing(horn.id)) this._stopHorn(state);
      return;
    }
    const [start, length, sprite = 'honk'] = press;
    if (t < start) return;
    const acoustics = hornAcoustics(entry.dx, entry.dy, entry.dz);
    const volume = state.hornLevel * acoustics.level;
    const held = sprite === 'hold';
    if (!horn.pressed) {
      if (horn.id !== undefined) horn.sound.stop(horn.id);
      horn.id = horn.sound.play(sprite);
      horn.pressed = true;
      horn.sound.rate(state.pitch * (entry.bus ? .82 : 1), horn.id);
      horn.route = this.mixer.route(horn.sound, horn.id);
      if (held && horn.sound.fade) { horn.sound.volume(0, horn.id); horn.sound.fade(0, volume, HOLD_ATTACK_SECONDS * 1000, horn.id); }
      if (horn.index === 0) this.hornActivity += 1;
    }
    if (t < start + length) {
      // Durante la rampa de entrada no se reescribe el volumen: cortaría el desvanecimiento.
      if (!held || t - start > HOLD_ATTACK_SECONDS || !horn.sound.fade) horn.sound.volume(volume, horn.id);
      this.mixer.apply(horn.route, acoustics);
      return;
    }
    horn.release = held ? HOLD_RELEASE_SECONDS : RELEASE_SECONDS;
    if (horn.sound.playing(horn.id)) {
      if (horn.sound.fade) horn.sound.fade(volume, 0, horn.release * 1000, horn.id);
      else horn.sound.stop(horn.id);
    }
    horn.end = start + length;
    horn.index++;
    horn.pressed = false;
  }

  _honk(state, entry, decision) {
    const sound = this.sounds[`horn${state.hornIndex + 1}`];
    if (sound?.state() !== 'loaded') return false;
    commitHonk(state, decision.reason, this.random, decision.hold ?? 0);
    if (entry.distance > HORN_RANGE) return true;
    const active = [...this.instances.values()].filter(other => other.horn).length;
    if (active >= MAX_HORN_VOICES) return true;
    this._stopHorn(state);
    // El sonido tarda en recorrer la calle; los retrasos menores a 30 ms no se perciben.
    const delay = entry.voiceDistance / 343 >= .03 ? entry.voiceDistance / 343 : 0;
    state.horn = { sound, presses: hornPresses(decision.pattern, this.random, decision.hold), index: 0, t: 0, delay, end: 0, pressed: false, release: RELEASE_SECONDS };
    this._updateHorn(state, entry, 0);
    if (['person', 'blocking', 'jaywalk', 'pedestrian'].includes(decision.reason) && !entry.bus && entry.voiceDistance < 8 && this.driverSounds.length) {
      const index = Math.min(this.driverSounds.length - 1, Math.floor(this.random() * this.driverSounds.length));
      const remark = this.driverSounds[index];
      if (remark.state() === 'loaded') {
        if (state.remark) state.remark.sound.stop(state.remark.id);
        state.remark = { sound: remark, id: remark.play() };
      }
    }
    return true;
  }

  update(dt, position, vehicles = [], bus = null) {
    const present = new Set(vehicles.map(vehicle => vehicle.car));
    const buses = [bus].flat().filter(Boolean);
    for (const vehicle of buses) present.add(vehicle);
    for (const [car, state] of this.instances) if (!present.has(car)) {
      this._stop(state); this.instances.delete(car);
    }
    if (this.paused) return;
    this.hornActivity *= Math.exp(-dt / 5);
    const entries = vehicles.map(vehicle => ({ source: vehicle, car: vehicle.car, bus: false }));
    for (const vehicle of buses) entries.push({ source: vehicle, car: vehicle, bus: true });
    for (const entry of entries) {
      entry.dx = entry.car.position.x - position.x; entry.dz = entry.car.position.z - position.z;
      entry.dy = entry.car.position.y - position.y;
      entry.distance = Math.hypot(entry.dx, entry.dz);
      entry.voiceDistance = Math.hypot(entry.dx, entry.dy, entry.dz);
    }
    // La visibilidad del render no determina si un vehículo se puede oír.
    const nearby = new Set(entries.filter(entry => entry.distance < HEARING_DISTANCE)
      .sort((a, b) => a.distance - b.distance).slice(0, MAX_NEARBY_VEHICLES).map(entry => entry.car));
    const crowded = this.hornActivity > 2.5;
    for (const entry of entries) {
      let state = this.instances.get(entry.car);
      if (!state) {
        state = { phase: this.random(), pitch: .96 + this.random() * .08, ...createDriver(this.random, entry.source),
          idleVolume: 0, driveVolume: 0 };
        this.instances.set(entry.car, state);
      }
      // Todos los conductores deciden, también los lejanos: sus pitadas forman el fondo de la ciudad.
      const decision = updateDriver(state, entry.source, dt, this.random, crowded);
      // Si la grabación aún no carga, la decisión se conserva para el siguiente cuadro.
      if (decision) this._honk(state, entry, decision);
      else if (state.horn) this._updateHorn(state, entry, dt);
      if (state.remark) {
        const { sound, id } = state.remark;
        if (!sound.playing(id)) state.remark = null;
        else sound.volume(.7 * Math.max(0, Math.min(1, (8 - entry.voiceDistance) / 6)), id);
      }
      if (!nearby.has(entry.car)) { this._stopEngine(state); continue; }
      const idle = this._loop(state, 'idle', this.sounds[entry.bus ? 'busIdle' : 'carIdle']);
      const drive = this._loop(state, 'drive', this.sounds[entry.bus ? 'busDrive' : 'carDrive']);
      const mix = Math.min(1, Math.max(0, entry.source.speed) / 2.5);
      const smoothing = 1 - Math.exp(-dt * 7);
      state.idleVolume += ((1 - mix) * (entry.bus ? .38 : .34) - state.idleVolume) * smoothing;
      state.driveVolume += (mix * (entry.bus ? .42 : .40) - state.driveVolume) * smoothing;
      for (const [voice, volume, rate] of [[idle, state.idleVolume, state.pitch],
        [drive, state.driveVolume, state.pitch * (.85 + Math.min(entry.source.speed, 5) * .065)]]) {
        if (!voice) continue;
        voice.sound.volume(volume, voice.id);
        voice.sound.rate(rate, voice.id);
      }
    }
  }
}
