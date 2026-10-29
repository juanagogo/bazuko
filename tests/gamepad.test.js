import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInput } from '../src/core/Gamepad.js';
import { Input } from '../src/core/Input.js';

function fakePad({ axes = [0, 0, 0, 0], pressed = [] } = {}) {
  const buttons = Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0 }));
  return { index: 0, axes, buttons };
}

test('el mando traduce botones a teclas una sola vez por pulsación y los sticks respetan la zona muerta', () => {
  const events = [];
  globalThis.KeyboardEvent = class { constructor(type, init) { Object.assign(this, init, { type }); } };
  globalThis.document = { body: { dispatchEvent: event => events.push(`${event.type}:${event.code}`) } };
  let pad = fakePad({ axes: [0.1, -0.1, 1, 0], pressed: [0, 7] });
  globalThis.navigator.getGamepads = () => [pad];
  try {
    const gamepad = new GamepadInput();
    gamepad.poll();
    gamepad.poll();
    assert.deepEqual(gamepad.move, { x: 0, y: 0 });
    assert.equal(gamepad.look.x, 1);
    assert.equal(gamepad.running, true);
    assert.deepEqual(events, ['keydown:KeyE']);
    pad = fakePad();
    gamepad.poll();
    assert.deepEqual(events, ['keydown:KeyE', 'keyup:KeyE']);
    assert.equal(gamepad.running, false);
  } finally {
    delete globalThis.KeyboardEvent;
    delete globalThis.document;
    delete globalThis.navigator.getGamepads;
  }
});

test('el stick izquierdo mueve al personaje salvo que el teclado ya lo esté moviendo', () => {
  const input = new Input();
  input.gamepad.move = { x: 0.5, y: -0.8 };
  assert.deepEqual(input.axis, { x: 0.5, z: -0.8 });
  input.keys.KeyD = true;
  assert.deepEqual(input.axis, { x: 1, z: 0 });
  input.locked = true;
  assert.deepEqual(input.axis, { x: 0, z: 0 });
});
