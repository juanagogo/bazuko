// src/ui/avisos.js
// El único creador de avisos. Hijos directos de body y encima de todo, apilados por su altura real, con un máximo a
// la vista según la pantalla y una cola para los demás. Nunca entran en la zona del personaje.
import { pasarTexto } from './pictos.js';

const TIPOS = { info: 'info', warn: 'warn', warning: 'warn', rare: 'rare', sell: 'sell', death: 'death' };
/** Los tipos que usa el juego, reducidos a los que tienen estilo. */
export const tipoDeAviso = (tipo) => TIPOS[tipo] ?? 'info';

const VIDA_MS = 2500;     // lo que dura un aviso si nadie espera
const APURADO_MS = 900;   // lo mínimo que se deja leer cuando hay otros en la cola
const MS_POR_LETRA = 55;  // un aviso largo dura más: tiene que alcanzar a leerse
const MS_POR_LETRA_APURADO = 30;
const COLA_MAXIMA = 12;   // de ahí en adelante se pierde lo más viejo que sea solo información
const SEPARACION = 6;
const AIRE = 8;
/** Peligro antes que información: lo grave pasa adelante en la cola. */
const PRIORIDAD = { death: 0, warn: 1, rare: 2, sell: 2, info: 3 };
const VIEJO_MS = 8000;    // información que lleva esto esperando ya no le sirve a nadie
const ANCHO_ESCRITORIO = 900;
const ALTO_DE_CELULAR = 500; // un celular grande acostado pasa de 900 de ancho, pero sigue siendo un celular
const esEscritorio = (ancho, alto) => ancho >= ANCHO_ESCRITORIO && alto > ALTO_DE_CELULAR;
const PERSONAJE_Y = .4;   // en celular de pie la pila no baja de aquí: 40 % del alto, donde empieza el personaje

/** 3 en escritorio, 2 con el celular acostado, 1 con el celular de pie. */
export function avisosALaVista(ancho, alto) {
  if (esEscritorio(ancho, alto)) return 3;
  return ancho > alto ? 2 : 1;
}

const caja = (doc, id) => {
  const el = doc.getElementById(id);
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect?.();
  return r && r.height > 0 ? r : null;
};

/** La franja de pantalla donde caben los avisos: se calcula al poner o quitar uno, no por cuadro. */
export function zonaDeAvisos(doc, ancho, alto) {
  const dock = caja(doc, 'hud-dock');
  const retazo = caja(doc, 'retazo');
  if (esEscritorio(ancho, alto)) {
    const techo = caja(doc, 'game-settings')?.bottom ?? 60;
    return { arriba: techo + 14, abajo: (retazo?.top ?? dock?.top ?? alto) - AIRE };
  }
  if (ancho > alto) {
    const topbar = caja(doc, 'topbar');
    return { arriba: (topbar?.bottom ?? 90) + AIRE, abajo: alto - 60 };
  }
  const encima = Math.max(retazo?.bottom ?? 0, dock?.bottom ?? 120, caja(doc, 'mision')?.bottom ?? 0);
  return { arriba: encima + AIRE, abajo: alto * PERSONAJE_Y };
}

export class Avisos {
  constructor() {
    this.visibles = [];
    this.cola = [];
    globalThis.window?.addEventListener?.('resize', () => this.acomodar());
  }

  /** @param {string} texto puede traer emojis: salen como dibujos de la letra. */
  poner(texto, tipo = 'info') {
    const limpio = pasarTexto(String(texto ?? ''));
    if (!limpio) return;
    // El mismo aviso otra vez no se apila: el viejo cede su sitio.
    const repetido = this.visibles.find((a) => a.texto === limpio);
    if (repetido) this._quitar(repetido, false);
    const nuevo = { texto: limpio, tipo: tipoDeAviso(tipo), entra: globalThis.performance.now() };
    // Detrás de lo que pesa igual o más, y delante de lo que pesa menos.
    const antes = this.cola.findIndex((a) => PRIORIDAD[a.tipo] > PRIORIDAD[nuevo.tipo]);
    this.cola.splice(antes < 0 ? this.cola.length : antes, 0, nuevo);
    if (this.cola.length > COLA_MAXIMA) {
      const i = this.cola.findLastIndex((a) => a.tipo === 'info');
      this.cola.splice(i < 0 ? this.cola.length - 1 : i, 1);
    }
    this._atender();
  }

  /** En plena persecución, o tras mucho esperar, la información vieja se bota: ya no es de ahora. */
  _botarLoViejo() {
    const ahora = globalThis.performance.now();
    const estado = globalThis.document?.getElementById?.('wanted')?.dataset?.estado;
    const persecucion = estado === 'detras' || estado === 'encima';
    this.cola = this.cola.filter((a) => a.tipo !== 'info' || (!persecucion && ahora - a.entra < VIEJO_MS));
  }

  _tope() {
    const ancho = globalThis.innerWidth ?? 1440, alto = globalThis.innerHeight ?? 900;
    return avisosALaVista(ancho, alto);
  }

  _atender() {
    this._botarLoViejo();
    while (this.cola.length && this.visibles.length < this._tope()) {
      if (!this._mostrar(this.cola[0])) break;
      this.cola.shift();
    }
    // Con cola no se espera la vida entera: el más viejo se apura, y ya se alcanzó a leer.
    const viejo = this.visibles[0];
    if (this.cola.length && viejo && !viejo.apurado) {
      viejo.apurado = true;
      clearTimeout(viejo.reloj);
      const leido = globalThis.performance.now() - viejo.nace;
      viejo.reloj = setTimeout(() => this._quitar(viejo), Math.max(0, Math.max(APURADO_MS, viejo.texto.length * MS_POR_LETRA_APURADO) - leido));
    }
  }

  /** Devuelve false si no cabe en lo que queda de franja: espera en la cola. */
  _mostrar({ texto, tipo }) {
    const doc = globalThis.document;
    const el = doc.createElement('div');
    el.className = `loot-toast carton corte-d ${tipo}`;
    el.textContent = texto;
    doc.body.appendChild(el);
    const aviso = { el, texto, tipo, nace: globalThis.performance.now(), apurado: false, reloj: 0 };
    this.visibles.push(aviso);
    if (!this.acomodar() && this.visibles.length > 1) {
      this.visibles.pop();
      el.remove();
      return false;
    }
    aviso.reloj = setTimeout(() => this._quitar(aviso), Math.max(VIDA_MS, texto.length * MS_POR_LETRA));
    return true;
  }

  _quitar(aviso, atender = true) {
    const i = this.visibles.indexOf(aviso);
    if (i < 0) return;
    clearTimeout(aviso.reloj);
    this.visibles.splice(i, 1);
    aviso.el.remove();
    if (atender) this._atender();
    this.acomodar();
  }

  /** Coloca la pila por la altura real de cada aviso. Devuelve false si el último se sale de la franja. */
  acomodar() {
    if (!this.visibles.length) return true;
    const doc = globalThis.document;
    const zona = zonaDeAvisos(doc, globalThis.innerWidth ?? 1440, globalThis.innerHeight ?? 900);
    let y = zona.arriba;
    for (const { el } of this.visibles) {
      const top = `${Math.round(y)}px`;
      if (el.style.top !== top) el.style.top = top;
      el.style.setProperty?.('--pila', `${Math.round(y - zona.arriba)}px`); // con un menú abierto manda la hoja de estilos
      y += (el.offsetHeight ?? 0) + SEPARACION;
    }
    return y - SEPARACION <= zona.abajo;
  }
}
