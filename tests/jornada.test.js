// La jornada: el reloj del juego parte el día en cuatro franjas y cada una cambia el robo, la patrulla y la limosna.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { JornadaSystem, FRANJAS, franjaDe } from '../src/systems/JornadaSystem.js';
import { Clock, DAY_CYCLE_SECONDS } from '../src/core/Clock.js';
import { Game } from '../src/core/game.js';
import { StealSystem } from '../src/features/steal.js';
import { Npc } from '../src/entities/Npc.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { HUD } from '../src/ui/HUD.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

/** Una jornada sobre el reloj de verdad, con los avisos que suelta. */
function jornadaCon(hour) {
  const clock = new Clock({ dayLengthSeconds: DAY_CYCLE_SECONDS });
  clock.hour = hour;
  const target = new EventTarget(), avisos = [];
  target.addEventListener('toast', (e) => avisos.push(e.detail.text));
  return { clock, jornada: new JornadaSystem(clock, { target }), avisos };
}

/** Avanza el reloj como el juego, a 60 cuadros por segundo, hasta pasar la hora pedida. */
function correrHasta(clock, jornada, hasta) {
  for (let i = 0; i < 10_000 && !(clock.hour >= hasta && clock.hour < hasta + 1); i++) {
    clock.update(1 / 60);
    jornada.update();
  }
}

/** Con Math.random fijo, lo que haga `fn`. */
function conAzar(valor, fn) {
  const random = Math.random;
  Math.random = () => valor;
  try { return fn(); } finally { Math.random = random; }
}

test('cada hora cae en su franja, también en los bordes', () => {
  const casos = [
    [0, 'madrugada'], [3, 'madrugada'], [5.999, 'madrugada'],
    [6, 'manana'], [11.999, 'manana'],
    [12, 'tarde'], [19.999, 'tarde'],
    [20, 'noche'], [23.999, 'noche'],
    [24, 'madrugada'], [-1, 'noche'], [undefined, 'madrugada'],
  ];
  for (const [hora, id] of casos) assert.equal(franjaDe(hora).id, id, `a las ${hora}`);
});

test('de 23:59 a 0:00 pasa a la madrugada con un solo aviso, aunque cambie el día', () => {
  const { clock, jornada, avisos } = jornadaCon(23.98);
  assert.equal(jornada.franja, FRANJAS.noche);
  const dia = clock.day;
  correrHasta(clock, jornada, 0);
  for (let i = 0; i < 120; i++) { clock.update(1 / 60); jornada.update(); }
  assert.equal(clock.day, dia + 1);
  assert.equal(jornada.franja, FRANJAS.madrugada);
  assert.deepEqual(avisos, [FRANJAS.madrugada.aviso]);
});

test('de 5:59 a 6:00 amanece con un solo aviso', () => {
  const { clock, jornada, avisos } = jornadaCon(5.98);
  assert.equal(jornada.franja, FRANJAS.madrugada);
  correrHasta(clock, jornada, 6);
  for (let i = 0; i < 120; i++) { clock.update(1 / 60); jornada.update(); }
  assert.equal(jornada.franja, FRANJAS.manana);
  assert.deepEqual(avisos, [FRANJAS.manana.aviso]);
});

test('un día entero da los cuatro avisos en orden, cada uno una sola vez', () => {
  const { clock, jornada, avisos } = jornadaCon(6.05);
  for (let i = 0; i < DAY_CYCLE_SECONDS * 60; i++) { clock.update(1 / 60); jornada.update(); }
  assert.deepEqual(avisos, [FRANJAS.tarde.aviso, FRANJAS.noche.aviso, FRANJAS.madrugada.aviso, FRANJAS.manana.aviso]);
});

test('sincronizar no avisa, y tras sincronizar el siguiente cuadro tampoco', () => {
  const { clock, jornada, avisos } = jornadaCon(8);
  clock.hour = 21; jornada.sincronizar(); jornada.update(); jornada.update();
  assert.equal(jornada.franja, FRANJAS.noche);
  assert.deepEqual(avisos, []);
});

test('al cargar partida a cualquier hora la franja se toma sin aviso', () => {
  const nada = { deserialize() {} };
  for (const hour of [0, 2.5, 5.999, 6, 9, 12, 17.5, 19.999, 20, 23.999]) {
    const { clock, jornada, avisos } = jornadaCon(6); // el reloj nuevo empieza a las 6
    const game = Object.assign(Object.create(Game.prototype), {
      stats: nada, clock, inventory: nada, talents: nada, diseases: nada, player: {}, jornada,
    });
    game._aplicarPartida({ clock: { day: 4, hour } });
    jornada.update();
    assert.equal(jornada.franja, franjaDe(hour), `a las ${hour}`);
    assert.deepEqual(avisos, [], `a las ${hour}`);
  }
});

test('dormir de noche y despertar de mañana avisa una vez que amaneció', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const [hour, franja] of [[22, 'noche'], [2, 'madrugada'], [15, 'tarde']]) {
      const { clock, jornada, avisos } = jornadaCon(hour);
      const game = Object.assign(Object.create(Game.prototype), {
        clock, jornada, built: {}, isSleeping: false,
        player: { root: { visible: true }, position: new THREE.Vector3(), playAction() {} },
        street: { wakeAtHogar() {} }, _save() {},
      });
      assert.equal(jornada.franja.id, franja);
      game.sleep({ hogar: {} });
      mock.timers.tick(1200);
      jornada.update(); jornada.update();
      assert.equal(clock.hour, 6, `desde las ${hour}`);
      assert.deepEqual(avisos, [FRANJAS.manana.aviso], `desde las ${hour}`);
    }
  } finally { mock.timers.reset(); }
});

test('los avisos no tutean ni llevan emojis, y el título del reloj sale del aviso', () => {
  for (const f of Object.values(FRANJAS)) {
    assert.doesNotMatch(f.aviso, /\b(tú|tienes|puedes|vete|corre)\b/i);
    assert.doesNotMatch(f.aviso, /\p{Extended_Pictographic}/u);
    assert.match(f.aviso, /^[^:]+: \S/, `${f.id}: «qué pasó: qué cambia»`);
  }
});

test('de noche el mismo robo saca más plata, siempre en billetes de $100', () => {
  const plata = (franja, monto = 10000) => {
    const game = { stats: { dinero: 0 }, jornada: franja ? { franja } : undefined };
    const robo = Object.assign(Object.create(StealSystem.prototype), { game, _toast() {} });
    conAzar(.5, () => robo._giveLoot([monto, monto], false));
    return game.stats.dinero;
  };
  assert.equal(plata(null), 10000);
  assert.equal(plata(FRANJAS.manana), 10000);
  assert.equal(plata(FRANJAS.tarde), 10000);
  assert.equal(plata(FRANJAS.noche), 13500);
  assert.equal(plata(FRANJAS.madrugada), 15000);
  // Un cosquilleo de $2.300 se multiplica antes de redondear: $3.100 y $3.500, nunca $3.105 ni $3.450.
  assert.equal(plata(FRANJAS.noche, 2300), 3100);
  assert.equal(plata(FRANJAS.madrugada, 2300), 3500);
});

test('de noche el robado que se defiende pega más duro al conectar el golpe anunciado', async () => {
  for (const [franja, damage] of [[null, 11], [FRANJAS.manana, 11], [FRANJAS.tarde, 11], [FRANJAS.noche, 14], [FRANJAS.madrugada, 16]]) {
    const stats = { salud: 100, dinero: 0 };
    const game = { stats, player: { position: new THREE.Vector3(), stats },
      jornada: franja ? { franja } : undefined };
    const robo = Object.assign(Object.create(StealSystem.prototype), { game, buscado: 0, _toast() {} });
    const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0, -1), { look: {}, facing: 0, carriesKnife: false, defenseResolve: 1 });
    try {
      await npc.ready;
      conAzar(.5, () => robo.executeRoboDirecto(npc));
      assert.equal(stats.salud, 100);
      for (let frame = 0; frame < 60 && stats.salud === 100; frame++) npc.update(1 / 60);
      assert.equal(100 - stats.salud, damage, franja?.id ?? 'sin jornada');
    } finally {
      npc.dispose();
    }
  }
});

test('la patrulla ve más lejos de mañana y menos de noche y de madrugada', () => {
  const vista = (franja, wantedLevel = 0) => Object.assign(Object.create(TrafficSystem.prototype),
    { wantedLevel, jornada: franja ? { franja } : undefined }).sightRange;
  const base = vista(null);
  assert.ok(base > 0);
  const veces = (franja, nivel = 0) => Math.round(vista(franja, nivel) / vista(null, nivel) * 1e6) / 1e6;
  assert.equal(veces(FRANJAS.manana), 1.15);
  assert.equal(veces(FRANJAS.tarde), 1);
  assert.equal(veces(FRANJAS.noche), .75);
  assert.equal(veces(FRANJAS.madrugada), .65);
  // El fichado sigue alargándola encima de la franja.
  assert.equal(veces(FRANJAS.noche, 2), .75);
  assert.ok(vista(FRANJAS.noche, 2) > vista(FRANJAS.noche));
  // A 11 m, por detrás de la patrulla, la ve siempre: el cerco de cerca (12 m) no cambia con la hora.
  // A 20 m de frente, de tarde sí la ve (28 m) y de madrugada no (18,2 m).
  const ve = (franja, x) => {
    const traffic = Object.assign(Object.create(TrafficSystem.prototype), { wantedLevel: 0, jornada: franja ? { franja } : undefined });
    const car = { position: new THREE.Vector3(0, 0, 0), group: { rotation: { y: 0 } } };
    return traffic._canWitness({ car }, new THREE.Vector3(x, 0, 0));
  };
  for (const f of Object.values(FRANJAS)) assert.equal(ve(f, -11), true, `${f.id}, a 11 m por detrás`);
  assert.equal(ve(FRANJAS.tarde, 20), true);
  assert.equal(ve(FRANJAS.madrugada, 20), false);
});

test('la limosna rinde más de día y menos de noche y de madrugada', () => {
  const limosna = (franja, azar = [.9]) => {
    const stats = new StatsSystem();
    stats.energia = 50; stats.dinero = 0;
    const player = { position: new THREE.Vector3(), playBeg() {} };
    const interaction = new InteractionSystem(player, { items: [], add: () => true }, stats, { play() {} }, null, null, null);
    interaction.jornada = franja ? { franja } : undefined;
    interaction.setPedestrians([{ position: new THREE.Vector3(2, 0, 2) }]);
    interaction._lastBegTime = -1e9;
    let i = 0;
    const random = Math.random;
    Math.random = () => azar[Math.min(i++, azar.length - 1)];
    try { interaction._beg(); } finally { Math.random = random; }
    return stats.dinero;
  };
  assert.equal(limosna(null), 1400);
  assert.equal(limosna(FRANJAS.manana), 1500);
  assert.equal(limosna(FRANJAS.tarde), 1600);
  assert.equal(limosna(FRANJAS.noche), 1000);
  assert.equal(limosna(FRANJAS.madrugada), 500);
  // El billete raro ($10.000) es el mismo a cualquier hora: no lo ignoran, no regalan comida, sale raro y de $10.000.
  const billete = [.5, .5, .01, .9];
  for (const f of [null, ...Object.values(FRANJAS)]) assert.equal(limosna(f, billete), 10000, f?.id ?? 'sin jornada');
});

test('la tabla solo trae los factores que el juego usa: patrulla, botín, golpe y limosna', () => {
  const lectores = { policiaVista: 'patrulla', botin: 'botín', golpe: 'golpe', limosna: 'limosna' };
  const propios = new Set(['id', 'label', 'desde', 'aviso']);
  for (const f of Object.values(FRANJAS)) {
    const factores = Object.keys(f).filter((k) => !propios.has(k));
    assert.deepEqual(factores.sort(), Object.keys(lectores).sort(), f.id);
  }
});

test('el reloj marca la franja: de noche y de madrugada subrayado, y el título dice qué cambia', () => {
  const clockEl = { dataset: {}, title: '', textContent: '' };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), _panelElapsed: .1, bars: {}, clockEl });
  const pintar = (hour) => { hud.update({ salud: 80 }, { hour, day: 1 }); return { ...clockEl, dataset: { ...clockEl.dataset } }; };
  assert.equal(pintar(7).dataset.franja, 'manana');
  assert.equal(clockEl.title, 'La mañana: la Policía ve lejos y la gente suelta alguna moneda');
  assert.equal(pintar(19.99).dataset.franja, 'tarde');
  const noche = pintar(20);
  assert.equal(noche.dataset.franja, 'noche');
  assert.equal(noche.textContent, '20:00');
  assert.equal(noche.title, 'La noche: la Policía ve menos, pero la calle se pone brava');
  assert.equal(pintar(23.99).dataset.franja, 'noche');
  const madrugada = pintar(0);
  assert.equal(madrugada.dataset.franja, 'madrugada');
  assert.match(madrugada.title, /^La madrugada: casi no hay nadie/);
  const css = readFileSync(new URL('../src/ui/css/hud.css', import.meta.url), 'utf8');
  const regla = css.match(/^(#clock\[data-franja[^{]+)\{([^}]+)\}/m);
  assert.ok(regla, 'hud.css subraya el reloj según la franja');
  assert.match(regla[1], /"noche"/); assert.match(regla[1], /"madrugada"/);
  assert.doesNotMatch(regla[1], /"manana"|"tarde"/);
  assert.match(regla[2], /underline/);
});
