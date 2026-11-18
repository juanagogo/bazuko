import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedFleet, runLikeTheGame } from './helpers/traffic-world.js';

// Corridas largas del tráfico montado como una partida. Van aparte de `traffic.test.js` para correr a la vez que
// él.

// Cinco minutos por semilla para no alargar la suite. Los atascos de la flota se cierran antes: con el vendedor en la
// calzada o el empuje sin límite ya hay quien lleva más de 200 s a esa altura. El tope sale de medir 48 semillas de
// diez minutos en este montaje (peor tiempo, entre 110 y 114 s): a 200 s solo llega un bloqueo.
// La hora fija en el pico de la mañana llena la ciudad a tope: es el peor caso de la curva diaria. Con la flota diaria
// el que menos anda espera más colas que con los 34 carros de partida, así que el piso de recorrido baja; lo que delata
// un bloqueo sigue siendo el peor parado.
for (const seed of [1, 3, 11, 22, 29]) {
  test(`una sola flota con parqueados y NPC circula sin bloqueos, semilla ${seed}`, async () => {
    const { parked, npcs, vehicles, worst, shortest } = await runLikeTheGame(seed, 5);
    assert.equal(parked, 23);
    assert.ok(npcs >= 80, `${npcs} NPC`);
    assert.ok(vehicles <= expectedFleet('normal') && vehicles >= expectedFleet('normal') - 4,
      `${vehicles} vehículos a densidad normal, se esperaban ${expectedFleet('normal')}`);
    assert.ok(worst.seconds < 200, `${worst.kind} parado ${worst.seconds.toFixed(0)} s en ${worst.x?.toFixed(1)},${worst.z?.toFixed(1)}`);
    assert.ok(shortest > 150, `El que menos anduvo recorrió ${shortest.toFixed(0)} m`);
  });
}
