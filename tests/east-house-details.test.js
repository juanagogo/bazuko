import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildColonialHouse, buildEnglishHouse, planEastLots } from '../src/world/bogota/EastBuildings.js';
import { BASE_CITY_WIDTH, paintEastCity } from '../src/world/bogota/EastZones.js';
import { CITY_HEIGHT } from '../src/world/bogota/CityLayout.js';
import { createZoneMaterials } from '../src/world/bogota/ZoneGeometry.js';
import { CLAY_ROOF, RED_BRICK_METERS } from '../src/world/bogota/ZoneTextures.js';

const map = paintEastCity(Array.from({ length: CITY_HEIGHT }, () => Array(BASE_CITY_WIDTH).fill('building')));
const { lots } = planEastLots(map);
const m = createZoneMaterials();
const normalOf = (face, p, i) => face < 2 ? p.getX(i) * (face === 0 ? 1 : -1) : p.getZ(i) * (face === 4 ? 1 : -1);
const vertexIndices = p => Array.from({ length: p.count }, (_, i) => i);

test('el canto del tejado colonial tiene canal y cobija a escala y el faldón mira arriba en los cuatro frentes', () => {
  for (const face of [0, 1, 4, 5]) {
    const lot = lots.find(lot => lot.zone === 'colonial' && lot.face === face);
    const { shell } = buildColonialHouse(lot, m);
    const roof = shell.roof.children.find(mesh => mesh.material === m.clay && mesh.name === 'Tejado colonial');
    const p = roof.geometry.attributes.position, n = roof.geometry.attributes.normal;
    const eave = lot.depthTiles + .74;
    const indices = vertexIndices(p);
    const contour = indices.filter(i => Math.abs(normalOf(face, p, i) - eave) < .002);
    const levels = new Set(contour.filter(i => n.getY(i) > .1).map(i => Math.round(p.getY(i) * 1000)));
    const columns = Math.ceil((lot.spanTiles * 2 + .36) / (CLAY_ROOF.meters / CLAY_ROOF.columns));
    assert.ok(levels.size >= 3, `perfil de teja en fachada ${face}`);
    assert.ok(indices.every(i => n.getY(i) >= 0), `faldones y cantos exteriores en fachada ${face}`);
    assert.ok(roof.geometry.index.count / 3 <= (columns + 1) * 32, 'los faldones comparten una sección por canal');
  }
});

test('los balcones de gabinete son una variante y sus cubiertas quedan bajo el alero', () => {
  let cabinets = 0, twoStoreys = 0;
  for (const lot of lots.filter(lot => lot.zone === 'colonial')) {
    const { shell, height } = buildColonialHouse(lot, m);
    if (height > 6) twoStoreys++;
    const cabinet = shell.walls.get(lot.face).children.find(mesh => mesh.material === m.clay);
    if (!cabinet) continue;
    cabinets++;
    const bounds = cabinet.geometry.boundingBox;
    assert.ok(bounds.max.y < height);
    assert.ok(bounds.min.y > 5);
  }
  assert.ok(cabinets > 0 && cabinets < twoStoreys / 2);
});

test('la bahía de Chapinero queda dentro del antejardín y el cerramiento conserva el aparejo en metros', () => {
  for (const lot of lots.filter(lot => lot.zone === 'ladrillo' && !lot.commercial)) {
    const { shell } = buildEnglishHouse(lot, m);
    const garden = lot.depthTiles >= 4 ? 2 : 1.2;
    const facade = shell.walls.get(lot.face).children.filter(mesh => mesh.name === 'Fachada inglesa');
    for (const mesh of facade) {
      const p = mesh.geometry.attributes.position;
      const limit = lot.depthTiles + garden / 2;
      assert.ok(vertexIndices(p).every(i => normalOf(lot.face, p, i) <= limit + .001), `fachada del solar ${lot.x0},${lot.z0}`);
    }
    const masonry = facade.find(mesh => mesh.material === m.brick).geometry.attributes.position;
    const bayBase = vertexIndices(masonry).filter(i => Math.abs(masonry.getY(i) - .12) < .002);
    const planes = new Set(bayBase.map(i => Math.round(normalOf(lot.face, masonry, i) * 1000)));
    assert.ok(planes.size >= 2, 'el basamento gira en los chaflanes');

    const fence = shell.base.children.find(mesh => mesh.name === 'Antejardín' && mesh.material === m.brick);
    const { position: p, uv } = fence.geometry.attributes;
    for (let i = 0; i < p.count; i += 4) {
      const length = Math.hypot(p.getX(i + 1) - p.getX(i), p.getY(i + 1) - p.getY(i), p.getZ(i + 1) - p.getZ(i));
      const span = uv.getX(i + 1) - uv.getX(i);
      assert.ok(Math.abs(length - span * RED_BRICK_METERS) < .001, 'ladrillo continuo en cada cara de la reja y sus pilares');
    }
  }
});
