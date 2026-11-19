import { addGrid, tube } from './carParts.js';
import { GENTE, LAMINA } from './pasajerosBuseta.js';
import { withVisualRandom } from './VisualRandom.js';

const AISLE = .30, WINDOW_SIDE = .99;
const BENCH_CENTER = (AISLE + WINDOW_SIDE) / 2;
const VINYL = [.11, .132, .138], REUPHOLSTERED = [.165, .133, .105];
const FRAME = [.078, .081, .079], HANDLE = [.32, .34, .33];
const shade = (color, strength) => color.map(value => value * strength);

// Asientos dobles de vinilo. Las esquinas del espaldar ceden hacia dentro, y el perfil se recuesta hacia atrás.
// Cada banco queda un poco por delante del respaldo y justo por debajo del torso pintado que ya ocupa ese puesto.
const BACK = [
  [.018, -.042, .044, .335], [-.054, .409, .050, .345], [-.063, .473, .025, .291]
];
const CUSHION = [
  [.026, -.024, .330], [.389, .003, .345], [.438, -.022, .306]
];

function backrest(batch, x, seatHeight, color) {
  const edge = (i, j, face) => {
    const [back, height, thickness, halfWidth] = BACK[j];
    return [x + back + face * thickness, seatHeight + height, BENCH_CENTER + (i ? 1 : -1) * halfWidth];
  };
  const shoulder = (i, j, face) => {
    if (i !== 1) return edge(i === 2, j + 1, face);
    const [px, y] = edge(0, j + 1, face);
    return [px, y - (j ? .032 : 0), BENCH_CENTER];
  };
  for (const face of [-1, 1]) {
    addGrid(batch, 1, 1, (i, j) => edge(i, j, face), {
      color: (_u, v) => shade(color, .77 + .25 * v), out: [face, 0, 0]
    });
    // El borde superior tiene dos coronas bajas y un rebaje en la división de las plazas.
    addGrid(batch, 2, 1, (i, j) => shoulder(i, j, face), {
      color: (u, v) => shade(color, v && u !== .5 ? 1.53 : 1.02), out: [face, 0, 0]
    });
  }
  // Una costura estrecha divide las dos plazas; queda visible desde el extremo de la fila.
  addGrid(batch, 1, 1, (i, j) => {
    const [px, y] = edge(i, j, -1);
    return [px - .0015, y, BENCH_CENTER + (i ? .006 : -.006)];
  }, { color: shade(color, .55), out: [-1, 0, 0] });
  for (const side of [0, 1]) {
    addGrid(batch, 1, 2, (i, j) => edge(side, j, i ? 1 : -1), {
      color: (_u, v) => shade(color, .96 + v * .46), out: [0, 0, side ? 1 : -1]
    });
  }
  addGrid(batch, 2, 1, (i, j) => shoulder(i, 1, j ? 1 : -1), {
    color: u => shade(color, u === .5 ? 1.07 : 1.67), out: [0, 1, 0]
  });
}

function cushion(batch, x, seatHeight, color) {
  const edge = (i, j, top) => {
    const [forward, crown, halfWidth] = CUSHION[j];
    return [x + forward, seatHeight + (top ? crown : -.091), BENCH_CENTER + (i ? 1 : -1) * halfWidth];
  };
  addGrid(batch, 1, 2, (i, j) => edge(i, j, true), { color: shade(color, 1.18), out: [0, 1, 0] });
  for (const side of [0, 1]) {
    addGrid(batch, 1, 2, (i, j) => edge(side, j, i === 1), {
      color: (_u, v) => shade(color, .80 + .29 * v), out: [0, 0, side ? 1 : -1]
    });
  }
  addGrid(batch, 1, 1, (i, j) => edge(i, CUSHION.length - 1, j === 1), { color, out: [1, 0, 0] });
}

export function addBusetaInterior({ trim, lamp }, floor, lampChannel) {
  const platform = floor + .11, seatHeight = LAMINA.y0 - .015;
  // El piso iluminado aprovecha el canal del tubo existente. Las tarimas laterales dejan el pasillo continuo.
  const floorZ = [-WINDOW_SIDE, -AISLE, AISLE, WINDOW_SIDE];
  addGrid(lamp, 1, 3, (i, j) => [i ? 3.49 : -3.52, floor, floorZ[j]], {
    color: (_u, v) => v > 0 && v < 1 ? [.111, .116, .125] : [.087, .092, .101],
    lamp: lampChannel, mirror: false, out: [0, 1, 0]
  });
  addGrid(trim, 1, 1, (i, j) => [i ? 2.40 : -3.48, platform, j ? WINDOW_SIDE : AISLE], {
    color: [.078, .076, .067], out: [0, 1, 0]
  });
  addGrid(trim, 1, 1, (i, j) => [i ? 2.40 : -3.48, j ? platform : floor, AISLE], {
    color: [.17, .157, .133], out: [0, 0, -1]
  });
  const rows = GENTE[0].length, pitch = (LAMINA.x1 - LAMINA.x0) / rows;
  for (let row = 0; row < rows; row++) {
    const x = LAMINA.x0 + .10 + row * pitch, color = row === 2 ? REUPHOLSTERED : VINYL;
    backrest(trim, x, seatHeight, color);
    cushion(trim, x, seatHeight, color);
    // Las puntas se esconden en la tarima y el asiento. Se conserva un UUID del juego por fila.
    tube(trim, [x + .23, platform - .009, AISLE + .065], [x + .13, seatHeight - .084, AISLE + .065],
      .024, 4, { color: FRAME, mirror: true, open: true });
  }

  // Poste de entrada detrás de la puerta de la acera, fuera del vano y de la posición del conductor.
  withVisualRandom(() => tube(trim, [2.88, floor, .925], [2.88, 2.77, .925], .018, 4, { color: HANDLE, open: true }));
}
