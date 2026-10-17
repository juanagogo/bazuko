import { ITEMS } from '../data/items.js';
import {
  INTERACT_RANGE,
  BOOST_DURATION,
  BOOST_ENERGY_COST,
  BOOST_HEALTH_DRAIN,
  BOOST_MIN_HEALTH,
  MENTAL_RESTORE_RARE,
  XP_PICKUP,
  XP_SELL,
  XP_STEAL,
  XP_CRAFT,
  XP_BEG,
  SORT_BASE_TIME
} from '../utils/constants.js';

// Robo de retrovisores a autos detenidos (semáforo en rojo, fila, parqueados): acción de 2.5 s, quieto
const ROB_RANGE = 2.2;        // u, medido al borde de la caja del vehículo
const ROB_TIME = 2.5;         // s de acción
const ROB_SEEN_CHANCE = 0.2;  // probabilidad de que el conductor te vea
const ROB_MIRRORS = 2;        // retrovisores por robo
const ROB_MOVE_TOL = 0.25;    // u: moverse más que esto cancela

export class InteractionSystem {
  constructor(player, inventory, stats, audio, diseaseSystem, talentSystem, craftingSystem) {
    this.player = player;
    this.inventory = inventory;
    this.stats = stats;
    this.audio = audio;
    this.disease = diseaseSystem;
    this.talents = talentSystem;
    this.crafting = craftingSystem;

    this.targets = [];
    this.currentTarget = null;
    this.currentTargetType = null;

    this.boostActive = false;
    this.boostTimer = 0;

    // Estado de selección de basura
    this.sortingPickup = null;
    this.isHoldingQ = false;

    // Robo de retrovisores en curso: { target, t, startX, startZ, seenAt }. robView alimenta la barra sobre la
    // cabeza (PlayerOverhead la lee como un "pickup en selección")
    this.robbing = null;
    this.searching = null; // búsqueda en contenedor en curso: { target, t, startX, startZ } (comparte robView)
    this.robView = { sorting: false, sortProgress: 0 };

    // Pedir limosna
    this._lastBegTime = -9999;
    this.begCooldown = 4; // segundos entre pedir limosna
  }

  register(target) { this.targets.push(target); }
  unregister(target) {
    const i = this.targets.indexOf(target);
    if (i >= 0) this.targets.splice(i, 1);
  }

  toggleBoost() {
    if (this.boostActive) { this._endBoost(); return true; }
    if (this.stats.energia < 15) return false;
    if (this.stats.salud <= BOOST_MIN_HEALTH) return false;
    this.boostActive = true;
    this.boostTimer = BOOST_DURATION;
    this.stats.energia -= BOOST_ENERGY_COST;
    this._notifyBoostToTargets(true);
    return true;
  }

  _endBoost() {
    this.boostActive = false;
    this.boostTimer = 0;
    this._notifyBoostToTargets(false);
  }

  _notifyBoostToTargets(active) {
    for (const t of this.targets) {
      if (typeof t.setBoost === 'function') t.setBoost(active);
    }
  }

  update(dt, input, clock) {
    // Encontrar target más cercano
    let nearest = null;
    let nearestType = null;
    let nearestDist = Infinity;

    if (this.robbing) this._updateRob(dt, input);
    if (this.searching) this._updateSearch(dt, input);

    for (const t of this.targets) {
      let d, lim = INTERACT_RANGE;
      if (t.isContainer) { // contenedor de basura: siempre apuntable (vacío muestra el cooldown); distancia al borde
        d = t.edgeDistance(this.player.position);
        lim = t.searchRange;
      } else if (typeof t.robMirrors === 'function') { // auto del tráfico: solo si está detenido; distancia al borde
        if (!t.canRob()) continue;
        d = t.edgeDistance(this.player.position);
        lim = ROB_RANGE;
      } else {
        d = t.position.distanceTo(this.player.position);
      }
      if (d < lim && d < nearestDist) {
        nearestDist = d;
        nearest = t;
        // Determinar tipo por métodos disponibles
        if (t.isContainer) nearestType = 'container';
        else if (typeof t.harvest === 'function') nearestType = 'pickup';
        else if (typeof t.robMirrors === 'function' || typeof t.steal === 'function') nearestType = 'car';
        else if (typeof t.sellSubstances === 'function') nearestType = 'dealer';
        else if (t instanceof Object && typeof t.sell === 'function') nearestType = 'sell';
      }
    }
    this.currentTarget = nearest;
    this.currentTargetType = nearestType;

    // Boost
    if (this.boostActive) {
      this.boostTimer -= dt;
      this.stats.salud = Math.max(0, this.stats.salud - BOOST_HEALTH_DRAIN * dt);
      if (this.boostTimer <= 0 || this.stats.salud <= BOOST_MIN_HEALTH) {
        this._endBoost();
      }
    }

    // === Selección de basura (mantener Q) ===
    if (nearestType === 'pickup' && input.isDown('KeyQ')) {
      if (!this.isHoldingQ) {
        this.isHoldingQ = true;
        if (nearest.startSorting) {
          this.sortingPickup = nearest;
          nearest.startSorting();
        }
      }
    } else {
      if (this.isHoldingQ) {
        this.isHoldingQ = false;
        if (this.sortingPickup) {
          const sorted = this.sortingPickup.sortComplete;
          this._harvestTrash(this.sortingPickup, sorted);
          this.sortingPickup.stopSorting();
          this.sortingPickup = null;
        }
      }
    }

    // === Interacción principal (E) ===
    if (input.consumePress('KeyE') && nearest) {
      switch (nearestType) {
        case 'pickup':
          this._harvestTrash(nearest, false);
          break;
        case 'container':
          this._startSearch(nearest);
          break;
        case 'sell':
          this._sellItems(nearest);
          break;
        case 'car':
          if (typeof nearest.robMirrors === 'function') this._startRob(nearest);
          else this._stealCar(nearest);
          break;
        case 'dealer': {
          const hasSubstances = this.inventory.items.some((i) => ITEMS[i.id]?.substance);
          if (hasSubstances && clock.isNight) {
            this._sellSubstances(nearest, clock);
          } else {
            // Abre la tienda del dealer para comprar
            window.dispatchEvent(new CustomEvent('dealer-toggle', { detail: { dealer: nearest } }));
          }
          break;
        }
      }
    }

    // === Comprar producto / Abrir tienda del dealer (Q) ===
    if (nearestType === 'dealer' && input.consumePress('KeyQ')) {
      window.dispatchEvent(new CustomEvent('dealer-toggle', { detail: { dealer: nearest } }));
    }

    // === Pedir limosna (B o L) ===
    if (input.consumePress('KeyB') || input.consumePress('KeyL')) {
      this._beg();
    }

    // === Boost (F) ===
    if (input.consumePress('KeyF')) {
      const ok = this.toggleBoost();
      if (!ok) this.audio?.play('empty');
    }
  }

  _harvestTrash(target, sorted) {
    if (typeof target.harvest !== 'function') return;

    const talentEffects = {
      rareChanceMult: this.talents.getEffect('rareChanceMult', 1),
      sortValueMult: this.talents.getEffect('sortValueMult', 1)
    };

    const result = target.harvest(this.boostActive, sorted, talentEffects);
    if (!result) return;

    const added = [];
    const leftover = [];
    let rareAdded = false;
    for (const itemId of result.items) {
      const item = ITEMS[itemId];
      if (item && this.inventory.add(item)) {
        added.push(item.name);
        if (itemId === result.rare) rareAdded = true;
      } else if (item) {
        leftover.push(itemId);
      }
    }

    // Lo que no cupo se queda en la bolsa (no se pierde)
    if (leftover.length) {
      target.restore?.(leftover);
      window.dispatchEvent(new CustomEvent('inventory-full', { detail: { left: leftover.length } }));
    }
    if (added.length === 0) {
      this.audio?.play('full');
      return; // nada recogido: sin XP, sin riesgo de enfermedad
    }

    this.audio?.play('pickup');
    if (rareAdded) {
      this.audio?.play('treasure');
      this.stats.saludMental = Math.min(100, this.stats.saludMental + MENTAL_RESTORE_RARE);
    }

    // Riesgo de enfermedad
    const diseaseResist = this.talents.getEffect('diseaseResist', 1);
    const sortDiseaseMult = this.talents.getEffect('sortDiseaseMult', 1);
    this.disease.tryInfect(result.sorted, diseaseResist * (result.sorted ? sortDiseaseMult : 1) * (result.diseaseMult ?? 1));

    this.stats.addXP(XP_PICKUP * (result.xpMult ?? 1), this.talents);

    window.dispatchEvent(new CustomEvent('pickup', {
      detail: { added, rare: result.rare, sorted: result.sorted }
    }));
  }

  // ===== Búsqueda en contenedores de basura (E, quieto ~4.5 s; moverse o Esc cancela) =====
  get activeView() { // barra sobre la cabeza del jugador (PlayerOverhead)
    return (this.robbing || this.searching) ? this.robView : this.sortingPickup;
  }

  _startSearch(c) {
    if (this.searching || this.robbing) return;
    if (!c.canSearch()) { this.audio?.play('empty'); return; }
    this.searching = {
      target: c, t: 0, startX: this.player.position.x, startZ: this.player.position.z
    };
    c.searching = true;
    this.robView.sorting = true;
    this.robView.sortProgress = 0;
  }

  _endSearch() {
    if (this.searching) this.searching.target.searching = false;
    this.searching = null;
    this.robView.sorting = false;
    this.robView.sortProgress = 0;
  }

  _updateSearch(dt, input) {
    const s = this.searching;
    const c = s.target;
    const p = this.player.position;
    const moved = Math.hypot(p.x - s.startX, p.z - s.startZ) > ROB_MOVE_TOL ||
      input.forward || input.backward || input.left || input.right || input.isDown('Escape');
    if (input.locked || moved || !c.canSearch() || c.edgeDistance(p) > c.searchRange + 0.4) {
      this._endSearch();
      return;
    }
    s.t += dt;
    this.robView.sortProgress = Math.min(1, s.t / c.searchTime) * SORT_BASE_TIME;
    if (s.t >= c.searchTime) {
      this._endSearch();
      this._harvestTrash(c, false);
    }
  }

  _sellItems(target) {
    if (typeof target.sell !== 'function') return;
    const earned = target.sell(this.inventory, this.boostActive ? 1.2 : 1);
    if (earned > 0) {
      this.stats.dinero += earned;
      this.stats.addXP(XP_SELL, this.talents);
      window.dispatchEvent(new CustomEvent('sell', { detail: { earned } }));
      this.audio?.play('sell');
    } else {
      this.audio?.play('empty');
    }
  }

  // ===== Robo de retrovisores (autos del tráfico detenidos) =====
  _startRob(car) {
    if (this.robbing || !car.canRob()) return;
    const item = ITEMS.retrovisor;
    if (!this.inventory.canAdd(item, ROB_MIRRORS)) {
      this.audio?.play('full');
      window.dispatchEvent(new CustomEvent('steal-full'));
      return;
    }
    const seenMult = this.talents.getEffect('stealCaughtMult', 1);
    const seen = Math.random() < ROB_SEEN_CHANCE * seenMult;
    this.robbing = {
      target: car, t: 0, startX: this.player.position.x, startZ: this.player.position.z,
      seenAt: seen ? 0.5 + Math.random() * 1.2 : Infinity
    };
    this.robView.sorting = true;
    this.robView.sortProgress = 0;
  }

  _endRob() {
    this.robbing = null;
    this.robView.sorting = false;
    this.robView.sortProgress = 0;
  }

  _updateRob(dt, input) {
    const r = this.robbing;
    const car = r.target;
    const p = this.player.position;
    const moved = Math.hypot(p.x - r.startX, p.z - r.startZ) > ROB_MOVE_TOL ||
      input.forward || input.backward || input.left || input.right || input.isDown('Escape');
    if (input.locked || moved) { this._endRob(); window.dispatchEvent(new CustomEvent('steal-cancel')); return; }
    if (!car.canRob() || car.edgeDistance(p) > ROB_RANGE + 0.4) { // el auto arrancó (luz en verde) o se alejó
      this._endRob();
      this.audio?.play('empty');
      window.dispatchEvent(new CustomEvent('steal-fail', { detail: { reason: 'moved' } }));
      return;
    }
    r.t += dt;
    this.robView.sortProgress = Math.min(1, r.t / ROB_TIME) * SORT_BASE_TIME;
    if (r.t >= r.seenAt) { // el conductor te vio: alarma, el auto arranca de inmediato, bajón de ánimo
      this._endRob();
      car.startNow?.();
      this.audio?.playAlarm?.();
      this.stats.animo = Math.max(0, this.stats.animo - 6);
      window.dispatchEvent(new CustomEvent('steal-fail', { detail: { reason: 'seen' } }));
      return;
    }
    if (r.t >= ROB_TIME) {
      this._endRob();
      const item = ITEMS.retrovisor;
      if (!this.inventory.add(item, ROB_MIRRORS)) {
        window.dispatchEvent(new CustomEvent('steal-full'));
        return;
      }
      car.markRobbed();
      this.audio?.play('pickup');
      this.stats.addXP(XP_STEAL, this.talents);
      window.dispatchEvent(new CustomEvent('steal', { detail: { added: [`${item.name} x${ROB_MIRRORS}`], caught: false } }));
    }
  }

  _stealCar(target) {
    if (typeof target.steal !== 'function') return;
    const caughtMult = this.talents.getEffect('stealCaughtMult', 1);
    const result = target.steal(caughtMult);
    if (!result) return;

    const added = [];
    for (const itemId of result.items) {
      const item = ITEMS[itemId];
      if (item && this.inventory.add(item)) added.push(item.name);
    }

    if (result.caught) {
      this.stats.salud = Math.max(0, this.stats.salud - 25);
      this.stats.dinero = Math.max(0, this.stats.dinero - 10);
      window.dispatchEvent(new CustomEvent('steal-caught', {}));
    } else {
      this.audio?.play('pickup');
      this.stats.addXP(XP_STEAL, this.talents);
    }

    window.dispatchEvent(new CustomEvent('steal', {
      detail: { added, caught: result.caught }
    }));
  }

  _sellSubstances(target, clock) {
    const priceMult = this.talents.getEffect('substancePriceMult', 1);
    const result = target.sellSubstances(this.inventory, clock.isNight, priceMult);
    if (result.reason === 'day') {
      window.dispatchEvent(new CustomEvent('substance-fail', {
        detail: { reason: 'day' }
      }));
      this.audio?.play('empty');
      return;
    }
    if (result.earned > 0) {
      this.stats.dinero += result.earned;
      this.stats.addXP(XP_SELL * 2, this.talents);
      window.dispatchEvent(new CustomEvent('substance-sell', {
        detail: { earned: result.earned }
      }));
      this.audio?.play('sell');
    } else {
      this.audio?.play('empty');
    }
  }

  _buySubstance(target, itemId = null) {
    if (!target || typeof target.buySubstance !== 'function') return null;
    const result = target.buySubstance(this.inventory, this.stats, itemId);
    if (result.bought) {
      this.audio?.play('pickup');
      window.dispatchEvent(new CustomEvent('substance-buy', {
        detail: { name: result.bought.name, cost: result.cost }
      }));
    } else {
      this.audio?.play('empty');
      window.dispatchEvent(new CustomEvent('substance-buy-fail', {
        detail: { reason: result.reason, cost: result.cost }
      }));
    }
    return result;
  }

  buySubstanceFromDealer(itemId = null) {
    const dealer = this.targets.find((t) => typeof t.buySubstance === 'function');
    if (dealer) {
      return this._buySubstance(dealer, itemId);
    }
    return null;
  }

  _beg() {
    const now = performance.now();
    const elapsed = (now - this._lastBegTime) / 1000;
    if (elapsed < this.begCooldown) {
      const waitSec = Math.ceil(this.begCooldown - elapsed);
      window.dispatchEvent(new CustomEvent('beg-cooldown', { detail: { waitSec } }));
      return;
    }

    if (this.stats.energia < 3) {
      this.audio?.play('empty');
      window.dispatchEvent(new CustomEvent('beg-fail', { detail: { reason: 'energy' } }));
      return;
    }

    this._lastBegTime = now;
    this.stats.energia = Math.max(0, this.stats.energia - 3);

    // Activar animación en el jugador
    this.player?.playBeg?.();

    // Check de higiene: si < 20 (STAT_THRESHOLDS.higieneRechazo)
    const isDirty = typeof this.stats.isRejectedByNPCs === 'function'
      ? this.stats.isRejectedByNPCs()
      : this.stats.higiene < 20;

    if (isDirty && Math.random() < 0.70) {
      this.stats.animo = Math.max(0, this.stats.animo - 2);
      this.audio?.play('empty');
      window.dispatchEvent(new CustomEvent('beg-result', {
        detail: {
          success: false,
          reason: 'higiene',
          message: '🚫 La gente se aleja con disgusto por tu olor (Higiene muy baja)'
        }
      }));
      return;
    }

    // 20% probabilidad de ser ignorado
    if (Math.random() < 0.20) {
      this.stats.animo = Math.max(0, this.stats.animo - 1);
      this.audio?.play('empty');
      window.dispatchEvent(new CustomEvent('beg-result', {
        detail: {
          success: false,
          reason: 'ignored',
          message: '🚶 Los transeúntes te ignoran y siguen de largo...'
        }
      }));
      return;
    }

    // 18% probabilidad de recibir comida o agua
    if (Math.random() < 0.18) {
      const foodItem = Math.random() < 0.5 ? ITEMS.pan : ITEMS.agua;
      const added = this.inventory.add(foodItem, 1);
      this.stats.animo = Math.min(100, this.stats.animo + 4);
      this.stats.addXP(XP_BEG, this.talents);
      this.audio?.play('pickup');
      window.dispatchEvent(new CustomEvent('beg-result', {
        detail: {
          success: true,
          item: foodItem.name,
          message: added
            ? `🍞 ¡Un alma caritativa te regaló ${foodItem.name}!`
            : `🍞 Te ofrecieron ${foodItem.name}, pero tu inventario está lleno`
        }
      }));
      return;
    }

    // Dinero recibido: normal ($1 a $5) o raro ($8 a $15)
    const isRare = Math.random() < 0.08;
    let amount = isRare
      ? Math.floor(Math.random() * 8) + 8
      : Math.floor(Math.random() * 5) + 1;

    this.stats.dinero += amount;
    this.stats.animo = Math.min(100, this.stats.animo + (isRare ? 6 : 2));
    this.stats.addXP(XP_BEG * (isRare ? 2 : 1), this.talents);
    this.audio?.play(isRare ? 'treasure' : 'sell');

    window.dispatchEvent(new CustomEvent('beg-result', {
      detail: {
        success: true,
        money: amount,
        rare: isRare,
        message: isRare
          ? `💎 ¡Un transeúnte generoso te dio un billete de $${amount}!`
          : `🪙 Recibiste $${amount} de limosna`
      }
    }));
  }
}
