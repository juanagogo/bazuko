// src/ui/WorldMap.js
// Mapa completo de la ciudad (tecla K o clic en el radar), al estilo del mapa de GTA V:
// a la izquierda un panel con el destino, los lugares por categoría y la leyenda; al pasar
// el ratón, una tarjeta con la información del ícono, calle o zona. Clic marca el destino
// y el juego traza la ruta. Mientras está abierto el juego queda en pausa.
import { MAP_COLORS, MAP_LEGEND } from './CityMap.js';
import { PLAYER_SPEED_WALK } from '../utils/constants.js';

const ROUTE_COLOR = '#c45bff';
const WAYPOINT_COLOR = '#c45bff';
const CATEGORY_ORDER = ['Refugio', 'Servicios', 'Comercio', 'Lugares', 'Compañero'];
const HIT_RADIUS = 14; // píxeles alrededor de un ícono para seleccionarlo

/** Metros a texto corto y tiempo aproximado caminando. */
export function formatTrip(meters) {
  const m = Math.max(0, Math.round(meters));
  const seconds = Math.round(m / PLAYER_SPEED_WALK);
  const time = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
  return { distance: `${m} m`, time: `≈ ${time} caminando` };
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class WorldMap {
  /**
   * @param {{ getState: () => { player?: {x:number,z:number}, heading?: number, pois?: object[],
   *   route?: {x:number,z:number}[] | null, waypoint?: {x:number,z:number,label?:string} | null, remaining?: number },
   *   onSelect?: (x:number, z:number, poi?: object|null) => void, onClear?: () => void }} opts
   */
  constructor({ getState = () => ({}), onSelect = null, onClear = null } = {}) {
    this.getState = getState;
    this.onSelect = onSelect;
    this.onClear = onClear;
    this.isOpen = false;
    this.cityMap = null;
    this.zoom = 1;          // píxeles de pantalla por metro
    this.center = { x: 120, z: 120 };
    this.hovered = null;    // ícono bajo el ratón o resaltado desde la lista
    this._drag = null;
    this.root = null;
    if (typeof document === 'undefined' || !document.createElement) return;
    this._createDOM();
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Escape' || e.code === 'KeyK') {
        e._panelHandled = true;
        this.close();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        this._clear();
      }
    });
    window.addEventListener('resize', () => { if (this.isOpen) this.render(); });
  }

  _createDOM() {
    const root = document.createElement('div');
    root.id = 'world-map';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Mapa de la ciudad');
    root.innerHTML = `
      <canvas id="world-map-canvas" aria-label="Mapa de Bogotá: haz clic para marcar un destino"></canvas>
      <aside class="world-map-panel" aria-label="Información del mapa">
        <header><strong>🗺️ Centro de Bogotá</strong><span>Mapa y destinos</span></header>
        <section class="world-map-dest" id="world-map-dest" aria-live="polite"></section>
        <section class="world-map-places"><h3>Lugares</h3><div id="world-map-places"></div></section>
        <section class="world-map-legend"><h3>Leyenda</h3><div id="world-map-legend"></div></section>
      </aside>
      <button type="button" id="world-map-close" aria-label="Cerrar mapa">✕ Cerrar (K)</button>
      <div class="world-map-tooltip" id="world-map-tooltip" hidden></div>
      <div class="world-map-help">
        <span><kbd>Clic</kbd> marcar destino</span>
        <span><kbd>Clic der.</kbd> / <kbd>Supr</kbd> quitar</span>
        <span><kbd>Rueda</kbd> zoom</span>
        <span><kbd>Arrastrar</kbd> mover</span>
        <span><kbd>Esc</kbd> cerrar</span>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('#world-map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.panel = root.querySelector('.world-map-panel');
    this.destEl = root.querySelector('#world-map-dest');
    this.placesEl = root.querySelector('#world-map-places');
    this.tooltip = root.querySelector('#world-map-tooltip');
    root.querySelector('#world-map-close').addEventListener('click', () => this.close());
    this._renderLegend(root.querySelector('#world-map-legend'));

    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture?.(e.pointerId);
      this._drag = { x: e.clientX, y: e.clientY, cx: this.center.x, cz: this.center.z, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = this._drag;
      if (!d) { this._hover(e.clientX, e.clientY); return; }
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (!d.moved) return;
      this._hideTooltip();
      this.center.x = d.cx - dx / this.zoom;
      this.center.z = d.cz - dy / this.zoom;
      this._clampCenter();
      this.render();
    });
    canvas.addEventListener('pointerleave', () => { this._hideTooltip(); this._setHovered(null); });
    canvas.addEventListener('pointerup', (e) => {
      const d = this._drag;
      this._drag = null;
      if (!d || d.moved || e.button !== 0) return;
      // Sobre un ícono, el destino es ese lugar; si no, el punto del mapa.
      const poi = this.poiAt(e.clientX, e.clientY);
      const world = poi ?? this.toWorld(e.clientX, e.clientY);
      this.onSelect?.(world.x, world.z, poi);
      this.refresh();
      this._hover(e.clientX, e.clientY);
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._clear();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.clientX, e.clientY);
      this.zoom = Math.min(8, Math.max(this._minZoom(), this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.toWorld(e.clientX, e.clientY);
      this.center.x += before.x - after.x;
      this.center.z += before.z - after.z;
      this._clampCenter();
      this.render();
      this._hover(e.clientX, e.clientY);
    }, { passive: false });
  }

  setCityMap(cityMap) {
    this.cityMap = cityMap;
  }

  open() {
    if (!this.root || this.isOpen) return;
    this.isOpen = true;
    this.root.hidden = false;
    document.exitPointerLock?.();
    const { player, waypoint } = this.getState();
    // Centrado en el jugador con zoom de barrio, como al abrir el mapa en GTA.
    this._resize();
    this.zoom = Math.max(this._minZoom(), 2.2);
    this.focus(player ?? waypoint ?? this.center);
    this.refresh();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._drag = null;
    this._hideTooltip();
    this.hovered = null;
    if (this.root) this.root.hidden = true;
  }

  toggle() { return this.isOpen ? this.close() : this.open(); }

  /** Centra la vista en un punto, dejando libre el panel de la izquierda. */
  focus(point) {
    this.center = { x: point.x - this._panelOffset() / this.zoom, z: point.z };
    this._clampCenter();
  }

  /** Vuelve a dibujar mapa, panel de destino y lista de lugares. */
  refresh() {
    this.render();
    this._renderDestination();
    this._renderPlaces();
  }

  _clear() {
    this.onClear?.();
    this.refresh();
  }

  _panelOffset() {
    const width = this.panel?.offsetWidth ?? 0;
    return this._w > 720 ? width / 2 : 0;
  }

  _resize() {
    const ratio = globalThis.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    if (this.canvas.width !== Math.round(w * ratio) || this.canvas.height !== Math.round(h * ratio)) {
      this.canvas.width = Math.round(w * ratio);
      this.canvas.height = Math.round(h * ratio);
    }
    this._ratio = ratio;
    this._w = w; this._h = h;
  }

  _minZoom() {
    const b = this.cityMap?.bounds;
    if (!b || !this._w) return .5;
    return Math.min(this._w / (b.x1 - b.x0), this._h / (b.z1 - b.z0)) * .9;
  }

  _clampCenter() {
    const b = this.cityMap?.bounds;
    if (!b) return;
    this.center.x = Math.min(b.x1, Math.max(b.x0, this.center.x));
    this.center.z = Math.min(b.z1, Math.max(b.z0, this.center.z));
  }

  /** Coordenadas de pantalla (clientX/Y) a metros del mundo. */
  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.center.x + (clientX - rect.left - this._w / 2) / this.zoom,
      z: this.center.z + (clientY - rect.top - this._h / 2) / this.zoom
    };
  }

  toScreen(x, z) {
    return [this._w / 2 + (x - this.center.x) * this.zoom, this._h / 2 + (z - this.center.z) * this.zoom];
  }

  /** Ícono bajo el cursor, o null. */
  poiAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    let best = null, bestDist = HIT_RADIUS;
    for (const poi of this.getState().pois ?? []) {
      const [x, y] = this.toScreen(poi.x, poi.z);
      const d = Math.hypot(x - mx, y - my);
      if (d <= bestDist) { best = poi; bestDist = d; }
    }
    return best;
  }

  _setHovered(poi) {
    if (this.hovered === poi) return;
    this.hovered = poi;
    for (const item of this.placesEl?.children ?? []) item.classList?.toggle('is-hovered', item._poi === poi);
    this.render();
  }

  _hover(clientX, clientY) {
    if (!this.isOpen) return;
    const poi = this.poiAt(clientX, clientY);
    this._setHovered(poi);
    const { player, waypoint } = this.getState();
    const card = [];
    if (poi) {
      card.push(['title', `${poi.icon} ${poi.name}`]);
      if (poi.category) card.push(['tag', poi.category]);
      if (poi.info) card.push(['text', poi.info]);
      if (poi.action) card.push(['action', poi.action]);
      if (player) card.push(['meta', `A ${formatTrip(Math.hypot(poi.x - player.x, poi.z - player.z)).distance} en línea recta`]);
      card.push(['hint', 'Clic: marcar ruta hasta aquí']);
    } else {
      const world = this.toWorld(clientX, clientY);
      const place = this.cityMap?.describe?.(world.x, world.z);
      if (!place?.ground && !place?.zone) { this._hideTooltip(); return; }
      card.push(['title', place.zone ?? place.street ?? place.ground]);
      if (place.zone && place.street) card.push(['text', place.street]);
      if (place.ground && place.ground !== card[0][1]) card.push(['text', place.ground]);
      if (player) card.push(['meta', `A ${formatTrip(Math.hypot(world.x - player.x, world.z - player.z)).distance} en línea recta`]);
      const nearWaypoint = waypoint && Math.hypot(world.x - waypoint.x, world.z - waypoint.z) < 3;
      card.push(['hint', nearWaypoint ? 'Destino actual · clic derecho para quitarlo'
        : place.walkable ? 'Clic: marcar destino' : 'Clic: destino en el punto transitable más cercano']);
    }
    this.tooltip.replaceChildren(...card.map(([kind, text]) => el('div', `tt-${kind}`, text)));
    this.tooltip.hidden = false;
    const rect = this.root.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    const x = Math.min(clientX - rect.left + 16, this._w - tw - 8);
    const y = Math.min(clientY - rect.top + 16, this._h - th - 8);
    this.tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  _hideTooltip() {
    if (this.tooltip) this.tooltip.hidden = true;
  }

  _renderDestination() {
    if (!this.destEl) return;
    const { waypoint, remaining } = this.getState();
    if (!waypoint) {
      this.destEl.replaceChildren(
        el('h3', '', 'Destino'),
        el('p', 'muted', 'Haz clic en el mapa o en un lugar de la lista para trazar una ruta a pie.'));
      return;
    }
    const trip = Number.isFinite(remaining) ? formatTrip(remaining) : null;
    const place = this.cityMap?.describe?.(waypoint.x, waypoint.z);
    const clear = el('button', 'world-map-btn', 'Quitar destino');
    clear.type = 'button';
    clear.addEventListener('click', () => this._clear());
    const center = el('button', 'world-map-btn', 'Ver en el mapa');
    center.type = 'button';
    center.addEventListener('click', () => { this.focus(waypoint); this.render(); });
    this.destEl.replaceChildren(
      el('h3', '', 'Destino'),
      el('p', 'dest-name', `📍 ${waypoint.label ?? place?.zone ?? place?.street ?? 'Punto marcado'}`),
      ...(trip ? [el('p', 'dest-trip', `${trip.distance} a pie · ${trip.time}`)] : []),
      ...(place?.street && place.street !== waypoint.label ? [el('p', 'muted', place.street)] : []),
      el('div', 'dest-actions', undefined));
    this.destEl.lastChild.append(center, clear);
  }

  _renderPlaces() {
    if (!this.placesEl) return;
    const { pois = [], player } = this.getState();
    const groups = new Map();
    for (const poi of pois) {
      const category = poi.category ?? 'Lugares';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(poi);
    }
    const order = [...CATEGORY_ORDER, ...[...groups.keys()].filter(c => !CATEGORY_ORDER.includes(c))];
    const nodes = [];
    for (const category of order) {
      const list = groups.get(category);
      if (!list) continue;
      const distance = poi => player ? Math.hypot(poi.x - player.x, poi.z - player.z) : 0;
      list.sort((a, b) => distance(a) - distance(b));
      nodes.push(el('h4', '', category));
      for (const poi of list) {
        const item = el('button', 'world-map-place');
        item.type = 'button';
        item._poi = poi;
        item.style.setProperty('--poi-color', poi.color || '#ffd166');
        const head = el('span', 'place-head');
        head.append(el('span', 'place-icon', poi.icon), el('span', 'place-name', poi.name),
          el('span', 'place-dist', player ? formatTrip(distance(poi)).distance : ''));
        item.append(head);
        if (poi.info) item.append(el('span', 'place-info', poi.info));
        if (poi.action) item.append(el('span', 'place-action', poi.action));
        item.title = 'Clic: ver en el mapa y marcar ruta';
        item.addEventListener('mouseenter', () => this._setHovered(poi));
        item.addEventListener('mouseleave', () => this._setHovered(null));
        item.addEventListener('focus', () => this._setHovered(poi));
        item.addEventListener('blur', () => this._setHovered(null));
        item.addEventListener('click', () => {
          this.focus(poi);
          this.onSelect?.(poi.x, poi.z, poi);
          this.refresh();
        });
        nodes.push(item);
      }
    }
    this.placesEl.replaceChildren(...nodes);
  }

  _renderLegend(container) {
    const items = MAP_LEGEND.map(([type, label]) => {
      const row = el('span', 'legend-item');
      const swatch = el('i', 'legend-swatch');
      swatch.style.background = MAP_COLORS[type];
      row.append(swatch, document.createTextNode(label));
      return row;
    });
    const route = el('span', 'legend-item');
    const line = el('i', 'legend-swatch legend-route');
    line.style.background = ROUTE_COLOR;
    route.append(line, document.createTextNode('Ruta al destino'));
    container.replaceChildren(...items, route);
  }

  render() {
    if (!this.isOpen || !this.ctx) return;
    this._resize();
    const ctx = this.ctx, { player, heading = 0, pois = [], route, waypoint } = this.getState();
    const zoom = this.zoom;
    ctx.setTransform(this._ratio, 0, 0, this._ratio, 0, 0);
    ctx.fillStyle = '#121418';
    ctx.fillRect(0, 0, this._w, this._h);
    // Mundo: x → derecha, z → abajo (norte arriba).
    ctx.save();
    ctx.translate(this._w / 2, this._h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.center.x, -this.center.z);
    const map = this.cityMap;
    if (map) {
      ctx.imageSmoothingEnabled = zoom < map.scale;
      ctx.drawImage(map.canvas, map.bounds.x0, map.bounds.z0, map.canvas.width / map.scale, map.canvas.height / map.scale);
    }
    if (route?.length > 1) {
      ctx.beginPath();
      ctx.moveTo(route[0].x, route[0].z);
      for (const p of route) ctx.lineTo(p.x, p.z);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, .55)'; ctx.lineWidth = 7 / zoom; ctx.stroke();
      ctx.strokeStyle = ROUTE_COLOR; ctx.lineWidth = 4 / zoom; ctx.stroke();
    }
    ctx.restore();

    const screen = (x, z) => this.toScreen(x, z);
    if (map && zoom >= 1.6) this._drawStreetNames(ctx, map.bands, screen);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const poi of pois) {
      const [x, y] = screen(poi.x, poi.z);
      const hot = poi === this.hovered;
      const radius = hot ? 14 : 11;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = hot ? 'rgba(30, 32, 40, .95)' : 'rgba(10, 12, 16, .85)'; ctx.fill();
      ctx.lineWidth = hot ? 3 : 2; ctx.strokeStyle = poi.color || '#ffd166'; ctx.stroke();
      ctx.font = `${hot ? 16 : 13}px sans-serif`; ctx.fillStyle = '#fff';
      ctx.fillText(poi.icon, x, y + 1);
      if (zoom >= 2 || hot) {
        ctx.font = 'bold 11px monospace'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
        ctx.strokeText(poi.name, x, y + radius + 9); ctx.fillStyle = '#f1f1f1'; ctx.fillText(poi.name, x, y + radius + 9);
      }
    }
    if (waypoint) drawWaypoint(ctx, ...screen(waypoint.x, waypoint.z), 1.4);
    if (player) drawPlayerArrow(ctx, ...screen(player.x, player.z), heading, 1.4);
  }

  _drawStreetNames(ctx, bands, screen) {
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, .85)'; ctx.fillStyle = '#e8e4d4';
    const spacing = 260 / this.zoom; // un rótulo cada ~260 px de pantalla
    const b = this.cityMap.bounds;
    for (const band of bands) {
      const middle = (band.from + band.to) / 2;
      const [lo, hi] = band.axis === 'z' ? [b.x0, b.x1] : [Math.max(b.z0, 0), b.z1];
      const start = Math.ceil(lo / spacing) * spacing;
      for (let t = start + spacing / 2; t < hi; t += spacing) {
        const [x, y] = band.axis === 'z' ? screen(t, middle) : screen(middle, t);
        if (x < -80 || y < -80 || x > this._w + 80 || y > this._h + 80) continue;
        ctx.save();
        ctx.translate(x, y);
        if (band.axis === 'x') ctx.rotate(-Math.PI / 2);
        ctx.strokeText(band.name, 0, 0); ctx.fillText(band.name, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

/** Flecha del jugador; `heading` es el rumbo en el mundo (0 = +Z, hacia abajo en el mapa). */
export function drawPlayerArrow(ctx, x, y, heading, size = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI - heading);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
  ctx.fillStyle = '#f2f2f2'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#111'; ctx.stroke();
  ctx.restore();
}

/** Marcador de destino estilo GTA: gota morada con punto blanco. */
export function drawWaypoint(ctx, x, y, size = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-7, -8, -7, -16, 0, -16);
  ctx.bezierCurveTo(7, -16, 7, -8, 0, 0);
  ctx.fillStyle = WAYPOINT_COLOR; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#1a0a22'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -10.5, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
}

export { ROUTE_COLOR };
