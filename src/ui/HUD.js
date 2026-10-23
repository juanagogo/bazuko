// src/ui/HUD.js
import { TALENTS, BRANCHES } from '../data/talents.js';
import { XP_PER_LEVEL, XP_CRAFT } from '../utils/constants.js';
import { NEEDS } from '../systems/StatsSystem.js';
import { cop } from '../utils/money.js';

export class HUD {
  constructor() {
    this._htmlCache = new WeakMap();
    this._panelElapsed = 0.1;
    this.bars = {};
    document.querySelectorAll('.stat-bar').forEach((el) => {
      this.bars[el.dataset.stat] = el.querySelector('.fill');
    });

    this.clockEl = document.getElementById('clock');
    this.moneyEl = document.getElementById('money');
    this.statusEl = document.getElementById('status');
    this.boostEl = document.getElementById('boost-indicator');
    this.invEl = document.getElementById('inventory-panel');
    this.diseaseEl = document.getElementById('disease-panel');
    this.xpBarEl = document.getElementById('xp-bar');
    this.xpFillEl = document.getElementById('xp-fill');
    this.levelEl = document.getElementById('level-display');
    this.talentPointsEl = document.getElementById('talent-points');
    this.nameEl = document.getElementById('player-name');
    this.cameraButton = document.getElementById('camera-toggle');
    this.cameraHint = document.getElementById('camera-hint');
    this.audioBtn = document.getElementById('audio-toggle');
    this.pauseBtn = document.getElementById('pause-toggle');
    this.radioBtn = document.getElementById('radio-toggle');
    this.radioBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-radio-modal'));
      this.radioBtn.blur();
    });

    this.audioBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('audio-toggle'));
      this.audioBtn.blur();
    });
    this.pauseBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-pause-menu'));
      this.pauseBtn.blur();
    });
    window.addEventListener('audio-settings-change', (e) => {
      if (this.audioBtn) {
        this.audioBtn.textContent = e.detail?.muted ? '🔇' : '🔊';
        this.audioBtn.setAttribute('title', e.detail?.muted ? 'Activar sonido' : 'Silenciar sonido');
      }
    });
    this.cameraButton?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('camera-toggle'));
      this.cameraButton.blur();
    });

    // Paneles
    this.talentPanel = document.getElementById('talent-panel');
    this.craftPanel = document.getElementById('craft-panel');
    this.dealerPanel = document.getElementById('dealer-panel');
    this.promptEl = document.getElementById('interaction-prompt');
    this.poopAmmoEl = document.getElementById('poop-hud-ammo');

    // Estado de paneles
    this._talentOpen = false;
    this._craftOpen = false;
    this._dealerOpen = false;

    // Toasts
    this._bindEvents();

    // Controles de paneles
    window.addEventListener('keydown', (e) => {
      // No abrir paneles mientras se escribe (nombre) o hay un menú/creador abierto
      if (e.target instanceof HTMLInputElement || window.__game?.paused) return;
      if (e.code === 'KeyT') this.toggleTalentPanel();
      if (e.code === 'KeyC') this.toggleCraftPanel();
      if (e.code === 'Escape') {
        const wasOpen = this._talentOpen || this._craftOpen || this._dealerOpen;
        if (wasOpen) e._panelHandled = true;
        this.talentPanel?.classList.remove('open');
        this.craftPanel?.classList.remove('open');
        this.dealerPanel?.classList.remove('open');
        this._talentOpen = false;
        this._craftOpen = false;
        this._dealerOpen = false;
      }
    });

    window.addEventListener('dealer-toggle', (e) => {
      this.toggleDealerPanel(e.detail?.dealer);
    });

    window.addEventListener('rejected', (e) => {
      if (e.detail.reason === 'higiene') {
        this._toast('🚫 El vendedor te rechaza, estás muy sucio', 'warn');
      }
    });
  }

  setCameraMode(mode) {
    const thirdPerson = mode === 'third-person';
    if (this.cameraButton) {
      this.cameraButton.textContent = `${thirdPerson ? 'Tercera persona' : 'Isométrica'} · V`;
      this.cameraButton.setAttribute('aria-pressed', String(thirdPerson));
      this.cameraButton.setAttribute('aria-label', `Cambiar a vista ${thirdPerson ? 'isométrica' : 'en tercera persona'} (V)`);
    }
    if (this.cameraHint) this.cameraHint.textContent = thirdPerson
      ? 'Mueve el ratón (o arrastra) para girar la cámara · Rueda: zoom'
      : 'V: cambiar a tercera persona';
  }

  _bindEvents() {
    window.addEventListener('toast', (e) => this._toast(e.detail.text, e.detail.type));
    window.addEventListener('pickup', (e) => this._onPickup(e.detail));
    window.addEventListener('sell', (e) => this._onSell(e.detail));
    window.addEventListener('disease', (e) => this._toast(`☠️ Enfermedad: ${e.detail.name}`, 'death'));
    window.addEventListener('disease-cured', (e) => this._toast(`✨ Curado: ${e.detail.name}`, 'info'));
    window.addEventListener('levelup', (e) => this._toast(`⭐ ¡Nivel ${e.detail.level}! +1 punto de talento`, 'rare'));
    window.addEventListener('talent-unlock', (e) => this._toast(`🌟 Talento: ${e.detail.name}`, 'rare'));
    window.addEventListener('craft', (e) => this._toast(`🔨 Crafteado: ${e.detail.name} x${e.detail.qty}`, 'info'));
    window.addEventListener('steal', (e) => {
      if (e.detail.caught) this._toast('🚨 ¡Atrapado robando!', 'death');
      else if (e.detail.added?.length) this._toast(`🪞 Robado: ${e.detail.added.join(', ')}`, 'warn');
    });
    window.addEventListener('withdrawal', (e) => {
      if (e.detail.active) this._toast('🚬 Abstinencia: caminas más lento y baja el ánimo', 'warn');
      else this._toast('😮‍💨 Se te calmó la ansiedad', 'info');
    });
    window.addEventListener('substance-sell', (e) => this._toast(`💰 Sustancias vendidas: ${cop(e.detail.earned)}`, 'sell'));
    window.addEventListener('substance-buy', (e) => {
      this._toast(`📦 Comprado: ${e.detail.name} (-${cop(e.detail.cost)})`, 'info');
      if (this._dealerOpen) this.renderDealer();
    });
    window.addEventListener('substance-fail', (e) => {
      if (e.detail.reason === 'day') this._toast('☀️ El dealer no compra de día (1.8x de noche)', 'warn');
    });
    window.addEventListener('substance-buy-fail', (e) => {
      if (e.detail?.reason === 'insufficient_money') {
        this._toast(`💸 No tienes suficiente dinero (${cop(e.detail.cost)})`, 'warn');
      } else if (e.detail?.reason === 'inventory_full') {
        this._toast('🎒 Inventario lleno', 'warn');
      } else {
        this._toast('❌ No se pudo comprar', 'warn');
      }
    });

    // Eventos de pedir limosna
    window.addEventListener('beg-result', (e) => {
      const type = e.detail.success ? (e.detail.rare ? 'rare' : 'sell') : 'warn';
      this._toast(e.detail.message, type);
    });
    window.addEventListener('beg-cooldown', (e) => {
      this._toast(`⏳ Espera ${e.detail.waitSec}s antes de pedir limosna`, 'info');
    });
    window.addEventListener('beg-fail', () => {
      this._toast('😴 Demasiado cansado para pedir limosna (-3 energía necesaria)', 'warn');
    });

    window.addEventListener('sleep-start', () => this._toast('💤 Durmiendo...', 'info'));
    window.addEventListener('sleep-end', (e) => this._toast(`🌅 Dormiste ${e.detail?.hours ?? ''} h · Partida guardada`, 'info'));
    window.addEventListener('sleep-fail', (e) => this._toast(
      e.detail.reason === 'nobase' ? '📦 Primero arma la base del cambuche (8 cartones)' : 'No puedes dormir aquí',
      'warn'
    ));
  }

  toggleTalentPanel() {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      try { document.exitPointerLock(); } catch {}
    }
    this._talentOpen = !this._talentOpen;
    this.talentPanel?.classList.toggle('open', this._talentOpen);
    if (this._talentOpen) this.renderTalents();
  }

  toggleCraftPanel() {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      try { document.exitPointerLock(); } catch {}
    }
    this._craftOpen = !this._craftOpen;
    this.craftPanel?.classList.toggle('open', this._craftOpen);
    if (this._craftOpen) {
      const game = window.__game;
      if (game?.crafting && game.inventory) {
        this.renderCrafting(game.crafting, game.inventory, game.talents);
      }
    }
  }

  toggleDealerPanel(dealer = null) {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      try { document.exitPointerLock(); } catch {}
    }
    this._dealerOpen = !this._dealerOpen;
    this.dealerPanel?.classList.toggle('open', this._dealerOpen);
    if (this._dealerOpen) {
      this.renderDealer(dealer);
    }
  }

  update(stats, clock, interaction, inventory, diseaseSystem, talentSystem, craftingSystem, dt = 0.1) {
    // Barras de stats
    for (const k of NEEDS) {
      const el = this.bars[k];
      if (el) el.style.width = `${Math.max(0, Math.min(100, stats[k]))}%`;
    }
    this.bars.vicio?.parentElement.parentElement.classList.toggle('critical', stats.inWithdrawal);
    this.bars.vicio?.parentElement.parentElement.classList.toggle('high-withdrawal', !!stats.isHighWithdrawal);
    if (this.bars.vicio?.parentElement?.parentElement && stats.abstinencia !== undefined) {
      this.bars.vicio.parentElement.parentElement.title = stats.abstinencia > 0
        ? `Abstinencia: ${stats.abstinencia}% (Vicio: ${Math.round(stats.vicio)}/100)`
        : 'Vicio: si se vacía entras en abstinencia';
    }

    // Indicador de munición de popó
    if (this.poopAmmoEl) {
      const poopCount = inventory?.count?.('popo') ?? 0;
      if (poopCount > 0) {
        this._setText(this.poopAmmoEl, `💩 [X] Lanzar popó (${poopCount}) · [Z] Cagar`);
        this.poopAmmoEl.className = 'ready';
      } else {
        this._setText(this.poopAmmoEl, '💩 [X] Hacer popó');
        this.poopAmmoEl.className = 'empty';
      }
    }

    // Reloj
    const h = Math.floor(clock.hour).toString().padStart(2, '0');
    const m = Math.floor((clock.hour % 1) * 60).toString().padStart(2, '0');
    this._setText(this.clockEl, `Día ${clock.day} — ${h}:${m}`);
    this._setText(this.moneyEl, cop(stats.dinero));

    // Nivel y XP
    this._setText(this.levelEl, `Nv ${stats.level}`);
    this._setText(this.nameEl, window.__game?.look?.nombre ?? '');
    const xpNeeded = XP_PER_LEVEL * stats.level;
    if (this.xpFillEl) {
      this.xpFillEl.style.width = `${Math.min(100, (stats.xp / xpNeeded) * 100)}%`;
    }
    if (this.talentPointsEl) {
      this._setText(this.talentPointsEl, `🌟 ${talentSystem?.points ?? 0}`);
      this.talentPointsEl.style.opacity = (talentSystem?.points ?? 0) > 0 ? 1 : 0.4;
    }

    // Boost
    if (this.boostEl) {
      this.boostEl.classList.toggle('active', interaction?.boostActive ?? false);
    }

    // Prompt dinámico de interacción
    if (this.promptEl) {
      if (window.__game?.paused) {
        this.promptEl.classList.remove('visible');
      } else if (interaction?.currentTarget) {
        const type = interaction.currentTargetType;
        let text = '';
        if (type === 'pickup') text = '[E] Recoger basura · [Mantener Q] Seleccionar';
        else if (type === 'car') text = '[E] Robar retrovisor de auto';
        else if (type === 'sell') text = '[E] Recicladora El Progreso · Vender material';
        else if (type === 'shop') text = `[E] ${interaction.currentTarget.title ?? 'Tienda La Esquinita'} · Comprar`;
        else if (type === 'cambuche') text = '[E] Tu cambuche · Armar / Dormir';
        else if (type === 'dealer') text = '[Q / E] Tienda del Dealer · Comprar / Vender';
        else if (type === 'cart') text = interaction.currentTarget?.isAttached ? '[E] Soltar carreta de balineras 🛒' : '[E] Agarrar carreta de balineras 🛒 (+120kg)';
        else if (type === 'dog') text = interaction.currentTarget?.isFriend ? '[E] Acariciar a El Chato 🐕' : '[E] Dar comida o acariciar a El Chato 🐕';

        if (text) {
          this._setText(this.promptEl, text);
          this.promptEl.classList.add('visible');
        } else {
          this.promptEl.classList.remove('visible');
        }
      } else {
        this.promptEl.classList.remove('visible');
      }
    }

    // Los paneles se revisan a 10 Hz; movimiento, barras y avisos siguen cada cuadro.
    this._panelElapsed += dt;
    if (this._panelElapsed < 0.1) return;
    this._panelElapsed %= 0.1;

    if (this.statusEl) {
      const warnings = [];
      if (stats.sed <= 20) warnings.push(stats.sed <= 0 ? 'Sin agua: estás perdiendo salud.' : 'Sed crítica: bebe agua.');
      if (stats.hambre <= 20) warnings.push(stats.hambre <= 0 ? 'Sin alimento: estás perdiendo salud.' : 'Hambre crítica: come algo.');
      if (stats.energia <= 20) warnings.push('Energía baja: descansa.');
      if (stats.salud <= 30) warnings.push('Salud crítica: necesitas recuperarte.');
      this._setText(this.statusEl, warnings.join(' '));
      this.statusEl.hidden = warnings.length === 0;
    }

    // Inventario mini
    if (this.invEl && inventory) {
      this._renderInventory(inventory);
    }

    // Enfermedades
    if (this.diseaseEl && diseaseSystem) {
      this._renderDiseases(diseaseSystem);
    }

    // Actualizar paneles si están abiertos
    if (this._talentOpen) this.renderTalents(talentSystem);
    if (this._craftOpen && craftingSystem && inventory) {
      this.renderCrafting(craftingSystem, inventory, talentSystem);
    }
    if (this._dealerOpen) {
      this.renderDealer();
    }
  }

  _setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  /** Mantiene los nodos, el foco y sus listeners mientras el contenido no cambie. */
  _setHTML(element, html) {
    if (this._htmlCache.get(element) === html) return false;
    element.innerHTML = html;
    this._htmlCache.set(element, html);
    return true;
  }

  _itemTooltip(i) {
    if (!i) return '';
    const parts = [];
    if (i.consumable) parts.push(`+${i.amount} ${i.consumable}`);
    for (const k of NEEDS) {
      if (k !== i.consumable && i[k]) parts.push(`${i[k] > 0 ? '+' : ''}${i[k]} ${k}`);
    }
    if (i.cure) parts.push(`Cura: ${i.cure}`);
    if (i.value) parts.push(`$${i.value}`);
    if (i.weight) parts.push(`${i.weight}kg`);
    const details = parts.length ? ` (${parts.join(' · ')})` : '';
    const action = (i.consumable || i.cure || i.id === 'radioTransistor' || i.id === 'pilas') ? 'Clic: usar · ' : '';
    return `${action}${i.name}${details}`;
  }

  _renderInventory(inv) {
    const rows = inv.items.map((i) => {
      const canUse = !!(i.consumable || i.cure || i.usable || i.id === 'radioTransistor' || i.id === 'pilas');
      return `<div class="inv-row ${canUse ? 'usable' : ''}" data-id="${i.id}" title="${this._itemTooltip(i)}">
        ${i.name} <span>x${i.qty}</span>
      </div>`;
    }).join('');
    const weight = `<div class="inv-weight">Peso: ${inv.totalWeight.toFixed(1)}/${inv.maxWeight}</div>`;
    if (!this._setHTML(this.invEl, rows + weight)) return;

    this.invEl.querySelectorAll('.inv-row.usable').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        this._useItem(id, inv);
      });
    });
  }

  _useItem(itemId, inv) {
    const item = inv.items.find((x) => x.id === itemId);
    if (!item) return;
    const game = window.__game;
    if (!game) return;

    
    if (itemId === 'radioTransistor') {
      window.dispatchEvent(new CustomEvent('open-radio-modal'));
      return;
    }
    if (itemId === 'pilas') {
      if (game.radio) {
        if (game.radio.battery >= 100) {
          this._toast('🔋 La radio ya tiene la batería al 100%', 'info');
        } else {
          inv.remove('pilas', 1);
          game.radio.battery = Math.min(100, game.radio.battery + 50);
          game.audio?.play('pickup');
          this._toast('🔋 Cambiaste las pilas de la radio (+50% batería)', 'info');
          this._renderInventory(inv);
        }
      }
      return;
    }

    if (item.consumable) {
      if (item.consumable === 'hambre' && game.stats?.canEat && !game.stats.canEat()) {
        this._toast('🤢 Estás demasiado enfermo para comer. ¡Cúrate primero!', 'warn');
        return;
      }
      // Efecto principal (consumable + amount) y efectos extra por necesidad (p. ej. animo: 15, salud: -3)
      for (const k of NEEDS) {
        const delta = (k === item.consumable ? item.amount : 0) + (k !== item.consumable ? (item[k] ?? 0) : 0);
        if (delta) game.stats[k] = Math.max(0, Math.min(100, game.stats[k] + delta));
      }
      inv.remove(itemId, 1);
      game.audio?.play('pickup');
      const isDrink = item.consumable === 'sed' || item.id === 'cafe' || item.id === 'refresco';
      const isSubstance = item.substance || item.consumable === 'vicio';
      const verb = isDrink ? '🥤 Bebiste' : (isSubstance ? '🚬 Consumiste' : (item.consumable === 'salud' ? '🩹 Te aplicaste' : '🍴 Comiste'));
      game.player?.playAction?.(isDrink ? 'beber' : 'comer', 1.2);
      this._toast(`${verb}: ${item.name}`, 'info');
      this._renderInventory(inv);
    } else if (item.cure) {
      game.diseases?.cure?.(item.cure);
      inv.remove(itemId, 1);
      game.audio?.play('pickup');
      this._toast(`✨ Curaste: ${item.cure} con ${item.name}`, 'info');
      this._renderInventory(inv);
    }
  }

  _renderDiseases(diseaseSystem) {
    if (!diseaseSystem.hasAny) {
      this._setHTML(this.diseaseEl, '');
      return;
    }
    this._setHTML(this.diseaseEl, diseaseSystem.list.map((d) =>
      `<div class="disease-item">${d.emoji} ${d.name} <span>${Math.ceil(d.timeLeft)}s</span></div>`
    ).join(''));
  }

  renderTalents(talentSystem) {
    if (!this.talentPanel) return;
    const ts = talentSystem || window.__game?.talents;
    if (!ts) return;

    const branchesHtml = BRANCHES.map((branch) => {
      const talents = Object.values(TALENTS).filter((t) => t.branch === branch.id);
      const nodes = talents.map((t) => {
        const unlocked = ts.has(t.id);
        const canUnlock = ts.canUnlock(t.id);
        const cls = unlocked ? 'unlocked' : (canUnlock ? 'available' : 'locked');
        const reqs = t.requires.length
          ? `<div class="reqs">Requiere: ${t.requires.map((r) => TALENTS[r].name).join(', ')}</div>`
          : '';
        return `
          <div class="talent-node ${cls}" data-id="${t.id}">
            <div class="talent-name">${t.name}</div>
            <div class="talent-desc">${t.desc}</div>
            ${reqs}
            <div class="talent-cost">Costo: ${t.cost} 🌟</div>
          </div>
        `;
      }).join('');

      return `
        <div class="talent-branch">
          <h3>${branch.emoji} ${branch.name}</h3>
          ${nodes}
        </div>
      `;
    }).join('');

    if (!this._setHTML(this.talentPanel, `
      <div class="talent-header">
        <h2>🌳 Árbol de Talentos</h2>
        <span class="talent-points-display">Puntos: ${ts.points}</span>
      </div>
      <div class="talent-branches">${branchesHtml}</div>
      <div class="talent-hint">Haz clic en un talento disponible para desbloquearlo. Pulsa T o ESC para cerrar.</div>
    `)) return;

    // Bind clicks
    this.talentPanel.querySelectorAll('.talent-node.available').forEach((node) => {
      node.addEventListener('click', () => {
        const id = node.dataset.id;
        if (ts.unlock(id)) {
          this.renderTalents(ts);
          window.dispatchEvent(new CustomEvent('talent-unlock', {
            detail: { name: TALENTS[id].name }
          }));
        }
      });
    });
  }

  renderCrafting(craftingSystem, inventory, talentSystem) {
    if (!this.craftPanel) return;
    const recipes = craftingSystem.getAvailable(inventory);

    const recipesHtml = recipes.map((r) => {
      const ingredients = Object.entries(r.ingredients).map(([id, qty]) => {
        const have = inventory.count(id);
        const ok = have >= qty;
        return `<span class="${ok ? 'ing-ok' : 'ing-missing'}">${id} (${have}/${qty})</span>`;
      }).join(', ');

      return `
        <div class="craft-recipe ${r.craftable ? 'craftable' : ''}" data-id="${r.id}">
          <div class="recipe-name">${r.emoji} ${r.name} x${r.qty}</div>
          <div class="recipe-ingredients">${ingredients}</div>
          <button class="craft-btn" ${r.craftable ? '' : 'disabled'}>Craftear</button>
        </div>
      `;
    }).join('');

    if (!this._setHTML(this.craftPanel, `
      <div class="craft-header">
        <h2>🔨 Mesa de Crafteo</h2>
      </div>
      <div class="craft-recipes">${recipesHtml}</div>
      <div class="craft-hint">Pulsa C o ESC para cerrar.</div>
    `)) return;

    this.craftPanel.querySelectorAll('.craft-recipe.craftable .craft-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const recipeEl = btn.closest('.craft-recipe');
        const id = recipeEl.dataset.id;
        const recipe = craftingSystem.recipes.find((r) => r.id === id);
        if (recipe) {
          const result = craftingSystem.craft(recipe, inventory);
          if (result && window.__game) {
            window.__game.stats.addXP(XP_CRAFT, window.__game.talents);
          }
          this.renderCrafting(craftingSystem, inventory, talentSystem);
        }
      });
    });
  }

  renderDealer(dealer = null) {
    if (!this.dealerPanel) return;
    const d = dealer || window.__game?.dealer;
    const stats = window.__game?.stats;
    const inv = window.__game?.inventory;
    const products = d?.getProducts ? d.getProducts() : [];

    const itemsHtml = products.map((p) => {
      const canAfford = (stats?.dinero ?? 0) >= p.value;
      const weightOk = inv ? (inv.totalWeight + p.weight <= inv.maxWeight) : true;
      const canBuy = canAfford && weightOk;
      const effectDesc = p.id === 'tintico' ? `☕ +${p.amount} vicio, +${p.animo} ánimo, +${p.energia} energía`
                       : p.id === 'pegante' ? `🧴 +${p.amount} vicio, +${p.animo} ánimo, ${p.salud} salud`
                       : `💊 +${p.amount} vicio, +${p.animo} ánimo, ${p.salud} salud`;

      return `
        <div class="dealer-product" data-id="${p.id}">
          <div class="dealer-prod-info">
            <div class="dealer-prod-name">${p.name}</div>
            <div class="dealer-prod-desc">${effectDesc} · Peso: ${p.weight}kg</div>
          </div>
          <div class="dealer-prod-action">
            <div class="dealer-prod-price">${cop(p.value)}</div>
            <button class="dealer-buy-btn" data-id="${p.id}" ${canBuy ? '' : 'disabled'}>
              ${canAfford ? (weightOk ? 'Comprar' : 'Lleno') : 'Sin Dinero'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (!this._setHTML(this.dealerPanel, `
      <div class="dealer-header">
        <h2>🟣 Rincón del Dealer</h2>
        <span class="dealer-money">Tu dinero: ${cop(stats?.dinero)}</span>
      </div>
      <div class="dealer-products">${itemsHtml}</div>
      <div class="dealer-hint">
        🌙 De noche puedes vender sustancias aquí (1.8x precio base).<br>
        Pulsa Q o ESC para cerrar.
      </div>
    `)) return;

    this.dealerPanel.querySelectorAll('.dealer-buy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (window.__game?.interaction) {
          window.__game.interaction.buySubstanceFromDealer(id);
          this.renderDealer(d);
        }
      });
    });
  }

  _toast(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `loot-toast ${type}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  _onPickup({ added, rare, sorted }) {
    if (!added || added.length === 0) return;
    const text = added.join(', ');
    const prefix = sorted ? '🔍 ' : '';
    const cls = rare ? 'loot-toast rare' : 'loot-toast';
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = `${prefix}+ ${text}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  _onSell({ earned }) {
    const el = document.createElement('div');
    el.className = 'loot-toast sell';
    el.textContent = `💰 Vendido por ${cop(earned)}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
}
