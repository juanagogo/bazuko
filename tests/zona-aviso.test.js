import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAKE_PARK } from '../src/world/bogota/LakePark.js';
import { ZONA_NOMBRES, ZonaAviso, zonaDe } from '../src/ui/ZonaAviso.js';

function fakeDoc() {
  const body = { children: [], append(node) { this.children.push(node); } };
  const radar = { children: [], append(node) { this.children.push(node); } };
  return {
    body, radar,
    createElement(tag) { return { tag, className: '', textContent: '', hidden: false }; },
    getElementById: (id) => (id === 'minimap-container' ? radar : null)
  };
}

test('la zona sale de _zoneAt y todo el parque del sur es lago', () => {
  const district = { _zoneAt: () => 'barrio' };
  for (const x of [19, 75, 131, 180]) assert.equal(zonaDe(district, x, LAKE_PARK.z0 + 30), 'lago', `x ${x}`);
  assert.equal(zonaDe(district, 240, LAKE_PARK.z0 + 30), 'barrio', 'al oriente manda Chapinero');
  assert.equal(zonaDe(district, 10, 10), 'barrio');
  assert.equal(zonaDe(null, 10, 10), 'andenes');
  for (const zona of ['cartucho', 'parque', 'candelaria', 'chapinero', 'andenes', 'barrio', 'lago']) {
    assert.ok(ZONA_NOMBRES[zona], zona);
  }
});

test('el cartel sale al entrar a una zona y se va solo', () => {
  const doc = fakeDoc();
  const aviso = new ZonaAviso({ doc });
  assert.equal(aviso.cartelEl.hidden, true);
  const district = { _zoneAt: (x) => (x > 50 ? 'cartucho' : 'andenes') };
  aviso.update(1 / 60, district, 10, 10);
  assert.equal(aviso.cartelEl.hidden, false);
  assert.equal(aviso.cartelEl.textContent, 'El centro');
  aviso.update(1, district, 10, 10);
  assert.equal(aviso.cartelEl.hidden, false, 'sigue mientras dura');
  aviso.update(3, district, 10, 10);
  assert.equal(aviso.cartelEl.hidden, true);
  aviso.update(1 / 60, district, 60, 10);
  assert.equal(aviso.cartelEl.hidden, false);
  assert.equal(aviso.cartelEl.textContent, 'El Cartucho');
  aviso.update(1, district, 60, 10);
  assert.equal(aviso.cartelEl.textContent, 'El Cartucho', 'no se repite en la misma zona');
});

test('bajo el radar se escribe la vía actual, sin reescribirla cada cuadro', () => {
  const doc = fakeDoc();
  const aviso = new ZonaAviso({ doc });
  const district = { _zoneAt: () => 'andenes' };
  aviso.update(1 / 60, district, 20, 40);
  assert.equal(aviso.calleEl.textContent, 'la Carrera 15 · Chicó');
  assert.equal(doc.radar.children[0], aviso.calleEl);
  aviso.update(.1, district, 112, 97);
  assert.equal(aviso.calleEl.textContent, 'la Carrera 15 · Chicó', 'dentro del intervalo no cambia');
  aviso.update(.4, district, 112, 97);
  assert.equal(aviso.calleEl.textContent, 'la Carrera 10 · La Décima');
});
