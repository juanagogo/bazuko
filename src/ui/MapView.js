// src/ui/MapView.js
// Mapa grande de la pestaña «Mapa»: norte arriba, arrastre, rueda para zoom y clic para marcar destino.
// La ciudad es el mismo plano a marcador del radar: se hornea a la escala de la vista y arrastrar solo pega esa imagen.
// El lienzo es transparente: el cartón, seco o mojado, lo pone la hoja. Fuera de la ciudad queda cartón.
import { el, button } from './dom.js';
import { LETRA } from './letra.js';
import { pasarTexto } from './pictos.js';
import { streetLabels } from '../world/bogota/CityMapRaster.js';
import { formatDistance, nombreALaVista } from './Minimap.js';
import { CARTON, CARTON_MOJADO, MARCADOR, flechaJugador, prepararPlano, rutaRoja, trazarPlano, xRoja } from './planoRadar.js';
import { FILTERS, NEED_COPY, hasTag, noOptionText, placeMeta, rankPlaces, sellFirstPlaces } from './mapServices.js';

const PRESS_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']); // las teclas que pulsan un botón
const PAN_STEP = 24;
const HIT_RADIUS = 14;
const SERVICE_MIN_ZOOM = 1.6; // por debajo, «Ver toda la ciudad» se saturaría de puestos
const NAME_MIN_ZOOM = 1.1;    // por debajo, solo los dibujos
const FRAME_MARGIN = 60;
const SAME_PLACE_METERS = 4; // el destino puede moverse a la acera más cercana al lugar
const LEGEND = [['Andén', 'anden'], ['Calle', 'calle'], ['Parque', 'parque'], ['Agua', 'agua'], ['Edificio', 'edificio'], ['Ruta', 'ruta']];

const HORNO_LADO = 2048;   // píxeles del lado del plano horneado; la vista cabe de sobra y arrastrar no vuelve a hornear
const HORNO_ESPERA = 110;  // al acercar, se estira el plano horneado y se vuelve a hornear al quedarse quieto
const BORDE_VACIO = 24;
const CALLE_CADA = 130;    // metros entre dos nombres de la misma vía
const MAR = 6;             // aire de un dibujo o un nombre dentro de su imagen

/** Solo donde hay calle: un nombre de vía encima de una manzana no dice nada. */
const NO_ES_MANZANA = new Set(['road', 'busway', 'sidewalk', 'floor', 'plaza', 'dirt']);

export class MapView {
  constructor(game) {
    this.game = game;
    this.zoom = 0;          // píxeles CSS por metro; 0 = aún sin calcular
    this.centerX = 0;
    this.centerZ = 0;
    this.hover = null;
    this.filter = 'todo';   // dura toda la sesión; nunca cambia solo
    this._drag = null;
    this._dedos = new Map(); // puntero → dónde va, en el lienzo
    this._pinza = null;      // con dos dedos: separación, acercamiento y punto del mundo con que empezó
    this._labels = streetLabels();
    this._walkCache = new Map();
    this._focusCta = null;
    this._panned = false;   // Enter marca el centro solo si el jugador movió la vista
    this._plano = undefined; // las líneas de la ciudad: se calculan una vez, al abrir el mapa por primera vez
    this._horno = null;
    this._imagenes = new Map();
    this._rotulos = null;

    this.canvas = el('canvas', {
      class: 'map-view__canvas', tabindex: '0',
      'aria-label': 'Mapa de la ciudad. Clic para marcar destino, clic derecho para quitarlo, arrastrar para mover y rueda para acercar.'
    });
    this.ctx = this.canvas.getContext?.('2d');
    this.sidebar = el('aside', { class: 'map-view__side' });
    const tool = (text, label, onclick) => el('button', { type: 'button', class: 'map-view__tool cinta', title: label, 'aria-label': label, onclick, text });
    this.root = el('div', { class: 'map-view' },
      el('div', { class: 'map-view__stage' },
        el('div', { class: 'map-view__papel' }, this.canvas,
          el('div', { class: 'map-view__tools' },
            tool('+', 'Acercar', () => this._zoomAt(this.cssWidth / 2, this.cssHeight / 2, 1.3)),
            tool('−', 'Alejar', () => this._zoomAt(this.cssWidth / 2, this.cssHeight / 2, 1 / 1.3)),
            tool(pasarTexto('◎'), 'Centrar en mí', () => this.centerOnPlayer()),
            tool(pasarTexto('⤢'), 'Ver toda la ciudad', () => this.fitCity()))),
        el('div', { class: 'map-view__pie' },
          el('ul', { class: 'map-view__legend', 'aria-label': 'Leyenda' },
            LEGEND.map(([name, key]) => el('li', { class: `ley ley--${key}` }, el('i', { 'aria-hidden': 'true' }), name))),
          el('div', { class: 'map-view__hint' },
            el('span', {}, el('kbd', { text: 'Clic' }), ' marcar'),
            el('span', {}, el('kbd', { text: 'Clic der.' }), ' quitar'),
            el('span', {}, el('kbd', { text: 'Rueda' }), ' acercar')))),
      this.sidebar);
    this._bind();
  }

  /** Se llama cada vez que la pestaña se muestra. */
  mount({ recenter = true } = {}) {
    const p = this.game.player?.position;
    if (recenter && p) { this.centerX = p.x; this.centerZ = p.z; }
    this._panned = false;
    this._drag = null; // un arrastre cortado al cambiar de pestaña no sigue al volver
    this._pinza = null;
    this._dedos.clear();
    this._walkCache.clear();
    this._renderSidebar();
    requestAnimationFrame?.(() => { this._resize(); this.draw(); (this._focusCta ?? this.canvas).focus?.({ preventScroll: true }); });
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect?.();
    if (!rect || !rect.width) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    if (!this.zoom) this.zoom = 2.2;
    this.zoom = this._clampZoom(this.zoom);
  }

  centerOnPlayer() {
    const p = this.game.player?.position;
    if (p) { this.centerX = p.x; this.centerZ = p.z; this._panned = false; this.draw(); }
  }

  fitCity() {
    const r = this.game.mapPlan;
    if (!r || !this.cssWidth) return;
    this.centerX = r.originX + r.worldWidth / 2;
    this.centerZ = r.originZ + r.worldHeight / 2;
    this.zoom = this._clampZoom(0);
    this._panned = false;
    this.draw();
  }

  _clampZoom(z) {
    const r = this.game.mapPlan;
    const min = r && this.cssWidth ? Math.min(this.cssWidth / r.worldWidth, this.cssHeight / r.worldHeight) * .9 : .5;
    return Math.max(min, Math.min(9, z));
  }

  /** Pantalla CSS → mundo. */
  _toWorld(sx, sy) {
    return { x: this.centerX + (sx - this.cssWidth / 2) / this.zoom, z: this.centerZ + (sy - this.cssHeight / 2) / this.zoom };
  }

  /** Mundo → pantalla CSS. */
  _toScreen(x, z) {
    return [(x - this.centerX) * this.zoom + this.cssWidth / 2, (z - this.centerZ) * this.zoom + this.cssHeight / 2];
  }

  _pois() { return this.game._getPOIs?.() ?? []; }

  /** Lo que el lienzo dibuja y deja marcar, de abajo arriba: con filtro, lo que coincide queda encima. */
  _visiblePois() {
    const pois = this._pois();
    if (this.filter === 'todo') return this.zoom >= SERVICE_MIN_ZOOM ? pois : pois.filter(poi => !poi.service);
    return [...pois.filter(poi => !hasTag(poi, this.filter)), ...pois.filter(poi => hasTag(poi, this.filter))];
  }

  _hit(sx, sy) {
    let best = null, bestD = HIT_RADIUS;
    for (const poi of this._visiblePois()) {
      const [px, py] = this._toScreen(poi.x, poi.z);
      const d = Math.hypot(px - sx, py - sy);
      // En un empate gana lo que está dibujado encima.
      if (d <= bestD) { bestD = d; best = poi; }
    }
    return best;
  }

  /** Metros a pie desde el jugador; null si no hay camino. Vale mientras dure la pestaña: en pausa nadie se mueve. */
  _walk(poi) {
    const p = this.game.player?.position, gps = this.game.gps;
    if (!p) return 0;
    if (!gps?.routeLengthTo) return Math.hypot(poi.x - p.x, poi.z - p.z);
    const key = `${poi.x}|${poi.z}`;
    if (!this._walkCache.has(key)) this._walkCache.set(key, gps.routeLengthTo(p, poi));
    return this._walkCache.get(key);
  }

  /** Centra la vista entre el jugador y el lugar, y aleja solo si hace falta para ver ambos. */
  _frame(poi) {
    const p = this.game.player?.position;
    if (!p || !this.cssWidth) { this.centerX = poi.x; this.centerZ = poi.z; return; }
    this.centerX = (p.x + poi.x) / 2;
    this.centerZ = (p.z + poi.z) / 2;
    const fit = Math.min((this.cssWidth - 2 * FRAME_MARGIN) / Math.max(1, Math.abs(poi.x - p.x)),
      (this.cssHeight - 2 * FRAME_MARGIN) / Math.max(1, Math.abs(poi.z - p.z)));
    this.zoom = this._clampZoom(Math.min(this.zoom, fit));
  }

  _go(poi) {
    this._frame(poi);
    this._mark(poi);
  }

  _local(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const [sx, sy] = this._local(e);
      this._dedos.set(e.pointerId, { sx, sy });
      c.setPointerCapture?.(e.pointerId);
      if (this._dedos.size >= 2) {
        this._drag = null;
        this._armarPinza();
        return;
      }
      this._drag = { sx, sy, cx: this.centerX, cz: this.centerZ, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (e.buttons === 0) { this._drag = null; this._pinza = null; this._dedos.clear(); } // el botón se soltó donde el lienzo no lo vio
      const [sx, sy] = this._local(e);
      const dedo = this._dedos.get(e.pointerId);
      if (dedo) { dedo.sx = sx; dedo.sy = sy; }
      if (this._pinza) {
        if (dedo) this._moverPinza();
        return;
      }
      const d = this._drag;
      if (d) {
        if (Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true;
        if (d.moved) {
          this.centerX = d.cx - (sx - d.sx) / this.zoom;
          this.centerZ = d.cz - (sy - d.sy) / this.zoom;
          this._panned = true;
        }
      }
      const hover = d?.moved ? this.hover : this._hit(sx, sy);
      if (d?.moved || hover !== this.hover) { this.hover = hover; this._pedirDibujo(); }
      const cursor = d?.moved ? 'grabbing' : hover ? 'pointer' : 'crosshair';
      if (c.style.cursor !== cursor) c.style.cursor = cursor;
    });
    c.addEventListener('pointerup', (e) => {
      // Dos dedos que se abren no son un toque: ni al levantar el primero ni al levantar el último se marca nada.
      const enPinza = !!this._pinza;
      this._quitarDedo(e.pointerId);
      if (enPinza) return;
      const d = this._drag;
      this._drag = null;
      // Con el menú cerrado a mitad del clic, soltar no debe marcar nada en un mapa que ya no se ve.
      if (!d || d.moved || !(c.getClientRects?.().length ?? 1)) return;
      const [sx, sy] = this._local(e);
      const poi = this._hit(sx, sy);
      this._mark(poi ?? { ...this._toWorld(sx, sy), name: 'Punto marcado', icon: '📍' });
    });
    c.addEventListener('pointercancel', (e) => {
      const enPinza = !!this._pinza;
      this._quitarDedo(e.pointerId);
      if (!enPinza) this._drag = null;
    });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this._clear(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = this._local(e);
      this._zoomAt(sx, sy, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });
    c.addEventListener('keydown', (e) => { this._onKey(e); });
    // Con el foco en el panel el teclado sigue manejando el mapa; las teclas que pulsan son del botón enfocado.
    this.root.addEventListener('keydown', (e) => {
      if (e.target === c || PRESS_KEYS.has(e.code)) return;
      if (this._onKey(e)) c.focus?.({ preventScroll: true });
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { this._resize(); this._horno = null; this.draw(); }).observe(c);
    }
  }

  /** Con dos dedos: lo que queda entre ellos no se mueve de debajo, y la separación manda el acercamiento. */
  _armarPinza() {
    const [a, b] = this._dedos.values();
    const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
    this._pinza = { dist: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)), zoom: this.zoom, ...this._toWorld(mx, my) };
  }

  _moverPinza() {
    const [a, b] = this._dedos.values(), p = this._pinza;
    this.zoom = this._clampZoom(p.zoom * Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)) / p.dist);
    this.centerX = p.x - ((a.sx + b.sx) / 2 - this.cssWidth / 2) / this.zoom;
    this.centerZ = p.z - ((a.sy + b.sy) / 2 - this.cssHeight / 2) / this.zoom;
    this._panned = true;
    this._pedirDibujo();
  }

  /** El dedo que queda sigue arrastrando desde donde está, sin saltar y sin contar como toque. */
  _quitarDedo(id) {
    this._dedos.delete(id);
    if (!this._pinza) return;
    if (this._dedos.size >= 2) { this._armarPinza(); return; }
    this._pinza = null;
    const resto = this._dedos.values().next().value;
    this._drag = resto ? { sx: resto.sx, sy: resto.sy, cx: this.centerX, cz: this.centerZ, moved: true } : null;
  }

  /** Teclado del mapa. Devuelve true si la tecla era suya. */
  _onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false; // los atajos del navegador siguen su camino
    const pan = PAN_STEP * 2.2 / this.zoom;
    const moves = { ArrowLeft: [-pan, 0], ArrowRight: [pan, 0], ArrowUp: [0, -pan], ArrowDown: [0, pan] };
    if (moves[e.code]) { this.centerX += moves[e.code][0]; this.centerZ += moves[e.code][1]; this._panned = true; }
    // También por `key`: en teclados español y latinoamericano, «+» y «-» están en otras teclas físicas.
    else if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') this._zoomAt(this.cssWidth / 2, this.cssHeight / 2, 1.25);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') this._zoomAt(this.cssWidth / 2, this.cssHeight / 2, 1 / 1.25);
    // Solo tras mover la vista: M + Enter sin botón, o mantener Enter, no deben reemplazar la ruta con el centro.
    else if (PRESS_KEYS.has(e.code)) { if (!e.repeat && this._panned) this._mark({ x: this.centerX, z: this.centerZ, name: 'Punto marcado', icon: '📍' }); }
    else if (e.code === 'Delete' || e.code === 'Backspace') this._clear();
    else return false;
    e.preventDefault();
    e.stopPropagation();
    this.draw();
    return true;
  }

  _zoomAt(sx, sy, factor) {
    const before = this._toWorld(sx, sy);
    this.zoom = this._clampZoom(this.zoom * factor);
    const after = this._toWorld(sx, sy);
    this.centerX += before.x - after.x;
    this.centerZ += before.z - after.z;
    this.draw();
  }

  _mark(target) {
    const { name, icon, x, z } = target;
    this.game.setGpsWaypoint?.({ name, icon: icon || '📍', x, z });
    this._panned = false;
    this._renderSidebar();
    this.draw();
  }

  _clear() {
    this.game.clearGpsWaypoint?.();
    this._renderSidebar();
    this.draw();
  }

  _renderSidebar({ keepScroll = true } = {}) {
    const gps = this.game.gps;
    const p = this.game.player?.position;
    const wp = gps?.waypoint;
    const pois = this._pois();
    const needs = this.game._needs ?? {};
    const need = needs.need ?? null;
    const carried = need ? needs.carried?.[need] : null;
    const filter = this.filter !== 'todo' ? this.filter : null;
    // `replaceChildren` quita el control enfocado: sin esto, el mando pierde su sitio.
    const focused = globalThis.document?.activeElement;
    const hadFocus = !!focused && !!this.sidebar.contains?.(focused);
    const scroll = keepScroll ? this.sidebar.querySelector?.('.map-view__list')?.scrollTop ?? 0 : 0;

    const current = wp
      ? el('div', { class: 'map-view__dest' },
        el('span', { class: 'map-view__dest-label', text: 'Destino' }),
        el('strong', { text: pasarTexto(`${wp.icon} ${nombreALaVista(wp.name)}`) }),
        el('span', { class: 'map-view__dest-meta', text: gps.route.length && p
          ? `${formatDistance(gps.remainingDistance(p))} a pie` : 'Sin ruta a pie' }),
        button('Quitar destino', { onClick: () => this._clear() }))
      : el('div', { class: 'map-view__dest is-empty' },
        el('span', { class: 'map-view__dest-label', text: 'Sin destino' }),
        need ? el('strong', { text: pasarTexto(NEED_COPY[need].alert) })
          : el('span', { class: 'map-view__dest-meta', text: 'Haga clic en el mapa o elija un lugar.' }),
        carried ? el('span', { class: 'map-view__dest-meta', text: `Llevo: ${carried}. Se usa desde el costal con I.` }) : null);

    const filters = el('div', { class: 'map-view__filters', role: 'group', 'aria-label': 'Filtrar lugares' },
      FILTERS.map(([id, label]) => el('button', {
        type: 'button', 'data-focus': `filtro-${id}`, 'aria-pressed': String(id === this.filter),
        class: `map-view__filter${id === this.filter ? ' is-active' : ''}${id === need ? ' is-need' : ''}`,
        onclick: () => { this.filter = id; this._rotulos = null; this._renderSidebar({ keepScroll: false }); this.draw(); },
      }, el('span', { class: id === this.filter ? 'elegido' : null, text: label }))));

    const rank = (tag) => rankPlaces(pois, { tag, walk: (poi) => this._walk(poi), needs, from: p });
    const rows = rank(filter);
    // Lo urgente manda sobre el filtro, que dura toda la sesión: M + Enter siempre lleva a lo que más se necesita.
    const urgent = !wp && need && !carried ? need : null;
    const tag = urgent ?? filter;
    const goButton = (label, poi) => el('button', {
      type: 'button', class: 'btn btn--small map-view__nearest cinta', 'data-focus': 'cta', text: label,
      onclick: () => this._go(poi),
    });
    let cta = null, noOption = null;
    if (tag) {
      const options = tag === filter ? rows : rank(tag);
      // Igual que en el radar: el Dealer no compra reciclaje, así que no alivia el costal.
      const best = options.find(tag === 'vender' && need === 'vender' ? (row) => row.usable && !row.poi.dealer : (row) => row.usable);
      const sellers = best ? [] : sellFirstPlaces(pois, tag, needs);
      const sell = sellers.length ? rank('vender').find(row => sellers.includes(row.poi)) : null;
      if (best) cta = goButton(NEED_COPY[tag].cta, best.poi);
      else {
        if (sell) cta = goButton(NEED_COPY.vender.cta, sell.poi);
        const text = noOptionText(tag, options, needs, sell?.poi);
        if (text) noOption = el('p', { class: 'map-view__no-option', text });
      }
    }
    this._focusCta = urgent ? cta : null;

    const list = el('ul', { class: 'map-view__list' }, rows.map(({ poi, meters, usable }, i) => {
      const dist = !p ? '' : meters === null ? 'sin ruta' : formatDistance(meters);
      // Las fogatas se llaman igual: su fila solo es el destino si es esa misma fogata.
      const active = wp && wp.name === poi.name && (!poi.service || Math.hypot(wp.x - poi.x, wp.z - poi.z) < SAME_PLACE_METERS);
      const broke = filter && filter !== 'vender' && !usable;
      const meta = placeMeta(poi, filter, needs);
      return el('li', {},
        el('button', { type: 'button', 'data-focus': `lugar-${i}`,
          class: `map-view__place${active ? ' is-active' : ''}${broke ? ' is-broke' : ''}`,
          'aria-current': active ? 'true' : null,
          onclick: () => this._go(poi) },
        el('span', { class: 'map-view__place-icon', 'aria-hidden': 'true', text: pasarTexto(poi.icon) }),
        el('span', { class: `map-view__place-name${active ? ' elegido' : ''}`, text: nombreALaVista(poi.name) }),
        el('span', { class: 'map-view__place-dist', text: dist }),
        // Si no cabe, baja «desde $ 1.000» completo y no parte el precio en dos líneas.
        meta ? el('span', { class: 'map-view__place-meta', text: meta.replace('desde $ ', 'desde\u00a0$\u00a0') }) : null));
    }));

    this.sidebar.replaceChildren(...[
      filters, current, cta, noOption,
      el('h4', { class: 'map-view__list-title', text: filter ? 'Ir a… (primero lo que sirve)' : 'Ir a… (más cerca a pie primero)' }),
      list].filter(Boolean));
    list.scrollTop = scroll;
    if (!keepScroll) this.sidebar.scrollTop = 0; // el que se desplaza es el panel entero, no la lista
    if (hadFocus) {
      const key = focused.dataset?.focus;
      const next = key ? this.sidebar.querySelector?.(`[data-focus="${key}"]`) : null;
      (next ?? this.canvas).focus?.({ preventScroll: true });
    }
  }

  // ---------- el plano horneado ----------

  /** El cartón sobre el que va todo, para el halo de la letra: la cara la pone la hoja y aquí solo se recorta el fondo. */
  _cara() {
    return globalThis.document?.body?.classList?.contains('mojado') ? CARTON_MOJADO : CARTON;
  }

  /**
   * Hornea la ciudad a la escala de la vista, en una sola imagen, con los nombres de las vías. Si la ciudad entera cabe
   * en HORNO_LADO no se vuelve a hornear al arrastrar; si no, se hornea lo que rodea a la vista y se repite al salirse.
   */
  _hornear() {
    const plan = this.game.mapPlan;
    this._plano ??= prepararPlano(plan?.tiles?.());
    if (!plan || !this._plano || !globalThis.document?.createElement) return;
    const zoom = this.zoom, k = zoom * this.dpr;
    const lado = Math.max(HORNO_LADO, Math.ceil(Math.max(this.canvas.width, this.canvas.height) * 1.6));
    const tramo = (centro, desde, largo) => {
      const m = Math.min(lado / k, largo);
      return [Math.max(desde, Math.min(centro - m / 2, desde + largo - m)), m];
    };
    const [x0, w] = tramo(this.centerX, plan.originX, plan.worldWidth);
    const [z0, h] = tramo(this.centerZ, plan.originZ, plan.worldHeight);
    const canvas = this._horno?.canvas ?? document.createElement('canvas');
    canvas.width = Math.ceil(w * k);
    canvas.height = Math.ceil(h * k);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, -x0 * k, -z0 * k);
    trazarPlano(ctx, this._plano, zoom);
    if (zoom > NAME_MIN_ZOOM) this._nombresDeVias(ctx, { x0, z0, w, h, k });
    this._horno = { canvas, x0, z0, w, h, zoom, cara: this._cara(), entera: w >= plan.worldWidth && h >= plan.worldHeight };
    this._rotulos = null;
  }

  /** Los nombres de las vías van en el plano horneado, repartidos a lo largo de cada una y solo sobre calle. */
  _nombresDeVias(ctx, { x0, z0, w, h, k }) {
    const tiles = this.game.mapPlan.tiles();
    const tipo = (x, z) => tiles.tipo(Math.round(x / tiles.T), Math.round(z / tiles.T));
    const px = this.dpr;
    ctx.font = `400 ${15 * px}px ${LETRA}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = this._cara();
    ctx.fillStyle = MARCADOR;
    const poner = (name, x, z, giro) => {
      if (x < x0 || z < z0 || x > x0 + w || z > z0 + h || !NO_ES_MANZANA.has(tipo(x, z))) return;
      ctx.setTransform(1, 0, 0, 1, (x - x0) * k, (z - z0) * k);
      if (giro) ctx.rotate(-Math.PI / 2);
      ctx.strokeText(name, 0, 0);
      ctx.fillText(name, 0, 0);
    };
    const plan = this.game.mapPlan;
    for (const label of this._labels) {
      if (label.vertical) {
        for (let z = plan.originZ + CALLE_CADA / 2; z < plan.originZ + plan.worldHeight; z += CALLE_CADA) poner(label.name, label.x, z, true);
      } else {
        const desde = Math.max(plan.originX, label.minX ?? -Infinity);
        for (let x = desde + CALLE_CADA / 2; x < plan.originX + plan.worldWidth; x += CALLE_CADA) poner(label.name, x, label.z, false);
      }
    }
  }

  /** Una imagen pequeña, hecha una vez: un dibujo o un nombre. Pegarla cuesta mucho menos que escribirla. */
  _imagen(clave, medir, pintar) {
    let img = this._imagenes.get(clave);
    if (img) return img;
    const dpr = this.dpr;
    const medida = globalThis.document.createElement('canvas');
    const ctx = medida.getContext('2d');
    const [w, h] = medir(ctx);
    medida.width = Math.ceil((w + 2 * MAR) * dpr);
    medida.height = Math.ceil((h + 2 * MAR) * dpr);
    const c = medida.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(MAR, MAR);
    pintar(c, w, h);
    img = { canvas: medida, w: w + 2 * MAR, h: h + 2 * MAR };
    this._imagenes.set(clave, img);
    return img;
  }

  _dibujo(glyph, size) {
    const cara = this._cara();
    return this._imagen(`d|${glyph}|${size}|${cara}|${this.dpr}`, () => [size, size], (c) => {
      c.font = `400 ${size}px ${LETRA}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.lineWidth = 5;
      c.strokeStyle = cara;
      c.strokeText(glyph, size / 2, size / 2);
      c.fillStyle = MARCADOR;
      c.fillText(glyph, size / 2, size / 2);
    });
  }

  _nombre(text) {
    const cara = this._cara(), font = `800 16px ${LETRA}`;
    return this._imagen(`n|${text}|${cara}|${this.dpr}`, (c) => { c.font = font; return [c.measureText(text).width, 18]; }, (c, w, h) => {
      c.font = font;
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.lineWidth = 5;
      c.strokeStyle = cara;
      c.strokeText(text, 0, h / 2);
      c.fillStyle = MARCADOR;
      c.fillText(text, 0, h / 2);
    });
  }

  /** Qué nombres se escriben a esta escala: los lugares fijos primero; si dos se pisan, se escribe uno. */
  _reparto() {
    const pois = this._visiblePois();
    const filter = this.filter !== 'todo' ? this.filter : null;
    const zoom = this.zoom;
    const quiere = pois.filter(poi => (filter ? hasTag(poi, filter) : !poi.service))
      .sort((a, b) => Number(!!a.service) - Number(!!b.service));
    const puestos = [];
    const rotulos = [];
    if (zoom <= NAME_MIN_ZOOM) return rotulos;
    for (const poi of quiere) {
      const img = this._nombre(nombreALaVista(poi.name));
      const x = poi.x * zoom - img.w / 2, y = poi.z * zoom + 10, r = [x, y, x + img.w, y + img.h];
      if (puestos.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) continue;
      puestos.push(r);
      rotulos.push({ poi, img });
    }
    return rotulos;
  }

  _pedirDibujo() {
    if (this._dibujoPedido) return;
    this._dibujoPedido = true;
    requestAnimationFrame(() => { this._dibujoPedido = false; this.draw(); });
  }

  /** Por más que se arrastre, el centro de la vista no se sale de la ciudad. */
  _alCentroDeLaCiudad() {
    const plan = this.game.mapPlan;
    if (!plan) return;
    // Si la ciudad no cabe, la vista no enseña más que un borde de cartón vacío; si cabe, queda en el medio.
    const dentro = (centro, desde, largo, vista) => {
      const mitad = vista / 2 / this.zoom - BORDE_VACIO / this.zoom;
      return mitad * 2 >= largo ? desde + largo / 2 : Math.max(desde + mitad, Math.min(desde + largo - mitad, centro));
    };
    this.centerX = dentro(this.centerX, plan.originX, plan.worldWidth, this.cssWidth);
    this.centerZ = dentro(this.centerZ, plan.originZ, plan.worldHeight, this.cssHeight);
  }

  /** ¿Sirve lo horneado? A otra escala se estira un momento, y al quedarse quieto se hornea de nuevo. */
  _hornoAlDia() {
    const horno = this._horno;
    if (!horno || horno.cara !== this._cara()) { this._hornear(); return; }
    if (horno.zoom !== this.zoom) {
      clearTimeout(this._hornoPendiente);
      this._hornoPendiente = setTimeout(() => { this._hornear(); this.draw(); }, HORNO_ESPERA);
      return;
    }
    if (horno.entera) return;
    const a = this._toWorld(0, 0), b = this._toWorld(this.cssWidth, this.cssHeight);
    const plan = this.game.mapPlan;
    const sale = (lo, hi, desde, largo, cityLo, cityHi) => (lo < desde && desde > cityLo) || (hi > desde + largo && desde + largo < cityHi);
    if (sale(a.x, b.x, horno.x0, horno.w, plan.originX, plan.originX + plan.worldWidth)
      || sale(a.z, b.z, horno.z0, horno.h, plan.originZ, plan.originZ + plan.worldHeight)) this._hornear();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.cssWidth) return;
    const dpr = this.dpr, w = this.cssWidth, h = this.cssHeight;
    this._alCentroDeLaCiudad();
    this._hornoAlDia();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const horno = this._horno;
    if (horno) {
      const [sx, sy] = this._toScreen(horno.x0, horno.z0);
      // A la escala horneada se pega en píxeles enteros, para que la línea no se empañe.
      const exacta = horno.zoom === this.zoom;
      ctx.imageSmoothingEnabled = !exacta;
      ctx.drawImage(horno.canvas, exacta ? Math.round(sx * dpr) / dpr : sx, exacta ? Math.round(sy * dpr) / dpr : sy,
        exacta ? horno.canvas.width / dpr : horno.w * this.zoom, exacta ? horno.canvas.height / dpr : horno.h * this.zoom);
      ctx.imageSmoothingEnabled = true;
    }

    const gps = this.game.gps, p = this.game.player?.position;
    const route = gps?.waypoint && p ? gps.remainingRoute(p) : [];
    if (route.length > 1) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.centerX, -this.centerZ);
      rutaRoja(ctx, route, this.zoom);
      ctx.restore();
    }

    // Lugares: dibujos y nombres, ya hechos.
    const filter = this.filter !== 'todo' ? this.filter : null;
    for (const poi of this._visiblePois()) {
      const [sx, sy] = this._toScreen(poi.x, poi.z);
      if (sx < -24 || sy < -24 || sx > w + 24 || sy > h + 24) continue;
      const match = !filter || hasTag(poi, filter), big = poi === this.hover;
      const size = (poi.service && !(filter && match) ? 18 : 24) + (big ? 6 : 0);
      const img = this._dibujo(pasarTexto(poi.icon), size);
      ctx.globalAlpha = match ? 1 : .35;
      ctx.drawImage(img.canvas, sx - img.w / 2, sy - img.h / 2, img.w, img.h);
      ctx.globalAlpha = 1;
    }
    this._rotulos ??= this._reparto();
    for (const { poi, img } of this._rotulos) {
      const [sx, sy] = this._toScreen(poi.x, poi.z);
      if (sx < -img.w || sy < -img.h || sx > w + img.w || sy > h + img.h) continue;
      ctx.drawImage(img.canvas, sx - img.w / 2, sy + 10, img.w, img.h);
    }
    if (this.hover && !this._rotulos.some(r => r.poi === this.hover)) {
      const img = this._nombre(nombreALaVista(this.hover.name));
      const [sx, sy] = this._toScreen(this.hover.x, this.hover.z);
      ctx.drawImage(img.canvas, sx - img.w / 2, sy + 14, img.w, img.h);
    }

    // Destino y jugador, siempre encima.
    if (gps?.waypoint) {
      const [sx, sy] = this._toScreen(gps.waypoint.x, gps.waypoint.z);
      xRoja(ctx, sx, sy, 9);
    }
    if (p) {
      const [sx, sy] = this._toScreen(p.x, p.z);
      flechaJugador(ctx, sx, sy, 11, -(this.game._cameraYaw?.() ?? 0));
    }
  }
}
