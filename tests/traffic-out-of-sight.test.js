import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedFleet, runLikeTheGame } from './helpers/traffic-world.js';

// Corridas largas del tráfico montado como una partida, mirando lo que pasa lejos del jugador. Son las más lentas,
// ocho minutos de juego cada una: las semillas 22 y 29 van en `traffic-out-of-sight-2.test.js` para correr a la
// vez.

// Los trancones que el jugador ve se quedan; el que no ve se despeja solo, y la flota repone el carro en un tramo libre.
for (const seed of [1, 3, 11]) {
  test(`fuera de la vista ningún carro se queda parado, semilla ${seed}`, async () => {
    const { farWorst, vehicles, removals } = await runLikeTheGame(seed, 8, { density: 'maxima', hour: 8 });
    const target = expectedFleet('maxima');
    assert.ok(farWorst.seconds < 60,
      `${farWorst.kind} parado ${farWorst.seconds.toFixed(0)} s lejos de la vista en ${farWorst.x?.toFixed(1)},${farWorst.z?.toFixed(1)}`);
    assert.ok(Math.abs(vehicles - target) <= 3, `${vehicles} vehículos, objetivo ${target}`);
    // Si la cifra se dispara, el trancón se está comiendo la flota lejana. Cero también vale: hay semillas en que nadie
    // pasa 45 s trabado lejos de la vista (que sí lo retira lo mira «el carro trabado lejos de la vista se retira»).
    assert.ok(removals <= 20, `${removals} retirados`);
  });
}
