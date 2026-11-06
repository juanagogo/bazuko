// src/features/steal.js
import { ITEMS } from '../data/items.js';
import { cop } from '../utils/money.js';
import { LOW_STANCES } from '../character/archetypes.js';
import { modoEntrada, teclaVisible } from '../core/modoEntrada.js';

export const CONFIG = {
  stealDistance: 1.8,
  globalCooldown: 3.0,
  npcCooldown: 30.0,
  markerSpeed: 1.8,
  baseZoneSize: 0.35,
  lootMoneyCosquilleo: [800, 4000],
  lootMoneyDirect: [12000, 45000],
  lootItems: ['pan', 'lataComida', 'cigarrillo', 'tintico', 'moneda', 'reloj'],
  crowdRadius: 12,
  crowdMaxAttackers: 6,
  crowdWitnessChance: 0.72,
  crowdChancePerWitness: 0.15,
  crowdBravery: 0.3,
  directDamageMin: 6,
  directDamageMax: 16
};

/** Segundos de juego sin robar y sin persecución para que «te tienen fichado» baje un nivel. */
export const WANTED_DECAY_SECONDS = 120;

/** Objetivos con los que la Q ya hace otra cosa. */
const QUIET_Q_TARGETS = new Set(['pickup', 'dealer']);

export class StealSystem {
  constructor(game) {
    this.game = game;
    this.cooldown = 0;
    this.buscado = 0;
    this._calma = 0;      // segundos sin robar y sin persecución
    this._nivelVisto = 0; // para notar que subió por cualquier vía: también lo sube pelear con peatones
    this.targetNpc = null;
    this.minigameActive = false;
    this.markerPos = 0;
    this.markerDir = 1;
    this.zoneStart = 0.35;
    this.zoneSize = CONFIG.baseZoneSize;
    this._spaceOwned = false;
    if (typeof window !== 'undefined') window.addEventListener('keyup', (e) => { if (e.code === 'Space') this._spaceOwned = false; }, true);
    this._strongLanguageWarningShown = false;
    this.assaultScene = null;
    this._dom = null;
    this._buildUI();
    // En captura, como los paneles: el jugador gasta Espacio antes de que la barra se actualice y Esc abriría la pausa.
    globalThis.window?.addEventListener?.('keydown', (e) => this._onMinigameKey(e), true);
    // El retrovisor se roba en InteractionSystem: también cuenta como robar.
    globalThis.window?.addEventListener?.('steal', () => { this._calma = 0; });
  }

  _buildUI() {
    if (typeof document === 'undefined') return;
    const box = document.createElement('div');
    box.id = 'steal-minigame';
    box.className = 'carton corte-d';
    box.hidden = true;
    box.innerHTML = `
      <div id="steal-track"><i id="steal-zone"></i><i id="steal-marker"></i></div>
      <p id="steal-ayuda"></p>
    `;
    document.body.appendChild(box);
    this._dom = {
      box,
      zone: box.querySelector('#steal-zone'),
      marker: box.querySelector('#steal-marker'),
      ayuda: box.querySelector('#steal-ayuda')
    };
    const impact = document.createElement('div');
    impact.id = 'assault-impact-overlay';
    impact.className = 'assault-impact';
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
    this._enfriarFichado(dt);
    const npcs = this.game?.world?.active?.npcs ?? [];
    for (const n of npcs) {
      if (n._robadoTimer > 0) n._robadoTimer = Math.max(0, n._robadoTimer - dt);
    }
    if (this.assaultScene) { this._updateAssaultScene(dt); return; }
    if (this.minigameActive) {
      // Tirado por un carro no se le mete la mano a nadie.
      if (this.game.player?.isStunned) this._endMinigame(false, 'cancel');
      else this._updateMinigame(dt);
      return;
    }
    this._checkProximity(npcs);
  }

  // «Te tienen fichado» baja solo con el tiempo, y mientras dura alarga lo que ve una patrulla (ver TrafficSystem).
  _enfriarFichado(dt) {
    const traffic = this.game?.traffic;
    if (this.buscado > this._nivelVisto || this.buscado <= 0 || traffic?.inPursuit) this._calma = 0;
    else if ((this._calma += dt) >= (this.game?.reputation?.segundosDeCalma?.(WANTED_DECAY_SECONDS) ?? WANTED_DECAY_SECONDS)) {
      this._calma = 0;
      this.buscado--;
    }
    this._nivelVisto = this.buscado;
    if (traffic) traffic.wantedLevel = this.buscado;
  }

  // Encuentra el NPC más cercano y procesa las teclas de interacción E y Q.
  _checkProximity(npcs) {
    const playerPos = this.game?.player?.position;
    if (!playerPos || this.game.paused || this.game.player?.isStunned) {
      this.targetNpc = null;
      return;
    }
    let nearest = null;
    let minD = CONFIG.stealDistance;
    for (const n of npcs) {
      // Ni al desmayado ni a quien atiende un puesto: su aviso es la tienda.
      if (!n?.position || (n._robadoTimer ?? 0) > 0 || n.koState || n.isVendor || n._disposed) continue;
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
    // Junto a basura o al dealer, Q ya tiene otro uso: no se le roba al que justo va pasando.
    else if (!QUIET_Q_TARGETS.has(this.game.interaction?.currentTargetType) && this.game.input.consumePress('KeyQ')) this.executeRoboDirecto(nearest);
  }

  // Dice si hay a quién hacerle cosquilleo a menos de esa distancia: un carro más lejano le cede el aviso y la tecla.
  personCloserThan(distance) {
    if (!this.targetNpc || this.cooldown > 0) return false;
    return this.game.player.position.distanceTo(this.targetNpc.position) < distance;
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
      // Lo que se dice, según con qué se esté jugando: la letra va abajo, a marcador, y nunca cruza la barra.
      this._dom.ayuda.innerHTML = modoEntrada() === 'tactil'
        ? 'Toque la barra en lo negro'
        : `<kbd>${teclaVisible('Espacio')}</kbd> Detener <kbd>${teclaVisible('Esc')}</kbd> Cancelar`;
      this._dom.box.hidden = false;
    }
  }

  // Mientras dura la barra, Espacio la detiene sin saltar y Esc la cancela sin abrir la pausa.
  _onMinigameKey(e) {
    // El Espacio que detuvo la barra sigue siendo suyo hasta soltarlo: su repetición no es un salto.
    if (this._spaceOwned && e.code === 'Space' && e.repeat) {
      e.preventDefault?.();
      e.stopImmediatePropagation();
      return;
    }
    if (!this.minigameActive || this.game.paused) return;
    if (e.code === 'Escape') {
      e._panelHandled = true;
      this._endMinigame(false, 'cancel');
    } else if (e.code === 'Space') {
      e.preventDefault?.();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      this._spaceOwned = true;
      const success = this.markerPos >= this.zoneStart && this.markerPos <= (this.zoneStart + this.zoneSize);
      this._endMinigame(success, 'play');
    }
  }

  // Actualiza la oscilación del marcador; si el jugador y la persona se separan, ya no hay a quién robarle.
  _updateMinigame(dt) {
    const npc = this.targetNpc, player = this.game.player?.position;
    if (npc?.position && player && player.distanceTo(npc.position) > CONFIG.stealDistance * 2) {
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
  }

  _endMinigame(success, reason) {
    this.minigameActive = false;
    if (this._dom) this._dom.box.hidden = true;
    if (reason === 'cancel') return;
    const npc = this.targetNpc;
    this.cooldown = CONFIG.globalCooldown;
    this._calma = 0;
    if (npc) npc._robadoTimer = CONFIG.npcCooldown;
    if (success) {
      this._giveLoot(CONFIG.lootMoneyCosquilleo, true);
      this._toast('Cosquilleo limpio: nadie se dio cuenta.', 'rare');
    } else {
      const bonus = this.game?.dog?.distractionBonus?.(this.game.player?.position) ?? 0;
      const noticeChance = Math.max(0.2, (npc?.alerta ?? 0.5) - bonus + (this.game?.reputation?.alertaExtra ?? 0) + (this.game?.jornada?.franja?.alerta ?? 0));
      if (Math.random() < noticeChance) {
        npc?.alarmedByTheft?.(this.game.player.position);
        this._toast('¡Me pillaron con las manos en la masa! El peatón gritó.', 'death');
        // De último: los avisos caen uno encima del otro y este es el que hay que alcanzar a leer.
        this._alertPolice();
        this._triggerCrowdConsequence(npc, 'cosquilleo');
        this.game.witnesses?.report?.('robo', npc);
        this._emitRobo(false);
      } else {
        this._toast('Fallé el cosquilleo, pero disimulé.', 'warn');
      }
    }
  }

  executeRoboDirecto(npc) {
    this.cooldown = CONFIG.globalCooldown;
    npc._robadoTimer = CONFIG.npcCooldown;
    this._calma = 0;
    this.buscado = Math.min(3, this.buscado + 1);
    this._giveLoot(CONFIG.lootMoneyDirect, false);
    // Quien está en el piso o en la banca no alcanza a defenderse: bastante hace con pararse.
    const down = LOW_STANCES.has(npc.stance);
    npc.alarmedByTheft?.(this.game.player.position);
    const isStrong = !down && (npc.look?.real?.edad === 'adulto' || Math.random() < 0.45);
    if (isStrong && this.game.stats) {
      const dmg = Math.floor((CONFIG.directDamageMin + Math.random() * (CONFIG.directDamageMax - CONFIG.directDamageMin))
        * (this.game?.jornada?.franja?.golpe ?? 1));
      this.game.stats.salud = Math.max(0, this.game.stats.salud - dmg);
      this._toast(`¡El peatón se defendió! −${dmg} de salud.`, 'death');
    } else {
      this._toast('¡Raponazo! El peatón se asustó.', 'warn');
    }
    this._alertPolice();
    this._triggerCrowdConsequence(npc, 'robo directo');
    this.game.witnesses?.report?.('robo', npc);
    this._emitRobo(true);
  }

  /** Un robo a una persona que el barrio se entera (ver ReputationSystem). */
  _emitRobo(directo) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('robo-peaton', { detail: { directo } }));
  }

  // Una patrulla que lo ve lo persigue, igual que por un retrovisor robado.
  _alertPolice() {
    if (this.game.traffic) this.game.traffic.wantedLevel = this.buscado; // el robo de ahora ya cuenta
    if (this.game.traffic?.alertForTheft?.(this.game.player.position) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('police-chase', {}));
    }
  }

  _triggerCrowdConsequence(victim, kind) {
    const player = this.game?.player;
    const playerPos = player?.position;
    const npcs = this.game?.world?.active?.npcs ?? [];
    if (!playerPos || !this.game?.stats) return false;

    // La víctima ya salió corriendo: los que se le vienen encima son los testigos con ganas de pelea.
    const witnesses = npcs.filter(npc => npc !== victim && npc?.position && !(npc.hp <= 0) && !npc._disposed &&
      !npc.isVendor && !LOW_STANCES.has(npc.stance) && (npc.valentia ?? 1) > CONFIG.crowdBravery &&
      Math.abs(npc.position.y - playerPos.y) < 1.2 && npc.position.distanceTo(playerPos) <= CONFIG.crowdRadius)
      .sort((a, b) => a.position.distanceToSquared(playerPos) - b.position.distanceToSquared(playerPos));
    const chance = Math.min(.9, CONFIG.crowdWitnessChance + witnesses.length * CONFIG.crowdChancePerWitness);
    if (!witnesses.length) return false;
    if (Math.random() >= chance && kind !== 'robo directo') return false;

    if (!this._strongLanguageWarningShown) {
      this._strongLanguageWarningShown = true;
      this._toast('⚠️ Aviso: la siguiente escena contiene lenguaje fuerte.', 'warn');
    }

    const assaultNpcs = witnesses.slice(0, CONFIG.crowdMaxAttackers);
    assaultNpcs.forEach((npc, index) => npc.beginAssault?.(player, 'golpe_jab', index * .15, true));
    assaultNpcs[0]?.speakScenario?.('theftChase', true);

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
    // De noche y de madrugada la gente que queda en la calle carga más plata (y se defiende peor o con más rabia).
    const botin = this.game?.jornada?.franja?.botin ?? 1;
    const money = Math.round((moneyRange[0] + Math.random() * (moneyRange[1] - moneyRange[0])) * botin / 100) * 100;
    if (this.game.stats) this.game.stats.dinero += money;
    this._toast(`+${cop(money)}`, 'sell');
    if (includeItemChance && Math.random() < 0.4 && this.game.inventory) {
      const itemId = CONFIG.lootItems[Math.floor(Math.random() * CONFIG.lootItems.length)];
      if (ITEMS[itemId]) {
        if (this.game.inventory.add(ITEMS[itemId], 1)) this._toast(`Robé: ${ITEMS[itemId].name}`, 'info');
        else this._toast(`No me cabe más en el costal: dejé ${ITEMS[itemId].name}.`, 'warn');
      }
    }
  }

  _toast(text, type = 'info') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
    }
  }
}
