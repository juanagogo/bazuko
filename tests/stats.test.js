import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { Clock } from '../src/core/Clock.js';
import { DiseaseSystem } from '../src/systems/DiseaseSystem.js';
import { resetTestWindow } from './helpers/fixtures.js';

beforeEach(resetTestWindow);

function explore(stats, seconds, clock = { isNight: false }, talents = null) {
  for (let frame = 0; frame < seconds * 60; frame++) {
    clock.update?.(1 / 60);
    stats.update(1 / 60, null, null, clock, talents);
  }
}

test('media hora de exploración con el reloj real del juego no exige atender ninguna barra', () => {
  const stats = new StatsSystem();
  explore(stats, 30 * 60, new Clock());
  assert.equal(stats.salud, 100);
  assert.ok(stats.sed > 65);
  assert.ok(stats.hambre > 74);
  assert.ok(stats.energia > 65);
  assert.ok(stats.higiene > 90);
  assert.ok(stats.animo > 80);
  assert.equal(stats.inWithdrawal, false);
});

test('un día completo dura una hora y se puede explorar sin morir ni entrar en necesidades críticas', () => {
  const stats = new StatsSystem(), clock = new Clock();
  explore(stats, 60 * 60, clock);
  assert.equal(clock.day, 2);
  assert.ok(Math.abs(clock.hour - 6) < 1e-6);
  assert.equal(stats.salud, 100);
  for (const need of ['sed', 'hambre', 'energia', 'higiene', 'animo']) assert.ok(stats[need] > 30, need);
  assert.equal(stats.inWithdrawal, false);
});

test('la sed tarda 90 minutos en vaciarse y da otros 20 minutos de margen antes de morir', () => {
  const stats = new StatsSystem(), clock = new Clock();
  explore(stats, 90 * 60, clock);
  assert.ok(stats.sed < 1e-6);
  assert.ok(stats.salud > 99.99);
  explore(stats, 10 * 60, clock);
  assert.ok(stats.salud > 49.99 && stats.salud < 50.01);
  explore(stats, 10 * 60, clock);
  assert.ok(stats.salud < 0.01);
});

test('ánimo, higiene, cansancio y abstinencia críticos penalizan sin matar al personaje', () => {
  const stats = new StatsSystem();
  stats.animo = stats.higiene = stats.energia = stats.vicio = 0;
  explore(stats, 10 * 60);
  assert.equal(stats.salud, 100);
  assert.ok(stats.getSpeedMultiplier() < 1);
  assert.equal(stats.isRejectedByNPCs(), true);
});

test('una infección no vacía la salud en menos de un minuto', () => {
  const stats = new StatsSystem(), diseases = new DiseaseSystem();
  diseases.active.infeccion = { timeLeft: 54 };
  for (let frame = 0; frame < 53 * 60; frame++) {
    stats.update(1 / 60, null, diseases);
    diseases.update(1 / 60);
  }
  assert.ok(stats.salud > 85 && stats.salud < 95);
});

test('el ánimo usa un solo cálculo, incluye la noche y respeta los talentos', () => {
  const day = new StatsSystem(), night = new StatsSystem(), trained = new StatsSystem();
  const talents = { getEffect: (name, fallback) => name === 'mentalDecayMult' ? 0.5 : fallback };
  explore(day, 60);
  explore(night, 60, { isNight: true });
  explore(trained, 60, { isNight: true }, talents);
  assert.ok(day.animo > 99 && day.animo < 100);
  assert.ok(night.animo < day.animo);
  assert.ok(Math.abs((100 - trained.animo) * 2 - (100 - night.animo)) < 1e-7);
  assert.equal(trained.saludMental, trained.animo);
});
