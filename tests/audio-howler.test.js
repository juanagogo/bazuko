import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { audioMetadata } from './helpers/audio-file.js';

// Ejecuta Howler real, incluida su extensión espacial. Solo se sustituye
// la interfaz del dispositivo: así detectamos opciones ignoradas por la librería.
const param = () => ({
  value: 0,
  setValueAtTime(value) { this.value = value; },
  setTargetAtTime(value) { this.value = value; },
  cancelScheduledValues() {}
});
const audioNode = () => ({
  outputs: [], gain: param(), playbackRate: param(),
  positionX: param(), positionY: param(), positionZ: param(),
  orientationX: param(), orientationY: param(), orientationZ: param(),
  connect(node) { this.outputs.push(node); },
  disconnect() { this.outputs = []; },
  start(...args) { this.started = args; },
  stop() {}
});
class Context {
  constructor() {
    this.currentTime = 0; this.state = 'running'; this.sampleRate = 48000;
    this.destination = audioNode();
    this.listener = Object.fromEntries(['positionX', 'positionY', 'positionZ',
      'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(key => [key, param()]));
  }
  createGain() { return audioNode(); }
  createPanner() { return audioNode(); }
  createBufferSource() { return audioNode(); }
  createBuffer() { return {}; }
  decodeAudioData(bytes, done) {
    const { duration } = audioMetadata(Buffer.from(bytes));
    setTimeout(() => done({ duration }), 0);
  }
  resume() { return Promise.resolve(); }
  close() {}
}
class LocalXHR {
  open(method, url) { this.url = url; }
  send() {
    const bytes = readFileSync(new URL(`../public${this.url}`, import.meta.url));
    this.status = 200;
    this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    setTimeout(() => this.onload(), 0);
  }
}
function realHowler() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    AudioContext: Context, XMLHttpRequest: LocalXHR,
    Audio: class { canPlayType() { return 'probably'; } },
    navigator: { vendor: '', userAgent: 'Node', platform: 'Windows', appVersion: '' },
    location: { protocol: 'http:' }
  };
  sandbox.global = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../node_modules/howler/dist/howler.js', import.meta.url), 'utf8'), sandbox);
  sandbox.Howler.autoUnlock = false; sandbox.Howler.autoSuspend = false;
  return sandbox;
}

test('Howler real reproduce motores y claxones normales conectados a la salida sin panner', async () => {
  const { Howl, Howler } = realHowler();
  const audio = new AudioSystem({ HowlClass: Howl, howler: Howler, eventTarget: null });
  try {
    await audio.ready;
    audio.vehicles.random = () => .5;
    const vehicle = { car: { position: new THREE.Vector3(112, 0, 97), group: new THREE.Group() }, speed: 0, personBlocked: true };
    const bus = { position: new THREE.Vector3(116, 0, 98), group: new THREE.Group(), speed: 4, personBlocked: false };
    const listener = new THREE.Vector3(112, 0, 94), camera = new THREE.PerspectiveCamera();
    for (let frame = 0; frame < 20; frame++) audio.updateWorld(.1, listener, camera, [vehicle], bus);
    const carState = audio.vehicles.instances.get(vehicle.car), busState = audio.vehicles.instances.get(bus);
    // La frase del conductor bloqueado atenúa el tráfico; los umbrales siguen ese nivel.
    const traffic = () => audio.vehicles.levels.traffic;
    assert.ok(carState.remark && traffic() < 1);
    assert.equal(audio.loadErrors.size, 0);
    assert.equal(carState.idle.sound._src, '/audio/car_idling_at_a_traf.opus');
    assert.ok(carState.idle.sound._soundById(carState.idle.id)._node.gain.value > .30 * traffic());
    assert.equal(busState.drive.sound._src, '/audio/bus_vehicle_drivin.opus');
    assert.ok(Math.abs(busState.drive.sound._soundById(busState.drive.id)._node.gain.value - .42 * traffic()) < .02);
    const voices = [carState.idle, busState.drive, carState.horn];
    vehicle.speed = 4; bus.speed = 0;
    for (let frame = 0; frame < 20; frame++) audio.updateWorld(.1, listener, camera, [vehicle], bus);
    voices.push(carState.drive, busState.idle);
    assert.equal(carState.drive.sound._src, '/audio/small_vehicle_drivin.opus');
    assert.equal(busState.idle.sound._src, '/audio/car_idling_at_a_traf_bus.opus');
    assert.ok(carState.drive.sound._soundById(carState.drive.id)._node.gain.value > .35 * traffic());
    assert.ok(busState.idle.sound._soundById(busState.idle.id)._node.gain.value > .35 * traffic());
    assert.ok(busState.drive.sound._soundById(busState.drive.id)._node.gain.value < .001);
    const idleId = carState.idle.id, busIdleId = busState.idle.id;
    vehicle.speed = 0;
    for (let frame = 0; frame < 20; frame++) audio.updateWorld(.1, listener, camera, [vehicle], bus);
    assert.equal(carState.idle.id, idleId, 'Al detenerse debe conservar el bucle de ralentí');
    assert.equal(busState.idle.id, busIdleId);
    assert.ok(carState.idle.sound.playing(idleId));
    assert.ok(carState.idle.sound._soundById(idleId)._node.gain.value > .30 * traffic());
    vehicle.speed = 4;
    for (let frame = 0; frame < 20; frame++) audio.updateWorld(.1, listener, camera, [vehicle], bus);
    for (const hornIndex of [0, 2]) {
      carState.hornIndex = hornIndex; carState.cooldown = 0;
      audio.updateWorld(.1, listener, camera, [vehicle], bus);
      voices.push(carState.horn);
    }
    for (const { sound, id } of voices) {
      // Los claxones anteriores pudieron terminar; su configuración se conserva.
      const actual = sound._soundById(id);
      assert.equal(actual._panner, undefined);
      assert.equal(actual._node.outputs[0], Howler.masterGain);
      assert.equal(Howler.masterGain.outputs[0], Howler.ctx.destination);
    }
    for (const voice of [carState.drive, busState.idle, carState.horn]) {
      const actual = voice.sound._soundById(voice.id);
      assert.equal(voice.sound.playing(voice.id), true);
      assert.ok(actual._node.gain.value > .05);
      assert.ok(actual._node.bufferSource.started);
      assert.equal(actual._node.bufferSource.outputs[0], actual._node);
    }
    assert.equal(Howler.ctx.listener.positionX.value, 0);
    assert.equal(Howler.ctx.listener.positionZ.value, 0);
  } finally { audio.dispose(); }
});
