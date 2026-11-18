// tests/day-night-cycle.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { Clock, DAY_CYCLE_SECONDS } from '../src/core/Clock.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { DAY_LENGTH_SECONDS } from '../src/utils/constants.js';

test('Transición día/noche: Clock avanza suavemente por amanecer, día, atardecer y noche', () => {
  assert.equal(DAY_CYCLE_SECONDS, 720, 'Un ciclo completo dura 12 minutos reales (720 s)');

  const clock = new Clock({ dayLengthSeconds: 720, hour: 6 });
  assert.equal(clock.hour, 6, 'Empieza al amanecer (06:00)');
  assert.equal(clock.isNight, false);
  assert.equal(clock.lightsOn, false);

  // Tras 3 minutos (180 s) = 6 horas de juego -> 12:00 (mediodía soleado)
  clock.update(180);
  assert.ok(Math.abs(clock.hour - 12) < 0.1, `Debe estar a mediodía, actual: ${clock.hour}`);
  assert.equal(clock.isNight, false);
  assert.equal(clock.lightsOn, false);

  // Tras otros 3 minutos (180 s) = 6 horas más -> 18:00 (atardecer, luces encendidas)
  clock.update(180);
  assert.ok(Math.abs(clock.hour - 18) < 0.1, `Debe ser el atardecer, actual: ${clock.hour}`);
  assert.equal(clock.lightsOn, true, 'Faroles y ventanas se encienden al atardecer');
  assert.equal(clock.isNight, false);

  // Tras 1 minuto (60 s) = 2 horas más -> 20:00 (noche cerrada en Bogotá)
  clock.update(60);
  assert.ok(Math.abs(clock.hour - 20) < 0.1, `Debe ser de noche, actual: ${clock.hour}`);
  assert.equal(clock.isNight, true, 'De noche en Bogotá');
  assert.equal(clock.lightsOn, true);
});

test('Transición día/noche: Clock mantiene retrocompatibilidad con DAY_LENGTH_SECONDS sin opciones', () => {
  const clock = new Clock();
  assert.equal(clock.dayLengthSeconds, DAY_LENGTH_SECONDS);
  assert.equal(clock.day, 1);
  assert.equal(clock.hour, 6);

  // Avanza exactamente 24h tras DAY_LENGTH_SECONDS (3600 s)
  clock.update(DAY_LENGTH_SECONDS);
  assert.equal(clock.day, 2);
  assert.ok(Math.abs(clock.hour - 6) < 1e-6);
});

test('Transición día/noche: serialización y deserialización conservan el progreso del tiempo', () => {
  const clock = new Clock({ day: 3, hour: 14.5 });
  const serializado = clock.serialize();

  assert.equal(serializado.day, 3);
  assert.equal(serializado.hour, 14.5);

  const otroClock = new Clock();
  otroClock.deserialize(serializado);
  assert.equal(otroClock.day, 3);
  assert.equal(otroClock.hour, 14.5);
});
