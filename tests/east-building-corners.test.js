import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildColonialHouse, buildEnglishHouse, planEastLots } from '../src/world/bogota/EastBuildings.js';
import { BASE_CITY_WIDTH, paintEastCity } from '../src/world/bogota/EastZones.js';
import { CITY_HEIGHT } from '../src/world/bogota/CityLayout.js';
import { createZoneMaterials } from '../src/world/bogota/ZoneGeometry.js';

test('los murales, ventanas laterales y aleros miran al espacio público desde el costado correcto', () => {
  const map = paintEastCity(Array.from({ length: CITY_HEIGHT }, () => Array(BASE_CITY_WIDTH).fill('building')));
  const materials = createZoneMaterials();
  const publicTiles = new Set(['sidewalk', 'plaza', 'road', 'grass', 'dirt', 'floor', 'busway']);
  let murals = 0, windowWalls = 0;
  for (const lot of planEastLots(map).lots) {
    if (lot.commercial) continue;
    const colonial = lot.zone === 'colonial';
    const { shell } = colonial ? buildColonialHouse(lot, materials, [[0, 0, 1, 1]]) : buildEnglishHouse(lot, materials);
    const roof = shell.roof.children.find(mesh => mesh.name === 'Tejado colonial' && mesh.material === materials.clay);
    if (colonial) roof.geometry.computeBoundingBox();
    const { x0, x1, z0, z1 } = lot;
    const edges = lot.face < 2
      ? [[5, map[z0 - 1].slice(x0, x1 + 1)], [4, map[z1 + 1].slice(x0, x1 + 1)]]
      : [[1, map.slice(z0, z1 + 1).map(row => row[x0 - 1])], [0, map.slice(z0, z1 + 1).map(row => row[x1 + 1])]];
    for (const [face, tiles] of edges) {
      const open = tiles.every(tile => publicTiles.has(tile));
      const wall = shell.walls.get(face);
      if (colonial) {
        if (wall.getObjectByName('Mural de culata')) {
          assert.ok(open, `mural en medianera del solar ${x0},${z0}`);
          murals++;
        }
        const box = roof.geometry.boundingBox;
        const edge = { 0: box.max.x, 1: -box.min.x, 4: box.max.z, 5: -box.min.z }[face];
        const halfWidth = face < 2 ? x1 - x0 + 1 : z1 - z0 + 1;
        assert.ok(Math.abs(edge - halfWidth - (open ? .18 : 0)) < .001, 'el alero termina en la medianera');
      } else {
        const hasWindows = Boolean(wall.getObjectByName('Lateral inglés'));
        assert.equal(hasWindows, open, `ventanas de la cara ${face} en ${x0},${z0}`);
        if (hasWindows) windowWalls++;
      }
    }
  }
  assert.ok(murals > 0 && windowWalls > 0);
});
