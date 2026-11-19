import * as THREE from 'three';
import { PLAYER_RADIUS, TILE_SIZE as T } from '../../utils/constants.js';
import { CALLES, CARACAS, SIDEWALK_TILES } from './StreetLayout.js';
import { crossingTiles } from './StreetCrossings.js';

// La Calle 9 y la aproximación desde el cambuche. Su paso pintado continúa entre pilas de los viaductos.
const [firstRow, lastRow] = CALLES.find(([, , name]) => name === 'Calle 9');
const minX = (CARACAS.lanes[0][0] - .5) * T, maxX = (CARACAS.lanes[1][1] + .5) * T;
const minZ = (firstRow - .5 - SIDEWALK_TILES / 2) * T;
const maxZ = (lastRow + .5 + SIDEWALK_TILES / 2 + 6) * T;
// Dos filas de margen separan la aproximación por la cebra del acceso más al sur a Calle 72.
const crossingMaxZ = maxZ + 2 * T;
const west = minX - SIDEWALK_TILES * T, east = maxX + (SIDEWALK_TILES + 4) * T;

export function caracasNavigation(map, collisions) {
  const crossings = crossingTiles(map), columns = map[0].length;
  const footprints = collisions.queryStatic(west, minZ, east, maxZ, [])
    .map(entry => entry.box)
    .filter(box => box.min.y < .25 && box.max.y > 1 && box.max.x >= west && box.min.x <= east && box.max.z >= minZ && box.min.z <= maxZ)
    .map(box => {
      const ground = box.clone().expandByScalar(PLAYER_RADIUS + .15);
      ground.min.y = -1;
      ground.max.y = 1;
      return ground;
    });
  const ray = new THREE.Ray(), hit = new THREE.Vector3();
  return {
    marked(tx, tz) {
      const x = tx * T, z = tz * T;
      return x >= minX && x <= maxX && z >= minZ && z <= crossingMaxZ ? crossings[tz * columns + tx] === 1 : undefined;
    },
    blocked(ax, az, bx = ax, bz = az) {
      if (Math.max(ax, bx) < west || Math.min(ax, bx) > east || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) return false;
      ray.origin.set(ax, 0, az);
      ray.direction.set(bx - ax, 0, bz - az);
      const length2 = ray.direction.lengthSq();
      return footprints.some(box => box.containsPoint(ray.origin) || (length2 > 0 &&
        ray.intersectBox(box, hit) !== null && hit.distanceToSquared(ray.origin) <= length2));
    }
  };
}
