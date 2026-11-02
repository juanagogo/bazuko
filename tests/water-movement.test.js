import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WaterMovement, WATER_MOVEMENT } from '../src/systems/WaterMovement.js';

const lake = depth => ({ surfaceY: -.18, depth, bottomY: -.18 - depth });
const close = (a, b, tolerance = .001) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('agua bajo el puente y saltos sobre la superficie preservan la física de suelo', () => {
  const controller = new WaterMovement();
  for (const sample of [
    { feetY: 7.82, groundY: 7.82, surfaceLayer: 'viaduct', grounded: true },
    { feetY: 1.2, verticalVelocity: -2, grounded: false },
    { feetY: .3, verticalVelocity: 4, grounded: false },
    { feetY: -.2, verticalVelocity: 4, grounded: false }
  ]) {
    const frame = controller.update(1 / 60, { water: lake(6), ...sample });
    assert.equal(frame.handlesVertical, false);
    assert.equal(frame.swimming, false);
    assert.equal(frame.feetY, sample.feetY);
    assert.equal(frame.verticalVelocity, sample.verticalVelocity ?? 0);
  }
});

test('la orilla permite vadear con apoyo habitual y reduce velocidad según profundidad', () => {
  const controller = new WaterMovement();
  const shallow = lake(.15);
  const first = controller.update(.016, { water: shallow, feetY: shallow.bottomY, grounded: true });
  assert.equal(first.state, 'wading'); assert.equal(first.entered, true);
  assert.equal(first.handlesVertical, false); assert.equal(first.grounded, true);
  const shallowSpeed = controller.getSpeed({ walkSpeed: 3 });
  const deep = lake(1);
  const next = controller.update(.016, { water: deep, feetY: deep.bottomY, grounded: true });
  assert.equal(next.state, 'wading'); assert.equal(next.entered, false);
  assert.ok(controller.getSpeed({ walkSpeed: 3 }) < shallowSpeed);
  assert.ok(controller.getSpeed({ walkSpeed: 3 }) > 1.4);
});

test('caer desde el puente cruza el agua sin teletransporte y termina flotando', () => {
  const controller = new WaterMovement(), water = lake(6);
  let y = 7.82, velocity = 0, activeFrames = 0, entered = 0, largestDrop = 0;
  for (let i = 0; i < 240; i++) {
    const before = y;
    const frame = controller.update(1 / 60, { water, feetY: y, verticalVelocity: velocity, grounded: false });
    if (frame.entered) entered++;
    if (frame.handlesVertical) { y = frame.feetY; velocity = frame.verticalVelocity; activeFrames++; }
    else { velocity -= 17 / 60; y += velocity / 60; }
    largestDrop = Math.max(largestDrop, before - y);
    assert.ok(y > water.bottomY, 'la caída no atraviesa el fondo');
  }
  assert.ok(activeFrames > 120);
  assert.equal(entered, 1);
  assert.ok(largestDrop < .4, `no encaja de golpe en la superficie: ${largestDrop}`);
  close(y, water.surfaceY - WATER_MOVEMENT.floatDepth);
  close(velocity, 0);
  assert.equal(controller.frame.swimming, true);
});

test('una caída rápida capturada entre cuadros emite entrada y conserva cabeza fuera del agua', () => {
  const controller = new WaterMovement(), water = lake(6);
  let frame = controller.update(.1, { water, feetY: .3, verticalVelocity: -18 });
  assert.equal(frame.swimming, true); assert.equal(frame.entered, true);
  assert.equal(frame.entryIntensity, 1);
  assert.ok(frame.feetY < water.surfaceY && frame.feetY > water.surfaceY - 1.4);
  for (let i = 0; i < 60; i++) {
    frame = controller.update(1 / 60, { water, feetY: frame.feetY, verticalVelocity: frame.verticalVelocity });
    assert.ok(frame.feetY + WATER_MOVEMENT.bodyHeight > water.surfaceY + .25);
    assert.equal(frame.entered, false);
  }
});

test('salir hacia el banco cambia de nado a vadeo y finalmente a suelo sin salto vertical', () => {
  const controller = new WaterMovement();
  let feetY = -1.23, velocity = 0;
  controller.update(.016, { water: lake(2), feetY });
  assert.equal(controller.swimming, true);
  let previousY = feetY;
  for (let depth = 1.6; depth >= .02; depth -= .02) {
    const water = lake(depth);
    const frame = controller.update(.016, { water, feetY, verticalVelocity: velocity, groundY: water.bottomY });
    if (frame.handlesVertical) { feetY = frame.feetY; velocity = frame.verticalVelocity; }
    else { feetY = Math.max(water.bottomY, feetY - .02); velocity = 0; }
    assert.ok(Math.abs(feetY - previousY) < .08, 'la pendiente permite salir gradualmente');
    previousY = feetY;
  }
  assert.equal(controller.frame.wading, true);
  const dry = controller.update(.016, { water: null, feetY: .06, grounded: true });
  assert.equal(dry.state, 'dry'); assert.equal(dry.exited, true); assert.equal(dry.stoppedSwimming, false);
  assert.equal(dry.handlesVertical, false); assert.equal(dry.feetY, .06);
  assert.equal(controller.getSpeed({ walkSpeed: 2.4, runSpeed: 4.8, running: true }), 4.8);
});

test('histéresis de profundidad evita cambiar de nado a vadeo por ruido en el borde', () => {
  const controller = new WaterMovement();
  controller.update(.016, { water: lake(1.3), feetY: -1.23 });
  for (const depth of [1.24, 1.26, 1.2, 1.16, 1.12]) {
    assert.equal(controller.update(.016, { water: lake(depth), feetY: -1.23 }).swimming, true);
  }
  assert.equal(controller.update(.016, { water: lake(1.08), feetY: -1.23 }).wading, true);
  assert.equal(controller.update(.016, { water: lake(1.12), feetY: -1.23 }).wading, true);
});

test('sprint consume energía por cuadro y agotarla nunca elimina el nado hacia la orilla', () => {
  const controller = new WaterMovement();
  const props = { water: lake(4), feetY: -1.23, moving: true, running: true, speed: 2.6 };
  const fast = controller.update(.1, { ...props, energy: 100 });
  close(fast.energyDrain, .09);
  assert.equal(controller.getSpeed({ running: true, energy: 100 }), 2.6);
  const low = controller.update(.1, { ...props, energy: 8.02 });
  close(low.energyDrain, .02);
  const empty = controller.update(.1, { ...props, energy: 0 });
  assert.equal(empty.energyDrain, 0);
  assert.equal(controller.getSpeed({ running: true, energy: 0, walkSpeed: 0, runSpeed: 0 }), 1.65);
  assert.equal(controller.getSpeed({ moving: false, running: true }), 0);
  const normal = controller.update(.1, { ...props, energy: 100, running: false });
  assert.equal(normal.energyDrain, 0);
});

test('pausa no avanza flotación ni consumo; reset limpia eventos y la recuperación', () => {
  const controller = new WaterMovement();
  const args = { water: lake(3), feetY: -1.1, verticalVelocity: -1, moving: true, running: true };
  const paused = controller.update(0, args);
  assert.equal(paused.feetY, args.feetY); assert.equal(paused.verticalVelocity, args.verticalVelocity);
  assert.equal(paused.energyDrain, 0); assert.equal(paused.swimBlend, 0);
  controller.reset();
  assert.equal(controller.inWater, false); assert.equal(controller.swimming, false);
  assert.equal(controller.frame.entered, false); assert.equal(controller.frame.surfaceY, null);
  assert.equal(controller.getSpeed({ walkSpeed: 2, runSpeed: 4, running: true }), 4);
});
