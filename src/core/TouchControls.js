// src/core/TouchControls.js
// Los controles con el dedo: palanca a la izquierda, botones sueltos a la derecha, «Más» con lo demás, y mirar arrastrando
// en lo que queda libre. Cada dedo es un puntero aparte, así que mover y mirar van a la vez.
// Los botones inyectan las mismas teclas que el mando, de modo que el juego no tiene una lógica aparte para el dedo.
import { BUTTON_KEYS, getGamepadContext, emitirTecla } from './Gamepad.js';
import { modoEntrada, ponerModo } from './modoEntrada.js';

const ZONA_MUERTA = .14;
const TOPE = .86;              // el dedo no tiene que llegar hasta el aro para ir a toda
const SENSIBILIDAD = 1.4;      // la pantalla del celular es corta: el mismo giro con menos recorrido
const TOQUE_CORTO_MS = 260;    // Correr: un toque lo deja puesto; sostenido dura lo que dure el dedo
const GRACIA_PALANCA_MS = 400; // soltar la palanca un instante para reacomodar el dedo no quita el correr
const REVISION_MS = 100;
const CLIC_REPETIDO_MS = 500;
// Lo que el navegador activaría con un clic, en cualquier menú. Los controles de esta clase llevan su propio camino.
const PULSABLE = 'button, a[href], label, summary, [role="button"], [role="tab"], input[type="checkbox"], input[type="radio"], .qb-slot, .talent-node.available';
const CON_CAMINO_PROPIO = '#acciones, #joystick, #interaction-prompt';
const MARGEN_DEL_DEDO = 8;     // un dedo que se levanta justo en el borde todavía está en el botón
const BRINCO_TRAS_BARRA_MS = 250; // el segundo toque de Detener llega cuando el botón ya dice Brincar: no es un brinco
const PASO_RATON = 8;          // lo que hay que mover el ratón para que cuente como «volvió al ratón»
const pulsableDe = (objetivo) => {
  const b = objetivo?.closest?.(PULSABLE);
  return b && !b.closest(CON_CAMINO_PROPIO) ? b : null;
};

/** La palanca: del dedo respecto al centro a un vector de -1 a 1, con zona muerta y tope. La palanca dibujada no sale del aro. */
export function vectorDePalanca(dx, dy, radio) {
  const largo = Math.hypot(dx, dy), r = Math.max(1, radio);
  const fuera = largo > r ? r / largo : 1;
  const dibujo = { x: dx * fuera, y: dy * fuera };
  const n = largo / r;
  if (n < ZONA_MUERTA) return { x: 0, y: 0, dibujo };
  const fuerza = Math.min(1, (n - ZONA_MUERTA) / (TOPE - ZONA_MUERTA));
  return { x: dx / largo * fuerza, y: dy / largo * fuerza, dibujo };
}

/** Modo con que arranca: lo fuerza `?tactil=1` o `0`; si no, el puntero grueso principal es un celular o una tableta. */
export function modoInicial(busqueda = '', punteroGrueso = false) {
  const forzado = /[?&]tactil=([01])\b/.exec(busqueda)?.[1];
  if (forzado === '1') return { modo: 'tactil', forzado: true };
  if (forzado === '0') return { modo: 'teclado', forzado: true };
  return { modo: punteroGrueso ? 'tactil' : 'teclado', forzado: false };
}

/** Una tecla física de verdad: ni la escribe el teclado de la pantalla en un campo, ni la inyecta el mando o el dedo. */
export function esTeclaFisica(e) {
  if (e.isTrusted === false || e.gamepadInput) return false;
  if (!e.code || e.code === 'Unidentified') return false;
  return !e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

const tecla = (boton) => BUTTON_KEYS[boton];

/** Lo que siempre está a mano. */
export const A_LA_MANO = [
  { id: 'pegar', texto: 'Pegar', tecla: tecla(5) },
  { id: 'brincar', texto: 'Brincar', tecla: tecla(6) },
  { id: 'correr', texto: 'Correr', correr: true },
];

/** Lo que va en «Más». `puede` dice si se puede ahora: lo que no, sale tachado. `alSoltar`: la tecla sale al levantar el dedo dentro del botón; antes hay cómo arrepentirse. */
export const EN_MAS = [
  { id: 'pedir', texto: 'Pedir', tecla: tecla(14), alSoltar: true },
  { id: 'envion', texto: 'Envión', tecla: tecla(15), alSoltar: true },
  { id: 'lanzar', texto: 'Lanzar', tecla: tecla(13), alSoltar: true, puede: (g) => (g.inventory?.count?.('popo') ?? 0) > 0 },
  { id: 'popo', texto: 'Popó', tecla: 'KeyZ', alSoltar: true },
  { id: 'robar', texto: 'Robo directo', tecla: tecla(2), alSoltar: true, puede: (g) => !!g.steal?.targetNpc && !(g.steal.cooldown > 0) },
  { id: 'mantener', texto: 'Mantener: seleccionar', tecla: tecla(2), puede: (g) => g.interaction?.currentTargetType === 'pickup' },
  { id: 'detener', texto: 'Detener', tecla: tecla(6), puede: (g) => !!g.steal?.minigameActive },
  { id: 'manas', texto: 'Mañas', tecla: 'KeyT', alSoltar: true },
  { id: 'camara', texto: 'Cámara', tecla: tecla(4), alSoltar: true },
  { id: 'foto', texto: 'Foto', tecla: 'F2', alSoltar: true },
  { id: 'radio', texto: 'Radio', tecla: tecla(12), alSoltar: true },
  { id: 'sonido', texto: 'Sonido', evento: 'audio-toggle' },
  { id: 'ayuda', texto: 'Ayuda', evento: 'open-pause-menu', detalle: { tab: 'controles' } },
];

/** La pestaña Controles de la pausa, para quien juega con el dedo. */
export const CONTROLES_CON_EL_DEDO = [
  ['Moverse', [['Palanca', 'Caminar: entre más lejos del centro, más rápido'], ['Correr', 'Un toque lo deja puesto; sostenido dura lo que dure el dedo'], ['Brincar', 'Saltar'], ['Lo demás', 'Arrastre el dedo para mirar']]],
  ['Hacer', [['La cinta', 'Sale cuando hay algo que hacer: tóquela o sosténgala'], ['Pegar', 'Golpear'], ['Más', 'Pedir, Envión, Lanzar, Popó, Robo directo, Mantener, Detener']]],
  ['Paneles', [['Costal', 'Lo que lleva'], ['Fabricar', 'La mesa'], ['Radar', 'Tóquelo para acercar, alejar u ocultar'], ['Más', 'Mañas, Cámara, Foto, Radio, Sonido y esta Ayuda']]],
];

export class TouchControls {
  constructor(game, { doc = globalThis.document, win = globalThis.window } = {}) {
    this.game = game;
    this.doc = doc;
    this.win = win;
    this.input = game?.input;
    this._teclas = new Map();     // tecla → cuántos dedos la tienen oprimida
    this._dedos = new Map();      // puntero → botón que oprimió
    this._palanca = null;
    this._mirada = null;
    this._libres = new Map();     // dedos en lo libre: el que mira y los que esperan para mirar cuando ese se levante
    this._corriendoFijo = false;
    this._soltoPalanca = 0;
    this._barraHasta = 0;
    this._contexto = null;
    this._sinClicHasta = 0;
    this.joystick = doc?.getElementById?.('joystick');
    this.acciones = doc?.getElementById?.('acciones');
    if (!this.joystick || !this.acciones || !win) return;
    this._construir();
    this._activacion();
    this._mirar();
    this._avisoDeContexto();
    this._conOtroDedo();
    this._alCambiarModo();
  }

  // ---------- cuándo se muestra ----------
  _activacion() {
    const { win, doc } = this;
    const { modo, forzado } = modoInicial(win.location?.search ?? '', !!win.matchMedia?.('(pointer: coarse)').matches);
    ponerModo(modo, { fijar: forzado });
    win.addEventListener('modo-entrada', () => this._alCambiarModo());
    doc.addEventListener('gesturestart', (e) => { if (modoEntrada() === 'tactil') e.preventDefault(); });
    if (forzado) return;
    win.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') ponerModo('tactil');
      else if (e.pointerType === 'mouse' && !this._hayDedos()) ponerModo('teclado');
    }, true);
    // El dedo también gana si el toque entra primero por aquí: algunos navegadores tardan en dar el puntero.
    win.addEventListener('touchstart', () => ponerModo('tactil'), { capture: true, passive: true });
    win.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || modoEntrada() === 'teclado' || this._hayDedos()) return;
      if (Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0) >= PASO_RATON) ponerModo('teclado');
    }, true);
    win.addEventListener('keydown', (e) => {
      if (modoEntrada() !== 'teclado' && !this._hayDedos() && esTeclaFisica(e)) ponerModo('teclado');
    }, true);
  }

  _hayDedos() { return this._dedos.size > 0 || !!this._palanca || !!this._mirada; }

  _alCambiarModo() {
    if (this.game?.hud) this.game.hud._promptTexto = undefined; // la tecla de contexto se vuelve a escribir para este modo
    const dedo = modoEntrada() === 'tactil';
    if (!dedo) { this._soltarTodo(); this._revisar(); }
    // Con ratón y teclado no hay reloj. La primera revisión llega cuando el juego ya se armó: esta clase se crea en medio.
    if (dedo && !this._reloj) this._reloj = this.win.setInterval(() => this._revisar(), REVISION_MS);
    else if (!dedo && this._reloj) { this.win.clearInterval(this._reloj); this._reloj = null; }
  }

  // ---------- lo que se dibuja ----------
  _construir() {
    const { doc } = this;
    const aro = doc.createElement('span');
    aro.className = 'joystick__aro';
    const palanca = doc.createElement('i');
    palanca.className = 'joystick__palanca';
    aro.append(palanca);
    this.joystick.append(aro);
    this.aro = aro;
    this.palancaEl = palanca;
    aro.addEventListener('pointerdown', (e) => this._palancaAbajo(e));
    aro.addEventListener('pointermove', (e) => this._palancaMueve(e));
    for (const fin of ['pointerup', 'pointercancel', 'lostpointercapture']) aro.addEventListener(fin, (e) => this._palancaArriba(e));

    this.botones = {};
    for (const accion of A_LA_MANO) this.acciones.append(this._boton(accion, 'tactil-boton'));
    this.masBoton = this._boton({ id: 'mas', texto: 'Más', mas: true }, 'tactil-boton tactil-boton--mas');
    this.masBoton.setAttribute('aria-expanded', 'false');
    this.masBoton.setAttribute('aria-controls', 'tactil-mas');
    this.acciones.append(this.masBoton);

    const hoja = doc.createElement('div');
    hoja.id = 'tactil-mas';
    hoja.className = 'carton corte-c';
    hoja.setAttribute('role', 'group');
    hoja.setAttribute('aria-label', 'Más acciones');
    hoja.hidden = true;
    for (const accion of EN_MAS) hoja.append(this._boton(accion, 'tactil-mas__boton'));
    this.acciones.append(hoja);
    this.hoja = hoja;

    // Tocar por fuera cierra la hoja, y el mismo dedo sigue con lo que iba a hacer.
    this.win.addEventListener('pointerdown', (e) => {
      if (!this.hoja.hidden && !e.target?.closest?.('#tactil-mas, .tactil-boton--mas')) this._abrirMas(false);
    }, true);
    this.win.addEventListener('blur', () => this._soltarTodo());
    this.doc.addEventListener('visibilitychange', () => { if (this.doc.hidden) this._soltarTodo(); });
    this.win.addEventListener('contextmenu', (e) => {
      if (modoEntrada() === 'tactil' && !e.target?.closest?.('input, textarea')) e.preventDefault();
    });
  }

  _boton(accion, clase) {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.className = `cinta ${clase}`;
    b.dataset.accion = accion.id;
    b.textContent = accion.texto;
    this.botones[accion.id] = b;
    if (accion.correr) b.setAttribute('aria-pressed', 'false');
    b.addEventListener('pointerdown', (e) => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      e.preventDefault();
      try { b.setPointerCapture?.(e.pointerId); } catch { /* sin captura */ }
      b.classList.add('oprimido');
      this._dedos.set(e.pointerId, { b, accion, desde: performance.now(), codigo: this._oprimir(accion) });
    });
    const soltar = (e) => {
      const dedo = this._dedos.get(e.pointerId);
      if (!dedo || dedo.b !== b) return;
      this._dedos.delete(e.pointerId);
      b.classList.remove('oprimido');
      this._tragarClic();
      // Una interrupción, o un dedo que se fue del botón antes de levantarse, suelta las teclas y nada más.
      this._soltar(accion, performance.now() - dedo.desde, dedo.codigo, e.type === 'pointerup' && this._dentro(b, e));
    };
    for (const fin of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(fin, soltar);
    // Un lector de pantalla no manda punteros: su toque llega como clic sin detalle.
    b.addEventListener('click', (e) => {
      if (e.detail !== 0 || b.getAttribute('aria-disabled') === 'true') return;
      this._soltar(accion, TOQUE_CORTO_MS - 1, this._oprimir(accion));
    });
    return b;
  }

  // ---------- oprimir y soltar ----------
  /** Devuelve la tecla que quedó oprimida: al soltar se suelta esa, aunque entre tanto el botón ya signifique otra cosa. */
  _oprimir(accion) {
    if (accion.mas || accion.evento || accion.alSoltar) return null;
    if (accion.correr) {
      this._yaFijo = this._corriendoFijo;
      this._ponerCorrer(true);
      return null;
    }
    const codigo = this._teclaDe(accion);
    if (codigo === 'Space') {
      if (this.game?.steal?.minigameActive) this._barraHasta = performance.now() + BRINCO_TRAS_BARRA_MS;
      else if (performance.now() < this._barraHasta) return null;
    }
    this._bajar(codigo);
    return codigo;
  }

  /** `vale` es que el dedo se levantó en el botón. Si no, solo se suelta lo que estaba oprimido. */
  _soltar(accion, duracion, codigo, vale = true) {
    if (accion.mas) { if (vale) this._abrirMas(this.hoja.hidden); return; }
    if (accion.correr) {
      const fijar = vale ? duracion < TOQUE_CORTO_MS && !this._yaFijo : !!this._yaFijo;
      this._corriendoFijo = fijar;
      this._soltoPalanca = 0; // lo que cuenta es soltar la palanca de aquí en adelante
      this._ponerCorrer(fijar);
      return;
    }
    if (codigo) this._subir(codigo);
    if (!vale) return;
    if (accion.evento) this.win.dispatchEvent(new CustomEvent(accion.evento, { detail: accion.detalle }));
    else if (accion.alSoltar) { emitirTecla('keydown', accion.tecla); emitirTecla('keyup', accion.tecla); }
    if (!this.hoja.hidden && this.hoja.contains(this.botones[accion.id])) this._abrirMas(false);
  }

  _dentro(b, e) {
    const r = b.getBoundingClientRect();
    return e.clientX >= r.left - MARGEN_DEL_DEDO && e.clientX <= r.right + MARGEN_DEL_DEDO
      && e.clientY >= r.top - MARGEN_DEL_DEDO && e.clientY <= r.bottom + MARGEN_DEL_DEDO;
  }

  /** Mientras hay barra de robo, Pegar la cancela: no se puede abrir una hoja a contrarreloj. */
  _teclaDe(accion) {
    if (accion.id === 'pegar' && this.game?.steal?.minigameActive) return 'Escape';
    return accion.tecla;
  }

  _bajar(codigo) {
    const n = this._teclas.get(codigo) ?? 0;
    this._teclas.set(codigo, n + 1);
    if (n === 0) emitirTecla('keydown', codigo);
  }

  _subir(codigo) {
    const n = this._teclas.get(codigo) ?? 0;
    if (n > 1) { this._teclas.set(codigo, n - 1); return; }
    if (n === 1) { this._teclas.delete(codigo); emitirTecla('keyup', codigo); }
  }

  _ponerCorrer(si) {
    if (this.input?.touch) this.input.touch.running = si;
    this.botones.correr.setAttribute('aria-pressed', si ? 'true' : 'false');
    this.botones.correr.classList.toggle('elegido', si);
    this._pintarPilas();
  }

  /** Lo urgente no va solo en el color: con algo detrás, y sin correr todavía, el botón también lo dice. */
  _pintarPilas() {
    const pilas = !!this._peligro && !this.input?.touch?.running;
    this.botones.correr.textContent = pilas ? 'Corra' : 'Correr';
  }

  _abrirMas(si) {
    this.hoja.hidden = !si;
    this.masBoton.setAttribute('aria-expanded', si ? 'true' : 'false');
    this.masBoton.classList.toggle('elegido', si);
    this.doc.body.classList.toggle('tactil--mas', si); // nada pasa por encima de la hoja: ni la cinta ni los avisos
    if (si) this._revisarMas();
  }

  /** Suelta todo lo que estuviera oprimido: se abrió un panel, se perdió el foco o el dedo ya no manda. */
  _soltarTodo() {
    for (const codigo of this._teclas.keys()) emitirTecla('keyup', codigo, true);
    this._teclas.clear();
    for (const { b } of this._dedos.values()) b.classList.remove('oprimido');
    this._dedos.clear();
    if (this._palanca) this._palancaFin();
    this._mirada = null;
    this._libres.clear();
    this._corriendoFijo = false;
    if (this.botones) this._ponerCorrer(false);
    if (this.hoja && !this.hoja.hidden) this._abrirMas(false);
  }

  // ---------- la palanca ----------
  _palancaAbajo(e) {
    if (this._palanca) return;
    e.preventDefault();
    try { this.aro.setPointerCapture?.(e.pointerId); } catch { /* sin captura */ }
    const r = this.aro.getBoundingClientRect();
    this._palanca = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, radio: r.width / 2 };
    this._soltoPalanca = 0;
    this.aro.classList.add('oprimido');
    this._palancaMueve(e);
  }

  _palancaMueve(e) {
    const p = this._palanca;
    if (!p || p.id !== e.pointerId) return;
    const v = vectorDePalanca(e.clientX - p.cx, e.clientY - p.cy, p.radio);
    if (this.input?.touch) { this.input.touch.move.x = v.x; this.input.touch.move.y = v.y; }
    this.palancaEl.style.transform = `translate(${v.dibujo.x.toFixed(1)}px, ${v.dibujo.y.toFixed(1)}px)`;
  }

  _palancaArriba(e) {
    if (this._palanca?.id === e.pointerId) this._palancaFin();
  }

  _palancaFin() {
    this._palanca = null;
    this._soltoPalanca = performance.now();
    this.aro.classList.remove('oprimido');
    if (this.input?.touch) { this.input.touch.move.x = 0; this.input.touch.move.y = 0; }
    this.palancaEl.style.transform = '';
  }

  // ---------- mirar con el dedo ----------
  _mirar() {
    const canvas = this.game?.canvas ?? this.doc.getElementById('game-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (!this._puedeMirar()) return;
      e.preventDefault();
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* sin captura */ }
      const dedo = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this._libres.set(e.pointerId, dedo);
      this._mirada ??= dedo;
    });
    canvas.addEventListener('pointermove', (e) => {
      const dedo = this._libres.get(e.pointerId);
      if (!dedo) return;
      if (dedo === this._mirada) {
        if (!this._puedeMirar()) { this._mirada = null; this._libres.clear(); return; }
        this.game.cameraRig.orbit((e.clientX - dedo.x) * SENSIBILIDAD, (e.clientY - dedo.y) * SENSIBILIDAD);
      }
      // El que espera también lleva la cuenta: al tomar el mirar sigue desde donde está, sin salto.
      dedo.x = e.clientX;
      dedo.y = e.clientY;
    });
    for (const fin of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(fin, (e) => {
        this._libres.delete(e.pointerId);
        if (this._mirada?.id === e.pointerId) this._mirada = this._libres.values().next().value ?? null;
      });
    }
  }

  _puedeMirar() {
    const rig = this.game?.cameraRig;
    return !!rig && rig.mode === 'third-person' && (rig.canControl?.() ?? true);
  }

  // ---------- la tecla de contexto y la barra de robo ----------
  _avisoDeContexto() {
    const prompt = this.doc.getElementById('interaction-prompt');
    if (prompt) {
      // Se escucha en el contenedor: el HUD reescribe sus piezas si cambia el texto, y el dedo sigue oprimiendo.
      const dedos = new Map();
      prompt.addEventListener('pointerdown', (e) => {
        const pieza = e.target?.closest?.('.cx[data-tecla]');
        if (!pieza || modoEntrada() !== 'tactil') return;
        e.preventDefault();
        try { prompt.setPointerCapture?.(e.pointerId); } catch { /* sin captura */ }
        const codigo = pieza.dataset.tecla;
        dedos.set(e.pointerId, codigo);
        this._bajar(codigo);
      });
      const soltar = (e) => {
        const codigo = dedos.get(e.pointerId);
        if (!codigo) return;
        dedos.delete(e.pointerId);
        this._tragarClic();
        this._subir(codigo);
      };
      for (const fin of ['pointerup', 'pointercancel', 'lostpointercapture']) prompt.addEventListener(fin, soltar);
      prompt.addEventListener('click', (e) => {
        const pieza = e.target?.closest?.('.cx[data-tecla]');
        if (!pieza || e.detail !== 0) return;
        emitirTecla('keydown', pieza.dataset.tecla);
        emitirTecla('keyup', pieza.dataset.tecla);
      });
    }
    // La barra de robo: tocarla la detiene, igual que Brincar mientras está.
    this.doc.addEventListener('pointerdown', (e) => {
      if (modoEntrada() !== 'tactil' || !e.target?.closest?.('#steal-minigame')) return;
      e.preventDefault();
      this._tragarClic();
      if (this.game?.steal?.minigameActive) this._barraHasta = performance.now() + BRINCO_TRAS_BARRA_MS;
      emitirTecla('keydown', 'Space');
      emitirTecla('keyup', 'Space');
    });
  }

  // ---------- todo lo demás que se oprime, con otro dedo ya en la pantalla ----------
  /**
   * El navegador no da clic mientras haya otro dedo abajo: sin esto, con el pulgar en la palanca no se podría comer, ni
   * abrir el costal, ni tocar nada de un menú. El clic lo da este código al levantar el dedo, si sigue en el mismo botón.
   * Lo que un teléfono haga además de eso no cuenta dos veces: el clic del navegador que llegue después se traga.
   */
  _conOtroDedo() {
    const { win } = this;
    const vivos = new Map(); // puntero → botón que oprimió, y si hubo otro dedo mientras tanto
    win.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      this._sinClicHasta = 0; // un toque nuevo es otro asunto: su clic sí vale
      for (const dedo of vivos.values()) dedo.conOtro = true;
      vivos.set(e.pointerId, { boton: pulsableDe(e.target), conOtro: vivos.size > 0 });
    }, true);
    win.addEventListener('pointerup', (e) => {
      const dedo = vivos.get(e.pointerId);
      vivos.delete(e.pointerId);
      if (!dedo?.boton || !dedo.conOtro) return;
      if (dedo.boton !== pulsableDe(this.doc.elementFromPoint?.(e.clientX, e.clientY))) return;
      this._tragarClic();
      dedo.boton.click();
    }, true);
    win.addEventListener('pointercancel', (e) => { vivos.delete(e.pointerId); }, true);
    const olvidar = () => vivos.clear();
    win.addEventListener('blur', olvidar);
    this.doc.addEventListener('visibilitychange', () => { if (this.doc.hidden) olvidar(); });
    // El clic que el navegador manda tras soltar un control cae en lo que haya debajo: el panel que ese toque acaba de
    // abrir, con sus botones de comprar o desbloquear.
    win.addEventListener('click', (e) => {
      if (e.isTrusted && e.detail !== 0 && performance.now() < this._sinClicHasta) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  _tragarClic() { this._sinClicHasta = performance.now() + CLIC_REPETIDO_MS; }

  // ---------- lo que cambia con el juego, diez veces por segundo y solo con el dedo ----------
  _revisar() {
    const clases = this.doc.body.classList;
    if (modoEntrada() !== 'tactil') {
      if (this._contexto !== null) { clases.remove('tactil--juego'); this._contexto = null; }
      return;
    }
    const g = this.game;
    const tipo = g ? getGamepadContext(g, this.doc).kind : 'blocked';
    if (tipo !== this._contexto) {
      this._contexto = tipo;
      clases.toggle('tactil--juego', tipo === 'gameplay');
      if (tipo !== 'gameplay') this._soltarSinMirada();
    }
    if (tipo !== 'gameplay') return;
    if (this._corriendoFijo && !this._palanca && this._soltoPalanca && performance.now() - this._soltoPalanca > GRACIA_PALANCA_MS) {
      this._corriendoFijo = false;
      this._ponerCorrer(false);
    }
    const robando = !!g.steal?.minigameActive;
    if (robando !== this._robando) {
      this._robando = robando;
      this.botones.brincar.textContent = robando ? 'Detener' : 'Brincar';
      this.botones.pegar.textContent = robando ? 'Cancelar' : 'Pegar';
      clases.toggle('tactil--robando', robando);
    }
    const peligro = this._teVanSiguiendo(g);
    if (peligro !== this._peligro) {
      this._peligro = peligro;
      this.botones.correr.classList.toggle('tactil-boton--pilas', peligro);
      this._pintarPilas();
    }
    if (!this.hoja.hidden) this._revisarMas();
  }

  _soltarSinMirada() {
    const mirada = this._mirada, libres = new Map(this._libres);
    this._soltarTodo();
    this._mirada = mirada;
    this._libres = libres;
  }

  /** Patrulla, varilla o camioneta detrás: el botón Correr se marca, porque el aviso ya no puede decir tecla. */
  _teVanSiguiendo(g) {
    return !!g.traffic?.inPursuit || g.roadRage?.state === 'out' || g.limpieza?.state === 'out';
  }

  _revisarMas() {
    const g = this.game;
    for (const accion of EN_MAS) {
      if (!accion.puede) continue;
      const si = !g || accion.puede(g);
      const b = this.botones[accion.id];
      if ((b.getAttribute('aria-disabled') === 'true') === si) b.setAttribute('aria-disabled', si ? 'false' : 'true');
    }
    const silencio = !!g?.audio?.muted;
    const sonido = this.botones.sonido;
    if (sonido && silencio !== this._silencio) {
      this._silencio = silencio;
      sonido.textContent = silencio ? 'Con sonido' : 'Sin sonido';
    }
  }
}
