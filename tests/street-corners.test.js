import assert from 'node:assert/strict';
import test from 'node:test';
import { Bogota } from '../src/world/districts/Bogota.js';
import { streetIntersections, pedestrianCrossings } from '../src/world/bogota/StreetCrossings.js';
import { planStreetSigns } from '../src/world/bogota/StreetCorners.js';
import { placeSign } from '../src/world/bogota/props.js';

test('el oriente tiene nomenclatura solo donde se encuentran las vías y la placa deja libre la cebra', () => {
  const map = new Bogota()._layout(), intersections = streetIntersections(map);
  const signs = planStreetSigns(map, intersections, () => true);
  assert.ok(signs.some(sign => sign.calle === 'Calle 8A' && sign.carrera === 'Carrera 3'));
  assert.ok(signs.some(sign => sign.calle === 'Calle 7' && sign.carrera === 'Carrera 4'));
  assert.ok(!signs.some(sign => sign.calle === 'Calle 5' && sign.carrera === 'Carrera 3'));
  const crossings = pedestrianCrossings(map, intersections);
  for (const sign of signs) {
    assert.ok(['sidewalk', 'plaza'].includes(map[Math.round(sign.z / 2)][Math.round(sign.x / 2)]));
    for (const path of crossings) {
      const along = (sign.x - path.x) * path.dx + (sign.z - path.z) * path.dz;
      const across = Math.abs((sign.x - path.x) * path.dz - (sign.z - path.z) * path.dx);
      assert.ok(along < -1.1 || along > path.length + 1.1 || across > path.width / 2,
        `placa sobre la rampa de ${sign.calle} con ${sign.carrera}`);
    }
  }
  assert.equal(planStreetSigns(map, intersections, () => false).length, 0);
});

test('el carro parqueado deja libre el ancho de cada paso de peatones', () => {
  const city = new Bogota();
  city.map = city._layout();
  const crossings = pedestrianCrossings(city.map), spots = city.getParkingSpots();
  assert.ok(spots.length > 100);
  for (const spot of spots) {
    const halfX = spot.rot ? 1.15 : 2.7, halfZ = spot.rot ? 2.7 : 1.15;
    for (const path of crossings) {
      const dx = path.dz * path.width / 2, dz = path.dx * path.width / 2;
      assert.ok(spot.x + halfX <= path.x - dx || spot.x - halfX >= path.x + path.dx * path.length + dx ||
        spot.z + halfZ <= path.z - dz || spot.z - halfZ >= path.z + path.dz * path.length + dz,
        `carro sobre la cebra de ${path.x},${path.z}`);
    }
  }
});

test('las entradas de parques y plazas usan una sola hoja de rótulos', () => {
  const a = placeSign('Parque del Lago', 'park'), b = placeSign('Plaza de la Candelaria', 'plaza');
  const panel = group => group.children.find(mesh => mesh.geometry.parameters.width > 1);
  assert.equal(panel(a).material, panel(b).material);
  assert.notDeepEqual(panel(a).geometry.attributes.uv.array, panel(b).geometry.attributes.uv.array);
});
