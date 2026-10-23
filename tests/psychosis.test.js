// tests/psychosis.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { PsychosisSystem } from '../src/systems/PsychosisSystem.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('cálculo progresivo de abstinencia y umbrales de severidad', () => {
  const stats = new StatsSystem();
  
  // 1. Estado satisfecho inicial
  stats.vicio = 80;
  assert.equal(stats.abstinencia, 0);
  assert.equal(stats.inWithdrawal, false);
  assert.equal(stats.isHighWithdrawal, false);
  assert.equal(stats.isCriticalWithdrawal, false);

  // 2. Umbral de entrada en abstinencia (vicio < 20)
  stats.vicio = 15;
  assert.equal(stats.inWithdrawal, true);
  assert.equal(stats.abstinencia, 25);
  assert.equal(stats.isHighWithdrawal, false);

  // 3. Abstinencia alta (vicio <= 10 -> abstinencia >= 50%)
  stats.vicio = 8;
  assert.equal(stats.abstinencia, 60);
  assert.equal(stats.isHighWithdrawal, true);
  assert.equal(stats.isCriticalWithdrawal, false);

  // 4. Abstinencia crítica / psicosis severa (vicio <= 4 -> abstinencia >= 80%)
  stats.vicio = 2;
  assert.equal(stats.abstinencia, 90);
  assert.equal(stats.isHighWithdrawal, true);
  assert.equal(stats.isCriticalWithdrawal, true);

  // 5. Vicio totalmente en 0 -> abstinencia 100%
  stats.vicio = 0;
  assert.equal(stats.abstinencia, 100);
});

test('la abstinencia alta penaliza la velocidad y multiplica el desgaste mental', () => {
  const normal = new StatsSystem();
  normal.vicio = 80;
  normal.animo = 100;

  const highWithdrawal = new StatsSystem();
  highWithdrawal.vicio = 5; // 75% abstinencia
  highWithdrawal.animo = 100;

  assert.ok(highWithdrawal.getSpeedMultiplier() < normal.getSpeedMultiplier());

  // Simular 60 segundos de desgaste
  for (let f = 0; f < 60 * 60; f++) {
    normal.update(1 / 60, null);
    highWithdrawal.update(1 / 60, null);
  }

  // El ánimo en abstinencia alta decae mucho más rápido
  assert.ok(highWithdrawal.animo < normal.animo);
});

test('PsychosisSystem se activa con abstinencia alta y se limpia al recuperar el vicio', () => {
  const scene = new THREE.Scene();
  const stats = new StatsSystem();
  stats.vicio = 80; // normal
  const player = { position: new THREE.Vector3(10, 0, 10), playAction() {} };
  const cameraRig = { camera: new THREE.PerspectiveCamera(55, 1, 0.1, 100), baseFov: 55 };

  const psychosis = new PsychosisSystem(scene, player, stats, null, { active: { getGroundHeight: () => 0 } });
  
  // Con vicio normal, no está activo
  psychosis.update(0.1, cameraRig);
  assert.equal(psychosis.active, false);

  // Con abstinencia alta (vicio = 4 -> 80% abstinencia), se activa
  stats.vicio = 4;
  psychosis.update(0.1, cameraRig);
  assert.equal(psychosis.active, true);

  // Puede generar sombras fantasma
  psychosis._clearShadowPeople();
  const shadow = psychosis._createShadowPerson(new THREE.Vector3(20, 0, 20));
  assert.ok(shadow);
  psychosis.shadowPeople.push(shadow);
  assert.equal(psychosis.shadowPeople.length, 1);
  assert.equal(scene.children.includes(shadow.group), true);

  // Al consumir una sustancia y recuperar vicio, la psicosis se desactiva y limpia las sombras
  stats.vicio = 50;
  psychosis.update(0.1, cameraRig);
  assert.equal(psychosis.active, false);
  assert.equal(psychosis.shadowPeople.length, 0);
  assert.equal(scene.children.includes(shadow.group), false);
});
