// src/ui/Minimap.js
// El radar: plano horneado una vez, signos que no se reacomodan por cuadro, ruta gruesa con halo y destino encima.
// Arriba de él, en la misma pieza, el destino en una línea: flecha, nombre y distancia.
import { masCercanoQueVende, ordenDeSugerencia, suggestPlace, suggestionText } from './mapServices.js';
import { LETRA } from './letra.js';
import { metros } from './formato.js';
import { pasarTexto, dibujo } from './pictos.js';
import { iconChar } from './icons.js';
import { modoEntrada, teclaVisible } from '../core/modoEntrada.js';
import { CARTON, CARTON_MOJADO, CINTA, MARCADOR, ROJO, flechaJugador, hornearPlano, rutaRoja, xRoja } from './planoRadar.js';

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
// Lo que se lee en el cartón; lo que queda para lector de pantalla y para buscar sigue con su nombre de siempre.
const NOMBRE_A_LA_VISTA = { Dealer: 'El jíbaro', Crafteo: 'La mesa' };
export const nombreALaVista = (nombre) => NOMBRE_A_LA_VISTA[nombre] ?? nombre;

const readStorage = (key) => {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
};
const writeStorage = (key, value) => {
  try { localStorage?.setItem(key, String(value)); } catch { /* sin almacenamiento */ }
};

export function formatDistance(m) {
  return metrosALaVista(m);
}

/** La distancia como se lee en el cartón: 109 m, 1,2 km. */
export const metrosALaVista = metros;

const PRIMERO = 1e12;
const llaveDe = (poi) => poi.x * 4099 + poi.z;

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
    this.flechaEl = this.container?.querySelector?.('.radar__flecha') ?? null;
    this.nombreEl = this.container?.querySelector?.('.radar__nombre') ?? null;
    this.metrosEl = this.container?.querySelector?.('.radar__metros') ?? null;
    this.ordenEl = this.container?.querySelector?.('.radar__orden') ?? null;
    this.container?.classList.toggle('hidden', !this.visible);
    this.raster = null;
    this.plano = null;
    this.setSize(this.size, false);
    this._bindControls();

    this._lastUpdate = 0;
    this._cachedNearest = '';
    this._letra = false;
    this._puestos = [];
    this._escritos = new Set();
    this._escritosAhora = new Set();
    this._cerca = [];
    this._hayTrazo = false;

    // game.js maneja las teclas N y +/− de forma centralizada
  }

  _createDOM() {
    const div = document.createElement('section');
    div.id = 'minimap-container';
    div.className = this.visible ? '' : 'hidden';
    div.setAttribute?.('aria-label', 'Radar');
    div.innerHTML = `
      <div class="radar__destino" aria-hidden="true">
        <span class="radar__flecha"></span><span class="radar__nombre"></span><span class="radar__metros"></span><span class="radar__orden"></span>
      </div>
      <div id="minimap-info" class="minimap-info solo-lector" aria-label="Orientación y destino">Cargando puntos…</div>
      <div class="radar__screen">
        <div class="radar__papel">
          <canvas id="minimap-canvas" width="440" height="330" aria-label="Radar con plano y ruta"></canvas>
        </div>
        <button type="button" class="radar__abrir" aria-label="Herramientas del radar" aria-expanded="false" title="Herramientas del radar"></button>
        <div class="radar__tools">
          <button type="button" class="cinta" data-radar="in" title="Acercar (+)" aria-label="Acercar radar">+</button>
          <button type="button" class="cinta" data-radar="out" title="Alejar (−)" aria-label="Alejar radar">−</button>
          <button type="button" class="cinta" data-radar="toggle" title="Ocultar radar (N)" aria-label="Ocultar radar"><span class="picto" aria-hidden="true" data-dibujo="${iconChar('x')}"></span></button>
        </div>
      </div>
      <button type="button" class="radar__show cinta" data-radar="toggle" title="Mostrar radar (N)">Radar <kbd>N</kbd></button>
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
      else if (e.target?.closest?.('.radar__abrir')) { this._abrirHerramientas(); return; }
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

  /** En celular las herramientas se abren al tocar el radar. */
  _abrirHerramientas() {
    const abierto = this.container.classList.toggle('abierto');
    this.container.querySelector('.radar__abrir')?.setAttribute('aria-expanded', String(abierto));
  }

  /** Tamaño del radar: s, m o l. Cambia su alto; el ancho de la pieza es el de las necesidades. */
  setSize(size, save = true) {
    this.size = RADAR_SIZES.some(s => s.id === size) ? size : 'm';
    const dock = typeof document !== 'undefined' ? document.getElementById('hud-dock') : null;
    if (dock?.dataset) dock.dataset.radarSize = this.size;
    if (save) writeStorage(SIZE_KEY, this.size);
    return this.size;
  }

  /** El plano se hornea una sola vez, aquí, a partir de los tiles que trae el raster de la ciudad. */
  setRaster(raster) {
    this.raster = raster;
    this.plano = hornearPlano(raster?.tiles?.());
  }

  toggle() {
    this.visible = !this.visible;
    const el = this.container || document.getElementById('minimap-container');
    if (el) {
      el.classList.toggle('hidden', !this.visible);
    }
    writeStorage('bazuko.minimap_visible', this.visible);
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: this.visible ? 'Radar visible (N)' : 'Radar oculto (N)', type: 'info' }
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
    window.dispatchEvent(new CustomEvent('toast', { detail: { text: `Radar: ${value} m`, type: 'info' } }));
    return value;
  }

  /** Nada se escribe con la letra antes de tenerla: saldrían cuadritos. Sin fuentes del navegador no hay que esperar. */
  _letraLista() {
    if (this._letra) return true;
    const fuentes = globalThis.document?.fonts;
    this._letra = !fuentes?.check || (fuentes.check(`400 16px ${LETRA}`) && fuentes.check(`800 16px ${LETRA}`));
    return this._letra;
  }

  /**
   * Actualiza el radar
   * @param {Object} playerPos Vector { x, z }
   * @param {number} cameraYaw Ángulo yaw de la cámara (arriba en radar = al frente en pantalla)
   * @param {Array} pois Lista de { name, icon, x, z, color, service?, prices? }
   * @param {number} now Timestamp de performance.now()
   * @param {{gps?: import('../systems/GpsNavigation.js').GpsNavigation, running?: boolean, needs?: Object}} [opts] `needs` viene de needContext (mapServices.js)
   */
  update(playerPos, cameraYaw = 0, pois = [], now = performance.now(), { gps = null, running = false, needs = null } = {}) {
    if (!this.visible || !this.ctx || !this.canvas || !playerPos) return;

    // Actualizar a ~20 FPS para eficiencia
    if (now - this._lastUpdate < 50) return;
    const dt = Math.min(.25, (now - this._lastUpdate) / 1000);
    this._lastUpdate = now;

    const suggestion = !gps?.waypoint && needs?.need ? suggestPlace(pois, playerPos, needs) : null;
    const suggested = suggestion?.poi ?? null;

    const target = this.zoomBase * (running ? RUN_ZOOM : 1);
    this.range += (target - this.range) * Math.min(1, dt * 2.5);

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h * .6; // el jugador va algo abajo para ver más hacia el frente
    const scale = (h * .5) / this.range;
    const sin = Math.sin(cameraYaw), cos = Math.cos(cameraYaw);
    const pad = 11 * dpr;
    const px = playerPos.x, pz = playerPos.z;
    // Proyección relativa a la cámara: arriba es el frente de la vista.
    const projectX = (x, z) => cx + ((x - px) * cos - (z - pz) * sin) * scale;
    const projectY = (x, z) => cy + ((x - px) * sin + (z - pz) * cos) * scale;
    // Lleva un punto al borde del rectángulo siguiendo el rayo desde el jugador.
    const clamp = (qx, qy) => {
      const vx = qx - cx, vy = qy - cy;
      let t = 1;
      if (vx > 0) t = Math.min(t, (w - pad - cx) / vx); else if (vx < 0) t = Math.min(t, (pad - cx) / vx);
      if (vy > 0) t = Math.min(t, (h - pad - cy) / vy); else if (vy < 0) t = Math.min(t, (pad - cy) / vy);
      return [cx + vx * t, cy + vy * t, t < 1];
    };
    const cara = globalThis.document?.body?.classList?.contains?.('mojado') ? CARTON_MOJADO : CARTON;

    // El cartón y, encima, el plano y la ruta en coordenadas del mundo. Fuera de la ciudad queda el cartón.
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cara;
    ctx.fillRect?.(0, 0, w, h);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(cameraYaw);
    ctx.scale?.(scale, scale);
    ctx.translate(-px, -pz);
    const plano = this.plano;
    if (plano) ctx.drawImage?.(plano.canvas, plano.originX, plano.originZ, plano.worldWidth, plano.worldHeight);
    const route = gps?.waypoint ? gps.remainingRoute(playerPos) : [];
    rutaRoja(ctx, route, scale / dpr);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const letra = this._letraLista();
    const [nx, ny] = clamp(projectX(px, pz - 100000), projectY(px, pz - 100000));
    const destino = gps?.waypoint ? clamp(projectX(gps.waypoint.x, gps.waypoint.z), projectY(gps.waypoint.x, gps.waypoint.z)) : null;

    // Lo que no se tapa nunca reserva su sitio antes de escribir los dibujos.
    const size = 17 * dpr;
    const puestos = this._puestos;
    puestos.length = 0;
    puestos.push(nx, ny);
    if (destino) puestos.push(destino[0], destino[1]);
    let sugeridoX = 0, sugeridoY = 0;
    if (suggested) {
      [sugeridoX, sugeridoY] = clamp(projectX(suggested.x, suggested.z), projectY(suggested.x, suggested.z));
      puestos.push(sugeridoX, sugeridoY);
    }

    // Dibujos del mundo: los de más cerca primero; si dos se pisan, se escribe solo uno. El que ya estaba escrito conserva
    // su sitio, para que al girar no se turnen dos dibujos vecinos.
    let nearestDist = Infinity;
    let nearestPoi = null;
    const cerca = this._cerca;
    cerca.length = 0;
    const lejos = (this.range * 1.9) ** 2;
    const escritos = this._escritos, ahora = this._escritosAhora;
    ahora.clear();
    for (const poi of pois) {
      const d2 = (poi.x - px) ** 2 + (poi.z - pz) ** 2;
      // En un empate gana el último: los lugares fijos van después de puestos y fogatas.
      if (d2 <= nearestDist) { nearestDist = d2; nearestPoi = poi; }
      if (poi !== suggested && d2 < lejos) cerca.push([poi, escritos.has(llaveDe(poi)) ? d2 - PRIMERO : d2]);
    }
    nearestDist = Math.sqrt(nearestDist);
    if (letra) {
      cerca.sort((a, b) => a[1] - b[1]);
      ctx.font = `400 ${size}px ${LETRA}`;
      ctx.strokeStyle = cara;
      ctx.fillStyle = MARCADOR;
      ctx.lineWidth = 5 * dpr;
      const junto = size * 1.15;
      for (const [poi] of cerca) {
        const x0 = projectX(poi.x, poi.z), y0 = projectY(poi.x, poi.z);
        if (x0 < pad || x0 > w - pad || y0 < pad || y0 > h - pad) continue;
        let pisa = false;
        for (let i = 0; i < puestos.length && !pisa; i += 2) {
          // Por distancia, no por caja: entre dos lugares no cambia al girar, y así no se turnan.
          const lejosDe = i === 0 ? junto * 1.35 : junto; // la N siempre queda limpia
          pisa = (puestos[i] - x0) ** 2 + (puestos[i + 1] - y0) ** 2 < lejosDe * lejosDe;
        }
        if (pisa) continue;
        puestos.push(x0, y0);
        ahora.add(llaveDe(poi));
        const signo = pasarTexto(poi.icon);
        ctx.strokeText(signo, x0, y0);
        ctx.fillText(signo, x0, y0);
      }
    }

    this._escritos = ahora;
    this._escritosAhora = escritos;

    // Los lugares fijos que quedan lejos no se escriben: un trazo corto en el borde dice hacia dónde quedan.
    // Se pinta en una sola pasada, sin letra y sin reacomodar nada: al girar, cada trazo corre por el borde.
    this._hayTrazo = false;
    for (const poi of pois) {
      if (!poi.fijo || poi === suggested || ahora.has(llaveDe(poi))) continue;
      if (gps?.waypoint && gps.waypoint.x === poi.x && gps.waypoint.z === poi.z) continue;
      const [ax, ay, afuera] = clamp(projectX(poi.x, poi.z), projectY(poi.x, poi.z));
      if (!afuera) continue;
      const vx = ax - cx, vy = ay - cy, largo = Math.hypot(vx, vy) || 1;
      const ux = vx / largo * 4.5 * dpr, uy = vy / largo * 4.5 * dpr;
      if (!this._hayTrazo) { this._hayTrazo = true; ctx.beginPath(); }
      ctx.moveTo(ax - ux, ay - uy);
      ctx.lineTo(ax + ux, ay + uy);
    }
    if (this._hayTrazo) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = cara;
      ctx.lineWidth = 7 * dpr;
      ctx.stroke();
      ctx.strokeStyle = MARCADOR;
      ctx.lineWidth = 3.4 * dpr;
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // Patrullas en persecución: punto rojo con su T, pegado al borde hacia donde quedan si están lejos.
    for (const vehicle of globalThis.window?.__game?.traffic?.vehicles ?? []) {
      if (!vehicle.police || vehicle.state !== 'chase') continue;
      const { x, z } = vehicle.car.position;
      const [ax, ay] = clamp(projectX(x, z), projectY(x, z));
      ctx.beginPath();
      ctx.arc(ax, ay, 8 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = ROJO;
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = CINTA;
      ctx.stroke();
      if (letra) {
        ctx.font = `800 ${13 * dpr}px ${LETRA}`;
        ctx.fillStyle = CINTA;
        ctx.fillText('T', ax, ay + .5 * dpr);
      }
    }

    // El norte en el borde, siempre visible.
    if (letra) {
      ctx.font = `800 ${13 * dpr}px ${LETRA}`;
      ctx.strokeStyle = cara;
      ctx.lineWidth = 4 * dpr;
      ctx.strokeText('N', nx, ny);
      ctx.fillStyle = MARCADOR;
      ctx.fillText('N', nx, ny);
    }

    // Lugar sugerido: aro rojo con su dibujo, encima de los demás y anclado al borde si está lejos.
    if (suggested) {
      ctx.beginPath();
      ctx.arc(sugeridoX, sugeridoY, 11 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = cara;
      ctx.fill();
      ctx.strokeStyle = ROJO;
      ctx.lineWidth = 2.6 * dpr;
      ctx.stroke();
      if (letra) {
        ctx.font = `400 ${15 * dpr}px ${LETRA}`;
        ctx.fillStyle = MARCADOR;
        ctx.fillText(pasarTexto(suggested.icon), sugeridoX, sugeridoY);
      }
    }

    // Destino del GPS: si no cabe, se queda en el borde mirando hacia allá.
    if (destino) xRoja(ctx, destino[0], destino[1], 6.8 * dpr);
    flechaJugador(ctx, cx, cy, 9 * dpr);

    if (this.infoEl) {
      const text = this._infoText(playerPos, cameraYaw, gps, nearestPoi, nearestDist, suggestion);
      if (text !== this._cachedNearest) {
        this._cachedNearest = text;
        this.infoEl.textContent = text;
        this.infoEl.classList?.toggle('is-route', !!gps?.waypoint);
        this.infoEl.classList?.toggle('is-need', !!suggestion);
      }
    }
    this._pintarDestino(playerPos, cameraYaw, gps, nearestPoi, nearestDist, suggestion, pois);
  }

  _sector(playerPos, yaw, x, z) {
    const dx = x - playerPos.x, dz = z - playerPos.z;
    const forward = -(dx * Math.sin(yaw) + dz * Math.cos(yaw));
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    return DIRECTIONS[(Math.round(Math.atan2(right, forward) / (Math.PI / 4)) + 8) % 8];
  }

  _infoText(playerPos, yaw, gps, nearestPoi, nearestDist, suggestion = null) {
    const sector = (x, z) => this._sector(playerPos, yaw, x, z);
    if (gps?.waypoint) {
      const { name, icon } = gps.waypoint;
      if (!gps.route.length) return `${icon} ${name}\nSin ruta a pie`;
      const ahead = gps.lookAhead(playerPos, 12);
      return `${icon} ${name}\n${formatDistance(gps.remainingDistance(playerPos))}, ${sector(ahead.x, ahead.z)}`;
    }
    if (suggestion?.poi) {
      const hint = suggestion.dist < 2 ? '📍 Aquí' : sector(suggestion.poi.x, suggestion.poi.z);
      return suggestionText(suggestion, this.size === 's' ? hint.split(' ')[0] : hint, formatDistance(suggestion.dist));
    }
    if (suggestion) return suggestionText(suggestion);
    if (!nearestPoi) return 'Sin puntos cercanos';
    // Sin destino no se dice a dónde ir: el lugar más cercano es solo una referencia, sin rumbo.
    return `Cerca: ${nearestPoi.name}\n${formatDistance(nearestDist)}`;
  }

  /** Lo que se lee en el cartón: flecha, nombre y distancia. Cada celda se escribe solo cuando cambia. */
  _pintarDestino(playerPos, yaw, gps, nearestPoi, nearestDist, suggestion, pois = []) {
    if (!this.nombreEl) return;
    let flecha = '', nombre = '', metros = '';
    const haciaLugar = (poi, dist) => {
      flecha = dist < 2 ? dibujo('bandera') : this._sector(playerPos, yaw, poi.x, poi.z).split(' ')[0];
      nombre = poi.name;
      metros = metrosALaVista(dist);
    };
    if (gps?.waypoint) {
      nombre = gps.waypoint.name;
      if (gps.route.length) {
        const ahead = gps.lookAhead(playerPos, 12);
        flecha = this._sector(playerPos, yaw, ahead.x, ahead.z).split(' ')[0];
        metros = metrosALaVista(gps.remainingDistance(playerPos));
      } else {
        flecha = pasarTexto(gps.waypoint.icon);
        metros = 'sin ruta';
      }
    } else if (suggestion?.poi) haciaLugar(suggestion.poi, suggestion.dist);
    else if (suggestion) {
      // Sin plata o sin espacio no se puede resolver aquí, pero la flecha sigue diciendo dónde queda lo que hace falta.
      const dondeVenden = suggestion.carried ? null : masCercanoQueVende(pois, playerPos, suggestion.tag);
      if (dondeVenden) haciaLugar(dondeVenden.poi, dondeVenden.dist);
      else {
        // Lo lleva en el costal: no hay a dónde ir, y su dibujo va en el sitio de la flecha.
        const primera = suggestionText(suggestion).split('\n')[0];
        const [signo, ...resto] = pasarTexto(primera).split(' ');
        flecha = signo;
        nombre = resto.join(' ');
      }
    } else if (nearestPoi) {
      // Sin destino no hay flecha ni promesa: el lugar más cercano es solo una referencia.
      nombre = `Cerca: ${nombreALaVista(nearestPoi.name)}`;
      metros = metrosALaVista(nearestDist);
    }
    nombre = NOMBRE_A_LA_VISTA[nombre] ?? nombre;
    this._pintarOrden(suggestion);
    if (this._flechaVista !== flecha) { this._flechaVista = flecha; this.flechaEl.textContent = flecha; }
    if (this._nombreVisto !== nombre) { this._nombreVisto = nombre; this.nombreEl.textContent = nombre; }
    if (this._metrosVistos !== metros) { this._metrosVistos = metros; this.metrosEl.textContent = metros; }
  }

  /** La segunda línea del destino: el precio y qué hacer. La tecla es un dibujo de tecla, y con el dedo no existe. */
  _pintarOrden(suggestion) {
    if (!this.ordenEl) return;
    const orden = ordenDeSugerencia(suggestion);
    const modo = modoEntrada();
    const clave = orden ? `${orden.precio}|${orden.hacer}|${modo}` : '';
    if (clave === this._ordenVista) return;
    this._ordenVista = clave;
    if (!orden) { this.ordenEl.textContent = ''; return; }
    const [, verbo, tecla] = /^(.*?)(?:\s*\((\w)\))?$/.exec(orden.hacer);
    const conTecla = tecla && modo !== 'tactil' ? `<kbd>${teclaVisible(tecla)}</kbd>` : '';
    this.ordenEl.innerHTML = `${orden.precio ? `<span class="radar__precio">${orden.precio}</span>` : ''}${verbo ? `<span class="radar__hacer">${verbo}${conTecla}</span>` : ''}`;
  }
}
