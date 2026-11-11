// tests/metro-bogota.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMetroBogota, METRO } from '../src/world/bogota/MetroBogota.js';
import { ZONA_NOMBRES } from '../src/ui/ZonaAviso.js';
import { cityLandmarks, cityMapPlan } from '../src/world/bogota/CityMapRaster.js';

test('MetroBogota: constantes y geometría del viaducto elevado', () => {
  assert.equal(METRO.x, 75, 'Eje central sobre la Avenida Caracas');
  assert.equal(METRO.trackHeight, 12.5, 'Cota de vía elevada a 12.5 metros');
  assert.ok(METRO.zEnd > METRO.zStart, 'Viaducto con longitud válida');
  assert.ok(METRO.deckWidth > 8, 'Ancho para doble vía');
});

test('MetroBogota: buildMetroBogota genera viaducto, tren, estaciones y colisiones', () => {
  const metroGroup = buildMetroBogota();

  assert.equal(metroGroup.name, 'MetroBogota');
  assert.ok(metroGroup.children.length > 0, 'Contiene elementos 3D');

  // Estaciones elevadas
  const st72 = metroGroup.getObjectByName('EstacionMetroCalle72');
  const st26 = metroGroup.getObjectByName('EstacionMetroCalle26');
  assert.ok(st72, 'Estación Calle 72 debe existir');
  assert.ok(st26, 'Estación Calle 26 debe existir');

  // Colisionadores para pilas
  const colliders = metroGroup.userData.colliders;
  assert.ok(Array.isArray(colliders) && colliders.length > 0, 'Debe registrar colisionadores para las pilas');
  for (const c of colliders) {
    assert.ok(c.box, 'Cada colisionador debe tener una Box3');
    assert.equal(c.box.min.x < c.box.max.x, true);
    assert.equal(c.box.min.z < c.box.max.z, true);
  }
});

test('MetroBogota: aviso de zona registrado y puntos en el mapa', () => {
  assert.ok(ZONA_NOMBRES.metro, 'La zona "metro" debe tener nombre asignado');
  assert.match(ZONA_NOMBRES.metro, /Metro de Bogotá/);

  const landmarks = cityLandmarks();
  const metroLandmarks = landmarks.filter(l => l.name.includes('Metro de Bogotá'));
  assert.ok(metroLandmarks.length >= 2, 'Deben registrarse al menos dos hitos del Metro en el mapa');
});
