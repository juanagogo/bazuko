import { isFreeSpot } from './streetLifePlaces.js';

const FACADES = [
  { id: 'centro', name: 'Portería del Centro', x: 45, z: 56 },
  { id: 'caracas', name: 'Edificio de la Caracas', x: 83, z: 124 },
  { id: 'parque-lago', name: 'Edificio frente al Parque del Lago', x: 112, z: 207 },
  { id: 'candelaria', name: 'Casa de La Candelaria', x: 295, z: 58 }
];
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SIDEWALK = new Set(['sidewalk']);

export function deliveryPlaces(district, collisions, shop) {
  const ground = (x, z) => district.getMovementGroundHeight(x, z, 0);
  const shops = [{ id: 'esquinita', name: 'Tienda La Esquinita',
    position: { x: shop.position.x, z: shop.position.z + 1.1, y: ground(shop.position.x, shop.position.z + 1.1) } }];
  for (const vendor of district.vendors ?? []) {
    const { x, z } = vendor.position;
    const frontX = x + Math.sin(vendor.facing) * 1.1;
    const frontZ = z + Math.cos(vendor.facing) * 1.1;
    shops.push({ id: `puesto-${x}-${z}`, name: vendor.title, position: { x: frontX, y: ground(frontX, frontZ), z: frontZ } });
  }

  const clients = (district.npcs ?? []).filter(npc => npc.fijo && !npc.fijo.techo && !npc.isVendor)
    .map(npc => ({
      id: `vecino-${npc.home.x}-${npc.home.z}`, name: 'Cliente en la calle',
      type: 'person', npc, position: npc.position
    }));
  for (const facade of FACADES) {
    const candidates = [];
    const tx = Math.round(facade.x / 2), tz = Math.round(facade.z / 2);
    for (let z = tz - 14; z <= tz + 14; z++) {
      for (let x = tx - 14; x <= tx + 14; x++) {
        if (district.tileTypeAt(x, z) !== 'sidewalk') continue;
        if (!DIRECTIONS.some(([dx, dz]) => district.tileTypeAt(x + dx, z + dz) === 'building')) continue;
        candidates.push({ x: x * 2, z: z * 2 });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - facade.x, a.z - facade.z) - Math.hypot(b.x - facade.x, b.z - facade.z));
    const entrance = candidates.find(({ x, z }) => isFreeSpot(district, collisions, x, z, .8, SIDEWALK));
    if (entrance) clients.push({ id: facade.id, name: facade.name, type: 'building',
      position: { ...entrance, y: ground(entrance.x, entrance.z) } });
  }
  return { shops, clients };
}
