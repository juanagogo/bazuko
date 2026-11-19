import * as THREE from 'three';

// Tramos separados por lomas verdes. La cota sale del cerro, los lotes se ordenan a partir de la calle.
const SECTORS = [
  { from: .987, to: 1.215, levels: 6, start: .070, rise: .077, bend: -.018, phase: 2.6 },
  { from: 1.248, to: 1.491, levels: 8, start: .065, rise: .069, bend: .025, phase: .6 },
  { from: 1.526, to: 1.765, levels: 7, start: .061, rise: .078, bend: -.028, phase: 3.8 },
  { from: 1.804, to: 2.073, levels: 7, start: .077, rise: .081, bend: .016, phase: 1.1 }
];
const BRICK = [[.53, .265, .14], [.62, .335, .185], [.46, .216, .123], [.68, .37, .23], [.55, .285, .19]];
const PLASTER = [[.72, .63, .48], [.67, .68, .6], [.57, .58, .48], [.64, .45, .36], [.47, .48, .45]];
const ROOFS = [[.26, .265, .25], [.34, .325, .29], [.41, .43, .42], [.39, .215, .153]];
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

function choice(row, lot, salt) {
  const a = Math.imul(row + 2389, 1597334677) ^ Math.imul(lot + 953, 3812015801) ^ Math.imul(salt + 21, 95828263);
  return (Math.imul(a ^ (a >>> 15), 1768202277) >>> 0) / 4294967296;
}

function locate(curve, u) {
  const { x, z } = curve(u), before = curve(Math.max(0, u - .001)), after = curve(Math.min(1, u + .001));
  const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz);
  return { x, z, tx: dx / length, tz: dz / length };
}

function route(curve, width, kind) {
  let length = 0, prev = curve(0);
  for (let i = 1; i <= 24; i++) {
    const p = curve(i / 24);
    length += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return { curve, width, kind, length };
}

function terrace(sector, i, polar) {
  const drift = Math.sin(i * .88 + sector.phase) * .017;
  const t = u => sector.start + sector.rise * i + sector.bend * (u - .5)
    + Math.sin(u * Math.PI * 1.8 + sector.phase + i * .26) * .018;
  const edge = u => [lerp(sector.from + i * .0035, sector.to - i * .004, u) + drift, t(u)];
  return { ...route(u => polar(...edge(u)), i ? 4.5 : 5.2, 'street'), edge };
}

function joinTerraces(lower, upper, where, curveOut, width, kind, polar) {
  const [a, t0] = lower.edge(where), [b, t1] = upper.edge(where);
  return route(u => polar(lerp(a, b, u) + curveOut * Math.sin(Math.PI * u), lerp(t0, t1, u)), width, kind);
}

function lotOverlaps(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dx) > a.reach + b.reach || Math.abs(dz) > a.reach + b.reach) return false;
  for (const [x, z] of [[a.tx, a.tz], [-a.tz, a.tx], [b.tx, b.tz], [-b.tz, b.tx]]) {
    const span = lot => (Math.abs(x * lot.tx + z * lot.tz) * lot.w + Math.abs(z * lot.tx - x * lot.tz) * lot.d) / 2;
    if (Math.abs(x * dx + z * dz) >= span(a) + span(b)) return false;
  }
  return true;
}

/** Fachadas, azoteas y calles del fondo. Las nueve cotas por lote incluyen las esquinas que quedan cuesta abajo. */
export function planHillsideSettlement({ cx, cz, surface, heightAt, blocks }) {
  const polar = (angle, t) => {
    const { radius } = surface(angle, t);
    return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius };
  };
  const routes = [], rows = [];
  const lots = blocks.filter(b => b.z > cz + 280 && b.z < cz + 650).map(b => ({
    ...b, tx: 1, tz: 0, reach: Math.hypot(b.w, b.d) / 2
  }));
  const houses = [], roofs = [];
  for (const [s, sector] of SECTORS.entries()) {
    const terraces = Array.from({ length: sector.levels }, (_, i) => terrace(sector, i, polar));
    const passage = .3 + (s % 3) * .17;
    for (const [i, street] of terraces.entries()) {
      routes.push(street);
      rows.push({ street, key: s * 10 + i, level: i, passage });
      if (i === 0) {
        const [angle, depth] = street.edge(.2);
        routes.push(route(u => polar(angle + .048 * (1 - u) ** 2, lerp(.012, depth, u)), 4.7, 'street'));
      }
      if (!i) continue;
      const edge = (i + s) % 2;
      const lower = terraces[i - 1];
      routes.push(joinTerraces(lower, street, edge, (edge ? 1 : -1) * (.013 + .004 * (i % 3)), 3.1, 'ascent', polar));
      if (i % 2 === 1 || i === terraces.length - 1) {
        routes.push(joinTerraces(lower, street, passage, .003, 2.1, 'foot', polar));
      }
    }
  }
  const routeSamples = routes.flatMap(r => {
    const steps = Math.ceil(r.length / 3.2);
    return Array.from({ length: steps + 1 }, (_, i) => ({ ...r.curve(i / steps), radius: r.width / 2 + .22 }));
  });
  for (const { street, key, level, passage } of rows) for (const side of [-1, 1]) {
    const len = street.length;
    for (let head = 5, i = 0; head < len - 7; i++) {
      const id = i * 2 + (side > 0 ? 1 : 0), pick = salt => choice(key, id, salt);
      const w = 4.8 + pick(1) * 4.2, d = 6 + pick(2) * 3.6;
      const u = (head + w / 2) / len;
      head += w + .32 + pick(3) * 1.25 + (pick(4) > .91 ? 2.4 : 0);
      if (u >= 1 || Math.abs(u - passage) * len < w / 2 + 1.55 || pick(5) > .97 - level * .012) continue;
      const { x, z, tx, tz } = locate(street.curve, u);
      const setBack = street.width / 2 + d / 2 + .75 + pick(6) * .85;
      const lot = { x: x - tz * setBack * side, z: z + tx * setBack * side, w, d, tx, tz, reach: Math.hypot(w, d) / 2 };
      const roadCrossesLot = ({ x, z, radius }) => {
        const dx = x - lot.x, dz = z - lot.z;
        return Math.abs(dx) < lot.reach + radius && Math.abs(dz) < lot.reach + radius
          && Math.abs(dx * tx + dz * tz) < w / 2 + radius && Math.abs(dz * tx - dx * tz) < d / 2 + radius;
      };
      if (routeSamples.some(roadCrossesLot) || lots.some(other => lotOverlaps(lot, other))) continue;
      const heights = [];
      for (const a of [-.5, 0, .5]) for (const b of [-.5, 0, .5]) {
        heights.push(heightAt(lot.x + tx * a * w - tz * b * d, lot.z + tz * a * w + tx * b * d));
      }
      if (heights.some(y => y === null)) continue;
      const y = Math.min(...heights) - .46;
      const foundation = lerp(heights[4], Math.max(...heights), .55) + .16 - y;
      const roll = pick(7), levels = roll < .22 || (level >= 5 && roll < .43) ? 1 : roll < .84 ? 2 : 3;
      const h = 2.72 * levels + .15 + pick(8) * .55 + foundation;
      const rotation = Math.atan2(-tz, tx) + (side > 0 ? Math.PI : 0);
      const palette = pick(9) < .78 ? BRICK : PLASTER;
      const color = palette[Math.floor(pick(10) * palette.length)];
      houses.push({ ...lot, h, color, y, rotation, settlement: [foundation, 1] });
      lots.push(lot);
      if (pick(11) < .24) {
        const shift = (pick(12) - .5) * d * .4;
        roofs.push({ x: lot.x - tz * shift, z: lot.z + tx * shift, y: y + h - .1,
          w: w * (.48 + pick(13) * .43), d: d * (.45 + pick(14) * .27), h: .45 + pick(15) * 1.25,
          color: ROOFS[Math.floor(pick(16) * ROOFS.length)], rotation, pitch: (pick(17) - .5) * .27,
          settlement: [0, 2] });
      }
    }
  }
  return { houses, roofs, routes };
}

function clipToEdge(polygon, a, b, sign) {
  const edgeX = b[0] - a[0], edgeZ = b[2] - a[2];
  const distance = point => (edgeX * (point[1] - a[2]) - edgeZ * (point[0] - a[0])) * sign;
  const clipped = [];
  let prev = polygon.at(-1), d0 = distance(prev);
  for (const point of polygon) {
    const d1 = distance(point);
    if ((d0 >= 0) !== (d1 >= 0)) clipped.push(prev.map((value, i) => lerp(value, point[i], d0 / (d0 - d1))));
    if (d1 >= 0) clipped.push(point);
    prev = point; d0 = d1;
  }
  return clipped;
}

// La calle se corta por las caras del cerro. Entre dos vértices también queda pegada a la ladera.
function drapeStrip(road, facesIn, emit) {
  const xs = road.map(p => p[0]), zs = road.map(p => p[1]);
  facesIn(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), ([a, b, c]) => {
    const bx = b[0] - a[0], bz = b[2] - a[2], cx = c[0] - a[0], cz = c[2] - a[2];
    const area = bx * cz - bz * cx, sign = Math.sign(area);
    let polygon = clipToEdge(road, a, b, sign);
    if (polygon.length < 3) return;
    polygon = clipToEdge(polygon, b, c, sign);
    if (polygon.length < 3) return;
    polygon = clipToEdge(polygon, c, a, sign);
    if (polygon.length < 3) return;
    const heightAt = (x, z) => {
      const dx = x - a[0], dz = z - a[2];
      return a[1] + (b[1] - a[1]) * (dx * cz - dz * cx) / area + (c[1] - a[1]) * (bx * dz - bz * dx) / area;
    };
    emit(polygon, heightAt);
  });
}

/** Una sola malla para vías y pasos de ladera, con la iluminación y bruma de los cerros. */
export function makeHillsideStreets(routes, facesIn) {
  const positions = [], colors = [], terrainCover = [], indices = [];
  const emit = (polygon, heightAt) => {
    const base = positions.length / 3;
    for (const [x, z, r, g, b] of polygon) {
      positions.push(x, heightAt(x, z) + .08, z);
      colors.push(r, g, b);
      terrainCover.push(-1, 0);
    }
    for (let j = 1; j < polygon.length - 1; j++) indices.push(base, base + j, base + j + 1);
  };
  for (const { curve, width, kind, length } of routes) {
    const street = kind === 'street', edges = street ? [-.5, -.33, .33, .5] : [-.5, .5];
    const steps = Math.max(2, Math.ceil(length / (street ? 5. : 3.)));
    let previous = null;
    for (let i = 0; i <= steps; i++) {
      const { x, z, tx, tz } = locate(curve, i / steps);
      const row = edges.map(edge => {
        const ex = x - tz * width * edge, ez = z + tx * width * edge;
        const tint = 1 + (choice(Math.round(x), Math.round(z), 41) - .5) * .17;
        const outer = Math.abs(edge) > .4;
        const surface = street ? (outer ? [.32, .301, .26] : [.205, .209, .192])
          : kind === 'foot' && i % 4 === 0 ? [.35, .332, .289] : [.28, .265, .234];
        return [ex, ez, ...surface.map(c => c * tint)];
      });
      if (previous) for (let j = 0; j < edges.length - 1; j++) {
        drapeStrip([previous[j], previous[j + 1], row[j + 1], row[j]], facesIn, emit);
      }
      previous = row;
    }
  }
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  mesh.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh.setAttribute('terrainCover', new THREE.Float32BufferAttribute(terrainCover, 2));
  mesh.setIndex(indices);
  mesh.computeVertexNormals();
  return mesh;
}
