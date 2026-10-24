// src/ui/Minimap.js
// Radar y minimapa urbano para Bogotá: calles reales del distrito, ruta al destino marcado
// en el mapa completo (K) y nombre de la calle actual, al estilo del radar de GTA V.
import { drawPlayerArrow, drawWaypoint, ROUTE_COLOR } from './WorldMap.js';
import { streetNameAt } from './CityMap.js';

export class Minimap {
  constructor() {
    this.visible = true;
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem('bazuko.minimap_visible') : null;
      if (v !== null) this.visible = v === 'true';
    } catch { /* sin almacenamiento */ }

    this.container = document.getElementById('minimap-container');
    if (!this.container && typeof document !== 'undefined') {
      this._createDOM();
    }

    this.canvas = document.getElementById('minimap-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this.infoEl = document.getElementById('minimap-info');
    this.streetEl = document.getElementById('minimap-street');
    this.cityMap = null;
    this.canvas?.addEventListener?.('click', () => window.dispatchEvent(new CustomEvent('open-world-map')));
    this.container?.classList.toggle('hidden', !this.visible);

    this.radarRadius = 54; // radio del radar en píxeles
    this.radarRange = 60;  // metros representados en el radio

    this._lastUpdate = 0;
    this._cachedNearest = '';

    // game.js maneja la tecla KeyN de forma centralizada
  }

  _createDOM() {
    const div = document.createElement('div');
    div.id = 'minimap-container';
    div.className = this.visible ? '' : 'hidden';
    div.innerHTML = `
      <div class="minimap-header">
        <span class="minimap-title">🧭 Radar Bogotá</span>
        <button type="button" class="minimap-toggle-btn" id="minimap-toggle-btn" title="Alternar minimapa (N)">N</button>
      </div>
      <canvas id="minimap-canvas" width="130" height="130" aria-label="Minimapa y radar: clic para abrir el mapa (K)" title="Abrir mapa (K)"></canvas>
      <div id="minimap-street" class="minimap-street"></div>
      <div id="minimap-info" class="minimap-info">Cargando puntos…</div>
    `;
    document.body.appendChild(div);
    this.container = div;

    document.getElementById('minimap-toggle-btn')?.addEventListener('click', () => {
      this.toggle();
    });
  }

  /** Imagen de la ciudad (buildCityMap) para dibujar calles y manzanas bajo el radar. */
  setCityMap(cityMap) {
    this.cityMap = cityMap;
  }

  toggle() {
    this.visible = !this.visible;
    const el = this.container || document.getElementById('minimap-container');
    if (el) {
      el.classList.toggle('hidden', !this.visible);
    }
    try {
      localStorage?.setItem('bazuko.minimap_visible', String(this.visible));
    } catch { /* sin almacenamiento */ }
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: this.visible ? '🧭 Radar visible (N)' : '🧭 Radar oculto (N)', type: 'info' }
    }));
    return this.visible;
  }

  /**
   * Actualiza el radar
   * @param {Object} playerPos Vector { x, z }
   * @param {number} cameraYaw Ángulo yaw de la cámara (arriba en radar = al frente en pantalla)
   * @param {Array} pois Lista de { name, icon, x, z, color }
   * @param {number} now Timestamp de performance.now()
   * @param {{ route?: {x:number,z:number}[] | null, waypoint?: {x:number,z:number} | null,
   *   remaining?: number, heading?: number }} nav ruta y destino marcados en el mapa
   */
  update(playerPos, cameraYaw = 0, pois = [], now = performance.now(), nav = {}) {
    if (!this.visible || !this.ctx || !this.canvas || !playerPos) return;

    // Actualizar a ~20 FPS para eficiencia
    if (now - this._lastUpdate < 50) return;
    this._lastUpdate = now;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = this.radarRadius;

    ctx.clearRect(0, 0, w, h);

    // Fondo del radar
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 15, 20, 0.9)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3d564d';
    ctx.stroke();

    // Calles y manzanas reales, girando con la cámara (arriba = al frente en pantalla).
    const scale = r / this.radarRange;
    const map = this.cityMap;
    if (map) {
      ctx.save();
      ctx.clip();
      ctx.translate(cx, cy);
      ctx.rotate(cameraYaw);
      ctx.scale(scale, scale);
      ctx.translate(-playerPos.x, -playerPos.z);
      ctx.drawImage(map.canvas, map.bounds.x0, map.bounds.z0, map.canvas.width / map.scale, map.canvas.height / map.scale);
      if (nav.route?.length > 1) {
        ctx.beginPath();
        ctx.moveTo(playerPos.x, playerPos.z);
        for (let i = (nav.segment ?? 0) + 1; i < nav.route.length; i++) ctx.lineTo(nav.route[i].x, nav.route[i].z);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, .5)'; ctx.lineWidth = 5.5 / scale; ctx.stroke();
        ctx.strokeStyle = ROUTE_COLOR; ctx.lineWidth = 3.5 / scale; ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(10, 15, 20, 0.15)';
      ctx.fill();
    }

    // Círculos concéntricos de distancia (solo sin mapa de calles)
    if (!map) {
    ctx.strokeStyle = 'rgba(65, 95, 80, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    // Ejes de orientación
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.strokeStyle = 'rgba(65, 95, 80, 0.25)';
    ctx.stroke();
    }

    // Letras cardinales que rotan según la vista de la cámara
    // En Three.js, Norte es -Z. En vista de cámara: nForward = cos(yaw), nRight = sin(yaw)
    const angleN = Math.atan2(-Math.cos(cameraYaw), Math.sin(cameraYaw));
    const drawCardinal = (label, offset, color = '#7a9688', isNorth = false) => {
      const a = angleN + offset;
      const lx = cx + Math.cos(a) * (r - 8);
      const ly = cy + Math.sin(a) * (r - 8);
      ctx.fillStyle = isNorth ? '#eed688' : color;
      ctx.font = isNorth ? 'bold 10px monospace' : '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly);
    };

    drawCardinal('N', 0, '#eed688', true);
    drawCardinal('E', Math.PI / 2);
    drawCardinal('S', Math.PI);
    drawCardinal('O', -Math.PI / 2);

    // Puntos de interés (POIs) proyectados en vista de cámara
    let nearestDist = Infinity;
    let nearestPoi = null;
    let nearestForward = 0;
    let nearestRight = 0;

    for (const poi of pois) {
      const dx = poi.x - playerPos.x;
      const dz = poi.z - playerPos.z;
      const dist = Math.hypot(dx, dz);

      // Proyección relativa a la cámara:
      // Forward: distancia hacia donde apunta la cámara
      // Right: distancia hacia la derecha de la pantalla
      const forward = -(dx * Math.sin(cameraYaw) + dz * Math.cos(cameraYaw));
      const right = dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPoi = poi;
        nearestForward = forward;
        nearestRight = right;
      }

      // 1 metro en el mundo = (r / radarRange) píxeles en el radar
      let px = cx + right * scale;
      let py = cy - forward * scale;

      const offsetDist = Math.hypot(px - cx, py - cy);
      const isClamped = offsetDist > r - 7;

      if (isClamped) {
        const angle = Math.atan2(py - cy, px - cx);
        px = cx + Math.cos(angle) * (r - 8);
        py = cy + Math.sin(angle) * (r - 8);
      }

      // Dibujar punto de interés
      ctx.beginPath();
      ctx.arc(px, py, isClamped ? 3.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = poi.color || '#ffd166';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Icono / Emoji pequeño si está dentro del radar
      if (!isClamped) {
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(poi.icon, px, py - 9);
      }
    }

    // Destino marcado: dentro del radar o pegado al borde en su dirección, como en GTA.
    const waypoint = nav.waypoint;
    if (waypoint) {
      const dx = waypoint.x - playerPos.x, dz = waypoint.z - playerPos.z;
      let px = cx + (dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw)) * scale;
      let py = cy + (dx * Math.sin(cameraYaw) + dz * Math.cos(cameraYaw)) * scale;
      if (Math.hypot(px - cx, py - cy) > r - 6) {
        const angle = Math.atan2(py - cy, px - cx);
        px = cx + Math.cos(angle) * (r - 6);
        py = cy + Math.sin(angle) * (r - 6);
      }
      drawWaypoint(ctx, px, py + 6, .8);
    }

    // Jugador: flecha en el centro con su rumbo relativo a la cámara (arriba = al frente).
    if (Number.isFinite(nav.heading)) {
      drawPlayerArrow(ctx, cx, cy, nav.heading - cameraYaw, .9);
    } else {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(4, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fillStyle = '#2ecc71';
      ctx.fill();
      ctx.strokeStyle = '#0e3a1f';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // Actualiza la caja de información inferior con distancia y dirección relativa
    if (this.streetEl) {
      const street = map ? streetNameAt(playerPos.x, playerPos.z, map.bands) ?? '' : '';
      if (this.streetEl.textContent !== street) this.streetEl.textContent = street;
    }

    if (this.infoEl) {
      if (waypoint) {
        const dx = waypoint.x - playerPos.x, dz = waypoint.z - playerPos.z;
        const forward = -(dx * Math.sin(cameraYaw) + dz * Math.cos(cameraYaw));
        const right = dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw);
        const sector = (Math.round(Math.atan2(right, forward) / (Math.PI / 4)) + 8) % 8;
        const arrows = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
        const meters = Math.round(nav.remaining ?? Math.hypot(dx, dz));
        this._cachedNearest = `📍 ${waypoint.label ?? 'Destino'}: ${meters}m ${arrows[sector]}`;
      } else if (nearestPoi) {
        const sector = (Math.round(Math.atan2(nearestRight, nearestForward) / (Math.PI / 4)) + 8) % 8;
        const directions = ['⬆️ Al frente', '↗️ Diagonal der.', '➡️ Derecha', '↘️ Atrás der.',
          '⬇️ Atrás', '↙️ Atrás izq.', '⬅️ Izquierda', '↖️ Diagonal izq.'];
        const dirHint = nearestDist < 2 ? '📍 Aquí' : directions[sector];

        this._cachedNearest = `${nearestPoi.icon} ${nearestPoi.name}: ${Math.round(nearestDist)}m (${dirHint})`;
      } else {
        this._cachedNearest = 'Sin puntos cercanos';
      }
      this.infoEl.textContent = this._cachedNearest;
    }
  }
}
