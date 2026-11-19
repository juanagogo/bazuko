// src/systems/voces/VocesDelMundo.js
// Las voces que no son de un peatón. Salen de donde está quien habla, por el mismo canal que la gente de la calle
// (VoiceDirector.decirDesde): una sola voz a la vez, más bajo de lejos y con la burbuja encima.
//  - La Policía. La patrulla que persigue grita cada tanto y, de lejos, a veces por el megáfono. Por la radio de la
//    patrulla más cercana se oye a la operadora cuando empieza una persecución, cuando un testigo termina de llamar
//    (anuncia un robo solo si llamó por un robo) y cuando el jugador se les vuela, y al agente que pide apoyo cuando
//    se bajan a seguirlo a pie. Al arrestarlo, la patrulla lo dice aunque otra voz esté sonando y aunque el juego ya
//    esté en pausa.
//  - El jíbaro. De noche le ofrece en susurro a quien pasa cerca de su esquina, cada tanto y solo si nadie más habla.
//  - El voceador del bus. Cuando el bus para en su estación con el jugador cerca, vocea una vez por parada.
// Los tiempos y los sorteos son de aquí: no gastan el azar del tráfico ni el de la gente, y nada de esto cambia lo
// que hace la Policía.
import { FRASES, frasesDe } from '../../data/vocesCalle.js';
import { PRIORIDAD_VOZ } from './prioridad.js';
import { azarDeVoces } from './azar.js';

const POLICIAS = ['policia_a', 'policia_b'];
/** Gritos de la patrulla que persigue: cada `min` a `min + extra` segundos; de lejos, a veces el megáfono. */
export const GRITO_POLICIA = Object.freeze({ rango: 26, nivel: .95, min: 5, extra: 4, megafonoDesde: 11, megafonoAzar: .35, primero: 1.5 });
/** La radio se oye desde la patrulla más cercana; sin una cerca, nadie la oye. Cada frase espera `caduca` segundos su turno. */
export const RADIO_POLICIA = Object.freeze({ rango: 35, nivel: .7, pausa: .5, caduca: 6 });
/**
 * Lo que dice la operadora cuando un testigo termina de llamar, según por qué llamó: solo anuncia un robo si lo hubo.
 * Por una pelea o sin motivo conocido manda la patrulla sin nombrarlo («Atención patrullas, sospechoso a pie…»).
 */
export const RADIO_LLAMADA = Object.freeze({ robo: 'operadora_radio_2', muerte: 'operadora_radio_3', otro: 'operadora_radio_1' });
/** Al arrestar, si el audio aún no cargó, se vuelve a intentar cada `cada` ms, `veces` veces. */
export const ARRESTO = Object.freeze({ cada: 250, veces: 12 });

/** El susurro del jíbaro: de noche, a menos de `rango` m, cada `min` a `min + extra` segundos; el primero, antes. */
export const SUSURRO_JIBARO = Object.freeze({ rango: 7, nivel: .9, min: 11, extra: 9, primero: 3.3, precarga: 14 });

/** El voceador del bus: a menos de `rango` m, una vez por parada; `alto` es lo que mide el bus, para su burbuja. */
export const VOCEADOR_BUS = Object.freeze({ rango: 20, nivel: .85, precarga: 30, alto: 3.15 });

const POR_ID = new Map(FRASES.map(frase => [frase.id, frase]));
const JIBARO = frasesDe('ofrece', 'jibaro');
const [SALUDO_JIBARO, INVITACION_JIBARO, AVISO_JIBARO, AFAN_JIBARO] = JIBARO;
const LLAMADOS_JIBARO = [SALUDO_JIBARO, INVITACION_JIBARO];
const PATRULLA_CERCA = 16;
const tripulada = vehicle => !!vehicle && vehicle.state !== 'uncrewed' && !vehicle.crew?.officers?.every(npc => npc.isDead);

export class VocesDelMundo {
  /** `voces` es el VoiceDirector. Los avisos de la Policía llegan por `eventTarget` (la ventana). */
  constructor({ voces, eventTarget = globalThis.window, random = azarDeVoces(), esperar = (fn, ms) => globalThis.setTimeout?.(fn, ms) } = {}) {
    this.voces = voces;
    this.random = random;
    this.esperar = esperar;
    this.eventTarget = eventTarget;
    this._vozPatrulla = new WeakMap(); // patrulla → policia_a o policia_b, fija
    this._turno = 0;
    this._gritoEn = GRITO_POLICIA.primero;
    this._radioCola = [];              // lo que sigue en la radio: { frase, car, espera, caduca }
    this._aPie = new WeakSet();        // patrullas cuyos agentes ya van a pie en esta persecución
    this._vehiculos = [];
    this._oyente = null;
    this.jibaro = null;                // lo pone el juego: el jíbaro del distrito
    this._jibaroEn = SUSURRO_JIBARO.primero;
    this._saludoJibaro = null;
    this._voceados = new WeakSet();    // buses que ya vocearon en la parada en la que están
    this._avisos = {
      'police-chase': () => this._radio([['operadora_radio_1']]),
      'police-radio': event => { if (event?.detail?.reason === 'llamada') this._radio([[RADIO_LLAMADA[event.detail.motivo] ?? RADIO_LLAMADA.otro]]); },
      'police-escaped': () => this._radio([[this.random() < .5 ? 'escape_1' : 'radio_2', true], ['operadora_radio_4']], false),
      'police-arrest': () => this._arresto(),
    };
    for (const [tipo, aviso] of Object.entries(this._avisos)) eventTarget?.addEventListener?.(tipo, aviso);
  }

  /** La patrulla queda con una de las dos voces de policía, una y otra por turnos. */
  vozDePatrulla(car) {
    const agente = this._agente(this._vehiculos.find(vehicle => vehicle?.car === car));
    if (agente?._voz) return agente._voz;
    if (!this._vozPatrulla.has(car)) this._vozPatrulla.set(car, POLICIAS[this._turno++ % POLICIAS.length]);
    return this._vozPatrulla.get(car);
  }

  _agente(vehicle) {
    const tripulacion = vehicle?.crew;
    if (!tripulacion?.officers) return null;
    let cercano = null, distancia = Infinity;
    for (const agente of tripulacion.officers) {
      if (agente.isDead || !agente.out || !agente.position || !this._oyente) continue;
      const p = agente.position, o = this._oyente;
      const d = Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z);
      if (d < distancia) { cercano = agente; distancia = d; }
    }
    return cercano ?? tripulacion.officers.find(npc => npc === tripulacion.driver && !npc.isDead)
      ?? tripulacion.officers.find(npc => !npc.isDead);
  }

  /** La patrulla más cercana al jugador dentro de `rango`; con `persigue`, solo las que lo persiguen. */
  _patrulla(rango, persigue = false) {
    const oyente = this._oyente;
    if (!oyente) return null;
    let mejor = null, distancia = rango;
    for (const vehicle of this._vehiculos) {
      const car = vehicle?.car;
      if (!vehicle?.police || !car?.position || !tripulada(vehicle)) continue;
      if (persigue && vehicle.state !== 'chase' && !car.pursuit) continue;
      const agente = this._agente(vehicle);
      const posicion = agente?.out ? agente.position : car.position;
      const d = Math.hypot(posicion.x - oyente.x, posicion.y - oyente.y, posicion.z - oyente.z);
      if (d < distancia) { mejor = vehicle; distancia = d; }
    }
    return mejor ? { vehicle: mejor, car: mejor.car, distancia } : null;
  }

  /**
   * Una conversación por la radio de una patrulla: cada paso es [id o situación, ¿la dice el agente?]. Los pasos del
   * agente usan la voz de esa patrulla; los demás son frases fijas (la operadora). Sin `car`, la más cercana:
   * primero una que persiga si `persigue`.
   */
  _radio(pasos, persigue = true, car = null) {
    car ??= ((persigue && this._patrulla(RADIO_POLICIA.rango, true)) || this._patrulla(RADIO_POLICIA.rango))?.car;
    if (!car) return false;
    const voz = this.vozDePatrulla(car);
    this._radioCola = pasos.map(([id, agente]) => ({ frase: POR_ID.get(agente ? `${voz}_${id}` : id), car, espera: RADIO_POLICIA.pausa, caduca: RADIO_POLICIA.caduca }))
      .filter(paso => paso.frase);
    this.voces.preparar(this._radioCola.map(paso => paso.frase));
    return this._radioCola.length > 0;
  }

  _decir(frases, car, opciones) {
    const policia = POLICIAS.includes(frases[0]?.voz);
    const patrulla = policia ? this._vehiculos.find(vehicle => vehicle?.car === car) : null;
    if (policia && !tripulada(patrulla)) return false;
    const agente = this._agente(patrulla);
    if (agente?._voz && agente._voz !== frases[0].voz) return false;
    const fuente = agente?.out ? agente : this.voces.desde(car);
    const sonando = this.voces.decirDesde(fuente, frases, { pleno: 0, ...opciones });
    if (sonando) this._hablante = agente ? { agente, fuente, car } : null;
    return sonando;
  }

  retirar(npc) {
    if (this._hablante?.agente !== npc) return;
    this.voces.retirar(this._hablante.fuente);
    this._hablante = null;
  }

  get jibaroAbierto() { return !!this._saludoJibaro; }

  /** Saluda al abrir su panel. La línea queda como subtítulo aunque todavía no haya audio. */
  saludarJibaro(jibaro, noche = jibaro?.isNight) {
    if (jibaro !== this.jibaro || !jibaro?.position || jibaro._destruido) return '';
    this.cerrarJibaro();
    const yaSaludo = this._jibaroEn > 0 && this.voces.ultima?.id === SALUDO_JIBARO.id;
    const frase = noche && yaSaludo ? AFAN_JIBARO : SALUDO_JIBARO;
    const saludo = { source: { get position() { return jibaro.position; }, get _disposed() { return jibaro._destruido; } }, cancelarCarga: null };
    this._saludoJibaro = saludo;
    this._jibaroEn = Math.max(this._jibaroEn, SUSURRO_JIBARO.min);
    saludo.cancelarCarga = this.voces.alCargar(frase, () => {
      if (this._saludoJibaro !== saludo || jibaro._destruido) return;
      this.voces.decirDesde(saludo.source, [frase], { enPausa: true, prioridad: PRIORIDAD_VOZ.dealerReply,
        clave: 'jibaro:saludo', rango: SUSURRO_JIBARO.rango, pleno: 3, nivel: .95 });
    });
    return frase.text;
  }

  cerrarJibaro() {
    const saludo = this._saludoJibaro;
    if (!saludo) return;
    this._saludoJibaro = null;
    saludo.cancelarCarga?.();
    this.voces.cancel(saludo.source);
  }

  /**
   * Lo cogieron: la patrulla que llega lo dice, aunque otra voz estuviera sonando. El juego se pausa con el mismo
   * aviso, así que la frase vale en pausa y, si aún no cargó, sale en cuanto carga.
   */
  _arresto(intento = 0) {
    const patrulla = this._patrulla(RADIO_POLICIA.rango, true) ?? this._patrulla(RADIO_POLICIA.rango);
    if (!patrulla) return false;
    this._radioCola = [];
    const voz = this.vozDePatrulla(patrulla.car);
    const dicho = this._decir(frasesDe('arresto', voz), patrulla.car, { prioridad: PRIORIDAD_VOZ.arrest, clave: `arresto:${voz}`,
      rango: RADIO_POLICIA.rango, nivel: GRITO_POLICIA.nivel, forzar: true, enPausa: true });
    if (!dicho && intento < ARRESTO.veces) this.esperar(() => this._arresto(intento + 1), ARRESTO.cada);
    return dicho;
  }

  /** Cada cuadro de juego: `oyente` es la posición del jugador, `vehiculos` los del tráfico y `buses` el bus o los buses. */
  update(dt, oyente, vehiculos = [], buses = null) {
    this._oyente = oyente;
    this._vehiculos = vehiculos ?? [];
    if (!oyente || !(dt > 0) || this.voces.paused) return;
    if (this._hablante) {
      const { agente, fuente, car } = this._hablante;
      const ahora = agente.out ? agente : this.voces.desde(car);
      if (fuente !== ahora) {
        if (this.voces.seguirFuente(fuente, ahora)) this._hablante.fuente = ahora;
        else this._hablante = null;
      }
    }
    this._agentesAPie();
    this._avanzarRadio(dt);
    this._gritos(dt);
    this._susurro(dt);
    this._voceador(buses);
  }

  /** El bus que está parado en su estación vocea una vez por parada si el jugador está cerca y nadie más habla. */
  _voceador(buses) {
    if (!buses) return;
    const frases = frasesDe('voceador', 'busetero');
    for (const bus of Array.isArray(buses) ? buses : [buses]) {
      const sitio = bus?.position;
      if (!sitio) continue;
      const distancia = Math.hypot(sitio.x - this._oyente.x, sitio.y - this._oyente.y, sitio.z - this._oyente.z);
      if (distancia <= VOCEADOR_BUS.precarga) this.voces.preparar(frases);
      if (!(bus.dwellRemaining > 0)) { this._voceados.delete(bus); continue; }
      if (this._voceados.has(bus) || bus.group?.visible === false || distancia > VOCEADOR_BUS.rango || !this.voces.libre) continue;
      const dicho = this.voces.decirDesde(this.voces.desde(bus, VOCEADOR_BUS.alto), frases,
        { pleno: 0, prioridad: PRIORIDAD_VOZ.busCaller, clave: 'voceador', rango: VOCEADOR_BUS.rango, nivel: VOCEADOR_BUS.nivel });
      if (dicho) this._voceados.add(bus);
    }
  }

  /** De noche, el jíbaro le ofrece en susurro a quien pasa cerca, si nadie más está hablando. */
  _susurro(dt) {
    const jibaro = this.jibaro, sitio = jibaro?.position;
    if (!sitio || jibaro._destruido || !jibaro.isNight) return;
    const distancia = Math.hypot(sitio.x - this._oyente.x, sitio.y - this._oyente.y, sitio.z - this._oyente.z);
    if (distancia <= SUSURRO_JIBARO.precarga) this.voces.preparar(JIBARO);
    if ((this._jibaroEn -= dt) > 0 || distancia > SUSURRO_JIBARO.rango || !this.voces.libre) return;
    const patrullaCerca = this._vehiculos.some(vehicle => {
      const punto = vehicle?.car?.position;
      return vehicle?.police && punto && Math.hypot(sitio.x - punto.x, sitio.y - punto.y, sitio.z - punto.z) <= PATRULLA_CERCA;
    });
    const frases = patrullaCerca && this.voces.ultima?.id !== AVISO_JIBARO.id ? [AVISO_JIBARO] : LLAMADOS_JIBARO;
    if (this._decir(frases, jibaro, { prioridad: PRIORIDAD_VOZ.dealerWhisper, clave: 'jibaro', rango: SUSURRO_JIBARO.rango,
      nivel: SUSURRO_JIBARO.nivel, limpiarAlCortar: true })) {
      this._jibaroEn = SUSURRO_JIBARO.min + this.random() * SUSURRO_JIBARO.extra;
    }
  }

  /** Los agentes de una patrulla se bajan a seguirlo a pie: uno pide apoyo por la radio y la operadora le contesta. */
  _agentesAPie() {
    for (const vehicle of this._vehiculos) {
      if (!vehicle?.police || !vehicle.car || !tripulada(vehicle)) continue;
      const aPie = !!vehicle.crew?.pursuitOnFoot;
      if (!aPie) { this._aPie.delete(vehicle.car); continue; }
      if (this._aPie.has(vehicle.car)) continue;
      this._aPie.add(vehicle.car);
      const p = vehicle.car.position, o = this._oyente;
      if (p && Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z) < RADIO_POLICIA.rango) this._radio([['radio_1', true], ['operadora_radio_3']], true, vehicle.car);
    }
  }

  _avanzarRadio(dt) {
    const paso = this._radioCola[0];
    if (!paso) return;
    const patrulla = this._vehiculos.find(vehicle => vehicle?.car === paso.car);
    if (!tripulada(patrulla)) { this._radioCola = []; return; }
    if ((paso.caduca -= dt) <= 0) { this._radioCola.shift(); return; }
    if (!this.voces.libre || (paso.espera -= dt) > 0 || !this.voces.lista(paso.frase)) return;
    this._radioCola.shift();
    this._decir([paso.frase], paso.car, { prioridad: PRIORIDAD_VOZ.radio, clave: `radio:${paso.frase.id}`, rango: RADIO_POLICIA.rango, nivel: RADIO_POLICIA.nivel });
  }

  _gritos(dt) {
    const patrulla = this._patrulla(GRITO_POLICIA.rango, true);
    if (!patrulla) { this._gritoEn = Math.max(this._gritoEn, GRITO_POLICIA.primero); return; }
    const voz = this.vozDePatrulla(patrulla.car);
    // Lo que puede gritar esa patrulla se pide en cuanto persigue de cerca, para tenerlo listo.
    this.voces.preparar([...frasesDe('grito', voz), ...frasesDe('megafono', voz), ...frasesDe('arresto', voz)]);
    if ((this._gritoEn -= dt) > 0 || this._radioCola.length || !this.voces.libre) return;
    this._gritoEn = GRITO_POLICIA.min + this.random() * GRITO_POLICIA.extra;
    const megafono = patrulla.distancia > GRITO_POLICIA.megafonoDesde && this.random() < GRITO_POLICIA.megafonoAzar;
    const situacion = megafono ? 'megafono' : 'grito';
    this._decir(frasesDe(situacion, voz), patrulla.car, { prioridad: PRIORIDAD_VOZ.policeShout, clave: `${situacion}:${voz}`,
      rango: GRITO_POLICIA.rango, nivel: GRITO_POLICIA.nivel });
  }

  dispose() {
    this.cerrarJibaro();
    for (const [tipo, aviso] of Object.entries(this._avisos)) this.eventTarget?.removeEventListener?.(tipo, aviso);
    this._radioCola = [];
  }
}
