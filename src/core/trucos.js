// src/core/trucos.js
// Modo trucos: se prende con ?trucos en la dirección y no toca la partida guardada; vive en la pestaña.
import { WEATHER_TYPES } from '../world/Climate.js';
import { NEEDS } from '../systems/StatsSystem.js';
import { ITEMS } from '../data/items.js';
import { CAMBUCHE } from '../data/cambuche.js';
import { ZONA_NOMBRES, zonaDe } from '../ui/ZonaAviso.js';
import { ATAQUE } from '../systems/PsychosisSystem.js';

const TRUCOS_QUERY = 'trucos';
export const DINERO_TRUCO = 1_000_000;
export const QTY_TRUCO = 10;
export const VELOCIDAD_NORMAL = 1;
export const VELOCIDAD_RAPIDA = 10;
export const ROPAS_TRUCO = 3;
export const PSICOSIS_SEGUNDOS = 120;
const GENIOS = { pacifica: 'peaceful', tensa: 'tense', pelea: 'fight' };

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
    this.protestaKind = 'normal';  // lo que se elige antes de empezar la protesta: 'normal' o 'paro'
    this.protestaGenio = null;     // 'pacifica', 'tensa', 'pelea' o null (al azar)
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
  setProtesta(kind, genio) { this.protestaKind = kind === 'paro' ? 'paro' : 'normal'; this.protestaGenio = GENIOS[genio] ? genio : null; }
  /** Arma ya una protesta cerca del jugador, con la clase y el genio elegidos; con una en curso no hace nada. Devuelve si empezó. */
  empezarProtesta() {
    return !!this.game.protest?.trigger({ force: true, kind: this.protestaKind, temper: GENIOS[this.protestaGenio] ?? null });
  }
  /** Manda la protesta en curso a dispersarse. Devuelve si había una que acabar. */
  acabarProtesta() { return !!this.game.protest?.acabar(); }

  // ===== Lugares =====
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
  /** Lleva al jugador frente al comedor y deja que vuelvan a servirle ya. */
  irAlComedor() {
    const spot = this.game.world?.active?.reserved?.comedor;
    if (!spot) return false;
    this.game.teleportTo(spot.x, spot.z + 3);
    this.comerOtraVez();
    return true;
  }
  /** Borra la espera de 24 horas del comedor. */
  comerOtraVez() { this.game.lastComedorHour = null; }

  // ===== Eventos de la calle =====
  /** Hace chocar por detrás al par de carros en fila más cercano al jugador. */
  choque() {
    const crashes = this.game.crashes, pair = crashes?.pairNear?.(this.game.player.position);
    return !!(pair && crashes.crash(pair));
  }
  /** Suelta el bocadillo gigante cerca del jugador; si ya hay uno suelto no hace nada. Devuelve cuántos salieron. */
  bocadillo() { return this.game.calle?.summonBocadillos(1) ?? 0; }
  /** Manda la moto del robo; con un robo en curso no hace nada. `tipo`: 'azar', 'pistola', 'cuchillo' o 'choro'. Devuelve si salió. */
  robarEnMoto(tipo = 'azar') {
    if (tipo === 'azar') return !!this.game.robo?.trigger({ force: true });
    return !!this.game.robo?.trigger({ force: true, armado: true, contra: true, weapon: tipo === 'choro' ? null : tipo, choro: tipo === 'choro' });
  }
  /** Baja de su carro al conductor del carro más cercano, furioso, aunque no lo hayan provocado. */
  furiaVial() {
    const { roadRage, traffic, player } = this.game;
    if (!roadRage || !traffic?.vehicles) return false;
    const p = player.position, d2 = (v) => (v.car.position.x - p.x) ** 2 + (v.car.position.z - p.z) ** 2;
    const libres = traffic.vehicles.filter((v) => !v.hold && roadRage._canSnap(v.car)).sort((a, b) => d2(a) - d2(b));
    return libres.some((v) => roadRage.trigger(v.car, 'mirror', { force: true }));
  }
  /** Tres consumos seguidos de paranoia: lo que trae a los hombres sombra y a las motos sombra. */
  psicosis() { for (let i = 0; i < ATAQUE.dosis; i++) this.game.psychosis?.induce(PSICOSIS_SEGUNDOS, 1); }
  calmarPsicosis() { this.game.psychosis?.clearInduced(); }

  // ===== Jugador =====
  /** Le pone un cartón en el costal y lo echa a dormir encima. */
  echarseEnCarton() { if (this.game.inventory) this.game.inventory.add(ITEMS.carton, 1); return this.game.sleepOnCarton(); }
  darRopaLimpia() { this.game.inventory?.add(ITEMS.ropaLimpia, ROPAS_TRUCO); }
  abrirRopero() { this.game.menu?.close(); return this.game.openWardrobe(); }

  // ===== Misiones =====
  /** Da por cumplidas las misiones del día que faltan, con su recompensa. */
  completarMisiones() {
    const missions = this.game.dailyMissions;
    for (const m of missions?.missions ?? []) if (!m.completed) missions.reportProgress(m.type, m.target - m.progress);
  }
  /** Deja las misiones del día como nuevas, con el avance en cero. */
  reiniciarMisiones() {
    const missions = this.game.dailyMissions;
    if (!missions) return;
    missions.missions = missions.generateMissions(missions.currentDay);
    window.dispatchEvent(new CustomEvent('missions-updated', { detail: { missions: missions.missions } }));
  }

  // ===== Viaje =====
  destinos() { return (this._destinos ??= destinosDeZona(this.game.world?.active)); }
  teletransportar(destino) { this.game.teleportTo(destino.x, destino.z); }
}
