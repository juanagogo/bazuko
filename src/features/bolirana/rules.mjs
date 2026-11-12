export const GRAVITY = 9.81;
export const BALLS = 3;
export const MAX_SECONDS = 120;
export const boardY = (z) => 2.05 - 0.28 * z;
export function boardValues(random = Math.random) {
  const values = Array.from({ length: 10 }, (_, i) => i + 1);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
export function launchVelocity(start, aim, power) {
  const t = 1.05,
    z = aim.z + (power - 0.62) * 7;
  return {
    x: (aim.x - start.x) / t,
    y: (aim.y - start.y + 0.5 * GRAVITY * t * t) / t,
    z: (z - start.z) / t
  };
}
export function validStake(balance, stake) {
  return Number.isSafeInteger(stake) && stake > 0 && stake <= balance;
}
export function settlement(stake, player, npc, forfeited = false) {
  return forfeited || player < npc ? 0 : player === npc ? stake : stake * 2;
}
export class Match {
  constructor(balance, stake, level = 1) {
    if (!validStake(balance, stake))
      throw new Error('Elige una apuesta entera entre $1 y tu saldo.');
    this.balance = balance - stake;
    this.stake = stake;
    this.level = level;
    this.player = 0;
    this.npc = 0;
    this.playerBalls = 0;
    this.npcBalls = 0;
    this.active = true;
  }
  score(who, points) {
    if (
      !this.active ||
      !['player', 'npc'].includes(who) ||
      !Number.isInteger(points) ||
      points < 0 ||
      points > 20
    )
      return false;
    const key = who + 'Balls';
    if (
      this[key] >= BALLS ||
      (who === 'npc' && this.playerBalls < BALLS) ||
      (who === 'player' && this.npcBalls > 0)
    )
      return false;
    this[key]++;
    this[who] += points;
    return true;
  }
  finish(forfeited = false) {
    if (!this.active) return null;
    if (!forfeited && (this.playerBalls !== BALLS || this.npcBalls !== BALLS))
      return null;
    const payout = settlement(this.stake, this.player, this.npc, forfeited);
    const outcome = forfeited
      ? 'forfeit'
      : this.player > this.npc
        ? 'win'
        : this.player < this.npc
          ? 'loss'
          : 'tie';
    this.active = false;
    this.balance += payout;
    this.level =
      outcome === 'win' ? this.level + 1 : outcome === 'tie' ? this.level : 1;
    return { outcome, payout, balance: this.balance, level: this.level };
  }
}
