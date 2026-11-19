import { TOWER_TILE } from './ZoneTextures.js';

const { bays, floors, floorMeters } = TOWER_TILE;
const BAND_DEPTH = .19;
const PARAPET = .86;

/** Cotas de las terrazas. La cresta conserva la altura y el arco donde estaba. */
export function towerLevels({ radius, a0, a1, floors }) {
  const segments = Math.round((a1 - a0) * radius / 4);
  return Array.from({ length: segments }, (_, i) => {
    const k = (i + .5) / segments;
    const shoulder = i === 0 || i === segments - 1 ? 1.55 : k < .5 ? 1.18 : 1.10;
    const shape = Math.min(1, Math.sin(k * Math.PI) * shoulder);
    return Math.max(5, Math.round((floors * shape) / 2) * 2);
  });
}

const point = (r, angle, y) => [Math.cos(angle) * r, y, Math.sin(angle) * r];
const atlasCell = (bay, floor, width, height) => [
  (bay + .03) / bays, (floors - floor - .97) / floors,
  (bay + .03 + .94 * width) / bays, (floors - floor - .97 + .94 * height) / floors
];
// La primera columna del atlas es de ladrillo sin aberturas. Sirve para antepechos, jambas y losas.
const brick = (width, height, variation) => atlasCell(0, variation % floors,
  Math.min(1, width / 4.4), Math.min(1, height / floorMeters));

function band(batch, material, { r, t0, t1, side }, low, high, uv) {
  const [start, end] = side === 1 ? [t1, t0] : [t0, t1];
  batch.quad(material, point(r, start, low), point(r, end, low), point(r, end, high), point(r, start, high), uv);
}

function ledge(batch, material, r0, r1, t0, t1, y, width, variation, underside = false) {
  const vertices = [point(r0, t0, y), point(r0, t1, y), point(r1, t1, y), point(r1, t0, y)];
  if (underside) vertices.reverse();
  batch.quad(material, ...vertices, brick(width, r1 - r0, variation));
}

/** Ventanería retirada, losa en voladizo y antepecho corrido, dentro de la planta original. */
export function towerBalconies(batch, material, { r, t0, t1, side, levels, bay }) {
  const face = { r, t0, t1, side };
  const rear = r - side * (side === 1 ? .84 : .58);
  const insideGuard = r - side * BAND_DEPTH;
  const span = (t1 - t0) * r;
  const lip = [Math.min(r, insideGuard), Math.max(r, insideGuard)];
  const deck = [Math.min(r, rear), Math.max(r, rear)];
  const groundBay = bay % 4 === 1 ? 1 : 0;
  band(batch, material, face, .65, floorMeters - .12, groundBay ? atlasCell(groundBay, 2, 1, 1) : brick(span, floorMeters - .65, bay));
  for (let floor = 1; floor < levels; floor++) {
    const y = floor * floorMeters;
    const variant = (bay * 5 + floor * 3 + (side === 1 ? 1 : 3)) % (bays - 1) + 1;
    const textureFloor = (floor + bay * 3) % floors;
    band(batch, material, { ...face, r: rear }, y - .12, y + floorMeters - .12, atlasCell(variant, textureFloor, 1, 1));
    band(batch, material, face, y - .12, y + PARAPET, brick(span, PARAPET + .12, bay + floor));
    band(batch, material, { ...face, r: insideGuard, side: -side }, y + .03, y + PARAPET, brick(span, PARAPET, bay + floor + 1));
    ledge(batch, material, ...lip, t0, t1, y + PARAPET, span, bay);
    ledge(batch, material, ...deck, t0, t1, y - .12, span, bay + 2, true);
  }
  const height = levels * floorMeters;
  band(batch, material, face, height - .12, height + .5, brick(span, .62, bay));
  band(batch, material, { ...face, r: insideGuard, side: -side }, height, height + .5, brick(span, .5, bay + 1));
  ledge(batch, material, ...lip, t0, t1, height + .5, span, bay);
  // Cierra la unión con el vidrio alto aun cuando el plano lejano ya dejó atrás la azotea.
  ledge(batch, material, ...deck, t0, t1, height - .12, span, bay + 2, true);
}

/** Costados radiales visibles en las terrazas. Los paños se interrumpen con franjas angostas de ventana. */
export function towerTerraceWall(batch, material, inner, outer, angle, low, high, outward, segment) {
  if (low >= high) return;
  const depth = outer - inner;
  const panels = Math.ceil(depth / 4.4);
  const top = high * floorMeters;
  for (let i = 0; i < panels; i++) {
    const r0 = inner + depth * i / panels, r1 = inner + depth * (i + 1) / panels;
    const [start, end] = outward ? [r0, r1] : [r1, r0];
    for (let floor = low; floor < high; floor++) {
      const y0 = floor * floorMeters, y1 = y0 + floorMeters;
      const uv = i === panels - 2 ? atlasCell(1, (floor + segment) % floors, 1, 1) : brick(r1 - r0, floorMeters, segment + floor + i);
      batch.quad(material, point(start, angle, y0), point(end, angle, y0), point(end, angle, y1), point(start, angle, y1), uv);
    }
    batch.quad(material, point(start, angle, top), point(end, angle, top),
      point(end, angle, top + .5), point(start, angle, top + .5), brick(r1 - r0, .5, segment + i));
  }
}
