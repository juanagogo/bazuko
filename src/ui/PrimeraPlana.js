// src/ui/PrimeraPlana.js
// La primera plana: la única cosa impresa en grande. El titular se ajusta al ancho y el último cuadro del juego se
// reimprime una sola vez en semitono de una tinta. Después no se pinta nada más: es una página quieta.
import * as THREE from 'three';
import { el } from './dom.js';
import { imprimir } from './impresion.js';
import { encuadrar, redondelAMano, sitioDelPie } from './momentosTextos.js';

const NS = 'http://www.w3.org/2000/svg';
const MAX_COPIA = 1280;      // el cuadro guardado por si cambia el tamaño de la ventana
const CABEZA = 1.62;         // si no hay hueso: del piso al centro de la cabeza, en metros
const SOBRE_EL_HUESO = .09;  // el hueso de la cabeza nace en la nuca
const LETRA_TITULAR = '400 100px Titular';
const _p = new THREE.Vector3();

/** El punto de la foto: de 4,5 a 5 px, o la cara no alcanza a tener ojos. El ancho es el de la foto en la página. */
export const celdaDePlana = (ancho, dpr = 1) => Math.max(4.5, Math.min(5, ancho / 180)) * dpr;

/**
 * Dónde queda la cabeza de una figura de pie, leída de lo que se ve: el centro de su punta de arriba. Sirve con cualquier
 * cuerpo, alto o bajo. `px` es RGBA; `piesY`, dónde pisa. Sin figura, null.
 */
export function cabezaDeFigura(px, ancho, alto, piesY) {
  let arriba = -1;
  for (let i = 3; i < px.length && arriba < 0; i += 4) if (px[i] > 128) arriba = Math.floor(i / 4 / ancho);
  if (arriba < 0) return null;
  const estatura = Math.max(1, (piesY ?? alto) - arriba);
  const hasta = Math.min(alto, arriba + Math.ceil(estatura * .1));
  let suma = 0, n = 0;
  for (let y = arriba; y < hasta; y++) for (let x = 0; x < ancho; x++) if (px[(y * ancho + x) * 4 + 3] > 128) { suma += x; n++; }
  return { x: suma / n, y: arriba + estatura * .075 };
}

/** Un aire blanco alrededor de la figura, en los píxeles de la foto: varias copias corridas bastan para esto. */
function aireDe(figura, radio) {
  const c = document.createElement('canvas');
  c.width = figura.width; c.height = figura.height;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    ctx.drawImage(figura, Math.cos(a) * radio, Math.sin(a) * radio);
  }
  return c;
}

/** Precarga las dos letras de imprenta, para que el titular no salga con otra cuando toca. */
export const cargarImprenta = () => Promise.all([
  globalThis.document?.fonts?.load?.(LETRA_TITULAR, '¡A'),
  globalThis.document?.fonts?.load?.('400 20px "Titular Tira"', 'a'),
]).catch(() => null);

export class PrimeraPlana {
  /**
   * @param {{titular: {largo: string[], corto: string[]}, pie: string, perdido: {cosas: string[], resto: number}, suelta: string}} datos
   */
  constructor({ titular, pie, perdido, suelta }) {
    this.titular = titular;
    this.lienzo = el('canvas', { class: 'plana__tinta', 'aria-hidden': 'true' });
    this.trazo = document.createElementNS(NS, 'svg');
    this.trazo.setAttribute('class', 'plana__trazo');
    this.trazo.setAttribute('aria-hidden', 'true');
    this.pie = el('p', { class: 'plana__pie', text: pie });
    this.foto = el('div', { class: 'plana__foto' }, this.lienzo, this.trazo, this.pie);
    this.lineasEl = el('p', { class: 'plana__titular' });
    this.nodo = el('div', { class: 'plana' }, this.lineasEl, this.foto);
    this.cuenta = el('div', { class: 'plana__cuenta' },
      el('p', { class: 'plana__perdido' }, perdido.cosas.length ? [
        el('span', { class: 'plana__llevaron', text: 'Se llevaron' }),
        ...perdido.cosas.map((c) => el('span', { class: 'tachado', text: c })),
        perdido.resto ? el('span', { text: `y ${perdido.resto} más` }) : null,
      ] : el('span', { text: 'No llevaba nada encima.' })),
      el('p', { class: 'plana__suelta', text: suelta }));
    this._alCambiar = () => this.acomodar();
    globalThis.addEventListener?.('resize', this._alCambiar);
  }

  /** Ya está en la página: ahora sí se puede medir. */
  puesta() {
    this.acomodar();
    globalThis.document?.fonts?.load?.(LETRA_TITULAR, '¡A').then(() => { if (this.nodo.isConnected) this.acomodar(); }, () => {});
  }

  soltar() {
    globalThis.removeEventListener?.('resize', this._alCambiar);
    this.copia = null;
  }

  /** Copia el cuadro que se acaba de dibujar. Va justo después del render: en otro momento el lienzo ya está vacío. */
  capturar(fuente, camara, jugador, figura = null) {
    if (!fuente?.width) return;
    this.figura = figura;
    const k = Math.min(1, MAX_COPIA / fuente.width);
    this.copia = document.createElement('canvas');
    this.copia.width = Math.round(fuente.width * k);
    this.copia.height = Math.round(fuente.height * k);
    this.copia.getContext('2d').drawImage(fuente, 0, 0, this.copia.width, this.copia.height);
    const proyectar = () => {
      _p.project(camara);
      if (!(_p.z < 1) || Math.abs(_p.x) > 1 || Math.abs(_p.y) > 1) return null;
      return { x: (_p.x + 1) / 2 * this.copia.width, y: (1 - _p.y) / 2 * this.copia.height };
    };
    if (jugador && camara) {
      const hueso = jugador.character?.ragdollRig?.head;
      if (hueso?.getWorldPosition) { hueso.getWorldPosition(_p); _p.y += SOBRE_EL_HUESO; }
      else _p.set(jugador.position.x, jugador.position.y + CABEZA, jugador.position.z);
      this.cabeza = proyectar();
      _p.set(jugador.position.x, jugador.position.y, jugador.position.z);
      this.pies = proyectar();
      // De pie, la cabeza se lee de la figura misma: el hueso no dice cuánto mide cada quien.
      if (figura && !jugador.isRagdollActive) {
        const datos = figura.getContext('2d').getImageData(0, 0, figura.width, figura.height).data;
        this.cabeza = cabezaDeFigura(datos, figura.width, figura.height, this.pies?.y) ?? this.cabeza;
      }
    }
    this.acomodar();
  }

  acomodar() {
    const caja = this.nodo.getBoundingClientRect();
    if (!caja.width) return;
    this._escribirTitular(caja);
    this._imprimir();
  }

  _escribirTitular(caja) {
    // Dos líneas si la foto va debajo y hay ancho de sobra; tres si no.
    const lineas = caja.width >= 900 && caja.width > caja.height ? this.titular.largo : this.titular.corto;
    if (this._lineas !== lineas) {
      this._lineas = lineas;
      this.lineasEl.replaceChildren(...lineas.flatMap((l, i) => [i ? ' ' : null, el('span', { class: 'plana__linea', text: l })]).filter(Boolean));
    }
    const spans = [...this.lineasEl.querySelectorAll('.plana__linea')];
    const estilo = getComputedStyle(this.lineasEl);
    const dispo = this.lineasEl.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
    const medidas = spans.map((s) => { s.style.fontSize = '100px'; return s.getBoundingClientRect().width || 1; });
    let tamanos = medidas.map((a) => 100 * dispo / a);
    // El titular no le quita la foto a nadie: si se pasa de alto, baja de cuerpo y deja de llenar el ancho.
    const altoLibre = caja.height * (caja.width > caja.height && caja.width < 900 ? .92 : .5);
    const alto = tamanos.reduce((s, t) => s + t * .92, 0);
    if (alto > altoLibre) tamanos = tamanos.map((t) => t * altoLibre / alto);
    spans.forEach((s, i) => { s.style.fontSize = `${tamanos[i].toFixed(2)}px`; });
  }

  _imprimir() {
    const caja = this.foto.getBoundingClientRect();
    if (caja.width < 2 || caja.height < 2) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const W = Math.round(caja.width * dpr), H = Math.round(caja.height * dpr);
    if (this.lienzo.width !== W) this.lienzo.width = W;
    if (this.lienzo.height !== H) this.lienzo.height = H;
    const ancho = this.copia?.width ?? caja.width, alto = this.copia?.height ?? caja.height;
    const e = encuadrar({ ancho, alto, cabeza: this.cabeza, pies: this.pies, cajaAncho: caja.width, cajaAlto: caja.height });
    if (this.copia) {
      const ctx = this.lienzo.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      const celda = celdaDePlana(caja.width, dpr);
      const zona = { recorte: e, x: 0, y: 0, w: W + celda, h: H + celda };
      imprimir(ctx, W, H, this.figura ? [
        // La calle queda de fondo, clarita; el personaje va con su propio contraste, y un aire entre los dos.
        { ...zona, img: this.copia, local: .8, pNegro: .02, pBlanco: .7, gamma: 1.15, tope: .46 },
        { ...zona, img: aireDe(this.figura, 2.4 * celda * (e.sw / W)), blanca: true },
        { ...zona, img: this.figura, local: 1, pNegro: .05, pBlanco: .76, gamma: .9, tope: .8 },
      ] : [{ ...zona, img: this.copia, local: 1.1, pNegro: .06, pBlanco: .66, gamma: .85 }], { celda });
    }
    this._trazar(e, caja);
  }

  /** El redondel en la cabeza, y su pie al lado. Va donde haya sitio: la cabeza no siempre queda en el centro. */
  _trazar(e, caja) {
    const { cx, cy, radio } = e;
    const rx = radio * .94, ry = radio * 1.1;
    const grosor = Math.max(5, radio * .1);
    this.trazo.setAttribute('viewBox', `0 0 ${Math.round(caja.width)} ${Math.round(caja.height)}`);
    const puntos = redondelAMano(cx, cy, rx, ry).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const { x, y } = sitioDelPie({ anchoPie: this.pie.offsetWidth, altoPie: this.pie.offsetHeight, cx, cy, rx, ry, ancho: caja.width, alto: caja.height });
    const anchoPie = this.pie.offsetWidth, altoPie = this.pie.offsetHeight;
    this.pie.style.left = `${Math.round(x)}px`;
    this.pie.style.top = `${Math.round(y)}px`;
    const aLaIzquierda = x + anchoPie / 2 < cx;
    const desdeX = aLaIzquierda ? x + anchoPie : x;
    const desdeY = y + altoPie / 2;
    const angulo = Math.atan2((desdeY - cy) / ry, (desdeX - cx) / rx);
    this.trazo.innerHTML = `<line class="plana__guia" x1="${desdeX.toFixed(1)}" y1="${desdeY.toFixed(1)}" x2="${(cx + rx * 1.03 * Math.cos(angulo)).toFixed(1)}" y2="${(cy + ry * 1.03 * Math.sin(angulo)).toFixed(1)}"/>`
      + `<polyline class="plana__redondel" stroke-width="${grosor.toFixed(1)}" points="${puntos}"/>`;
  }
}
