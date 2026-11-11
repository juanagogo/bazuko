// tests/daily-missions.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyMissionSystem, MISSION_TEMPLATES } from '../src/systems/DailyMissionSystem.js';

function dom() {
  const nodo = (tag) => ({
    tag, className: '', textContent: '', children: [], attributes: {}, style: {}, dataset: {},
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    append(...n) { this.children.push(...n); },
    appendChild(n) { this.children.push(n); return n; },
    prepend(...n) { this.children.unshift(...n); },
    replaceChildren(...n) { this.children = n; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; }
  });
  globalThis.document = { createElement: nodo, activeElement: null, getElementById: () => null };
  globalThis.window = new EventTarget();
  return nodo;
}

function fakeGame() {
  return {
    stats: {
      dinero: 1000,
      xp: 0,
      animo: 50,
      addXP(amt) { this.xp += amt; }
    },
    talents: {},
    audio: { play() {} }
  };
}

test('DailyMissionSystem genera 3 misiones variadas para el día', () => {
  const game = fakeGame();
  const system = new DailyMissionSystem(game);
  system.init(1);

  assert.equal(system.missions.length, 3);
  assert.equal(system.currentDay, 1);

  const types = new Set(system.missions.map(m => m.type));
  assert.equal(types.size, 3, 'las 3 misiones diarias son de tipos distintos');

  for (const m of system.missions) {
    assert.ok(m.title, 'tiene título');
    assert.ok(m.desc, 'tiene descripción');
    assert.ok(m.target > 0, 'tiene meta positiva');
    assert.equal(m.progress, 0);
    assert.equal(m.completed, false);
    assert.ok(m.reward?.dinero > 0 || m.reward?.xp > 0, 'tiene recompensa');
  }

  system.dispose();
});

test('reportProgress avanza el progreso y completa la misión entregando la recompensa', () => {
  const game = fakeGame();
  const system = new DailyMissionSystem(game);
  system.missions = [
    {
      id: 'reciclar_test',
      type: 'reciclar',
      title: 'Jornada de reciclaje',
      desc: 'Recoge 4 bolsas',
      target: 4,
      progress: 0,
      completed: false,
      claimed: false,
      reward: { dinero: 3000, xp: 30, animo: 10 }
    }
  ];

  // Avance parcial
  system.reportProgress('reciclar', 2);
  assert.equal(system.missions[0].progress, 2);
  assert.equal(system.missions[0].completed, false);
  assert.equal(game.stats.dinero, 1000);

  // Completar meta
  system.reportProgress('reciclar', 2);
  assert.equal(system.missions[0].progress, 4);
  assert.equal(system.missions[0].completed, true);
  assert.equal(system.missions[0].claimed, true);

  // Recompensa acreditada
  assert.equal(game.stats.dinero, 4000);
  assert.equal(game.stats.xp, 30);
  assert.equal(game.stats.animo, 60);

  // No avanza más de la meta ni duplica recompensa
  system.reportProgress('reciclar', 2);
  assert.equal(system.missions[0].progress, 4);
  assert.equal(game.stats.dinero, 4000);

  system.dispose();
});

test('cambio de día (cada 24 horas) renueva las misiones diarias', () => {
  const game = fakeGame();
  const system = new DailyMissionSystem(game);
  system.init(1);
  const day1Missions = system.missions.map(m => m.id);

  // Mismo día no cambia nada
  system.update(0.1, { day: 1, hour: 18 });
  assert.equal(system.currentDay, 1);

  // Pasa al Día 2
  system.update(0.1, { day: 2, hour: 6 });
  assert.equal(system.currentDay, 2);
  assert.equal(system.missions.length, 3);
  const day2Missions = system.missions.map(m => m.id);

  assert.notDeepEqual(day1Missions, day2Missions, 'las misiones se renovaron para el nuevo día');

  system.dispose();
});

test('activeMissionText da texto descriptivo y de progreso para la interfaz', () => {
  const game = fakeGame();
  const system = new DailyMissionSystem(game);
  system.missions = [
    {
      id: 'reciclar_test',
      type: 'reciclar',
      title: 'Jornada de reciclaje',
      desc: 'Recoge 4 bolsas',
      target: 4,
      progress: 1,
      completed: false,
      claimed: false,
      reward: { dinero: 3000, xp: 30, animo: 10 }
    }
  ];

  assert.match(system.activeMissionText, /MISIÓN: JORNADA DE RECICLAJE \(1\/4\)/);

  system.missions[0].completed = true;
  assert.equal(system.activeMissionText, 'MISIONES DEL DÍA COMPLETADAS');

  system.dispose();
});

test('serialize y deserialize conservan las misiones y su progreso', () => {
  const game = fakeGame();
  const system = new DailyMissionSystem(game);
  system.init(3);
  system.missions[0].progress = 2;

  const data = system.serialize();
  assert.equal(data.currentDay, 3);
  assert.equal(data.missions.length, 3);
  assert.equal(data.missions[0].progress, 2);

  const restored = new DailyMissionSystem(game);
  restored.deserialize(data);
  assert.equal(restored.currentDay, 3);
  assert.equal(restored.missions.length, 3);
  assert.equal(restored.missions[0].progress, 2);

  system.dispose();
  restored.dispose();
});

test('openMissionsModal abre el panel de misiones con título, tarjetas y sin emojis', async () => {
  dom();
  const { openMissionsModal } = await import('../src/ui/MissionsModal.js');
  let config = null;
  const menu = {
    isOpen: false,
    open(cfg) { config = cfg; this.isOpen = true; },
    close() { this.isOpen = false; config?.onClose?.(); }
  };
  const game = {
    menu,
    dailyMissions: {
      missions: [
        {
          id: 'test_1',
          title: 'Prueba de reciclaje',
          desc: 'Recoge 5 latas',
          target: 5,
          progress: 3,
          completed: false,
          reward: { dinero: 2000, xp: 20, animo: 10 }
        },
        {
          id: 'test_2',
          title: 'Prueba de limosna',
          desc: 'Pide a 3 personas',
          target: 3,
          progress: 3,
          completed: true,
          reward: { dinero: 1500, xp: 15, animo: 5 }
        }
      ]
    },
    clock: { day: 2 }
  };

  openMissionsModal(game);
  assert.ok(config, 'se abrió el modal de misiones');
  assert.equal(config.title, 'Misiones del día');
  assert.equal(config.ic, 'pin');
  assert.equal(game._missionsModalOpen, true);

  const rendered = config.render();
  assert.ok(rendered.body);
  assert.ok(rendered.foot);

  // Comprobar que no hay emojis
  const EMOJI = /[\u{1F300}-\u{1F9FF}]/u;
  assert.doesNotMatch(config.title, EMOJI);
  assert.doesNotMatch(config.sub, EMOJI);

  menu.close();
  assert.equal(game._missionsModalOpen, false);
});

test('PanelDock y PauseMenu integran la tecla J para Misiones del día', async () => {
  const { openPauseMenu, CONTROL_GROUPS } = await import('../src/ui/PauseMenu.js');
  const panelesGroup = CONTROL_GROUPS.find(([title]) => title === 'Paneles');
  assert.ok(panelesGroup, 'existe el grupo Paneles en los controles');
  const jControl = panelesGroup[1].find(([key]) => key === 'J');
  assert.ok(jControl, 'la tecla J está registrada en los controles');
  assert.equal(jControl[1], 'Misiones del día');
});
