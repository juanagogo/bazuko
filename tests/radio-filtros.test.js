// tests/radio-filtros.test.js
// Los filtros del dial: la región y el tipo de emisora se combinan, el salto entre emisoras solo
// recorre lo que pasa el filtro y la elección se guarda.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RadioSystem, STATIONS, STATION_REGIONS, filterStations, stationKind } from '../src/systems/RadioSystem.js';

const guardado = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function conAlmacen(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

function limpiar() {
  if (guardado) Object.defineProperty(globalThis, 'localStorage', guardado);
  else delete globalThis.localStorage;
}

const emisora = (id) => STATIONS.find((s) => s.id === id);

test('Filtros: el tipo separa las emisoras en vivo de las inventadas', () => {
  assert.equal(stationKind(emisora('unradio-bogota')), 'stream');
  assert.equal(stationKind(emisora('rock')), 'synth');

  const enVivo = filterStations({ kind: 'stream' });
  assert.ok(enVivo.length > 0 && enVivo.every((s) => s.kind === 'stream'));
  assert.deepEqual(filterStations({ kind: 'synth' }).map((s) => s.id), ['recuerdos', 'noticias', 'deportes', 'rock']);
  assert.deepEqual(filterStations({}), STATIONS, 'sin filtro salen todas, en el orden del catálogo');
});

test('Filtros: la región y el tipo se combinan sobre el catálogo', () => {
  assert.ok(filterStations({ region: 'Bogotá' }).every((s) => s.region === 'Bogotá'));
  // Bogotá es la única región con emisoras inventadas.
  assert.deepEqual(filterStations({ region: 'Bogotá', kind: 'synth' }).map((s) => s.id),
    ['recuerdos', 'noticias', 'deportes', 'rock']);
  // Cali solo tiene una emisora en vivo: con «Del juego» no queda ninguna.
  assert.deepEqual(filterStations({ region: 'Cali', kind: 'synth' }), []);
  assert.equal(filterStations({ region: 'Cali', kind: 'stream' }).length, 1);
});

test('Filtros: las regiones salen del catálogo, sin repetir', () => {
  const regiones = STATION_REGIONS;
  assert.deepEqual([...new Set(regiones)], regiones);
  assert.ok(regiones.includes('Bogotá') && regiones.includes('Cali'));
  assert.ok(regiones.length < STATIONS.length);
});

test('Filtros: se guardan en bazuko.radio_filtro y sobreviven al reinicio', (t) => {
  const store = conAlmacen();
  t.after(limpiar);
  const radio = new RadioSystem();
  assert.deepEqual(radio.filters, { region: '', kind: '' });

  radio.setFilters({ region: 'Cali' });
  radio.setFilters({ kind: 'stream' });
  assert.deepEqual(radio.filters, { region: 'Cali', kind: 'stream' }, 'lo que no viene se conserva');
  assert.equal(store.get('bazuko.radio_filtro'), JSON.stringify({ region: 'Cali', kind: 'stream' }));

  assert.deepEqual(new RadioSystem().filters, { region: 'Cali', kind: 'stream' });
});

test('Filtros: lo guardado que ya no existe o está roto se descarta', (t) => {
  conAlmacen({ 'bazuko.radio_filtro': JSON.stringify({ region: 'Marte', kind: 'pirata' }) });
  t.after(limpiar);
  assert.deepEqual(new RadioSystem().filters, { region: '', kind: '' });

  globalThis.localStorage.setItem('bazuko.radio_filtro', 'no es json');
  assert.deepEqual(new RadioSystem().filters, { region: '', kind: '' });
});

test('Filtros: siguiente y anterior solo recorren lo que pasa el filtro', (t) => {
  conAlmacen();
  t.after(limpiar);
  const radio = new RadioSystem();
  radio.setFilters({ region: 'Bogotá', kind: 'synth' });
  radio.setStation(emisora('recuerdos'));

  assert.equal(radio.stepStation(1).id, 'noticias');
  assert.equal(radio.stepStation(1).id, 'deportes');
  assert.equal(radio.stepStation(1).id, 'rock');
  assert.equal(radio.stepStation(1).id, 'recuerdos', 'da la vuelta');
  assert.equal(radio.stepStation(-1).id, 'rock');

  // Si la sintonía quedó fuera del filtro, el salto entra por una punta de lo visible.
  radio.setStation(emisora('rock'));
  radio.setFilters({ region: '', kind: 'stream' });
  assert.equal(radio.stepStation(1).id, 'unradio-bogota');
  assert.equal(radio.stepStation(-1).id, 'reconciliacion-san-jacinto');

  // El dial a mano sigue llegando a cualquier frecuencia, filtrada o no.
  radio.setFrequency(100.4);
  assert.equal(radio.getStationInfo().station.id, 'unradio-medellin');
});

test('Filtros: sin emisoras, siguiente y anterior no mueven la sintonía', (t) => {
  conAlmacen();
  t.after(limpiar);
  const radio = new RadioSystem();
  radio.setFilters({ region: 'Cali', kind: 'synth' });
  assert.deepEqual(filterStations(radio.filters), []);
  radio.setStation(emisora('rock'));

  assert.equal(radio.stepStation(1), null);
  assert.equal(radio.stepStation(-1), null);
  assert.equal(radio.getStationInfo().station.id, 'rock');
});
