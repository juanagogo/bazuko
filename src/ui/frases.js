// src/ui/frases.js
// Las frases de la gente. Nadie reparte el espacio si cada quien pone la suya: aquí se eligen las de los más cercanos,
// máximo dos o tres, y se apartan para que no se pisen entre ellas ni con el cartón. Sin nadie hablando no cuesta nada.

const OCUPADO = '#hud-dock, #topbar, #interaction-prompt, #retazo, #mision';
const MEDIR_CADA_MS = 250;
const SEPARACION = 4;
const MARGEN = 6;
const LEJOS_M = 28;        // de ahí para allá la frase ya no se alcanza a oír
const APARTA_MAX_PX = 150; // apartada más que esto, ya no se sabe quién la dijo

/** Dos en el celular, tres con pantalla grande. */
export const frasesALaVista = (ancho, alto) => (ancho >= 900 && alto > 500 ? 3 : 2);

const chocan = (a, b) => a.x < b.x + b.w + SEPARACION && b.x < a.x + a.w + SEPARACION && a.y < b.y + b.h + SEPARACION && b.y < a.y + a.h + SEPARACION;

/**
 * Dónde va cada frase. `frases` viene de la más cercana a la más lejana; cada una trae `x` y `y` (el punto de la cabeza
 * en pantalla, abajo y al centro de la burbuja), `w` y `h`. Devuelve la caja de cada una, o null si no se muestra.
 */
export function repartirFrases(frases, { ancho, alto, ocupado = [], maximo = 3 }) {
  const puestas = [];
  return frases.map((f) => {
    if (puestas.length >= maximo) return null;
    const base = { x: Math.min(ancho - f.w - MARGEN, Math.max(MARGEN, f.x - f.w / 2)), y: f.y - f.h, w: f.w, h: f.h };
    // Si algo estorba, el sitio libre más cercano: por encima o por debajo de lo que estorba. Son pocas cuentas.
    const estorbos = [...ocupado, ...puestas];
    const sirve = (c) => c.y >= MARGEN && c.y + c.h <= alto - MARGEN && !estorbos.some((o) => chocan(c, o));
    let caja = sirve(base) ? base : null;
    if (!caja) {
      let mejor = APARTA_MAX_PX + 1;
      for (const o of estorbos) for (const y of [o.y - base.h - SEPARACION - 1, o.y + o.h + SEPARACION + 1]) {
        const lejos = Math.abs(y - base.y), c = { ...base, y };
        if (lejos < mejor && sirve(c)) { mejor = lejos; caja = c; }
      }
    }
    if (!caja || f.x < 0 || f.x > ancho) return null;
    puestas.push(caja);
    return caja;
  });
}

const vivas = new Set();
const lista = [];

/** Alguien empezó a decir algo. `npc._bubbleEl` es su burbuja. */
export const empezarFrase = (npc) => { vivas.add(npc); };
export const acabarFrase = (npc) => { vivas.delete(npc); };

let _ocupado = [], _medido = -Infinity;

function medirOcupado(doc, now) {
  if (now - _medido < MEDIR_CADA_MS) return _ocupado;
  _medido = now;
  _ocupado = [];
  for (const el of doc.querySelectorAll(OCUPADO)) {
    const r = el.getBoundingClientRect();
    const estilo = getComputedStyle(el);
    if (r.width > 1 && r.height > 1 && estilo.visibility !== 'hidden' && +estilo.opacity > .05) _ocupado.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return _ocupado;
}

const escribir = (npc, caja) => {
  const el = npc._bubbleEl;
  const clave = caja ? `${Math.round(caja.x)},${Math.round(caja.y)}` : 'no';
  if (npc._fraseVista === clave) return;
  npc._fraseVista = clave;
  if (!caja) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = `${Math.round(caja.x)}px`;
  el.style.top = `${Math.round(caja.y)}px`;
};

/** Un cuadro. `camara` y `desde` son los del juego. */
export function actualizarFrases(camara, desde, now = performance.now()) {
  if (!vivas.size) return;
  const doc = globalThis.document, ancho = globalThis.innerWidth, alto = globalThis.innerHeight;
  lista.length = 0;
  for (const npc of vivas) {
    if (!npc._bubbleEl) { vivas.delete(npc); continue; }
    const dist = npc.position.distanceTo(desde);
    if (dist > LEJOS_M) { escribir(npc, null); continue; }
    const p = npc._projPos.set(npc.position.x, npc.position.y + 2.05, npc.position.z).project(camara);
    if (!(p.z < 1)) { escribir(npc, null); continue; }
    lista.push({ npc, dist, x: (p.x * .5 + .5) * ancho, y: (-p.y * .5 + .5) * alto, w: npc._fraseW, h: npc._fraseH });
  }
  lista.sort((a, b) => a.dist - b.dist);
  const cajas = repartirFrases(lista, { ancho, alto, ocupado: medirOcupado(doc, now), maximo: frasesALaVista(ancho, alto) });
  lista.forEach((f, i) => escribir(f.npc, cajas[i]));
}
