// src/systems/RebusqueSystem.js
// Rebusque: malabares, limpiar vidrios o vender dulces a los carros en rojo; vender dulces a los pasajeros del bus
// detenido; cuidar carros parqueados con la franela. Usa la tecla de pedir limosna (B): si hay dónde y con qué
// trabajar, se trabaja; si no, se pide. No depende del DOM ni de Three.js: lee el juego y avisa con eventos de `window`.
import { REBUSQUE, ORDEN_REBUSQUE, ESPERA_POR_CARRO } from '../data/rebusque.js';
import { cop } from '../utils/money.js';

const SALIR_M = 2.5;      // alejarse más que esto del sitio donde empezó corta el trabajo
const SALIR_CUIDANDO_M = 9; // cuidando carros se puede caminar la cuadra
const ARRANCA = 1;        // m/s: un carro o un bus más rápido ya se fue
const GESTO_S = 1.2;      // el gesto de ofrecer se repite mientras dura el trabajo

const emitir = (name, detail) => globalThis.window?.dispatchEvent?.(new CustomEvent(name, { detail }));
const avisar = (text, type = 'info') => emitir('toast', { text, type });
const plano = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class RebusqueSystem {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.random = random;
    this.trabajo = null;     // { def, cars, desde, tiempo, gesto, pesos, dieron, propina }
    this.prompt = null;
    this._t = 0;
    this._atendidos = new WeakMap(); // carro o bus → instante en que se le trabajó
    this._pistaDada = false;
  }

  get activo() { return !!this.trabajo; }

  _tiene(def) { return (this.game.inventory?.count?.(def.item) ?? 0) > 0; }

  _libre(objeto, espera = ESPERA_POR_CARRO) {
    const cuando = this._atendidos.get(objeto);
    return cuando === undefined || this._t - cuando >= espera;
  }

  _puedeTrabajar() {
    const p = this.game.player;
    if (!p?.position || p.isStunned || p.isSwimming || p.isRagdollActive || p.hasCart) return false;
    return !this.game.carjack?.driving;
  }

  /** Carros quietos en rojo cerca, libres para trabajarles. */
  _semaforo(pos) {
    const traffic = this.game.traffic;
    if (!traffic?.stoppedAtRed) return [];
    return traffic.stoppedAtRed(pos, 9).filter(({ car }) => this._libre(car))
      .map(({ car, vehicle, distance }) => ({ car, vehicle, distance }));
  }

  /** El bus troncal detenido, si el jugador está junto a su costado. */
  _bus(pos) {
    const lista = [];
    for (const { car: bus } of this.game.traffic?.busVehicles ?? []) {
      if (!bus?.position || (bus.speed ?? 0) > .1 || bus.group?.visible === false || !this._libre(bus)) continue;
      if (Math.abs((bus.position.y ?? 0) - (pos.y ?? 0)) > 1.5) continue;
      const h = bus.heading ?? { x: 0, z: -1 };
      const dx = pos.x - bus.position.x, dz = pos.z - bus.position.z;
      const along = dx * h.x + dz * h.z, side = Math.abs(dx * -h.z + dz * h.x);
      const lado = side - (bus.width ?? 2.6) / 2;
      if (Math.abs(along) > (bus.length ?? 18) / 2 || lado > REBUSQUE.bus.alcance) continue;
      lista.push({ bus, distance: Math.max(0, lado) });
    }
    return lista.sort((a, b) => a.distance - b.distance);
  }

  /** Carros parqueados alrededor, sin el que el jugador maneja ni los recién cuidados. */
  _parqueados(pos) {
    const def = REBUSQUE.cuidar;
    return (this.game.cars ?? [])
      .filter(car => car?.position && !car.driven && this._libre(car, def.espera) && Math.abs((car.position.y ?? 0) - (pos.y ?? 0)) < 1.5)
      .map(car => ({ car, distance: plano(car.position, pos) }))
      .filter(({ distance }) => distance <= def.alcance)
      .sort((a, b) => a.distance - b.distance);
  }

  /** El trabajo que haría B ahora: `{ eleccion: { def, cars }, cerca }`. `cerca` dice si hay carros en rojo al lado. */
  elegir() {
    if (!this._puedeTrabajar()) return { eleccion: null, cerca: false };
    const pos = this.game.player.position;
    const lugares = { semaforo: this._semaforo(pos), bus: null, parqueados: null };
    const cerca = lugares.semaforo.some(({ distance }) => distance <= 6);
    for (const id of ORDEN_REBUSQUE) {
      const def = REBUSQUE[id];
      if (!this._tiene(def)) continue;
      lugares[def.donde] ??= def.donde === 'bus' ? this._bus(pos) : this._parqueados(pos);
      const cars = lugares[def.donde].filter(({ distance }) => distance <= def.alcance).slice(0, def.carros);
      if (cars.length) return { eleccion: { def, cars }, cerca };
    }
    return { eleccion: null, cerca };
  }

  /** B: empieza un trabajo si se puede. Devuelve true si la tecla fue del rebusque y no de la limosna. */
  intentar() {
    if (this.trabajo) {
      // Cuidando carros, B deja el puesto con lo ganado.
      if (this.trabajo.def.donde === 'parqueados') this._terminar();
      return true;
    }
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
    this.trabajo = { def, cars, desde: { x: pos.x, z: pos.z }, tiempo: 0, gesto: 0, pesos: 0, dieron: 0, propina: 0 };
    this.game.player?.playBeg?.();
    avisar(def.empezar, 'info');
    return true;
  }

  cancelar(texto = null) {
    if (!this.trabajo) return;
    this._marcar(this.trabajo);
    const { def, pesos, dieron } = this.trabajo;
    this.trabajo = null;
    if (texto) avisar(texto, 'warn');
    // Lo cobrado cuidando carros ya está en el bolsillo: cuenta para el objetivo.
    if (pesos > 0) emitir('rebusque', { id: def.id, pesos, carros: dieron });
  }

  _marcar(t) {
    for (const { car, bus } of t.cars) this._atendidos.set(car ?? bus, this._t);
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
    const cuidando = t.def.donde === 'parqueados';
    const pos = this.game.player.position;
    if (plano(pos, t.desde) > (cuidando ? SALIR_CUIDANDO_M : SALIR_M)) {
      this.cancelar(cuidando ? 'Me alejé y dejé de cuidar los carros.' : 'Me fui antes de terminar y no me dieron nada.');
      return;
    }
    if (!this._siguen(t)) {
      this.cancelar(t.def.donde === 'bus' ? 'El bus arrancó antes de que alcanzara a vender.' : 'Cambió la luz y arrancaron sin pagarme.');
      return;
    }
    t.tiempo += dt;
    t.gesto += dt;
    if (t.gesto >= GESTO_S && !cuidando) { t.gesto = 0; this.game.player?.playBeg?.(); }
    const falta = Math.max(0, Math.ceil(t.def.segundos - t.tiempo));
    this.prompt = cuidando ? `[B] Dejar el puesto · ${t.def.ocupado}, ${falta} s` : `${t.def.ocupado}, ${falta} s`;
    if (cuidando) this._propinas(t, dt);
    if (t.tiempo >= t.def.segundos) cuidando ? this._terminar() : this._cobrar();
  }

  /** ¿Sigue ahí lo que se está atendiendo? Los carros en rojo y el bus no deben arrancar. */
  _siguen(t) {
    if (t.def.donde === 'semaforo') {
      const enCirculacion = new Set(this.game.traffic?.vehicles ?? []);
      t.cars = t.cars.filter(({ vehicle }) => enCirculacion.has(vehicle) && vehicle.speed <= ARRANCA);
    } else if (t.def.donde === 'bus') {
      t.cars = t.cars.filter(({ bus }) => (bus.speed ?? 0) <= ARRANCA);
    } else {
      t.cars = t.cars.filter(({ car }) => !car.driven && (this.game.cars ?? []).includes(car));
    }
    return t.cars.length > 0;
  }

  _sucio() {
    const stats = this.game.stats;
    return typeof stats?.isRejectedByNPCs === 'function' ? stats.isRejectedByNPCs() : (stats?.higiene ?? 100) < 20;
  }

  _pagar(def, pesos, dieron) {
    const game = this.game, stats = game.stats;
    if (!stats || pesos <= 0) return;
    stats.dinero += pesos;
    stats.animo = Math.min(100, (stats.animo ?? 0) + 2);
    stats.addXP?.(def.xp * dieron, game.talents);
    game.audio?.play?.('sell');
  }

  _monto(def) {
    const [min, max] = def.paga;
    return Math.round((min + this.random() * (max - min)) / 100) * 100;
  }

  /** Cuidando carros, cada tanto vuelve un dueño y deja propina (menos si huelo mal). */
  _propinas(t, dt) {
    t.propina += dt;
    if (t.propina + 1e-6 < t.def.propinas) return;
    t.propina = 0;
    const pocos = t.cars.length < 2 ? .7 : 1; // un solo carro: menos dueños que vuelvan
    if (this.random() >= t.def.prob * pocos * (this._sucio() ? .5 : 1)) return;
    const pesos = this._monto(t.def);
    t.pesos += pesos;
    t.dieron++;
    this._pagar(t.def, pesos, 1);
    avisar(`Volvió un dueño y me dio ${cop(pesos)} por cuidarle el carro.`, 'sell');
  }

  /** Fin del turno cuidando carros: el resumen y el evento para el objetivo. */
  _terminar() {
    const t = this.trabajo;
    this._marcar(t);
    this.trabajo = null;
    if (t.pesos <= 0) this.game.audio?.play?.('empty');
    avisar(t.pesos > 0 ? `Dejé el puesto: hoy me hice ${cop(t.pesos)} cuidando carros.` : 'Cuidé un rato, pero ningún dueño volvió.', t.pesos > 0 ? 'sell' : 'warn');
    emitir('rebusque', { id: t.def.id, pesos: t.pesos, carros: t.dieron });
  }

  /** Cada carro (o pasajero) decide si da. La higiene baja espanta a la mitad. */
  _cobrar() {
    const t = this.trabajo;
    const { def, cars } = t;
    const game = this.game, stats = game.stats;
    this._marcar(t);
    this.trabajo = null;
    const sucio = this._sucio();
    const prob = def.prob * (sucio ? .5 : 1);
    // En el bus cada pasajero es una venta posible; en el semáforo, cada carro.
    const intentos = def.donde === 'bus' ? def.carros : cars.length;
    let pesos = 0, dieron = 0, enojado = false;
    for (let i = 0; i < intentos; i++) {
      if (def.consume && !this._tiene(def)) break;
      if (def.enojo && this.random() < def.enojo) { enojado = true; continue; }
      if (this.random() >= prob) continue;
      pesos += this._monto(def);
      dieron++;
      if (def.consume) game.inventory?.remove?.(def.item, 1);
    }
    if (pesos > 0) this._pagar(def, pesos, dieron);
    else {
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
    if (sucio) return 'Nadie me recibe por el olor: tengo que bañarme.';
    if (def.donde === 'bus') return 'Nadie en el bus me compró. Será en el próximo.';
    return 'Nadie me dio nada. Toca esperar el próximo rojo.';
  }
}
