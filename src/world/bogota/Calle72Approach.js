import { Box3, Ray, Vector3 } from 'three';
import { PLAYER_RADIUS } from '../../utils/constants.js';
import { TRANSIT_ANCHORS } from './streetLifePlaces.js';

const STOP = TRANSIT_ANCHORS.find(({ id }) => id === 'metro72');
const LANES = [[57, 69], [81, 93]];
const LANE_EDGES = LANES.flat();
const SOUTH_FROM_CEBRA = 119;

export function calle72DestinationBarrier(collisions) {
  const obstacles = (collisions?.queryStatic?.(69, 85, 81, SOUTH_FROM_CEBRA, []) ?? [])
    .map(entry => entry.box)
    .filter(box => box.max.y > .06 && box.min.y < 1.86)
    .map(box => box.clone().expandByScalar(PLAYER_RADIUS));
  // La polisombra es escénica. El GPS de esta parada la rodea por sus extremos.
  for (const x of [71.8, 78.2]) for (const [from, to] of [[87, 103], [117, 119]]) {
    // En el corredor oriental hay una franja de hierba entre la tela y el andén.
    const east = x === 78.2 && from === 87 ? 79.4 : x + PLAYER_RADIUS;
    obstacles.push(new Box3(new Vector3(x - PLAYER_RADIUS, -1, from - PLAYER_RADIUS),
      new Vector3(east, 2, to + PLAYER_RADIUS)));
  }
  const ray = new Ray(), hit = new Vector3();
  // El mapa también tiene un hito elevado. Solo el POI de pasajes recibe la restricción, incluido su guardado antiguo.
  return (goal, from) => {
    if (goal.name !== STOP.name || goal.x !== 77 || goal.z !== STOP.z) return null;
    // Quien ya quedó en la calzada al cargar o apartarse puede salir hacia el borde más próximo.
    const lane = from.z > 88.4 && from.z < SOUTH_FROM_CEBRA && LANES.find(([west, east]) => from.x > west && from.x < east);
    const exit = lane && (from.x - lane[0] <= lane[1] - from.x ? lane[0] : lane[1]);
    return (ax, az, bx, bz) => {
      // La cebra de Calle 9 llega de ambos costados al separador con margen para el cuerpo dentro de la pintura.
      for (const x of LANE_EDGES) {
        if ((ax < x) === (bx < x)) continue;
        const crossZ = az + (bz - az) * (x - ax) / (bx - ax);
        if (crossZ < 73 || crossZ >= SOUTH_FROM_CEBRA || (crossZ >= 85.6 && crossZ <= 88.4)) continue;
        if (x === exit && ax >= lane[0] && ax < lane[1] && Math.abs(crossZ - from.z) < 1.1) continue;
        return true;
      }
      if (Math.max(ax, bx) < 69 || Math.min(ax, bx) > 81 || Math.min(az, bz) > SOUTH_FROM_CEBRA || Math.max(az, bz) < 85) return false;
      ray.origin.set(ax, .06, az);
      ray.direction.set(bx - ax, 0, bz - az);
      const distance = ray.direction.lengthSq();
      return obstacles.some(box => box.containsPoint(ray.origin) || (distance > 0 &&
        ray.intersectBox(box, hit) !== null && hit.distanceToSquared(ray.origin) <= distance));
    };
  };
}
