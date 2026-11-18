import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BUS_DETOUR, bridgeCenter, busPathX, southBusPathX } from '../src/world/bogota/Colpatria.js';

// El cálculo anterior, copiado entero para que no comparta nada con el nuevo: la normal como la daba bridgeNormal, con su
// propia pendiente, un objeto y Math.hypot, en cada paso de la bisección.
function bridgeNormalAnterior(z) {
  const dx = (bridgeCenter(z + .01) - bridgeCenter(z - .01)) / .02;
  const scale = Math.hypot(1, dx);
  return { x: 1 / scale, z: -dx / scale };
}

function busPathXAnterior(z, laneX = 78.5) {
  if (z <= BUS_DETOUR.z0 - 5 || z >= BUS_DETOUR.z1 + 5) return laneX;
  const offset = laneX - 75;
  let lo = z - 10, hi = z + 10;
  for (let i = 0; i < 28; i++) {
    const t = (lo + hi) / 2;
    if (t + bridgeNormalAnterior(t).z * offset < z) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return bridgeCenter(t) + bridgeNormalAnterior(t).x * offset;
}

test('los dos carriles del bus por el rodeo de la Colpatria dan lo mismo que el cálculo anterior', () => {
  const from = BUS_DETOUR.z0 - 5, to = BUS_DETOUR.z1 + 5;
  for (const lane of [78.5, 71.5]) {
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const z = from + (to - from) * (i + .5) / 2000;
      worst = Math.max(worst, Math.abs(busPathX(z, lane) - busPathXAnterior(z, lane)));
    }
    assert.ok(worst < 1e-9, `carril ${lane}: se separa ${worst} m del cálculo anterior`);
  }
});

test('el carril del bus por el rodeo no llama a Math.hypot', () => {
  const hypot = mock.method(Math, 'hypot');
  try {
    for (let z = BUS_DETOUR.z0 - 10; z <= BUS_DETOUR.z1 + 10; z += .5) { busPathX(z); southBusPathX(z); }
    assert.equal(hypot.mock.callCount(), 0);
  } finally {
    hypot.mock.restore();
  }
});
