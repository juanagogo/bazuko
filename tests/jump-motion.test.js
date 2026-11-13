import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  HARD_LANDING, JUMP, airborneStrideRate, contactSpeed, hardBrake, hardLanding, hardProfile, hardSlide, landingArms, landingArmsDown, landingDepth, landingDrop,
  landingDuration, landingGive, landingImpact, nextFootfall, pushOffset, recoveryTime, smoothstep, stepVertical, strideShape, timeToGround
} from '../src/character/jumpMotion.js';
import { criticalSpring, dampedSpring, spring } from '../src/character/springs.js';
import { CameraRig, CAMERA_HEIGHT } from '../src/core/Camera.js';
import { Player } from '../src/entities/Player.js';

/** Teclado de prueba: `press` encola una pulsación y `held` dice si el salto sigue oprimido. */
function keyboard() {
  return {
    axis: { x: 0, z: 0 }, isRunning: false, held: false, presses: new Set(),
    consumePress(key) { return this.presses.delete(key); },
    isDown(key) { return (key === 'Space' || key === 'KeySpace') && this.held; }
  };
}

function player(input = keyboard()) {
  const p = new Player(new THREE.Scene(), input);
  return { player: p, input };
}

/** Salta desde el piso con dt fijo y devuelve el ápice y el tiempo en el aire. */
function jump(fps, { hold = Infinity } = {}) {
  const { player: p, input } = player();
  input.presses.add('Space');
  input.held = true;
  let peak = 0, air = 0, frames = 0;
  do {
    input.held = air < hold;
    p.update(1 / fps, null, null, () => 0);
    peak = Math.max(peak, p.position.y);
    air += 1 / fps;
  } while (!p.isGrounded && ++frames < 2000);
  return { peak, air, player: p };
}

test('el salto completo llega a 0,75-0,80 m con el mismo arco a 30, 60 y 144 FPS', () => {
  const arcs = [30, 60, 144].map(fps => jump(fps));
  for (const { peak, air } of arcs) {
    assert.ok(peak > .75 && peak < .8, `ápice ${peak}`);
    assert.ok(air > .55 && air < .7, `tiempo en el aire ${air}`);
  }
  assert.ok(Math.abs(arcs[0].peak - arcs[2].peak) < .02, 'el arco no depende de los FPS');
});

test('soltar el salto pronto lo recorta, pero nunca por debajo de un saltito', () => {
  const full = jump(60), tap = jump(60, { hold: 0 }), half = jump(60, { hold: .16 });
  assert.ok(tap.peak > .45 && tap.peak < full.peak - .15, `toque ${tap.peak} vs ${full.peak}`);
  assert.ok(half.peak > tap.peak && half.peak < full.peak, `a medias ${half.peak}`);
});

test('la gravedad cambia por fase con la integración exacta y el tiempo al suelo coincide con la simulación', () => {
  const out = { y: 0, vy: 0 };
  assert.equal(stepVertical(out, 0, 3, .1).vy, 3 - JUMP.riseGravity * .1);
  assert.equal(stepVertical(out, 0, 0, .05).vy, -JUMP.apexGravity * .05);
  assert.equal(stepVertical(out, 0, -3, .1).vy, -3 - JUMP.fallGravity * .1);
  assert.equal(stepVertical(out, 0, 0, .1, false).vy, -JUMP.fallGravity * .1, 'al caer de un borde no flota');
  // Un paso que cruza el fin de la subida y la banda del ápice sigue por tramos: da lo mismo en uno que en muchos.
  for (const floaty of [true, false]) {
    const big = { ...stepVertical(out, 0, 2.5, .1, floaty) };
    let y = 0, v = 2.5;
    for (let i = 0; i < 100; i++) { stepVertical(out, y, v, .001, floaty); y = out.y; v = out.vy; }
    assert.ok(Math.abs(big.y - y) < 1e-9 && Math.abs(big.vy - v) < 1e-9, `por tramos (${floaty}): ${big.y} ${big.vy} vs ${y} ${v}`);
  }
  for (const [gap, vy, floaty] of [[.9, 0, false], [2.2, 0, false], [.5, -2, true], [.3, 3, true], [.05, .5, true], [.78, 0, true]]) {
    let y = gap, v = vy, t = 0;
    while (y > 0 && t < 5) { stepVertical(out, y, v, 1 / 480, floaty); y = out.y; v = out.vy; t += 1 / 480; }
    const predicted = timeToGround(gap, vy, floaty);
    assert.ok(Math.abs(predicted - t) < .005, `gap ${gap} vy ${vy}: ${predicted} vs ${t}`);
  }
  assert.equal(timeToGround(0, -5), 0);
});

test('con el piso subiendo o bajando debajo (una rampa) el tiempo al suelo también coincide con la simulación', () => {
  const out = { y: 0, vy: 0 };
  for (const floaty of [true, false]) {
    for (const rate of [-4, -1.5, 2, 4.5]) {
      for (const vy of [JUMP.launchSpeed, 2, 0, -3, -9]) {
        for (const gap of [.05, .4, 1.5, 6]) {
          // El piso sube `rate` m/s: toca cuando la altura del cuerpo alcanza la del piso.
          let y = gap, v = vy, t = 0;
          while (y - rate * t > 0 && t < 10) { stepVertical(out, y, v, 1e-4, floaty); y = out.y; v = out.vy; t += 1e-4; }
          const predicted = timeToGround(gap, vy, floaty, rate);
          assert.ok(Math.abs(predicted - t) < 5e-4, `gap ${gap} vy ${vy} piso ${rate} m/s (${floaty}): ${predicted} vs ${t}`);
        }
      }
    }
  }
  assert.equal(timeToGround(1.2, 3, true, 0), timeToGround(1.2, 3, true), 'sin pendiente es el de siempre');
  assert.ok(timeToGround(1, -2, true, 3) < timeToGround(1, -2) && timeToGround(1, -2, true, -3) > timeToGround(1, -2), 'cuesta arriba toca antes y cuesta abajo después');
  assert.equal(timeToGround(0, -5, true, 3), 0);
});

test('un toque suave casi no se dobla: la absorción es entera desde 4,5 m/s y proporcional por debajo', () => {
  assert.equal(landingGive(0), 0);
  assert.equal(landingGive(2.25), .5);
  assert.equal(landingGive(-2.25), .5);
  assert.equal(landingGive(4.5), 1);
  assert.equal(landingGive(11), 1);
  assert.equal(landingGive(NaN), 0);
  assert.equal(landingImpact(4.5), 0, 'donde la absorción ya es entera empieza a contar el impacto');
});

/**
 * Corre por una rampa de `angle` grados (positiva cuesta arriba) y salta: lo que publica en el piso, el vuelo cuadro a
 * cuadro (tiempo al suelo publicado y velocidad vertical) y el golpe con que toca.
 */
function rampRun(angle, fps = 60) {
  const { player: p, input } = player(), tan = Math.tan(angle * Math.PI / 180), ground = x => tan * x;
  input.axis = { x: 1, z: 0 }; input.isRunning = true;
  // Cuesta abajo arranca cayendo sobre la rampa: se le da tiempo a asentarse y llegar a toda marcha.
  for (let i = 0; i < 3.5 * fps; i++) p.update(1 / fps, null, null, ground);
  const onGround = { rate: p.movement.groundRate, slope: p.movement.groundSlope, speed: p.speed, grounded: p.isGrounded };
  input.presses.add('Space'); input.held = true;
  const flight = [];
  for (let i = 0; i < 3 * fps; i++) {
    p.update(1 / fps, null, null, ground);
    if (p.isGrounded) break;
    flight.push({ ttg: p.movement.timeToGround, vy: p.jumpVelocity, rate: p.movement.groundRate });
  }
  return { p, tan, onGround, flight, hit: p.landingSpeed, impact: p.landingImpact, y: p.position.y - ground(p.position.x) };
}

test('rampa: el jugador publica lo que sube el piso, prevé cuándo toca y mide el golpe contra la superficie, igual a 15, 20, 30, 60 y 144 FPS', () => {
  for (const angle of [30, 15, -15, -30]) {
    const r = rampRun(angle), name = `rampa de ${angle}°`;
    assert.ok(r.onGround.grounded && Math.abs(r.onGround.slope - r.tan) < 1e-6, `${name}: pendiente ${r.onGround.slope}`);
    assert.ok(Math.abs(r.onGround.rate - r.onGround.speed * r.tan) < .02 * Math.abs(r.onGround.speed * r.tan), `${name}: el piso sube ${r.onGround.rate} m/s a ${r.onGround.speed} m/s`);
    assert.ok(r.flight.length > 8 && Math.abs(r.y) < 1e-9, `${name}: vuela ${r.flight.length} cuadros y vuelve a la rampa`);
    // El tiempo al suelo publicado es lo que de verdad falta (el control en el aire cambia poco la velocidad).
    r.flight.forEach((f, i) => {
      const left = (r.flight.length - i) / 60;
      assert.ok(Math.abs(f.ttg - left) < .03 + .08 * left, `${name}, cuadro ${i}: prevé ${f.ttg.toFixed(3)} s y faltan ${left.toFixed(3)}`);
    });
    // El golpe es la velocidad normal a la rampa en el contacto (entre la del último cuadro en el aire y un cuadro más de caída).
    const last = r.flight.at(-1), normal = vy => (last.rate - vy) / Math.hypot(1, r.tan);
    assert.ok(r.hit >= normal(last.vy) - 1e-6 && r.hit <= normal(last.vy - JUMP.fallGravity / 60) + 1e-6, `${name}: golpe ${r.hit} entre ${normal(last.vy)} y ${normal(last.vy - JUMP.fallGravity / 60)}`);
    // El contacto se resuelve dentro del cuadro contra la rampa, que también se mueve bajo los pies: da lo mismo a cualquier FPS.
    for (const fps of [15, 20, 30, 144]) {
      const other = rampRun(angle, fps);
      assert.ok(Math.abs(other.hit - r.hit) < .01, `${name} a ${fps} FPS: golpe ${other.hit} vs ${r.hit}`);
    }
  }
  const up = rampRun(30), down = rampRun(-30);
  assert.ok(up.flight.at(-1).vy > 0 && up.hit < 2.5 && up.impact === 0, `cuesta arriba toca subiendo (${up.flight.at(-1).vy} m/s) y el golpe es suave: ${up.hit}`);
  assert.ok(-down.flight.at(-1).vy > HARD_LANDING.to && down.hit < HARD_LANDING.from && hardLanding(down.hit) === 0, `cuesta abajo cae a ${-down.flight.at(-1).vy} m/s y el golpe no es fuerte: ${down.hit}`);
});

test('rampa: un cuadro sin tiempo en pleno vuelo no cambia el golpe', () => {
  // Dos cuadros con la misma marca de tiempo (dt = 0) no miden pendiente: el siguiente sigue en la rampa de antes.
  const run = stalls => {
    const { player: p, input } = player(), tan = Math.tan(-19 * Math.PI / 180), ground = x => tan * x;
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    for (let i = 0; i < 210; i++) p.update(1 / 60, null, null, ground);
    input.presses.add('Space'); input.held = true;
    for (let i = 0; i < 180; i++) {
      p.update(1 / 60, null, null, ground);
      if (p.isGrounded) break;
      assert.ok(Math.abs(p.movement.groundSlope - tan) < 1e-6, `cuadro ${i}: pendiente ${p.movement.groundSlope}`);
      if (stalls) {
        p.update(0, null, null, ground);
        assert.ok(!p.isGrounded && Math.abs(p.movement.groundSlope - tan) < 1e-6, `cuadro ${i}, sin tiempo: pendiente ${p.movement.groundSlope}`);
      }
    }
    return p.landingSpeed;
  };
  const clean = run(false), stalled = run(true);
  assert.ok(clean > 6 && clean < HARD_LANDING.from, `golpe cuesta abajo: ${clean}`);
  assert.ok(Math.abs(stalled - clean) < 1e-9, `con cuadros sin tiempo: ${stalled} vs ${clean}`);
});

test('rampa: el freno del aterrizaje sale del golpe contra el piso, no de la velocidad vertical', () => {
  // Bajando 19° andando y saltando se cae a más de 8 m/s de vertical (con eso el paso quedaría en ~0,65) y contra la
  // rampa son menos de 7 m/s: casi no frena.
  const { player: p, input } = player(), tan = Math.tan(-19 * Math.PI / 180), ground = x => tan * x;
  input.axis = { x: 1, z: 0 };
  for (let i = 0; i < 210; i++) p.update(1 / 60, null, null, ground);
  const cruising = p.velocity.length();
  input.presses.add('Space'); input.held = true;
  let fall = 0;
  for (let i = 0; i < 180 && (i === 0 || !p.isGrounded); i++) { fall = -p.jumpVelocity; p.update(1 / 60, null, null, ground); }
  const kept = p.velocity.length() / cruising, slow = hit => 1 - JUMP.landingSlow * smoothstep(.35, .8, landingImpact(hit));
  assert.ok(p.isGrounded && fall > 8 && p.landingSpeed < 7, `cae a ${fall} m/s y golpea la rampa a ${p.landingSpeed}`);
  assert.ok(Math.abs(kept - slow(p.landingSpeed)) < .02, `el paso queda en ${kept}: con el golpe contra la rampa sería ${slow(p.landingSpeed)}`);
  assert.ok(kept > slow(fall) + .2, `y con la velocidad vertical, ${slow(fall)}`);
});

test('un bordillo, un escalón o un borde no son rampa: el piso solo cuenta como rampa con la misma pendiente dos cuadros seguidos y hasta ~40°', () => {
  for (const [name, ground] of [
    ['bordillo de 8 cm', x => (x < 9 ? 0 : .08)], ['escalón de 50 cm', x => (x < 9 ? 0 : .5)], ['borde de 3 m', x => (x < 9 ? 3 : 0)],
    ['rampa de 45°', x => x]
  ]) {
    const { player: p, input } = player();
    p.position.set(0, ground(0), 0);
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    let air = 0;
    for (let i = 0; i < 240; i++) {
      if (name !== 'rampa de 45°' && p.position.x > 7.8 && p.isGrounded && !input.held) { input.presses.add('Space'); input.held = true; }
      p.update(1 / 60, null, null, ground);
      if (!p.isGrounded) air++;
      assert.equal(p.movement.groundRate, 0, `${name}, cuadro ${i} (x = ${p.position.x.toFixed(2)}): cuenta como rampa`);
      assert.equal(p.movement.groundSlope, 0);
    }
    if (name !== 'rampa de 45°') assert.ok(air > 10 && p.position.x > 9.5, `${name}: lo cruza en el aire`);
  }
});

test('un quiebre del piso no es rampa hasta el cuadro siguiente: de plano a 0,3 por metro tarda un cuadro; a 0,15 sigue de corrido', () => {
  for (const [bend, waits] of [[.3, true], [.15, false]]) {
    const { player: p, input } = player();
    let kink = Infinity;
    const ground = x => Math.max(0, bend * (x - kink));
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    for (let i = 0; i < 120; i++) p.update(1 / 60, null, null, ground);
    // El piso se quiebra justo donde está parado: el cuadro siguiente ya mide la pendiente nueva entera.
    kink = p.position.x;
    p.update(1 / 60, null, null, ground);
    const first = p.movement.groundRate, climbs = bend * p.speed;
    if (waits) assert.equal(first, 0, `quiebre de ${bend}: el primer cuadro ya cuenta como rampa (${first} m/s)`);
    else assert.ok(Math.abs(first - climbs) < .05 * climbs, `quiebre de ${bend}: el primer cuadro publica ${first} m/s y sube ${climbs}`);
    p.update(1 / 60, null, null, ground);
    assert.ok(Math.abs(p.movement.groundRate - bend * p.speed) < .05 * climbs && Math.abs(p.movement.groundSlope - bend) < 1e-6, `quiebre de ${bend}: al cuadro siguiente publica ${p.movement.groundRate} m/s`);
  }
});

test('el primer cuadro no mide rampa: ni al empezar sin tiempo ni en el sitio nuevo después de recolocar al jugador', () => {
  const { player: p, input } = player(), tan = Math.tan(15 * Math.PI / 180), ground = x => tan * x;
  // Un primer cuadro sin tiempo no tiene con qué medir: publica 0, no una división por cero.
  p.update(0, null, null, ground);
  assert.equal(p.movement.groundRate, 0, `el primer cuadro, sin tiempo, publica ${p.movement.groundRate} m/s`);
  input.axis = { x: 1, z: 0 }; input.isRunning = true;
  for (let i = 0; i < 120; i++) p.update(1 / 60, null, null, ground);
  assert.ok(p.isGrounded && Math.abs(p.movement.groundRate - p.speed * tan) < .02 * p.speed * tan, `sube ${p.movement.groundRate} m/s`);
  // Cinco metros más arriba en la misma rampa: entre un sitio y el otro la pendiente es la de la rampa.
  p.position.x += 5; p.position.y = ground(p.position.x);
  p.resetGrounding();
  p.update(1 / 60, null, null, ground);
  assert.equal(p.movement.groundRate, 0, `el primer cuadro publica ${p.movement.groundRate} m/s`);
  assert.equal(p.movement.groundSlope, 0);
  // La vuelve a medir desde cero, como al llegar a ella desde el plano: un cuadro para verla y otro para confirmarla.
  for (let i = 0; i < 2; i++) p.update(1 / 60, null, null, ground);
  assert.ok(Math.abs(p.movement.groundRate - p.speed * tan) < .02 * p.speed * tan && Math.abs(p.movement.groundSlope - tan) < 1e-6, `dos cuadros después la vuelve a publicar: ${p.movement.groundRate} m/s`);
});

test('el aterrizaje escala con el impacto: más hondo y más largo cuanto más fuerte', () => {
  assert.equal(landingImpact(4), 0);
  assert.equal(landingImpact(-10), 1);
  assert.ok(Math.abs(landingDepth(0) - .05) < 1e-9 && Math.abs(landingDepth(1) - .25) < 1e-9);
  assert.ok(Math.abs(recoveryTime(0) - .18) < 1e-9 && Math.abs(recoveryTime(1) - .45) < 1e-9);
  for (const impact of [0, .3, 1]) {
    const total = recoveryTime(impact);
    let deepest = 0;
    for (let t = 0; t <= total; t += .001) {
      const drop = landingDrop(t, impact);
      assert.ok(drop >= 0 && drop <= landingDepth(impact) + 1e-9, 'baja hasta el fondo y no rebota hacia arriba');
      deepest = Math.max(deepest, drop);
    }
    assert.ok(deepest > .9 * landingDepth(impact), `llega al fondo con impacto ${impact}`);
    assert.equal(landingDrop(total, impact), 0, 'termina en el clip');
    assert.equal(landingDrop(-.01, impact), 0);
  }
  // Sigue bajando con una velocidad del orden del golpe, sin parar en seco ni dar un tirón: arranca a ~40 %
  // mientras el pie se asienta (~15 ms) y enseguida va a la velocidad del golpe.
  const speed = landingDrop(.002, .3) / .002;
  let fastest = 0;
  for (let t = 0; t < .03; t += .001) fastest = Math.max(fastest, (landingDrop(t + .001, .3) - landingDrop(t, .3)) / .001);
  assert.ok(speed > 2 && speed < 5, `velocidad inicial ${speed}`);
  assert.ok(fastest > 3 && fastest < 9, `velocidad máxima de los primeros 30 ms ${fastest}`);
  assert.ok(landingDrop(.05, 1) > landingDrop(.05, 0), 'el golpe fuerte se dobla más');
  assert.equal(landingArms(.04, .5), 0, 'los brazos esperan ~50 ms');
  assert.ok(landingArms(.12, .5) > .5, 'luego siguen bajando');
});

test('brazos al aterrizar: bajan desde el contacto, se pasan menos de un 10 % y la pasada llega ~0,1 s después del fondo de la cadera', () => {
  for (const impact of [0, .3, .6, 1]) {
    const total = recoveryTime(impact), dt = 1 / 1000;
    assert.ok(landingArmsDown(1 / 60, total) > .02, `${impact}: ya bajan en el primer cuadro (${landingArmsDown(1 / 60, total).toFixed(3)})`);
    let peak = 0, peakAt = 0, hip = 0, hipAt = 0;
    for (let t = 0; t < total; t += dt) {
      const arms = landingArmsDown(t, total), drop = landingDrop(t, impact);
      if (arms > peak) { peak = arms; peakAt = t; }
      if (drop > hip) { hip = drop; hipAt = t; }
    }
    assert.ok(peak > 1 && peak <= 1.1, `${impact}: se pasan ${(100 * (peak - 1)).toFixed(1)} %`);
    assert.ok(peakAt - hipAt >= .08 && peakAt - hipAt <= .12, `${impact}: la pasada llega ${(peakAt - hipAt).toFixed(3)} s después del fondo de la cadera`);
    assert.ok(Math.abs(landingArmsDown(total, total) - 1) < .05, `${impact}: al terminar el aterrizaje quedan en reposo`);
  }
});

test('el empuje: la cadera visible sale quieta y alcanza al arco sin salto de velocidad', () => {
  const T = JUMP.pushCatch, v0 = JUMP.launchSpeed, g = JUMP.riseGravity, h = 1e-4;
  const rise = t => v0 * t - .5 * g * t * t;
  const visible = t => rise(t) - pushOffset(t);
  assert.equal(pushOffset(0), 0);
  assert.equal(pushOffset(T), 0);
  assert.ok(pushOffset(T / 2) > .05, 'durante el empuje la cadera va por debajo de la raíz');
  for (let t = .005; t < T; t += .005) assert.ok(pushOffset(t) >= 0);
  assert.ok((visible(h) - visible(0)) / h < 1, 'arranca casi quieta');
  const before = (visible(T) - visible(T - h)) / h, after = (rise(T + h) - rise(T)) / h;
  assert.ok(Math.abs(before - after) < .05, `velocidad al soltar ${before} vs ${after}`);
});

test('los resortes son exactos: el mismo resultado con dt de 0,1 s que en pasos chicos y sin explotar', () => {
  const big = spring(1), small = spring(1);
  criticalSpring(big, 0, 12, .1);
  for (let i = 0; i < 100; i++) criticalSpring(small, 0, 12, .001);
  assert.ok(Math.abs(big.x - small.x) < 1e-9 && Math.abs(big.v - small.v) < 1e-9);
  const lazy = spring(1);
  for (let i = 0; i < 50; i++) {
    criticalSpring(lazy, 0, 30, 1);
    assert.ok(lazy.x >= -1e-9 && lazy.x <= 1, 'crítico: llega sin pasarse aun con dt enorme');
  }
  const arm = spring(1), armSmall = spring(1);
  dampedSpring(arm, 0, 10, .7, .1);
  for (let i = 0; i < 100; i++) dampedSpring(armSmall, 0, 10, .7, .001);
  assert.ok(Math.abs(arm.x - armSmall.x) < 1e-9);
  let overshoot = 0;
  const wobble = spring(1);
  for (let i = 0; i < 40; i++) { dampedSpring(wobble, 0, 10, .6, .1); overshoot = Math.min(overshoot, wobble.x); }
  assert.ok(overshoot < -.01 && overshoot > -.2, `subamortiguado: se pasa un poco (${overshoot})`);
  assert.ok(Math.abs(wobble.x) < 1e-3, 'y se asienta');
});

test('en el aire la zancada llega a la próxima pisada justo al tocar el suelo', () => {
  const dt = 1 / 60, rate = 1.4;
  for (const start of [.05, .3, .45, .62, .9]) {
    let phase = start, ttg = .6;
    const foot = nextFootfall(phase);
    while (ttg > 1e-9) {
      const step = airborneStrideRate(rate, phase, ttg, dt, true);
      assert.ok(step <= rate * 1.8 + 1e-9, 'como mucho 1,8 veces más rápido');
      phase = (phase + step * Math.min(dt, ttg)) % 1;
      ttg -= Math.min(dt, ttg);
    }
    const target = foot > 0 ? 0 : .5;
    const miss = Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target));
    assert.ok(miss < .01, `desde ${start}: fase ${phase}, pisada ${target}`);
  }
  assert.equal(nextFootfall(.2), -1, 'después de la izquierda viene la derecha');
  assert.equal(nextFootfall(.7), 1);
  assert.equal(airborneStrideRate(1.4, .3, .5, dt, false), 1.4, 'sin fase alineada sigue a su ritmo, no se congela');
  assert.equal(airborneStrideRate(1.4, .3, Infinity, dt, true), 1.4, 'sin suelo conocido sigue el paso');
});

test('coyote: recién salido del borde todavía salta; después ya no', () => {
  const ledge = (x) => x < 0 ? 1.2 : 0;
  for (const [wait, jumps] of [[.05, true], [.2, false]]) {
    const { player: p, input } = player();
    p.position.set(-.05, 1.2, 0); p.root.position.copy(p.position);
    input.axis = { x: 1, z: 0 };
    let t = 0;
    while (p.isGrounded && t < 1) { p.update(1 / 60, null, null, ledge); t += 1 / 60; }
    assert.equal(p.isGrounded, false, 'salió del borde');
    for (let s = 0; s < wait - 1e-9; s += 1 / 60) p.update(1 / 60, null, null, ledge);
    input.presses.add('Space'); input.held = true;
    p.update(1 / 60, null, null, ledge);
    assert.equal(p.jumpVelocity > 4, jumps, `espera ${wait}: vy ${p.jumpVelocity}`);
  }
});

test('búfer: un salto pedido justo antes de tocar el suelo sale al apoyar; uno pedido antes no', () => {
  for (const [early, jumps] of [[.08, true], [.25, false]]) {
    const { player: p, input } = player();
    p.position.set(0, 2, 0); p.root.position.copy(p.position);
    p.isGrounded = false;
    p.jumpVelocity = 0;
    const ground = () => 0;
    const until = timeToGround(2, 0) - early;
    let t = 0;
    while (t < until) { p.update(1 / 60, null, null, ground); t += 1 / 60; }
    input.presses.add('Space'); input.held = true;
    p.update(1 / 60, null, null, ground);
    assert.equal(p.isGrounded, false, 'todavía en el aire: no salta');
    let jumped = false;
    for (let i = 0; i < 40; i++) {
      p.update(1 / 60, null, null, ground);
      if (p.jumpVelocity > 4) { jumped = true; break; }
    }
    assert.equal(jumped, jumps, `pedido ${early} s antes`);
  }
});

test('en el aire queda poco control y un aterrizaje fuerte frena el paso y lo devuelve', () => {
  const air = player(), ground = player();
  for (const { player: p, input } of [air, ground]) {
    p.velocity.set(0, 0, 0);
    input.axis = { x: 1, z: 0 };
    input.isRunning = true;
  }
  air.player.position.y = 3; air.player.isGrounded = false;
  air.player.update(.05, null, null, () => 0);
  ground.player.update(.05, null, null, () => 0);
  const ratio = air.player.velocity.length() / ground.player.velocity.length();
  assert.ok(ratio > .3 && ratio < .6, `control en el aire ${ratio}`);

  const { player: p, input } = player();
  input.axis = { x: 1, z: 0 }; input.isRunning = true;
  for (let i = 0; i < 60; i++) p.update(1 / 60, null, null, () => 0);
  const cruising = p.velocity.length();
  p.position.y = 2.2; p.root.position.y = 2.2; p.isGrounded = false; p.jumpVelocity = 0;
  while (!p.isGrounded) p.update(1 / 60, null, null, () => 0);
  assert.ok(p.landingImpact > .9, `golpe ${p.landingImpact}`);
  assert.ok(p.velocity.length() < .7 * cruising, 'el golpe frena');
  for (let i = 0; i < 60; i++) p.update(1 / 60, null, null, () => 0);
  assert.ok(p.velocity.length() > .95 * cruising, 'y recupera el paso');
  assert.equal(p.landing, 0);
});

test('la cámara sigue parte del salto con un resorte, baja al aterrizar y respeta movimiento reducido', () => {
  const rig = Object.create(CameraRig.prototype);
  const reset = () => Object.assign(rig, { _height: spring(), _groundRef: null, _lastY: 0, _snap: false });
  const run = () => {
    reset();
    const { player: p, input } = player();
    rig.followHeight(0, 1 / 60, p.movement);
    input.presses.add('Space'); input.held = true;
    let peak = 0, low = 0, frames = 0;
    do {
      p.update(1 / 60, null, null, () => 0);
      const h = rig.followHeight(p.position.y, 1 / 60, p.movement);
      peak = Math.max(peak, h);
      // Cuánto baja por el aterrizaje respecto a donde la deja el resorte.
      if (p.isGrounded) low = Math.min(low, h - rig._height.x);
    } while (frames++ < 90);
    return { peak, low };
  };
  const normal = run();
  assert.ok(normal.peak > .45 && normal.peak < .6, `sigue ~2/3 del salto (con retraso): ${normal.peak}`);
  assert.ok(normal.low < -.02 && normal.low > -.04, `baja de 2 a 4 cm al aterrizar: ${normal.low}`);
  rig.reducedMotion = true;
  const calm = run();
  assert.ok(calm.peak < normal.peak - .1, `con movimiento reducido sigue menos el salto: ${calm.peak}`);
  assert.ok(calm.low > -.005, `y no baja al aterrizar: ${calm.low}`);
  delete rig.reducedMotion;
  reset();
  rig.followHeight(0, 1 / 60, { grounded: true });
  for (let i = 0; i < 30; i++) rig.followHeight(i * .03, 1 / 60, { grounded: true });
  assert.ok(Math.abs(rig._height.x - 29 * .03) < .01, 'en una rampa va con el cuerpo, sin retraso');
  assert.equal(rig.followHeight(10, 1 / 60, { grounded: true }), 10, 'un teletransporte no se anima');
  assert.equal(rig.followHeight(3, 1 / 60, null), 3, 'sin movimiento informado va pegada');
  assert.ok(CAMERA_HEIGHT.jumpShare >= .6 && CAMERA_HEIGHT.jumpShare <= .7);
});

// --- Estados que cortan el salto, FPS y salida del lago ---

/** Simula un ragdoll de `frames` cuadros como `PlayerRagdoll` (el cuerpo queda en manos del ragdoll). */
function ragdollFor(p, frames, ground) {
  p.ragdoll.active = true;
  const real = p.ragdoll.update;
  p.ragdoll.update = () => {};
  for (let i = 0; i < frames; i++) p.update(1 / 60, null, null, ground);
  p.ragdoll.active = false;
  p.ragdoll.update = real;
}

test('un salto pedido en el aire no sobrevive a un ragdoll: al levantarse no salta solo', () => {
  const ground = () => 0;
  const { player: p, input } = player();
  input.presses.add('Space'); input.held = true;
  // Salta, y en la bajada vuelve a pulsar Espacio justo antes de tocar el suelo.
  while (!(p.jumpVelocity < 0 && p.position.y < .15)) { input.held = false; p.update(1 / 60, null, null, ground); }
  input.presses.add('Space');
  p.update(1 / 60, null, null, ground);
  assert.equal(p.isGrounded, false, 'todavía en el aire');
  // Un carro lo tumba antes de apoyar y el ragdoll lo deja en el piso.
  ragdollFor(p, 150, ground);
  assert.equal(p._jumpBuffer, 0, 'el ragdoll borra el salto pedido');
  assert.equal(p._coyote, 0, 'y el margen del borde');
  p.position.y = 0; p.root.position.y = 0;
  for (let i = 0; i < 40; i++) {
    p.update(1 / 60, null, null, ground);
    assert.ok(!(p.jumpVelocity > 4), `al levantarse no salta sin que nadie pulse (cuadro ${i})`);
  }
});

test('el búfer y el coyote se borran mientras no se puede saltar (aturdido, buscando, con la zorra)', () => {
  const ground = () => 0;
  for (const block of [p => { p._impactTime = .05; }, p => { p.sorting = true; }, p => { p.hasCart = true; }]) {
    const { player: p, input } = player();
    p.position.set(0, 1, 0); p.root.position.copy(p.position);
    p.isGrounded = false; p.jumpVelocity = -4;
    input.presses.add('Space');
    p.update(1 / 60, null, null, ground);
    assert.ok(p._jumpBuffer > 0, 'pedido en el aire');
    block(p);
    p.update(1 / 60, null, null, ground);
    assert.equal(p._jumpBuffer, 0, 'el estado que impide saltar no deja nada guardado');
    assert.equal(p._coyote, 0);
  }
});

test('el salto no se come el golpe al aterrizar: la acción se limpia al tocar el suelo', () => {
  for (const hold of [0, Infinity]) {
    const { player: p, input } = player();
    input.presses.add('Space'); input.held = true;
    let air = 0;
    do { input.held = air < hold; p.update(1 / 60, null, null, () => 0); air += 1 / 60; } while (!p.isGrounded);
    assert.notEqual(p.action, 'saltar', `al tocar el suelo ya no está saltando (sostener ${hold})`);
    input.presses.add('KeyG');
    p.update(1 / 60, null, null, () => 0);
    assert.ok(p.melee.active, 'un golpe pedido en el primer cuadro en el piso sale');
  }
});

test('al salir del lago después de lanzarse saltando no queda impulso de salto guardado', () => {
  const dt = 1 / 60;
  const ground = x => (x < 0 ? .3 : -Math.min(3, x * .6));
  const water = x => (x >= 0 ? { surfaceY: 0, bottomY: ground(x), depth: -ground(x) } : null);
  const { player: p, input } = player();
  p.position.set(-1.5, .3, 0); p.root.position.copy(p.position);
  input.axis = { x: 1, z: 0 }; input.isRunning = true;
  for (let i = 0; i < 5; i++) p.update(dt, null, null, ground, [], water);
  input.presses.add('Space'); input.held = true;
  let swam = false;
  for (let t = 0; t < 6 && p.position.x < 8; t += dt) { p.update(dt, null, null, ground, [], water); swam ||= p.isSwimming; }
  assert.ok(swam, 'llegó a nadar');
  input.axis = { x: -1, z: 0 }; input.held = false;
  let airborneFrames = 0;
  for (let i = 0; i < 600 && p.position.x > -1; i++) {
    p.update(dt, null, null, ground, [], water);
    const m = p.movement;
    if (m.grounded === false && !m.swimming) {
      airborneFrames++;
      assert.equal(m.launchSpeed, 0, 'al salir del agua no es un despegue de salto');
      assert.ok(m.fallHeight < .5, `ni una caída desde la cima del salto viejo: ${m.fallHeight}`);
    }
  }
  assert.ok(airborneFrames > 0, 'hubo cuadros en el aire al salir');
});

test('en el aire se sabe si abajo hay agua donde nadar: sobre el lago sí; sobre suelo o agua baja, no', () => {
  for (const [depth, expected] of [[1.8, true], [.6, false], [0, false]]) {
    const { player: p, input } = player();
    const ground = x => (x < 0 ? 8 : -depth), water = x => (depth && x >= 0 ? { surfaceY: 0, bottomY: -depth, depth } : null);
    p.position.set(-.6, 8, 0); p.root.position.copy(p.position);
    input.axis = { x: 1, z: 0 };
    const seen = new Set();
    for (let i = 0; i < 300 && !(p.isGrounded && p.position.x > 0) && !p.isSwimming; i++) {
      if (!p.isGrounded) input.axis = { x: 0, z: 0 };
      p.update(1 / 60, null, null, ground, [], water);
      if (!p.isGrounded && !p.isSwimming && p.position.x > .05) seen.add(p.movement.overWater);
    }
    assert.deepEqual([...seen], [expected], `agua de ${depth} m: ${[...seen]}`);
    p.update(1 / 60, null, null, ground, [], water);
    assert.equal(p.movement.overWater, false, 'en el agua o en el piso ya no está en el aire');
  }
});

/** Corre y baja de un borde de `h` m a `fps`: golpe al tocar y velocidad mínima después (parte de la de antes). */
function dropFrom(h, fps) {
  const { player: p, input } = player();
  input.axis = { x: 1, z: 0 }; input.isRunning = true;
  const ground = x => (x < 0 ? h : 0);
  p.position.set(-6, h, 0); p.root.position.copy(p.position);
  const dt = 1 / fps;
  for (let i = 0; i < 2000 && p.position.x < 0; i++) p.update(dt, null, null, ground);
  const cruising = p.velocity.length();
  for (let i = 0; i < 2000 && !p.isGrounded; i++) p.update(dt, null, null, ground);
  let slowest = p.velocity.length();
  for (let t = 0; t < 1; t += dt) { p.update(dt, null, null, ground); slowest = Math.min(slowest, p.velocity.length()); }
  return { impact: p.landingImpact, slow: slowest / cruising };
}

test('el golpe del aterrizaje y el frenazo no dependen de los FPS', () => {
  for (const h of [.9, 1.2, 1.6, 2.2]) {
    const ref = dropFrom(h, 60);
    for (const fps of [15, 20, 30, 144]) {
      const r = dropFrom(h, fps);
      assert.ok(Math.abs(r.impact - ref.impact) <= .03 * Math.max(ref.impact, .1), `${h} m a ${fps} FPS: golpe ${r.impact} vs ${ref.impact}`);
      assert.ok(Math.abs(r.slow - ref.slow) <= .03 * ref.slow, `${h} m a ${fps} FPS: frenazo ${r.slow} vs ${ref.slow}`);
    }
  }
  const stand = [15, 20, 60, 144].map(fps => jump(fps).player.landingImpact);
  for (const impact of stand) assert.ok(Math.abs(impact - stand[2]) <= .03 * stand[2], `salto parado: ${stand}`);
});

test('el toque sube lo mismo a 20, 30, 60 y 144 FPS: el corte entra en su instante exacto', () => {
  const taps = [20, 30, 60, 144].map(fps => jump(fps, { hold: 0 }).peak);
  for (const peak of taps) assert.ok(Math.abs(peak - taps[2]) <= .01, `toque: ${taps.map(v => v.toFixed(3))}`);
  const full = [20, 30, 60, 144].map(fps => jump(fps).peak);
  for (const peak of full) assert.ok(Math.abs(peak - full[2]) <= .01, `sostenido: ${full.map(v => v.toFixed(3))}`);
});

/**
 * Cae desde `h` m (suelta en el aire, quieta) con la cámara siguiendo a `fps`. Devuelve el retraso de la
 * cámara sobre el cuerpo en `times` (interpolado entre cuadros), el máximo y lo más que baja del cuerpo.
 */
function cameraFall(h, fps, times = [.1, .2, .3, .4, .55]) {
  const rig = Object.create(CameraRig.prototype);
  Object.assign(rig, { _height: spring(), _groundRef: null, _lastY: 0, _snap: false });
  const { player: p } = player();
  const dt = 1 / fps, ground = () => 0;
  p.position.set(0, h, 0); p.root.position.copy(p.position);
  rig.followHeight(h, dt, { grounded: true });
  rig.followHeight(h, dt, { grounded: true });
  p.isGrounded = false; p.jumpVelocity = 0;
  const samples = [[0, 0]];
  let most = 0, below = 0, t = 0;
  for (let i = 0; i < fps * 2; i++) {
    p.update(dt, null, null, ground);
    t += dt;
    const lag = rig.followHeight(p.position.y, dt, p.movement) - p.position.y;
    samples.push([t, lag]);
    most = Math.max(most, lag);
    if (p.isGrounded) below = Math.min(below, lag);
  }
  const at = time => {
    const k = samples.findIndex(([s]) => s >= time);
    const [t0, l0] = samples[k - 1], [t1, l1] = samples[k];
    return l0 + (l1 - l0) * (time - t0) / (t1 - t0);
  };
  return { lags: times.map(at), most, below };
}

test('cayendo, la cámara no se queda atrás: tope de ~0,25 m y el mismo retraso a 20 y a 144 FPS', () => {
  for (const h of [1.2, 2.2, 7.8]) {
    // Antes de tocar el suelo (1,2 m tarda ~0,32 s, 2,2 m ~0,44 s y 7,8 m ~0,82 s), en instantes que caen
    // justo en un cuadro a 20, 30 y 60 FPS.
    const times = h < 2 ? [.1, .2, .3] : h < 5 ? [.1, .2, .3, .4] : [.1, .2, .4, .6, .8];
    const ref = cameraFall(h, 60, times);
    for (const fps of [20, 30, 60, 144]) {
      const r = cameraFall(h, fps, times);
      assert.ok(r.most <= CAMERA_HEIGHT.maxFallLag + .005, `${h} m a ${fps} FPS: como mucho ${CAMERA_HEIGHT.maxFallLag} m por encima (${r.most.toFixed(3)})`);
      assert.ok(r.below > -.06, `${h} m a ${fps} FPS: al aterrizar no se pasa por debajo (${r.below.toFixed(3)})`);
      r.lags.forEach((lag, i) => assert.ok(Math.abs(lag - ref.lags[i]) <= .05 * Math.max(ref.lags[i], .02),
        `${h} m a ${fps} FPS, ${times[i]} s: retraso ${lag.toFixed(4)} vs ${ref.lags[i].toFixed(4)}`));
    }
  }
  assert.ok(CAMERA_HEIGHT.maxFallLag >= .2 && CAMERA_HEIGHT.maxFallLag <= .3);
});

test('golpe fuerte: desde 10,3 m/s al tocar (unos 2,3 m) y completo desde 11,8 m/s (unos 3 m); 2,2 m sigue siendo un aterrizaje medio', () => {
  assert.ok(Math.abs(contactSpeed(0, 5) - Math.sqrt(2 * JUMP.fallGravity * 5)) < 1e-9);
  assert.ok(Math.abs(contactSpeed(JUMP.launchSpeed, 0) - 5.92) < .01, 'un salto parado toca a ~5,9 m/s');
  assert.equal(hardLanding(contactSpeed(0, 2.2)), 0, '2,2 m: medio, como antes');
  assert.ok(hardLanding(contactSpeed(0, 3)) > .99, '3 m ya es un golpe fuerte');
  for (let v = 9; v < 13; v += .05) assert.ok(Math.abs(hardLanding(v + .05) - hardLanding(v)) < .06, `sin salto entre medio y fuerte en ${v}`);
  assert.equal(landingDuration(10), recoveryTime(1));
  const total = landingDuration(15);
  assert.ok(total > .75 && total < .85, `se levanta en ~0,8 s: ${total}`);
  // Baja hasta el fondo, se queda ~0,12 s, sube con un rebote chico y termina en 0.
  const { fall, hold } = HARD_LANDING;
  assert.equal(hardProfile(0), 0);
  assert.ok(hardProfile(fall) > .999 && hardProfile(fall + hold - .001) > .999);
  let lowest = 0;
  for (let t = fall + hold; t < total; t += .005) lowest = Math.min(lowest, hardProfile(t));
  assert.ok(lowest < 0 && lowest * HARD_LANDING.depth > -.02, `rebote de menos de 2 cm: ${lowest * HARD_LANDING.depth}`);
  assert.equal(hardProfile(total), 0);
  assert.ok(HARD_LANDING.depth >= .25 && HARD_LANDING.depth <= .35);
});

test('golpe fuerte: una sola curva frena la marcha hasta cero en ~0,12 s (patina 10-15 cm), queda quieto en el fondo y vuelve al levantarse, a 20, 60 y 144 FPS', () => {
  // La curva: (1 − t/0,12)⁴ mientras baja, cero en el fondo y de vuelta durante la subida.
  const { fall, hold, rise } = HARD_LANDING, end = fall + hold + rise;
  assert.equal(hardBrake(0), 1);
  assert.ok(Math.abs(hardBrake(.06) - .0625) < 1e-9, `a los 60 ms: ${hardBrake(.06)}`);
  assert.equal(hardBrake(.24), 0);
  assert.equal(hardBrake(end), 1);
  for (const fps of [20, 60, 144]) {
    const { player: p, input } = player();
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    const ground = x => (x < 0 ? 5 : 0), dt = 1 / fps;
    p.position.set(-6, 5, 0); p.root.position.copy(p.position);
    for (let i = 0; i < 2000 && p.position.x < 0; i++) p.update(dt, null, null, ground);
    const cruising = p.velocity.length();
    let before = p.position.x;
    for (let i = 0; i < 2000 && !p.isGrounded; i++) { before = p.position.x; p.update(dt, null, null, ground); }
    assert.ok(p.landingSpeed > 14, `toca a ${p.landingSpeed}`);
    // Al tocar no se corta de golpe: el cuerpo llega con su marcha y la curva lo frena.
    const touch = p._landingVelocity;
    assert.ok(touch / cruising > .95, `${fps} FPS: al tocar llega con ${(touch / cruising).toFixed(3)} de la marcha`);
    // Dónde tocó: hasta el contacto el cuadro avanzó a toda marcha.
    const contactX = before + touch * (dt - p.landingTime);
    const at = { t60: null, t240: null };
    while (p.landingTime < fall + hold) {
      p.update(dt, null, null, ground);
      const t = p.landingTime, step = Math.min(dt, t);
      // Cada cuadro avanza lo que la curva avanza en ese tramo: la marcha del cuadro es su promedio.
      const curve = (hardSlide(t) - hardSlide(t - step)) / step;
      assert.ok(Math.abs(p.velocity.length() / touch - curve) < .002, `${fps} FPS, ${t.toFixed(3)} s: ${(p.velocity.length() / touch).toFixed(3)} vs ${curve.toFixed(3)}`);
      if (at.t60 === null && t >= .06) at.t60 = p.velocity.length() / touch;
    }
    assert.ok(at.t60 < .2, `${fps} FPS: a los ~60 ms ya casi no avanza (${at.t60.toFixed(3)})`);
    at.t240 = p.velocity.length() / cruising;
    assert.ok(at.t240 < .01, `${fps} FPS: en el fondo está quieto (${at.t240.toFixed(4)})`);
    const slide = p.position.x - contactX;
    assert.ok(slide > .1 && slide < .15, `${fps} FPS: patina ${(100 * slide).toFixed(1)} cm`);
    while (p.landingTime < end) p.update(dt, null, null, ground);
    assert.ok(p.velocity.length() / cruising > .9, `${fps} FPS: levantado vuelve a la marcha (${(p.velocity.length() / cruising).toFixed(3)})`);
  }
  // 2,2 m sigue frenando a 0,6 como antes.
  assert.ok(Math.abs(dropFrom(2.2, 60).slow - .6) < .03);
});

test('al entrar al ragdoll se borra todo el aterrizaje: al levantarse no sigue un golpe fuerte de antes', () => {
  const { player: p, input } = player();
  const ground = x => (x < 0 ? 5 : 0), dt = 1 / 60;
  p.position.set(-3, 5, 0); p.root.position.copy(p.position); input.axis = { x: 1, z: 0 }; input.isRunning = true;
  for (let i = 0; i < 600 && !(p.landing > 0 && p.landingSpeed > 10); i++) p.update(dt, null, null, ground);
  for (let i = 0; i < 6; i++) p.update(dt, null, null, ground);
  assert.ok(p.landing > .5 && p.landingTime < .2, `golpe fuerte en curso: ${p.landing} / ${p.landingTime}`);
  // Un carro lo tumba en pleno golpe: el ragdoll manda y lo deja 3 m más allá.
  p.ragdoll.active = true; const update = p.ragdoll.update; p.ragdoll.update = () => {};
  p.update(dt, null, null, ground);
  assert.equal(p.landing, 0); assert.equal(p.landingImpact, 0); assert.equal(p.landingSpeed, 0); assert.equal(p.landingTime, Infinity);
  for (let i = 0; i < 120; i++) p.update(dt, null, null, ground);
  p.ragdoll.active = false; p.ragdoll.update = update; p.position.x += 3; p.root.position.copy(p.position);
  input.axis = { x: 0, z: 0 };
  p.update(dt, null, null, ground);
  assert.equal(p.movement.landing, 0, 'al levantarse no hay aterrizaje');
  assert.equal(p.movement.landingSpeed, 0);
});

test('un golpe que lo aturde se publica en el movimiento (la pose suelta los pies anclados)', () => {
  const { player: p } = player();
  p.update(1 / 60, null, null, () => 0);
  assert.equal(p.movement.stunned, false);
  p.receiveHit(new THREE.Vector3(1, 0, 0), 2);
  p.update(1 / 60, null, null, () => 0);
  assert.equal(p.movement.stunned, true);
});

test('al caer al agua desde el puente la cámara frena con un resorte, no de golpe con el cuerpo, y se pasa lo mismo a 20, 30, 60 y 144 FPS', () => {
  const unders = [];
  for (const fps of [20, 30, 60, 144]) {
    const dt = 1 / fps, { player: p, input } = player();
    const rig = Object.create(CameraRig.prototype);
    Object.assign(rig, { _height: spring(), _groundRef: null, _lastY: 0, _snap: false, reducedMotion: false });
    const water = x => (x >= 0 ? { surfaceY: 0, bottomY: -3, depth: 3 } : null);
    p.position.set(-3, 7.8, 0); p.root.position.copy(p.position);
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    rig.followHeight(p.position.y, dt, p.movement);
    let prev = null, speed = null, worst = 0, below = 0, swam = false;
    for (let i = 0; i < fps * 3; i++) {
      p.update(dt, null, null, x => (x < 0 ? 7.8 : -3), [], water);
      const cam = rig.followHeight(p.position.y, dt, p.movement);
      if (prev !== null) {
        const v = (cam - prev) / dt;
        if (speed !== null && (swam || p.isSwimming)) worst = Math.max(worst, Math.abs(v - speed) / dt);
        speed = v;
      }
      if (p.isSwimming) { swam = true; below = Math.max(below, p.position.y - cam); }
      prev = cam;
    }
    assert.ok(swam, `${fps} FPS: entró al agua`);
    // Parar de ~20 m/s en los 25 cm que lleva por encima más unos pocos por debajo pide ~650 m/s² de media; el
    // cuerpo frena en un cuadro (más de 1000 m/s²).
    assert.ok(worst < 600, `${fps} FPS: la cámara frena a ${worst.toFixed(0)} m/s² como mucho`);
    assert.ok(below < .08, `${fps} FPS: se pasa ${(100 * below).toFixed(1)} cm por debajo del cuerpo`);
    unders.push(below);
  }
  assert.ok(Math.max(...unders) - Math.min(...unders) < .07, `lo que se pasa casi no cambia con los FPS: ${unders.map(u => (100 * u).toFixed(1)).join(', ')} cm`);
});

test('la cámara baja 6-8 cm en un golpe fuerte, con un rebote chico; con movimiento reducido no baja', () => {
  const dip = (speed, reduced = false) => {
    const rig = Object.create(CameraRig.prototype);
    Object.assign(rig, { _height: spring(), _groundRef: null, _lastY: 0, _snap: false, reducedMotion: reduced });
    rig.followHeight(0, 1 / 60, { grounded: true });
    let low = 0, high = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      const y = rig.followHeight(0, 1 / 60, { grounded: true, landingTime: t, landingSpeed: speed, landingImpact: landingImpact(speed) });
      low = Math.min(low, y); high = Math.max(high, y);
    }
    return { low, high };
  };
  for (const speed of [12, 15.2, 18.9]) {
    const { low, high } = dip(speed);
    assert.ok(low <= -.058 && low >= -.082, `${speed} m/s: baja ${low.toFixed(3)}`);
    assert.ok(high > 0 && high < .015, `${speed} m/s: vuelve pasándose un poco (${high.toFixed(4)})`);
  }
  assert.ok(dip(18.9).low < dip(12).low, 'más alto, más baja');
  assert.ok(dip(9).low > -.045, 'un aterrizaje medio sigue en 2-4 cm');
  assert.deepEqual(dip(15.2, true), { low: 0, high: 0 });
});

test('despegue parado: la cadera visible baja 4-6 cm en ~55 ms y alcanza a la raíz con su velocidad', () => {
  const T = JUMP.standCatch, v0 = JUMP.launchSpeed, g = JUMP.riseGravity, h = 1e-4;
  const rise = t => v0 * t - .5 * g * t * t;
  const visible = t => rise(t) - pushOffset(t, v0, JUMP.crouch, T);
  let low = 0, lowAt = 0;
  for (let t = 0; t < T; t += .001) if (visible(t) < low) { low = visible(t); lowAt = t; }
  assert.ok(low <= -.04 && low >= -.06 && lowAt > .04 && lowAt < .065, `baja ${low.toFixed(3)} m a los ${lowAt.toFixed(3)} s`);
  for (let t = .001; t < T; t += .002) assert.ok(pushOffset(t, v0, JUMP.crouch, T) >= 0);
  assert.equal(pushOffset(T, v0, JUMP.crouch, T), 0);
  const speed = (visible(T - h) - visible(T - 2 * h)) / h, root = v0 - g * T;
  assert.ok(Math.abs(speed - root) < .05, `alcanza a la raíz con su velocidad: ${speed} vs ${root}`);
  // En carrera no se agacha: la curva de siempre.
  assert.equal(pushOffset(.05), pushOffset(.05, v0, 0, JUMP.pushCatch));
});

test('salto en carrera: el paso va a ~40 % en el ápice y llega a la pisada justo al tocar, a 30, 60 y 144 FPS', () => {
  assert.equal(strideShape(5), 1);
  assert.ok(Math.abs(strideShape(0) - .4) < 1e-9);
  for (const fps of [30, 60, 144]) {
    for (const start of [.1, .25, .4]) {
      const dt = 1 / fps, v = { y: 0, vy: 0 };
      let y = 0, vy = JUMP.launchSpeed, phase = start, early = 0, apex = Infinity;
      stepVertical(v, y, vy, dt); y = v.y; vy = v.vy;
      for (let i = 0; i < 400 && y > 0; i++) {
        const rate = airborneStrideRate(1.4, phase, timeToGround(y, vy), dt, true, vy, true);
        if (vy < 4.5 && !early) early = rate;
        if (Math.abs(vy) < .5) apex = Math.min(apex, rate);
        phase = (phase + rate * dt) % 1;
        stepVertical(v, y, vy, dt); y = v.y; vy = v.vy;
      }
      assert.ok(Math.abs(phase - .5) < .02, `${fps} FPS desde ${start}: llega a la pisada (${phase.toFixed(3)})`);
      assert.ok(apex / early > .3 && apex / early < .5, `${fps} FPS desde ${start}: ápice a ${(apex / early).toFixed(2)} del despegue`);
    }
  }
});
