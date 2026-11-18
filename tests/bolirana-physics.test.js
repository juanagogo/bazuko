import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepBall, crossedHole, BALL_RADIUS } from '../bolirana/physics.mjs';
import { boardY } from '../src/features/bolirana/rules.mjs';
const frog = { x: 0, y: 3.4, z: -2.09 };
const hole = { center: { x: 0, z: 0 }, radius: 0.23, value: 7 };
const ball = (x, z, vx, vz) => ({
  p: { x, y: boardY(z) + BALL_RADIUS * Math.hypot(1, 0.28), z },
  v: { x: vx, y: -0.28 * vz, z: vz },
  age: 0,
  rolling: true
});
test('Una bola que rueda puede entrar en un hueco después de fallar otro', () => {
  const b = ball(0, -0.7, 0, 0.7);
  let result;
  for (let i = 0; i < 500 && !result; i++)
    result = stepBall(b, 0.008, [hole], frog);
  assert.equal(result?.points, 7);
});
test('El barrido detecta huecos cruzados entre pasos de simulación', () => {
  assert.equal(crossedHole({ x: 0, z: -0.5 }, { x: 0, z: 0.5 }, [hole]), hole);
});
test('La bola debe caber en el hueco; rozar el borde no puntúa', () => {
  assert.equal(
    crossedHole({ x: 0.2, z: -0.5 }, { x: 0.2, z: 0.5 }, [hole]),
    null
  );
});
test('La captura elige el primer hueco cruzado sin depender del orden de la lista', () => {
  const near = { center: { x: 0, z: -0.3 }, radius: 0.23, value: 2 };
  assert.equal(
    crossedHole({ x: 0, z: -0.7 }, { x: 0, z: 0.4 }, [hole, near]),
    near
  );
});
test('Una bola en el aire no puntúa al pasar sobre un hueco', () => {
  const b = ball(0, -0.01, 0, 2);
  b.rolling = false;
  b.p.y += 1;
  assert.equal(stepBall(b, 0.008, [hole], frog), null);
});
test('La bola se mantiene sobre el tablero y acelera cuesta abajo', () => {
  const b = ball(0.5, -1, 0, 0);
  for (let i = 0; i < 100; i++) stepBall(b, 0.008, [], frog);
  assert.ok(b.v.z > 0);
  assert.ok(
    Math.abs(b.p.y - boardY(b.p.z) - BALL_RADIUS * Math.hypot(1, 0.28)) < 1e-9
  );
});
test('La baranda devuelve la bola baja hacia el tablero', () => {
  const b = ball(1.65, -1, 2, 0);
  stepBall(b, 0.008, [], frog);
  assert.ok(b.v.x < 0);
  assert.ok(b.p.x <= 1.76 - BALL_RADIUS);
});
test('El mismo tiro da el mismo resultado a 60 y 120 FPS con subpasos', () => {
  function simulate(frame) {
    const b = ball(0, -1, 0, 0.7);
    for (let t = 0; t < 6; t += frame) {
      const n = Math.ceil(frame / 0.008);
      for (let i = 0; i < n; i++) {
        const r = stepBall(b, frame / n, [hole], frog);
        if (r) return r.points;
      }
    }
  }
  assert.equal(simulate(1 / 60), 7);
  assert.equal(simulate(1 / 120), 7);
});
