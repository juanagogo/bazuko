// src/ui/RapEnElBus.js
// El rap en el vagón: la escena que sale en lugar del fundido del viaje cuando el jugador elige rapear.
// Saluda, suena el beat y en cada compás una marca roja cruza la barra, como la del cosquilleo: cada vez que pasa por
// lo negro se oprime Espacio (A con mando, un toque con el dedo) y sale un pedazo de la línea. El que no pega sale
// tachado y el personaje se traba. Al final la gente del vagón dice lo suyo y da lo que quiera.
//
// Mientras dura, el juego está quieto (`game._traveling`), como en cualquier viaje. La lógica vive en
// `systems/rap/` (ritmo, pago y audio); aquí solo se pinta, se escucha la entrada y se lleva el reloj.
// La marca cruza la barra una vez por compás (0,38 Hz): nada oscila más rápido que eso, y nada parpadea.

import { el } from './dom.js';
import { icon } from './icons.js';
import { cop } from '../utils/money.js';
import { conSigno } from '../utils/numeros.js';
import { modoEntrada, teclaVisible } from '../core/modoEntrada.js';
import { RITMO, armarCancion, posicion, juzgar, marcarPerdidos, flowDe, nivelDe, trabada, rachaDe } from '../systems/rap/ritmo.js';
import { elegirPasajeros, gestoDurante, interes, cobrar, videoDelEstudiante, EFECTOS_RAP } from '../systems/rap/pago.js';
import { RapAudio } from '../systems/rap/RapAudio.js';
import { VEREDICTOS, CON_MAL_OLOR, GRITOS_RACHA, SILENCIOS, REPETIDO } from '../data/rapLetras.js';

const FUNDIDO_MS = 500;
const CUENTA_QUIETA_MS = 700; // quien venía machacando Espacio no se salta la cuenta sin leerla
const CORTES = ['corte-b', 'corte-c', 'corte-d'];
const SILENCIO_CADA = 3; // golpes perdidos seguidos para que el vagón se quede callado

export class RapEnElBus {
  /**
   * @param {object} game el juego (stats, audio, clock)
   * @param {{ audio?: RapAudio, random?: () => number, doc?: Document, ahora?: () => number }} opciones
   * `ahora` es el reloj en segundos cuando no hay audio (pruebas, audio bloqueado).
   */
  constructor(game, { audio = null, random = Math.random, doc = globalThis.document, ahora = () => globalThis.performance.now() / 1000 } = {}) {
    this.game = game;
    this.audio = audio ?? new RapAudio(game?.audio);
    this.random = random;
    this.doc = doc;
    this._ahoraSinAudio = ahora;
    this.estado = 'apagado'; // 'fundiendo' | 'cantando' | 'cuenta'
    this.root = null;
    this._onKey = (e) => this._tecla(e);
    this._onVisible = () => this._cambioDeVisibilidad();
    // Si cambia con qué se juega (el primer toque, un mando), la ayuda de la barra lo dice de una vez.
    this._onModo = () => { if (this.estado === 'cantando') this._pintarAyuda(); };
  }

  get activo() { return this.estado !== 'apagado'; }

  /** El vagón tapa toda la pantalla: detrás no hay nada que dibujar (como la plana y el recorte). */
  get opaco() { return (this.estado === 'cantando' || this.estado === 'cuenta') && !!this.root && !this.root.hidden; }

  /**
   * Empieza el rap. `hacia` es la parada de llegada; `onTermina(resultado)` corre cuando el jugador se baja.
   * El resultado: { nivel, flow, total, pagaron, filas, malOlor, repetido, video, estrofas }.
   * `repetido` es que ya rapeé hace poco (dan menos); `evitar`, las estrofas del rap anterior.
   */
  empezar({ hacia, sistema = 'TransMilenio', hora = 12, malOlor = false, repetido = false, evitar = [], onTermina = () => {} }) {
    if (this.activo) return false;
    this.hacia = hacia;
    this.sistema = sistema;
    this.malOlor = malOlor;
    this.repetido = repetido;
    this.onTermina = onTermina;
    this.cancion = armarCancion({ random: this.random, hora, evitar });
    this.pasajeros = elegirPasajeros(this.random);
    this.resultados = [];
    this.extras = 0;
    this.trabadas = new Map();
    this.resultado = null;
    this._compas = null;
    this._ultimaTrabada = null;
    this._ultimoSilencio = null;
    this._rachaVista = 0;
    this._rachaJuzgados = 0;
    this._rachaCompas = null;
    this._esperandoHasta = -Infinity;
    this._pausado = false;
    this.estado = 'fundiendo';
    if (this.game) this.game._traveling = true;
    this.doc?.defaultView?.addEventListener('keydown', this._onKey, true);
    this.doc?.addEventListener?.('visibilitychange', this._onVisible);
    this.doc?.defaultView?.addEventListener('modo-entrada', this._onModo);
    const velo = this.doc?.getElementById?.('viaje-fundido');
    if (velo) {
      velo.hidden = false;
      this.doc.defaultView.requestAnimationFrame(() => velo.classList.add('is-on'));
    }
    // Primero se va la calle; después suenan las puertas y aparece el vagón.
    this._esperaFundido = setTimeout(() => this._arrancar(), velo ? FUNDIDO_MS : 0);
    return true;
  }

  async _arrancar() {
    if (this.estado !== 'fundiendo') return;
    // Al elegir el viaje hubo un clic: si el audio estaba dormido, este es el momento de despertarlo.
    const ctx = this.audio?.audioSystem?.howler?.ctx;
    if (ctx?.state === 'suspended' && typeof ctx.resume === 'function') {
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
    }
    if (this.estado !== 'fundiendo') return;
    this._construir();
    this._pintarInicio();
    if (this.root) this.root.hidden = false;
    this.estado = 'cantando';
    this._conAudio = this.audio?.listo?.() ?? false;
    this._inicio = this._reloj() + RITMO.previa;
    if (this._conAudio) this.audio.empezar(this.cancion, this.audio.ahora() + RITMO.previa);
    this._cuadro();
  }

  /** El reloj de la canción: el del audio cuando suena (menos lo que tarda en oírse), y si no, el de la página. */
  _reloj() {
    return this._conAudio ? this.audio.ahora() - this.audio.latencia() : this._ahoraSinAudio();
  }

  /** Segundos de canción: negativos antes del primer golpe de la caja. */
  tiempo() { return this._reloj() - this._inicio; }

  // ---------- entrada ----------

  /** Un golpe del jugador. `atras` son los segundos desde que oprimió (el evento llega un poco después). */
  golpe(atras = 0) {
    if (this.estado !== 'cantando' || this._pausado) return null;
    const t = this.tiempo() - Math.max(0, Math.min(0.1, atras));
    if (t < -RITMO.ventanaBien) return null; // antes de arrancar no cuenta ni resta
    const r = juzgar(this.cancion, this.resultados, t);
    if (!r) { this.extras++; return null; }
    this.resultados[r.indice] = r.calidad;
    this._pintarPedazo(r.indice);
    this._pintarZona(r.indice);
    this._revisarRacha();
    return r;
  }

  /** Callarme a mitad del rap: no cobro y llego igual. */
  cancelar() {
    if (this.estado !== 'cantando') return;
    this._terminar(true);
  }

  /** Bajarme del vagón después de la cuenta. */
  continuar() {
    if (this.estado !== 'cuenta') return;
    const resultado = this.resultado;
    this._apagar();
    this.onTermina?.(resultado);
  }

  /** Lo que llega del mando (Gamepad.js, contexto 'rap'): A rima o sigue, B se calla o sigue. */
  mando(accion) {
    if (this.estado === 'cantando') {
      if (accion === 'confirm') this.golpe();
      else if (accion === 'back') this.cancelar();
    } else if (this.estado === 'cuenta' && (accion === 'confirm' || accion === 'back') && this._cuentaLista()) this.continuar();
  }

  _cuentaLista() {
    return (globalThis.performance?.now?.() ?? Infinity) - (this._cuentaDesde ?? -Infinity) >= CUENTA_QUIETA_MS;
  }

  _tecla(e) {
    if (!this.activo) return;
    const golpe = e.code === 'Space' || e.code === 'KeyE';
    const salir = e.code === 'Escape';
    const seguir = golpe || salir || e.code === 'Enter';
    if (!golpe && !salir && !seguir) return;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
    if (salir) e._panelHandled = true;
    if (e.repeat) return;
    if (this.estado === 'cantando') {
      if (golpe) this.golpe(this._atras(e));
      else if (salir) this.cancelar();
    } else if (this.estado === 'cuenta' && seguir && this._cuentaLista()) this.continuar();
  }

  /** Cuánto hace que ocurrió el evento, por su sello de tiempo. */
  _atras(e) {
    const ahora = globalThis.performance?.now?.();
    return Number.isFinite(e?.timeStamp) && Number.isFinite(ahora) && e.timeStamp > 0 ? (ahora - e.timeStamp) / 1000 : 0;
  }

  // ---------- el tiempo ----------

  _cuadro() {
    if (this.estado !== 'cantando') return;
    this._raf = this.doc?.defaultView?.requestAnimationFrame(() => this._cuadro());
    if (this._pausado) return;
    const t = this.tiempo();
    const perdidos = marcarPerdidos(this.cancion, this.resultados, t);
    for (const i of perdidos) {
      this.audio?.fallo?.();
      this._pintarPedazo(i);
      this._pintarZona(i);
    }
    if (perdidos.length) this._revisarRacha();
    const { compas, fraccion } = posicion(this.cancion, t);
    if (compas !== this._compas) this._entrarCompas(compas);
    if (this._marca) {
      this._marca.style.left = `${(compas < 0 ? 0 : fraccion) * 100}%`;
      this._marca.hidden = compas < 0 || this._esperandoHasta > t;
    }
    if (t >= this.cancion.fin + 0.35) this._terminar(false);
  }

  _entrarCompas(compas) {
    this._compas = compas;
    this._pintarLineas(compas);
    this._pintarBarra(compas);
    // Lo que gritó el vagón dura el compás en que salió y el siguiente.
    if (this._rachaCompas !== null && compas > this._rachaCompas + 1) this._pintarRacha(null);
    // La gente reacciona al empezar cada compás, no a cada golpe: lo que se escribe en la página cambia poco.
    if (compas >= 3) this._pintarGente(flowDe(this.cancion, this.resultados, this.extras, { soloJuzgados: true }));
  }

  /** Otra pestaña: el rap espera. Al volver, retoma desde el principio del compás en que iba, con la previa. */
  _cambioDeVisibilidad() {
    if (this.estado !== 'cantando') return;
    if (this.doc.hidden && !this._pausado) {
      this._pausado = true;
      this._tPausa = this.tiempo(); // el reloj sigue corriendo afuera: se retoma desde donde iba
      this.audio?.parar?.({ suave: false });
    } else if (!this.doc.hidden && this._pausado) {
      const desde = Math.max(0, posicion(this.cancion, this._tPausa ?? 0).compas);
      // Lo de ese compás se vuelve a jugar.
      this.cancion.golpes.forEach((g, i) => {
        if (g.compas >= desde) { delete this.resultados[i]; this.trabadas.delete(i); }
      });
      const inicioCompas = desde * this.cancion.compas;
      this._conAudio = this.audio?.listo?.() ?? false;
      this._inicio = this._reloj() + RITMO.previa - inicioCompas;
      this._esperandoHasta = inicioCompas;
      if (this._conAudio) this.audio.empezar(this.cancion, this.audio.ahora() + RITMO.previa - inicioCompas, { desde, puertas: false });
      this._compas = null;
      this._rachaVista = 0;
      this._rachaJuzgados = -1;
      this._pintarRacha(null);
      this._pausado = false;
    }
  }

  // ---------- el final ----------

  _terminar(cancelado) {
    this.estado = 'cuenta';
    if (this._raf) this.doc?.defaultView?.cancelAnimationFrame(this._raf);
    this.audio?.parar?.();
    const flow = cancelado ? 0 : flowDe(this.cancion, this.resultados, this.extras);
    const nivel = cancelado ? 'cancelado' : nivelDe(flow);
    const cobro = cancelado
      ? { filas: [], total: 0, pagaron: 0 }
      : cobrar({ pasajeros: this.pasajeros, nivel, malOlor: this.malOlor, repetido: this.repetido, random: this.random });
    const video = cancelado ? null : videoDelEstudiante(this.pasajeros, nivel, this.random);
    const estrofas = [...new Set(this.cancion.compases.map((c) => c.estrofa).filter(Boolean))];
    this.resultado = { nivel, flow, malOlor: this.malOlor, repetido: this.repetido && !cancelado, video, estrofas, ...cobro };
    this._cuentaDesde = globalThis.performance?.now?.() ?? 0;
    if (cobro.total > 0) this.game?.audio?.play?.('sell');
    this._pintarCuenta();
  }

  _apagar() {
    clearTimeout(this._esperaFundido);
    if (this._raf) this.doc?.defaultView?.cancelAnimationFrame(this._raf);
    this.audio?.parar?.({ suave: false });
    this.doc?.defaultView?.removeEventListener('keydown', this._onKey, true);
    this.doc?.removeEventListener?.('visibilitychange', this._onVisible);
    this.doc?.defaultView?.removeEventListener('modo-entrada', this._onModo);
    if (this.root) this.root.hidden = true;
    this.estado = 'apagado';
    this._pausado = false;
  }

  dispose() {
    if (this.activo) this._apagar();
    this.audio?.dispose?.();
    this.root?.remove();
    this.root = null;
  }

  // ---------- la página ----------

  _construir() {
    if (this.root || !this.doc) return;
    this._pista = el('div', { class: 'rap__pista' });
    this._marca = el('i', { class: 'rap__marca' });
    this._ayuda = el('p', { class: 'rap__ayuda' });
    this._linea = el('p', { class: 'rap__linea' });
    this._siguiente = el('p', { class: 'rap__siguiente' });
    this._racha = el('p', { class: 'retazo rap__racha', hidden: true, 'aria-live': 'polite' });
    this._ruta = el('p', { id: 'rap-ruta', class: 'rap__ruta carton corte-b' });
    this._gente = el('ul', { class: 'rap__gente', 'aria-label': 'La gente del vagón' });
    this._cuenta = el('div', { class: 'rap__cuenta', hidden: true, 'aria-live': 'polite' });
    this._escena = el('div', { class: 'rap__escena carton corte-c' }, this._linea, el('hr', { class: 'regla rap__regla' }), this._siguiente);
    this._barra = el('div', { class: 'rap__barra carton corte-d' }, this._pista, this._ayuda);
    this.root = el('section', { id: 'rap-bus', class: 'rap', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rap-ruta' },
      el('header', { class: 'rap__cabeza' }, this._ruta, this._racha),
      this._escena, this._barra, this._gente, this._cuenta);
    // Con el dedo, toda la escena es la tecla: un toque es un golpe.
    this.root.addEventListener('pointerdown', (e) => {
      if (this.estado !== 'cantando' || e.target.closest?.('button')) return;
      e.preventDefault();
      this.golpe(this._atras(e));
    });
    this.doc.body.appendChild(this.root);
  }

  _pintarInicio() {
    if (!this.root) return;
    const enMetro = /metro/i.test(this.sistema ?? '');
    this._ruta.textContent = `${enMetro ? 'En el vagón del Metro' : 'En el articulado'}, rumbo a ${this.hacia?.name ?? 'la otra estación'}`;
    this._escena.hidden = false;
    this._barra.hidden = false;
    this._gente.hidden = false;
    this._cuenta.hidden = true;
    this._cuenta.replaceChildren();
    this._pintarRacha(null);
    this._pintarAyuda();
    this._fichas = new Map();
    this._gente.replaceChildren(...this.pasajeros.map((p, i) => {
      const masa = el('span', { class: 'masa rap__interes' });
      const gesto = el('span', { class: 'rap__gesto' });
      const li = el('li', { class: `rap__pasajero carton ${CORTES[i % CORTES.length]}`, 'data-pasajero': p.id },
        icon(p.dibujo, { size: 30 }),
        el('span', { class: 'rap__nombre', text: p.nombre }),
        el('span', { class: 'rap__medidor' }, masa),
        gesto);
      this._fichas.set(p.id, { masa, gesto });
      return li;
    }));
    this._pintarGente(0.5, { sinGesto: true });
    this._linea.replaceChildren(el('span', { class: 'rap__pedazo is-dicho', text: '…' }));
    this._siguiente.textContent = this.cancion.compases[0]?.texto ?? '';
    this._pintarBarra(-1);
    this._compas = -1;
  }

  _pintarAyuda() {
    if (!this.root) return;
    const modo = modoEntrada();
    if (modo === 'tactil') {
      this._ayuda.replaceChildren('Toque la pantalla cuando la marca pase por lo negro');
      return;
    }
    const tecla = (t) => el('kbd', { text: teclaVisible(t) });
    this._ayuda.replaceChildren(
      tecla(modo === 'mando' ? 'E' : 'Espacio'), ' Rimar en lo negro ', tecla('Esc'), ' Callarme');
  }

  /** La línea del compás y, debajo, la que viene. */
  _pintarLineas(compas) {
    if (!this.root) return;
    const c = this.cancion.compases[compas];
    const sig = this.cancion.compases[compas + 1];
    if (!c) {
      this._linea.replaceChildren(el('span', { class: 'rap__pedazo is-dicho', text: '…' }));
    } else if (!c.pedazos.length) {
      this._linea.replaceChildren(el('span', { class: 'rap__pedazo is-dicho', text: c.texto }));
    } else {
      this._linea.replaceChildren(...c.pedazos.map((_, j) => el('span', { class: 'rap__pedazo', 'data-pedazo': j })));
      this.cancion.golpes.forEach((g, i) => { if (g.compas === compas) this._pintarPedazo(i); });
    }
    const texto = sig ? (sig.pedazos.length ? sig.pedazos.join(' ') : sig.texto) : '';
    this._siguiente.textContent = texto;
  }

  /** Cada pedazo: por decir, dicho (justo o bien) o trabado, con lo que salió en su lugar. */
  _pintarPedazo(i) {
    if (!this.root) return;
    const g = this.cancion.golpes[i];
    if (g.compas !== this._compas) return;
    const span = this._linea.querySelector(`[data-pedazo="${g.pedazo}"]`);
    if (!span) return;
    const texto = this.cancion.compases[g.compas].pedazos[g.pedazo];
    const r = this.resultados[i];
    span.className = `rap__pedazo${r === 'justo' ? ' is-dicho is-justo' : r === 'bien' ? ' is-dicho' : r === 'fuera' ? ' is-trabado' : ''}`;
    if (r === 'fuera') {
      if (!this.trabadas.has(i)) {
        this._ultimaTrabada = trabada(this.random, this._ultimaTrabada);
        this.trabadas.set(i, this._ultimaTrabada);
      }
      span.replaceChildren(el('s', { class: 'tachado', text: texto }), ' ', el('span', { class: 'rap__trabada', text: this.trabadas.get(i) }));
    } else span.replaceChildren(texto);
  }

  /** Las zonas negras de los golpes del compás. En el saludo no hay: la marca pasa sola, para mostrar cómo va. */
  _pintarBarra(compas) {
    if (!this.root) return;
    const c = this.cancion.compases[compas];
    const ancho = (2 * RITMO.ventanaBien / this.cancion.compas) * 100;
    const zonas = (c?.golpes ?? []).map((pos) => el('i', { class: 'rap__zona', style: `left:${pos * 100 - ancho / 2}%;width:${ancho}%` }));
    this._zonas = zonas;
    this._pista.replaceChildren(...zonas, this._marca);
    this.cancion.golpes.forEach((g, i) => { if (g.compas === compas) this._pintarZona(i); });
  }

  _pintarZona(i) {
    if (!this.root) return;
    const g = this.cancion.golpes[i];
    if (g.compas !== this._compas) return;
    const zona = this._zonas?.[g.pedazo];
    const r = this.resultados[i];
    if (zona) zona.className = `rap__zona${r ? ` is-${r}` : ''}`;
  }

  /** Las ganas de cada pasajero, como masa, y lo que hace. */
  _pintarGente(flowParcial, { sinGesto = false } = {}) {
    if (!this.root) return;
    for (const p of this.pasajeros) {
      const ficha = this._fichas?.get(p.id);
      if (!ficha) continue;
      ficha.masa.style.width = `${Math.round(interes(p, flowParcial) * 100)}%`;
      if (!sinGesto) ficha.gesto.textContent = gestoDurante(p, flowParcial);
    }
  }

  /**
   * Cuando la racha llega a una de las cuentas de GRITOS_RACHA, el vagón grita; cuando me trabo SILENCIO_CADA veces
   * seguidas, se queda callado. Cada grito sale una vez por rap.
   */
  _revisarRacha() {
    // Una vez por cada golpe nuevo juzgado: varios perdidos de un solo cuadro no repiten el silencio.
    const juzgados = this.resultados.filter(Boolean).length;
    if (juzgados === this._rachaJuzgados) return;
    this._rachaJuzgados = juzgados;
    const { buenos, malos } = rachaDe(this.cancion, this.resultados);
    if (buenos > this._rachaVista && GRITOS_RACHA[buenos]) {
      this._rachaVista = buenos;
      this._pintarRacha(GRITOS_RACHA[buenos], 'grito');
      this.audio?.grito?.();
    } else if (malos > 0 && malos % SILENCIO_CADA === 0) {
      let texto = SILENCIOS[Math.floor(this.random() * SILENCIOS.length) % SILENCIOS.length];
      if (texto === this._ultimoSilencio) texto = SILENCIOS[(SILENCIOS.indexOf(texto) + 1) % SILENCIOS.length];
      this._ultimoSilencio = texto;
      this._pintarRacha(texto, 'silencio');
    }
  }

  _pintarRacha(texto, tipo = 'grito') {
    // Se cuenta desde el compás que suena ahora, no desde el último que se pintó.
    this._rachaCompas = texto ? Math.max(this._compas ?? 0, posicion(this.cancion, this.tiempo()).compas) : null;
    if (!this._racha) return;
    this._racha.hidden = !texto;
    this._racha.textContent = texto ?? '';
    this._racha.className = `retazo rap__racha${tipo === 'silencio' ? ' is-silencio' : ''}`;
  }

  _pintarCuenta() {
    if (!this.root) return;
    const r = this.resultado;
    const v = VEREDICTOS[r.nivel];
    this._escena.hidden = true;
    this._barra.hidden = true;
    this._gente.hidden = true;
    const filas = r.filas.map(({ pasajero, dicho, pesos, billete }, i) => el('li', { class: `rap__fila carton ${CORTES[i % CORTES.length]}` },
      icon(pasajero.dibujo, { size: 28 }),
      el('span', { class: 'rap__fila-texto' },
        el('strong', { text: pasajero.nombre }),
        el('span', { class: dicho.dice ? 'rap__dice' : 'rap__hace', text: dicho.dice ? `«${dicho.dice}»` : dicho.hace })),
      pesos > 0
        ? el('span', { class: `cifra rap__pesos${billete ? ' is-billete' : ''}`, text: cop(pesos) })
        : el('span', { class: 'rap__pesos tachado', text: 'Nada' })));
    const animo = EFECTOS_RAP.animo[r.nivel] ?? 0;
    const efectos = [];
    if (animo) efectos.push(`ánimo ${conSigno(animo)}`);
    if (r.nivel !== 'cancelado') efectos.push(`energía ${conSigno(-EFECTOS_RAP.energia)}`, `sed ${conSigno(-EFECTOS_RAP.sed)}`);
    if (efectos.length) efectos[0] = efectos[0][0].toUpperCase() + efectos[0].slice(1);
    const boton = el('button', {
      type: 'button', class: 'cinta cinta--verbo rap__seguir',
      onclick: () => this.continuar(),
    }, r.nivel === 'bajado' ? 'Seguir a pie' : /metro/i.test(this.sistema ?? '') ? 'Bajarme del vagón' : 'Bajarme del bus');
    // replaceChildren no se salta los vacíos: los volvería texto.
    this._cuenta.replaceChildren(...[
      el('p', { class: 'retazo rap__grito', text: v.grito }),
      el('p', { class: 'rap__veredicto', text: v.linea }),
      r.malOlor && r.nivel !== 'cancelado' ? el('p', { class: 'rap__nota', text: CON_MAL_OLOR }) : null,
      r.repetido ? el('p', { class: 'rap__nota', text: REPETIDO }) : null,
      r.video ? el('p', { class: 'rap__nota', text: r.video }) : null,
      filas.length ? el('ul', { class: 'rap__filas' }, ...filas) : null,
      el('div', { class: 'rap__total carton corte-c' },
        el('span', { class: 'rap__total-texto', text: r.total > 0 ? 'Me hice' : 'No me hice nada' }),
        r.total > 0 ? el('span', { class: 'cifra rap__plata', text: cop(r.total) }) : null,
        efectos.length ? el('span', { class: 'rap__efectos', text: efectos.join(', ') }) : null),
      boton].filter(Boolean));
    this._cuenta.hidden = false;
    boton.focus?.({ preventScroll: true });
  }
}
