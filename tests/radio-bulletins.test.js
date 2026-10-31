// tests/radio-bulletins.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { RadioSystem, CITY_BULLETIN_INTERVAL } from '../src/systems/RadioSystem.js';
import { BULLETINS, BULLETIN_TRIGGERS, bulletinsFor } from '../src/data/radioBulletins.js';

const tunedToNews = () => {
  const radio = new RadioSystem();
  radio.setFrequency(890);
  radio.turnOn();
  return radio;
};

test('Boletines: datos offline con fecha, fuente y objetivo jugable', () => {
  const ids = new Set();
  for (const b of BULLETINS) {
    assert.ok(!ids.has(b.id), `id duplicado: ${b.id}`);
    ids.add(b.id);
    assert.ok(BULLETIN_TRIGGERS.includes(b.trigger), `${b.id}: trigger inválido`);
    assert.match(b.fecha, /^\d{4}-\d{2}-\d{2}$/, `${b.id}: fecha inválida`);
    for (const key of ['fuente', 'titular', 'texto', 'objetivo']) {
      assert.ok(typeof b[key] === 'string' && b[key].length > 0, `${b.id}: falta ${key}`);
    }
  }
  for (const trigger of BULLETIN_TRIGGERS) assert.ok(bulletinsFor(trigger).length > 0, `sin boletines de ${trigger}`);
});

test('Boletines: un cambio de lluvia emite como máximo un boletín', () => {
  const radio = tunedToNews();
  radio.onWeatherChange({ weather: 'llovizna', isRaining: true });
  for (let i = 0; i < 20; i++) radio.update(0.5);
  assert.equal(radio.bulletinLog.length, 1);
  assert.equal(radio.lastBulletin.trigger, 'lluvia');

  radio.onWeatherChange({ weather: 'nublado', isRaining: false });
  radio.update(0.5);
  assert.equal(radio.bulletinLog.length, 2);
  assert.equal(radio.lastBulletin.trigger, 'despeje');
  radio.destroy();
});

test('Boletines: no suenan con la radio apagada ni en otra emisora', () => {
  const off = new RadioSystem();
  off.setFrequency(890);
  off.onWeatherChange({ isRaining: true });
  off.update(1);
  assert.equal(off.bulletinLog.length, 0);

  const music = new RadioSystem();
  music.setFrequency(540);
  music.turnOn();
  music.onWeatherChange({ isRaining: true });
  music.update(CITY_BULLETIN_INTERVAL + 1);
  assert.equal(music.bulletinLog.length, 0);
  music.destroy();
});

test('Boletines: el aviso pendiente suena al sintonizar 890 y no se acumula', () => {
  const radio = new RadioSystem();
  radio.setFrequency(540);
  radio.turnOn();
  radio.onWeatherChange({ isRaining: true });
  radio.onWeatherChange({ isRaining: false }); // escampa antes de sintonizar
  radio.update(1);
  assert.equal(radio.bulletinLog.length, 0);

  radio.setFrequency(890);
  radio.update(1);
  radio.update(1);
  assert.equal(radio.bulletinLog.length, 1);
  assert.equal(radio.lastBulletin.trigger, 'despeje');
  radio.destroy();
});

test('Boletines: la ciudad rota sus noticias mientras se escucha 890', () => {
  const radio = tunedToNews();
  radio.update(CITY_BULLETIN_INTERVAL - 1);
  assert.equal(radio.bulletinLog.length, 0);
  radio.update(1);
  radio.update(CITY_BULLETIN_INTERVAL);
  const city = bulletinsFor('ciudad');
  assert.deepEqual(radio.bulletinLog.map((b) => b.id).reverse(), city.slice(0, 2).map((b) => b.id));
  radio.destroy();
});
