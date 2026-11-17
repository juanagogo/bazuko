import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedFleet, runLikeTheGame } from './helpers/traffic-world.js';

// Las dos semillas que faltan en `traffic-out-of-sight.test.js`: aparte corren a la vez que las otras tres.

// Los trancones que el jugador ve se quedan; el que no ve se despeja solo, y la flota repone el carro en un tramo libre.
for (const seed of [22, 29]) {
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
