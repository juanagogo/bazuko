// src/systems/RebusqueSystem.js
// Rebusque en el semáforo: malabares, limpiar vidrios o vender dulces a los carros que esperan la luz en rojo.
// Usa la tecla de pedir limosna (B): si hay carros en rojo cerca y algo con qué trabajar, se trabaja; si no, se pide.
// No depende del DOM ni de Three.js: lee el juego que le pasan y avisa con eventos de `window`.
import { REBUSQUE, ORDEN_REBUSQUE, ESPERA_POR_CARRO } from '../data/rebusque.js';
import { cop } from '../utils/money.js';

const SALIR_M = 2.5;      // alejarse más que esto del sitio donde empezó corta el trabajo
const ARRANCA = 1;        // m/s: un carro más rápido ya se fue con la luz verde
const GESTO_S = 1.2;      // el gesto de ofrecer se repite mientras dura el trabajo

const emitir = (name, detail) => globalThis.window?.dispatchEvent?.(new CustomEvent(name, { detail }));
const avisar = (text, type = 'info') => emitir('toast', { text, type });

export class RebusqueSystem {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.random = random;
    this.trabajo = null;     // { def, cars, desde, tiempo, gesto }
    this.prompt = null;
    this._t = 0;
    this._atendidos = new WeakMap(); // carro → instante en que se le trabajó
    this._pistaDada = false;
  }

  get activo() { return !!this.trabajo; }

  _tiene(def) { return (this.game.inventory?.count?.(def.item) ?? 0) > 0; }

  _libre(car) {
    const cuando = this._atendidos.get(car);
    return cuando === undefined || this._t - cuando >= ESPERA_POR_CARRO;
  }

  _puedeTrabajar() {
    const p = this.game.player;
    if (!p?.position || p.isStunned || p.isSwimming || p.isRagdollActive || p.hasCart) return false;
    return !this.game.carjack?.driving;
  }

  /** El trabajo que haría B ahora: `{ def, cars }`, o null. `cerca` dice si hay carros en rojo al lado. */
  elegir() {
    const traffic = this.game.traffic;
    if (!traffic?.stoppedAtRed || !this._puedeTrabajar()) return { eleccion: null, cerca: false };
    const todos = traffic.stoppedAtRed(this.game.player.position, 9).filter(({ car }) => this._libre(car));
    const cerca = todos.some(({ distance }) => distance <= 6);
    for (const id of ORDEN_REBUSQUE) {
      const def = REBUSQUE[id];
      if (!this._tiene(def)) continue;
      const cars = todos.filter(({ distance }) => distance <= def.alcance).slice(0, def.carros).map(({ car, vehicle }) => ({ car, vehicle }));
      if (cars.length) return { eleccion: { def, cars }, cerca };
    }
    return { eleccion: null, cerca };
  }

  /** B: empieza un trabajo si se puede. Devuelve true si la tecla fue del rebusque y no de la limosna. */
  intentar() {
    if (this.trabajo) return true;
    const { eleccion } = this.elegir();
    if (!eleccion) return false;
    const { def, cars } = eleccion;
    const stats = this.game.stats;
    if (stats && stats.energia < def.energia) {
      avisar('No me queda energía para rebuscarme.', 'warn');
      return true;
    }
    if (stats) stats.energia = Math.max(0, stats.energia - def.energia);
    const pos = this.game.player.position;
    this.trabajo = { def, cars, desde: { x: pos.x, z: pos.z }, tiempo: 0, gesto: 0 };
    this.game.player?.playBeg?.();
    avisar(def.empezar, 'info');
    return true;
  }

  cancelar(texto = null) {
    if (!this.trabajo) return;
    for (const { car } of this.trabajo.cars) this._atendidos.set(car, this._t);
    this.trabajo = null;
    if (texto) avisar(texto, 'warn');
  }

  update(dt) {
    this._t += dt;
    this.prompt = null;
    const t = this.trabajo;
    if (!t) {
      const { eleccion, cerca } = this.elegir();
      if (eleccion) this.prompt = `[B] ${eleccion.def.verbo}`;
      else if (cerca && !this._pistaDada) {
        this._pistaDada = true;
        avisar('Con pelotas, un rodillo o dulces de la tienda podría rebuscarme en este semáforo.', 'info');
      }
      return;
    }
    if (!this._puedeTrabajar()) { this.cancelar(); return; }
    const pos = this.game.player.position;
    if (Math.hypot(pos.x - t.desde.x, pos.z - t.desde.z) > SALIR_M) {
      this.cancelar('Me fui antes de terminar y no me dieron nada.');
      return;
    }
    const enCirculacion = new Set(this.game.traffic?.vehicles ?? []);
    t.cars = t.cars.filter(({ vehicle }) => enCirculacion.has(vehicle) && vehicle.speed <= ARRANCA);
    if (!t.cars.length) {
      this.cancelar('Cambió la luz y arrancaron sin pagarme.');
      return;
    }
    t.tiempo += dt;
    t.gesto += dt;
    if (t.gesto >= GESTO_S) { t.gesto = 0; this.game.player?.playBeg?.(); }
    const falta = Math.max(0, Math.ceil(t.def.segundos - t.tiempo));
    this.prompt = `${t.def.ocupado}, ${falta} s`;
    if (t.tiempo >= t.def.segundos) this._cobrar();
  }

  /** Cada carro decide si da. La higiene baja espanta a la mitad. */
  _cobrar() {
    const { def, cars } = this.trabajo;
    const game = this.game, stats = game.stats;
    this.trabajo = null;
    const sucio = typeof stats?.isRejectedByNPCs === 'function' ? stats.isRejectedByNPCs() : (stats?.higiene ?? 100) < 20;
    const prob = def.prob * (sucio ? .5 : 1);
    let pesos = 0, dieron = 0, enojado = false;
    for (const { car } of cars) {
      this._atendidos.set(car, this._t);
      if (def.consume && !this._tiene(def)) break;
      if (def.enojo && this.random() < def.enojo) { enojado = true; continue; }
      if (this.random() >= prob) continue;
      const [min, max] = def.paga;
      pesos += Math.round((min + this.random() * (max - min)) / 100) * 100;
      dieron++;
      if (def.consume) game.inventory?.remove?.(def.item, 1);
    }
    if (pesos > 0 && stats) {
      stats.dinero += pesos;
      stats.animo = Math.min(100, (stats.animo ?? 0) + 2);
      stats.addXP?.(def.xp * dieron, game.talents);
      game.audio?.play?.('sell');
    } else {
      if (stats) stats.animo = Math.max(0, (stats.animo ?? 0) - (enojado ? 3 : 1));
      game.audio?.play?.('empty');
    }
    avisar(this._texto(def, pesos, dieron, enojado, sucio), pesos > 0 ? 'sell' : 'warn');
    emitir('rebusque', { id: def.id, pesos, carros: dieron });
  }

  _texto(def, pesos, dieron, enojado, sucio) {
    if (pesos > 0) {
      if (def.consume) return `Vendí ${dieron === 1 ? 'un dulce' : `${dieron} dulces`}: ${cop(pesos)}.`;
      return dieron > 1 ? `${dieron} carros me dieron ${cop(pesos)}.` : `Me dieron ${cop(pesos)}.`;
    }
    if (enojado) return 'El conductor se puso bravo porque no pidió que le limpiara el vidrio.';
    if (sucio) return 'Suben el vidrio por el olor: tengo que bañarme.';
    return 'Nadie me dio nada. Toca esperar el próximo rojo.';
  }
}
