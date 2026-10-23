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
  STEAL_CAUGHT_PENALTY,
  STEAL_CAUGHT_MONEY
} from '../utils/constants.js';
import { cop } from '../utils/money.js';
import { originEffect } from '../data/origins.js';

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
    this.originId = null;   // origen del personaje (ver data/origins.js)
    this.currentTarget = null;
    this.currentTargetType = null;

    this.boostActive = false;
    this.boostTimer = 0;

    // Estado de selección de basura
    this.sortingPickup = null;
    this.isHoldingQ = false;

    // Pedir limosna
    this._lastBegTime = -9999;
    this.begCooldown = 4; // segundos entre pedir limosna
  }

  _origin(key, base = 1) { return originEffect(this.originId, key, base); }

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
    let nearestDist = INTERACT_RANGE;

    for (const t of this.targets) {
      const d = t.position.distanceTo(this.player.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = t;
        // Determinar tipo por `kind` o por métodos disponibles
        if (t.kind === 'shop') nearestType = 'shop';
        else if (t.kind === 'cambuche') nearestType = 'cambuche';
        else if (t.kind === 'recycler') nearestType = 'sell';
        else if (t.kind === 'dog') nearestType = 'dog';
        else if (t.kind === 'cart') nearestType = 'cart';
        else if (typeof t.harvest === 'function') nearestType = 'pickup';
        else if (typeof t.steal === 'function') nearestType = 'car';
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
          this.player.sorting = true;
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
          this.player.sorting = false;
        }
      }
    }

    // === Interacción principal (E) ===
    if (input.consumePress('KeyE') && nearest) {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        try { document.exitPointerLock(); } catch {}
      }
      switch (nearestType) {
        case 'pickup':
          this._harvestTrash(nearest, false);
          break;
        case 'sell':
          window.dispatchEvent(new CustomEvent('open-recycler'));
          break;
        case 'shop':
          window.dispatchEvent(new CustomEvent('open-shop', { detail: { target: nearest } }));
          break;
        case 'cambuche':
          window.dispatchEvent(new CustomEvent('open-cambuche'));
          break;
        case 'car':
          this._stealCar(nearest);
          break;
        case 'dog':
          this._interactDog(nearest);
          break;
        case 'cart':
          nearest.toggleGrab(this.player, this.inventory);
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

  _interactDog(dog) {
    if (!dog) return;
    const foodItem = this.inventory.items.find(i => ['pan', 'lataComida', 'carne', 'hueso'].includes(i.id));

    if (!dog.isFriend && foodItem) {
      this.inventory.remove(foodItem.id, 1);
      dog.befriend();
      this.stats.saludMental = Math.min(100, this.stats.saludMental + 15);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `🐕 ¡Le diste ${ITEMS[foodItem.id]?.name ?? 'comida'} a El Chato! Ahora te acompaña.`, type: 'rare' }
      }));
    } else {
      dog.pet();
      this.stats.saludMental = Math.min(100, this.stats.saludMental + 5);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: '🐕 Acariciaste a El Chato (+5 salud mental).', type: 'info' }
      }));
    }
  }

  _harvestTrash(target, sorted) {
    if (typeof target.harvest !== 'function') return;

    const talentEffects = {
      rareChanceMult: this.talents.getEffect('rareChanceMult', 1),
      sortValueMult: this.talents.getEffect('sortValueMult', 1),
      extraRolls: this._origin('extraLoot', 0)
    };

    const result = target.harvest(this.boostActive, sorted, talentEffects);
    if (!result) return;
    this.player.playAction?.('buscar', 0.8);

    const added = [];
    for (const itemId of result.items) {
      const item = ITEMS[itemId];
      if (item && this.inventory.add(item)) added.push(item.name);
    }

    this.audio?.play('pickup');
    if (result.rare) {
      this.audio?.play('treasure');
      this.stats.saludMental = Math.min(100, this.stats.saludMental + MENTAL_RESTORE_RARE);
    }
    if (added.length === 0) this.audio?.play('full');

    // Riesgo de enfermedad
    const diseaseResist = this.talents.getEffect('diseaseResist', 1) * this._origin('diseaseResist');
    const sortDiseaseMult = this.talents.getEffect('sortDiseaseMult', 1);
    this.disease.tryInfect(result.sorted, diseaseResist * (result.sorted ? sortDiseaseMult : 1));

    this.stats.addXP(XP_PICKUP, this.talents);

    window.dispatchEvent(new CustomEvent('pickup', {
      detail: { added, rare: result.rare, sorted: result.sorted }
    }));
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
      this.stats.salud = Math.max(0, this.stats.salud - STEAL_CAUGHT_PENALTY);
      this.stats.dinero = Math.max(0, this.stats.dinero - STEAL_CAUGHT_MONEY);
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

    // Dinero recibido: monedas ($200 a $1.500) o billete raro ($5.000 a $10.000)
    const isRare = Math.random() < 0.08;
    const amount = isRare
      ? (Math.random() < 0.5 ? 5000 : 10000)
      : Math.round((2 + Math.random() * 13) * this._origin('begMult')) * 100;

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
          ? `💎 ¡Un transeúnte generoso te dio un billete de ${cop(amount)}!`
          : `🪙 Recibiste ${cop(amount)} de limosna`
      }
    }));
  }
}
