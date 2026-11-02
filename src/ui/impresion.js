// Imprime una imagen en semitono de una sola tinta, en una sola pasada de lienzo 2D: sin filtros ni sombreadores.
// La usan la carga y la primera plana. Los niveles salen de la propia imagen, por percentiles, porque un cuadro de noche
// y uno de mediodía no se parecen en nada: así los negros cierran y los claros quedan sin punto.

/** Rectángulo que cubre un área sin deformar la imagen. `x` e `y` de 0 a 1 eligen qué parte se conserva. */
export function cubrir(iw, ih, W, H, x = .5, y = .5) {
  const k = Math.max(W / iw, H / ih), w = iw * k, h = ih * k;
  return { x: (W - w) * x, y: (H - h) * y, w, h };
}

/** Rectángulo que cabe dentro de un área, pegado a uno de sus bordes. */
export function caber(iw, ih, W, H, x = .5, y = 1) {
  const k = Math.min(W / iw, H / ih), w = iw * k, h = ih * k;
  return { x: (W - w) * x, y: (H - h) * y, w, h };
}

/** De luminancia a claridad de 0 (tinta llena) a 1 (cartón limpio). */
export function tono(l, negro, blanco, gamma = 1) {
  return Math.pow(Math.min(1, Math.max(0, (l - negro) / Math.max(.01, blanco - negro))), gamma);
}

/** Radio del punto: su área crece con la tinta que hace falta. */
export const radioDePunto = (t, celda, tope) => celda * tope * Math.sqrt(1 - t);

/** Cuánto se reserva un punto: 1 dentro del rectángulo, 0 lejos, y entre medio se apaga de a poco. */
export function reservado(x, y, r, blando) {
  if (!r) return 0;
  const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
  const d = Math.hypot(dx, dy);
  return d >= blando ? 0 : 1 - d / blando;
}

/** La malla de cols × filas, desenfocada de la manera barata: reducir y ampliar. */
function desenfocar(malla, cols, filas) {
  const chico = document.createElement('canvas');
  chico.width = Math.ceil(cols / 10); chico.height = Math.ceil(filas / 10);
  const cc = chico.getContext('2d');
  cc.imageSmoothingQuality = 'high';
  cc.drawImage(malla, 0, 0, chico.width, chico.height);
  const grande = document.createElement('canvas');
  grande.width = cols; grande.height = filas;
  const gc = grande.getContext('2d', { willReadFrequently: true });
  gc.imageSmoothingQuality = 'high';
  gc.drawImage(chico, 0, 0, cols, filas);
  return gc.getImageData(0, 0, cols, filas).data;
}

const luz = (d, q) => (.299 * d[q * 4] + .587 * d[q * 4 + 1] + .114 * d[q * 4 + 2]) / 255;

/**
 * capas: de atrás hacia adelante, { img, x, y, w, h, pNegro, pBlanco, tope, gamma, local, recorte }. Una capa tapa a la de
 * atrás donde su imagen no es transparente, y así el personaje no se mezcla con la calle.
 * local: contraste local, que separa la cabeza de la pared sin subir el negro.
 * recorte: { sx, sy, sw, sh }, la parte de la imagen que se imprime; sin él, toda.
 * blanca: la capa no lleva tinta; solo despeja lo que tenga atrás, y deja un aire alrededor de lo que va delante.
 * reserva: rectángulo donde no se imprime, para que lo que se escriba encima se lea.
 * Lo que no lleva punto queda transparente. Devuelve cuántos puntos pintó.
 */
export function imprimir(ctx, W, H, capas, { celda = 8, tinta = '#14110C', reserva = null, blando = 70 } = {}) {
  const d = celda / Math.SQRT2;
  const cols = Math.ceil(W / d) + 2, filas = Math.ceil(H / d) + 2;
  const malla = document.createElement('canvas');
  malla.width = cols; malla.height = filas;
  const mc = malla.getContext('2d', { willReadFrequently: true });
  mc.imageSmoothingQuality = 'high';
  const claridad = new Float32Array(cols * filas).fill(1);
  const tope = new Float32Array(cols * filas);
  for (const capa of capas) {
    mc.clearRect(0, 0, cols, filas);
    const r = capa.recorte;
    if (r) mc.drawImage(capa.img, r.sx, r.sy, r.sw, r.sh, capa.x / d, capa.y / d, capa.w / d, capa.h / d);
    else mc.drawImage(capa.img, capa.x / d, capa.y / d, capa.w / d, capa.h / d);
    const px = mc.getImageData(0, 0, cols, filas).data;
    const borroso = capa.local ? desenfocar(malla, cols, filas) : null;
    const lum = new Float32Array(cols * filas);
    const vistos = [];
    for (let q = 0; q < lum.length; q++) {
      if (px[q * 4 + 3] < 128) { lum[q] = -1; continue; }
      lum[q] = luz(px, q);
      if (borroso) lum[q] = Math.max(0, lum[q] + capa.local * (lum[q] - luz(borroso, q)));
      if ((q % cols + Math.floor(q / cols)) % 2 === 0) vistos.push(lum[q]);
    }
    if (!vistos.length) continue;
    if (capa.blanca) {
      // Una zona limpia: lo que tenga atrás no se imprime.
      for (let q = 0; q < lum.length; q++) if (lum[q] >= 0) claridad[q] = 1;
      continue;
    }
    const orden = Float32Array.from(vistos).sort();
    const negro = orden[Math.floor(orden.length * (capa.pNegro ?? .08))];
    const blanco = orden[Math.floor(orden.length * (capa.pBlanco ?? .72))];
    for (let q = 0; q < lum.length; q++) {
      if (lum[q] < 0) continue;
      claridad[q] = tono(lum[q], negro, blanco, capa.gamma ?? 1);
      tope[q] = capa.tope ?? .74;
    }
  }
  let puntos = 0;
  ctx.beginPath();
  for (let j = 0; j < filas; j++) for (let i = 0; i < cols; i++) {
    if ((i + j) % 2) continue;
    const q = j * cols + i, x = i * d, y = j * d;
    let t = claridad[q];
    if (t >= 1) continue;
    const res = reservado(x, y, reserva, blando);
    if (res >= 1) continue;
    t += (1 - t) * res;
    const r = radioDePunto(t, celda, tope[q]);
    if (r < .4) continue;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, 6.2832);
    puntos++;
  }
  ctx.fillStyle = tinta;
  ctx.fill();
  return puntos;
}
