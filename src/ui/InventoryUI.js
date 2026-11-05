// src/ui/InventoryUI.js
// El costal (tecla I / Tab) y la barra de acceso rápido (teclas 1-5).
// Una rejilla a marcador con una celda por objeto y el detalle al lado. El DOM se construye una vez; solo se actualiza
// lo que cambia (onChange del InventorySystem) y la selección y el foco sobreviven al redibujado.
import { ITEMS, isUsable, isRecyclable, describeEffects, itemRarityLabel } from '../data/items.js';
import { itemArtHTML, itemCategory, itemEffectLine } from './itemArt.js';
import { cop } from '../utils/money.js';
import { sinTeclas, teclaVisible } from '../core/modoEntrada.js';
import { cierreHTML } from './cierre.js';

const COLS = 5;
const NEAR_FULL = 0.85;
/** Los kilos, con coma. */
const kilos = (n) => String(n).replace('.', ',');
const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const isRare = (def) => !!(def?.rare || def?.rarity === 'rare' || def?.rarity === 'veryRare');
// Los tesoros marcan `rare` sin una rareza del catálogo.
const rarityText = (id) => itemRarityLabel(id) || (ITEMS[id]?.rare ? 'Raro' : '');

/** Verbo del botón principal según lo que hace el objeto. */
export function useVerb(def) {
  if (!def) return 'Usar';
  if (def.id === 'popo') return 'Lanzar';
  if (def.id === 'radioTransistor') return 'Sintonizar';
  if (def.id === 'pilas') return 'Cambiar pilas';
  if (def.cure && !def.consumable) return 'Curarse';
  if (def.substance || def.consumable === 'vicio') return 'Consumir';
  if (def.consumable === 'salud') return 'Aplicar';
  if (def.consumable === 'higiene') return 'Asearse';
  if (def.consumable === 'sed' || def.id === 'cafe' || def.id === 'refresco') return 'Beber';
  if (def.consumable) return 'Comer';
  return 'Usar';
}

/** Para qué sirve un objeto que no se usa. */
function idleReason(def) {
  if (def.build) return 'Material para el cambuche';
  if (isRecyclable(def)) return 'Se vende en la recicladora';
  return 'No se usa desde aquí';
}

// Descripciones por defecto de items.js: el banco ya lo dice con su estado.
const GENERIC_DESC = new Set(['Material para mejorar el cambuche.', 'Consumible.', 'Tratamiento.', 'Se puede vender.']);

/** Cómo se usa: las indicaciones propias del objeto o su descripción, si es propia. */
function itemNote(def) {
  return sinTeclas(describeEffects(def).find((t) => t.startsWith('Usar')) ?? (GENERIC_DESC.has(def.desc) ? '' : def.desc));
}

export class InventoryUI {
  /**
   * @param {InventorySystem} inventory
   * @param {object} game - Game (se leen stats, diseases, audio, input, isSleeping de forma perezosa)
   */
  constructor(inventory, game) {
    this.inv = inventory;
    this.game = game;
    this.isOpen = false;
    this.selected = 0;
    this._raf = 0;
    this._focusSlot = false;
    this._cache = { slots: [], selected: [], detail: null, quick: [], cap: '' };

    this._build();

    this._unsub = this.inv.onChange(() => this._schedule());
    this._onKey = (e) => this._handleKey(e);
    this._onToggle = () => this.toggle();
    // Captura: se ejecuta antes que HUD/Input y puede frenar la propagación mientras está abierto
    window.addEventListener('keydown', this._onKey, true);
    window.addEventListener('inventory-toggle', this._onToggle);
    this._schedule();
  }

  // ===== Construcción del DOM =====

  _build() {
    const root = document.createElement('div');
    root.id = 'inv-overlay';
    const hotKeys = this.inv.hotbar.map((_, i) =>
      `<button type="button" class="inv-hot-key" tabindex="-1" data-hot="${i}" aria-pressed="false">${i + 1}</button>`).join('');
    root.innerHTML = `
      <div class="inv-window carton corte-b" role="dialog" aria-modal="true" aria-label="Inventario">
        <header class="inv-head cabecera">
          <h2 id="inv-title">El costal</h2>
          <div class="inv-load" title="Carga del costal">
            <span class="inv-load-text"></span>
            <span class="inv-load-bar" aria-hidden="true"><i class="masa"></i></span>
            <span class="inv-load-flag"></span>
          </div>
          ${cierreHTML('I', 'Cerrar inventario', 'inv-close', 'tabindex="-1"')}
        </header>
        <div class="inv-body">
          <div class="inv-side">
            <div class="inv-grid" role="group" aria-label="Casillas del costal"></div>
            <div class="inv-grid-foot">
              <span class="inv-count"></span>
              <button type="button" class="inv-ghost cinta" tabindex="-1" data-act="sort">Ordenar <kbd aria-hidden="true">R</kbd></button>
            </div>
          </div>
          <section class="inv-bench" aria-live="polite">
            <div class="inv-pedestal"><span class="inv-ped-art"></span><span class="inv-ped-qty cifra"></span></div>
            <h3 class="inv-name"></h3>
            <p class="inv-rarity"></p>
            <p class="inv-effect"></p>
            <p class="inv-note"></p>
            <p class="inv-meta"></p>
            <p class="inv-reason" role="status"></p>
            <button type="button" class="cinta cinta--verbo inv-use" tabindex="-1" data-act="use"><span class="inv-use-art"></span><span class="inv-use-label">Usar</span><kbd aria-hidden="true">Enter</kbd></button>
            <div class="inv-secondary">
              <button type="button" class="inv-ghost cinta" tabindex="-1" data-act="drop1">Tirar 1 <kbd aria-hidden="true">X</kbd></button>
              <button type="button" class="inv-ghost cinta" tabindex="-1" data-act="dropAll">Tirar todo</button>
            </div>
            <div class="inv-hot" role="group" aria-label="Acceso rápido">
              <span class="inv-hot-label">Acceso rápido</span>
              <div class="inv-hot-keys">${hotKeys}</div>
            </div>
          </section>
        </div>
        <div class="inv-hint">I, Tab o Esc cierran. Flechas o WASD mueven. Shift + X tira todo. 1 a 5: acceso rápido.</div>
      </div>
      <div class="inv-tip carton corte-d"></div>`;
    document.body.appendChild(root);
    this.root = root; // el acceso visible en el juego vive en PanelDock

    const $ = (s) => root.querySelector(s);
    this.gridEl = $('.inv-grid');
    this.tipEl = $('.inv-tip');
    this.loadEl = $('.inv-load');
    this.loadText = $('.inv-load-text');
    this.loadFill = $('.inv-load-bar i');
    this.loadFlag = $('.inv-load-flag');
    this.countEl = $('.inv-count');
    this.bench = $('.inv-bench');
    this.dPedestal = $('.inv-pedestal');
    this.dArt = $('.inv-ped-art');
    this.dQty = $('.inv-ped-qty');
    this.dName = $('.inv-name');
    this.dRarity = $('.inv-rarity');
    this.dEffect = $('.inv-effect');
    this.dNote = $('.inv-note');
    this.dMeta = $('.inv-meta');
    this.dReason = $('.inv-reason');
    this.btnUse = $('[data-act="use"]');
    this.useArt = $('.inv-use-art');
    this.useLabel = $('.inv-use-label');
    this.btnDrop1 = $('[data-act="drop1"]');
    this.btnDropAll = $('[data-act="dropAll"]');
    this.hotEls = [...root.querySelectorAll('.inv-hot-key')];

    this.slotEls = [];
    this._growSlots(this.inv.slotCount);

    // Una sola delegación de eventos para todo el panel
    this._onClick = (e) => {
      const slot = e.target.closest('.inv-slot');
      if (slot) { this.select(+slot.dataset.i); return; }
      if (e.target.closest('.inv-close')) { this.close(); return; }
      if (e.target === this.root) { this.close(); return; } // clic en el fondo
      const hot = e.target.closest('[data-hot]');
      if (hot) { this._bindSelected(+hot.dataset.hot); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) this._action(act);
    };
    this._onDbl = (e) => {
      const slot = e.target.closest('.inv-slot');
      if (slot) { this.select(+slot.dataset.i); this.useSelected(); }
    };
    this._onOver = (e) => {
      const slot = e.target.closest('.inv-slot');
      if (slot) this._showTip(+slot.dataset.i, slot);
    };
    this._onOut = (e) => {
      if (e.target.closest('.inv-slot')) this.tipEl.style.display = 'none';
    };
    root.addEventListener('click', this._onClick);
    root.addEventListener('dblclick', this._onDbl);
    root.addEventListener('mouseover', this._onOver);
    root.addEventListener('mouseout', this._onOut);

    // Barra de acceso rápido
    const qb = document.createElement('div');
    qb.id = 'quickbar';
    this.quickEls = [];
    for (let i = 0; i < this.inv.hotbar.length; i++) {
      const el = document.createElement('div');
      el.className = 'item-slot qb-slot is-empty';
      el.innerHTML = `<span class="qk" data-k="${i + 1}">${teclaVisible(String(i + 1))}</span><span class="qb-art"></span><span class="sq"></span>`;
      qb.appendChild(el);
      this.quickEls.push({ el, art: el.children[1], qty: el.children[2] });
    }
    this._onQuickClick = (e) => {
      const i = this.quickEls.findIndex((q) => q.el === e.target.closest('.qb-slot'));
      if (i >= 0) this.useHotbar(i);
    };
    qb.addEventListener('click', this._onQuickClick);
    document.body.appendChild(qb);
    this.quickEl = qb;
  }

  // Las partidas antiguas con más de 20 tipos mantienen todos sus objetos.
  _growSlots(n) {
    while (this.slotEls.length < n) {
      const el = document.createElement('button');
      el.type = 'button';
      el.tabIndex = -1;
      el.className = 'item-slot inv-slot is-empty';
      el.dataset.i = this.slotEls.length;
      el.setAttribute('aria-pressed', 'false');
      this.gridEl.appendChild(el);
      this.slotEls.push({ el });
    }
  }

  // ===== Abrir / cerrar =====

  open() {
    if (this.isOpen || this.game.isSleeping || this.game.paused || this.game.hud?._talentOpen || this.game.hud?._craftOpen || this.game.hud?._dealerOpen) return;
    this.game.cameraRig?.releaseControls?.();
    this.isOpen = true;
    this.root.classList.add('open');
    if (this.game.input) this.game.input.locked = true; // WASD/E dejan de afectar al personaje
    this._focusSlot = true;
    this._schedule();
    this._render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.tipEl.style.display = 'none';
    if (typeof document !== 'undefined' && this.root.contains(document.activeElement)) document.activeElement.blur();
    if (this.game.input) { this.game.input.locked = false; this.game.input.keys = {}; this.game.input.endFrame(); }
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  select(i, { focus = true } = {}) {
    const n = this.inv.slotCount;
    this.selected = Math.max(0, Math.min(n - 1, i));
    this._focusSlot ||= focus;
    this._schedule();
  }

  // ===== Teclado =====

  /** El mando navega el costal; sus botones de juego nunca descartan objetos aquí. */
  handleGamepad(action) {
    if (!this.isOpen) return;
    if (action === 'back') { this.close(); return; }
    if (action === 'confirm') { this.useSelected(); return; }
    const step = { left: -1, right: 1, up: -COLS, down: COLS }[action];
    if (step === undefined) return;
    this.select(this.selected + step);
    this.slotEls[this.selected]?.el.scrollIntoView?.({ block: 'nearest' });
  }

  _handleKey(e) {
    if (this.game._loading || this.game.creator?.isOpen || this.game.menu?.isOpen) return;
    if (e.repeat && !this.isOpen) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.code;

    if (!this.isOpen) {
      // Con la mesa, las mañas o el jíbaro abiertos, Tab recorre ese panel: el costal no puede abrirse encima.
      if (k === 'Tab' && (this.game.hud?._talentOpen || this.game.hud?._craftOpen || this.game.hud?._dealerOpen)) return;
      if (k === 'KeyI' || k === 'Tab') { e.preventDefault(); if (!e.repeat) this.open(); return; }
      // Teclas 1-5: usar el consumible asignado
      if (k.startsWith('Digit') && !e.repeat) {
        const n = +k[5] - 1;
        if (n >= 0 && n < this.inv.hotbar.length && !this.game.isSleeping && !this.game.paused) this.useHotbar(n);
      }
      return;
    }

    // Abierto: este panel captura el teclado por completo (también evita que Enter
    // o Espacio activen dos veces el botón que tenga el foco).
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) return;

    switch (k) {
      case 'Escape': case 'KeyI': case 'Tab': this.close(); break;
      case 'ArrowLeft': case 'KeyA': this.select(this.selected - 1); break;
      case 'ArrowRight': case 'KeyD': this.select(this.selected + 1); break;
      case 'ArrowUp': case 'KeyW': this.select(this.selected - COLS); break;
      case 'ArrowDown': case 'KeyS': this.select(this.selected + COLS); break;
      case 'Enter': case 'NumpadEnter': this.useSelected(); break;
      case 'KeyX': case 'Delete': this._drop(e.shiftKey); break;
      case 'KeyR': this.inv.sort(); break;
      default:
        if (k.startsWith('Digit')) this._bindSelected(+k[5] - 1);
    }
  }

  _action(act) {
    if (act === 'use') this.useSelected();
    else if (act === 'drop1') this._drop(false);
    else if (act === 'dropAll') this._drop(true);
    else if (act === 'sort') this.inv.sort();
  }

  // ===== Acciones =====

  _drop(all) {
    const s = this.inv.slots[this.selected];
    if (!s) return;
    const def = ITEMS[s.id];
    const n = this.inv.removeAt(this.selected, all ? s.qty : 1);
    if (!n) return;
    this.game.audio?.play?.('empty');
    this._feedback('just-dropped');
    this._toast(`Boté ${def.name}${n > 1 ? ' ×' + n : ''}`, 'warn');
  }

  useSelected() {
    const s = this.inv.slots[this.selected];
    if (s) this._useItem(s.id, this.selected);
  }

  useHotbar(i) {
    const id = this.inv.hotbar[i];
    if (!id) return;
    if (this.inv.count(id) <= 0) {
      this.game.audio?.play?.('full');
      this._toast(`No me queda ${ITEMS[id]?.name ?? 'eso'}`, 'warn');
      return;
    }
    this._useItem(id, -1);
    this._pulseQuick(i);
  }

  _bindSelected(n) {
    const s = this.inv.slots[this.selected];
    if (n < 0 || n >= this.inv.hotbar.length || !s || !isUsable(ITEMS[s.id])) return;
    const same = this.inv.hotbar[n] === s.id;
    this.inv.bindHotbar(n, same ? null : s.id);
    this._toast(same ? `Tecla ${n + 1} libre` : `${ITEMS[s.id].name} → tecla ${n + 1}`, 'info');
  }

  // Comparte los mismos efectos y descuentos que el resto de la interfaz del juego.
  _useItem(id) {
    if (this.game._loading || this.game.isSleeping || (this.game.paused && !this.isOpen)) return;
    const before = this.inv.count(id);
    if (before <= 0) return;
    this.game.hud._useItem(id, this.inv);
    if (this.isOpen && this.inv.count(id) < before) this._feedback('just-used');
  }

  /** Reinicia una animación breve del banco aunque el contenido no cambie. */
  _feedback(cls) {
    const bench = this.bench;
    if (!bench?.classList) return;
    bench.classList.remove('just-used', 'just-dropped');
    void bench.offsetWidth;
    bench.classList.add(cls);
  }

  _pulseQuick(i) {
    const el = this.quickEls[i]?.el;
    if (!el?.classList) return;
    el.classList.remove('just-used');
    void el.offsetWidth;
    el.classList.add('just-used');
  }

  // ===== Render (solo lo que cambió) =====

  _schedule() {
    if (this._raf || this._disposed) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
  }

  _render() {
    if (this._disposed) return;
    this._renderQuickbar();
    if (!this.isOpen) return;
    this._renderGrid();
    this._renderDetail();
    this._restoreFocus();
  }

  _renderGrid() {
    const inv = this.inv;
    this._growSlots(inv.slotCount);
    if (this.selected >= inv.slotCount) this.selected = inv.slotCount - 1;
    const c = this._cache.slots, sel = this._cache.selected;
    for (let i = 0; i < this.slotEls.length; i++) {
      const s = inv.slots[i];
      const el = this.slotEls[i].el;
      const hk = s ? inv.hotbar.indexOf(s.id) : -1;
      const key = s ? `${s.id}:${s.qty}:${hk}` : (i < inv.slotCount ? '' : '-');
      if (c[i] !== key) {
        c[i] = key;
        el.hidden = key === '-'; // casillas sobrantes tras vaciar una partida grande
        if (s) {
          const def = ITEMS[s.id];
          const rare = isRare(def);
          el.className = ['item-slot', 'inv-slot', `cat-${itemCategory(s.id)}`, isUsable(def) && 'usable', rare && 'rare']
            .filter(Boolean).join(' ');
          el.innerHTML = itemArtHTML(s.id, 'inv-slot-art')
            + `<span class="inv-slot-nom">${escapar(def.name)}</span>`
            + (s.qty > 1 ? `<span class="inv-slot-qty">×${s.qty}</span>` : '')
            + (hk >= 0 ? `<span class="inv-slot-key" title="Tecla ${hk + 1}">${hk + 1}</span>` : '')
            + (rare ? `<span class="inv-slot-rare" title="${rarityText(s.id)}">★</span>` : '');
          const extra = [isUsable(def) ? 'usable' : '', rare ? rarityText(s.id).toLowerCase() : '', hk >= 0 ? `tecla ${hk + 1}` : ''];
          el.setAttribute('aria-label', [`${def.name} ×${s.qty}`, ...extra].filter(Boolean).join(', '));
        } else {
          el.className = 'item-slot inv-slot is-empty';
          el.textContent = '';
          el.setAttribute('aria-label', 'Casilla vacía');
        }
        sel[i] = undefined;
      }
      const isSel = i === this.selected;
      if (sel[i] !== isSel) {
        sel[i] = isSel;
        el.classList.toggle('selected', isSel);
        el.setAttribute('aria-pressed', String(isSel));
      }
    }

    const ratio = inv.maxWeight > 0 ? inv.totalWeight / inv.maxWeight : 0;
    const state = ratio >= 1 ? 'full' : ratio >= NEAR_FULL ? 'near' : '';
    const cap = `${inv.usedSlots}/${inv.slotCount}|${inv.totalWeight.toFixed(1)}/${inv.maxWeight}|${state}`;
    if (cap !== this._cache.cap) {
      this._cache.cap = cap;
      this.countEl.textContent = `${inv.usedSlots} de ${inv.slotCount} casillas`;
      this.loadText.textContent = `${kilos(inv.totalWeight.toFixed(1))} de ${kilos(inv.maxWeight)} kg`;
      this.loadFill.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
      this.loadFlag.textContent = state === 'full' ? 'lleno' : state === 'near' ? 'casi lleno' : '';
      this.loadEl.className = `inv-load ${state}`.trim();
    }
  }

  _renderDetail() {
    const inv = this.inv;
    const s = inv.slots[this.selected];
    const hk = s ? inv.hotbar.indexOf(s.id) : -1;
    const key = s ? `${s.id}:${s.qty}:${inv.hotbar.join(',')}` : '';
    if (key === this._cache.detail) return;
    const sameItem = (this._cache.detail ?? '').split(':')[0] === (s?.id ?? '');
    this._cache.detail = key;
    const def = s && ITEMS[s.id];
    const usable = !!def && isUsable(def);

    this.bench.className = ['inv-bench', def ? `cat-${itemCategory(s.id)}` : 'is-empty', usable && 'usable']
      .filter(Boolean).join(' ');
    if (!sameItem || !def) {
      this.dArt.innerHTML = def ? itemArtHTML(s.id) : '';
      this.useArt.innerHTML = def && usable ? itemArtHTML(s.id) : '';
    }
    this.dPedestal.classList.toggle('lit', !!def);
    this.dQty.textContent = def ? `×${s.qty}` : '';
    this.dQty.hidden = !def;
    this.dName.textContent = def ? def.name : 'Casilla vacía';
    this.dRarity.textContent = def ? rarityText(s.id) : '';
    this.dEffect.textContent = def ? itemEffectLine(def, { weight: false, fallback: false }) : '';
    this.dNote.textContent = def ? itemNote(def) : 'Elija un objeto del costal.';
    this.dMeta.textContent = def
      ? `${kilos(def.weight)} kg, ${cop(def.value)}${s.qty > 1 ? `, en total ${cop(def.value * s.qty)}` : ''}`
      : '';
    this.dReason.textContent = !def ? '' : usable ? '' : idleReason(def);

    this.btnUse.hidden = !!def && !usable;
    this.btnUse.disabled = !usable;
    this.useLabel.textContent = useVerb(def);
    this.btnDrop1.disabled = !def;
    this.btnDropAll.disabled = !def;
    for (let i = 0; i < this.hotEls.length; i++) {
      const b = this.hotEls[i];
      const bound = inv.hotbar[i];
      b.disabled = !usable;
      b.setAttribute('aria-pressed', String(hk === i));
      b.classList.toggle('taken', !!bound && bound !== s?.id);
      b.title = bound ? `Tecla ${i + 1}: ${ITEMS[bound]?.name ?? bound}` : `Tecla ${i + 1}: libre`;
    }
  }

  /** Lleva el foco a la casilla elegida al abrir, al moverse con el teclado o si se perdió. */
  _restoreFocus() {
    const el = this.slotEls[this.selected]?.el;
    if (!el?.focus || typeof document === 'undefined') return;
    const active = document.activeElement;
    const lost = !active || active.disabled || active.hidden || !this.root.contains(active);
    if (this._focusSlot || lost) el.focus({ preventScroll: false });
    this._focusSlot = false;
  }

  _renderQuickbar() {
    const inv = this.inv;
    const c = this._cache.quick;
    let any = false;
    for (let i = 0; i < this.quickEls.length; i++) {
      const id = inv.hotbar[i];
      any = any || !!id;
      const n = id ? inv.count(id) : 0;
      const key = id ? id + ':' + n : '';
      if (c[i] === key) continue;
      const q = this.quickEls[i];
      if ((c[i] ?? '').split(':')[0] !== (id ?? '')) {
        q.art.innerHTML = id ? itemArtHTML(id, 'qb-art-icon') : '';
        q.el.className = `item-slot qb-slot ${id ? `cat-${itemCategory(id)}` : ''}`.trim();
      }
      c[i] = key;
      q.qty.textContent = id ? n : '';
      q.el.classList.toggle('is-empty', !id || n === 0);
      q.el.title = id ? `${ITEMS[id].name}, tecla ${i + 1}` : `Tecla ${i + 1}: libre`;
    }
    this.quickEl.classList.toggle('visible', any);
  }

  _showTip(i, slotEl) {
    const s = this.inv.slots[i];
    if (!s) { this.tipEl.style.display = 'none'; return; }
    const def = ITEMS[s.id];
    this.tipEl.textContent = '';
    const b = document.createElement('b');
    b.textContent = s.qty > 1 ? `${def.name} ×${s.qty}` : def.name;
    const lines = [rarityText(s.id), itemEffectLine(def, { weight: false, fallback: false }), itemNote(def)].filter(Boolean);
    this.tipEl.append(b);
    for (const t of lines) this.tipEl.append(document.createElement('br'), t);
    const tip = this.tipEl;
    tip.style.display = 'block';
    const r = slotEl.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(window.innerWidth - tw - 4, r.left + r.width / 2 - tw / 2)) + 'px';
    const above = r.top - th - 6;
    tip.style.top = (above >= 4 ? above : r.bottom + 6) + 'px';
  }

  // Los avisos tienen un solo creador, en el HUD.
  _toast(text, type = 'info') {
    window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
  }

  dispose() {
    this._disposed = true;
    if (this.isOpen) this.close();
    cancelAnimationFrame(this._raf);
    this._unsub?.();
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('inventory-toggle', this._onToggle);
    this.root.removeEventListener('click', this._onClick);
    this.root.removeEventListener('dblclick', this._onDbl);
    this.root.removeEventListener('mouseover', this._onOver);
    this.root.removeEventListener('mouseout', this._onOut);
    this.quickEl.removeEventListener('click', this._onQuickClick);
    this.root.remove();
    this.quickEl.remove();
  }
}
