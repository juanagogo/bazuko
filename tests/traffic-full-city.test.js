import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedFleet, runLikeTheGame } from './helpers/traffic-world.js';

// Corridas largas del tráfico montado como una partida, con la ciudad llena. Van aparte de `traffic.test.js` para
// correr a la vez que él.

// La densidad máxima lleva cada circuito a su tope de carros; también en el pico tiene que seguir fluyendo. Con la
// ciudad llena el que menos anda pasa el rato en colas, no trabado: un bloqueo lo delata el peor parado.
for (const seed of [1, 3, 11, 22, 29]) {
  test(`con la densidad máxima la ciudad se llena sin bloqueos, semilla ${seed}`, async () => {
    const { vehicles, worst, shortest } = await runLikeTheGame(seed, 5, { density: 'maxima' });
    assert.ok(vehicles <= expectedFleet('maxima') && vehicles >= expectedFleet('maxima') - 4,
      `${vehicles} vehículos al máximo, se esperaban ${expectedFleet('maxima')}`);
    assert.ok(worst.seconds < 200, `${worst.kind} parado ${worst.seconds.toFixed(0)} s en ${worst.x?.toFixed(1)},${worst.z?.toFixed(1)}`);
    assert.ok(shortest > 150, `El que menos anduvo recorrió ${shortest.toFixed(0)} m`);
  });
}
