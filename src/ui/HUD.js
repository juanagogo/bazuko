// src/ui/HUD.js
import { TALENTS, BRANCHES } from '../data/talents.js';
import { XP_PER_LEVEL } from '../utils/constants.js';

export class HUD {
  constructor() {
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

    // Paneles
    this.talentPanel = document.getElementById('talent-panel');
    this.craftPanel = document.getElementById('craft-panel');
    this.dealerPanel = document.getElementById('dealer-panel');
    this.promptEl = document.getElementById('interaction-prompt');

    // Estado de paneles
    this._talentOpen = false;
    this._craftOpen = false;
    this._dealerOpen = false;

    // Toasts
    this._bindEvents();

    // Indicador discreto de guardado y botón de Nueva partida
    this._saveEl = document.getElementById('save-indicator');
    window.addEventListener('game-saved', () => {
      if (!this._saveEl) return;
      this._saveEl.classList.add('show');
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._saveEl.classList.remove('show'), 1400);
    });
    document.getElementById('new-game-btn')?.addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (window.confirm('¿Empezar una partida nueva? Se borrará tu progreso guardado.')) window.__game?.newGame();
    });

    // Abrir el inventario con clic en el resumen
    this.invEl?.addEventListener('click', () => window.dispatchEvent(new Event('inventory-toggle')));

    // Controles de paneles
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.toggleTalentPanel();
      if (e.code === 'KeyC') this.toggleCraftPanel();
      if (e.code === 'Escape') {
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

  _bindEvents() {
    window.addEventListener('pickup', (e) => this._onPickup(e.detail));
    window.addEventListener('sell', (e) => this._onSell(e.detail));
    window.addEventListener('run-over-hit', () => {
      const f = document.createElement('div');
      f.className = 'hit-flash';
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 700);
    });
    window.addEventListener('run-over', (e) => this._toast(`🚌 ${e.detail.message}`, 'death'));
    window.addEventListener('disease', (e) => this._toast(`☠️ Enfermedad: ${e.detail.name}`, 'death'));
    window.addEventListener('disease-cured', (e) => this._toast(`✨ Curado: ${e.detail.name}`, 'info'));
    window.addEventListener('levelup', (e) => this._toast(`⭐ ¡Nivel ${e.detail.level}! +1 punto de talento`, 'rare'));
    window.addEventListener('talent-unlock', (e) => this._toast(`🌟 Talento: ${e.detail.name}`, 'rare'));
    window.addEventListener('inventory-full', () => this._toast('🎒 Inventario lleno: lo que no cupo queda en la bolsa', 'warn'));
    window.addEventListener('craft', (e) => this._toast(`🔨 Crafteado: ${e.detail.name} x${e.detail.qty}`, 'info'));
    window.addEventListener('steal', (e) => {
      if (e.detail.caught) this._toast('🚨 ¡Atrapado robando!', 'death');
      else if (e.detail.added?.length) this._toast(`🪞 Robado: ${e.detail.added.join(', ')}`, 'warn');
    });
    window.addEventListener('steal-full', () => this._toast('🎒 Inventario lleno', 'warn'));
    window.addEventListener('steal-cancel', () => this._toast('✋ Robo cancelado', 'info'));
    window.addEventListener('steal-fail', (e) => this._toast(
      e.detail?.reason === 'seen' ? '🚨 ¡El conductor te vio! El auto arranca' : '🚗 El auto arrancó: robo fallido', 'warn'));
    window.addEventListener('substance-sell', (e) => this._toast(`💰 Sustancias vendidas: $${e.detail.earned}`, 'sell'));
    window.addEventListener('substance-buy', (e) => {
      this._toast(`📦 Comprado: ${e.detail.name} (-$${e.detail.cost})`, 'info');
      if (this._dealerOpen) this.renderDealer();
    });
    window.addEventListener('substance-fail', (e) => {
      if (e.detail.reason === 'day') this._toast('☀️ El dealer no compra de día (1.8x de noche)', 'warn');
    });
    window.addEventListener('substance-buy-fail', (e) => {
      if (e.detail?.reason === 'insufficient_money') {
        this._toast(`💸 No tienes suficiente dinero ($${e.detail.cost})`, 'warn');
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
    window.addEventListener('sleep-end', () => this._toast('🌅 Nuevo día', 'info'));
    window.addEventListener('sleep-fail', (e) => this._toast(
      e.detail.reason === 'day' ? '☀️ No puedes dormir de día' : 'No puedes dormir aquí',
      'warn'
    ));
  }

  toggleTalentPanel() {
    this._talentOpen = !this._talentOpen;
    this.talentPanel?.classList.toggle('open', this._talentOpen);
    if (this._talentOpen) this.renderTalents();
  }

  toggleCraftPanel() {
    this._craftOpen = !this._craftOpen;
    this.craftPanel?.classList.toggle('open', this._craftOpen);
  }

  toggleDealerPanel(dealer = null) {
    this._dealerOpen = !this._dealerOpen;
    this.dealerPanel?.classList.toggle('open', this._dealerOpen);
    if (this._dealerOpen) {
      this.renderDealer(dealer);
    }
  }

  update(stats, clock, interaction, inventory, diseaseSystem, talentSystem, craftingSystem) {
    // Barras de stats
        const map = {
      hambre: stats.hambre,
      sed: stats.sed,
      energia: stats.energia,
      salud: stats.salud,
      higiene: stats.higiene,
      animo: stats.animo
    };
    const lastBars = this._lastBars || (this._lastBars = {});
    for (const k in map) {
      const el = this.bars[k];
      const w = `${Math.max(0, Math.min(100, map[k]))}%`;
      if (el && lastBars[k] !== w) { lastBars[k] = w; el.style.width = w; }
    }

    // Reloj
    const h = Math.floor(clock.hour).toString().padStart(2, '0');
    const m = Math.floor((clock.hour % 1) * 60).toString().padStart(2, '0');
    this._setText('clockEl', `Día ${clock.day} — ${h}:${m}`);
    this._setText('moneyEl', `$${stats.dinero ?? 0}`);

    // Nivel y XP
    this._setText('levelEl', `Nv ${stats.level}`);
    const xpNeeded = XP_PER_LEVEL * stats.level;
    if (this.xpFillEl) {
      const w = `${Math.min(100, (stats.xp / xpNeeded) * 100)}%`;
      if (this._lastXpW !== w) { this._lastXpW = w; this.xpFillEl.style.width = w; }
    }
    if (this.talentPointsEl) {
      this._setText('talentPointsEl', `🌟 ${talentSystem?.points ?? 0}`);
      this.talentPointsEl.style.opacity = (talentSystem?.points ?? 0) > 0 ? 1 : 0.4;
    }

    // Boost
    if (this.boostEl) {
      this.boostEl.classList.toggle('active', interaction?.boostActive ?? false);
    }

    // Prompt dinámico de interacción
    if (this.promptEl) {
      const nearBed = window.__game?.bed && window.__game.bed.isNear(window.__game.player.position);
      if (nearBed) {
        this.promptEl.textContent = '[E] Dormir (Solo de noche)';
        this.promptEl.classList.add('visible');
      } else if (interaction?.currentTarget) {
        const type = interaction.currentTargetType;
        let text = '';
        if (type === 'pickup') text = '[E] Recoger basura · [Mantener Q] Seleccionar';
        else if (type === 'car') text = '[E] Robar retrovisores';
        else if (type === 'sell') text = '[E] Vender · Tienda';
        else if (type === 'container') text = interaction.currentTarget.promptText();
        else if (type === 'dealer') text = '[Q / E] Tienda del Dealer · Comprar / Vender';

        if (text) {
          this.promptEl.textContent = text;
          this.promptEl.classList.add('visible');
        } else {
          this.promptEl.classList.remove('visible');
        }
      } else {
        // Estaciones TM: "[E] Colarse y pedir limosna" / "Vuelve más tarde (N s)" (ui/MinijuegoLimosna.js)
        const lp = window.__game?.limosna?.prompt;
        if (lp) {
          if (this.promptEl.textContent !== lp) this.promptEl.textContent = lp;
          this.promptEl.classList.add('visible');
        } else {
          this.promptEl.classList.remove('visible');
        }
      }
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

  // Escribe textContent solo si cambio (evita reflow/DOM por frame)
  _setText(prop, text) {
    const el = this[prop];
    if (!el) return;
    const key = '_t_' + prop;
    if (this[key] !== text) { this[key] = text; el.textContent = text; }
  }

  // Resumen de ocupación (el inventario completo está en ui/InventoryUI.js). Solo toca el DOM si cambia.
  _renderInventory(inv) {
    if (inv.version === this._invVersion) return;
    this._invVersion = inv.version;
    this.invEl.textContent =
      `🎒 ${inv.usedSlots}/${inv.slotCount} · ${inv.totalWeight.toFixed(1)}/${inv.maxWeight} kg  [I]`;
    this.invEl.classList.toggle('full', inv.isFull);
  }

  _renderDiseases(diseaseSystem) {
    const html = diseaseSystem.hasAny ? diseaseSystem.list.map((d) =>
      `<div class="disease-item">${d.emoji} ${d.name} <span>${Math.ceil(d.timeLeft)}s</span></div>`
    ).join('') : '';
    if (html !== this._lastDisHtml) { this._lastDisHtml = html; this.diseaseEl.innerHTML = html; }
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

    this.talentPanel.innerHTML = `
      <div class="talent-header">
        <h2>🌳 Árbol de Talentos</h2>
        <span class="talent-points-display">Puntos: ${ts.points}</span>
      </div>
      <div class="talent-branches">${branchesHtml}</div>
      <div class="talent-hint">Haz clic en un talento disponible para desbloquearlo. Pulsa T o ESC para cerrar.</div>
    `;

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

    this.craftPanel.innerHTML = `
      <div class="craft-header">
        <h2>🔨 Mesa de Crafteo</h2>
      </div>
      <div class="craft-recipes">${recipesHtml}</div>
      <div class="craft-hint">Pulsa C o ESC para cerrar.</div>
    `;

    this.craftPanel.querySelectorAll('.craft-recipe.craftable .craft-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const recipeEl = btn.closest('.craft-recipe');
        const id = recipeEl.dataset.id;
        const recipe = craftingSystem.recipes.find((r) => r.id === id);
        if (recipe) {
          const result = craftingSystem.craft(recipe, inventory);
          if (result && window.__game) {
            window.__game.stats.addXP(XP_CRAFT, window.__game.talents);
          } else if (!result) {
            this._toast('🎒 No hay espacio para el resultado', 'warn');
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
    const products = d?.getProducts ? d.getProducts() : [
      { id: 'tintico', name: 'Tintico', value: 5, weight: 0.1 },
      { id: 'pegante', name: 'Pegante', value: 8, weight: 0.2 },
      { id: 'pastilla', name: 'Pastilla', value: 15, weight: 0.05 }
    ];

    const itemsHtml = products.map((p) => {
      const canAfford = (stats?.dinero ?? 0) >= p.value;
      const weightOk = inv ? inv.canAdd(p, 1) : true;
      const canBuy = canAfford && weightOk;
      const effectDesc = p.id === 'tintico' ? '☕ Sube +30 ánimo y +20 energía'
                       : p.id === 'pegante' ? '🧴 Sube +40 ánimo de golpe'
                       : '💊 Sube +60 ánimo intensamente';

      return `
        <div class="dealer-product" data-id="${p.id}">
          <div class="dealer-prod-info">
            <div class="dealer-prod-name">${p.name}</div>
            <div class="dealer-prod-desc">${effectDesc} · Peso: ${p.weight}kg</div>
          </div>
          <div class="dealer-prod-action">
            <div class="dealer-prod-price">$${p.value}</div>
            <button class="dealer-buy-btn" data-id="${p.id}" ${canBuy ? '' : 'disabled'}>
              ${canAfford ? (weightOk ? 'Comprar' : 'Lleno') : 'Sin Dinero'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.dealerPanel.innerHTML = `
      <div class="dealer-header">
        <h2>🟣 Rincón del Dealer</h2>
        <span class="dealer-money">Tu Dinero: $${stats?.dinero ?? 0}</span>
      </div>
      <div class="dealer-products">${itemsHtml}</div>
      <div class="dealer-hint">
        🌙 De noche puedes vender sustancias aquí (1.8x precio base).<br>
        Pulsa Q o ESC para cerrar.
      </div>
    `;

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
    el.textContent = `💰 Vendido por $${earned}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
}
