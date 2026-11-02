// src/ui/planoRadar.js
// El plano de la ciudad a marcador: se hornea una sola vez, en un lienzo transparente, a partir de los tiles. Por cuadro
// el radar solo pinta el cartón, el plano horneado, una línea de ruta, los dibujos y la flecha. Lo mismo sirve para el
// mapa grande: trazarPlano recibe un contexto ya en metros.

export const CARTON = '#CBA26C', CARTON_MOJADO = '#BA8D56', MARCADOR = '#14110C', CINTA = '#E9DBB4', ROJO = '#AB1D17';

const SIN_LLENAR = new Set(['road', 'busway', 'sidewalk', 'floor', 'plaza', 'dirt', 'grass', 'water']);
const esManzana = (tipo) => !!tipo && !SIN_LLENAR.has(tipo);

// La misma ciudad se raya siempre igual.
const azar = (semilla) => {
  let s = semilla >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
};

/** Una línea hecha por una mano: no es recta y se pasa en las esquinas. */
function lineaMano(path, x0, y0, x1, y1, r, { over = 1.2, jit = .28, paso = 9 } = {}) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const a = over * (.5 + r()), b = over * (.5 + r());
  const ax = x0 - ux * a, ay = y0 - uy * a, bx = x1 + ux * b, by = y1 + uy * b;
  const n = Math.max(1, Math.round((L + a + b) / paso));
  path.moveTo(ax + (r() - .5) * jit, ay + (r() - .5) * jit);
  for (let i = 1; i <= n; i++) {
    const t = i / n, o = (r() - .5) * jit * 2;
    path.lineTo(ax + (bx - ax) * t - uy * o, ay + (by - ay) * t + ux * o);
  }
}

/**
 * Une tiles iguales en tramos: se calcula una vez. Sin Path2D (fuera del navegador) no hay plano.
 * @param {{ancho:number, desdeZ:number, hastaZ:number, T:number, tipo:(tx:number,tz:number)=>string|null, originX:number, originZ:number, viaducto?:{ancho:number, puntos:number[][]}}} tiles
 */
export function prepararPlano(tiles) {
  if (!tiles || typeof Path2D === 'undefined') return null;
  const { ancho, desdeZ, hastaZ, T, tipo, originX, originZ, viaducto } = tiles;
  const alto = hastaZ - desdeZ + 1;
  const filas = [];
  for (let z = 0; z < alto; z++) {
    const fila = new Array(ancho);
    for (let x = 0; x < ancho; x++) fila[x] = tipo(x, z + desdeZ) ?? null;
    filas.push(fila);
  }
  const solido = (x, y) => y >= 0 && y < alto && x >= 0 && x < ancho && esManzana(filas[y][x]);
  const r = azar(7331);
  const calle = new Path2D(), buseta = new Path2D(), agua = new Path2D(), lleno = new Path2D();
  const contorno = new Path2D(), achurado = new Path2D(), olas = new Path2D(), matas = new Path2D();
  for (let y = 0; y < alto; y++) {
    let x = 0;
    while (x < ancho) {
      const c = filas[y][x];
      let j = x;
      while (j < ancho && filas[y][j] === c) j++;
      const wx = originX + x * T, wz = originZ + y * T, w = (j - x) * T;
      if (c === 'road') calle.rect(wx, wz, w, T + .04);
      else if (c === 'busway') buseta.rect(wx, wz, w, T + .04);
      else if (c === 'water') agua.rect(wx, wz, w, T + .04);
      else if (esManzana(c)) lleno.rect(wx, wz, w, T + .04);
      x = j;
    }
  }
  // Bordes de manzana: tramos largos, no tile por tile, para que la línea parezca una sola pasada.
  for (let y = 0; y <= alto; y++) {
    let x = 0;
    while (x < ancho) {
      if (solido(x, y) === solido(x, y - 1)) { x++; continue; }
      const lado = solido(x, y);
      let j = x;
      while (j < ancho && solido(j, y) !== solido(j, y - 1) && solido(j, y) === lado) j++;
      lineaMano(contorno, originX + x * T, originZ + y * T, originX + j * T, originZ + y * T, r);
      x = j;
    }
  }
  for (let x = 0; x <= ancho; x++) {
    let y = 0;
    while (y < alto) {
      if (solido(x, y) === solido(x - 1, y)) { y++; continue; }
      const lado = solido(x, y);
      let j = y;
      while (j < alto && solido(x, j) !== solido(x - 1, j) && solido(x, j) === lado) j++;
      lineaMano(contorno, originX + x * T, originZ + y * T, originX + x * T, originZ + j * T, r);
      y = j;
    }
  }
  // Achurado: diagonales a mano, con el pulso un poco disparejo.
  const W = ancho * T, H = alto * T, sep = 3.4;
  for (let d = -H; d < W; d += sep) {
    const o = (r() - .5) * .9;
    lineaMano(achurado, originX + d + o, originZ + H, originX + d + o + H, originZ, r, { over: 0, jit: .22, paso: 14 });
  }
  // Pasto y agua: una marca cada tanto, no un relleno.
  const rm = azar(2024);
  for (let y = 0; y < alto; y += 2) for (let x = 0; x < ancho; x += 2) {
    const c = filas[y][x];
    const wx = originX + x * T + rm() * T * 1.4, wz = originZ + y * T + rm() * T * 1.4;
    if (c === 'grass' && rm() < .8) { matas.moveTo(wx - .7, wz - .9); matas.lineTo(wx, wz); matas.lineTo(wx + .8, wz - 1.1); }
    if (c === 'water' && x % 4 === 0) { olas.moveTo(wx - 2, wz); olas.quadraticCurveTo(wx - 1, wz - 1, wx, wz); olas.quadraticCurveTo(wx + 1, wz + 1, wx + 2, wz); }
  }
  let tablero = null;
  if (viaducto?.puntos?.length > 1) {
    tablero = new Path2D();
    viaducto.puntos.forEach(([x, z], i) => (i ? tablero.lineTo(x, z) : tablero.moveTo(x, z)));
  }
  return { calle, buseta, agua, lleno, contorno, achurado, olas, matas, tablero, anchoTablero: viaducto?.ancho ?? 0 };
}

/** Dibuja el plano. El contexto ya viene en metros; k son píxeles por metro: las líneas conservan su grosor. */
export function trazarPlano(ctx, plano, k) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(20,17,12,.075)';
  ctx.fill(plano.calle);
  ctx.fillStyle = 'rgba(20,17,12,.14)';
  ctx.fill(plano.buseta);
  ctx.fillStyle = 'rgba(20,17,12,.1)';
  ctx.fill(plano.agua);
  ctx.strokeStyle = MARCADOR;
  ctx.globalAlpha = .55;
  ctx.lineWidth = .9 / k;
  ctx.stroke(plano.matas);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1 / k;
  ctx.stroke(plano.olas);
  if (plano.tablero) {
    ctx.strokeStyle = 'rgba(20,17,12,.12)';
    ctx.lineWidth = plano.anchoTablero;
    ctx.stroke(plano.tablero);
  }
  ctx.save();
  ctx.clip(plano.lleno);
  ctx.fillStyle = 'rgba(20,17,12,.2)';
  ctx.fill(plano.lleno);
  ctx.strokeStyle = MARCADOR;
  ctx.globalAlpha = .82;
  ctx.lineWidth = .95 / k;
  ctx.stroke(plano.achurado);
  ctx.restore();
  ctx.strokeStyle = MARCADOR;
  ctx.lineWidth = 1.6 / k;
  ctx.stroke(plano.contorno);
  ctx.restore();
}

/**
 * Hornea el plano en un lienzo transparente; encima de cualquier cara de cartón sirve igual, seco o mojado.
 * Sin Path2D (fuera del navegador) no hay plano y el radar pinta solo el cartón.
 * @returns {{canvas:HTMLCanvasElement, originX:number, originZ:number, worldWidth:number, worldHeight:number}|null}
 */
export function hornearPlano(tiles, pxPorMetro = 2.4, kFinal = 1.26) {
  if (typeof document === 'undefined') return null;
  const plano = prepararPlano(tiles);
  if (!plano) return null;
  const alto = tiles.hastaZ - tiles.desdeZ + 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(tiles.ancho * tiles.T * pxPorMetro);
  canvas.height = Math.ceil(alto * tiles.T * pxPorMetro);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(pxPorMetro, pxPorMetro);
  ctx.translate(-tiles.originX, -tiles.originZ);
  trazarPlano(ctx, plano, kFinal);
  return { canvas, originX: tiles.originX, originZ: tiles.originZ, worldWidth: canvas.width / pxPorMetro, worldHeight: canvas.height / pxPorMetro };
}

// ---------- piezas pequeñas ----------
/** La equis del destino, con halo para que se separe de lo que tenga debajo. */
export function xRoja(ctx, x, y, s, halo = CINTA) {
  ctx.save();
  ctx.lineCap = 'round';
  const trazo = (lw, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * .9);
    ctx.lineTo(x + s * .95, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s * .92, y + s * .9);
    ctx.stroke();
  };
  trazo(s * .72 + 3.4, halo);
  trazo(s * .72, ROJO);
  ctx.restore();
}

/** La flecha del jugador: cuerpo de marcador con borde de cinta. Mira hacia arriba: hacia donde mira la cámara. */
export function flechaJugador(ctx, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.15);
  ctx.lineTo(s * .86, s * .85);
  ctx.lineTo(0, s * .38);
  ctx.lineTo(-s * .86, s * .85);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2.5, s * .34);
  ctx.strokeStyle = CINTA;
  ctx.stroke();
  ctx.fillStyle = MARCADOR;
  ctx.fill();
  ctx.restore();
}

/** La ruta, gruesa y con halo de cinta para que se lea sin ver el rojo. El contexto ya viene en metros. */
export function rutaRoja(ctx, puntos, k) {
  if (!puntos || puntos.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(puntos[0].x, puntos[0].z);
  for (let i = 1; i < puntos.length; i++) ctx.lineTo(puntos[i].x, puntos[i].z);
  ctx.strokeStyle = CINTA;
  ctx.lineWidth = 6.6 / k;
  ctx.stroke();
  ctx.strokeStyle = ROJO;
  ctx.lineWidth = 4 / k;
  ctx.stroke();
  ctx.restore();
}
