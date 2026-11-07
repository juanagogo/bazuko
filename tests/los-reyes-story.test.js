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

test('Beto Reyes: el preset recrea al personaje de Los Reyes según la ilustración', async () => {
  const { STREET_PRESETS, applyStreetPreset } = await import('../src/character/presets.js');
  const { DEFAULT_LOOK } = await import('../src/character/look.js');

  const beto = STREET_PRESETS.find((p) => p.id === 'beto');
  assert.ok(beto, 'El preset de Beto Reyes debe existir en STREET_PRESETS');
  assert.equal(beto.look.nombre, 'Beto Reyes');
  assert.equal(beto.look.origen, 'beto');
  assert.equal(beto.look.piel, 2, 'Tono trigueño / mestizo');
  assert.equal(beto.look.peloColor, 0, 'Cabello negro');
  assert.equal(beto.look.desgaste, 0, 'Traje impecable sin desgaste');
  assert.equal(beto.look.real.ropa, 'chaqueta', 'Chaqueta de paño ejecutivo');
  assert.equal(beto.look.real.barba, 'ninguna', 'Sin barba como en la ilustración');
  assert.equal(beto.look.real.calzado, 'zapatos', 'Zapatos formales de charol');
  assert.ok(beto.look.real.talla.ancho >= 1.05, 'Contextura robusta de Don Beto');

  const aplicado = applyStreetPreset(DEFAULT_LOOK, beto);
  assert.equal(aplicado.nombre, 'Beto Reyes');
  assert.equal(aplicado.real.ropa, 'chaqueta');
  assert.equal(aplicado.real.barba, 'ninguna');
  assert.equal(aplicado.real.calzado, 'zapatos');
  assert.equal(aplicado.desgaste, 0);
});

test('Transición día/noche: Clock avanza suavemente por amanecer, día, atardecer y noche', async () => {
  const { Clock, DAY_CYCLE_SECONDS } = await import('../src/core/Clock.js');
  assert.equal(DAY_CYCLE_SECONDS, 720, 'Un ciclo completo dura 12 minutos (720 s)');

  const clock = new Clock({ dayLengthSeconds: 720, hour: 6 });
  assert.equal(clock.hour, 6, 'Empieza al amanecer (6:00)');
  assert.equal(clock.isNight, false);
  assert.equal(clock.lightsOn, false);

  // Tras 3 minutos (180 s) = 6 horas de juego -> 12:00 (mediodía soleado)
  clock.update(180);
  assert.ok(Math.abs(clock.hour - 12) < 0.1, `Debe estar a mediodía, actual: ${clock.hour}`);
  assert.equal(clock.isNight, false);
  assert.equal(clock.lightsOn, false);

  // Tras otros 3 minutos (180 s) = 6 horas más -> 18:00 (atardecer, luces encendidas)
  clock.update(180);
  assert.ok(Math.abs(clock.hour - 18) < 0.1, `Debe ser el atardecer, actual: ${clock.hour}`);
  assert.equal(clock.lightsOn, true, 'Faroles y ventanas se encienden al atardecer');
  assert.equal(clock.isNight, false);

  // Tras 1 minuto (60 s) = 2 horas más -> 20:00 (noche cerrada en Bogotá)
  clock.update(60);
  assert.ok(Math.abs(clock.hour - 20) < 0.1, `Debe ser de noche, actual: ${clock.hour}`);
  assert.equal(clock.isNight, true, 'De noche en Bogotá');
  assert.equal(clock.lightsOn, true);
});
