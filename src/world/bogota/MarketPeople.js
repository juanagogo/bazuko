import { Vector3 } from 'three';
import { PLAYER_SPEED_WALK } from '../../utils/constants.js';

const NEIGHBORS = new Set(['senora', 'vendedor', 'abuelo']);
const ATTEND = ['atender', 'atender', 'manos-atras', 'mirar-derecha'];
const VISIT_RANGE = 215;

function approaches(navigation, walkers, spot) {
  return walkers.flatMap(npc => {
    // Empieza por el centro de su propia baldosa para conservar los tramos libres de obstáculos.
    const start = navigation.nearestPoint(npc.position.x, npc.position.z);
    const route = start ? navigation.routeTo(start, spot) : [];
    if (!route.length) return [];
    let previous = start;
    let distance = npc.position.distanceTo(start);
    for (const point of route) {
      distance += previous.distanceTo(point);
      previous = point;
    }
    route.unshift(start);
    return [{ npc, route, time: distance / npc.walkSpeed }];
  });
}

/** Dos vecinos alternan sus paradas de mercado con recorridos por el pavimento. */
export function startMarketVisits(market, navigation, arrival, player, time) {
  const north = market?.colliders[1], south = market?.colliders[4];
  if (!north || !south) return;
  const distance = Math.hypot(player.x - north.x, player.z - (north.z + south.z) / 2);
  if (distance > VISIT_RANGE) return;
  arrival.nearSince ??= time;
  const place = (stall, dx, dz) => {
    const x = stall.x + dx, z = stall.z + dz;
    return new Vector3(x, navigation.groundHeight(x, z), z);
  };
  // El encargado queda a un lado del bombillo; la visita se detiene junto al canasto del rincón público.
  const service = place(north, .38, -1.36), browse = place(south, -2.3, -1.52);
  if (!navigation.isSidewalkAt(service) || !navigation.isSidewalkAt(browse)) return;
  const around = (home, x, z, spread) => {
    const entry = navigation.nearestPoint(home.x, home.z);
    const stops = [-spread, spread].map(dx => navigation.nearestPoint(x + dx, z))
      .filter(stop => stop && !stop.equals(entry));
    return entry && stops.length ? { entry, stops } : null;
  };
  const serviceWalk = around(service, north.x, north.z - 2.32, 5);
  const browseWalk = around(browse, browse.x, browse.z - 1.6, 2);
  const browseRetreat = around(browse, south.x, south.z - 2.32, 5);
  if (!serviceWalk || !browseWalk || !browseRetreat) return;

  // Los cuerpos, sus prendas y sus semillas ya están decididos. Las manos quedan libres para las posturas.
  const near = arrival.walkers.filter(npc => npc.canStartVisit() && navigation.isSidewalkAt(npc.position) &&
    !npc.person.style?.carry && !npc.person.real.accesorios.some(item => item.id === 'casco'));
  // Elegir los dos recorridos juntos evita que el primero deje al segundo el trayecto más largo.
  let attendant, visitor, best = Infinity;
  const toService = approaches(navigation, near, service), toBrowse = approaches(navigation, near, browse);
  for (const north of toService) for (const south of toBrowse) {
    if (north.npc === south.npc) continue;
    const familiar = NEIGHBORS.has(north.npc.person.arquetipo);
    const distinct = north.npc.person.arquetipo !== south.npc.person.arquetipo;
    const score = Math.max(north.time, south.time) + .15 * (north.time + south.time) + (familiar ? 0 : 5) + (distinct ? 0 : 3);
    if (score < best) { best = score; attendant = north; visitor = south; }
  }
  if (!attendant || !visitor) return;
  // Un vecino que aún está cruzando puede acercarse enseguida. Dale ese margen antes de elegir a alguien más lejos.
  if (time - arrival.nearSince < 12 && Math.max(attendant.time, visitor.time) > distance / PLAYER_SPEED_WALK + 25) return;
  attendant.npc.startVisit(service, attendant.route, {
    ...serviceWalk, facing: -.12, stance: 'atender', wait: 18, alternas: ATTEND, sheltered: true,
  });
  const basketFacing = Math.atan2(south.x - .45 - browse.x, south.z - 1.02 - browse.z);
  visitor.npc.startVisit(browse, visitor.route, {
    ...browseWalk, safeStops: browseRetreat.stops, facing: basketFacing, stance: 'mirar-surtido', wait: 7,
  });
  return true;
}
