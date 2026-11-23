// tests/metro-bogota.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMetroBogota, METRO, metroCenter } from '../src/world/bogota/MetroBogota.js';
import { COLPATRIA } from '../src/world/bogota/Colpatria.js';
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

test('Issue #79: el viaducto del Metro libra Torre Colpatria y no la atraviesa', () => {
  // Torre Colpatria: x=81, width=24 -> ocupa x=69..93, z=155..181
  const colpatriaWest = COLPATRIA.x - COLPATRIA.width / 2; // 69
  for (let z = 155; z <= 181; z += 1) {
    const cx = metroCenter(z);
    const rightDeckEdge = cx + METRO.deckWidth / 2;
    assert.ok(
      rightDeckEdge < colpatriaWest,
      `En z=${z}, el borde derecho del Metro (${rightDeckEdge.toFixed(2)}) debe quedar al occidente de Colpatria (${colpatriaWest})`
    );
  }
});

test('Issue #79: los 7 pilares sobre el viaducto de buses usan pórticos y no bloquean la calzada central', () => {
  const metroGroup = buildMetroBogota();
  const colliders = metroGroup.userData.colliders;

  // En las cotas z=16, 40, 64, 88, 256, 280, 304 el viaducto de buses circula en x=75
  const busOverlappingZ = [16, 40, 64, 88, 256, 280, 304];

  for (const targetZ of busOverlappingZ) {
    // Comprobar que existen los postes izquierdo y derecho del pórtico
    const leftPillar = metroGroup.getObjectByName(`PorticoMetro_Izq_Z${targetZ}`);
    const rightPillar = metroGroup.getObjectByName(`PorticoMetro_Der_Z${targetZ}`);
    assert.ok(leftPillar, `Debe existir columna izquierda de pórtico en z=${targetZ}`);
    assert.ok(rightPillar, `Debe existir columna derecha de pórtico en z=${targetZ}`);

    // Ningún colisionador en esa cota Z debe caer dentro de la calzada de buses (x=71..79)
    const collidersAtZ = colliders.filter(c => Math.abs((c.box.min.z + c.box.max.z) / 2 - targetZ) < 3);
    assert.ok(collidersAtZ.length >= 2, `Debe haber al menos 2 colisionadores de apoyo en z=${targetZ}`);
    for (const c of collidersAtZ) {
      const centerX = (c.box.min.x + c.box.max.x) / 2;
      assert.ok(
        centerX < 71 || centerX > 79,
        `Colisionador en z=${targetZ} tiene x=${centerX.toFixed(2)}, no debe invadir la calzada central del bus (x=71..79)`
      );
    }
  }
});

test('Issue #79: escaleras de las estaciones no invaden calzadas vehiculares y registran colisionadores', () => {
  const metroGroup = buildMetroBogota();
  const colliders = metroGroup.userData.colliders;

  const st72EscNorte = metroGroup.getObjectByName('EstacionMetroCalle72_EscaleraNorte');
  const st72EscSur = metroGroup.getObjectByName('EstacionMetroCalle72_EscaleraSur');
  assert.ok(st72EscNorte, 'Escalera norte de Calle 72 debe existir');
  assert.ok(st72EscSur, 'Escalera sur de Calle 72 debe existir');

  // En Calle 72 (z=115), el separador central está en x=69..80. Las calzadas están en x<=68 y x>=81.
  // Las escaleras deben estar contenidas dentro del separador central (x=69..80).
  const stairsColliders = colliders.filter(c =>
    c.mesh === st72EscNorte || c.mesh === st72EscSur
  );
  assert.equal(stairsColliders.length, 2, 'Ambas escaleras deben tener colisionador Box3 registrado');

  for (const c of stairsColliders) {
    assert.ok(c.box.min.x >= 69, `Colisionador de escalera xMin (${c.box.min.x}) debe estar en el separador (>=69)`);
    assert.ok(c.box.max.x <= 80, `Colisionador de escalera xMax (${c.box.max.x}) debe estar en el separador (<=80)`);
  }
});

