// tests/steal.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { StealSystem, CONFIG } from '../src/features/steal.js';
import { Input } from '../src/core/Input.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('StealSystem detecta al NPC cercano y permite iniciar cosquilleo o robo directo', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.3 };
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0) },
    world: { active: { npcs: [npc] } },
    input: { consumePress: (code) => code === 'KeyE' },
    interaction: {},
    paused: false
  };

  const steal = new StealSystem(game);
  steal.update(0.1);

  assert.equal(steal.minigameActive, true);
  assert.equal(steal.targetNpc, npc);
});

test('Cosquilleo exitoso dentro de la zona verde otorga botín y activa cooldown', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.2 };
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0) },
    stats: { dinero: 1000 },
    inventory: { add: () => true },
    world: { active: { npcs: [npc] } },
    input: { consumePress: () => false },
    interaction: {}
  };

  const steal = new StealSystem(game);
  steal.startCosquilleo(npc);
  steal.markerPos = steal.zoneStart + (steal.zoneSize / 2);
  steal._endMinigame(true, 'play');

  assert.equal(steal.minigameActive, false);
  assert.ok(game.stats.dinero > 1000);
  assert.equal(steal.cooldown, CONFIG.globalCooldown);
  assert.equal(npc._robadoTimer, CONFIG.npcCooldown);
});

test('Robo directo otorga botín mayor, sube buscado y daña al jugador si el NPC es fuerte', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, look: { real: { edad: 'adulto' } } };
  let splatted = false;
  npc.alarmedByTheft = () => { splatted = true; };

  const game = {
    player: { position: new THREE.Vector3(0, 0, 0) },
    stats: { dinero: 500, salud: 100 },
    inventory: { add: () => true },
    world: { active: { npcs: [npc] } },
    input: { consumePress: () => false },
    interaction: {}
  };

  const steal = new StealSystem(game);
  steal.executeRoboDirecto(npc);

  assert.ok(game.stats.dinero >= 500 + CONFIG.lootMoneyDirect[0]);
  assert.equal(steal.buscado, 1);
  assert.equal(splatted, true);
  assert.ok(game.stats.salud < 100);
  assert.equal(steal.cooldown, CONFIG.globalCooldown);
});

// Barra en marcha con la entrada real. La barra escucha antes que `Input`, como en el navegador, donde lo hace en captura.
function minigame(player = new THREE.Vector3()) {
  const npc = { position: new THREE.Vector3(1, 0, 0), _robadoTimer: 0, alerta: 0.2 };
  const game = { player: { position: player }, stats: { dinero: 1000 }, inventory: { add: () => true }, world: { active: { npcs: [npc] } }, interaction: {}, paused: false };
  const steal = new StealSystem(game);
  game.input = new Input();
  steal.startCosquilleo(npc);
  return { steal, game, npc };
}
const press = (code) => {
  const event = Object.assign(new Event('keydown'), { code });
  window.dispatchEvent(event);
  return event;
};
// `Player` lee Espacio en su turno, antes que el cosquilleo: si le llega, salta y la barra ya no la ve.
const playerJumps = ({ input }) => input.consumePress('Space') || input.consumePress('KeySpace');

test('Espacio detiene la barra dentro de la zona verde y el jugador no salta', () => {
  const { steal, game } = minigame();
  steal.markerPos = steal.zoneStart + steal.zoneSize / 2;
  press('Space');
  assert.equal(playerJumps(game), false);
  steal.update(.016);
  assert.equal(steal.minigameActive, false);
  assert.ok(game.stats.dinero > 1000);
  assert.equal(steal.cooldown, CONFIG.globalCooldown - .016);
});

test('Espacio fuera de la zona verde falla, sin botín y con enfriamiento', () => {
  const { steal, game, npc } = minigame();
  steal.markerPos = steal.zoneStart - .1;
  press('Space');
  assert.equal(playerJumps(game), false);
  assert.equal(steal.minigameActive, false);
  assert.equal(game.stats.dinero, 1000);
  assert.equal(steal.cooldown, CONFIG.globalCooldown);
  assert.equal(npc._robadoTimer, CONFIG.npcCooldown);
});

test('Esc cancela la barra sin abrir la pausa y sin gastar el enfriamiento', () => {
  const { steal, game } = minigame();
  const event = press('Escape');
  assert.equal(event._panelHandled, true, 'la pausa respeta esta marca');
  assert.equal(steal.minigameActive, false);
  assert.equal(steal.cooldown, 0);
  assert.equal(game.stats.dinero, 1000);
});

test('sin barra, o con un menú abierto, Espacio y Esc siguen su camino', () => {
  const { steal, game } = minigame();
  game.paused = true;
  assert.equal(press('Escape')._panelHandled, undefined);
  press('Space');
  assert.equal(steal.minigameActive, true, 'la barra espera detrás del menú');
  assert.equal(playerJumps(game), true);
  game.input.pressedThisFrame.clear();
  game.paused = false;
  steal._endMinigame(false, 'cancel');
  assert.equal(press('Escape')._panelHandled, undefined);
  press('Space');
  assert.equal(playerJumps(game), true);
});

test('la barra se cancela cuando el jugador y la persona se separan', () => {
  const player = new THREE.Vector3(), { steal, game } = minigame(player);
  player.set(1 + CONFIG.stealDistance * 2 - .1, 0, 0);
  steal.update(.016);
  assert.equal(steal.minigameActive, true, 'todavía a su alcance');
  player.x += .2;
  steal.update(.016);
  assert.equal(steal.minigameActive, false);
  assert.equal(steal.cooldown, 0);
  assert.equal(game.stats.dinero, 1000);
});

// Monta el robo con una barra abierta y un fallo seguro de pillar: el peatón ve el robo con probabilidad 1.
function caughtSetup(traffic = null) {
  const npc = { position: new THREE.Vector3(1, 0, 0), _robadoTimer: 0, alerta: 1 };
  const game = {
    player: { position: new THREE.Vector3() }, stats: { dinero: 0 }, inventory: { add: () => true },
    world: { active: { npcs: [npc] } }, input: { consumePress: () => false }, interaction: {}, traffic
  };
  return { npc, game, steal: new StealSystem(game) };
}

test('al pillarlo el peatón huye por el robo, sin mancha de popó', () => {
  const { npc, game, steal } = caughtSetup();
  const calls = [];
  npc.alarmedByTheft = from => calls.push(['robo', from]);
  npc.hitByPoop = () => calls.push(['popó']);
  steal.startCosquilleo(npc);
  steal.markerPos = 0; steal.zoneStart = .5;
  const random = Math.random;
  Math.random = () => .01;
  try { steal._endMinigame(false, 'play'); } finally { Math.random = random; }
  assert.deepEqual(calls, [['robo', game.player.position]]);
});

test('una patrulla que ve el robo lo persigue; sin patrulla no pasa nada más', () => {
  const chases = [];
  window.addEventListener('police-chase', () => chases.push('persecución'));
  const seen = [];
  const { npc, game, steal } = caughtSetup({ alertForTheft: position => { seen.push(position); return true; } });
  npc.alarmedByTheft = () => {};
  const random = Math.random;
  Math.random = () => .01;
  try { steal.startCosquilleo(npc); steal._endMinigame(false, 'play'); } finally { Math.random = random; }
  assert.deepEqual(seen, [game.player.position]);
  assert.deepEqual(chases, ['persecución']);

  steal.executeRoboDirecto(npc);
  assert.equal(seen.length, 2, 'El robo directo también se ve');
  assert.equal(chases.length, 2);

  const quiet = caughtSetup({ alertForTheft: () => false });
  quiet.npc.alarmedByTheft = () => {};
  quiet.steal.executeRoboDirecto(quiet.npc);
  assert.equal(chases.length, 2, 'Sin patrulla a la vista no empieza ninguna persecución');
});

test('el cosquilleo paga poco y en cientos: no puede rendir más que reciclar sin riesgo', () => {
  const [min, max] = CONFIG.lootMoneyCosquilleo;
  assert.ok(max <= 4000 && min >= 500, `${min} a ${max}`);
  const { game, steal } = caughtSetup();
  const random = Math.random;
  for (const value of [0, .137, .5, .999]) {
    game.stats.dinero = 0;
    Math.random = () => value;
    try { steal._giveLoot(CONFIG.lootMoneyCosquilleo, false); } finally { Math.random = random; }
    assert.equal(game.stats.dinero % 100, 0, `${game.stats.dinero}`);
    assert.ok(game.stats.dinero >= min && game.stats.dinero <= max);
  }
});

test('ni al desmayado ni a quien atiende un puesto; tampoco tirado por un carro', () => {
  const { npc, game, steal } = caughtSetup();
  steal.update(.1);
  assert.equal(steal.targetNpc, npc);
  npc.koState = { time: 3 };
  steal.update(.1);
  assert.equal(steal.targetNpc, null, 'Desmayado');
  npc.koState = null; npc.isVendor = true;
  steal.update(.1);
  assert.equal(steal.targetNpc, null, 'Vendedor');
  npc.isVendor = false; game.player.isStunned = true;
  game.interaction.stealPrompt = null;
  steal.update(.1);
  assert.equal(steal.targetNpc, null, 'Aturdido');
  assert.equal(game.interaction.stealPrompt, null, 'Sin aviso');

  game.player.isStunned = false;
  steal.startCosquilleo(npc);
  game.player.isStunned = true;
  steal.update(.1);
  assert.equal(steal.minigameActive, false, 'Aturdirse cierra la barra abierta');
});

test('el Espacio que detuvo la barra es suyo hasta soltarlo: su repetición no salta', () => {
  const { npc, steal } = caughtSetup();
  const press = (code, repeat = false) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, repeat });
    let passed = true;
    event.stopImmediatePropagation = () => { passed = false; };
    steal._onMinigameKey(event);
    return passed;
  };
  steal.startCosquilleo(npc);
  assert.equal(press('Space'), false, 'Detiene la barra');
  assert.equal(steal.minigameActive, false);
  assert.equal(press('Space', true), false, 'La repetición tampoco llega al salto');
  const up = new Event('keyup');
  up.code = 'Space';
  window.dispatchEvent(up);
  assert.equal(press('Space', true), true, 'Soltado, ya es de nuevo del jugador');
  assert.equal(press('Space'), true);
});

test('con el costal lleno no dice que obtuviste el objeto', () => {
  const { game, steal } = caughtSetup();
  const toasts = [];
  window.addEventListener('toast', event => toasts.push(event.detail.text));
  game.inventory.add = () => false;
  const random = Math.random;
  Math.random = () => .1;
  try { steal._giveLoot(CONFIG.lootMoneyCosquilleo, true); } finally { Math.random = random; }
  assert.ok(toasts.some(text => text.includes('No me cabe')), toasts.join(' | '));
  assert.ok(!toasts.some(text => text.includes('Objeto obtenido')));
});

test('junto a basura o al dealer la Q es de ellos: no le roba al que justo va pasando', () => {
  const { game, steal } = caughtSetup();
  const pressed = new Set(['KeyQ']);
  game.input = { consumePress: code => pressed.delete(code) };
  for (const currentTargetType of ['pickup', 'dealer']) {
    game.interaction = { currentTargetType };
    steal.update(.016);
    assert.equal(steal.buscado, 0, currentTargetType);
    assert.equal(pressed.has('KeyQ'), true, currentTargetType);
  }
  game.interaction = { currentTargetType: null };
  steal.update(.016);
  assert.equal(steal.buscado, 1);
});

test('el aviso de la patrulla sale de último: los avisos caen uno encima del otro', () => {
  const { npc, steal } = caughtSetup();
  const order = [];
  steal._toast = () => order.push('aviso');
  steal._alertPolice = () => order.push('patrulla');
  npc.alarmedByTheft = () => {};
  const random = Math.random;
  Math.random = () => .01;
  try { steal.startCosquilleo(npc); steal._endMinigame(false, 'play'); } finally { Math.random = random; }
  assert.equal(order.at(-1), 'patrulla');
  order.length = 0;
  steal.executeRoboDirecto(npc);
  assert.equal(order.at(-1), 'patrulla');
});
