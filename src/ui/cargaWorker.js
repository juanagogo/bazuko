// Dibuja BAZUKO en un lienzo fuera del hilo principal: aunque la carga bloquee la página por segundos,
// la mano sigue avanzando a 60 fps. Cada trazo se recorta con su tinta y su lomo crece a modo de guion.
import { MARCA } from './marcaBazuko.js';
import { ARRANQUE, GROSOR, avanceDeTiempo, escritura } from './cargaEscritura.js';

const tintas = MARCA.trazos.map(t => new Path2D(t.tinta));
const lomos = MARCA.trazos.map(t => new Path2D(t.lomo));
const largos = MARCA.trazos.map(t => t.largo);

let lienzo = null, ctx = null, color = '#000', escala = 1, reducido = false;
let arranque = 0, terminado = false, desde = 0, en = 0, pidiendo = 0;

const avanceDe = () => reducido ? 1 : avanceDeTiempo(Date.now() - arranque);

function pinta(p) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, lienzo.width, lienzo.height);
  ctx.setTransform(escala, 0, 0, escala, 0, -MARCA.arriba * escala);
  ctx.strokeStyle = color;
  ctx.lineWidth = GROSOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const partes = escritura(ARRANQUE + (1 - ARRANQUE) * p, largos);
  for (let i = 0; i < partes.length; i++) {
    const t = partes[i];
    if (t <= 0) continue;
    ctx.save();
    ctx.clip(tintas[i]);
    ctx.setLineDash(t >= 1 ? [] : [t * largos[i], largos[i] * 2]);
    ctx.stroke(lomos[i]);
    ctx.restore();
    if (t < 1) break; // lo que sigue está en blanco: el resto ya quedó escrito
  }
}

function cuadro(ts) {
  let p = avanceDe();
  if (en) p = Math.max(p, desde + (1 - desde) * Math.min(1, Math.max(0, (ts - en) / 350)));
  p = Math.min(1, p);
  pinta(p);
  // El sello del cuadro deja comprobar desde fuera que la mano siguió con el hilo principal trabado.
  self.postMessage({ tipo: 'avance', avance: p, t: ts });
  if (p >= 1) {
    terminado = true;
    self.postMessage({ tipo: 'completo' });
    return;
  }
  pidiendo = requestAnimationFrame(cuadro);
}

self.onmessage = ({ data }) => {
  if (data.tipo === 'inicio') {
    lienzo = data.lienzo;
    ctx = lienzo.getContext('2d');
    color = data.color;
    escala = data.escala;
    reducido = !!data.reducido;
    arranque = data.arranque || Date.now();
    pidiendo = requestAnimationFrame(cuadro);
  } else if (data.tipo === 'tamano') {
    lienzo.width = data.ancho;
    lienzo.height = data.alto;
    escala = data.escala;
    if (terminado) pinta(1);
  } else if (data.tipo === 'terminar' && !terminado) {
    desde = reducido ? 1 : Math.max(desde, avanceDeTiempo(Date.now() - arranque));
    en = performance.now();
    if (!pidiendo) pidiendo = requestAnimationFrame(cuadro);
  }
};
