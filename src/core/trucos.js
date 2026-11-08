// src/core/trucos.js
// Modo trucos: se prende con ?trucos en la dirección y no toca la partida guardada; vive en la pestaña.
import { WEATHER_TYPES } from '../world/Climate.js';
import { NEEDS } from '../systems/StatsSystem.js';
import { ITEMS } from '../data/items.js';
import { CAMBUCHE } from '../data/cambuche.js';
import { ZONA_NOMBRES, zonaDe } from '../ui/ZonaAviso.js';

const TRUCOS_QUERY = 'trucos';
export const DINERO_TRUCO = 1_000_000;
export const QTY_TRUCO = 10;
export const VELOCIDAD_NORMAL = 1;
export const VELOCIDAD_RAPIDA = 10;

/** El modo trucos va en la dirección: `?trucos` lo prende, y sin él se apaga al recargar. */
export function trucosActivos(search = '') {
  return new URLSearchParams(search).has(TRUCOS_QUERY);
}

// Horas de prueba: las dos de mayor tráfico, el mediodía, la noche y la madrugada.
export const HORAS_TRUCO = [
  [7.5, '07:30'], [12, '12:00'], [18, '18:00'], [22, '22:00'], [3, '03:00'],
];

/** Un punto transitable por zona, la misma que reparte el aviso de la calle. */
export function destinosDeZona(district) {
  const grid = district?.getSpawnGrid?.() ?? [];
  const out = [];
  for (const [zona, name] of Object.entries(ZONA_NOMBRES)) {
    // El Cartucho no tiene punto libre en la rejilla (el jíbaro y la mesa lo ocupan): cae donde el jíbaro.
    const spot = grid.find((point) => zonaDe(district, point.x, point.z) === zona)
      ?? (zona === 'cartucho' ? district?.reserved?.dealer : null);
    if (spot) out.push({ name, x: spot.x, z: spot.z });
  }
  const spawn = district?.reserved?.spawn;
  if (spawn) out.push({ name: 'Cambuche', x: spawn.x, z: spawn.z });
  return out;
}

/**
 * Estado y acciones de los trucos. El juego lo crea solo cuando `?trucos` está en la
 * dirección y le da un `update()` por cuadro activo para lo que hay que sostener.
 */
export class CheatMode {
  constructor(game) {
    this.game = game;
    this.necesidades = false;   // clava las necesidades al máximo
    this.invisible = false;     // la policía no lo ve
    this.invulnerable = false;  // sin daño, sin muerte ni arresto
    this.velocidad = VELOCIDAD_NORMAL;
    this._destinos = null;
  }

  /** Lo que hay que sostener mientras los trucos están prendidos. */
  update() {
    const { stats, inventory } = this.game;
    if (this.necesidades) for (const need of NEEDS) stats[need] = 100;
    // Solo con trucos el costal no tiene tope: se afloja sin tocar las reglas normales.
    if (inventory) inventory.maxWeight = Infinity;
    // La invisibilidad no deja nacer persecuciones; aquí solo se borra la copia que hace el fichado.
    if (this.invisible) {
      if (this.game.traffic) this.game.traffic.wantedLevel = 0;
      if (this.game.steal) this.game.steal.buscado = 0;
    }
  }

  // ===== Necesidades =====
  setNecesidades(on) { this.necesidades = !!on; if (on) this.llenarTodo(); }
  llenarTodo() { for (const need of NEEDS) this.game.stats[need] = 100; }

  // ===== Plata y costal =====
  darDinero(amount = DINERO_TRUCO) { this.game.stats.dinero += amount; }
  /** Todo el catálogo, materiales incluidos; no construye ni mejora el cambuche. */
  darObjetos() {
    const inventory = this.game.inventory;
    if (!inventory) return;
    inventory.maxWeight = Infinity;
    for (const item of Object.values(ITEMS)) {
      const falta = QTY_TRUCO - inventory.count(item.id);
      if (falta > 0) inventory.add(item, falta);
    }
  }

  // ===== Cambuche =====
  construirCambuche() {
    const built = {};
    for (const piece of CAMBUCHE) built[piece.id] = true;
    this.game.built = built;
    this.game.cambuche?.setBuilt(built);
  }

  // ===== Policía =====
  calmarPolicia() {
    const { traffic, steal } = this.game;
    if (traffic) { traffic.wantedLevel = 0; traffic.endPursuit?.(); }
    if (steal) steal.buscado = 0;
  }
  setInvisible(on) {
    this.invisible = !!on;
    if (this.game.interaction) this.game.interaction.policeBlind = this.invisible;
    if (on) this.calmarPolicia();
  }
  setInvulnerable(on) {
    this.invulnerable = !!on;
    this.game.stats.invulnerable = this.invulnerable;
  }

  // ===== Reloj y clima =====
  ponerHora(hour) { this.game.clock.hour = hour; }
  setVelocidad(mult) { this.velocidad = mult === VELOCIDAD_RAPIDA ? VELOCIDAD_RAPIDA : VELOCIDAD_NORMAL; }
  ponerClima(id) { if (WEATHER_TYPES[id]) this.game.weather?.setWeather(id, true); }

  // ===== Protesta =====
  /** Arma ya una protesta cerca del jugador (`'paro'` para un paro de un día entero, `'normal'` para una de un par de horas; segundo argumento, o el primero solo, el genio: `'pacifica'`, `'tensa'` o `'pelea'`, si no, al azar); con una en curso no hace nada. Devuelve si empezó. */
  protesta(kind = null, temper = null) {
    const GENIOS = { pacifica: 'peaceful', tensa: 'tense', pelea: 'fight' };
    return !!this.game.protest?.trigger({ force: true, kind: kind === 'paro' ? 'paro' : kind === 'normal' ? 'normal' : null, temper: GENIOS[temper] ?? GENIOS[kind] ?? null });
  }
  // ===== La calle =====
  /** Lleva al jugador junto a la primera pared de ladrillo o al primer refugio de chamber. */
  irA(tipo) {
    const calle = this.game.calle;
    if (tipo === 'refugio') {
      const target = calle?.shelters?.[0];
      if (target) this.game.teleportTo(target.position.x + Math.sin(target.mesh.rotation.y) * 1.6, target.position.z + Math.cos(target.mesh.rotation.y) * 1.6);
      return !!target;
    }
    // De frente a la fachada de un edificio cualquiera, a un paso.
    const p = this.game.player.position, spot = calle?.nearestWall?.(p.x, p.z);
    if (!spot) return false;
    this.game.teleportTo(spot.x, spot.z);
    this.game.player.root.rotation.y = spot.yaw;
    return true;
  }
  // ===== Choques =====
  /** Hace chocar por detrás al par de carros en fila más cercano al jugador. */
  choque() {
    const crashes = this.game.crashes, pair = crashes?.pairNear?.(this.game.player.position);
    return !!(pair && crashes.crash(pair));
  }
  bocadillos() { return this.game.calle?.summonBocadillos(3) ?? 0; }
  /** Le pone un cartón en el costal y lo echa a dormir encima. */
  echarseEnCarton() { if (this.game.inventory) this.game.inventory.add(ITEMS.carton, 1); return this.game.sleepOnCarton(); }

  // ===== Robo express =====
  /** Manda ya la moto del robo express; con una robo en curso no hace nada. Devuelve si salió. */
  robarExpress() { return !!this.game.robo?.trigger({ force: true }); }

  // ===== Viaje =====
  destinos() { return (this._destinos ??= destinosDeZona(this.game.world?.active)); }
  teletransportar(destino) { this.game.teleportTo(destino.x, destino.z); }
}
