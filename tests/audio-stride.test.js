import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioSystem } from '../src/systems/AudioSystem.js';

class SilentHowl {
  constructor() { this.voices = new Map(); this.starts = 0; }
  state() { return 'loaded'; }
  play(sprite) { const id = ++SilentHowl.next; this.voices.set(id, { sprite }); this.starts++; return id; }
  playing() { return false; }
  pause() {}
  stop() {}
  pos() {}
  volume() {}
  rate() {}
  seek() {}
  duration() { return 7.8; }
  unload() {}
}
SilentHowl.next = 0;

test('hay una pisada por cada paso del clip: 1,25 m andando y 1,45 m corriendo', () => {
  const audio = new AudioSystem({ HowlClass: SilentHowl, howler: { volume() {}, pos() {}, orientation() {} } });
  const steps = audio.sounds.steps;
  const count = (running, metres) => {
    audio.updateSteps(false, running);
    const before = steps.starts;
    for (let walked = 0; walked < metres; walked += .05) audio.updateSteps(true, running, 'sidewalk', false, .05);
    return steps.starts - before;
  };
  assert.equal(count(false, 50), 40, 'pisadas en 50 m andando');
  assert.equal(count(true, 58), 40, 'pisadas en 58 m corriendo');
  audio.dispose();
});
