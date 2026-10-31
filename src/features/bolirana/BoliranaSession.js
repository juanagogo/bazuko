import { Match, MAX_SECONDS, BALLS } from './rules.mjs';
import { cop } from '../../utils/money.js';
// El juego principal administra el saldo y liquida al confirmar el último tiro.
export class BoliranaSession {
  constructor(game) {
    this.game = game;
    this.match = null;
    this.deadline = 0;
    this.result = null;
  }
  snapshot() {
    const g = this.game;
    return {
      balance: Math.floor(g.stats.dinero),
      level: g.bolirana.level,
      playerName: g.look?.nombre || 'Tu personaje',
      quality: g.renderer?.effectiveQuality ?? 'media',
      muted: g.audio.muted,
      volume: g.audio.volume * (g.audio.getMix?.('effects') ?? 1),
      result: this.result
    };
  }
  publish() {
    const g = this.game;
    g.hud?._setText?.(g.hud.moneyEl, cop(g.stats.dinero));
  }
  begin(stake) {
    if (this.match?.active) throw Error('Ya hay una partida activa.');
    const g = this.game,
      old = g.stats.dinero;
    this.match = new Match(Math.floor(old), stake, g.bolirana.level);
    this.result = null;
    g.stats.dinero -= stake;
    g.bolirana.pending = true;
    this.deadline = Date.now() + MAX_SECONDS * 1000;
    try {
      g._save();
    } catch {
      g.stats.dinero = old;
      g.bolirana.pending = false;
      this.match = null;
      throw Error('No se pudo guardar la apuesta.');
    }
    this.publish();
    return this.snapshot();
  }
  score(who, points) {
    if (!this.match?.active || Date.now() > this.deadline)
      throw Error('Partida no disponible.');
    if (!this.match.score(who, points)) throw Error('Lanzamiento no válido.');
    if (this.match.playerBalls === BALLS && this.match.npcBalls === BALLS)
      return this.finish(false);
    return this.snapshot();
  }
  finish(forfeit = false) {
    if (!this.match?.active) return this.snapshot();
    const g = this.game,
      old = {
        money: g.stats.dinero,
        level: g.bolirana.level,
        pending: g.bolirana.pending,
        last: g.bolirana.lastResult,
        balance: this.match.balance,
        matchLevel: this.match.level
      };
    const complete =
      this.match.playerBalls === BALLS && this.match.npcBalls === BALLS;
    const result = this.match.finish(
      !complete && (forfeit || Date.now() > this.deadline)
    );
    if (!result) throw Error('La partida no ha terminado.');
    g.stats.dinero += result.payout;
    g.bolirana.level = result.level;
    g.bolirana.pending = false;
    const receipt = {
      outcome: result.outcome,
      stake: this.match.stake,
      player: this.match.player,
      npc: this.match.npc,
      balance: Math.floor(g.stats.dinero)
    };
    g.bolirana.lastResult = receipt;
    try {
      g._save();
    } catch {
      g.stats.dinero = old.money;
      g.bolirana.level = old.level;
      g.bolirana.pending = old.pending;
      g.bolirana.lastResult = old.last;
      this.match.active = true;
      this.match.balance = old.balance;
      this.match.level = old.matchLevel;
      throw Error('No se pudo guardar el resultado.');
    }
    this.result = receipt;
    this.publish();
    return this.snapshot();
  }
  close() {
    return this.finish(true);
  }
}
