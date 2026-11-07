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
  steal.update(.3); // el raponazo se resuelve cuando la mano llega al bolso
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

// ——— El robo con el cuerpo: raponazo con contacto, mano en el bolsillo, mirones, descubrimientos y la partida ———

const stubRandom = (value, fn) => {
  const random = Math.random;
  Math.random = typeof value === 'function' ? value : () => value;
  try { return fn(); } finally { Math.random = random; }
};
const toastsOf = () => { const list = []; window.addEventListener('toast', e => list.push(e.detail.text)); return list; };

test('el raponazo se resuelve cuando la mano llega: antes no hay plata ni fichado', () => {
  const { game, steal } = caughtSetup();
  const pressed = new Set(['KeyQ']);
  game.input = { consumePress: code => pressed.delete(code) };
  steal.update(.016);
  assert.equal(game.player.stealPose.fase, 'raponazo');
  steal.update(.1);
  assert.equal(game.stats.dinero, 0);
  assert.equal(steal.buscado, 0);
  steal.update(.15);
  assert.ok(game.stats.dinero > 0);
  assert.equal(steal.buscado, 1);
  assert.equal(steal.raponazo, null);
});

test('si la persona se alejó antes del tirón, agarro puro aire y todos se enteran', () => {
  const { npc, game, steal } = caughtSetup();
  const toasts = toastsOf();
  let alarmed = 0, tipo = null;
  npc.alarmedByTheft = (_desde, t) => { alarmed++; tipo = t; };
  steal.startRaponazo(npc);
  npc.position.set(3.5, 0, 0);
  steal.update(.3);
  assert.equal(game.stats.dinero, 0);
  assert.equal(steal.buscado, 0);
  assert.equal(alarmed, 1);
  assert.equal(tipo, 'raponazo-fallido', 'grita por un intento, no por una mano en el bolsillo');
  assert.ok(toasts.some(t => t.includes('Se me escapó')), toasts.join(' | '));
});

test('la persona fuerte se defiende con su puño animado, no con daño al instante', () => {
  const { npc, game, steal } = caughtSetup();
  game.stats.salud = 100;
  game.player.stats = game.stats;
  npc.look = { real: { edad: 'adulto' } };
  const calls = [];
  npc._counterAttack = attacker => { calls.push(attacker); npc._counter = { attacker, damage: 12 }; };
  npc.alarmedByTheft = () => {};
  stubRandom(.5, () => steal.executeRoboDirecto(npc));
  assert.deepEqual(calls, [game.player]);
  assert.equal(game.stats.salud, 100, 'el golpe todavía no llega');
  assert.equal(npc._counter.damage, Math.floor(6 + .5 * 10), 'el daño del robo directo de siempre');
});

test('la mano del jugador sigue a la barra: meter, y sacar, disimular, pillado o soltar', () => {
  const fases = (setup, end) => {
    const { steal, game, npc } = setup();
    npc.alarmedByTheft = () => {};
    steal.startCosquilleo(npc);
    assert.equal(game.player.stealPose.fase, 'meter');
    end(steal);
    const fase = game.player.stealPose?.fase;
    for (let i = 0; i < 200; i++) steal.update(1 / 60);
    assert.equal(game.player.stealPose, null, `${fase} termina`);
    return fase;
  };
  assert.equal(fases(caughtSetup, s => { s.markerPos = s.zoneStart + s.zoneSize / 2; s._endMinigame(true, 'play'); }), 'sacar');
  assert.equal(fases(caughtSetup, s => stubRandom(.999, () => s._endMinigame(false, 'play'))), 'disimular');
  assert.equal(fases(caughtSetup, s => stubRandom(.01, () => s._endMinigame(false, 'play'))), 'pillado');
  assert.equal(fases(caughtSetup, s => s._endMinigame(false, 'cancel')), 'soltar');
});

test('dentro de la zona los dedos se hunden; fuera esperan', () => {
  const { steal, game } = minigame();
  steal.zoneStart = .4; steal.zoneSize = .2;
  steal.markerPos = .5; steal.markerDir = 1;
  for (let i = 0; i < 3; i++) { steal.markerPos = .5; steal.update(1 / 60); }
  assert.ok(game.player.stealPose.hondura > 0);
  for (let i = 0; i < 30; i++) { steal.markerPos = .1; steal.markerDir = 1; steal.update(1 / 60); }
  assert.ok(game.player.stealPose.hondura < .05);
});

test('de espaldas la zona es más grande que de frente', () => {
  const zone = (z) => {
    const { npc, steal, game } = caughtSetup();
    npc.alerta = .5; npc.root = { rotation: { y: 0 } };
    game.player.position.set(0, 0, z); npc.position.set(0, 0, 0);
    stubRandom(.5, () => steal.startCosquilleo(npc));
    return steal.zoneSize;
  };
  assert.ok(zone(-.9) > zone(.9) * 1.5, `${zone(-.9)} vs ${zone(.9)}`);
});

test('«Mano suave» salva un cosquilleo que antes me pillaba', () => {
  const caught = (talents) => {
    const { npc, game, steal } = caughtSetup();
    npc.alerta = .7;
    game.talents = talents;
    let alarmed = false;
    npc.alarmedByTheft = () => { alarmed = true; };
    steal.startCosquilleo(npc);
    stubRandom(.6, () => steal._endMinigame(false, 'play'));
    return alarmed;
  };
  assert.equal(caught(null), true);
  assert.equal(caught({ getEffect: (k, d) => (k === 'stealCaughtMult' ? .8 : d) }), false);
});

test('un cosquilleo limpio suena, da experiencia y no cuenta como robar un espejo', () => {
  const { npc, game, steal } = caughtSetup();
  const played = [], xp = [], mirrors = [], quiet = [];
  game.audio = { play: name => played.push(name) };
  game.stats.addXP = (n) => xp.push(n);
  window.addEventListener('steal', () => mirrors.push(1));
  window.addEventListener('cosquilleo-limpio', e => quiet.push(e.detail));
  steal.startCosquilleo(npc);
  stubRandom(.99, () => steal._endMinigame(true, 'play'));
  assert.deepEqual(played, ['pickup']);
  assert.equal(xp.length, 1);
  assert.equal(mirrors.length, 0, 'el retrovisor tiene su propio evento');
  assert.equal(quiet.length, 1);
  assert.equal(steal.historial.limpios, 1);
});

test('quedarme cerca deja que se palpe el bolsillo y me vea; irme rápido lo deja limpio', () => {
  for (const [lejos, esperado] of [[false, 'me vio'], [true, 'ya no me alcanza']]) {
    const { npc, game, steal } = caughtSetup();
    const toasts = toastsOf(), robos = [];
    window.addEventListener('robo-peaton', e => robos.push(e.detail));
    let alarmed = 0;
    npc.alarmedByTheft = () => alarmed++;
    steal.ajustes.descubre = { chance: 1, min: .2, max: .2, radio: 10 };
    steal.startCosquilleo(npc);
    stubRandom(.01, () => steal._endMinigame(true, 'play'));
    assert.equal(steal.coreo.pendientes, 1);
    if (lejos) game.player.position.set(30, 0, 0);
    for (let i = 0; i < 20; i++) steal.update(.05);
    // Sin Npc de verdad, la quietud corre cuando la llama Npc.update: aquí se llama a mano.
    for (let i = 0; i < 40 && npc.scriptedHold; i++) npc.scriptedHold(.05);
    assert.ok(toasts.some(t => t.includes(esperado)), toasts.join(' | '));
    assert.equal(alarmed, lejos ? 0 : 1);
    assert.equal(robos.length, lejos ? 0 : 1);
    // La práctica es de los limpios de verdad: el que se descubrió por quedarme cerca no cuenta.
    assert.equal(steal.historial.limpios, lejos ? 1 : 0);
  }
});

test('un mirón de frente y cerca vuelve pillado un cosquilleo limpio', () => {
  const { npc, game, steal } = caughtSetup();
  const toasts = toastsOf();
  const miron = { position: new THREE.Vector3(0, 0, 4), root: { rotation: { y: Math.PI } }, said: [], say(t) { this.said.push(t); } };
  game.witnesses = { _witnesses: () => [miron], report() {} };
  npc.alarmedByTheft = () => {};
  steal.ajustes.miron.chance = 1;
  steal.startCosquilleo(npc);
  stubRandom(.5, () => steal._endMinigame(true, 'play'));
  assert.ok(toasts.some(t => t.includes('mirón')), toasts.join(' | '));
  assert.deepEqual(miron.said, ['¡Ladrón!']);
  assert.equal(steal.historial.pillados, 1);
  assert.equal(steal.historial.limpios, 0, 'el que vio un mirón no cuenta como práctica');
  // De espaldas al jugador no ve nada.
  const otro = caughtSetup();
  miron.root.rotation.y = 0; miron.said.length = 0;
  otro.game.witnesses = { _witnesses: () => [miron], report() {} };
  otro.steal.ajustes.miron.chance = 1;
  otro.steal.startCosquilleo(otro.npc);
  stubRandom(.5, () => otro.steal._endMinigame(true, 'play'));
  assert.equal(miron.said.length, 0);
  assert.equal(otro.steal.historial.limpios, 1, 'sin mirón, limpio de verdad');
});

test('si la víctima sigue andando y no la sigo, se me va: la barra se cierra y la mano sale', () => {
  const { npc, game, steal } = caughtSetup();
  const toasts = toastsOf();
  game.player.root = { rotation: { y: Math.PI / 2 } };
  game.player.velocity = new THREE.Vector3();
  game.input.axis = { x: 0, z: 0 };
  npc.position.set(.6, 0, 0);
  steal.startCosquilleo(npc);
  // La sigue sola: con la víctima andando a 1,2 m/s el jugador no se queda atrás.
  for (let i = 0; i < 60; i++) {
    npc.position.x += 1.2 / 60;
    steal.update(1 / 60);
    game.player.position.addScaledVector(game.player.velocity, (1 / 60) * .8);
  }
  assert.equal(steal.minigameActive, true, 'siguiéndola, la barra sigue');
  assert.ok(game.player.position.distanceTo(npc.position) < .8, `pegado: ${game.player.position.distanceTo(npc.position)}`);
  // Ahora el jugador se queda quieto y ella sigue: a 1,25 m se le fue.
  for (let i = 0; i < 90 && steal.minigameActive; i++) { npc.position.x += 1.2 / 60; steal.update(1 / 60); }
  assert.equal(steal.minigameActive, false);
  assert.equal(game.player.stealPose?.fase, 'soltar');
  assert.ok(toasts.some(t => t.startsWith('Se me fue')), toasts.join(' | '));
  assert.ok(game.player.position.distanceTo(npc.position) < CONFIG.stealDistance * 2, 'antes del corte viejo de 3,6 m');
});

test('robarle a uno de los suyos lo cobra el barrio', async () => {
  const { ReputationSystem, FAMA } = await import('../src/systems/ReputationSystem.js');
  const reputation = new ReputationSystem({ target: window });
  const { npc, steal } = caughtSetup();
  npc.alarmedByTheft = () => {};
  npc.person = { arquetipo: 'habitante' };
  steal.executeRoboDirecto(npc);
  assert.equal(reputation.valor, FAMA.roboDirecto + FAMA.robarALosSuyos);
  const otra = caughtSetup();
  otra.npc.alarmedByTheft = () => {};
  otra.npc.person = { arquetipo: 'oficinista' };
  otra.steal.executeRoboDirecto(otra.npc);
  assert.equal(reputation.valor, 2 * FAMA.roboDirecto + FAMA.robarALosSuyos);
});

test('la mano se guarda en la partida; una vieja o dañada empieza de cero y la práctica tiene techo', async () => {
  const { steal, npc } = caughtSetup();
  steal.historial = { limpios: 7, pillados: 2, raponazos: 1, fallidos: 3 };
  const copia = new StealSystem({ player: { position: new THREE.Vector3() } });
  copia.deserialize(JSON.parse(JSON.stringify(steal.serialize())));
  assert.deepEqual(copia.historial, steal.historial);
  copia.deserialize(undefined);
  assert.deepEqual(copia.historial, { limpios: 0, pillados: 0, raponazos: 0, fallidos: 0 }, 'partida sin robo');
  copia.deserialize({ historial: { limpios: 'x', pillados: -2, raponazos: NaN, fallidos: 1.5 } });
  assert.deepEqual(copia.historial, { limpios: 0, pillados: 0, raponazos: 0, fallidos: 0 });
  const zone = (limpios) => {
    steal.historial.limpios = limpios; npc.alerta = .5;
    stubRandom(.5, () => steal.startCosquilleo(npc));
    steal._endMinigame(false, 'cancel');
    return steal.zoneSize;
  };
  assert.ok(Math.abs(zone(50) / zone(0) - 1.12) < 1e-9);
  assert.equal(zone(500), zone(50));

  const { sanearPartida, SaveSystem } = await import('../src/systems/SaveSystem.js');
  assert.equal('robo' in sanearPartida({ robo: 'x' }), false);
  assert.deepEqual(sanearPartida({ robo: { historial: { limpios: 3 } } }).robo, { historial: { limpios: 3 } });
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const save = new SaveSystem();
  const partida = (robo) => save.comoTexto({ stats: { dinero: 1 }, clock: { day: 1, hour: 9 }, inventory: { items: [] }, player: { pos: [0, 0, 0] }, robo });
  assert.equal(save.leerArchivo(partida(5)), null);
  assert.ok(save.leerArchivo(partida({ historial: { limpios: 1 } })));
});

// ——— Al volante, nadando o en el despeje: StealSystem.tick sigue el reloj de lo que quedó del robo ———

test('un cosquilleo limpio y me subo al carro: el palpado tarde llega a su hora, lejos, y no al bajarme', () => {
  const { npc, game, steal } = caughtSetup();
  const toasts = toastsOf();
  let alarmed = 0;
  npc.alarmedByTheft = () => alarmed++;
  steal.ajustes.descubre = { chance: 1, min: 6, max: 6, radio: 10 };
  steal.startCosquilleo(npc);
  stubRandom(.01, () => steal._endMinigame(true, 'play'));
  assert.ok(npc.radius < .4, 'se dejó encimar');
  for (let i = 0; i < 20; i++) steal.update(.05);
  // Arranca en el carro: el juego llama tick, no update.
  game.player.position.set(500, 0, 0);
  // Sin Npc de verdad, la quietud de la víctima la llama la prueba, un cuadro a la vez.
  let t = 1, cuando = null;
  while (t < 12) {
    steal.tick(.05);
    npc.scriptedHold?.(.05);
    t += .05;
    if (cuando === null && toasts.some(x => x.includes('ya no me alcanza'))) cuando = t;
  }
  // A los 6 s se palpa el bolsillo y al segundo mira alrededor: ahí sabe que no me alcanza.
  assert.ok(cuando !== null && Math.abs(cuando - 7) < .1, `el aviso sale a su hora: ${cuando}`);
  assert.equal(steal.coreo.pendientes, 0);
  assert.equal(alarmed, 0);
  assert.equal(game.player.stealPose, null, 'la mano no queda a medias');
  assert.equal(Object.prototype.hasOwnProperty.call(npc, 'radius'), false, 'lejos, el radio de la víctima vuelve');
  assert.equal(steal.historial.limpios, 1);
});

test('un raponazo en vuelo cuando ya no camino se suelta limpio: ni plata, ni alarma, ni tirón al volver', () => {
  const { npc, game, steal } = caughtSetup();
  const toasts = toastsOf(), robos = [];
  window.addEventListener('robo-peaton', e => robos.push(e.detail));
  let alarmed = 0;
  npc.alarmedByTheft = () => alarmed++;
  steal.startRaponazo(npc);
  steal.update(.016);
  assert.equal(game.player.stealPose.fase, 'raponazo');
  for (let i = 0; i < 60; i++) steal.tick(.05);
  assert.equal(steal.raponazo, null);
  assert.equal(game.player.stealPose, null);
  for (let i = 0; i < 30; i++) steal.update(.05);
  assert.equal(game.stats.dinero, 0);
  assert.equal(alarmed, 0);
  assert.deepEqual(robos, []);
  assert.ok(!toasts.some(x => x.includes('Se me escapó')), toasts.join(' | '));
});

test('haciendo rebusque o en el paso atrás del despeje no se ofrece robar ni se gastan E y Q', () => {
  for (const rebusque of [{ activo: true, controlaJugador: false }, { activo: false, controlaJugador: true }]) {
    const { game, steal } = caughtSetup();
    const pressed = new Set(['KeyE', 'KeyQ']);
    game.input = { consumePress: code => pressed.delete(code) };
    game.rebusque = rebusque;
    steal.update(.016);
    assert.equal(steal.minigameActive, false);
    assert.equal(steal.raponazo, null);
    assert.equal(steal.targetNpc, null);
    assert.equal(game.interaction.stealPrompt, undefined);
    assert.deepEqual([...pressed], ['KeyE', 'KeyQ'], 'las teclas quedan para el rebusque');
    // Terminado el rebusque, el robo vuelve.
    game.rebusque = { activo: false, controlaJugador: false };
    steal.update(.016);
    assert.equal(steal.minigameActive, true);
  }
});

test('en el juego, el despeje cierra la barra y corre tick en lugar de update, como al volante o nadando', async () => {
  const { readFileSync } = await import('node:fs');
  const loop = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(loop, /if \(!this\.player\.isSwimming && !driving && !this\.rebusque\?\.controlaJugador\) this\.steal\?\.update\(dt\);\s*else \{(?:\s*\/\/[^\n]*)*\s*if \(this\.steal\?\.minigameActive\) this\.steal\._endMinigame\(false, 'cancel'\);\s*this\.steal\?\.tick\?\.\(dt\);\s*\}/);
});

test('empujando la zorra o la carreta no se ofrece robar; E o Q junto a alguien dicen con qué se suelta, sin llenar la pantalla', () => {
  for (const [carga, aviso] of [[{ zorra: { empujando: true } }, 'Primero suelto la zorra con U'], [{ cart: { isAttached: true } }, 'Primero suelto la carreta con E']]) {
    const { game, steal } = caughtSetup();
    Object.assign(game, carga);
    const avisos = [];
    window.addEventListener('toast', e => avisos.push(e.detail.text));
    const pressed = new Set(['KeyE', 'KeyQ']);
    game.input = { consumePress: code => pressed.delete(code) };
    steal.update(.016);
    assert.equal(steal.minigameActive, false, 'ni cosquilleo');
    assert.equal(steal.raponazo, null, 'ni tirón');
    assert.equal(steal.targetNpc, null, 'ni le quita la E a un carro o al perro');
    assert.equal(game.interaction.stealPrompt, undefined, 'ni aviso de robo');
    assert.deepEqual(avisos, [aviso]);
    // El machaque repite la tecla: el aviso no se repite hasta pasado un rato.
    for (let i = 0; i < 5; i++) { pressed.add('KeyE'); steal.update(.1); }
    assert.deepEqual(avisos, [aviso]);
    steal.update(1.5); pressed.add('KeyQ'); steal.update(.016);
    assert.deepEqual(avisos, [aviso, aviso]);
    // Suelta la carga y el robo vuelve.
    game.zorra = { empujando: false }; game.cart = { isAttached: false };
    pressed.add('KeyE');
    steal.update(.016);
    assert.equal(steal.minigameActive, true);
  }
});

test('sin nadie cerca, empujando, la E y la Q siguen libres', () => {
  const { game, steal, npc } = caughtSetup();
  npc.position.set(10, 0, 0);
  game.zorra = { empujando: true };
  const pressed = new Set(['KeyE', 'KeyQ']);
  game.input = { consumePress: code => pressed.delete(code) };
  steal.update(.016);
  assert.deepEqual([...pressed], ['KeyE', 'KeyQ']);
});

test('junto a basura, empujando, la Q es de la basura: no avisa', () => {
  const { game, steal } = caughtSetup();
  game.zorra = { empujando: true };
  game.interaction.currentTargetType = 'pickup';
  const avisos = [];
  window.addEventListener('toast', e => avisos.push(e.detail.text));
  const pressed = new Set(['KeyQ']);
  game.input = { consumePress: code => pressed.delete(code) };
  steal.update(.016);
  assert.deepEqual([...pressed], ['KeyQ']);
  assert.deepEqual(avisos, []);
});

test('agarrar la zorra con la mano en el bolsillo cierra la barra sin robo ni enfriamiento', () => {
  const { game, steal, npc } = caughtSetup();
  steal.startCosquilleo(npc);
  game.zorra = { empujando: true };
  steal.update(.016);
  assert.equal(steal.minigameActive, false);
  assert.equal(steal.cooldown, 0);
  assert.equal(game.stats.dinero, 0);
});

test('forcejeando por una zorra no se roba: ni la E ni una Q de más, y lo que estaba abierto se cierra', () => {
  const { game, steal, npc } = caughtSetup();
  game.zorraCtl = { forcejeo: { barra: .5 } };
  const pressed = new Set(['KeyE', 'KeyQ']);
  game.input = { consumePress: code => pressed.delete(code) };
  steal.update(.016);
  assert.equal(steal.minigameActive, false);
  assert.equal(steal.raponazo, null);
  assert.equal(steal.targetNpc, null);
  assert.deepEqual([...pressed], ['KeyE', 'KeyQ'], 'la E es de la barra del forcejeo');
  game.zorraCtl = null;
  steal.startCosquilleo(npc);
  game.zorraCtl = { forcejeo: { barra: .5 } };
  steal.update(.016);
  assert.equal(steal.minigameActive, false);
  assert.equal(steal.cooldown, 0);
});

test('un tirón en vuelo se suelta limpio si las manos se van al manubrio o al forcejeo', () => {
  for (const carga of [{ zorra: { empujando: true } }, { cart: { isAttached: true } }, { zorraCtl: { forcejeo: {} } }]) {
    const { npc, game, steal } = caughtSetup();
    let alarmed = 0;
    npc.alarmedByTheft = () => alarmed++;
    steal.startRaponazo(npc);
    steal.update(.016);
    assert.equal(game.player.stealPose.fase, 'raponazo');
    Object.assign(game, carga);
    for (let i = 0; i < 20; i++) steal.update(.05);
    assert.equal(steal.raponazo, null);
    assert.equal(game.player.stealPose, null);
    assert.equal(game.stats.dinero, 0);
    assert.equal(steal.buscado, 0);
    assert.equal(alarmed, 0);
  }
});
