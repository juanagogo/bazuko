// src/systems/RebusqueSystem.js
// Rebusque en el semáforo: malabares frente a los carros quietos en rojo. Usa la tecla de pedir limosna (B): si hay
// dónde y con qué trabajar, se trabaja; si no, se pide. L sigue siendo siempre limosna (InteractionSystem).
// No depende del DOM ni de Three.js: lee el juego y avisa con eventos de `window` (ver docs/rebusque.md).
//
//  - Los malabares se hacen frente a la cola, sin pegarse a ningún carro, y nunca dentro del cruce.
//  - Solo se empieza si al rojo le queda tiempo (systems/rebusque/semaforo.js) y el show se acorta para terminar
//    antes del verde. El aviso lleva la cuenta del rojo.
//  - Al terminar, cada conductor reacciona por su cuenta (systems/rebusque/reacciones.js); lo que pasa sale en el aviso.
//  - El carro que arranca no paga y alejarse corta el show. Morir, dormir o caer preso lo cancelan (core/game.js).
import { REBUSQUE, ESPERA_POR_CARRO } from '../data/rebusque.js';
import { DICHOS, PROPINA } from '../data/rebusqueReacciones.js';
import { ITEMS } from '../data/items.js';
import { cop } from '../utils/money.js';
import { segundosParaVerde, dentroDeCruce, cruceCercano, zonaDeCarro, localDe } from './rebusque/semaforo.js';
import { elegirReaccion } from './rebusque/reacciones.js';

const SALIR_M = 2.5;        // alejarse más que esto del sitio donde empezó corta el trabajo
const ARRANCA = 1;          // m/s: un carro más rápido ya se fue
const MARGEN_VERDE_S = 1.5; // el trabajo termina al menos esto antes del verde
const MIN_ROJO_S = 2.5;
const ESQUINA_M = 30;       // a esta distancia de un cruce, se cuenta como su esquina
const ESPERA_ESQUINA_S = 40; // cada esquina aguanta un show cada tanto: los mismos carros ya lo vieron
const NARIZ_EXTRA = 1.15;   // frente al primero de la cola: un poco más de plata
// En cualquier minuto real no entran más de $3.000 del semáforo. Pasado el techo, el conductor que iba a dar «no tiene
// sencillo» (salvo el primero del minuto, que pasa entero).
const TECHO_MINUTO = 3000, MINUTO_S = 60;
const MALABARES_MIN = 2.5;  // metros: más cerca del carro no se lanzan pelotas

const SEPARADOR = ' · ';     // separador de piezas del aviso (ui/HUD.js)
const emitir = (name, detail) => globalThis.window?.dispatchEvent?.(new CustomEvent(name, { detail }));
const avisar = (text, type = 'info') => emitir('toast', { text, type });
const plano = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const unoDe = (lista, r) => lista[Math.min(lista.length - 1, Math.floor(r * lista.length))];

export class RebusqueSystem {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.random = random;
    this.trabajo = null;     // { def, cars, desde, tiempo, dur, nariz }
    this.prompt = null;
    this._t = 0;
    this._atendidos = new WeakMap(); // carro → instante en que se le trabajó
    this._pistaDada = false;
    this._esquinas = new Map();      // cruce → instante del último show ahí
    this._ganado = [];               // [instante, pesos] de lo cobrado en el último minuto
  }

  get activo() { return !!this.trabajo; }

  _tiene(def) { return (this.game.inventory?.count?.(def.item) ?? 0) > 0; }

  _libre(car) {
    const cuando = this._atendidos.get(car);
    return cuando === undefined || this._t - cuando >= ESPERA_POR_CARRO;
  }

  /** Con la mano en un bolsillo ajeno no se trabaja: las dos cosas no van juntas. */
  _robando() { return !!this.game.steal?.minigameActive; }

  _puedeTrabajar() {
    const p = this.game.player;
    if (!p?.position || p.isStunned || p.isSwimming || p.isRagdollActive || p.hasCart) return false;
    return !this._robando();
  }

  get _signals() { return this.game.traffic?.signals ?? null; }

  /** Carros quietos en rojo cerca, libres para trabajarles. */
  _semaforo(pos) {
    const traffic = this.game.traffic;
    if (!traffic?.stoppedAtRed) return [];
    return traffic.stoppedAtRed(pos, REBUSQUE.malabares.alcance).filter(({ car }) => this._libre(car));
  }

  /** ¿Es el primero de su cola? Nadie quieto delante en su carril a menos de 9 m. */
  _primeroDeLaCola(vehicle) {
    const car = vehicle.car, l = this._l ??= { a: 0, s: 0 };
    for (const o of this.game.traffic?.vehicles ?? []) {
      if (o === vehicle || !o.car?.position) continue;
      localDe(car, o.car.position, l);
      if (l.a > 0 && l.a < 9 && Math.abs(l.s) < 1.6) return false;
    }
    return true;
  }

  /** Los carros que ven el show desde donde está parado el jugador, o null si ahí no se hace: frente a la cola, sin estar pegado a ningún carro. */
  _sitio(def, lugares, pos) {
    const cerca = lugares.filter(({ distance }) => distance <= def.alcance);
    if (!cerca.length) return null;
    if (cerca[0].distance < MALABARES_MIN || cerca.some(({ car }) => zonaDeCarro(car, pos) === 'flanco')) return null;
    const delante = cerca.find(({ car, vehicle }) => zonaDeCarro(car, pos) === 'nariz' && this._primeroDeLaCola(vehicle));
    const cars = cerca.slice(0, def.carros);
    if (delante && !cars.includes(delante)) cars[cars.length - 1] = delante; // el de enfrente siempre ve el show
    return { cars, nariz: !!delante };
  }

  /** ¿Qué impide el show ahora mismo? Un texto, o null si se puede. */
  _impedimento(def, cars, pos) {
    const signals = this._signals;
    if (!signals) return null;
    if (dentroDeCruce(signals.nodes, pos, 1)) return 'Aquí en el cruce me atropellan: me hago antes de la cebra.';
    if (this._rojo(cars) < Math.max(MIN_ROJO_S, def.segundos * .5 + MARGEN_VERDE_S)) return 'Ya va a cambiar la luz: espero el próximo rojo.';
    const nodo = cruceCercano(signals.nodes, pos, ESQUINA_M);
    const ultimo = this._esquinas.get(nodo);
    if (nodo >= 0 && ultimo !== undefined && this._t - ultimo < ESPERA_ESQUINA_S) return 'Esta esquina ya me vio: espero el próximo rojo.';
    return null;
  }

  /** Segundos de rojo que les quedan a los carros atendidos (el menor). Infinity sin semáforos. */
  _rojo(cars) {
    let rojo = Infinity;
    for (const { car } of cars) rojo = Math.min(rojo, segundosParaVerde(this._signals, car));
    return rojo;
  }

  /**
   * El show que haría B ahora: `{ eleccion: { def, cars, nariz }, cerca, motivo }`. `cerca` dice si hay carros en rojo
   * al lado; `motivo`, por qué un show que se podría hacer aquí no se puede empezar todavía.
   */
  elegir() {
    const def = REBUSQUE.malabares;
    if (!this._puedeTrabajar()) return { eleccion: null, cerca: false, motivo: null };
    const tiene = this._tiene(def);
    // Sin pelotas, solo hace falta saber si hay carros al lado para la pista, y esa se da una sola vez.
    if (!tiene && this._pistaDada) return { eleccion: null, cerca: false, motivo: null };
    const pos = this.game.player.position;
    const lugares = this._semaforo(pos);
    const cerca = lugares.some(({ distance }) => distance <= 6);
    if (!tiene) return { eleccion: null, cerca, motivo: null };
    const sitio = this._sitio(def, lugares, pos);
    if (!sitio) return { eleccion: null, cerca, motivo: null };
    const motivo = this._impedimento(def, sitio.cars, pos);
    if (motivo) return { eleccion: null, cerca, motivo };
    return { eleccion: { def, ...sitio }, cerca, motivo: null };
  }

  /** El centro de los carros que miran el show. */
  _centro(cars) {
    let x = 0, z = 0;
    for (const { car } of cars) { x += car.position.x; z += car.position.z; }
    return { x: x / cars.length, y: this.game.player.position.y, z: z / cars.length };
  }

  /** B: empieza el show si se puede. Devuelve true si la tecla fue del rebusque y no de la limosna. */
  intentar() {
    if (this.trabajo) return true;
    const { eleccion, motivo } = this.elegir();
    if (!eleccion) {
      if (!motivo) return false;
      avisar(motivo, 'warn');
      return true;
    }
    const { def, cars, nariz } = eleccion;
    const stats = this.game.stats;
    if (stats && stats.energia < def.energia) {
      avisar('No me queda energía para rebuscarme.', 'warn');
      return true;
    }
    if (stats) stats.energia = Math.max(0, stats.energia - def.energia);
    const pos = this.game.player.position;
    const dur = Math.min(def.segundos, this._rojo(cars) - MARGEN_VERDE_S);
    const nodo = this._signals ? cruceCercano(this._signals.nodes, pos, ESQUINA_M) : -1;
    if (nodo >= 0) this._esquinas.set(nodo, this._t);
    this.trabajo = { def, cars, desde: { x: pos.x, z: pos.z }, tiempo: 0, dur, nariz: !!nariz };
    this.game.player.faceTowards?.(this._centro(cars));
    avisar(def.empezar, 'info');
    return true;
  }

  /** Corta el trabajo sin cobrarlo (si lo hay). Lo llama el juego al morir, dormir o caer preso. */
  cancelar(texto = null) {
    if (!this.trabajo) return;
    this._marcar(this.trabajo);
    this.trabajo = null;
    this.prompt = null;
    if (texto) avisar(texto, 'warn');
  }

  dispose() { this.cancelar(); }

  _marcar(t) {
    for (const { car } of t.cars) this._atendidos.set(car, this._t);
  }

  update(dt) {
    this._t += dt;
    const t = this.trabajo;
    if (!t) {
      this.prompt = this._promptLibre();
      return;
    }
    if (!this._puedeTrabajar()) {
      this.cancelar(this._robando() ? 'Dejé el trabajo a medias: así nadie me va a pagar.' : null);
      return;
    }
    if (plano(this.game.player.position, t.desde) > SALIR_M) {
      this.cancelar('Me fui antes de terminar y no me dieron nada.');
      return;
    }
    if (!this._siguen(t)) {
      this.cancelar('Cambió la luz y arrancaron sin pagarme.');
      return;
    }
    t.tiempo += dt;
    if (t.tiempo >= t.dur) this._cobrar();
    else this.prompt = this._promptTrabajo(t);
  }

  _promptLibre() {
    const { eleccion, cerca, motivo } = this.elegir();
    if (eleccion) return `[B] ${eleccion.def.verbo}`;
    if (motivo) return motivo;
    if (cerca && !this._pistaDada) {
      this._pistaDada = true;
      avisar('Con unas pelotas de malabares de la tienda podría rebuscarme en este semáforo.', 'info');
    }
    return null;
  }

  /** «Haciendo malabares, 3 s · rojo 8 s»: HUD parte el aviso por el separador y cada pedazo sale en su tarjeta. */
  _promptTrabajo(t) {
    const falta = Math.max(0, Math.ceil(t.dur - t.tiempo));
    const rojo = Math.ceil(this._rojo(t.cars));
    const cola = rojo <= 2 ? '¡Ya cambia! Me quito de la vía' : Number.isFinite(rojo) ? `rojo ${rojo} s` : null;
    const trabajo = `${t.def.ocupado}, ${falta} s`;
    return cola ? trabajo + SEPARADOR + cola : trabajo;
  }

  /** ¿Siguen ahí los carros? Los que arrancaron o salieron de la vía ya no pagan. */
  _siguen(t) {
    const enCirculacion = this.game.traffic?.vehicles ?? [];
    t.cars = t.cars.filter(({ vehicle }) => enCirculacion.includes(vehicle) && vehicle.speed <= ARRANCA);
    return t.cars.length > 0;
  }

  _sucio() {
    const stats = this.game.stats;
    return typeof stats?.isRejectedByNPCs === 'function' ? stats.isRejectedByNPCs() : (stats?.higiene ?? 100) < 20;
  }

  /** Lo cobrado en el último minuto real. */
  _ganadoMinuto() {
    while (this._ganado.length && this._t - this._ganado[0][0] >= MINUTO_S) this._ganado.shift();
    let n = 0;
    for (const [, pesos] of this._ganado) n += pesos;
    return n;
  }

  /** Cada conductor reacciona a su manera; lo que dan se suma y sale en el aviso. */
  _cobrar() {
    const t = this.trabajo;
    const { def, cars } = t;
    const game = this.game, stats = game.stats;
    this._marcar(t);
    this.trabajo = null;
    this.prompt = null;
    const sucio = this._sucio();
    // Un show recortado por el rojo paga en proporción; frente a la cola, un poco más.
    const fraccion = Math.min(1, Math.max(.1, t.dur / def.segundos)) * (t.nariz ? NARIZ_EXTRA : 1);
    const cupo = TECHO_MINUTO - this._ganadoMinuto();
    const contexto = { tipoCarro: 'carro', sucio, lluvia: !!game.weather?.isRaining };
    let pesos = 0, dieron = 0, insulto = false;
    const extras = [];
    for (const { car } of cars) {
      contexto.tipoCarro = car?.kind === 'taxi' ? 'taxi' : 'carro';
      let r = elegirReaccion(contexto, def, this.random);
      // El billete es un billete: no se recorta con el show ni sube frente a la cola. Lo demás son monedas.
      const billete = r.tipo === 'propina' && r.pesos === PROPINA.billete;
      const monto = r.pesos > 0 ? (billete ? r.pesos : Math.max(100, Math.round(r.pesos * fraccion / 100) * 100)) : 0;
      // El primero del minuto pasa entero: así todavía sale, muy de vez en cuando, el billete de $5.000.
      if (monto > 0 && pesos + monto > cupo && (pesos > 0 || cupo < TECHO_MINUTO)) r = { tipo: 'excusa', pesos: 0, item: null };
      if (r.pesos > 0) {
        pesos += monto;
        dieron++;
        if (billete) extras.push(`¡Uno me dio un billete de ${cop(monto)}!`);
      }
      if (r.tipo === 'comida') {
        const item = ITEMS[r.item];
        const cabe = item && game.inventory?.add ? game.inventory.add(item, 1) : false;
        extras.push(cabe ? `Uno me regaló ${item.name.toLowerCase()}.` : 'Me iban a regalar comida, pero no me cabe en el costal.');
      }
      if (r.tipo === 'ventana' && !extras.some(e => /vidrio/.test(e))) extras.push('Uno subió el vidrio y miró al frente.');
      if (r.tipo === 'pito') emitir('car-honk', { x: car.position.x, z: car.position.z });
      if (r.tipo === 'insulto' && !insulto) {
        insulto = true;
        extras.push(`Otro me gritó: «${unoDe(DICHOS.insulto, this.random())}»`);
      }
    }
    if (pesos > 0) {
      stats.dinero += pesos;
      stats.animo = Math.min(100, (stats.animo ?? 0) + 2);
      stats.addXP?.(def.xp * dieron, game.talents);
      game.audio?.play?.('sell');
      this._ganado.push([this._t, pesos]);
    } else {
      stats.animo = Math.max(0, (stats.animo ?? 0) - (insulto ? 3 : 1));
      game.audio?.play?.('empty');
    }
    if (insulto) stats.animo = Math.max(0, stats.animo - 1);
    let texto = pesos > 0 ? (dieron > 1 ? `${dieron} carros me dieron ${cop(pesos)}.` : `Me dieron ${cop(pesos)}.`)
      : sucio ? 'Nadie me recibe por el olor: tengo que bañarme.' : 'Nadie me dio nada. Toca esperar el próximo rojo.';
    if (extras.length) texto += ` ${extras.slice(0, 2).join(' ')}`;
    avisar(texto, pesos > 0 ? 'sell' : 'warn');
  }
}
