// tests/radio.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { RadioSystem, STATIONS } from '../src/systems/RadioSystem.js';
import { ITEMS, LOOT_COMMON, SHOP_ITEMS } from '../src/data/items.js';
import { RECIPES } from '../src/data/recipes.js';

test('RadioSystem: configuración inicial y catálogo de emisoras bogotanas', () => {
  const radio = new RadioSystem();
  assert.equal(radio.isOn, false);
  assert.equal(radio.battery, 100);
  assert.ok(radio.frequency > 0);
  assert.equal(STATIONS.filter((s) => s.kind !== 'stream').length, 4, 'cuatro emisoras inventadas de la ciudad');

  const ids = STATIONS.map((s) => s.id);
  assert.ok(ids.includes('recuerdos'));
  assert.ok(ids.includes('noticias'));
  assert.ok(ids.includes('deportes'));
  assert.ok(ids.includes('rock'));
});

test('RadioSystem: sintonización de frecuencias y resolución de señal', () => {
  const radio = new RadioSystem();

  // 1. Sintonía perfecta en Radio Recuerdos (540 AM)
  radio.setFrequency(540);
  let info = radio.getStationInfo();
  assert.equal(info.station.id, 'recuerdos');
  assert.equal(info.signal, 1);

  // 2. Sintonía desviada (estática parcial)
  radio.setFrequency(550);
  info = radio.getStationInfo();
  assert.equal(info.station.id, 'recuerdos');
  assert.ok(info.signal < 1 && info.signal > 0.4);

  // 3. Sintonía en FM (97,4 MHz, La Gotera)
  radio.setFrequency(97.4);
  info = radio.getStationInfo();
  assert.equal(info.station.id, 'rock');
  assert.equal(info.signal, 1);

  // 4. Sintonía en La Voz de la Capital (890 AM)
  radio.setFrequency(890);
  info = radio.getStationInfo();
  assert.equal(info.station.id, 'noticias');
  assert.equal(info.signal, 1);
});

test('RadioSystem: encendido, apagado, alternancia y control de volumen', () => {
  const radio = new RadioSystem();
  assert.equal(radio.isOn, false);

  radio.turnOn();
  assert.equal(radio.isOn, true);

  radio.turnOff();
  assert.equal(radio.isOn, false);

  const toggled = radio.toggle();
  assert.equal(toggled, true);
  assert.equal(radio.isOn, true);

  radio.setVolume(0.85);
  assert.equal(radio.volume, 0.85);

  radio.setVolume(1.5);
  assert.equal(radio.volume, 1);

  radio.setVolume(-0.2);
  assert.equal(radio.volume, 0);

  radio.destroy();
});

test('RadioSystem: consumo de batería y restauración de salud mental', () => {
  const radio = new RadioSystem();
  radio.turnOn();
  radio.setFrequency(540); // Sintonía perfecta

  const mockStats = { saludMental: 50 };
  const mockDog = { time: 0 };

  // Avanzar 10 segundos
  radio.update(10, mockStats, mockDog);

  // La batería debe haber bajado suavemente
  assert.ok(radio.battery < 100);
  assert.ok(radio.battery > 99);

  // La salud mental debe haber aumentado gracias a la música
  assert.ok(mockStats.saludMental > 50);

  // El perro El Chato debe haber reaccionado
  assert.ok(mockDog.time > 0);

  // Agotar la batería
  radio.battery = 0.1;
  radio.update(5, mockStats, mockDog);
  assert.equal(radio.battery, 0);
  assert.equal(radio.isOn, false, 'La radio debe apagarse automáticamente sin batería');
});

test('Items y Crafteo: existencia de radioTransistor, pilas y receta de fabricación', () => {
  // Verificar items
  assert.ok(ITEMS.radioTransistor, 'radioTransistor debe existir en ITEMS');
  assert.equal(ITEMS.radioTransistor.usable, true);
  assert.ok(ITEMS.pilas, 'pilas debe existir en ITEMS');

  // Verificar receta
  const radioRecipe = RECIPES.find((r) => r.result === 'radioTransistor');
  assert.ok(radioRecipe, 'Debe existir una receta de crafteo para la radio');
  assert.equal(radioRecipe.ingredients.chatarra, 1);
  assert.equal(radioRecipe.ingredients.cable, 2);
  assert.equal(radioRecipe.ingredients.pilas, 1);

  // Verificar en loot y tiendas
  assert.ok(LOOT_COMMON.some((l) => l.item === 'pilas'), 'pilas debe poder encontrarse en basura común');
  assert.ok(SHOP_ITEMS.some((s) => s.item === 'pilas'), 'pilas debe estar a la venta en la tienda');
  assert.ok(SHOP_ITEMS.some((s) => s.item === 'radioTransistor'), 'radioTransistor debe estar en la tienda');
});
