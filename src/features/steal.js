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
  directDamageMin: 6,
  directDamageMax: 16,
  crowdRadius: 12,
  crowdMaxAttackers: 6,
  crowdWitnessChance: 0.72,
  crowdChancePerWitness: 0.15,
  crowdDamagePerAttacker: 9
};

export class StealSystem {
  // Inicializa el sistema de robo a peatones.
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

  // Construye la interfaz HTML para el minijuego de cosquilleo.
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

  // Actualiza tiempos, detección de peatones y el minijuego de cosquilleo.
  update(dt) {
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

  // Encuentra el NPC más cercano y procesa las teclas de interacción E y Q.
  _checkProximity(npcs) {
    const playerPos = this.game?.player?.position;
    if (!playerPos || this.game.paused) {
      this.targetNpc = null;
      return;
    }
    let nearest = null;
    let minD = CONFIG.stealDistance;
    for (const n of npcs) {
      if (!n?.position || (n._robadoTimer ?? 0) > 0) continue;
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

  // Inicia el minijuego de timing para el cosquilleo.
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

  // Actualiza la oscilación del marcador y procesa la entrada del minijuego.
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

  // Concluye el minijuego aplicando botín o alertando al peatón.
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
        npc?.hitByPoop?.(this.game.player.position);
        this._toast('🚨 ¡Lo cogieron con las manos en la masa! El peatón gritó.', 'death');
        this._triggerCrowdConsequence(npc, 'cosquilleo');
      } else {
        this._toast('💨 Fallaste el cosquilleo, pero lograste disimular.', 'warn');
      }
    }
  }

  // Ejecuta un robo directo agresivo con mayor botín y consecuencias.
  executeRoboDirecto(npc) {
    this.cooldown = CONFIG.globalCooldown;
    npc._robadoTimer = CONFIG.npcCooldown;
    this.buscado = Math.min(3, this.buscado + 1);
    this._giveLoot(CONFIG.lootMoneyDirect, false);
    npc.hitByPoop?.(this.game.player.position);
    const isStrong = (npc.look?.real?.edad === 'adulto' || Math.random() < 0.45);
    if (isStrong && this.game.stats) {
      const dmg = Math.floor(CONFIG.directDamageMin + Math.random() * (CONFIG.directDamageMax - CONFIG.directDamageMin));
      this.game.stats.salud = Math.max(0, this.game.stats.salud - dmg);
      this._toast(`👊 ¡El peatón se defendió! Recibiste -${dmg} de salud. Buscado: ${this.buscado}/3`, 'death');
    } else {
      this._toast(`⚡ ¡Robo directo ejecutado! Peatón asustado. Buscado: ${this.buscado}/3`, 'warn');
    }
    this._triggerCrowdConsequence(npc, 'robo directo');
  }

  /** Personas cercanas pueden responder a un robo detectado. La agresión no ofrece recompensa. */
  _triggerCrowdConsequence(victim, kind) {
    const player = this.game?.player;
    const playerPos = player?.position;
    const npcs = this.game?.world?.active?.npcs ?? [];
    if (!playerPos || !this.game?.stats) return false;

    const witnesses = npcs.filter(npc => npc !== victim && npc?.position &&
      npc.position.distanceTo(playerPos) <= CONFIG.crowdRadius);
    const chance = Math.min(.9, CONFIG.crowdWitnessChance + witnesses.length * CONFIG.crowdChancePerWitness);
    if (!witnesses.length || Math.random() >= chance) return false;

    const attackers = Math.min(CONFIG.crowdMaxAttackers, witnesses.length + 1);
    const damage = attackers * CONFIG.crowdDamagePerAttacker;

    if (!this._strongLanguageWarningShown) {
      this._strongLanguageWarningShown = true;
      this._toast('⚠️ Aviso: la siguiente escena contiene lenguaje fuerte y xenófobo.', 'warn');
    }
    this._toast('🚨 “¡Ladrón! ¡Ayuden!”', 'death');
    this._toast('👥 “¡Trabaja, malparido!”', 'death');
    this._toast('👥 “¡Veneco tenía que ser!”', 'death');
    this._toast('👊 La gente se acerca. Puedes intentar alejarte.', 'death');

    const assaultNpcs = [victim, ...witnesses].filter(Boolean).slice(0, attackers);
    const crowdPhrases = ['¡Ladrón!', '¡Ayuden!', '¡Trabaja, malparido!', '¡Déjenlo ahí!'];
    assaultNpcs.forEach((npc, index) => {
      npc.fleeTimer = 0;
      npc.beginAssault?.(playerPos, index % 3 === 1 ? 'patear' : 'golpear', 0);
      npc.say?.(crowdPhrases[index % crowdPhrases.length], 3.5);
    });
    this.game.audio?.playCrowdVoice?.(assaultNpcs[0]?.position, playerPos);

    const source = witnesses.reduce((sum, npc) => sum.add(npc.position), victim?.position?.clone?.() ?? playerPos.clone());
    const direction = playerPos.clone().sub(source).setY(0);
    if (direction.lengthSq() < .001) direction.set(0, 0, 1);
    this.assaultScene = { time: 0, damage, attackers, direction: direction.normalize(), kind, assaultNpcs, nextHit: .55, hits: 0, appliedDamage: 0 };
    return true;
  }

  _updateAssaultScene(dt) {
    const scene = this.assaultScene;
    scene.time += dt;
    const totalHits = scene.attackers * 2;
    if (scene.time >= scene.nextHit && scene.hits < totalHits) {
      const attacker = scene.assaultNpcs[scene.hits % scene.assaultNpcs.length];
      const playerPos = this.game.player.position;
      // Sistema de coordenadas de impacto: no hay daño ni reacción si el atacante aún está lejos.
      if (!attacker?.position || attacker.position.distanceTo(playerPos) > 2.15) {
        scene.nextHit = scene.time + .12;
        return;
      }
      scene.hits++;
      scene.nextHit += .68;
      const remaining = scene.damage - scene.appliedDamage;
      const hitDamage = Math.min(remaining, Math.max(1, Math.ceil(scene.damage / totalHits)));
      scene.appliedDamage += hitDamage;
      this.game.stats.salud = Math.max(0, this.game.stats.salud - hitDamage);
      const impactDirection = playerPos.clone().sub(attacker.position).setY(0);
      if (impactDirection.lengthSq() < .001) impactDirection.copy(scene.direction);
      this.game.player.receiveAssaultHit?.(impactDirection.normalize());
      this._flashImpact(impactDirection);
      this._toast(`👊 Impacto ${scene.hits}/${totalHits}: −${hitDamage} de salud.`, 'death');
    }
    // Da tiempo a que los NPC lleguen y terminen sus clips antes de aplicar la caída.
    if (scene.time < 5.8) return;
    const player = this.game.player;
    const stats = this.game.stats;
    stats.salud = Math.max(0, stats.salud - (scene.damage - scene.appliedDamage));
    stats.higiene = Math.max(0, (stats.higiene ?? 100) - scene.attackers * 6);
    this.game._deathCause = stats.salud === 0 ? 'agresión colectiva' : this.game._deathCause;
    this._toast(`👊 La golpiza termina: −${scene.damage} de salud.`, 'death');
    // Caída física suave: sin la velocidad de lanzamiento propia de un atropello.
    player.receiveVehicleImpact?.(scene.direction, .1, { collisions: this.game.collisions });
    this.assaultScene = null;
  }

  _flashImpact(direction) {
    const overlay = this._dom?.impact;
    if (!overlay) return;
    const x = direction.x, z = direction.z;
    const side = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'right' : 'left') : (z > 0 ? 'bottom' : 'top');
    const positions = { left: '0% 50%', right: '100% 50%', top: '50% 0%', bottom: '50% 100%' };
    overlay.style.background = `radial-gradient(ellipse at ${positions[side]},rgba(255,0,0,.88) 0%,rgba(145,0,0,.34) 28%,transparent 67%)`;
    overlay.style.opacity = '1';
    clearTimeout(this._impactFlashTimer);
    this._impactFlashTimer = setTimeout(() => { if (overlay) overlay.style.opacity = '0'; }, 260);
  }

  // Otorga botín aleatorio entre dinero e ítems al inventario del jugador.
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

  // Dispara una notificación toast en pantalla.
  _toast(text, type = 'info') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
    }
  }
}
