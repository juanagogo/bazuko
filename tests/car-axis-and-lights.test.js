import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '../src/core/Clock.js';
import { getCarBody } from '../src/world/bogota/VehicleBody.js';

const MODELS = ['citadino', 'sedanPopular', 'hatchPopular', 'suv', 'sedanDeportivo', 'sedanNoventero', 'pickup', 'furgon', 'cajaSetentera', 'buseta', 'camionetaNegra'];

test('las molduras que cruzan la nariz no se hunden en el eje central', () => {
  for (const id of MODELS) {
    const body = getCarBody(id);
    for (let y = .5; y < 1.3; y += .02) {
      let center, near;
      try { center = body.around('nose', 0, y, .015)[0]; near = body.around('nose', .03, y, .015)[0]; } catch { continue; }
      assert.ok(near - center <= .004, `${id} a la altura ${y.toFixed(2)}: el eje queda ${((near - center) * 100).toFixed(1)} cm detrás`);
    }
  }
});

test('el desplazamiento hacia afuera se conserva también junto al eje', () => {
  const body = getCarBody('pickup');
  const onSkin = body.around('nose', 0, 1.018, 0)[0], offset = body.around('nose', 0, 1.018, .015)[0];
  assert.ok(Math.abs(offset - onSkin - .015) < 1e-3, `desplazó ${offset - onSkin}`);
});

test('las luces encienden al atardecer y apagan al amanecer, sin adelantar la noche del juego', () => {
  const clock = new Clock();
  for (const [hour, lights, night] of [[5.9, true, true], [6.1, false, false], [17.9, false, false], [18.1, true, false], [19.9, true, false], [20.1, true, true]]) {
    clock.hour = hour;
    assert.equal(clock.lightsOn, lights, `luces a las ${hour}`);
    assert.equal(clock.isNight, night, `noche a las ${hour}`);
  }
});
