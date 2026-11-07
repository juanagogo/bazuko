// BAZUKO se escribe en este hilo, no en el de la página: mientras el juego construye la ciudad el
// hilo principal no pinta nada durante segundos, pero este sigue dibujando a 60 cuadros por segundo.
// Se escribe como una mano: a paso casi parejo, que cambia de velocidad sin tirones. La carga real
// (los avisos de la página) solo pone el tope de cuánto puede adelantarse y apura si va por delante.
import { escritura } from './escritura.js';

// Una palabra en unos 3,4 s: ni se arrastra ni corre.
const PASO = 1 / 3.4;
// Cuánto puede ir la palabra por delante de la carga real. Frena desde lejos del tope, así que mientras
// espera al creador sigue escribiendo cada vez más despacio en vez de quedarse quieta.
const ADELANTO = .72, FRENO = .4;
// Lo que tarda la velocidad en cambiar: la mano acelera y frena, no salta.
const INERCIA = .3;

let canvas, ctx, marca, trazos, largos, color;
let meta = 0, visto = 0, velocidad = 0, reducido = false;
let corriendo = false, ultimo = 0;
// Antes del creador la palabra se termina: { inicio, duracion }.
let cierre = null;

// Sin requestAnimationFrame en el worker (algunos Safari), un temporizador de un cuadro hace lo mismo.
const siguiente = self.requestAnimationFrame
  ? fn => self.requestAnimationFrame(fn)
  : fn => setTimeout(() => fn(performance.now()), 16);

function dibujar() {
  const { width, height } = canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const escala = width / marca.ancho;
  ctx.setTransform(escala, 0, 0, escala, 0, -marca.arriba * escala);
  ctx.strokeStyle = color;
  ctx.lineWidth = 210;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  escritura(visto, largos).forEach((t, i) => {
    if (t <= 0) return;
    const { tinta, lomo, largo } = trazos[i];
    ctx.save();
    // La tinta recorta el lomo grueso: lo que se ve es el trazo del marcador, igual que en el SVG.
    ctx.clip(tinta);
    ctx.setLineDash([t * largo, largo * 2 + 1]);
    ctx.stroke(lomo);
    ctx.restore();
  });
}

function cuadro(ahora) {
  if (!corriendo) return;
  const dt = Math.min(.1, Math.max(0, (ahora - ultimo) / 1000));
  ultimo = ahora;
  const antes = visto;
  if (reducido) {
    // Sin recorrido: lo escrito es la carga real, y entera al cerrar.
    visto = Math.max(visto, cierre ? 1 : meta);
  } else if (cierre) {
    // Curva de duración exacta: sale a la velocidad que traía la mano y siempre llega a cerrar la O.
    const s = Math.min(1, (ahora - cierre.inicio) / cierre.duracion);
    const T = cierre.duracion / 1000, { desde, v0 } = cierre, v1 = PASO * .8;
    const h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    visto = Math.max(visto, Math.min(1, desde + h10 * T * v0 + h01 * (1 - desde) + h11 * T * v1));
    if (s >= 1) visto = 1;
  } else {
    const tope = meta >= 1 ? 1 : Math.min(.97, meta + ADELANTO);
    let deseada = PASO * Math.min(1, Math.max(0, (tope - visto) / FRENO));
    // Si la carga real va por delante de lo escrito, se apura.
    if (meta > visto + .15) deseada = Math.max(deseada, PASO * 2);
    velocidad += (deseada - velocidad) * (1 - Math.exp(-dt / INERCIA));
    visto = Math.min(tope, visto + Math.max(0, velocidad) * dt);
  }
  if (visto !== antes) dibujar();
  if (cierre && visto >= 1) { cierre = null; self.postMessage({ tipo: 'completo' }); }
  siguiente(cuadro);
}

function arrancar() {
  if (corriendo) return;
  corriendo = true;
  ultimo = performance.now();
  siguiente(cuadro);
}

self.onmessage = ({ data }) => {
  switch (data.tipo) {
    case 'iniciar':
      ({ canvas, marca, color } = data);
      reducido = !!data.reducido;
      ctx = canvas.getContext('2d');
      trazos = marca.trazos.map(t => ({ tinta: new Path2D(t.tinta), lomo: new Path2D(t.lomo), largo: t.largo }));
      largos = marca.trazos.map(t => t.largo);
      canvas.width = data.ancho; canvas.height = data.alto;
      meta = visto = data.avance;
      dibujar();
      arrancar();
      break;
    case 'avance':
      meta = Math.max(meta, data.avance);
      break;
    case 'tamano':
      if (!canvas) return;
      canvas.width = data.ancho; canvas.height = data.alto;
      dibujar();
      break;
    case 'completar':
      meta = 1;
      if (visto >= 1 || data.duracion <= 0) {
        visto = 1; dibujar(); self.postMessage({ tipo: 'completo' });
        break;
      }
      cierre = { inicio: performance.now(), duracion: data.duracion, desde: visto, v0: Math.max(0, velocidad) };
      arrancar();
      break;
    case 'pausa': corriendo = false; break;
    case 'seguir': arrancar(); break;
  }
};
