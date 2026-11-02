import { caber, cubrir, imprimir } from './impresion.js';

const TOPE_MS = 8000;
const ULTIMA = 'bazuko.carga_arte';

/** Baraja parejas completas sin repetir la última al comenzar otra vuelta. */
export function shuffledArtwork(ids, previous = null, random = Math.random) {
  const deck = [...ids];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  if (deck.length > 1 && deck[0] === previous) [deck[0], deck[1]] = [deck[1], deck[0]];
  return deck;
}

/** Celda del semitono: a menos pantalla, punto más fino, para que la cara se siga viendo. */
export const celdaPara = (W, H) => Math.max(4, Math.min(8, Math.round(Math.sqrt(W * H) / 165)));

/**
 * Dónde va cada plano. `techo` es hasta dónde baja la palabra: el personaje se para debajo y nunca queda con la cara
 * detrás de una letra. Acostado y chico, la palabra se queda a la izquierda y el personaje tiene toda la altura a la derecha.
 */
export function encuadre(W, H, fondo, personaje, techo = 0) {
  const dePie = H > W, chico = !dePie && (W < 900 || H <= 520);
  const alto = chico ? H * .96 : Math.max(H * .4, H - techo - 8);
  const ancho = dePie ? W * 1.15 : W * (chico ? .54 : .72);
  const caja = caber(personaje.w, personaje.h, ancho, alto, 1, 1);
  const corre = dePie ? (W - caja.w) / 2 : W - ancho + caja.x;
  return {
    fondo: cubrir(fondo.w, fondo.h, W, H, dePie ? .62 : .5, .5),
    personaje: { x: corre, y: H - alto + caja.y, w: caja.w, h: caja.h },
  };
}

/** Reimprime el arte de carga una sola vez, en una tinta y sobre cartón. Es opcional: nunca retrasa el juego. */
export class LoadingArtwork {
  constructor(root, ids, baseURL = import.meta.env?.BASE_URL ?? '/') {
    this.baseURL = baseURL;
    this.root = root;
    this.ids = ids;
    this.generation = 0;
    this.onResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.print(), 200);
    };
  }

  start() {
    if (this.active || !this.ids.length) return;
    this.active = true;
    globalThis.addEventListener?.('resize', this.onResize);
    if (this.images) this.print();
    else this.load();
  }

  _previous() {
    try { return Number(globalThis.localStorage?.getItem(ULTIMA)) || null; } catch { return null; }
  }

  async load() {
    const generation = this.generation;
    const id = shuffledArtwork(this.ids, this._previous())[0];
    const pictures = ['fondo', 'personaje'].map(kind => {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.src = `${this.baseURL}images/pantalla-carga/${kind}_pantalla_carga_${id}.webp`;
      return img;
    });
    let timeout;
    try {
      await Promise.race([
        Promise.all(pictures.map(img => img.decode())),
        new Promise((_, reject) => {
          this.cancelPending = () => {
            clearTimeout(timeout);
            pictures.forEach(img => img.removeAttribute?.('src'));
            reject(new Error('Carga detenida'));
          };
          timeout = setTimeout(() => reject(new Error('Imagen no disponible')), TOPE_MS);
        })
      ]);
      if (!this.active || generation !== this.generation) return;
      this.images = pictures;
      try { globalThis.localStorage?.setItem(ULTIMA, String(id)); } catch { /* sin almacenamiento */ }
      this.print();
    } catch {
      // Sin arte queda el cartón con la palabra.
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) this.cancelPending = null;
    }
  }

  /** Una sola pasada. Se repite solo si cambió el tamaño de la pantalla. */
  print() {
    if (!this.active || !this.images || !this.root.isConnected) return;
    const W = innerWidth, H = innerHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (this.printed === `${W}x${H}x${dpr}`) return;
    const t0 = performance.now();
    const canvas = this.canvas ??= Object.assign(document.createElement('canvas'), { className: 'carga__arte' });
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const [fondo, personaje] = this.images;
    const reserva = this.root.querySelector('.carga__texto')?.getBoundingClientRect() ?? null;
    const techo = H > W ? reserva?.bottom : this.root.querySelector('.carga__marca')?.getBoundingClientRect().bottom;
    const planos = encuadre(W, H, { w: fondo.naturalWidth, h: fondo.naturalHeight }, { w: personaje.naturalWidth, h: personaje.naturalHeight }, techo ?? 0);
    imprimir(ctx, W, H, [
      { img: fondo, ...planos.fondo, pNegro: 0, pBlanco: .3, tope: .42, gamma: .7 },
      { img: personaje, ...planos.personaje, pNegro: .12, pBlanco: .9, tope: .8, gamma: .9 },
    ], { celda: celdaPara(W, H), reserva, blando: Math.min(W, H) * .1 });
    this.printed = `${W}x${H}x${dpr}`;
    this.printMs = performance.now() - t0;
    if (!canvas.isConnected) this.root.prepend(canvas);
  }

  stop({ remove = false } = {}) {
    this.active = false;
    this.generation++;
    this.cancelPending?.();
    this.cancelPending = null;
    clearTimeout(this.resizeTimer);
    globalThis.removeEventListener?.('resize', this.onResize);
    if (remove) {
      this.canvas?.remove();
      this.canvas = null;
      this.images = null;
      this.printed = null;
    }
  }
}
