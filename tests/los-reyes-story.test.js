// tests/los-reyes-story.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { LosReyesStory, REYES_CHAPTERS } from '../src/story/LosReyesStory.js';

function mockGame() {
  return {
    stats: {
      dinero: 1000,
      xp: 0,
      addXP(n) { this.xp += n; }
    },
    talents: {},
    audio: {
      played: [],
      play(sound) { this.played.push(sound); }
    },
    radio: {
      bulletins: [],
      forceBulletin(id) { this.bulletins.push(id); }
    },
    waypoint: null,
    setGpsWaypoint(wp) { this.waypoint = wp; }
  };
}

test('LosReyesStory: los 5 capítulos están definidos con sus pasos y objetivos', () => {
  assert.equal(REYES_CHAPTERS.length, 5);
  for (const [i, ch] of REYES_CHAPTERS.entries()) {
    assert.equal(ch.numero, i + 1);
    assert.ok(ch.titulo && ch.titulo.length > 0);
    assert.ok(ch.descripcion && ch.descripcion.length > 0);
    assert.ok(Array.isArray(ch.pasos) && ch.pasos.length > 0);
    for (const paso of ch.pasos) {
      assert.ok(paso.id && paso.id.length > 0);
      assert.ok(paso.texto && paso.texto.length > 0);
      assert.ok(paso.meta && paso.meta.length > 0);
      assert.ok(paso.target && typeof paso.target.x === 'number' && typeof paso.target.z === 'number');
      assert.ok(paso.target.radio > 0);
      assert.ok(paso.dialogoInicio && paso.dialogoCompletado);
    }
  }
});

test('LosReyesStory: inicia en Capítulo 1 Paso 0 con el texto de misión correcto', () => {
  const game = mockGame();
  const story = new LosReyesStory(game);

  assert.equal(story.chapterIndex, 0);
  assert.equal(story.stepIndex, 0);
  assert.equal(story.completed, false);
  assert.equal(story.currentChapter.numero, 1);
  assert.equal(story.currentStep.id, 'mercado');
  assert.equal(story.currentMissionText(), 'TOCA RECOGER EL PEDIDO EN LA PLAZA DE MERCADO');

  const wp = story.getCurrentWaypoint();
  assert.deepEqual(wp, { name: 'Plaza de Mercado', x: 331, z: 171 });
});

test('LosReyesStory: avanzar por posición cerca al objetivo entrega recompensas y avanza de paso', () => {
  const game = mockGame();
  const story = new LosReyesStory(game);

  // Lejos del objetivo (x: 0, z: 0) no se activa
  story.update(0.1, { x: 0, z: 0 });
  assert.equal(story.stepIndex, 0);
  assert.equal(game.stats.dinero, 1000);

  // Al llegar a la Plaza de Mercado (x: 331, z: 171)
  story.update(0.1, { x: 331, z: 171 });
  assert.equal(story.stepIndex, 1);
  assert.equal(game.stats.dinero, 1000 + 50000);
  assert.equal(game.stats.xp, 150);
  assert.equal(story.currentStep.id, 'viaducto');
  assert.match(story.currentMissionText(), /AUXILIAR A DOÑA MERCEDES/);

  // Cooldown de llegada activo
  story.update(0.1, { x: 75, z: 193 });
  assert.equal(story.stepIndex, 1, 'el cooldown evita saltar el siguiente paso en el mismo frame');

  // Dejamos pasar el cooldown (2.5 s)
  story.update(3.0, { x: 0, z: 0 });

  // Ahora llegamos al Viaducto de la 26
  story.update(0.1, { x: 75, z: 193 });
  assert.equal(story.chapterIndex, 1, 'avanza a Capítulo 2: Trasteo a Rosales');
  assert.equal(story.stepIndex, 0);
  assert.equal(game.stats.dinero, 1000 + 50000 + 500000);
  assert.equal(game.radio.bulletins.includes('reyes-mercedes-salvada'), true, 'emite boletín de radio');
});

test('LosReyesStory: completar todos los capítulos marca la historia como concluida', () => {
  const game = mockGame();
  const story = new LosReyesStory(game);

  // Simulamos avance de todos los capítulos
  while (!story.completed) {
    story.advanceStep();
  }

  assert.equal(story.completed, true);
  assert.equal(story.currentChapter, null);
  assert.equal(story.currentStep, null);
  assert.match(story.currentMissionText(), /CONQUISTÓ BOGOTÁ/);
  assert.equal(story.getCurrentWaypoint(), null);
});

test('LosReyesStory: serialización y deserialización conservan el progreso de la partida', () => {
  const game = mockGame();
  const story = new LosReyesStory(game);

  story.chapterIndex = 2;
  story.stepIndex = 0;
  story.history.push({ chapterId: 'capitulo_1', stepId: 'mercado', completedAt: 123456789 });

  const guardado = story.serialize();
  assert.equal(guardado.chapterIndex, 2);
  assert.equal(guardado.stepIndex, 0);
  assert.equal(guardado.history.length, 1);

  const otraStory = new LosReyesStory(game);
  otraStory.deserialize(guardado);

  assert.equal(otraStory.chapterIndex, 2);
  assert.equal(otraStory.stepIndex, 0);
  assert.equal(otraStory.history.length, 1);
  assert.equal(otraStory.currentChapter.numero, 3);
  assert.equal(otraStory.currentStep.id, 'colpatria_ger');
});
