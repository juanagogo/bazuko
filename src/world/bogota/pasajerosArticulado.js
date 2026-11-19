import { rgb, shade } from './MeshKit.js';

const shirts = ['#435260', '#71584c', '#426257', '#54505e', '#764644', '#384b66', '#74767d', '#4d6981', '#865443'].map(hex => rgb(hex));
const skins = ['#ab805e', '#8a6147', '#c9a384', '#734f39'].map(hex => rgb(hex));
const hairColors = ['#211914', '#382a21', '#191719', '#55524e'].map(hex => rgb(hex));
const trousers = ['#2b3036', '#2c3a50', '#39322e', '#444449'].map(hex => rgb(hex));
const shoe = rgb('#191a1b');
const lining = rgb('#cbc2af');

// Cada sección del perfil tiene altura, medio ancho, fondo delantero y trasero.
// Se comparte la topología entre pasajeros, pero no sus proporciones ni colores.
const TORSO = [
  [.00, .147, .103, .101], [.16, .163, .113, .105], [.35, .183, .133, .121],
  [.492, .204, .112, .114], [.541, .143, .086, .087], [.570, .065, .055, .050]
];
const HEAD = [
  [.550, .047, .043, .046], [.629, .058, .070, .066], [.673, .070, .078, .079],
  [.711, .084, .082, .095], [.742, .088, .077, .101], [.793, .086, .081, .094],
  [.829, .067, .067, .068], [.855, .004, .005, .003]
];
function loft(kit, rings, at, color, shape = null, sides = 8) {
  const base = kit.vertexCount;
  rings.forEach(([height, halfWidth, frontDepth, backDepth], row) => {
    for (let i = 0; i < sides; i++) {
      const angle = Math.PI * 2 * i / sides, x = Math.sin(angle), z = Math.cos(angle);
      const p = [x * halfWidth, height, z * (z > 0 ? frontDepth : backDepth)];
      shape?.(p, row, x, z);
      kit.vertex(at(...p), [x, 0, z], color(row, x, z), [0, 0]);
    }
  });
  for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < sides; i++) {
    const a = base + row * sides + i, b = base + row * sides + (i + 1) % sides;
    const c = a + sides, d = b + sides;
    kit.indices.push(a, b, c, b, d, c);
  }
}

/** Cuello, mandíbula y perfil de un rostro en el mismo lote interior de la carrocería. */
export function cabezaDePasajero(kit, x, y, z, skin, hair, { yaw = 0, tilt = 0, style = 0, sides = 8 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (dx, dy, dz) => [
    x + dx * c + dz * s + tilt * Math.max(0, (dy - .55) * 3.2), y + dy, z + dz * c - dx * s
  ];
  loft(kit, HEAD, at, (row, dx, dz) => {
    const hairline = row >= 6 || row === 5 && dz < (style % 2 ? .62 : .15) || row === 4 && dz < -.16;
    if (hairline) return shade(hair, .83 + .14 * dz + .05 * dx);
    const form = .69 + .19 * dz + .07 * dx + row * .047;
    const eyeSocket = row === 4 && dz > .55 && dz < .97 ? .76 : 1;
    return shade(skin, form * eyeSocket);
  }, (p, row, dx, dz) => {
    if (row === 3) {
      // Un punto en la punta de la nariz y dos sienes evitan la cara plana al mirar desde el andén.
      p[2] += Math.max(0, dz) ** 14 * .028;
      p[0] += dx * Math.abs(dx) ** 7 * .009;
    }
  }, sides);
  const front = [s, 0, c];
  const facetAngle = Math.PI * 2 / sides;
  const getFront = (dx, row) => {
    const [, width, depth] = HEAD[row];
    return depth * (1 - Math.abs(dx) * Math.tan(facetAngle / 2) / width);
  };
  const face = (x0, x1, row, thickness, color) => {
    const height = HEAD[row][0];
    const p = (x, y) => at(x, y, getFront(x, row) + .0035);
    kit.quad(p(x0, height - thickness), p(x1, height - thickness),
      p(x1, height + thickness), p(x0, height + thickness), color, { facing: front });
  };
  for (const side of [-1, 1]) {
    face(side * .026 - .010, side * .026 + .010, 4, .003, shade(hair, .96));
  }
  face(-.021, .021, 2, .0025, shade(skin, .6));
}

/** Los que van de pie toman la barra longitudinal. Los demás tienen rodillas y manos sobre el regazo. */
export function dibujaPasajero(kit, x, z, { floor, seed, rail = null }) {
  const shirt = shirts[seed % shirts.length], skin = skins[seed % skins.length];
  const hair = hairColors[(seed >> 1) % hairColors.length], pants = trousers[(seed >> 2) % trousers.length];
  const tall = 1 + ((seed * 7) % 5 - 2) * .025;
  const wide = 1 + ((seed * 11) % 3 - 1) * .08;
  const tilt = ((seed * 13) % 3 - 1) * .018;
  const hip = rail ? (floor + .86) * tall : floor + .52 * tall;

  loft(kit, TORSO, (dx, dy, dz) => [x + dx * wide, hip + dy, z + dz], (row, side, front) => {
    // Luz que baja del cielo raso, tela más oscura en la cintura y camisa a la vista bajo el cuello.
    if (row === TORSO.length - 1 && front > .7 && seed % 3 !== 2) return shade(lining, .65 + seed % 4 * .075);
    return shade(shirt, .58 + row * .11 + side * .085 + front * .14);
  });
  cabezaDePasajero(kit, x, hip, z + .012, skin, hair, {
    yaw: ((seed * 11) % 7 - 3) * .095, tilt, style: seed, sides: rail ? 8 : 6
  });

  const open = { caps: false };
  for (const side of [-1, 1]) {
    const dx = side * .087;
    if (rail) {
      // Una pierna carga el peso y la otra queda un poco adelantada.
      const step = side === Math.sign(rail.x - x) ? .041 : -.03;
      kit.tube([[x + dx, hip + .045, z], [x + dx, floor + .46, z + step], [x + dx, floor + .052, z + step]], .073, 5, pants, open);
      kit.box(x + dx, floor + .042, z + step + .046, .108, .083, .215, shoe, { bottom: .55 });
    } else {
      kit.tube([[x + dx, hip + .045, z + .025], [x + dx, hip + .018, z + .279], [x + dx, floor + .087, z + .337]], .072, 4, pants, open);
    }

    const shoulder = [x + side * .167 * wide, hip + .495, z + .009];
    const grabbing = rail && Math.sign(rail.x - x) === side;
    const elbow = grabbing ? [x + side * .232, hip + .75, z + .123]
      : rail ? [x + side * .198, hip + .236, z + .05] : [x + side * .176, hip + .238, z + .067];
    const wrist = grabbing ? [rail.x, rail.y - .031, z + .03]
      : rail ? [x + side * .176, hip + .064, z + .099] : [x + side * .098, hip + .114, z + .237];
    kit.tube([shoulder, elbow, wrist], .046, 4, shade(shirt, grabbing ? .96 : .8), open);
    const fingers = grabbing ? [wrist[0], rail.y, wrist[2]] : [wrist[0], wrist[1] - .019, wrist[2] + .011];
    kit.ellipsoid(fingers, [.030, .031, .027], v => shade(skin, .69 + v * .42), { rows: 2, cols: 4 });
  }
}
