// src/systems/voces/VoiceDirector.js
// Las voces de la gente de la calle con las frases grabadas de data/vocesCalle.js:
//  - Al pasar cerca, de vez en cuando alguien dice algo: la primera a los 4 s y luego cada 7 a 14 s, entre los
//    cuatro más cercanos a menos de 6 m que no hayan hablado hace poco.
//  - Cada persona tiene la voz de su arquetipo, su sexo y su edad (vozPara) y la conserva. Las frases de cada voz
//    salen barajadas: ninguna se repite hasta que hayan salido todas.
//  - Comparte el canal con las demás voces del juego (AudioSystem): solo empieza si nadie más habla.
//  - Los audios se cargan al pedirlos: los de quien está al lado (a menos de 6 m) empiezan a cargar antes. Una frase
//    solo arranca con su audio ya cargado, como las demás voces; si a quien le toca no tiene ninguna lista, se pide la
//    carga y habla en otro turno (o le toca a otro). Ningún audio se descarga hasta salir de la partida.
// La burbuja sale con la voz, del largo de la grabación. Si un audio no carga (al hablar o al precargar), ese archivo
// no se vuelve a pedir y su frase sale solo en la burbuja.
// La víctima de un robo grita con su voz una frase que cuadre con lo que le pasó (decirRobo, voces/robo.js): pesa más
// que todo lo demás de la calle y lo corta. Sus audios se piden cuando el jugador la tiene a tiro (prepararRobo).
// El conductor al que se le hizo un show en el semáforo contesta desde su carro (decirConductor): da, no da o arranca
// porque cambió la luz. En la buseta contesta el busetero; en los demás, un conductor o una conductora. Sus audios se
// piden al empezar el show (prepararConductor) y su burbuja sale encima del carro. Sin frase lista, en los dos casos,
// devuelve false y quien llamó sigue con su texto de siempre.
// Las voces que no son de un peatón (voces/VocesDelMundo.js) hablan por `decirDesde`, cada una con su alcance y su
// volumen; la que entra «a la fuerza» corta lo que haya, y la que vale «en pausa» suena aunque el juego se detenga.
import { VOCES_LUFS, frasesDe } from '../../data/vocesCalle.js';
import { azarDeVoces } from './azar.js';
import { frasesDeRobo } from './robo.js';
import { ShuffleBag, setPan, setRate, takeVariation, voicePan } from '../voiceVariety.js';
import { canGreet, loudnessGain, voiceGain } from '../StreetVoices.js';
import { RepartoVocal, puedeHablar, vozParaConductor } from './identidad.js';
export { vozDePersona } from './identidad.js';

export const DIRECTOR = Object.freeze({
  rango: 15, pleno: 3,           // m: pleno hasta `pleno`; desde `rango` se calla y suelta el canal, como las frases de la calle
  volumen: .8,                   // como las frases de la calle (StreetVoices)
  ambiente: { primera: 4000, alcance: 6, pool: 4, porPersona: 30000, min: 7000, extra: 7000, reintento: 1000 },
  saludoCartuchoCada: 45000,
  precarga: { alcance: 6, cada: 1000 },
  burbuja: { min: 1.5, despues: .4, sinAudio: 3 },
  // El turno de quien espera (un testigo): aguarda hasta `espera` ms a que acabe la voz que pesa más; y si lo cortan
  // cuando llevaba menos de `recien` ms hablando, vuelve a decirlo entero después.
  turno: { espera: 6000, recien: 1000 },
});

const [SALUDO_CARTUCHO, ESPERA_CARTUCHO] = frasesDe('saludo_cartucho', 'nero_esquina');
const QUEJA_JUGADOR = frasesDe('herido', 'protagonista');

/** Lo que contesta quien maneja al terminar un show en el semáforo: da, no da o arranca porque cambió la luz. */
/** De cada vez que alguien se tapa la nariz por el olor del jugador, cuántas lo dice en voz alta. */
export const OLOR = Object.freeze({ azar: .55 });

/**
 * Las frases de quien maneja: el pito de quien no puede pasar y el reclamo por el espejo. Alcance, tramo pleno y
 * volumen son los de las grabaciones de siempre (VehicleAudio y AudioSystem), con su misma caída en línea recta.
 */
export const CARRO = Object.freeze({
  pito: { rango: 8, pleno: 2, nivel: .7, lineal: true },
  espejo: { rango: 12, pleno: 2, nivel: .75, lineal: true },
  precarga: { alcance: 14, cada: 1000 }, // sus audios se piden con el carro ya cerca, una vez por carro
});

/**
 * Lo que grita con su voz alguien a quien el jugador le pega: solo estas frases le sirven, y solo las dicen el ñero
 * viejo y el reciclador. Cada persona, a lo sumo una vez cada `cada` ms.
 */
export const GOLPEADO = Object.freeze({ frases: Object.freeze(['nero_viejo_pelea_1', 'reciclador_pelea_1']), cada: 8000 });

export const SEMAFORO = Object.freeze(['semaforo_si', 'semaforo_no', 'semaforo_verde']);

const audioFile = path => path.replace(/^\/audio\//, '');

export class VoiceDirector {
  /**
   * `load(file)` crea el Howl de `public/audio/<file>`. `otraVoz()` dice si suena otra voz del juego y `audioListo()`
   * si el audio del navegador está corriendo (con el contexto suspendido, Howler dejaría la frase en cola para luego).
   * Para los testigos, la víctima de un robo y los conductores, `pesoOtraVoz()` dice cuánto pesa la otra voz del
   * juego que suena (0 si ninguna) y `callarOtras()` corta las que pesan menos que ellos (`callarOtras(true)`, todas).
   * `burbuja(carro, texto, segundos)` pone la burbuja de quien habla desde un carro, que no tiene la suya como los
   * peatones, y `callarBurbuja(carro)` se la quita si le cortan la voz. `random` es el azar de todo lo que el director sortea; si no se le da, usa uno propio (voces/azar.js),
   * nunca el del juego.
   */
  constructor({ load, burbuja = null, callarBurbuja = null, random = azarDeVoces(), now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
    this.load = load;
    this.burbuja = burbuja;
    this.callarBurbuja = callarBurbuja;
    this.random = random;
    this.now = now;
    this.reparto = new RepartoVocal(random, now);
    this._jugador = null;
    this._quejaDesde = 0;
    this.levels = { voices: 1 };
    this.paused = false;
    this.camera = null;
    this.otraVoz = () => false;
    this.audioListo = () => true;
    this._sounds = new Map();      // archivo → Howl
    this._fallidos = new Set();    // archivos que no cargaron
    this._bags = new Map();
    this._voz = null;              // { sound, id, source, gain, entry }
    this._pausadoEn = null;        // instante en que empezó la pausa en curso
    this._enEspera = null;         // quien espera su turno: { source, frases, prioridad, clave, opciones, caduca }
    this._listener = null;
    this._nextAmbient = null;      // la primera frase espera `primera` desde el arranque
    this._saludoCartuchoAt = 0;
    this._dichoCartucho = new WeakMap();
    this._dijo = new WeakMap();    // persona → instante desde el que puede volver a decir algo al pasar
    this._carros = new WeakMap();  // carro → { voz, quien }: la voz de quien lo maneja y desde dónde habla
    this._sitios = new WeakMap();  // carro, bus o persona sin burbuja propia → desde dónde habla
    this._precargaAt = 0;
    this._carrosAt = 0;
    this._golpeados = new WeakMap(); // persona → instante desde el que puede volver a gritar por un golpe
    this._carrosPedidos = new WeakMap(); // carro → conductor cuyas frases ya se pidieron
    this.ultima = null;            // la última frase que mandó a sonar (pruebas y depuración)
  }

  /** Una frase grabada sonando. */
  get active() { return !!this._voz && this._voz.sound.playing(this._voz.id); }

  /** La voz de la persona: se decide una vez y la conserva. */
  vozDe(npc) {
    return npc && npc === this._jugador ? 'protagonista' : this.reparto.vozDe(npc);
  }

  registrarJugador(player) { this._jugador = player; }

  quejaJugador(player) {
    if (!player || player !== this._jugador || !puedeHablar(player) || player.stats?.salud <= 0 || this.paused) return false;
    const now = this.now();
    if (now < this._quejaDesde) return false;
    this._quejaDesde = now + 8000;
    const fuente = this.desde(player);
    this.preparar(QUEJA_JUGADOR);
    if (!this._gritar(fuente, QUEJA_JUGADOR, PRIORIDAD_VOZ.playerReact, 'protagonista:herido')) {
      fuente.say(QUEJA_JUGADOR[0].text, 1.5);
    }
    return true;
  }

  /** Las frases que la persona puede decir al pasar: las de su voz. */
  frasesPara(npc) {
    const voz = this.vozDe(npc);
    return voz ? frasesDe('ambiente', voz) : [];
  }

  /**
   * La persona dice una frase al pasar o un saludo de su escena. Habla cuando la toma está cargada. Si falla el
   * archivo, queda la burbuja. Devuelve true si la dijo.
   */
  decir(npc, frases = null) {
    if (!canGreet(npc) || npc === this._jugador || this.paused || this.active || this.otraVoz() || !this.audioListo()) return false;
    const voz = this.vozDe(npc);
    if (!this.reparto.disponible(npc, voz)) return false;
    const lista = frases ? frases.filter(frase => frase.voz === voz) : this.frasesPara(npc);
    if (!lista.length) return false;
    this.preparar(lista);
    const listas = lista.filter(entry => {
      const file = audioFile(entry.audio);
      return this._fallidos.has(file) || this._sounds.get(file)?.state() === 'loaded';
    });
    if (!listas.length) return false;
    let bag = this._bags.get(voz);
    if (!bag) this._bags.set(voz, bag = new ShuffleBag(this.random));
    return this._sonar(bag.draw(listas, item => item.audio), npc, PRIORIDAD_VOZ.ambient, { limpiarAlCortar: !!frases });
  }

  /**
   * El testigo dice con su voz una frase de `situacion` ('llamar', 'grabar', 'colgar', 'robo', 'pelea'), entre las
   * suyas ya cargadas, y pone la burbuja con su texto. Corta lo que pese menos (la gente al pasar, la calle, las
   * conversaciones, los conductores). Si otro testigo ya habla, no suena. Si quien tiene el canal es otra voz que pesa
   * igual o más (la víctima del robo, la Policía, el reclamo por el espejo), espera su turno: lo dice entero, con su
   * burbuja, en cuanto esa voz acabe (DIRECTOR.turno); y si esa voz lo corta apenas empezaba, también. Con
   * `trasLaVictima` (vio un robo) no arranca aquí mismo sino en su turno, un instante después: así el grito de la
   * víctima, que sale en ese mismo momento, va primero y no lo corta. Devuelve false si no va a sonar ni queda
   * esperando: entonces el testigo pone su texto de siempre. Si queda esperando y no le llega el turno,
   * `sinTurno` muestra ese mismo texto mientras el testigo siga consciente.
   */
  decirTestigo(npc, situacion, { trasLaVictima = false, sinTurno = null } = {}) {
    if (!puedeHablar(npc) || npc === this._jugador) return false;
    this.prepararTestigo(npc);
    const prioridad = prioridadDe(TESTIGO_A_CATEGORIA[situacion]);
    return this._gritar(npc, this.frasesTestigo(npc, situacion), prioridad, `testigo:${situacion}:${npc._voz}`,
      { espera: DIRECTOR.turno.espera, grupo: 'testigo', aplazar: trasLaVictima, sinTurno });
  }

  /** Suelta la frase del celular si el testigo dejó de usarlo antes de terminar. */
  cortarTestigo(npc, situacion) {
    const clave = `testigo:${situacion}:${npc._voz}`;
    if (this._enEspera?.source === npc && this._enEspera.clave === clave) this._enEspera = null;
    const voz = this._voz;
    if (voz?.source !== npc || voz.clave !== clave) return;
    this._cortar();
    npc.callar?.(voz.entry.text);
  }

  /** Las frases de «robado» de su voz que cuadran con el robo ('pillado', 'raponazo', 'raponazo-sin-bolso'). */
  frasesRobo(npc, tipo) {
    return frasesDeRobo(this.vozDe(npc), tipo);
  }

  /** Empieza a cargar lo que la persona gritaría si le roban. */
  prepararRobo(npc) {
    const voz = this.vozDe(npc);
    if (voz) for (const entry of frasesDe('robado', voz)) this._sound(audioFile(entry.audio));
  }

  /**
   * La víctima de un robo grita con su voz una frase que cuadre con lo que pasó, entre las suyas ya cargadas, y pone
   * la burbuja con su texto. Corta todo lo que pese menos (la gente al pasar, los testigos, la calle, las
   * conversaciones, los conductores) y espera al reclamo por el espejo. Devuelve false si no va a sonar: entonces la
   * víctima grita su texto de siempre.
   */
  decirRobo(npc, tipo) {
    if (!npc?.position || npc._disposed) return false;
    this.prepararRobo(npc);
    return this._gritar(npc, this.frasesRobo(npc, tipo), PRIORIDAD_VOZ.robbed, `robo:${npc._voz}`);
  }

  /** Lo que la persona grita con su voz cuando le cae popó encima. */
  frasesPopo(npc) {
    const voz = this.vozDe(npc);
    return voz ? frasesDe('popo', voz) : [];
  }

  /** Empieza a cargar lo que gritaría si le cae popó. */
  prepararPopo(npc) {
    this.preparar(this.frasesPopo(npc));
  }

  /**
   * A la persona le cayó popó: lo grita con su voz y su burbuja. Corta a la gente al pasar, la calle, las
   * conversaciones y los conductores; espera a la víctima de un robo, a la Policía y a los testigos. Devuelve false
   * si no va a sonar: entonces sale su grito de siempre.
   */
  decirPopo(npc) {
    if (!npc?.position || npc._disposed) return false;
    this.prepararPopo(npc);
    return this._gritar(npc, this.frasesPopo(npc), PRIORIDAD_VOZ.poop, `popo:${npc._voz}`);
  }

  /** Lo que la persona grita con su voz cuando el jugador le pega. */
  frasesGolpeado(npc) {
    const voz = this.vozDe(npc);
    return voz ? frasesDe('pelea', voz).filter(frase => GOLPEADO.frases.includes(frase.id)) : [];
  }

  /** Empieza a cargar lo que gritaría si le pegan. */
  prepararGolpeado(npc) {
    this.preparar(this.frasesGolpeado(npc));
    if (this._jugador) this.preparar(QUEJA_JUGADOR);
  }

  /**
   * El jugador le pegó: lo grita con su voz y su burbuja. Corta a todos menos a la víctima de un robo, al reclamo por
   * el espejo y al arresto. Devuelve false si no va a sonar (o si gritó hace poco): entonces sale su queja de siempre.
   */
  decirGolpeado(npc) {
    if (!npc?.position || npc._disposed) return false;
    const frases = this.frasesGolpeado(npc);
    if (!frases.length) return false;
    this.preparar(frases);
    const now = this.now();
    if ((this._golpeados.get(npc) ?? -Infinity) > now) return false;
    if (!this._gritar(npc, frases, PRIORIDAD_VOZ.hit, `golpe:${npc._voz}`)) return false;
    this._golpeados.set(npc, now + GOLPEADO.cada);
    return true;
  }

  /** Lo que la persona dice con su voz cuando el jugador le huele mal. */
  frasesOlor(npc) {
    const voz = this.vozDe(npc);
    return voz ? frasesDe('olor', voz) : [];
  }

  /** Empieza a cargar lo que diría por el olor. */
  prepararOlor(npc) {
    this.preparar(this.frasesOlor(npc));
  }

  /**
   * La persona se tapa la nariz: a veces (`OLOR.azar`) lo dice con su voz y su burbuja, para que no canse. El sorteo
   * es del director, no del juego. Corta a la gente al pasar, la calle, las conversaciones y los conductores; espera
   * todo lo demás. Devuelve false si no va a sonar: entonces sale su queja de siempre en texto.
   */
  decirOlor(npc) {
    if (!npc?.position || npc._disposed) return false;
    const frases = this.frasesOlor(npc);
    if (!frases.length) return false;
    this.preparar(frases);
    if (this.random() >= OLOR.azar) return false;
    return this._gritar(npc, frases, PRIORIDAD_VOZ.smell, `olor:${npc._voz}`);
  }

  /** La persona conserva su voz en la cabina, a pie y después de cargar la partida. */
  vozDeCarro(car) {
    return car ? this._carro(car).voz : null;
  }

  vincularConductor(npc, car, id) {
    if (!npc || !car) return;
    car.driverId ??= id;
    const conductor = this._carro(car);
    npc._voz = conductor.voz;
    conductor.persona = npc;
    if (npc.isDead) car.driverDead = true;
  }

  alVolante(car) {
    if (!car || car.driverDead || car.driverInside === false) return false;
    const conductor = this._carro(car).persona;
    return !conductor?.isDead && !conductor?.active;
  }

  _carro(car) {
    let entrada = this._carros.get(car);
    if (!entrada || entrada.id !== car.driverId) {
      const voz = vozParaConductor(car.driverId, car.kind, this.random);
      this._carros.set(car, entrada = { id: car.driverId, voz, quien: this.desde(car) });
      entrada.quien.car = car;
    }
    return entrada;
  }

  /**
   * Desde dónde habla lo que no tiene burbuja propia (un carro, un bus, el jíbaro): va con él, y su burbuja la pone
   * `burbuja` encima. `alto` son los metros que mide, si no es un vehículo que ya lo diga.
   */
  desde(cosa, alto = null) {
    let quien = this._sitios.get(cosa);
    if (!quien) {
      this._sitios.set(cosa, quien = {
        get position() { return cosa.position; },
        get isDead() { return cosa.isDead || cosa.driverDead; },
        get _disposed() { return cosa._disposed; },
        say: (text, segundos) => (alto === null ? this.burbuja?.(cosa, text, segundos) : this.burbuja?.(cosa, text, segundos, alto)),
        callar: () => this.callarBurbuja?.(cosa),
      });
    }
    return quien;
  }

  /** Nadie habla: ni una frase grabada de aquí ni otra voz del juego. */
  get libre() { return !this.active && !this.otraVoz(); }

  /** Empieza a cargar los audios de `frases`. */
  preparar(frases) {
    for (const entry of frases) this._sound(audioFile(entry.audio));
  }

  /** Llama a la acción cuando una toma está lista y permite cancelar la espera al cerrar el panel. */
  alCargar(frase, accion) {
    this.preparar([frase]);
    const sonido = this._sounds.get(audioFile(frase.audio));
    if (sonido?.state() === 'loaded') { accion(); return; }
    sonido?.once?.('load', accion);
    return () => sonido?.off?.('load', accion);
  }

  /** ¿Ya cargó el audio de la frase? */
  lista(frase) {
    return !!frase && this._sounds.get(audioFile(frase.audio))?.state() === 'loaded';
  }

  /**
   * Una voz del mundo dice una de `frases` (las ya cargadas) desde `quien`, que tiene `position` y puede tener `say`.
   * `prioridad` es su peso (voces/prioridad.js) y `clave` la bolsa de la que sale sin repetirse. `rango` y `pleno`
   * (metros; con `pleno` en 0 baja en línea recta hasta `rango`) y `nivel` (volumen) son los suyos; con `forzar` corta
   * lo que esté sonando, pese lo que pese; con `enPausa` suena aunque el juego esté en pausa y la pausa no la corta.
   * Devuelve false si no va a sonar.
   */
  decirDesde(quien, frases, { prioridad, clave, ...opciones } = {}) {
    if (!puedeHablar(quien) || !frases?.length || quien === this._jugador) return false;
    const esPersona = !!(quien.person || quien._voz || quien.voiceRole);
    const voz = esPersona ? this.vozDe(quien) : null;
    frases = frases.filter(frase => frase.voz !== 'protagonista' && (!esPersona || frase.voz === voz));
    if (!frases.length) return false;
    this.preparar(frases);
    return this._gritar(quien, frases, prioridad, clave, opciones);
  }

  /** Las frases que quien maneja el carro puede contestar en una situación del semáforo (SEMAFORO). */
  frasesConductor(car, situacion) {
    return car && SEMAFORO.includes(situacion) ? frasesDe(situacion, this.vozDeCarro(car)) : [];
  }

  /** Empieza a cargar lo que contestaría quien maneja el carro. */
  prepararConductor(car) {
    for (const situacion of SEMAFORO) {
      for (const entry of this.frasesConductor(car, situacion)) this._sound(audioFile(entry.audio));
    }
  }

  /**
   * Quien maneja el carro contesta con su voz ('semaforo_si', 'semaforo_no', 'semaforo_verde'), entre sus frases ya
   * cargadas, y la burbuja sale encima del carro. Corta a la gente al pasar, la calle, las conversaciones y los
   * conductores que pitan; espera a la víctima de un robo, a los testigos que gritan y al reclamo por el espejo.
   * Devuelve false si no va a sonar.
   */
  decirConductor(car, situacion) {
    if (!car?.position || !this.alVolante(car)) return false;
    this.prepararConductor(car);
    const { voz, quien } = this._carro(car);
    return this._gritar(quien, this.frasesConductor(car, situacion), PRIORIDAD_VOZ.semaforo, `${situacion}:${voz}`);
  }

  /** Lo que quien maneja el carro dice en una situación de carro ('pito', 'robo_espejo') con su voz. */
  frasesCarro(car, situacion) {
    return car ? frasesDe(situacion, this.vozDeCarro(car)) : [];
  }

  /** Empieza a cargar el pito y el reclamo por el espejo de quien maneja el carro. */
  prepararCarro(car) {
    if (!car) return;
    this.preparar(this.frasesCarro(car, 'pito'));
    this.preparar(this.frasesCarro(car, 'robo_espejo'));
  }

  /** Una vez por segundo pide las frases de los carros del tráfico que el jugador tiene cerca; las patrullas no. */
  precargarCarros(position, vehiculos = []) {
    const now = this.now();
    if (!position || now < this._carrosAt) return;
    this._carrosAt = now + CARRO.precarga.cada;
    for (const vehicle of vehiculos ?? []) {
      const car = vehicle?.car;
      if (!car?.position || vehicle.police || car.driverDead || car.driverInside === false) continue;
      if (Math.hypot(car.position.x - position.x, car.position.z - position.z) > CARRO.precarga.alcance) continue;
      const conductor = this._carro(car);
      if (this._carrosPedidos.get(car) === conductor) continue;
      this._carrosPedidos.set(car, conductor);
      this.prepararCarro(car);
    }
  }

  /** Cuántas frases de esa situación tiene ya cargadas quien maneja el carro (no pide ninguna). */
  listasCarro(car, situacion) {
    if (!car || !this._carros.has(car)) return 0;
    return this.frasesCarro(car, situacion).filter(frase => this.lista(frase)).length;
  }

  /**
   * Quien no puede pasar lo dice con su voz, con la burbuja encima del carro. Pesa lo mismo que las frases de pito de
   * siempre: no corta a nadie y cualquier otra voz la corta. Devuelve false si no va a sonar.
   */
  decirPito(car) {
    if (!car?.position || !this.alVolante(car) || !this.libre) return false;
    const { voz, quien } = this._carro(car);
    return this._gritar(quien, this.frasesCarro(car, 'pito'), PRIORIDAD_VOZ.pito, `pito:${voz}`, CARRO.pito);
  }

  /**
   * A quien maneja le arrancaron el espejo: lo reclama con su voz, con la burbuja encima del carro. Como el reclamo
   * de siempre, reemplaza cualquier otra frase en curso. Devuelve false si no va a sonar.
   */
  decirEspejo(car) {
    if (!car?.position || !this.alVolante(car)) return false;
    const { voz, quien } = this._carro(car);
    return this._gritar(quien, this.frasesCarro(car, 'robo_espejo'), PRIORIDAD_VOZ.espejo, `espejo:${voz}`, { ...CARRO.espejo, forzar: true });
  }

  /** Segundos que dura la frase que suena (0 si ninguna). */
  get duracion() { return this.active ? this._voz.sound.duration?.() || 0 : 0; }

  /**
   * Suena una de `frases` (las que ya estén cargadas) desde `source` si nada que pese igual o más tiene el canal;
   * lo que pese menos se corta. Lejos del jugador, en pausa o sin audio listo, no suena.
   */
  _gritar(source, frases, prioridad, clave, opciones = {}) {
    const { rango = DIRECTOR.rango, forzar = false, enPausa = false, espera = 0, grupo = null, deTurno = false, aplazar = false } = opciones;
    if (!puedeHablar(source) || !frases.length || !prioridad || (this.paused && !enPausa) || !this.audioListo()) return false;
    // Quien vuelve a hablar ya no espera con lo que iba a decir antes.
    if (!deTurno && this._enEspera?.source === source) this._enEspera = null;
    const otra = this.pesoOtraVoz();
    const l = this._listener, p = source.position;
    const lejos = !!l && Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) >= rango;
    if (!forzar && ((this.active && this._voz.prioridad >= prioridad) || otra >= prioridad)) {
      // Espera su turno solo si lo tapa una voz que no es de los suyos (a otro testigo no lo espera).
      const deLosSuyos = !!grupo && otra < prioridad && this._voz?.grupo === grupo;
      return espera > 0 && !deTurno && !lejos && !deLosSuyos && this._pedirTurno({ source, frases, prioridad, clave, opciones });
    }
    if (lejos) return false;
    // Quien debe ir después de otro no arranca aquí: toma el turno, si tiene alguna frase lista, y habla enseguida.
    if (aplazar && !deTurno) return this._pedirTurno({ source, frases, prioridad, clave, opciones });
    const listas = frases.filter(entry => this._sounds.get(audioFile(entry.audio))?.state() === 'loaded');
    if (!listas.length) return false;
    if (forzar) this.callarOtras(true);
    else if (otra > 0) this.callarOtras();
    let bag = this._bags.get(clave);
    if (!bag) this._bags.set(clave, bag = new ShuffleBag(this.random));
    return this._sonar(bag.draw(listas, item => item.audio), source, prioridad, { ...opciones, clave });
  }

  /** Solo espera quien tiene una toma lista. El único puesto es para la prioridad mayor y, a igual peso, para quien llegó antes. */
  _pedirTurno(turno) {
    if (!turno.frases?.some(frase => this.lista(frase)) || (this._enEspera && this._enEspera.prioridad >= turno.prioridad)) return false;
    const previo = this._enEspera;
    this._enEspera = { ...turno, caduca: this.now() + (turno.opciones.espera ?? DIRECTOR.turno.espera) };
    if (previo && previo.source !== turno.source) this._sinTurno(previo.source, previo.opciones.sinTurno);
    return true;
  }

  /** Quien perdió el turno muestra su texto mientras siga consciente y en el mundo. */
  _sinTurno(quien, aviso) {
    if (puedeHablar(quien)) aviso?.();
  }

  /**
   * Quien esperaba habla al quedar libre el canal. Al vencer el plazo usa el texto de respaldo y un derribo cancela
   * la intervención. La pausa conserva el tiempo de espera (setPaused).
   */
  _turno(now) {
    const turno = this._enEspera;
    if (!turno) return;
    const quien = turno.source;
    if (now > turno.caduca || !puedeHablar(quien)) { this._enEspera = null; this._sinTurno(quien, turno.opciones.sinTurno); return; }
    if ((this.active && this._voz.prioridad >= turno.prioridad) || this.pesoOtraVoz() >= turno.prioridad) return;
    if (this._gritar(quien, turno.frases, turno.prioridad, turno.clave, { ...turno.opciones, deTurno: true })) this._enEspera = null;
  }

  _sonar(entry, source, prioridad = PRIORIDAD_VOZ.ambient, { rango = DIRECTOR.rango, pleno = DIRECTOR.pleno, nivel = DIRECTOR.volumen,
    enPausa = false, lineal = false, limpiarAlCortar = false, espera = 0, grupo = null, clave = null, sinTurno = null } = {}) {
    const file = audioFile(entry.audio);
    const { min, despues, sinAudio } = DIRECTOR.burbuja;
    this.ultima = { id: entry.id, audio: entry.audio, text: entry.text, voz: entry.voz };
    if (this._fallidos.has(file)) { source.say?.(entry.text, sinAudio); return true; }
    const sound = this._sounds.get(file);
    if (this._voz) this._cortar(true, grupo);
    const { rate, gain } = takeVariation(this.random);
    const id = sound.play();
    setRate(sound, rate, id);
    const voz = { sound, id, source, gain, entry, prioridad, rango, pleno, nivel, enPausa, lineal, limpiarAlCortar, espera, grupo, clave, sinTurno, desde: this.now() };
    this._voz = voz;
    this.reparto.registrar(source, entry.voz);
    sound.volume(this._volumen(voz), id);
    setPan(sound, voicePan(this._listener, this.camera, source.position), id);
    source.say?.(entry.text, Math.max(min, (sound.duration() || 2) + despues));
    return true;
  }

  /** El Howl de un archivo: se crea al pedirlo. Si no carga, el archivo queda marcado y el Howl se suelta. */
  _sound(file) {
    if (this._sounds.has(file) || this._fallidos.has(file)) return;
    const sound = this.load?.(file);
    if (!sound) return;
    this._sounds.set(file, sound);
    sound.once?.('loaderror', () => {
      this._fallidos.add(file);
      this._sounds.delete(file);
      sound.unload?.();
    });
  }

  /** Empieza a cargar las frases que la persona diría al pasar. */
  precargar(npc) {
    for (const entry of this.frasesPara(npc)) this._sound(audioFile(entry.audio));
  }

  _volumen(voz) {
    const p = voz.source.position, l = this._listener;
    const distance = l && p ? Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) : 0;
    // Con `pleno` en 0 o `lineal`, la voz baja en línea recta desde `pleno` hasta callar en `rango`: así suenan las
    // del mundo y las de los carros.
    const cerca = voz.pleno > 0 && !voz.lineal ? voiceGain(distance, voz.pleno, voz.rango)
      : Math.max(0, Math.min(1, (voz.rango - distance) / (voz.rango - voz.pleno)));
    return Math.min(1, voz.nivel * loudnessGain(VOCES_LUFS) * voz.gain * this.levels.voices * cerca);
  }

  update(position, pedestrians = [], contexto) {
    this._listener = position;
    if (this.paused) return;
    const now = this.now();
    if (this._voz) {
      const voz = this._voz;
      const p = voz.source.position;
      if (!this.active) this._voz = null;
      else if (voz.source.car && !this.alVolante(voz.source.car)) this._cortar();
      else if (voz.prioridad === PRIORIDAD_VOZ.ambient && !canGreet(voz.source)) this._cortar(true);
      else if (!this.audioListo() || !puedeHablar(voz.source) ||
        Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z) > voz.rango) this._cortar();
      else {
        voz.sound.volume(this._volumen(voz), voz.id);
        setPan(voz.sound, voicePan(position, this.camera, voz.source.position), voz.id);
      }
    }
    this._turno(now);
    this._precargar(position, pedestrians, now);
    this._ambiente(position, pedestrians, now, contexto);
  }

  _precargar(position, pedestrians, now) {
    if (now < this._precargaAt || !position) return;
    this._precargaAt = now + DIRECTOR.precarga.cada;
    let cercano = null, mejor = DIRECTOR.precarga.alcance;
    for (const npc of pedestrians) {
      if (!puedeHablar(npc)) continue;
      const d = Math.hypot(npc.position.x - position.x, npc.position.y - position.y, npc.position.z - position.z);
      if (d < mejor) { mejor = d; cercano = npc; }
    }
    if (cercano) { this.precargar(cercano); this.prepararGolpeado(cercano); }
  }

  /** Entre los más cercanos que no hayan hablado hace poco, alguien dice algo al pasar. */
  _ambiente(position, pedestrians, now, contexto) {
    this._nextAmbient ??= now + DIRECTOR.ambiente.primera;
    if (now < this._nextAmbient || !position) return;
    const { alcance, pool, porPersona, min, extra, reintento } = DIRECTOR.ambiente;
    const candidatos = [];
    for (const npc of pedestrians) {
      if (!canGreet(npc) || npc._bubbleEl) continue;
      if ((this._dijo.get(npc) ?? -Infinity) > now) continue;
      const d = Math.hypot(npc.position.x - position.x, npc.position.y - position.y, npc.position.z - position.z);
      if (d <= alcance) candidatos.push({ npc, d });
    }
    candidatos.sort((a, b) => a.d - b.d);
    const cerca = candidatos.slice(0, pool);
    const enCartucho = contexto?.jugador && contexto.sitioCerca?.('cartucho', position);
    const saluda = enCartucho && now >= this._saludoCartuchoAt
      ? candidatos.find(({ npc }) => this.vozDe(npc) === 'nero_esquina'
        && !npc.fijo?.out
        && !npc.mind?.busy?.() && contexto.sitioCerca('cartucho', npc.position))?.npc : null;
    const aptos = saluda ? [] : cerca.filter(({ npc }) => this.reparto.disponible(npc, this.vozDe(npc)) && this.frasesPara(npc).length);
    const npc = saluda ?? (aptos.length ? aptos[Math.floor(this.random() * aptos.length)].npc : null);
    let toma = null;
    if (saluda) {
      const quieto = !npc.moving && (npc.fijo || npc.wait > 0);
      toma = quieto && this._dichoCartucho.get(npc) === SALUDO_CARTUCHO ? ESPERA_CARTUCHO : SALUDO_CARTUCHO;
    }
    if (!npc || !this.decir(npc, toma ? [toma] : null)) { this._nextAmbient = now + reintento; return; }
    if (toma) {
      this._dichoCartucho.set(npc, toma);
      this._saludoCartuchoAt = now + DIRECTOR.saludoCartuchoCada;
    }
    this._dijo.set(npc, now + porPersona);
    this._nextAmbient = now + min + this.random() * extra;
  }

  /**
   * Calla la frase que suena. Con `porOtra` es otra voz la que le quita el canal: su burbuja se quita con ella, para
   * que nadie quede diciendo en pantalla algo que no se oye; y si era de las que esperan turno y apenas empezaba (y
   * quien la corta no es de su mismo `grupo`), queda esperando para decirlo entero después.
   */
  _cortar(porOtra = false, grupo = null) {
    const voz = this._voz;
    this._voz = null;
    if (!voz?.sound.playing(voz.id)) return;
    voz.sound.stop(voz.id);
    if (porOtra || voz.limpiarAlCortar) voz.source.callar?.(voz.entry.text);
    if (!porOtra) return;
    if (voz.espera > 0 && this.now() - voz.desde <= DIRECTOR.turno.recien && !(voz.grupo && voz.grupo === grupo)) {
      const { rango, pleno, nivel, lineal, espera, sinTurno } = voz;
      const espero = this._pedirTurno({ source: voz.source, frases: [voz.entry], prioridad: voz.prioridad, clave: voz.clave,
        opciones: { rango, pleno, nivel, lineal, espera, grupo: voz.grupo, sinTurno } });
      if (!espero) this._sinTurno(voz.source, sinTurno);
    }
  }

  /** Cede el canal, o termina solo la frase de la fuente que está cerrando su panel. */
  cancel(source = null) {
    if (!source || this._voz?.source === source) this._cortar(true);
  }

  retirar(npc) {
    if (this._enEspera?.source === npc) this._enEspera = null;
    if (this._voz?.source !== npc) return;
    const texto = this._voz.entry.text;
    this._cortar();
    npc.callar?.(texto);
  }

  /** Quien hablaba sentado continúa la misma reproducción y el mismo subtítulo al salir o entrar. */
  seguirFuente(anterior, siguiente) {
    const voz = this._voz;
    if (!this.active || voz.source !== anterior) return false;
    const segundos = (voz.sound.duration?.() || 2) - (voz.sound.seek?.(voz.id) || 0);
    anterior.callar?.(voz.entry.text);
    voz.source = siguiente;
    siguiente.say?.(voz.entry.text, Math.max(.4, segundos + DIRECTOR.burbuja.despues));
    return true;
  }

  ajustarNivel() {
    if (this.active) this._voz.sound.volume(this._volumen(this._voz), this._voz.id);
  }

  setPaused(paused) {
    // La pausa no gasta la espera de quien aguarda su turno: al volver le queda lo mismo que tenía.
    const now = this.now();
    if (paused && !this.paused) this._pausadoEn = now;
    else if (!paused && this.paused && this._enEspera && this._pausadoEn !== null) this._enEspera.caduca += now - this._pausadoEn;
    this.paused = paused;
    if (paused && !this._voz?.enPausa) this._cortar();
  }

  dispose() {
    this._enEspera = null;
    this._cortar();
    for (const sound of this._sounds.values()) sound.unload?.();
    this._sounds.clear();
    this.reparto.limpiar();
    this._jugador = null;
  }
}
