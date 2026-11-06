// src/systems/voces/VoiceDirector.js
// Le pone voz a lo que pasaba callado, sin tocar los sistemas que lo cuentan: escucha sus eventos (limosna, tienda,
// recicladora, jíbaro, requisa, atropello) y mira cada cuarto de segundo al conductor bravo, la patrulla y la gente
// quieta. Usa las grabaciones que ya hay (data/vocesReuso.js) y, donde no hay ninguna que sirva, el vocalizador.
// También pone los subtítulos de quien no es peatón (Policía, radio, jíbaro, bus, conductores), precarga lo que la
// persona de al lado está por decir y le pasa a AudioSystem lo que solo el juego sabe (el sexo de quien se baja del
// carro y hasta dónde persigue la Policía).
import { NPC_VOICE_BANK } from '../../data/npcVoices.js';
import { ShuffleBag, sameSex } from '../voiceVariety.js';
import { Burbujas } from '../../ui/burbujaVoz.js';
import { Vocalizador, vocalizarFaltante } from './Vocalizador.js';
import { vozOcupada } from './hablar.js';
import { PRIORIDAD_VOZ } from './prioridad.js';
import { vozDeConductorSegunSexo } from '../VehicleAudio.js';

export const DIRECTOR = Object.freeze({
  mirarCada: .25,
  limosna: { alcance: 7, espera: 4 },
  tienda: { espera: 20, sucio: 20 },
  recicladora: { alcance: 6, espera: 30 },
  jibaro: { espera: 12 },
  atropello: { demora: .6, alcance: 12, reintento: .3, espera: 3 },
  bravo: { primera: 1.2, min: 4, extra: 3 },
  tomba: { patrulla: 30, pelado: 6, espera: 90 },
  murmullo: { alcance: 7, min: 1.4, extra: 1.8 },
  ronquido: { alcance: 4, cada: 3.5 },
  precarga: { alcance: 5, mirarCada: 1, porSegundo: 2, categorias: ['robbed', 'begYes', 'begNo'] },
  lugar: { alcance: 14, nivel: .85 },
});

// La voz del reparto que le toca al conductor según la del carro del que se bajó.
const VOZ_DE_CARRO = { roberto: 'roberto', valentina: 'conductora', conductor: 'conductor', conductora: 'conductora', busetero: 'busetero' };
// Sin frase grabada, el carro de Roberto contesta en el semáforo con su tono.
const GESTO_SEMAFORO = { semaforo_si: 'mmm', semaforo_no: 'mmm_no', semaforo_bravo: 'ey', semaforo_verde: 'ey' };
const ALTO_BUS = 1.2;

export class VoiceDirector {
  constructor({ game, audio, eventTarget = globalThis.window, random = Math.random, doc = globalThis.document } = {}) {
    this.game = game;
    this.audio = audio;
    this.eventTarget = eventTarget;
    this.random = random;
    this.vocalizador = audio.vocalizador ??= new Vocalizador({ audio, random });
    this.burbujas = new Burbujas({ doc });
    this._clock = 0;
    this._mirar = 0;
    this._libre = new Map();       // clave → reloj desde el que se puede volver a decir
    this._luego = [];              // { at, fn }: lo que pasa un momento después de un evento
    this._bags = new Map();
    this._bravo = { state: 'idle', next: 0 };
    this._murmullo = { next: 0, turno: 0 };
    this._ronquido = 0;
    this._precarga = [];           // rutas por precargar, de a dos por segundo
    this._enCola = new Set();
    this._precargaIn = 0; this._mirarPrecarga = 0;
    this._cercano = null;
    this._ganchos();
    this._handlers = {
      'beg-result': event => this._limosna(event?.detail),
      'open-shop': event => this._tienda(event?.detail?.target),
      'open-recycler': () => this._recicladora(),
      'dealer-toggle': event => this._jibaro(event?.detail?.dealer, (event?.detail?.dealer ?? this.game?.dealer)?.isNight ? 'dealerOpen' : 'dealerDay'),
      'substance-buy-fail': event => { if (event?.detail?.reason === 'insufficient_money') this._jibaro(this.game?.dealer, 'dealerBroke'); },
      'substance-fail': event => { if (event?.detail?.reason === 'day') this._jibaro(this.game?.dealer, 'dealerDay'); },
      'substance-raid': () => this._requisa(),
      'peaton-atropellado': event => this._atropello(event?.detail?.npc),
      // game.js escucha este evento antes (RoadRageSystem.trigger): aquí ya se sabe si alguien se baja del carro.
      'mirror-stolen': event => this._roboEspejo(event?.detail?.car),
    };
    for (const [type, handler] of Object.entries(this._handlers)) eventTarget?.addEventListener?.(type, handler);
  }

  /** Lo que AudioSystem y WorldVoices le preguntan o le avisan al juego. */
  _ganchos() {
    const audio = this.audio;
    const alto = source => (source?.dwellRemaining !== undefined || source?.isBus ? ALTO_BUS : 0);
    audio.onVoiceLine = (car, text, seconds) => this.burbujas.decir(car, text, seconds, { offsetY: alto(car) });
    if (audio.worldVoices) audio.worldVoices.onLine = (frase, position, { radio = false, seconds = 2, source = null } = {}) =>
      this.burbujas.decir(source ?? { position }, radio ? `Radio: ${frase.text}` : frase.text, seconds, { offsetY: alto(source) });
    audio.policeRange = () => this.game?.traffic?.giveUpRange;
    audio.onSilentDriver = (car, situacion) => {
      const gesto = GESTO_SEMAFORO[situacion];
      if (gesto) this.vocalizador.decir(car, gesto, { sexo: 'hombre', voz: 'roberto' });
      return false;
    };
  }

  _puede(clave, espera) {
    if ((this._libre.get(clave) ?? -Infinity) > this._clock) return false;
    this._libre.set(clave, this._clock + espera);
    return true;
  }

  get _jugador() { return this.game?.player?.position ?? null; }
  get _gente() { return this.game?.world?.active?.npcs ?? []; }

  /** La persona más cercana al jugador dentro de `alcance`, que pueda hablar y pase `filtro`. */
  _masCercana(alcance, filtro = null, desde = this._jugador, excepto = null) {
    if (!desde) return null;
    let mejor = null, mejorDist = alcance;
    for (const npc of this._gente) {
      if (!npc?.position || npc === excepto || npc._disposed || npc.koState || npc.hp <= 0 || npc.stance === 'dormido') continue;
      if (filtro && !filtro(npc)) continue;
      const d = desde === this._jugador && Number.isFinite(npc._playerDist) ? npc._playerDist : npc.position.distanceTo(desde);
      if (d < mejorDist) { mejor = npc; mejorDist = d; }
    }
    return mejor;
  }

  _decir(npc, category) { return !!npc?.speakScenario?.(category, true); }

  /** Una frase de `category` con la voz `voz`, desde un sitio (la tienda, la recicladora, el jíbaro, la requisa). */
  _decirEn(source, category, voz, { force = false, allowPaused = true, subtitulo = true } = {}) {
    const position = source?.position;
    if (!position) return false;
    const lines = (NPC_VOICE_BANK[category] ?? []).filter(entry => !voz || entry.voz === voz);
    if (!lines.length) return false;
    const key = `${category}_${voz}`;
    if (!this._bags.has(key)) this._bags.set(key, new ShuffleBag(this.random));
    const entry = this._bags.get(key).draw(lines, item => item.audio);
    const onStart = seconds => { if (subtitulo && entry.text) this.burbujas.decir(source, entry.text, seconds); };
    return this.audio.playNpcVoice(entry.audio, { position }, {
      range: DIRECTOR.lugar.alcance, level: DIRECTOR.lugar.nivel, priority: PRIORIDAD_VOZ[category] ?? 0, force, allowPaused, onStart,
    }) || this.audio.lastRefusal === 'espera';
  }

  // ——— Eventos ———

  _limosna(detail) {
    if (!detail) return;
    const category = detail.success ? (detail.item ? 'begFood' : 'begYes')
      : detail.reason === 'higiene' ? 'smell' : detail.reason === 'ignored' ? 'begNo' : null;
    if (!category) return;
    const npc = this._masCercana(DIRECTOR.limosna.alcance, n => !n.isVendor);
    if (npc && this._puede('limosna', DIRECTOR.limosna.espera)) this._decir(npc, category);
  }

  /** Doña Rosa saluda desde el mostrador; si el jugador huele mal, se queja. La tienda abre un menú: suena en pausa. */
  _tienda(target) {
    const position = target?.position ?? target?.group?.position;
    if (!position || !this._puede('tienda', DIRECTOR.tienda.espera)) return;
    const sucio = (this.game?.stats?.higiene ?? 100) < DIRECTOR.tienda.sucio;
    this._decirEn({ position }, sucio ? 'shopDirty' : 'shopGreet', 'vendedora', { subtitulo: false });
  }

  _recicladora() {
    const position = this.game?.sellPoint?.position;
    const player = this._jugador;
    if (!position || (player && position.distanceTo(player) > DIRECTOR.recicladora.alcance)) return;
    if (this._puede('recicladora', DIRECTOR.recicladora.espera)) this._decirEn({ position }, 'recycler', 'reciclador', { subtitulo: false });
  }

  _jibaro(dealer, category) {
    if (!dealer?.position || dealer._disposed || !this._puede(`jibaro_${category}`, DIRECTOR.jibaro.espera)) return;
    this._decirEn(dealer, category, 'jibaro', { subtitulo: false });
  }

  /** La requisa: la Policía cae en plena venta y grita desde donde está el jíbaro. */
  _requisa() {
    const dealer = this.game?.dealer;
    if (!dealer?.position) return;
    this._decirEn(dealer, 'raid', this.random() < .5 ? 'policia_a' : 'policia_b', { force: true, subtitulo: false });
  }

  /** Atropellaron a alguien: un momento después, quien está cerca y lo vio grita. */
  _atropello(victima) {
    if (!victima?.position) return;
    const lugar = victima.position.clone?.() ?? victima.position;
    const { demora, alcance, reintento, espera } = DIRECTOR.atropello;
    const hasta = this._clock + demora + espera;
    const intento = () => {
      const testigo = this._masCercana(alcance, n => !n.isVendor, lugar, victima);
      if (!testigo) return;
      // Mientras grita la víctima (u otra voz que pesa más) espera su turno; si no le llega, se le sale su «uy».
      if (vozOcupada(testigo, 'witnessRunOver')) {
        if (this._clock + reintento <= hasta) this._luego.push({ at: this._clock + reintento, fn: intento });
        else vocalizarFaltante(testigo, 'witnessRunOver');
        return;
      }
      this._decir(testigo, 'witnessRunOver');
    };
    this._luego.push({ at: this._clock + demora, fn: intento });
  }

  // ——— Cada cuadro ———

  update(dt) {
    if (!(dt > 0)) return;
    this._clock += dt;
    this.vocalizador.update();
    this.burbujas.update(dt);
    for (let i = this._luego.length - 1; i >= 0; i--) {
      if (this._luego[i].at > this._clock) continue;
      const { fn } = this._luego[i];
      this._luego.splice(i, 1);
      fn();
    }
    this._actualizarPrecarga(dt);
    if ((this._mirar -= dt) > 0) return;
    this._mirar = DIRECTOR.mirarCada;
    this._conductorBravo();
    this._tomba();
    this._ambiente();
  }

  /** El conductor bravo: al bajarse toma la voz del carro (de su sexo), grita mientras persigue y resopla al alzar la varilla. */
  _conductorBravo() {
    const rr = this.game?.roadRage, driver = rr?.driver;
    const state = driver?.state ?? 'idle';
    const before = this._bravo.state;
    if (state === before) {
      if ((state === 'chase' || state === 'strike') && this._clock >= this._bravo.next) {
        this._bravo.next = this._clock + DIRECTOR.bravo.min + this.random() * DIRECTOR.bravo.extra;
        this._decir(driver, 'roadRage');
      }
      return;
    }
    this._bravo.state = state;
    if (!driver || state === 'idle' || state === 'return') return;
    if (before === 'idle') this._vozDelConductor(driver, driver.car ?? rr.vehicle?.car);
    if (state === 'chase' && before === 'idle') this._bravo.next = this._clock + DIRECTOR.bravo.primera;
    else if (state === 'flee') this._decir(driver, 'carjacked');
    else if (state === 'windup') this.vocalizador.decir(driver, 'uf');
  }

  /**
   * El reclamo por el espejo es de la voz del sexo de quien se baja con la varilla, pero solo si de verdad se baja
   * (RoadRageSystem decide al azar) y nadie le había oído otra voz a ese carro.
   */
  _roboEspejo(car) {
    const rr = this.game?.roadRage;
    if (!car || !rr?.vehicle || rr.vehicle.car !== car) return;
    this.audio.recastMovingTheft?.(car, rr.driver?.look?.real?.sexo);
  }

  /**
   * La voz sigue al cuerpo: el carro queda con un conductor del sexo de quien se bajó, y él con la voz de ese carro.
   * Si al carro ya se le oyó una voz del otro sexo, el carro la conserva y quien se bajó habla con la pareja de esa voz.
   */
  _vozDelConductor(driver, car) {
    const sexo = driver.look?.real?.sexo;
    if (!car || !sexo || !this.audio.vehicles?.recastDriver) return;
    const voice = vozDeConductorSegunSexo(this.audio.vehicles.recastDriver(car, sexo), sexo);
    if (VOZ_DE_CARRO[voice]) driver._voz = VOZ_DE_CARRO[voice];
  }

  /** Con una patrulla cerca, el pelado que está al lado avisa. */
  _tomba() {
    const player = this._jugador;
    if (!player || (this._libre.get('tomba') ?? -Infinity) > this._clock) return;
    let patrulla = false;
    for (const vehicle of this.game?.traffic?.vehicles ?? []) {
      if (vehicle?.police && vehicle.car?.position && vehicle.car.position.distanceTo(player) < DIRECTOR.tomba.patrulla) { patrulla = true; break; }
    }
    if (!patrulla) return;
    const pelado = this._masCercana(DIRECTOR.tomba.pelado, n => !n.isVendor && (n._voz ??= n._castVoice?.() ?? null) === 'nero_pelado');
    if (pelado && this._puede('tomba', DIRECTOR.tomba.espera)) this._decir(pelado, 'tomba');
  }

  /** La pareja que conversa murmura y quien duerme ronca: de a uno, bajito y solo de cerca. */
  _ambiente() {
    const pareja = this._masCercana(DIRECTOR.murmullo.alcance, n => n.stance === 'hablar' && !!n.fijo?.pareja && !n.fijo.out);
    if (pareja && this._clock >= this._murmullo.next) {
      const quien = this._murmullo.turno++ % 2 ? pareja.fijo.pareja : pareja;
      if (this.vocalizador.decir(quien, 'murmullo')) this._murmullo.next = this._clock + DIRECTOR.murmullo.min + this.random() * DIRECTOR.murmullo.extra;
    }
    if (this._clock < this._ronquido) return;
    const player = this._jugador;
    if (!player) return;
    for (const npc of this._gente) {
      if (npc?.stance !== 'dormido' || npc.koState || npc._disposed || !npc.position) continue;
      const d = Number.isFinite(npc._playerDist) ? npc._playerDist : npc.position.distanceTo(player);
      if (d >= DIRECTOR.ronquido.alcance) continue;
      if (this.vocalizador.decir(npc, 'ronquido', { range: DIRECTOR.ronquido.alcance + 4 })) this._ronquido = this._clock + DIRECTOR.ronquido.cada;
      break;
    }
  }

  /**
   * La persona de al lado puede ser la víctima del próximo robo o a quien se le pide: sus frases empiezan a cargar
   * antes. De a dos por segundo, para no revolver la memoria de voces recientes.
   */
  _actualizarPrecarga(dt) {
    if ((this._mirarPrecarga -= dt) <= 0) {
      this._mirarPrecarga = DIRECTOR.precarga.mirarCada;
      const npc = this._masCercana(DIRECTOR.precarga.alcance, n => !!(n._voz ?? n._castVoice?.()));
      if (npc && npc !== this._cercano) {
        this._cercano = npc;
        const voz = npc._voz ??= npc._castVoice();
        const sexo = npc.look?.real?.sexo;
        for (const category of DIRECTOR.precarga.categorias) {
          for (const entry of NPC_VOICE_BANK[category] ?? []) {
            if (entry.voz !== voz || !sameSex(entry, sexo) || this._enCola.has(entry.audio)) continue;
            this._enCola.add(entry.audio);
            this._precarga.push(entry.audio);
          }
        }
        if (this._enCola.size > 200) this._enCola.clear();
      }
    }
    if ((this._precargaIn -= dt) > 0 || !this._precarga.length) return;
    this._precargaIn = 1 / DIRECTOR.precarga.porSegundo;
    const path = this._precarga.shift();
    const file = path.replace(/^.*?\/audio\//, '');
    if (!this.audio._npcSounds?.has(file)) this.audio.prefetchVoice?.(path);
  }

  dispose() {
    for (const [type, handler] of Object.entries(this._handlers)) this.eventTarget?.removeEventListener?.(type, handler);
    this.burbujas.clear();
    this.vocalizador.dispose();
    const audio = this.audio;
    if (audio.vocalizador === this.vocalizador) audio.vocalizador = null;
    audio.onVoiceLine = null; audio.policeRange = null; audio.onSilentDriver = null;
    if (audio.worldVoices) audio.worldVoices.onLine = null;
    this._luego.length = 0; this._precarga.length = 0; this._enCola.clear();
  }
}
