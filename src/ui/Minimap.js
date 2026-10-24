// src/ui/Minimap.js
// Radar y minimapa urbano para Bogotá con tamaños dinámicos, mapa completo y waypoints

export class Minimap {
  constructor() {
    this.visible = true;
    this.sizeMode = 'normal'; // 'normal' (130px) o 'large' (220px)
    this.cityMapOpen = false;
    this.waypoint = null;     // { x, z, name, icon }

    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem('bazuko.minimap_visible') : null;
      if (v !== null) this.visible = v === 'true';
      const s = typeof localStorage !== 'undefined' ? localStorage.getItem('bazuko.minimap_size') : null;
      if (s === 'large') this.sizeMode = 'large';
    } catch { /* sin almacenamiento */ }

    this.container = document.getElementById('minimap-container');
    if (!this.container && typeof document !== 'undefined') {
      this._createDOM();
    }

    this.canvas = document.getElementById('minimap-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this.infoEl = document.getElementById('minimap-info');
    this.container?.classList.toggle('hidden', !this.visible);

    this._applySizeConfig();

    this._lastUpdate = 0;
    this._cachedNearest = '';
    this._lastPlayerPos = { x: 0, z: 0 };
    this._lastCameraYaw = 0;
    this._lastPois = [];
  }

  _applySizeConfig() {
    if (this.sizeMode === 'large') {
      this.radarRadius = 92;
      this.radarRange = 135;
      if (this.canvas) {
        this.canvas.width = 220;
        this.canvas.height = 220;
      }
      this.container?.classList?.add?.('large');
    } else {
      this.radarRadius = 54;
      this.radarRange = 85;
      if (this.canvas) {
        this.canvas.width = 130;
        this.canvas.height = 130;
      }
      this.container?.classList?.remove?.('large');
    }
  }

  _createDOM() {
    const div = document.createElement('div');
    div.id = 'minimap-container';
    div.className = this.visible ? '' : 'hidden';
    div.innerHTML = `
      <div class="minimap-header">
        <span class="minimap-title">🧭 Radar</span>
        <div class="minimap-actions">
          <button type="button" class="minimap-btn" id="minimap-map-btn" title="Abrir mapa de Bogotá (M)">🗺️</button>
          <button type="button" class="minimap-btn" id="minimap-size-btn" title="Cambiar tamaño radar (N)">⤢</button>
          <button type="button" class="minimap-btn" id="minimap-toggle-btn" title="Ocultar radar">✕</button>
        </div>
      </div>
      <canvas id="minimap-canvas" width="130" height="130" aria-label="Minimapa y radar"></canvas>
      <div id="minimap-info" class="minimap-info">Cargando puntos…</div>
    `;
    document.body.appendChild(div);
    this.container = div;

    document.getElementById('minimap-toggle-btn')?.addEventListener('click', () => {
      this.toggle();
    });

    document.getElementById('minimap-size-btn')?.addEventListener('click', () => {
      this.toggleSize();
    });

    document.getElementById('minimap-map-btn')?.addEventListener('click', () => {
      this.toggleCityMap();
    });
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

  toggleSize() {
    this.sizeMode = this.sizeMode === 'normal' ? 'large' : 'normal';
    this._applySizeConfig();
    try {
      localStorage?.setItem('bazuko.minimap_size', this.sizeMode);
    } catch { /* sin almacenamiento */ }
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: this.sizeMode === 'large' ? '🧭 Radar: Modo Grande (220px)' : '🧭 Radar: Modo Normal (130px)', type: 'info' }
    }));
  }

  setWaypoint(x, z, name = 'Destino', icon = '📍') {
    this.waypoint = { x, z, name, icon };
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: `🎯 Destino fijado: ${name}`, type: 'info' }
    }));
    if (this.cityMapOpen) this._renderCityMap();
  }

  clearWaypoint() {
    this.waypoint = null;
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: '✕ Destino eliminado', type: 'info' }
    }));
    if (this.cityMapOpen) this._renderCityMap();
  }

  toggleCityMap(district = null) {
    this.cityMapOpen = !this.cityMapOpen;
    let modal = document.getElementById('city-map-modal');
    if (!modal && typeof document !== 'undefined') {
      modal = document.createElement('div');
      modal.id = 'city-map-modal';
      modal.className = 'hidden';
      modal.innerHTML = `
        <div class="city-map-card">
          <div class="city-map-header">
            <span class="city-map-title">🗺️ Mapa de Bogotá</span>
            <button type="button" class="city-map-close" id="city-map-close-btn">✕ Cerrar (M)</button>
          </div>
          <canvas id="city-map-canvas" width="460" height="460"></canvas>
          <div class="city-map-hint">Haz clic en cualquier punto del mapa para fijar un destino (Waypoint).</div>
          <div class="city-map-footer" id="city-map-quick-destinations"></div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('city-map-close-btn')?.addEventListener('click', () => {
        this.closeCityMap();
      });

      const mapCanvas = document.getElementById('city-map-canvas');
      mapCanvas?.addEventListener('click', (e) => {
        const rect = mapCanvas.getBoundingClientRect();
        const scaleX = mapCanvas.width / rect.width;
        const scaleY = mapCanvas.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        // Convertir coordenadas del canvas (460x460) a metros del mundo (240x322m)
        const worldX = (clickX / mapCanvas.width) * 240;
        const worldZ = (clickY / mapCanvas.height) * 322;
        this.setWaypoint(worldX, worldZ, 'Punto marcado', '📍');
      });
    }

    if (modal) {
      modal.classList.toggle('hidden', !this.cityMapOpen);
      if (this.cityMapOpen) {
        this._populateQuickDestinations();
        this._renderCityMap(district);
      }
    }
    return this.cityMapOpen;
  }

  closeCityMap() {
    this.cityMapOpen = false;
    const modal = document.getElementById('city-map-modal');
    if (modal) modal.classList.add('hidden');
  }

  _populateQuickDestinations() {
    const container = document.getElementById('city-map-quick-destinations');
    if (!container) return;

    const quick = [
      { name: 'Cambuche', icon: '⛺', x: 30, z: 68 },
      { name: 'Fritanga La Mona', icon: '🥟', x: 56, z: 58 },
      { name: 'Fogatas El Cartucho', icon: '🔥', x: 26, z: 38 },
      { name: 'Recicladora', icon: '♻️', x: 88, z: 32 },
      { name: 'Tienda La Esquinita', icon: '🏪', x: 68, z: 58 },
      { name: 'Torre Colpatria', icon: '🏙️', x: 81, z: 154 }
    ];

    container.innerHTML = quick.map(q => `
      <button type="button" class="city-map-quick-btn" data-x="${q.x}" data-z="${q.z}" data-name="${q.name}" data-icon="${q.icon}">
        ${q.icon} ${q.name}
      </button>
    `).join('') + (this.waypoint ? '<button type="button" class="city-map-quick-btn" id="city-map-clear-btn" style="color:#ff8888;">✕ Borrar destino</button>' : '');

    container.querySelectorAll('.city-map-quick-btn[data-x]').forEach(btn => {
      btn.addEventListener('click', () => {
        const x = parseFloat(btn.dataset.x);
        const z = parseFloat(btn.dataset.z);
        this.setWaypoint(x, z, btn.dataset.name, btn.dataset.icon);
      });
    });

    document.getElementById('city-map-clear-btn')?.addEventListener('click', () => {
      this.clearWaypoint();
      this._populateQuickDestinations();
    });
  }

  _renderCityMap(district = null) {
    const canvas = document.getElementById('city-map-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Fondo ciudad
    ctx.fillStyle = '#12191d';
    ctx.fillRect(0, 0, w, h);

    // Cuadrícula y vías principales
    const scaleX = w / 240;
    const scaleZ = h / 322;

    // Calles horizontales (Calles 10, 9, 8, 7)
    ctx.fillStyle = '#2c3940';
    for (const z of [24, 60, 144, 188]) {
      ctx.fillRect(0, z * scaleZ, w, 12 * scaleZ);
    }
    // Carreras verticales (Caracas, 15, 10, 8, 6)
    for (const x of [12, 48, 80, 168, 212]) {
      ctx.fillRect(x * scaleX, 0, 12 * scaleX, h);
    }

    // Troncal Caracas (carril exclusivo TransMilenio)
    ctx.fillStyle = 'rgba(192, 41, 43, 0.4)';
    ctx.fillRect(48 * scaleX, 0, 8 * scaleX, h);

    // Parques
    ctx.fillStyle = '#1b3b28';
    ctx.fillRect(184 * scaleX, 42 * scaleZ, 22 * scaleX, 26 * scaleZ);
    ctx.fillRect(138 * scaleX, 160 * scaleZ, 24 * scaleX, 22 * scaleZ);

    // El Cartucho
    ctx.fillStyle = '#2f231a';
    ctx.fillRect(20 * scaleX, 36 * scaleZ, 20 * scaleX, 20 * scaleZ);

    // Puntos de interés
    for (const poi of this._lastPois) {
      const px = poi.x * scaleX;
      const pz = poi.z * scaleZ;
      ctx.beginPath();
      ctx.arc(px, pz, 4, 0, Math.PI * 2);
      ctx.fillStyle = poi.color || '#ffd166';
      ctx.fill();
      ctx.font = '10px sans-serif';
      ctx.fillText(poi.icon, px - 6, pz - 6);
    }

    // Waypoint seleccionado
    if (this.waypoint) {
      const wx = this.waypoint.x * scaleX;
      const wz = this.waypoint.z * scaleZ;
      ctx.beginPath();
      ctx.arc(wx, wz, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(241, 196, 15, 0.3)';
      ctx.fill();
      ctx.font = '14px sans-serif';
      ctx.fillText('🎯', wx - 7, wz + 5);

      // Línea punteada desde el jugador hacia el destino
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(this._lastPlayerPos.x * scaleX, this._lastPlayerPos.z * scaleZ);
      ctx.lineTo(wx, wz);
      ctx.strokeStyle = 'rgba(241, 196, 15, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Jugador
    const jx = this._lastPlayerPos.x * scaleX;
    const jz = this._lastPlayerPos.z * scaleZ;
    ctx.beginPath();
    ctx.arc(jx, jz, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#2ecc71';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Flecha de orientación del jugador
    ctx.beginPath();
    ctx.moveTo(jx, jz);
    ctx.lineTo(
      jx - Math.sin(this._lastCameraYaw) * 12,
      jz - Math.cos(this._lastCameraYaw) * 12
    );
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * Actualiza el radar
   * @param {Object} playerPos Vector { x, z }
   * @param {number} cameraYaw Ángulo yaw de la cámara (arriba en radar = al frente en pantalla)
   * @param {Array} pois Lista de { name, icon, x, z, color }
   * @param {number} now Timestamp de performance.now()
   */
  update(playerPos, cameraYaw = 0, pois = [], now = performance.now()) {
    if (!playerPos) return;
    this._lastPlayerPos = playerPos;
    this._lastCameraYaw = cameraYaw;
    this._lastPois = pois;

    if (this.cityMapOpen && (now - this._lastUpdate > 150)) {
      this._renderCityMap();
    }

    if (!this.visible || !this.ctx || !this.canvas) return;

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

    // Círculos concéntricos de distancia
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

    // Letras cardinales que rotan según la vista de la cámara
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

    // Lista de puntos incluyendo waypoint si existe
    const allPois = [...pois];
    if (this.waypoint) {
      allPois.unshift({
        name: this.waypoint.name,
        icon: '🎯',
        x: this.waypoint.x,
        z: this.waypoint.z,
        color: '#f1c40f',
        isWaypoint: true
      });
    }

    let nearestDist = Infinity;
    let nearestPoi = null;
    let nearestForward = 0;
    let nearestRight = 0;

    for (const poi of allPois) {
      const dx = poi.x - playerPos.x;
      const dz = poi.z - playerPos.z;
      const dist = Math.hypot(dx, dz);

      const forward = -(dx * Math.sin(cameraYaw) + dz * Math.cos(cameraYaw));
      const right = dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw);

      if (poi.isWaypoint) {
        nearestDist = dist;
        nearestPoi = poi;
        nearestForward = forward;
        nearestRight = right;

        // Auto-llegada al destino (< 4 metros)
        if (dist < 4.0) {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: `🎉 ¡Llegaste a tu destino: ${poi.name}!`, type: 'rare' }
          }));
          this.waypoint = null;
        }
      } else if (!this.waypoint && dist < nearestDist) {
        nearestDist = dist;
        nearestPoi = poi;
        nearestForward = forward;
        nearestRight = right;
      }

      // Proyección a pantalla radar
      const scale = r / this.radarRange;
      let px = cx + right * scale;
      let py = cy - forward * scale;

      const offsetDist = Math.hypot(px - cx, py - cy);
      const isClamped = offsetDist > r - 7;

      if (isClamped) {
        const angle = Math.atan2(py - cy, px - cx);
        px = cx + Math.cos(angle) * (r - 8);
        py = cy + Math.sin(angle) * (r - 8);
      }

      ctx.beginPath();
      ctx.arc(px, py, poi.isWaypoint ? (isClamped ? 4.5 : 6) : (isClamped ? 3.5 : 4.5), 0, Math.PI * 2);
      ctx.fillStyle = poi.color || '#ffd166';
      ctx.fill();
      ctx.strokeStyle = poi.isWaypoint ? '#fff' : '#000';
      ctx.lineWidth = poi.isWaypoint ? 1.5 : 1;
      ctx.stroke();

      if (!isClamped) {
        ctx.font = poi.isWaypoint ? 'bold 12px sans-serif' : '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(poi.icon, px, py - 9);
      }
    }

    // Jugador (flecha apuntando hacia arriba = frente de la cámara)
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

    ctx.restore();

    // Actualiza la caja de información inferior
    if (this.infoEl) {
      if (nearestPoi) {
        const sector = (Math.round(Math.atan2(nearestRight, nearestForward) / (Math.PI / 4)) + 8) % 8;
        const directions = ['⬆️ Al frente', '↗️ Diagonal der.', '➡️ Derecha', '↘️ Atrás der.',
          '⬇️ Atrás', '↙️ Atrás izq.', '⬅️ Izquierda', '↖️ Diagonal izq.'];
        const dirHint = nearestDist < 2 ? '📍 Aquí' : directions[sector];

        if (nearestPoi.isWaypoint) {
          this._cachedNearest = `🎯 ${nearestPoi.name}: ${Math.round(nearestDist)}m (${dirHint})`;
        } else {
          this._cachedNearest = `${nearestPoi.icon} ${nearestPoi.name}: ${Math.round(nearestDist)}m (${dirHint})`;
        }
      } else {
        this._cachedNearest = 'Sin puntos cercanos';
      }
      this.infoEl.textContent = this._cachedNearest;
    }
  }
}
