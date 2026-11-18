// src/systems/MeleeChase.js
// La persecución a golpes que comparten quienes cazan a pie: corre hacia la víctima, levanta el palo, golpea y se recupera.
// No sabe quién es la víctima ni cómo se camina: quien la usa pone la posición del objetivo y tres funciones (alcance, paso y pose).
export const MELEE = {
  attackRange: 1.4,
  windup: .4,           // levanta el arma antes del golpe: tiempo para zafarse
  strikeTime: .16,
  recover: .3,
  cooldown: .75
};

/**
 * Un paso de la persecución de `body` ({ state, stateTimer, attackTimer }) tras `target` ({ x, z }).
 * Devuelve 'swing' (empieza a levantar el arma), 'hit', 'miss' o null.
 * @param {{ speed: number, reach: (target: object, range: number) => boolean, move: (target: object, speed: number, dt: number, stop: number) => void, pose: (phase: string, length: number) => void }} how
 */
export function stepMelee(body, dt, target, { speed, reach, move, pose }) {
  if (body.state === 'windup' || body.state === 'strike' || body.state === 'recover') {
    body.stateTimer -= dt;
    if (body.state === 'windup') {
      pose('windup', MELEE.windup);
      if (body.stateTimer <= 0) { body.state = 'strike'; body.stateTimer = MELEE.strikeTime; }
      return null;
    }
    if (body.state === 'strike') {
      pose('active', MELEE.strikeTime);
      if (body.stateTimer > 0) return null;
      body.state = 'recover';
      body.stateTimer = MELEE.recover;
      body.attackTimer = MELEE.cooldown;
      // solo conecta si la víctima sigue al alcance al bajar el arma
      return reach(target, MELEE.attackRange + .4) ? 'hit' : 'miss';
    }
    pose('recover', MELEE.recover);
    if (body.stateTimer <= 0) { body.state = 'chase'; pose(null, 0); }
    return null;
  }
  if (body.attackTimer <= 0 && reach(target, MELEE.attackRange)) {
    body.state = 'windup';
    body.stateTimer = MELEE.windup;
    pose('windup', MELEE.windup);
    return 'swing';
  }
  move(target, speed, dt, MELEE.attackRange * .75);
  return null;
}
