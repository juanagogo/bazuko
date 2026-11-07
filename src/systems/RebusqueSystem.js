// src/systems/RebusqueSystem.js
// Rebusque: malabares, limpiar vidrios o vender dulces a los carros en rojo; vender dulces a los pasajeros del bus
// detenido; cuidar carros parqueados con la franela. Usa la tecla de pedir limosna (B): si hay dónde y con qué
// trabajar, se trabaja; si no, se pide. No depende del DOM ni de Three.js: lee el juego y avisa con eventos de `window`.
//
// En el semáforo (ver docs/rebusque.md):
//  - Cada trabajo pide su sitio: el parabrisas se limpia parado frente al capó, los dulces se ofrecen en la ventana
//    del conductor y los malabares se hacen frente a la cola, sin pegarse a la puerta. Nada de eso dentro del cruce.
//  - Solo se empieza si al rojo le queda tiempo (systems/rebusque/semaforo.js) y el trabajo se acorta para terminar
//    antes del verde. El aviso lleva la cuenta del rojo.
//  - Al terminar, cada conductor reacciona por su cuenta (systems/rebusque/reacciones.js) y RebusqueVisual lo dibuja.
//  - El despeje (systems/rebusque/despeje.js) frena con cortesía al carro que el jugador todavía tiene enfrente al verde.
//  - La jornada (systems/rebusque/jornadaRebusque.js) lleva el cansancio, la repetición por esquina y las esquinas
//    donde lo vieron robando; se guarda en la partida.
//  - En los malabares, B marca el ritmo de la pelota alta (systems/rebusque/ritmo.js). Es opcional.
import { REBUSQUE, ORDEN_REBUSQUE, ESPERA_POR_CARRO } from '../data/rebusque.js';
import { clavesVoz, DICHOS, PROPINA } from '../data/rebusqueReacciones.js';
import { frasesDe } from '../data/vocesCalle.js';
import { ITEMS } from '../data/items.js';
import { cop } from '../utils/money.js';
import { segundosParaVerde, dentroDeCruce, cruceCercano, zonaDeCarro, puntoParabrisas, puntoVentana, localDe } from './rebusque/semaforo.js';
import { elegirReaccion } from './rebusque/reacciones.js';
import { Ritmo } from './rebusque/ritmo.js';
import { JornadaRebusque } from './rebusque/jornadaRebusque.js';
import { Despeje } from './rebusque/despeje.js';

const SALIR_M = 2.5;      // alejarse más que esto del sitio donde empezó corta el trabajo
const SALIR_CUIDANDO_M = 9; // cuidando carros se puede caminar la cuadra
const ARRANCA = 1;        // m/s: un carro o un bus más rápido ya se fue
const GESTO_S = .5;       // la pose del trabajo se renueva mientras dura
const MARGEN_VERDE_S = 1.5; // el trabajo termina al menos esto antes del verde
const MIN_ROJO_S = 2.5;
// Cada esquina aguanta un trabajo cada tanto: los mismos carros ya lo vieron.
const ESPERA_ESQUINA_S = { malabares: 40, vidrios: 12, dulces: 12 };
const ATRAPAR_S = 1;      // al cobrar los malabares, lo que las manos siguen arriba recibiendo las últimas pelotas
const COBRO_S = 2.6;      // lo que se ve la mano del conductor después de cobrar
const QUEMA_M = 30;       // un robo a esta distancia de un cruce lo quema por el día
const NARIZ_EXTRA = 1.15; // frente al primero de la cola: más plata, más riesgo
// Techo del semáforo (decisión del dueño): en cualquier minuto real no entran más de $3.000 sumando los tres trabajos.
// Pasado el techo, el conductor que iba a dar «no tiene sencillo» (salvo el primero del minuto, que pasa entero).
const TECHO_MINUTO = 3000, MINUTO_S = 60;
// Dónde se para cada trabajo del semáforo, con carros de verdad (los dobles de las pruebas no tienen `group`).
const ALCANCE_PARABRISAS = 1.6, ALCANCE_VENTANA = 1.4, ALCANCE_MOTO = 1.6, MALABARES_MIN = 2.5, DULCES_OTROS = 6;
/** La pose del cuerpo de cada trabajo (character/rebusquePose.js). */
const POSE = { malabares: 'malabares', vidrios: 'limpiar', dulces: 'ofrecer', bus: 'ofrecer', cuidar: 'pedir' };

const SEPARADOR = ' · ';   // separador de piezas del aviso (ui/HUD.js)
const emitir = (name, detail) => globalThis.window?.dispatchEvent?.(new CustomEvent(name, { detail }));
const avisar = (text, type = 'info') => emitir('toast', { text, type });
const plano = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const tieneVoz = clave => frasesDe(clave).length > 0;
const unoDe = (lista, r) => lista[Math.min(lista.length - 1, Math.floor(r * lista.length))];

export class RebusqueSystem {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.random = random;
    this.trabajo = null;     // { def, cars, desde, tiempo, dur, gesto, pesos, dieron, propina, nodo, nariz, ritmo }
    this.prompt = null;
    this._t = 0;
    this._atendidos = new WeakMap(); // carro o bus → instante en que se le trabajó
    this._pistaDada = false;
    this._esquinas = new Map();      // 'trabajo:cruce' → instante del último trabajo ahí
    this._pagados = 0;               // trabajos pagados en el semáforo: cada tres, el barrio lo nota
    this._ganado = [];               // [instante, pesos] de lo cobrado en el semáforo en el último minuto
    this._promptClave = null;
    this.jornada = new JornadaRebusque(game?.clock?.day ?? 1);
    this.despeje = new Despeje(game);
    // Lo que dibuja RebusqueVisual: un objeto plano, sin Three. null si no hay nada que mostrar.
    this.escena = null;
    this._onRobo = () => this._quemarEsquina();
    globalThis.window?.addEventListener?.('mirror-stolen', this._onRobo);
    globalThis.window?.addEventListener?.('robo-peaton', this._onRobo);
  }

  get activo() { return !!this.trabajo; }

  /** Mientras el despeje lleva al jugador al andén, Game no corre Player.update: el paso atrás anima el cuerpo. */
  get controlaJugador() { return !!this.despeje.paso; }

  _tiene(def) { return (this.game.inventory?.count?.(def.item) ?? 0) > 0; }

  _libre(objeto, espera = ESPERA_POR_CARRO) {
    const cuando = this._atendidos.get(objeto);
    return cuando === undefined || this._t - cuando >= espera;
  }

  _puedeTrabajar() {
    const p = this.game.player;
    if (!p?.position || p.isStunned || p.isSwimming || p.isRagdollActive || p.hasCart) return false;
    return !this.game.carjack?.driving && !this._robando();
  }

  /** Con la mano en un bolsillo, el tirón en camino o el atraco encima no se trabaja: las dos cosas no van juntas. */
  _robando() {
    const steal = this.game.steal;
    return !!(steal?.minigameActive || steal?.raponazo || steal?.assaultScene || this.game.player?.stealPose?.fase);
  }

  get _signals() { return this.game.traffic?.signals ?? null; }

  /** Hora absoluta de juego (día × 24 + hora), para la repetición por esquina. */
  _hora() {
    const c = this.game.clock;
    return (c?.day ?? 0) * 24 + (c?.hour ?? 0);
  }

  /** Carros quietos en rojo cerca, libres para trabajarles. */
  _semaforo(pos) {
    const traffic = this.game.traffic;
    if (!traffic?.stoppedAtRed) return [];
    // Las motos también: compran dulces y miran el show; el parabrisas las deja por fuera en _sitio.
    return traffic.stoppedAtRed(pos, 9, { motos: true }).filter(({ car }) => this._libre(car))
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

  /**
   * Los carros que atiende un trabajo del semáforo desde donde está parado el jugador, o null si ahí no se hace.
   * Con carros de verdad pide su sitio; los dobles sin `group` de las pruebas viejas solo miran la distancia.
   */
  _sitio(def, lugares, pos) {
    const cerca = lugares.filter(({ distance }) => distance <= def.alcance);
    if (!cerca.length) return null;
    const reales = cerca[0].car?.group?.rotation;
    if (!reales) return { cars: cerca.slice(0, def.carros), nariz: false };
    const punto = { x: 0, y: 0, z: 0 };
    if (def.id === 'vidrios') {
      // Frente al capó de un carro con parabrisas (una moto no tiene).
      const uno = cerca.filter(({ car }) => car.mirrors?.length && car.kind !== 'moto')
        .find(({ car }) => plano(puntoParabrisas(car, punto), pos) <= ALCANCE_PARABRISAS);
      return uno ? { cars: [uno], nariz: false } : null;
    }
    if (def.id === 'dulces') {
      // En la ventana del conductor; los de al lado también ven la chaza.
      const uno = cerca.find(({ car }) => car.kind === 'moto' ? plano(car.position, pos) <= ALCANCE_MOTO
        : plano(puntoVentana(car, punto), pos) <= ALCANCE_VENTANA);
      if (!uno) return null;
      const otros = cerca.filter(c => c !== uno && c.distance <= DULCES_OTROS).slice(0, def.carros - 1);
      return { cars: [uno, ...otros], nariz: false };
    }
    // Malabares: frente a la cola, sin estar pegado a ningún carro.
    if (cerca[0].distance < MALABARES_MIN || cerca.some(({ car }) => zonaDeCarro(car, pos) === 'flanco')) return null;
    const delante = cerca.find(({ car, vehicle }) => zonaDeCarro(car, pos) === 'nariz' && vehicle && this._primeroDeLaCola(vehicle));
    const cars = cerca.slice(0, def.carros);
    if (delante && !cars.includes(delante)) cars[cars.length - 1] = delante; // el de enfrente siempre ve el show
    return { cars, nariz: !!delante };
  }

  /** ¿Qué impide el trabajo del semáforo ahora mismo? Un texto sin el verbo, o null si se puede. */
  _impedimento(def, cars, pos) {
    const signals = this._signals;
    if (!signals) return null;
    if (dentroDeCruce(signals.nodes, pos, 1)) return 'Aquí en el cruce me atropellan: me hago antes de la cebra.';
    if (this.despeje.sostiene) return null; // primero se quita de adelante: el aviso de despeje ya lo dice
    const rojo = this._rojo(cars);
    if (rojo < Math.max(MIN_ROJO_S, def.segundos * .5 + MARGEN_VERDE_S)) return 'Ya va a cambiar la luz: espero el próximo rojo.';
    const nodo = cruceCercano(signals.nodes, pos, QUEMA_M);
    const ultimo = this._esquinas.get(`${def.id}:${nodo}`);
    if (nodo >= 0 && ultimo !== undefined && this._t - ultimo < (ESPERA_ESQUINA_S[def.id] ?? 0)) {
      return def.id === 'malabares' ? 'Esta esquina ya me vio: espero el próximo rojo.' : 'Ya les trabajé a los de esta esquina: me doy un respiro.';
    }
    return null;
  }

  /** Segundos de rojo que les quedan a los carros atendidos (el menor). Infinity sin semáforos. */
  _rojo(cars) {
    let rojo = Infinity;
    for (const { car } of cars) rojo = Math.min(rojo, segundosParaVerde(this._signals, car));
    return rojo;
  }

  /**
   * El trabajo que haría B ahora: `{ eleccion: { def, cars, nariz }, cerca, motivo }`. `cerca` dice si hay carros en rojo
   * al lado; `motivo`, por qué un trabajo del semáforo que se podría hacer aquí no se puede empezar todavía.
   */
  elegir() {
    if (!this._puedeTrabajar()) return { eleccion: null, cerca: false, motivo: null };
    const pos = this.game.player.position;
    const lugares = { semaforo: this._semaforo(pos), bus: null, parqueados: null };
    const cerca = lugares.semaforo.some(({ distance }) => distance <= 6);
    let motivo = null;
    // Pegado al costado del bus con dulces, el bus va primero aunque haya carros en rojo al lado.
    if (this._tiene(REBUSQUE.bus)) {
      lugares.bus = this._bus(pos);
      const junto = lugares.bus.filter(({ distance }) => distance <= 1.5).slice(0, REBUSQUE.bus.carros);
      if (junto.length) return { eleccion: { def: REBUSQUE.bus, cars: junto, nariz: false }, cerca, motivo };
    }
    for (const id of ORDEN_REBUSQUE) {
      const def = REBUSQUE[id];
      if (!this._tiene(def)) continue;
      if (def.donde === 'semaforo') {
        if (this.despeje.sostiene || this.despeje.paso) continue;
        const sitio = this._sitio(def, lugares.semaforo, pos);
        if (!sitio) continue;
        const impide = this._impedimento(def, sitio.cars, pos);
        if (impide) { motivo ??= impide; continue; }
        return { eleccion: { def, ...sitio }, cerca, motivo: null };
      }
      lugares[def.donde] ??= def.donde === 'bus' ? this._bus(pos) : this._parqueados(pos);
      const cars = lugares[def.donde].filter(({ distance }) => distance <= def.alcance).slice(0, def.carros);
      if (cars.length) return { eleccion: { def, cars, nariz: false }, cerca, motivo };
    }
    return { eleccion: null, cerca, motivo };
  }

  /** Hacia dónde mira mientras trabaja: el parabrisas, la ventana o el centro de los carros. */
  _objetivo(t) {
    const first = t.cars[0];
    const car = first?.car ?? first?.bus;
    if (!car?.position) return null;
    if (t.def.donde !== 'semaforo' || !car.group?.rotation) return car.position;
    if (t.def.id === 'vidrios') return car.position;
    if (t.def.id === 'dulces') return car.position;
    let x = 0, z = 0;
    for (const { car: c } of t.cars) { x += c.position.x; z += c.position.z; }
    t._mira ??= { x: 0, y: 0, z: 0 };
    t._mira.x = x / t.cars.length; t._mira.z = z / t.cars.length;
    return t._mira;
  }

  _pose(t) {
    const player = this.game.player;
    const pose = player?.modelKind === 'procedural' && t.def.id !== 'cuidar' ? 'calentarse' : POSE[t.def.id] ?? 'pedir';
    if (t.def.donde === 'parqueados') player?.playBeg?.();
    else if (player?.playAction) player.playAction(pose, .6);
    else player?.playBeg?.();
    const mira = this._objetivo(t);
    if (mira) player?.faceTowards?.(mira);
  }

  /** B: empieza un trabajo si se puede. Devuelve true si la tecla fue del rebusque y no de la limosna. */
  intentar() {
    if (this.trabajo) {
      // Cuidando carros, B deja el puesto con lo ganado; en los malabares, B marca el ritmo.
      if (this.trabajo.def.donde === 'parqueados') this._terminar();
      else if (this.trabajo.ritmo) this._golpe(this.trabajo);
      return true;
    }
    // Mientras el despeje lo lleva al andén no manda él: la B no empieza a cuidar carros ni a pedir limosna.
    if (this.despeje.paso) return true;
    // Con la mano en un bolsillo, el tirón en camino o el atraco encima, la B tampoco es limosna: se la come el robo.
    if (this._robando()) return true;
    const { eleccion, motivo } = this.elegir();
    if (!eleccion) {
      if (!motivo) return false;
      avisar(motivo, 'warn');
      return true;
    }
    const { def, cars, nariz } = eleccion;
    const semaforo = def.donde === 'semaforo';
    const stats = this.game.stats;
    const energia = semaforo ? this.jornada.energia(def) : def.energia;
    if (stats && stats.energia < energia) {
      avisar('No me queda energía para rebuscarme.', 'warn');
      return true;
    }
    if (stats) stats.energia = Math.max(0, stats.energia - energia);
    const pos = this.game.player.position;
    const rojo = semaforo ? this._rojo(cars) : Infinity;
    const dur = Math.min(def.segundos, rojo - MARGEN_VERDE_S);
    const nodo = semaforo && this._signals ? cruceCercano(this._signals.nodes, pos, QUEMA_M) : -1;
    this.trabajo = { def, cars, desde: { x: pos.x, z: pos.z }, tiempo: 0, dur, gesto: 0, pesos: 0, dieron: 0, propina: 0,
      nodo, nariz: !!nariz, ritmo: def.id === 'malabares' ? new Ritmo(dur) : null, toleraT: 0, feedback: null };
    if (semaforo) {
      if (Number.isFinite(rojo) && this._signals) this.despeje.armar(this._signals.time + rojo);
      this.despeje.tolerar(pos);
      if (nodo >= 0) this._esquinas.set(`${def.id}:${nodo}`, this._t);
      if (this.jornada.cansado(def.id) && !this.jornada.avisoCansancio) {
        this.jornada.avisoCansancio = true;
        avisar('Tengo los brazos molidos: hoy ya no rindo igual.', 'warn');
      }
      if (this.jornada.quemado(nodo)) avisar('Aquí ya me vieron robando: nadie me va a querer dar nada.', 'warn');
    }
    this._pose(this.trabajo);
    this._escenaTrabajo(this.trabajo);
    avisar(def.empezar, 'info');
    return true;
  }

  /** Corta el trabajo (si lo hay) y suelta todo lo que el despeje sostenga. Lo llama el juego al morir, dormir, etc. */
  cancelar(texto = null) {
    this.despeje.soltarTodo();
    // El cobro que se estaba viendo (pelotas cayendo, la mano con la moneda) no sigue en el sitio adonde lo llevaron.
    this.escena = null;
    this._cortar(texto);
  }

  /** Corta el trabajo sin tocar el despeje: el que se va o cambió la luz puede seguir delante de un carro. */
  _cortar(texto = null) {
    if (!this.trabajo) return;
    this._marcar(this.trabajo);
    const { def, pesos, dieron } = this.trabajo;
    this.trabajo = null;
    this.escena = null;
    if (texto) avisar(texto, 'warn');
    // Lo cobrado cuidando carros ya está en el bolsillo: cuenta para el objetivo.
    if (pesos > 0) emitir('rebusque', { id: def.id, pesos, carros: dieron });
  }

  dispose() {
    this.cancelar();
    this.escena = null;
    globalThis.window?.removeEventListener?.('mirror-stolen', this._onRobo);
    globalThis.window?.removeEventListener?.('robo-peaton', this._onRobo);
  }

  serialize() { return this.jornada.serialize(); }

  deserialize(data) {
    this.jornada.deserialize(data);
    this.jornada.sincronizar(this.game.clock?.day);
    // Lo que no se guarda es de la sesión: la partida que llega empieza sin techo gastado ni esquinas ya trabajadas.
    this._atendidos = new WeakMap();
    this._esquinas.clear();
    this._pagados = 0;
    this._ganado = [];
  }

  _marcar(t) {
    for (const { car, bus } of t.cars) this._atendidos.set(car ?? bus, this._t);
  }

  /** Un robo visto cerca de un cruce lo deja quemado el resto del día. */
  _quemarEsquina() {
    const pos = this.game.player?.position, nodes = this._signals?.nodes;
    if (!pos || !nodes) return;
    const nodo = cruceCercano(nodes, pos, QUEMA_M);
    if (nodo >= 0) this.jornada.quemar(nodo);
  }

  _golpe(t) {
    const r = t.ritmo.golpe(t.tiempo);
    t.feedback = { texto: r === 'acierto' ? '¡Eso!' : r === 'caida' ? 'Se me cayó una' : 'Uy, a destiempo', s: .7 };
  }

  update(dt) {
    this._t += dt;
    this.jornada.sincronizar(this.game.clock?.day);
    this.despeje.update(dt);
    if (this.escena?.tipo === 'cobro' && (this.escena.tiempo += dt) >= COBRO_S) this.escena = null;
    const t = this.trabajo;
    if (!t) {
      this._fijarPrompt(this._promptLibre());
      return;
    }
    if (!this._puedeTrabajar()) {
      // Por robar se deja el trabajo, pero el despeje sigue: puede seguir delante de un carro cuando cambie la luz.
      if (this._robando()) this._cortar('Dejé el trabajo a medias: así nadie me va a pagar.');
      else this.cancelar();
      return;
    }
    const cuidando = t.def.donde === 'parqueados';
    const pos = this.game.player.position;
    if (plano(pos, t.desde) > (cuidando ? SALIR_CUIDANDO_M : SALIR_M)) {
      this._cortar(cuidando ? 'Me alejé y dejé de cuidar los carros.' : 'Me fui antes de terminar y no me dieron nada.');
      return;
    }
    const antes = t.cars.slice();
    if (!this._siguen(t)) {
      // Cambió la luz: el conductor arranca echándolo de la vía.
      if (t.def.donde === 'semaforo') this._hablaConductor(t.def, antes, 'semaforo_verde');
      this._cortar(t.def.donde === 'bus' ? 'El bus arrancó antes de que alcanzara a vender.' : 'Cambió la luz y arrancaron sin pagarme.');
      return;
    }
    t.tiempo += dt;
    t.gesto += dt;
    if (t.gesto >= GESTO_S && !cuidando) { t.gesto = 0; this._pose(t); }
    if (t.def.donde === 'semaforo' && (t.toleraT += dt) >= 1) { t.toleraT = 0; this.despeje.tolerar(pos); }
    if (t.ritmo) t.ritmo.avanzar(t.tiempo);
    if (t.feedback && (t.feedback.s -= dt) <= 0) t.feedback = null;
    if (this.escena) this.escena.tiempo = t.tiempo;
    this._fijarPrompt(this._promptTrabajo(t));
    if (cuidando) this._propinas(t, dt);
    if (t.tiempo >= (cuidando ? t.def.segundos : t.dur)) cuidando ? this._terminar() : this._cobrar();
  }

  /** El aviso cambia pocas veces por segundo: solo se arma el texto cuando cambia lo que dice. */
  _fijarPrompt(clave) {
    if (clave === this._promptClave) return;
    this._promptClave = clave;
    this.prompt = clave;
  }

  _promptLibre() {
    if (this.despeje.paso) return null;
    if (this.despeje.sostiene) return 'Estoy estorbando: me quito de adelante del carro';
    const { eleccion, cerca, motivo } = this.elegir();
    if (eleccion) return `[B] ${eleccion.def.verbo}`;
    if (motivo) return motivo;
    if (cerca && !this._pistaDada && !this._algunaHerramienta()) {
      this._pistaDada = true;
      avisar('Con pelotas, un rodillo o dulces de la tienda podría rebuscarme en este semáforo.', 'info');
    }
    return null;
  }

  _algunaHerramienta() {
    return ['dulces', 'vidrios', 'malabares'].some(id => this._tiene(REBUSQUE[id]));
  }

  _promptTrabajo(t) {
    const cuidando = t.def.donde === 'parqueados';
    const falta = Math.max(0, Math.ceil((cuidando ? t.def.segundos : t.dur) - t.tiempo));
    if (cuidando) return `[B] Dejar el puesto · ${t.def.ocupado}, ${falta} s`;
    const partes = [`${t.def.ocupado}, ${falta} s`];
    if (t.def.donde !== 'semaforo') return partes[0];
    // HUD parte el aviso por el separador: cada pedazo sale en su propia tarjeta.
    const rojo = Math.ceil(this._rojo(t.cars));
    if (rojo <= 2) partes.push('¡Ya cambia! Me quito de la vía');
    else {
      if (Number.isFinite(rojo)) partes.push(`rojo ${rojo} s`);
      if (t.ritmo) {
        const n = t.ritmo.estrellas;
        if (t.feedback) partes.push(t.feedback.texto);
        else if (t.ritmo.altasRestantes(t.tiempo)) partes.push('[B] cuando baje la alta');
        partes.push(n ? '★'.repeat(n) : 'sin ritmo');
      }
    }
    return partes.join(SEPARADOR);
  }

  /** ¿Sigue ahí lo que se está atendiendo? Los carros en rojo y el bus no deben arrancar. */
  _siguen(t) {
    if (t.def.donde === 'semaforo') {
      const enCirculacion = this.game.traffic?.vehicles ?? [];
      t.cars = t.cars.filter(({ vehicle }) => enCirculacion.includes(vehicle) && vehicle.speed <= ARRANCA);
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
    this.escena = null;
    if (t.pesos <= 0) this.game.audio?.play?.('empty');
    avisar(t.pesos > 0 ? `Dejé el puesto: hoy me hice ${cop(t.pesos)} cuidando carros.` : 'Cuidé un rato, pero ningún dueño volvió.', t.pesos > 0 ? 'sell' : 'warn');
    emitir('rebusque', { id: t.def.id, pesos: t.pesos, carros: t.dieron });
  }

  /** Lo que RebusqueVisual necesita para dibujar el trabajo en curso. */
  _escenaTrabajo(t) {
    const first = t.cars[0];
    this.escena = { tipo: t.def.id, car: first?.car ?? null, vehicle: first?.vehicle ?? null, tiempo: 0, dur: t.def.donde === 'parqueados' ? t.def.segundos : t.dur,
      ritmo: t.ritmo, reacciones: [] };
  }

  _contexto(def, car, t) {
    const game = this.game;
    return {
      tipoCarro: car?.kind === 'taxi' || car?.kind === 'buseta' || car?.kind === 'moto' ? car.kind : 'carro',
      calidad: t.ritmo ? t.ritmo.calidad : .5,
      fama: game.reputation?.factor ?? 0,
      franja: game.jornada?.franja ?? null,
      sucio: this._sucio(),
      lluvia: !!game.weather?.isRaining,
      repeticion: this.jornada.repeticion(t.nodo, this._hora()),
      quemado: this.jornada.quemado(t.nodo),
      cansado: this.jornada.cansado(def.id)
    };
  }

  /** Cada carro (o pasajero) decide si da. En el semáforo, cada conductor reacciona a su manera. */
  _cobrar() {
    const t = this.trabajo;
    if (t.def.donde === 'bus') { this._cobrarBus(t); return; }
    const { def, cars } = t;
    const game = this.game, stats = game.stats;
    this._marcar(t);
    this.trabajo = null;
    const sucio = this._sucio();
    // Un trabajo recortado por el rojo paga en proporción; frente a la cola, un poco más.
    const fraccion = Math.min(1, Math.max(.1, t.dur / def.segundos)) * (t.nariz ? NARIZ_EXTRA : 1);
    const cupo = TECHO_MINUTO - this._ganadoMinuto();
    let pesos = 0, dieron = 0, enojado = false;
    const cuenta = {}, reacciones = [], extras = [];
    for (let i = 0; i < cars.length; i++) {
      if (def.consume && !this._tiene(def)) break;
      const { car } = cars[i];
      let r = elegirReaccion(this._contexto(def, car, t), def, this.random);
      if (r.tipo === 'furia' && !this._furia(car)) r = { tipo: 'insulto', pesos: 0, item: null };
      // El billete es un billete: no se recorta con el show ni sube frente a la cola. Lo demás son monedas.
      const billete = r.tipo === 'propina' && !def.consume && r.pesos === PROPINA.billete;
      const monto = r.pesos > 0 ? (def.consume || billete ? r.pesos : Math.max(100, Math.round(r.pesos * fraccion / 100) * 100)) : 0;
      // El primero del minuto pasa entero: así todavía sale, muy de vez en cuando, el billete de $5.000.
      if (monto > 0 && pesos + monto > cupo && (pesos > 0 || cupo < TECHO_MINUTO)) r = { tipo: 'excusa', pesos: 0, item: null };
      cuenta[r.tipo] = (cuenta[r.tipo] ?? 0) + 1;
      reacciones.push({ car, vehicle: cars[i].vehicle ?? null, tipo: r.tipo, t0: i * .35, pesos: r.pesos, item: r.item });
      if (r.pesos > 0) {
        pesos += monto;
        dieron++;
        if (def.consume) game.inventory?.remove?.(def.item, 1);
        if (billete) extras.push(`¡Uno me dio un billete de ${cop(monto)}!`);
      }
      if (r.tipo === 'comida') {
        const item = ITEMS[r.item];
        const cupo = item && game.inventory?.add ? game.inventory.add(item, 1) : false;
        extras.push(cupo ? `Uno me regaló ${item.name.toLowerCase()}.` : 'Me iban a regalar comida, pero no me cabe en el costal.');
      }
      if (r.tipo === 'ventana' && !extras.some(e => /vidrio/.test(e))) extras.push('Uno subió el vidrio y miró al frente.');
      if (r.tipo === 'pito') emitir('car-honk', { x: car.position.x, z: car.position.z });
      if (r.tipo === 'insulto' && !extras.some(e => /gritó/.test(e))) extras.push(`Otro me gritó: «${unoDe(DICHOS.insulto, this.random())}»`);
      if (r.tipo === 'bravo' || r.tipo === 'furia') enojado = true;
    }
    if (pesos > 0) {
      this._pagar(def, pesos, dieron);
      this._ganado.push([this._t, pesos]);
      if (++this._pagados % 3 === 0) game.reputation?.sumar?.(1);
    } else {
      if (stats) stats.animo = Math.max(0, (stats.animo ?? 0) - (enojado || cuenta.insulto ? 3 : 1));
      game.audio?.play?.('empty');
    }
    if (cuenta.insulto && stats) stats.animo = Math.max(0, (stats.animo ?? 0) - 1);
    this.jornada.registrar(def.id, t.nodo, this._hora());
    const aplauso = t.ritmo && t.ritmo.calidad >= .85;
    let texto = this._texto(def, pesos, dieron, enojado, sucio);
    if (aplauso) texto = `¡Me aplaudieron desde los carros! ${texto}`;
    if (extras.length) texto += ` ${extras.slice(0, 2).join(' ')}`;
    avisar(texto, pesos > 0 ? 'sell' : 'warn');
    this._vozReaccion(reacciones, aplauso, def.id);
    // Las pelotas que iban en el aire caen en las manos (RebusqueVisual): las manos siguen arriba para recibirlas.
    if (def.id === 'malabares' && game.player?.modelKind !== 'procedural') game.player?.playAction?.('malabares', ATRAPAR_S);
    this.escena = { tipo: 'cobro', trabajo: def.id, car: cars[0]?.car ?? null, tiempo: 0, dur: COBRO_S, ritmo: null, reacciones };
    emitir('rebusque', { id: def.id, pesos, carros: dieron });
  }

  /** Lo cobrado en el semáforo en el último minuto real. */
  _ganadoMinuto() {
    while (this._ganado.length && this._t - this._ganado[0][0] >= MINUTO_S) this._ganado.shift();
    let n = 0;
    for (const [, pesos] of this._ganado) n += pesos;
    return n;
  }

  /** Un conductor se baja con varilla: una vez por día, con RoadRage libre y sin patrulla cerca. */
  _furia(car) {
    const rage = this.game.roadRage;
    if (this.jornada.furiaHoy || !rage?.trigger || rage.state !== 'idle') return false;
    const patrulla = (this.game.traffic?.vehicles ?? []).some(v => v.police && v.state === 'patrol' && v.car?.position && plano(v.car.position, car.position) < 25);
    if (patrulla) return false;
    if (!rage.trigger(car)) return false;
    this.jornada.furiaHoy = true;
    // La voz sigue al cuerpo: antes de que el carro grite, queda con un conductor del sexo de quien se va a bajar.
    // Si al carro ya se le oyó otra voz, la conserva (como en el robo del espejo) y VoiceDirector le da la pareja.
    const sexo = (rage.driverOf?.(car) ?? rage.driver)?.look?.real?.sexo, voces = this.game.audio?.vehicles;
    if (sexo && voces?.recastDriver && !voces.heard?.(car)) voces.recastDriver(car, sexo);
    avisar('El conductor se bajó con una varilla: ¡no pidió que le limpiara el vidrio!', 'danger');
    return true;
  }

  /** Una sola voz por trabajo: la reacción más fuerte. La clave nueva solo si tiene audio. */
  _vozReaccion(reacciones, aplauso, trabajo) {
    const audio = this.game.audio;
    if (!audio?.playDriverLine) return;
    const prioridad = ['furia', 'bravo', 'insulto', 'propina', 'compra', 'paga', 'comida', 'excusa'];
    for (const tipo of prioridad) {
      const r = reacciones.find(x => x.tipo === tipo);
      if (!r) continue;
      const claves = aplauso && tieneVoz('semaforo_aplauso') && ['propina', 'paga'].includes(tipo) ? ['semaforo_aplauso'] : clavesVoz(tipo, trabajo);
      const clave = claves.find(tieneVoz);
      if (clave) { audio.playDriverLine(r.car, clave); return; }
    }
  }

  /** En el bus cada pasajero es una venta posible. La higiene baja espanta a la mitad. */
  _cobrarBus(t) {
    const { def, cars } = t;
    const game = this.game, stats = game.stats;
    this._marcar(t);
    this.trabajo = null;
    this.escena = null;
    const sucio = this._sucio();
    const prob = def.prob * (sucio ? .5 : 1);
    let pesos = 0, dieron = 0;
    for (let i = 0; i < def.carros; i++) {
      if (def.consume && !this._tiene(def)) break;
      if (this.random() >= prob) continue;
      pesos += this._monto(def);
      dieron++;
      if (def.consume) game.inventory?.remove?.(def.item, 1);
    }
    if (pesos > 0) this._pagar(def, pesos, dieron);
    else {
      if (stats) stats.animo = Math.max(0, (stats.animo ?? 0) - 1);
      game.audio?.play?.('empty');
    }
    avisar(this._texto(def, pesos, dieron, false, sucio), pesos > 0 ? 'sell' : 'warn');
    this._hablaConductor(def, cars, pesos > 0 ? 'semaforo_si' : 'semaforo_no');
    emitir('rebusque', { id: def.id, pesos, carros: dieron });
  }

  /** El conductor del primer carro (o el busetero) responde con su voz: da, no da, se pone bravo o arranca. */
  _hablaConductor(def, cars, situacion) {
    if (def.donde !== 'semaforo' && def.donde !== 'bus') return;
    const quien = cars[0]?.car ?? cars[0]?.bus;
    if (quien) this.game.audio?.playDriverLine?.(quien, situacion, { bus: def.donde === 'bus' });
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
