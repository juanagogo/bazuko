import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_TRAFFIC_DENSITY, TRAFFIC_DENSITY_LEVELS,
  motoThreshold, trafficDensityMidday, trafficDensityId, trafficHourFactor, trafficTargetVehicles,
} from '../src/systems/trafficDensity.js';

test('la densidad desconocida cae en la de siempre', () => {
  assert.equal(trafficDensityId('maxima'), 'maxima');
  assert.equal(trafficDensityId('lo-que-sea'), DEFAULT_TRAFFIC_DENSITY);
  assert.equal(trafficDensityId(null), DEFAULT_TRAFFIC_DENSITY);
  assert.deepEqual(TRAFFIC_DENSITY_LEVELS.map(level => level.id), ['baja', 'normal', 'alta', 'maxima', 'ultra']);
});

test('cada nivel pide una flota mayor que el anterior', () => {
  const midday = TRAFFIC_DENSITY_LEVELS.map(level => trafficDensityMidday(level.id));
  for (let i = 1; i < midday.length; i++) assert.ok(midday[i] > midday[i - 1], `${midday}`);
});

test('la hora pico pide más que el mediodía y la madrugada pide lo mínimo', () => {
  const morning = trafficHourFactor(7), evening = trafficHourFactor(18.5), midday = trafficHourFactor(13), night = trafficHourFactor(3);
  assert.ok(morning > midday && evening > midday, `mañana ${morning}, tarde ${evening}, mediodía ${midday}`);
  assert.ok(night < midday, `madrugada ${night}, mediodía ${midday}`);
  assert.ok(morning > 1.4 && night < .4);
  // La curva cierra en la misma fracción a las 0 y a las 24.
  assert.ok(Math.abs(trafficHourFactor(0) - trafficHourFactor(24)) < 1e-9);
  assert.ok(Math.abs(trafficHourFactor(-1) - trafficHourFactor(23)) < 1e-9);
});

test('la flota escala con el nivel y con la hora, con un piso y un techo', () => {
  const base = trafficTargetVehicles(13, 'normal');
  assert.ok(trafficTargetVehicles(13, 'baja') < base);
  assert.ok(trafficTargetVehicles(18.5, 'normal') > base * 1.5);
  assert.ok(trafficTargetVehicles(3, 'normal') < base * .5);
  assert.ok(trafficTargetVehicles(7, 'maxima') > trafficTargetVehicles(7, 'alta'));
  // Ultra llena la calle: varias veces Máxima en el pico.
  assert.ok(trafficTargetVehicles(7, 'ultra') >= trafficTargetVehicles(7, 'maxima') * 4);
  // Pico de la mañana: más que la flota de partida, sin llegar al techo de la red.
  assert.ok(trafficTargetVehicles(7, 'normal') >= 45);
  assert.ok(trafficTargetVehicles(18.5, 'maxima') <= 62);
  // La madrugada deja la calle casi sola.
  assert.ok(trafficTargetVehicles(3, 'baja') <= 6);
});

test('Ultra pone mucha más moto que el resto: tres de cada cuatro vehículos en el pico', () => {
  assert.ok(motoThreshold(7.5, 'ultra') <= motoThreshold(7.5, 'maxima') - 2);
  assert.ok(motoThreshold(7.5, 'ultra') <= 3);
});
