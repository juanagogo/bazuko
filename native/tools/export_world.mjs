// Vuelca la referencia del mundo calculada por el código JS original (src) a
// native/data/world_reference.json. Los tests de C++ comparan su implementación contra ella.
//   node tools/export_world.mjs        (requiere `npm ci` en la raíz)
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../src');
const load = (p) => import(pathToFileURL(resolve(web, p)).href);

const THREE = await import(pathToFileURL(resolve(here, '../../node_modules/three/build/three.module.js')).href);
const { Bogota } = await load('world/districts/Bogota.js');
const S = await load('world/bogota/StreetLayout.js');
const Cy = await load('world/bogota/CityLayout.js');
const { CollisionSystem } = await load('systems/CollisionSystem.js');
const { rng } = await load('world/bogota/textures.js');

const T = 2;
const W = (t) => t * T;
const WX = S.STREET_X.world, WZ = S.STREET_Z.world;

const city = new Bogota();
const map = city._layout();
city.map = map;

const CODE = { wall: 'W', road: 'R', busway: 'B', sidewalk: 'S', dirt: 'D', grass: 'G', plaza: 'P', floor: 'F', building: 'b', ruin: 'r' };
const rows = map.map((row) => row.map((t) => CODE[t] ?? (() => { throw new Error(`tile ${t}`); })()).join(''));

// ---- reservados (idéntico a Bogota.build) ----
const reserved = {
  spawn: { x: WX(20), z: WZ(11) }, sell: { x: WX(14.5), z: WZ(34) }, bed: { x: WX(44.5), z: WZ(40) },
  dealer: { x: WX(14.5), z: WZ(21.5) }, craft: { x: WX(16.5), z: WZ(24.5) }, shop: { x: WX(34), z: WZ(29) },
};
city.reserved = reserved;
const isNearReserved = (x, z, dist = 6) => Object.values(reserved).some((r) => Math.hypot(x - r.x, z - r.z) < dist);
const spawnGrid = [];
for (let tz = 2; tz < city.height - 2; tz += 3) for (let tx = 2; tx < city.width - 2; tx += 3) {
  if (!['sidewalk', 'dirt', 'grass', 'plaza'].includes(map[tz][tx])) continue;
  if (isNearReserved(W(tx), W(tz))) continue;
  spawnGrid.push([W(tx), W(tz)]);
}

// ---- tráfico y bus ----
const routes = city.getTrafficRoutes();
const lane = ([a, b], side) => W((a + b) / 2 + side * (b - a + 1) / 4);
const routeSamples = routes.map((r) => {
  const pos = new THREE.Vector3(), dir = new THREE.Vector3();
  const out = [];
  for (let i = 0; i < 40; i++) {
    const d = i * r.length / 40 + i * 0.37 - 5;  // incluye negativos y vueltas
    r.sample(d, pos, dir);
    out.push([d, pos.x, pos.z, dir.x, dir.z]);
  }
  return { length: r.length, samples: out, segments: r.segments.length };
});
const busRoute = city.getBusRoute.call({ height: city.height });
const parking = city.getParkingSpots();

// ---- colisiones ----
const colliders = new CollisionSystem();
city._buildCollisions(map, colliders);
const boxes = colliders.colliders.map(({ box }) => [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]);
const r1 = rng(2024);
const moves = [];
const out = new THREE.Vector3();
for (let i = 0; i < 400; i++) {
  const b = boxes[Math.floor(r1() * boxes.length)];
  const start = new THREE.Vector3(b[0] + r1() * (b[3] - b[0] + 2) - 1, 0, b[2] + r1() * (b[5] - b[2] + 2) - 1);
  const delta = new THREE.Vector3((r1() - 0.5) * 3, 0, (r1() - 0.5) * 3);
  colliders.resolveMove(start, delta, 0.4, out);
  moves.push([start.x, start.z, delta.x, delta.z, out.x, out.z]);
}

// ---- navegación peatonal ----
const nav = city._createPedestrianNavigation();
let crossing = 0, edges = 0;
for (const n of nav.nodes) { if (n.crossing) crossing++; edges += n.neighbors.length; }
const r2 = rng(777);
const routesNav = [];
const startPoints = [[13.5, 20], [33.5, 36], [18, 11], [8, 37], [30, 29], [5, 18]];
for (const [x, z] of startPoints) {
  const p = nav.nearestPoint(WX(x), WZ(z));
  const route = nav.createRoute(p, r2);
  routesNav.push({ start: [p.x, p.z], route: route.map((q) => [q.x, q.z]) });
}
const spots = [
  [13.5, 20], [15.5, 20.5], [13, 23], [16, 23.5], [11, 21.8], [18, 22.4], [17, 19], [12.5, 21], [19.8, 21.5],
  [33.5, 36], [34, 43], [21, 30], [18, 11], [21, 11], [21, 16], [28, 19], [39, 20], [8, 27], [5, 18], [30, 29],
  [37, 32], [8, 37],
];
const people = [];
for (const [x, z] of spots) {
  const p = nav.nearestPoint(WX(x), WZ(z));
  if (p) people.push([p.x, p.z]);
}
const candidates = nav.nodes.filter((n) => !n.crossing && (n.x >= Cy.ORIGINAL_CITY_WIDTH - 1 || n.z >= Cy.ORIGINAL_CITY_HEIGHT - 1));
const extra = Math.min(candidates.length, Math.round(spots.length * (city.populationScale - 1)));
for (let i = 0; i < extra; i++) {
  const n = candidates[Math.floor((i + 0.5) * candidates.length / extra)];
  people.push([W(n.x), W(n.z)]);
}

// ---- vendedores (idéntico a las llamadas _vendor de Bogota) ----
const CITY_CARRERAS = Cy.CITY_CARRERAS, CITY_CALLES = Cy.CITY_CALLES;
const vendors = [
  [WX(21), WZ(18.5), Math.PI / 2, 'chaza', 'Chaza de don Efraín', ['cigarrillo', 'cafe', 'pan', 'agua']],
  [WX(28), WZ(29), 0, 'fritanga', 'Fritanga La Mona', ['lataComida', 'pan', 'refresco']],
  [WX(39), WZ(36), -Math.PI / 2, 'chaza', 'Dulces y minutos', ['cigarrillo', 'refresco', 'agua']],
  [WX(18.5), WZ(21.5), 0, 'chaza', 'Chaza del callejón', ['cigarrillo', 'pan', 'agua']],
  [W(CITY_CARRERAS[2][0] - 1.5), W(55), Math.PI / 2, 'chaza', 'Chaza de la Carrera 8', ['agua', 'pan', 'cafe']],
  [W(52), W(CITY_CALLES[2][0] - 1.5), 0, 'fritanga', 'Fritanga del Sur', ['lataComida', 'pan', 'refresco']],
].map(([x, z, rot, kind, title, items]) => ({ x, z, rot, kind, title, items }));

const axisInfo = (a) => ({ widths: a.widths, size: a.size });
const sampleAxis = (a) => {
  const out = [];
  for (let v = -1; v <= 48; v += 0.125) out.push([v, a.tile(v), a.world(v), a.original(a.tile(v))]);
  return out;
};
const migrations = [];
for (const v of [0, 1, 2, 3]) for (const p of [[89, 0.04, 80], [10, 0, 30], [52, 0, 23], [141, 0, 104]]) {
  migrations.push({ version: v, from: p, to: S.migrateStreetPosition(p, v) });
}

const ref = {
  version: 1,
  tileSize: T,
  width: city.width, height: city.height, populationScale: city.populationScale,
  layoutVersion: S.WORLD_LAYOUT_VERSION,
  legend: CODE,
  rows,
  streets: {
    x: axisInfo(S.STREET_X), z: axisInfo(S.STREET_Z),
    carreras: S.CARRERAS, calles: S.CALLES, caracas: S.CARACAS,
    cityCarreras: Cy.CITY_CARRERAS, cityCalles: Cy.CITY_CALLES, parks: Cy.EXTENSION_PARKS,
    axisSamplesX: sampleAxis(S.STREET_X), axisSamplesZ: sampleAxis(S.STREET_Z),
    migrations,
  },
  reserved,
  spawnGrid,
  trafficRoutes: routes.map((r, i) => ({ length: r.length, ...routeSamples[i] })),
  routeCorners: routes.map((r) => [r.segments[0].x - 1, r.segments[2].x, r.segments[0].z, r.segments[4].z]),
  bus: busRoute,
  parking,
  collisions: { boxes, moves },
  pedestrians: { nodes: nav.nodes.length, crossing, edges, routes: routesNav, people },
  vendors,
  rngSamples: Object.fromEntries([1, 777, 2024, 4294967295].map((seed) => { const r = rng(seed); return [seed, Array.from({ length: 8 }, () => r())]; })),
};
void lane;
const outPath = resolve(here, '../data/world_reference.json');
writeFileSync(outPath, JSON.stringify(ref));
console.log(`OK ${outPath}: mapa ${ref.width}x${ref.height}, ${boxes.length} cajas, ${nav.nodes.length} nodos, ${people.length} peatones, ${vendors.length} vendedores, ${parking.length} puestos`);
