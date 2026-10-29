// src/ui/Minimap.js
// Radar urbano con plano de la ciudad, ruta del GPS y zoom dinámico.

const ZOOM_KEY = 'bazuko.minimap_zoom';
const SIZE_KEY = 'bazuko.minimap_size';
export const RADAR_ZOOM_MIN = 40;
export const RADAR_ZOOM_MAX = 140;
export const RADAR_SIZES = [
  { id: 's', label: 'Pequeño' },
  { id: 'm', label: 'Mediano' },
  { id: 'l', label: 'Grande' },
];
const RUN_ZOOM = 1.45;
const DIRECTIONS = ['↑ Al frente', '↗ Diagonal der.', '→ Derecha', '↘ Atrás der.',
  '↓ Atrás', '↙ Atrás izq.', '← Izquierda', '↖ Diagonal izq.'];

const readStorage = (key) => {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
};
const writeStorage = (key, value) => {
  try { localStorage?.setItem(key, String(value)); } catch { /* sin almacenamiento */ }
};

export function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

export class Minimap {
  constructor() {
    this.visible = readStorage('bazuko.minimap_visible') !== 'false';
    const zoom = Number(readStorage(ZOOM_KEY));
    this.zoomBase = Number.isFinite(zoom) && zoom >= RADAR_ZOOM_MIN && zoom <= RADAR_ZOOM_MAX ? zoom : 70;
    this.range = this.zoomBase;
    const size = readStorage(SIZE_KEY);
    this.size = RADAR_SIZES.some(s => s.id === size) ? size : 'm';

    this.container = document.getElementById('minimap-container');
    if (!this.container && typeof document !== 'undefined') {
      this._createDOM();
    }

    this.canvas = document.getElementById('minimap-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this.infoEl = document.getElementById('minimap-info');
    this.container?.classList.toggle('hidden', !this.visible);
    this.raster = null;
    this.setSize(this.size, false);
    this._bindControls();

    this._lastUpdate = 0;
    this._cachedNearest = '';

    // game.js maneja las teclas N y +/− de forma centralizada
  }

  _createDOM() {
    const div = document.createElement('section');
    div.id = 'minimap-container';
    div.className = this.visible ? '' : 'hidden';
    div.setAttribute?.('aria-label', 'Radar');
    div.innerHTML = `
      <div class="radar__screen">
        <canvas id="minimap-canvas" width="440" height="330" aria-label="Radar con plano y ruta"></canvas>
        <div class="radar__tools">
          <button type="button" data-radar="in" title="Acercar (+)" aria-label="Acercar radar">+</button>
          <button type="button" data-radar="out" title="Alejar (−)" aria-label="Alejar radar">−</button>
          <button type="button" data-radar="toggle" title="Ocultar radar (N)" aria-label="Ocultar radar">✕</button>
        </div>
      </div>
      <div id="minimap-info" class="minimap-info">Cargando puntos…</div>
      <button type="button" class="radar__show" data-radar="toggle" title="Mostrar radar (N)">🧭 Radar · N</button>
    `;
    (document.getElementById('hud-dock') ?? document.body).appendChild(div);
    this.container = div;
  }

  _bindControls() {
    this.container?.addEventListener?.('click', (e) => {
      const action = e.target?.closest?.('[data-radar]')?.dataset.radar;
      if (action === 'in') this.zoomStep(1);
      else if (action === 'out') this.zoomStep(-1);
      else if (action === 'toggle') this.toggle();
      else return;
      e.target.blur?.();
    });
    // El lienzo sigue el tamaño CSS (tamaño elegido y pantalla) con la densidad de píxeles real.
    if (this.canvas && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(([entry]) => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const { width, height } = entry.contentRect;
        if (!width || !height) return;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this._lastUpdate = 0;
      }).observe(this.canvas);
    }
  }

  /** Tamaño del radar (y del ancho de la columna de necesidades): s, m o l. */
  setSize(size, save = true) {
    this.size = RADAR_SIZES.some(s => s.id === size) ? size : 'm';
    const dock = typeof document !== 'undefined' ? document.getElementById('hud-dock') : null;
    if (dock?.dataset) dock.dataset.radarSize = this.size;
    if (save) writeStorage(SIZE_KEY, this.size);
    return this.size;
  }

  /** Plano rasterizado de la ciudad (ver CityMapRaster). */
  setRaster(raster) { this.raster = raster; }

  toggle() {
    this.visible = !this.visible;
    const el = this.container || document.getElementById('minimap-container');
    if (el) {
      el.classList.toggle('hidden', !this.visible);
    }
    writeStorage('bazuko.minimap_visible', this.visible);
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: this.visible ? '🧭 Radar visible (N)' : '🧭 Radar oculto (N)', type: 'info' }
    }));
    return this.visible;
  }

  setZoomBase(value) {
    this.zoomBase = Math.max(RADAR_ZOOM_MIN, Math.min(RADAR_ZOOM_MAX, Math.round(value)));
    writeStorage(ZOOM_KEY, this.zoomBase);
    return this.zoomBase;
  }

  /** +1 acerca, −1 aleja. */
  zoomStep(direction) {
    const value = this.setZoomBase(this.zoomBase * (direction > 0 ? 1 / 1.2 : 1.2));
    window.dispatchEvent(new CustomEvent('toast', { detail: { text: `🧭 Radar: ${value} m`, type: 'info' } }));
    return value;
  }

  /**
   * Actualiza el radar
   * @param {Object} playerPos Vector { x, z }
   * @param {number} cameraYaw Ángulo yaw de la cámara (arriba en radar = al frente en pantalla)
   * @param {Array} pois Lista de { name, icon, x, z, color }
   * @param {number} now Timestamp de performance.now()
   * @param {{gps?: import('../systems/GpsNavigation.js').GpsNavigation, running?: boolean}} [opts]
   */
  update(playerPos, cameraYaw = 0, pois = [], now = performance.now(), { gps = null, running = false } = {}) {
    if (!this.visible || !this.ctx || !this.canvas || !playerPos) return;

    // Actualizar a ~20 FPS para eficiencia
    if (now - this._lastUpdate < 50) return;
    const dt = Math.min(.25, (now - this._lastUpdate) / 1000);
    this._lastUpdate = now;

    const target = this.zoomBase * (running ? RUN_ZOOM : 1);
    this.range += (target - this.range) * Math.min(1, dt * 2.5);

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const u = w / 220; // unidad de dibujo independiente de la densidad de píxeles
    const cx = w / 2;
    const cy = h * .6; // el jugador va algo abajo para ver más hacia el frente
    const scale = (h * .5) / this.range;
    const sin = Math.sin(cameraYaw), cos = Math.cos(cameraYaw);
    const pad = 9 * u;
    // Proyección relativa a la cámara: arriba es el frente de la vista.
    const project = (x, z) => {
      const dx = x - playerPos.x, dz = z - playerPos.z;
      return [cx + (dx * cos - dz * sin) * scale, cy + (dx * sin + dz * cos) * scale];
    };
    // Lleva un punto al borde del rectángulo siguiendo el rayo desde el jugador.
    const clamp = (px, py) => {
      const vx = px - cx, vy = py - cy;
      let t = 1;
      if (vx > 0) t = Math.min(t, (w - pad - cx) / vx); else if (vx < 0) t = Math.min(t, (pad - cx) / vx);
      if (vy > 0) t = Math.min(t, (h - pad - cy) / vy); else if (vy < 0) t = Math.min(t, (pad - cy) / vy);
      return [cx + vx * t, cy + vy * t, t < 1];
    };

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, 10 * u); else ctx.rect?.(0, 0, w, h);
    ctx.clip?.();
    ctx.fillStyle = '#101318';
    ctx.fillRect?.(0, 0, w, h);

    // Plano y ruta en coordenadas del mundo
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(cameraYaw);
    ctx.scale?.(scale, scale);
    ctx.translate(-playerPos.x, -playerPos.z);
    const r = this.raster;
    if (r) ctx.drawImage?.(r.canvas, r.originX, r.originZ, r.worldWidth, r.worldHeight);
    const route = gps?.waypoint ? gps.remainingRoute(playerPos) : [];
    if (route.length > 1) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const [color, width] of [['rgba(0,0,0,.65)', 7], ['#f6c400', 4]]) {
        ctx.beginPath();
        ctx.moveTo(route[0].x, route[0].z);
        for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].z);
        ctx.strokeStyle = color;
        ctx.lineWidth = width * u / scale;
        ctx.stroke();
      }
    }
    ctx.restore();

    // Viñeta para que los puntos del borde se lean sobre el plano
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeRect?.(u, u, w - 2 * u, h - 2 * u);

    // Norte en el borde, siempre visible
    const [nx, ny] = clamp(cx + sin * w * 4, cy - cos * w * 4);
    ctx.beginPath();
    ctx.arc(nx, ny, 7 * u, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,15,18,.9)';
    ctx.fill();
    ctx.fillStyle = '#f6c400';
    ctx.font = `900 ${9 * u}px Overpass, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + .5 * u);

    // Puntos de interés
    let nearestDist = Infinity;
    let nearestPoi = null;
    for (const poi of pois) {
      const dist = Math.hypot(poi.x - playerPos.x, poi.z - playerPos.z);
      if (dist < nearestDist) { nearestDist = dist; nearestPoi = poi; }
      const [px, py, clamped] = clamp(...project(poi.x, poi.z));
      ctx.beginPath();
      ctx.arc(px, py, (clamped ? 3.5 : 5) * u, 0, Math.PI * 2);
      ctx.fillStyle = poi.color || '#ffd166';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.2 * u;
      ctx.stroke();
      if (!clamped) {
        ctx.font = `${10 * u}px sans-serif`;
        ctx.fillText(poi.icon, px, py - 10 * u);
      }
    }

    // Destino del GPS: chincheta amarilla, anclada al borde si está lejos
    if (gps?.waypoint) {
      const [px, py] = clamp(...project(gps.waypoint.x, gps.waypoint.z));
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py - 9 * u, 6 * u, Math.PI * .8, Math.PI * .2);
      ctx.closePath();
      ctx.fillStyle = '#f6c400';
      ctx.fill();
      ctx.strokeStyle = '#0e0f12';
      ctx.lineWidth = 1.5 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py - 9 * u, 2.2 * u, 0, Math.PI * 2);
      ctx.fillStyle = '#0e0f12';
      ctx.fill();
    }

    // Jugador (flecha fija hacia arriba = vista de la cámara)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale?.(u, u);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0b4fa3';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Escala: alcance aproximado de la vista
    ctx.font = `800 ${8 * u}px Overpass, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(214,228,255,.7)';
    ctx.fillText(`${Math.round(this.range)} m`, 8 * u, h - 7 * u);

    if (this.infoEl) {
      const text = this._infoText(playerPos, cameraYaw, gps, nearestPoi, nearestDist);
      if (text !== this._cachedNearest) {
        this._cachedNearest = text;
        this.infoEl.textContent = text;
        this.infoEl.classList?.toggle('is-route', !!gps?.waypoint);
      }
    }
  }

  _infoText(playerPos, yaw, gps, nearestPoi, nearestDist) {
    const sector = (x, z) => {
      const dx = x - playerPos.x, dz = z - playerPos.z;
      const forward = -(dx * Math.sin(yaw) + dz * Math.cos(yaw));
      const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      return DIRECTIONS[(Math.round(Math.atan2(right, forward) / (Math.PI / 4)) + 8) % 8];
    };
    if (gps?.waypoint) {
      const { name, icon } = gps.waypoint;
      if (!gps.route.length) return `${icon} ${name}\nSin ruta a pie`;
      const ahead = gps.lookAhead(playerPos, 12);
      return `${icon} ${name}\n${formatDistance(gps.remainingDistance(playerPos))} ∙ ${sector(ahead.x, ahead.z)}`;
    }
    if (!nearestPoi) return 'Sin puntos cercanos';
    const hint = nearestDist < 2 ? '📍 Aquí' : sector(nearestPoi.x, nearestPoi.z);
    return `${nearestPoi.icon} ${nearestPoi.name}\n${Math.round(nearestDist)}m ∙ ${hint}`;
  }
}
