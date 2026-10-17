// src/ui/MinijuegoLimosna.js
// "Colarse y pedir limosna" en las estaciones TransMilenio.
// - Detecta estaciones de forma genérica: lee game.estaciones.items[].st ({x, z, len, width, axis}).
// - Prompt de interacción: expone `this.prompt` (lo lee el HUD) y atiende la tecla E.
// - Minijuego de timing en un overlay DOM; el juego sigue renderizando detrás con Input.locked = true.
// - Cooldown por estación en memoria (tiempo de juego acumulado vía update(dt)).
import { XP_BEG } from '../utils/constants.js';

// ---------- Ajustes ----------
const RANGE = 2.5;          // u desde el borde de la caja de la estación
const COOLDOWN = 75;        // s de juego entre usos de la misma estación
const ENERGY_COST = 3;      // igual que la limosna normal
const DURATION = 35;        // s de partida
const INTRO = 1.4;          // s de "Prepárate"
const LIVES = 3;
const ZONE_HALF = 0.09;     // media anchura de la zona dorada (fracción del carril)
const GOOD_HALF = 0.055;
const PERFECT_HALF = 0.025;
const COIN = { perfect: 1.4, good: 0.9, ok: 0.5 }; // $ por acierto (antes de racha y multiplicadores)
const PAY_CAP = 30;         // tope de limosna base (antes de ánimo/higiene)
const PAY_MIN = 2;          // mínimo si terminas el tiempo
const CAUGHT_FRAC = 0.3;    // te sacan: cobras 30 %
const QUIT_FRAC = 0.5;      // te rindes (Esc): cobras 50 %
const RUSH_CHANCE = 0.24;   // pasajeros apurados (🚫)
const GUARD_WARN = 1.0;     // s de aviso
const GUARD_WATCH = 1.6;    // s mirando (no pulses)
const GRACE = 0.7;          // s sin perder más vidas tras un error
const PASSENGERS = ['🧑', '👩', '🧓', '💼'];

export class MinijuegoLimosna {
  constructor(game) {
    this.game = game;
    this.prompt = '';           // texto para el HUD ('' = nada)
    this.active = false;
    this._clock = 0;            // tiempo de juego acumulado (s)
    this._cool = new Map();     // clave de estación -> instante (this._clock) en que vuelve a estar disponible
    this._nearKey = null;
    this._promptSec = -1;
    this._raf = 0;
    this._root = null;
    this._onKey = (e) => this._handleKey(e);
    this._onPointer = (e) => { e.preventDefault(); this._press(); };
    this._tick = (now) => this._frame(now);
  }

  // ===== Detección de estaciones + prompt (se llama cada frame desde Game) =====

  update(dt) {
    this._clock += dt;
    if (this.active) { this._checkAbort(); return; }
    const g = this.game;
    this._nearKey = null;
    if (g.isSleeping || g._runOver || g.stats.salud <= 0 || g.input.locked ||
        g.interaction?.currentTarget || g.bed?.isNear?.(g.player.position)) { this._setPrompt(''); return; }

    const list = g.estaciones?.items ?? g.estaciones;
    if (!list || !list.length) { this._setPrompt(''); return; }
    const px = g.player.position.x, pz = g.player.position.z;
    let best = null, bestD = RANGE;
    for (let i = 0; i < list.length; i++) {
      const st = list[i].st ?? list[i];
      if (!st || !Number.isFinite(st.x)) continue;
      // Distancia al borde de la caja (no al centro). axis 'z' = estación alargada en Z.
      const alongZ = st.axis === 'z';
      const hx = (alongZ ? st.width : st.len) / 2;
      const hz = (alongZ ? st.len : st.width) / 2;
      const dx = Math.max(Math.abs(px - st.x) - hx, 0);
      const dz = Math.max(Math.abs(pz - st.z) - hz, 0);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= bestD) { bestD = d; best = st; }
    }
    if (!best) { this._setPrompt(''); return; }

    const key = `${Math.round(best.x)},${Math.round(best.z)}`;
    this._nearKey = key;
    const left = (this._cool.get(key) ?? 0) - this._clock;
    if (left > 0) {
      const s = Math.ceil(left);
      if (s !== this._promptSec) { this._promptSec = s; this.prompt = `Vuelve más tarde (${s} s)`; }
      return;
    }
    this._promptSec = -1;
    this._setPrompt('[E] Colarse y pedir limosna');
    // (si hay otro objetivo interactuable cerca, ya se descartó arriba: la E es suya)
    if (g.input.consumePress('KeyE')) this.open(key);
  }

  _setPrompt(t) { if (this.prompt !== t) this.prompt = t; this._promptSec = -1; }

  // ===== Abrir / cerrar =====

  open(key) {
    if (this.active) return;
    const g = this.game;
    if (g.stats.energia < ENERGY_COST) {
      g.audio?.play('empty');
      window.dispatchEvent(new CustomEvent('beg-fail', { detail: { reason: 'energy' } }));
      return;
    }
    g.stats.energia = Math.max(0, g.stats.energia - ENERGY_COST);
    this._cool.set(key, this._clock + COOLDOWN + DURATION); // el cooldown cuenta desde que termina la partida
    this.active = true;
    this.prompt = '';
    g.input.locked = true;

    this._resetRun();
    this._buildDom();
    window.addEventListener('keydown', this._onKey, true);
    this._lastNow = performance.now();
    this._begT = 0;
    g.player?.playBeg?.();
    this._raf = requestAnimationFrame(this._tick);
  }

  /** Cierra y limpia (sin pagar; el pago se aplica al terminar la partida). */
  close() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    window.removeEventListener('keydown', this._onKey, true);
    if (this._root) {
      this._root.removeEventListener('pointerdown', this._onPointerRoot);
      this._root.remove();
    }
    this._root = null;
    this._el = null;
    const g = this.game;
    // Si nos atropellan mientras jugábamos, Game restaurará _prevLocked al terminar la animación.
    if (g._runOver) g._prevLocked = false;
    else g.input.locked = false;
  }

  _checkAbort() {
    const g = this.game;
    if (g._runOver || g.stats.salud <= 0 || g.isSleeping) this.close();
  }

  dispose() {
    this.close();
    this._cool.clear();
  }

  // ===== Estado de la partida =====

  _resetRun() {
    this.state = 'intro';       // intro -> play -> result
    this.t = 0;                 // tiempo jugado
    this.lives = LIVES;
    this.coins = 0;
    this.combo = 0;
    this.hits = 0;
    this.perfects = 0;
    this.perfStreak = 0;
    this.maxPerfStreak = 0;
    this.guardsPassed = 0;
    this.grace = 0;
    this.spawnT = 0.5;
    this.guard = 'none';        // none | warn | watch
    this.guardT = 0;
    this.nextGuard = 6 + Math.random() * 2.5;
    this.ps = { active: false, p: 0, dir: 1, speed: 0.4, rush: false, served: false, icon: '' };
    this.resultT = 0;
    this.result = null;
    this._begAnim = 0;
    this._c = { time: -1, coins: '', combo: -1, lives: -1, guard: '' };
  }

  _frame(now) {
    if (!this.active) return;
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, (now - this._lastNow) / 1000);
    this._lastNow = now;
    this._checkAbort();
    if (!this.active) return;

    // Pose de pedir: se renueva mientras dura el minijuego
    this._begAnim -= dt;
    if (this._begAnim <= 0) { this._begAnim = 0.8; this.game.player?.playBeg?.(); }

    if (this.state === 'intro') {
      this._begT += dt;
      if (this._begT >= INTRO) { this.state = 'play'; this._setBanner(''); }
      this._render();
      return;
    }
    if (this.state === 'result') { this.resultT += dt; return; }

    this.t += dt;
    if (this.grace > 0) this.grace -= dt;
    this._updateGuard(dt);
    this._updatePassenger(dt);
    if (this.t >= DURATION) { this._finish('done'); return; }
    this._render();
  }

  _updateGuard(dt) {
    if (this.guard === 'none') {
      this.nextGuard -= dt;
      if (this.nextGuard <= 0) {
        this.guard = 'warn'; this.guardT = GUARD_WARN;
        const a = this.game.audio;
        a?.blip(660, 0.14, 'square', 0.16);
        a?.blip(880, 0.14, 'square', 0.16, 0, 0.18);
        a?.blip(660, 0.14, 'square', 0.16, 0, 0.36);
        a?.blip(880, 0.2, 'square', 0.16, 0, 0.54);
      }
    } else {
      this.guardT -= dt;
      if (this.guardT <= 0) {
        if (this.guard === 'warn') { this.guard = 'watch'; this.guardT = GUARD_WATCH; this.game.audio?.blip(220, 0.25, 'sawtooth', 0.14, 140); }
        else {
          this.guard = 'none';
          this.guardsPassed++;
          this.coins += 0.5; // bono por quedarte quieto
          const k = this.t / DURATION; // el siguiente viene antes a medida que avanza
          this.nextGuard = 6.5 - 2 * k + Math.random() * 2.5;
        }
      }
    }
  }

  _updatePassenger(dt) {
    const ps = this.ps;
    if (!ps.active) {
      if (this.guard !== 'none') return; // no entran pasajeros mientras el guardia anda cerca
      this.spawnT -= dt;
      if (this.spawnT > 0) return;
      ps.active = true;
      ps.dir = Math.random() < 0.5 ? 1 : -1;
      ps.p = ps.dir > 0 ? -0.06 : 1.06;
      ps.rush = Math.random() < RUSH_CHANCE;
      ps.served = false;
      ps.icon = ps.rush ? '🏃' : PASSENGERS[(Math.random() * PASSENGERS.length) | 0];
      // Dificultad creciente: de 0.42 a ~0.72 carril/s
      ps.speed = (0.42 + 0.3 * (this.t / DURATION)) * (0.92 + Math.random() * 0.16);
      this._showPassenger(ps);
      return;
    }
    ps.p += ps.dir * ps.speed * dt;
    if (ps.p < -0.08 || ps.p > 1.08) {
      // Se fue sin que lo atendieras
      if (!ps.served && !ps.rush && this.guard !== 'watch') this.combo = 0;
      ps.active = false;
      this.spawnT = 0.25 + Math.random() * 0.5;
      this._el.pass.style.display = 'none';
    }
  }

  // ===== Entrada =====

  _handleKey(e) {
    // Atajos del navegador (Ctrl+R, F5, F12...) pasan
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      if (this.state === 'play') this._finish('quit');
      else this.close();
    } else if (e.code === 'Space') {
      this._press();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.state === 'result' && this.resultT > 0.4) this.close();
    }
    // WASD / flechas / E / resto: tragados (no mueven al personaje)
  }

  _press() {
    if (!this.active || this.state !== 'play' || this.grace > 0) return;
    const ps = this.ps;
    if (this.guard === 'watch') { this._penalty('¡El guardia te vio!'); return; }
    const d = Math.abs(ps.p - 0.5);
    if (ps.active && d <= ZONE_HALF) {
      if (ps.served) return; // ya lo atendiste
      ps.served = true;
      if (ps.rush) { this._penalty('¡Iba apurado!'); return; }
      const a = this.game.audio;
      let val, label, cls;
      if (d <= PERFECT_HALF) { val = COIN.perfect; label = '¡PERFECTO!'; cls = 'p'; this.perfects++; this.perfStreak++; if (this.perfStreak > this.maxPerfStreak) this.maxPerfStreak = this.perfStreak; }
      else if (d <= GOOD_HALF) { val = COIN.good; label = '¡Bien!'; cls = 'g'; this.perfStreak = 0; }
      else { val = COIN.ok; label = 'Regular'; cls = 'o'; this.perfStreak = 0; }
      this.hits++;
      this.combo++;
      const gain = val * (1 + Math.min(this.combo, 10) * 0.04);
      this.coins += gain;
      a?.blip(988, 0.07, 'square', 0.12);
      a?.blip(1319, 0.14, 'square', 0.12, 0, 0.07);
      if (cls === 'p') a?.blip(1760, 0.18, 'triangle', 0.12, 0, 0.14);
      this._feedback(`${label} 🪙 +$${gain.toFixed(1)}`, cls);
      return;
    }
    this._penalty('¡Fuera de tiempo!');
  }

  _penalty(msg) {
    this.lives--;
    this.combo = 0;
    this.perfStreak = 0;
    this.grace = GRACE;
    this.game.audio?.blip(180, 0.28, 'sawtooth', 0.18, 70);
    this._feedback(`${msg} 💔`, 'x');
    this._root.classList.remove('mjl-hurt');
    void this._root.offsetWidth; // reinicia la animación
    this._root.classList.add('mjl-hurt');
    if (this.lives <= 0) this._finish('caught');
  }

  // ===== Final y pago =====

  _finish(kind) {
    if (this.state === 'result') return;
    const g = this.game;
    const st = g.stats;
    let base;
    if (kind === 'done') {
      base = this.coins + this.lives * 1;
      if (this.maxPerfStreak >= 4) base += 1;
      if (this.maxPerfStreak >= 8) base += 2;
      base = Math.min(PAY_CAP, base);
    } else {
      base = Math.min(PAY_CAP, this.coins) * (kind === 'caught' ? CAUGHT_FRAC : QUIT_FRAC);
    }
    // Estadísticas: ánimo 0.8x-1.2x, higiene muy baja = la gente se aparta (x0.5), talentos (begMult si existe)
    const animoMult = 0.8 + 0.4 * Math.max(0, Math.min(100, st.animo ?? 50)) / 100;
    const dirty = typeof st.isRejectedByNPCs === 'function' ? st.isRejectedByNPCs() : st.higiene < 20;
    const talentMult = g.talents?.getEffect?.('begMult', 1) ?? 1;
    const mult = animoMult * (dirty ? 0.5 : 1) * talentMult;
    let amount = Math.round(base * mult);
    if (kind === 'done') amount = Math.max(PAY_MIN, amount);

    if (amount > 0) {
      st.dinero += amount;
      const score = Math.min(1, amount / PAY_CAP);
      st.addXP(Math.round(XP_BEG * (1 + score * 3)), g.talents);
      st.animo = Math.min(100, st.animo + (kind === 'done' ? 2 + Math.round(score * 6) : 1));
      g.audio?.blip(784, 0.1, 'square', 0.14); g.audio?.blip(988, 0.1, 'square', 0.14, 0, 0.1); g.audio?.blip(1319, 0.22, 'square', 0.14, 0, 0.2);
    }
    if (kind === 'caught') {
      st.animo = Math.max(0, st.animo - 3);
      g.audio?.blip(300, 0.5, 'sawtooth', 0.16, 90);
    }

    const title = kind === 'done' ? '¡Buena jornada!' : kind === 'caught' ? 'Te sacaron de la estación' : 'Te fuiste de la estación';
    this.state = 'result';
    this.resultT = 0;
    this.result = { kind, amount };
    this._showResult(title, amount, kind, dirty);
    window.dispatchEvent(new CustomEvent('beg-result', {
      detail: {
        success: amount > 0, money: amount, rare: amount >= 20,
        message: amount > 0 ? `🚇 Limosna en la estación: $${amount}` : '🚇 Te sacaron de la estación sin nada'
      }
    }));
  }

  // ===== DOM =====

  _buildDom() {
    const root = document.createElement('div');
    root.id = 'mjl-root';
    root.innerHTML = `
      <div class="mjl-panel">
        <div class="mjl-head">
          <div class="mjl-title">🚇 Colándote en la estación</div>
          <div class="mjl-lives" data-r="lives"></div>
        </div>
        <div class="mjl-stats">
          <span>🪙 $<b data-r="coins">0.0</b></span>
          <span>🔥 Racha <b data-r="combo">0</b></span>
        </div>
        <div class="mjl-timebar"><div class="mjl-timefill" data-r="time"></div></div>
        <div class="mjl-lane" data-r="lane">
          <div class="mjl-zone"><div class="mjl-perfect"></div></div>
          <div class="mjl-pass" data-r="pass"></div>
          <div class="mjl-guard" data-r="guard">👮</div>
          <div class="mjl-banner" data-r="banner"></div>
        </div>
        <div class="mjl-feedback" data-r="fb">&nbsp;</div>
        <button class="mjl-btn" data-r="btn" type="button">🙏 PEDIR (ESPACIO / toque)</button>
        <div class="mjl-hint">Pide cuando el pasajero esté en la zona dorada · 🚫 no pidas a los apurados · quieto si aparece el 👮 · Esc = rendirse</div>
        <div class="mjl-result" data-r="result"></div>
      </div>`;
    document.body.appendChild(root);
    this._root = root;
    const q = (n) => root.querySelector(`[data-r="${n}"]`);
    this._el = {
      lives: q('lives'), coins: q('coins'), combo: q('combo'), time: q('time'), lane: q('lane'),
      pass: q('pass'), guard: q('guard'), banner: q('banner'), fb: q('fb'), btn: q('btn'), result: q('result')
    };
    this._onPointerRoot = (e) => {
      if (e.target.closest('.mjl-btn') || e.target.closest('[data-r="lane"]')) this._onPointer(e);
    };
    root.addEventListener('pointerdown', this._onPointerRoot);
    this._el.result.addEventListener('click', (e) => {
      if (e.target.closest('.mjl-close') && this.resultT > 0.3) this.close();
    });
    this._setBanner('¡Prepárate!');
    this._render(true);
  }

  _setBanner(t) { this._el.banner.textContent = t; }

  _showPassenger(ps) {
    const el = this._el.pass;
    el.textContent = ps.rush ? '🏃🚫' : ps.icon;
    el.className = 'mjl-pass' + (ps.rush ? ' rush' : '');
    el.style.display = 'block';
  }

  _feedback(text, cls) {
    const f = this._el.fb;
    f.textContent = text;
    f.className = 'mjl-feedback ' + cls;
    f.style.animation = 'none';
    void f.offsetWidth;
    f.style.animation = '';
  }

  /** Solo escribe en el DOM lo que cambió */
  _render(force = false) {
    const e = this._el;
    const c = this._c || (this._c = { time: -1, coins: '', combo: -1, lives: -1, guard: '' });
    if (!e) return;
    const tl = Math.max(0, Math.ceil(DURATION - this.t));
    if (force || c.time !== tl) {
      c.time = tl;
      e.time.style.width = `${Math.max(0, 100 - (this.t / DURATION) * 100).toFixed(1)}%`;
    } else if (this.state === 'play') {
      e.time.style.width = `${Math.max(0, 100 - (this.t / DURATION) * 100).toFixed(1)}%`;
    }
    const cs = this.coins.toFixed(1);
    if (c.coins !== cs) { c.coins = cs; e.coins.textContent = cs; }
    if (c.combo !== this.combo) { c.combo = this.combo; e.combo.textContent = this.combo; }
    if (c.lives !== this.lives) {
      c.lives = this.lives;
      e.lives.textContent = '❤'.repeat(Math.max(0, this.lives)) + '🖤'.repeat(Math.max(0, LIVES - this.lives));
    }
    // Guardia
    const gs = this.guard;
    if (c.guard !== gs) {
      c.guard = gs;
      e.guard.className = 'mjl-guard ' + gs;
      e.lane.classList.toggle('watch', gs === 'watch');
      if (gs === 'warn') this._setBanner('⚠ ¡VIENE EL GUARDIA! Prepárate a quedarte quieto');
      else if (gs === 'watch') this._setBanner('👀 ¡NO PULSES!');
      else if (this.state === 'play') this._setBanner('');
    }
    if (this.ps.active) {
      this._el.pass.style.left = `${(this.ps.p * 100).toFixed(1)}%`;
      this._el.pass.classList.toggle('served', this.ps.served);
    }
  }

  _showResult(title, amount, kind, dirty) {
    const r = this._el.result;
    const hearts = '❤'.repeat(Math.max(0, this.lives)) + '🖤'.repeat(Math.max(0, LIVES - this.lives));
    r.innerHTML = `
      <div class="mjl-rtitle ${kind}">${title}</div>
      <div class="mjl-rrows">
        <div>Aciertos <b>${this.hits}</b></div>
        <div>Perfectos <b>${this.perfects}</b></div>
        <div>Mejor racha perfecta <b>${this.maxPerfStreak}</b></div>
        <div>Vidas <b>${hearts}</b></div>
        <div>Guardias esquivados <b>${this.guardsPassed}</b></div>
      </div>
      ${dirty ? '<div class="mjl-note">La gente se aparta por tu olor (x0.5)</div>' : ''}
      <div class="mjl-total">Limosna total <b>$${amount}</b></div>
      <button class="mjl-close" type="button">Cerrar (Enter)</button>`;
    r.classList.add('show');
    this._el.btn.style.display = 'none';
  }
}
