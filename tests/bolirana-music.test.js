import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBoliranaMusic } from '../src/ui/BoliranaMusic.js';
class FakeAudio {
  constructor(src) {
    this.src = src;
    this.paused = true;
    FakeAudio.latest = this;
  }
  play() {
    this.paused = false;
    this.plays = (this.plays ?? 0) + 1;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = '';
  }
  load() {}
  remove() {
    this.removed = true;
  }
}
function setup() {
  const events = new EventTarget(),
    doc = new EventTarget();
  doc.hidden = false;
  doc.body = { append() {} };
  let tick,
    cancelled = false;
  const game = { audio: { volume: 0.8, muted: false, _level: () => 0.5 } };
  const stop = startBoliranaMusic(game, {
    source: '/audio/bolirana.mp3',
    AudioClass: FakeAudio,
    events,
    doc,
    schedule: (f) => {
      tick = f;
      return 1;
    },
    cancel: () => (cancelled = true)
  });
  return {
    game,
    events,
    doc,
    stop,
    music: FakeAudio.latest,
    tick: () => tick(),
    cancelled: () => cancelled
  };
}
test('La música se repite con volumen maestro × ambiente × local', () => {
  const t = setup();
  assert.equal(t.music.loop, true);
  assert.equal(t.music.paused, false);
  assert.ok(Math.abs(t.music.volume - 0.18) < 1e-10);
  assert.match(t.music.src, /bolirana.mp3$/);
  t.stop();
});
test('La música respeta silencio, volumen y mezcla ambiental', () => {
  const t = setup();
  t.game.audio.muted = true;
  t.events.dispatchEvent(new Event('audio-settings-change'));
  assert.equal(t.music.muted, true);
  t.game.audio.volume = 0.4;
  t.game.audio._level = () => 0.25;
  t.tick();
  assert.ok(Math.abs(t.music.volume - 0.045) < 1e-10);
  t.stop();
});
test('La música se pausa con la pestaña oculta y continúa desde la misma posición', async () => {
  const t = setup();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  t.doc.hidden = true;
  t.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(t.music.paused, true);
  t.doc.hidden = false;
  t.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(t.music.paused, false);
  t.stop();
});
test('Salir detiene la música y libera temporizadores y escuchas una sola vez', () => {
  const t = setup();
  t.stop();
  t.stop();
  assert.equal(t.music.paused, true);
  assert.equal(t.music.src, '');
  assert.equal(t.music.removed, true);
  assert.equal(t.cancelled(), true);
  t.events.dispatchEvent(new Event('pointerdown'));
  t.tick();
  assert.equal(t.music.plays, 1);
});

test('La música es opcional y no realiza solicitudes sin una fuente autorizada', () => {
  let created = 0;
  const stop = startBoliranaMusic(
    {},
    {
      source: null,
      AudioClass: class {
        constructor() {
          created++;
        }
      }
    }
  );
  stop();
  assert.equal(created, 0);
});
