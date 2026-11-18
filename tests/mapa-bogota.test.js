// tests/mapa-bogota.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cityMapPlan, streetLabels, cityLandmarks } from '../src/world/bogota/CityMapRaster.js';
import { buildRealBogotaOSM } from '../src/world/bogota/RealBogotaOSM.js';

test('streetLabels: incluye las principales vías de la cuadrícula real de Bogotá', () => {
  const labels = streetLabels(2);
  const names = labels.map(l => l.name);

  // Calles clave
  assert.ok(names.includes('Calle 93'), 'Debe incluir Calle 93');
  assert.ok(names.includes('Calle 82'), 'Debe incluir Calle 82');
  assert.ok(names.includes('Calle 72'), 'Debe incluir Calle 72');
  assert.ok(names.includes('Av. Calle 26'), 'Debe incluir Av. Calle 26');
  assert.ok(names.includes('Calle 10'), 'Debe incluir Calle 10');
  assert.ok(names.includes('Calle 6'), 'Debe incluir Calle 6');

  // Carreras clave
  assert.ok(names.includes('Carrera 15'), 'Debe incluir Carrera 15');
  assert.ok(names.some(n => n.includes('Av. Caracas')), 'Debe incluir Av. Caracas');
  assert.ok(names.includes('Carrera 10'), 'Debe incluir Carrera 10');
  assert.ok(names.some(n => n.includes('Carrera 7')), 'Debe incluir Carrera 7');
  assert.ok(names.includes('Carrera 5'), 'Debe incluir Carrera 5');
});

test('cityLandmarks: incluye los hitos urbanos, el Metro L1 y la historia de Los Reyes', () => {
  const landmarks = cityLandmarks(2);
  const names = landmarks.map(l => l.name);

  // Hitos de la historia Los Reyes
  assert.ok(names.some(n => n.includes('Mansión Reyes')), 'Debe incluir la Mansión Reyes en Rosales');
  assert.ok(names.some(n => n.includes('Zona T') || n.includes('Tarima')), 'Debe incluir la Zona T / Tarima');
  assert.ok(names.some(n => n.includes('Paloquemao') || n.includes('Mercado')), 'Debe incluir Paloquemao / Mercado');

  // Metro de Bogotá (Línea 1 PLMB)
  assert.ok(names.some(n => n.includes('Metro') && n.includes('Calle 72')), 'Debe incluir Estación Calle 72');
  assert.ok(names.some(n => n.includes('Metro') && n.includes('Calle 26')), 'Debe incluir Estación Calle 26');
  assert.ok(names.some(n => n.includes('Metro') && n.includes('Viaducto')), 'Debe incluir Viaducto Caracas');

  // Hitos emblemáticos
  assert.ok(names.some(n => n.includes('Torre Colpatria')), 'Debe incluir Torre Colpatria');
  assert.ok(names.some(n => n.includes('GER')), 'Debe incluir Sede Grupo GER');
  assert.ok(names.some(n => n.includes('Portal del Centro')), 'Debe incluir Portal del Centro TransMilenio');
  assert.ok(names.some(n => n.includes('Parque de la 93')), 'Debe incluir Parque de la 93');
});

test('cityMapPlan: define el trazado y geometría del viaducto del Metro', () => {
  const mockDistrict = {
    map: Array.from({ length: 200 }, () => Array.from({ length: 100 }, () => 'road')),
    tileTypeAt: () => 'road'
  };
  const plan = cityMapPlan(mockDistrict, 2);
  const tiles = plan.tiles();

  assert.ok(tiles.metro, 'El plan debe contener datos del viaducto del metro');
  assert.equal(tiles.metro.ancho, 7, 'El ancho del viaducto debe ser de 7 metros');
  assert.ok(tiles.metro.puntos.length > 50, 'El viaducto debe contar con múltiples puntos a lo largo de la Caracas');
  assert.ok(tiles.metro.puntos.every(([x]) => x === 75), 'Los puntos del viaducto están situados sobre el eje de la Av. Caracas');
});

test('buildRealBogotaOSM: extruye edificaciones reales de OpenStreetMap e IDECA en Three.js', () => {
  const group = buildRealBogotaOSM();
  assert.equal(group.name, 'RealBogotaOSM_IDECA');
  assert.ok(group.children.length >= 5, 'Contiene los grupos 3D de La Santamaría, Planetario, Museo Nacional, Mansión Reyes y Tarima Zona T');
  assert.ok(group.getObjectByName('Plaza de Toros de Santamaría'), 'Incluye Plaza de Toros de Santamaría');
  assert.ok(group.getObjectByName('Planetario Distrital de Bogotá'), 'Incluye Planetario Distrital');
  assert.ok(group.getObjectByName('Museo Nacional de Colombia (El Panóptico)'), 'Incluye Museo Nacional');
  assert.ok(group.getObjectByName('Mansión de la Familia Reyes (Zona G / Rosales)'), 'Incluye Mansión de Los Reyes');
  assert.ok(group.userData.osmDataset.buildings.length >= 8, 'El dataset OSM/IDECA incluye al menos 8 hitos con huellas poligonales');
});
