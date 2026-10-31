// src/features/steal.js
import { ITEMS } from '../data/items.js';
import { cop } from '../utils/money.js';

export const CONFIG = {
  stealDistance: 1.8,
  globalCooldown: 3.0,
  npcCooldown: 30.0,
  markerSpeed: 1.8,
  baseZoneSize: 0.35,
  lootMoneyCosquilleo: [3000, 18000],
  lootMoneyDirect: [12000, 45000],
  lootItems: ['pan', 'lataComida', 'cigarrillo', 'tintico', 'moneda', 'reloj'],
  crowdRadius: 12,
  crowdMaxAttackers: 6,
  crowdWitnessChance: 0.72,
  crowdChancePerWitness: 0.15
};

export class StealSystem {
  constructor(game) {
    this.game = game;
    this.cooldown = 0;
    this.buscado = 0;
    this.targetNpc = null;
    this.minigameActive = false;
    this.markerPos = 0;
    this.markerDir = 1;
    this.zoneStart = 0.35;
    this.zoneSize = CONFIG.baseZoneSize;
    this._strongLanguageWarningShown = false;
    this.assaultScene = null;
    this._dom = null;
    this._buildUI();
  }

  _buildUI() {
    if (typeof document === 'undefined') return;
    const box = document.createElement('div');
    box.id = 'steal-minigame';
    box.style.cssText = 'display:none;position:fixed;bottom:140px;left:50%;transform:translateX(-50%);width:280px;height:36px;background:rgba(15,15,18,0.92);border:2px solid #555;border-radius:6px;overflow:hidden;z-index:90;box-shadow:0 0 16px rgba(0,0,0,0.8);';
    box.innerHTML = `
      <div id="steal-track" style="position:relative;width:100%;height:100%;">
        <div id="steal-zone" style="position:absolute;top:0;bottom:0;background:#27ae60;opacity:0.85;"></div>
        <div id="steal-marker" style="position:absolute;top:0;bottom:0;width:8px;background:#ffd166;transform:translateX(-50%);box-shadow:0 0 8px #ffd166;"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:bold 11px monospace;color:#fff;text-shadow:0 0 4px #000;pointer-events:none;">[ESPACIO] DETENER · [ESC] CANCELAR</div>
      </div>
    `;
    document.body.appendChild(box);
    this._dom = {
      box,
      zone: box.querySelector('#steal-zone'),
      marker: box.querySelector('#steal-marker')
    };
    const impact = document.createElement('div');
    impact.id = 'assault-impact-overlay';
    impact.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:120;opacity:0;transition:opacity .12s ease-out;background:radial-gradient(ellipse at center,transparent 42%,rgba(170,0,0,.22) 74%,rgba(255,0,0,.8) 100%);mix-blend-mode:screen;';
    document.body.appendChild(impact);
    this._dom.impact = impact;
  }

  update(dt) {
    const hit = this.game.player?.lastCombatHit;
    if (hit && hit.sequence !== this._lastHitSequence) {
      this._lastHitSequence = hit.sequence;
      if (hit.direction) this._flashImpact(hit.direction);
    }
    this._flashTime = Math.max(0, (this._flashTime ?? 0) - dt);
    if (this._dom?.impact) this._dom.impact.style.opacity = String(Math.min(1, this._flashTime / .16));
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    const npcs = this.game?.world?.active?.npcs ?? [];
    for (const n of npcs) {
      if (n._robadoTimer > 0) n._robadoTimer = Math.max(0, n._robadoTimer - dt);
    }
    if (this.assaultScene) { this._updateAssaultScene(dt); return; }
    if (this.minigameActive) {
      this._updateMinigame(dt);
      return;
    }
    this._checkProximity(npcs);
  }

  _checkProximity(npcs) {
    const playerPos = this.game?.player?.position;
    if (!playerPos || this.game.paused) {
      this.targetNpc = null;
      return;
    }
    let nearest = null;
    let minD = CONFIG.stealDistance;
    for (const n of npcs) {
      if (!n?.position || n.hp <= 0 || n._disposed || (n._robadoTimer ?? 0) > 0) continue;
      const d = playerPos.distanceTo(n.position);
      if (d < minD) {
        minD = d;
        nearest = n;
      }
    }
    this.targetNpc = nearest;
    if (!nearest || this.cooldown > 0) return;
    if (this.game.interaction) {
      this.game.interaction.stealPrompt = '[E] Cosquilleo (sigiloso) · [Q] Robo directo';
    }
    if (this.game.input.consumePress('KeyE')) this.startCosquilleo(nearest);
    else if (this.game.input.consumePress('KeyQ')) this.executeRoboDirecto(nearest);
  }

  startCosquilleo(npc) {
    this.minigameActive = true;
    this.targetNpc = npc;
    npc.alerta ??= 0.35 + Math.random() * 0.4;
    this.zoneSize = Math.max(0.18, CONFIG.baseZoneSize * (1.1 - npc.alerta * 0.4));
    this.zoneStart = 0.15 + Math.random() * (0.85 - this.zoneSize - 0.15);
    this.markerPos = 0;
    this.markerDir = 1;
    if (this._dom) {
      this._dom.zone.style.left = `${this.zoneStart * 100}%`;
      this._dom.zone.style.width = `${this.zoneSize * 100}%`;
      this._dom.box.style.display = 'block';
    }
  }

  _updateMinigame(dt) {
    if (this.game.input.consumePress('Escape')) {
      this._endMinigame(false, 'cancel');
      return;
    }
    const speed = CONFIG.markerSpeed * (1 + (this.targetNpc?.alerta ?? 0.3) * 0.5);
    this.markerPos += this.markerDir * speed * dt;
    if (this.markerPos >= 1) {
      this.markerPos = 1;
      this.markerDir = -1;
    } else if (this.markerPos <= 0) {
      this.markerPos = 0;
      this.markerDir = 1;
    }
    if (this._dom) {
      this._dom.marker.style.left = `${this.markerPos * 100}%`;
    }
    if (this.game.input.consumePress('Space')) {
      const success = this.markerPos >= this.zoneStart && this.markerPos <= (this.zoneStart + this.zoneSize);
      this._endMinigame(success, 'play');
    }
  }

  _endMinigame(success, reason) {
    this.minigameActive = false;
    if (this._dom) this._dom.box.style.display = 'none';
    if (reason === 'cancel') return;
    const npc = this.targetNpc;
    this.cooldown = CONFIG.globalCooldown;
    if (npc) npc._robadoTimer = CONFIG.npcCooldown;
    if (success) {
      this._giveLoot(CONFIG.lootMoneyCosquilleo, true);
      this._toast('🧤 ¡Cosquilleo exitoso! Nadie se dio cuenta.', 'rare');
    } else {
      const bonus = this.game?.dog?.distractionBonus?.(this.game.player?.position) ?? 0;
      const noticeChance = Math.max(0.2, (npc?.alerta ?? 0.5) - bonus);
      if (Math.random() < noticeChance) {
        this._toast('🚨 ¡Lo cogieron con las manos en la masa! El peatón gritó.', 'death');
        this._triggerCrowdConsequence(npc, 'cosquilleo');
      } else {
        this._toast('💨 Fallaste el cosquilleo, pero lograste disimular.', 'warn');
      }
    }
  }

  executeRoboDirecto(npc) {
    this.cooldown = CONFIG.globalCooldown;
    npc._robadoTimer = CONFIG.npcCooldown;
    this.buscado = Math.min(3, this.buscado + 1);
    this._giveLoot(CONFIG.lootMoneyDirect, false);

    this._triggerCrowdConsequence(npc, 'robo directo');
  }

  _triggerCrowdConsequence(victim, kind) {
    const player = this.game?.player;
    const playerPos = player?.position;
    const npcs = this.game?.world?.active?.npcs ?? [];
    if (!playerPos || !this.game?.stats) return false;

    const witnesses = npcs.filter(npc => npc !== victim && npc?.position && !(npc.hp <= 0) && !npc._disposed &&
      Math.abs(npc.position.y - playerPos.y) < 1.2 && npc.position.distanceTo(playerPos) <= CONFIG.crowdRadius)
      .sort((a, b) => a.position.distanceToSquared(playerPos) - b.position.distanceToSquared(playerPos));
    const chance = Math.min(.9, CONFIG.crowdWitnessChance + witnesses.length * CONFIG.crowdChancePerWitness);
    if (!witnesses.length && !victim) return false;
    if (witnesses.length && Math.random() >= chance && kind !== 'robo directo') return false;

    const attackers = Math.min(CONFIG.crowdMaxAttackers, witnesses.length + 1);

    if (!this._strongLanguageWarningShown) {
      this._strongLanguageWarningShown = true;
      this._toast('⚠️ Aviso: la siguiente escena contiene lenguaje fuerte.', 'warn');
    }

    const assaultNpcs = [victim, ...witnesses].filter(Boolean).slice(0, attackers);

    if (victim && typeof victim.onRobbed === 'function') {
      victim.onRobbed(player, assaultNpcs.filter(npc => npc !== victim));
    } else {
      assaultNpcs.forEach((npc, index) => {
        npc.fleeTimer = 0;
        npc.beginAssault?.(player, 'golpe_jab', index * .15, true);
      });
    }

    this.assaultScene = { time: 0, kind, assaultNpcs };
    return true;
  }

  _updateAssaultScene(dt) {
    // Los NPC resuelven el impacto una única vez al alcanzar hitAt.
    const scene = this.assaultScene;
    scene.time += dt;
    if (scene.time < 25 && this.game.stats.salud > 0 &&
        scene.assaultNpcs.some(npc => npc.combatAI?.state !== 'libre' && npc.combatAI?.objetivo)) return;
    if (this.game.stats.salud <= 0) this.game._deathCause = 'agresión colectiva';
    this.assaultScene = null;
  }

  _flashImpact(direction) {
    const overlay = this._dom?.impact;
    if (!overlay) return;
    // La dirección de entrada se convierte a los ejes de la cámara.
    const matrix = this.game.cameraRig?.camera?.matrixWorld?.elements;
    const x = matrix ? -(direction.x * matrix[0] + direction.z * matrix[2]) : -direction.x;
    const z = matrix ? -(direction.x * matrix[8] + direction.z * matrix[10]) : -direction.z;
    const side = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'right' : 'left') : (z > 0 ? 'bottom' : 'top');
    const positions = { left: '0% 50%', right: '100% 50%', top: '50% 0%', bottom: '50% 100%' };
    overlay.style.background = `radial-gradient(ellipse at ${positions[side]},rgba(255,0,0,.88) 0%,rgba(145,0,0,.34) 28%,transparent 67%)`;
    overlay.style.opacity = '1';
    this._flashTime = .26;
  }

  _giveLoot(moneyRange, includeItemChance) {
    const money = Math.floor(moneyRange[0] + Math.random() * (moneyRange[1] - moneyRange[0]));
    if (this.game.stats) this.game.stats.dinero += money;
    this._toast(`💰 +${cop(money)}`, 'sell');
    if (includeItemChance && Math.random() < 0.4 && this.game.inventory) {
      const itemId = CONFIG.lootItems[Math.floor(Math.random() * CONFIG.lootItems.length)];
      if (ITEMS[itemId]) {
        this.game.inventory.add(ITEMS[itemId], 1);
        this._toast(`📦 Objeto obtenido: ${ITEMS[itemId].name}`, 'info');
      }
    }
  }

  _toast(text, type = 'info') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
    }
  }
}
