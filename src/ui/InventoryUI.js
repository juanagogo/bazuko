// src/ui/InventoryUI.js
// Panel de inventario (overlay DOM, tecla I / Tab) + barra de acceso rápido (teclas 1-5).
// El DOM se construye una vez; solo se actualiza lo que cambia (onChange del InventorySystem).
import { ITEMS, isUsable, describeEffects } from '../data/items.js';

const COLS = 5;

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
    this._cache = { slots: [], detail: '', quick: [], cap: '' };

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
    root.innerHTML = `
      <div class="inv-window" role="dialog" aria-label="Inventario">
        <div class="inv-head">
          <h2>🎒 Inventario</h2>
          <span class="inv-cap"></span>
          <button class="inv-close" type="button" tabindex="-1" aria-label="Cerrar">✕</button>
        </div>
        <div class="inv-body">
          <div class="inv-grid"></div>
          <div class="inv-detail">
            <div class="inv-d-icon"></div>
            <div class="inv-d-name"></div>
            <div class="inv-d-desc"></div>
            <ul class="inv-d-fx"></ul>
            <div class="inv-d-meta"></div>
            <div class="inv-d-btns">
              <button type="button" tabindex="-1" data-act="use">Usar</button>
              <button type="button" tabindex="-1" data-act="drop1">Tirar 1</button>
              <button type="button" tabindex="-1" data-act="dropAll">Tirar todo</button>
              <button type="button" tabindex="-1" data-act="sort">Ordenar</button>
            </div>
            <div class="inv-d-hot">Acceso rápido: pulsa 1-5 para asignar</div>
          </div>
        </div>
        <div class="inv-hint">I / Tab / Esc cerrar · Flechas o WASD mover · Enter usar · X tirar (Mayús: todo) · R ordenar</div>
      </div>
      <div class="inv-tip"></div>`;
    document.body.appendChild(root);
    this.root = root;

    this.gridEl = root.querySelector('.inv-grid');
    this.capEl = root.querySelector('.inv-cap');
    this.tipEl = root.querySelector('.inv-tip');
    this.dIcon = root.querySelector('.inv-d-icon');
    this.dName = root.querySelector('.inv-d-name');
    this.dDesc = root.querySelector('.inv-d-desc');
    this.dFx = root.querySelector('.inv-d-fx');
    this.dMeta = root.querySelector('.inv-d-meta');
    this.btnUse = root.querySelector('[data-act="use"]');
    this.btnDrop1 = root.querySelector('[data-act="drop1"]');
    this.btnDropAll = root.querySelector('[data-act="dropAll"]');

    this.slotEls = [];
    for (let i = 0; i < this.inv.slotCount; i++) {
      const el = document.createElement('div');
      el.className = 'inv-slot';
      el.dataset.i = i;
      el.innerHTML = '<span class="si"></span><span class="sq"></span><span class="sk"></span>';
      this.gridEl.appendChild(el);
      this.slotEls.push({ el, ico: el.firstChild, qty: el.children[1], key: el.children[2] });
    }

    // Una sola delegación de eventos para todo el panel
    this._onClick = (e) => {
      const slot = e.target.closest('.inv-slot');
      if (slot) { this.select(+slot.dataset.i); return; }
      if (e.target.closest('.inv-close')) { this.close(); return; }
      if (e.target === this.root) { this.close(); return; } // clic en el fondo
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
      el.className = 'qb-slot';
      el.innerHTML = `<span class="qk">${i + 1}</span><span class="si"></span><span class="sq"></span>`;
      qb.appendChild(el);
      this.quickEls.push({ el, ico: el.children[1], qty: el.children[2] });
    }
    this._onQuickClick = (e) => {
      const i = this.quickEls.findIndex((q) => q.el === e.target.closest('.qb-slot'));
      if (i >= 0) this.useHotbar(i);
    };
    qb.addEventListener('click', this._onQuickClick);
    document.body.appendChild(qb);
    this.quickEl = qb;
  }

  // ===== Abrir / cerrar =====

  open() {
    if (this.isOpen || this.game.isSleeping) return;
    this.isOpen = true;
    this.root.classList.add('open');
    if (this.game.input) this.game.input.locked = true; // WASD/E dejan de afectar al personaje
    this._schedule();
    this._render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.tipEl.style.display = 'none';
    if (this.game.input) this.game.input.locked = false;
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  select(i) {
    const n = this.inv.slotCount;
    this.selected = Math.max(0, Math.min(n - 1, i));
    this._cache.detail = ''; // fuerza refresco del detalle
    this._schedule();
  }

  // ===== Teclado =====

  _handleKey(e) {
    if (e.repeat && !this.isOpen) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.code;

    if (!this.isOpen) {
      if (k === 'KeyI' || k === 'Tab') { e.preventDefault(); if (!e.repeat) this.open(); return; }
      // Teclas 1-5: usar el consumible asignado
      if (k.startsWith('Digit') && !e.repeat) {
        const n = +k[5] - 1;
        if (n >= 0 && n < this.inv.hotbar.length && !this.game.isSleeping) this.useHotbar(n);
      }
      return;
    }

    // Abierto: este panel captura el teclado por completo
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
    this._toast(`🗑️ Tiraste ${def.name}${n > 1 ? ' x' + n : ''}`, 'warn');
  }

  useSelected() {
    const s = this.inv.slots[this.selected];
    if (s) this._useItem(s.id, this.selected);
  }

  useHotbar(i) {
    const id = this.inv.hotbar[i];
    if (!id) return;
    if (this.inv.count(id) <= 0) {
      this._toast(`No te queda ${ITEMS[id]?.name ?? 'eso'}`, 'warn');
      return;
    }
    this._useItem(id, -1);
  }

  _bindSelected(n) {
    const s = this.inv.slots[this.selected];
    if (n < 0 || n >= this.inv.hotbar.length || !s || !isUsable(ITEMS[s.id])) return;
    const same = this.inv.hotbar[n] === s.id;
    this.inv.bindHotbar(n, same ? null : s.id);
    this._toast(same ? `Tecla ${n + 1} libre` : `${ITEMS[s.id].name} → tecla ${n + 1}`, 'info');
  }

  // Aplica los efectos del item. Si slotIndex < 0 descuenta por id (barra rápida).
  _useItem(id, slotIndex) {
    const def = ITEMS[id];
    const g = this.game;
    if (!isUsable(def)) { this._toast('Eso no se puede usar', 'warn'); return; }

    if (def.cure) {
      // El id de la cura (data) y el de la enfermedad (DiseaseSystem) pueden diferir en grafía
      const key = def.cure === 'intoxicacion' ? 'intoxication' : def.cure;
      if (!g.diseases?.active?.[key]) {
        this._toast(`No lo necesitas ahora (${def.name})`, 'warn');
        g.audio?.play('empty');
        return;
      }
      g.diseases.cure(key);
      this._toast(`✨ Curaste: ${def.cure} con ${def.name}`, 'info');
    } else {
      const st = g.stats;
      const add = (k, v) => { if (v && st[k] !== undefined) st[k] = Math.min(100, st[k] + v); };
      add(def.consumable, def.amount);
      if (def.consumable !== 'animo') add('animo', def.animo);
      if (def.consumable !== 'energia') add('energia', def.energia);
      this._toast(`🍴 Usaste: ${def.name}`, 'info');
    }

    if (slotIndex >= 0) this.inv.removeAt(slotIndex, 1);
    else this.inv.remove(id, 1);
    g.audio?.play('pickup');
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
  }

  _renderGrid() {
    const inv = this.inv;
    const c = this._cache.slots;
    for (let i = 0; i < this.slotEls.length; i++) {
      const s = inv.slots[i];
      const hk = s ? inv.hotbar.indexOf(s.id) : -1;
      const key = (s ? s.id + ':' + s.qty : '') + (i === this.selected ? '*' : '') + hk;
      if (c[i] === key) continue;
      c[i] = key;
      const v = this.slotEls[i];
      v.el.classList.toggle('selected', i === this.selected);
      v.el.classList.toggle('filled', !!s);
      v.el.classList.toggle('rare', !!(s && ITEMS[s.id]?.rare));
      v.ico.textContent = s ? ITEMS[s.id].emoji : '';
      v.qty.textContent = s && s.qty > 1 ? s.qty : '';
      v.key.textContent = hk >= 0 ? hk + 1 : '';
    }
    const cap = `${inv.usedSlots}/${inv.slotCount} casillas · ${inv.totalWeight.toFixed(1)}/${inv.maxWeight} kg`;
    if (cap !== this._cache.cap) { this._cache.cap = cap; this.capEl.textContent = cap; }
  }

  _renderDetail() {
    const s = this.inv.slots[this.selected];
    const key = s ? s.id + ':' + s.qty : '';
    if (key === this._cache.detail) return;
    this._cache.detail = key;
    const def = s && ITEMS[s.id];
    this.dIcon.textContent = def ? def.emoji : '';
    this.dName.textContent = def ? `${def.name} ×${s.qty}` : 'Casilla vacía';
    this.dDesc.textContent = def ? def.desc : '';
    this.dFx.replaceChildren(...(def ? describeEffects(def) : []).map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }));
    this.dMeta.textContent = def
      ? `Peso ${def.weight} kg · Valor $${def.value}${s.qty > 1 ? ` · Total $${def.value * s.qty}` : ''}`
      : '';
    this.btnUse.disabled = !(def && isUsable(def));
    this.btnDrop1.disabled = !def;
    this.btnDropAll.disabled = !def || s.qty < 2;
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
      c[i] = key;
      const q = this.quickEls[i];
      q.ico.textContent = id ? ITEMS[id].emoji : '';
      q.qty.textContent = id ? n : '';
      q.el.classList.toggle('empty', !id || n === 0);
      q.el.title = id ? ITEMS[id].name : '';
    }
    this.quickEl.classList.toggle('visible', any);
  }

  _showTip(i, slotEl) {
    const s = this.inv.slots[i];
    if (!s) { this.tipEl.style.display = 'none'; return; }
    const def = ITEMS[s.id];
    const fx = describeEffects(def);
    this.tipEl.textContent = '';
    const b = document.createElement('b');
    b.textContent = `${def.emoji} ${def.name}`;
    this.tipEl.append(b, document.createElement('br'), def.desc);
    for (const t of fx) this.tipEl.append(document.createElement('br'), t);
    const tip = this.tipEl;
    tip.style.display = 'block';
    const r = slotEl.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(window.innerWidth - tw - 4, r.left + r.width / 2 - tw / 2)) + 'px';
    const above = r.top - th - 6;
    tip.style.top = (above >= 4 ? above : r.bottom + 6) + 'px';
  }

  // Toast propio (mismo estilo que el HUD)
  _toast(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `loot-toast ${type}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
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
