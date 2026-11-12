// src/ui/ZonaAviso.js
// Dónde estoy: el cartel de la zona al entrar a una nueva y la vía actual bajo el radar.
import { calleCercana } from './momentosTextos.js';
import { streetLabels } from '../world/bogota/CityMapRaster.js';
import { LAKE_PARK } from '../world/bogota/LakePark.js';
import { EAST_SEAM } from '../world/bogota/EastZones.js';
import { TILE_SIZE } from '../utils/constants.js';

const DURACION_S = 3.4;      // lo que dura el cartel en pantalla
const CALLE_CADA_S = .4;     // la vía se revisa a este ritmo, no en cada cuadro
const SUR_X = EAST_SEAM * TILE_SIZE;  // hasta la Carrera 5; más al oriente mandan Candelaria y Chapinero

/** Cómo se llama cada zona de las que reparte Bogota._zoneAt, más el lago, que cae en los barrios. */
export const ZONA_NOMBRES = {
  cartucho: 'El Cartucho',
  parque: 'Parque Tercer Milenio',
  candelaria: 'La Candelaria',
  chapinero: 'Chapinero',
  andenes: 'El centro',
  barrio: 'Los barrios',
  lago: LAKE_PARK.name,
  zonaT: 'Zona T (Calle 82 / Zona Rosa)',
  zonaG: 'Zona G (Rosales / Gourmet)',
  parque93: 'Parque de la 93 (Chicó)',
  metro: 'Metro de Bogotá (Línea 1 PLMB)'
};

/** La zona donde está el jugador: todo el parque del sur es lago, aunque `_zoneAt` lo meta en los barrios. */
export function zonaDe(district, x, z) {
  if (z >= LAKE_PARK.z0 && z <= LAKE_PARK.z1 && x < SUR_X) return 'lago';
  return district?._zoneAt?.(x, z) ?? 'andenes';
}

export class ZonaAviso {
  constructor({ doc = globalThis.document } = {}) {
    this._vias = streetLabels(TILE_SIZE);
    this._zona = null;
    this._restante = 0;
    this._calle = null;
    this._calleEspera = 0;
    this.cartelEl = doc.createElement('div');
    this.cartelEl.id = 'zona-cartel';
    this.cartelEl.className = 'carton corte-c';
    this.cartelEl.hidden = true;
    // Dentro de #app: el modo foto lo esconde con el resto de la interfaz.
    (doc.getElementById('app') ?? doc.body).append(this.cartelEl);
    // Bajo el plano del radar: vive dentro de su cartón, sin tocar Minimap.js.
    this.calleEl = doc.createElement('div');
    this.calleEl.className = 'radar__calle';
    doc.getElementById('minimap-container')?.append(this.calleEl);
  }

  /** Un cuadro de simulación. Solo escribe en la página cuando algo cambia. */
  update(dt, district, x, z) {
    if (this._restante > 0) {
      this._restante -= dt;
      if (this._restante <= 0) this.cartelEl.hidden = true;
    }
    const zona = zonaDe(district, x, z);
    if (zona !== this._zona) {
      this._zona = zona;
      const nombre = ZONA_NOMBRES[zona];
      if (nombre) {
        this.cartelEl.textContent = nombre;
        this.cartelEl.hidden = false;
        this._restante = DURACION_S;
      }
    }
    this._calleEspera -= dt;
    if (this._calleEspera > 0) return;
    this._calleEspera = CALLE_CADA_S;
    // El mismo predicado que usa el juego para nombrar la vía donde murió o lo arrestaron.
    const esCalzada = district?.tileTypeAt
      ? (px, pz) => district.tileTypeAt(Math.round(px / TILE_SIZE), Math.round(pz / TILE_SIZE)) === 'road'
      : null;
    const calle = calleCercana(x, z, this._vias, esCalzada);
    const viaCercana = (this._vias ?? []).find(v => v.name && calle.toLowerCase().includes(v.name.toLowerCase().replace(/^av\.\s*/, '')));
    const textoCompleto = viaCercana?.popular ? `${calle} · ${viaCercana.popular}` : calle;
    if (textoCompleto !== this._calle) {
      this._calle = textoCompleto;
      this.calleEl.textContent = textoCompleto;
    }
  }
}
