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
  outputs: [], gain: param(), playbackRate: param(), frequency:param(),detune:param(),Q:param(),
  positionX: param(), positionY: param(), positionZ: param(),
  orientationX: param(), orientationY: param(), orientationZ: param(),
  connect(node) { this.outputs.push(node); return node; },
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
  createBiquadFilter() { return audioNode(); }
  createPanner() { return audioNode(); }
  createBufferSource() { return audioNode(); }
  createBuffer(channels, length, rate) {
    const samples=Array.from({length:channels},()=>new Float32Array(length));
    return {duration:length/rate,getChannelData:channel=>samples[channel]};
  }
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

test('Howler real mezcla motores sintetizados sin grabaciones duplicadas ni panners', async () => {
  const { Howl, Howler } = realHowler();
  const audio = new AudioSystem({ HowlClass: Howl, howler: Howler, eventTarget: null });
  try {
    await audio.ready;
    const listener=new THREE.Vector3(112,0,94),camera=new THREE.PerspectiveCamera();
    const vehicle={car:{position:new THREE.Vector3(112,0,97),group:new THREE.Group()},speed:4,acceleration:1};
    const bus={position:new THREE.Vector3(116,0,98),group:new THREE.Group(),speed:4};
    audio.updateWorld(.1,listener,camera,[vehicle],bus);
    assert.equal(audio.motorAudio.voices.size,2);
    assert.equal(audio.vehicles.instances.get(vehicle.car).idle,undefined);
    for(const state of audio.motorAudio.voices.values()){
      assert.equal(state.output.outputs[0],Howler.masterGain);
      assert.ok(state.output.gain.value>0);
      assert.equal(state.output._panner,undefined);
    }
    const source=audio.motorAudio.voices.get(vehicle.car);
    const trafficGain=source.output.gain.value;vehicle.car.controller='player';audio.updateWorld(.1,listener,camera,[vehicle],bus);
    assert.ok(Math.abs(source.output.gain.value/trafficGain-1.3)<1e-6,'el carro que se conduce suena un 30 % más');delete vehicle.car.controller;
    vehicle.speed=0;audio.updateWorld(.1,listener,camera,[vehicle],bus);
    assert.equal(audio.motorAudio.voices.get(vehicle.car),source);
    audio.setPaused(true);assert.equal(audio.motorAudio.voices.size,0);
    audio.updateWorld(.1,listener,camera,[vehicle],bus);assert.equal(audio.motorAudio.voices.size,2);
    audio.honkPlayer(vehicle.car);assert.ok(audio.motorAudio.horn.getChannelData(0).some(x=>x!==0));
    audio.startEngine(vehicle.car);assert.ok(audio.motorAudio.starterBuffer.getChannelData(0).some(x=>x!==0),'subir al carro suena el arranque');
    vehicle.car.position.x=500;audio.updateWorld(.1,listener,camera,[vehicle],bus);assert.equal(audio.motorAudio.voices.size,1);
    assert.equal(Howler.ctx.listener.positionX.value,0);
    assert.equal(Howler.ctx.listener.positionZ.value,0);
  } finally {audio.dispose();}
});