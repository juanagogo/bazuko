// src/ui/planoRadar.js
// El plano de la ciudad a marcador: se hornea una sola vez, en un lienzo transparente, a partir de los tiles. Por cuadro
// el radar solo pinta el cartón, el plano horneado, una línea de ruta, los dibujos y la flecha. Lo mismo sirve para el
// mapa grande: trazarPlano recibe un contexto ya en metros.

export const CARTON = '#CBA26C', CARTON_MOJADO = '#BA8D56', MARCADOR = '#14110C', CINTA = '#E9DBB4', ROJO = '#AB1D17';

// 'cierre' y 'reja' no son tiles del juego: así marca el plano el muro del borde que tapa una calle o un parque, para
// dibujarle su barrera o su reja en vez de rayarlo como una manzana.
const SIN_LLENAR = new Set(['road', 'busway', 'sidewalk', 'floor', 'plaza', 'dirt', 'grass', 'water', 'cierre', 'reja']);
const VERDE = new Set(['grass', 'plaza']);
const esManzana = (tipo) => !!tipo && !SIN_LLENAR.has(tipo);
const VIA = new Set(['road', 'busway', 'sidewalk', 'floor', 'dirt']);
const esCalzada = (tipo) => tipo === 'road' || tipo === 'busway';
/** Píxeles por metro desde los que caben las copas; por debajo (el radar) solo ensucian. */
export const FINO_DESDE = 1.6;
/** Las cebras, solo de cerca en el mapa grande: de lejos cargan la cuadrícula y parecen una vía férrea. */
export const CEBRAS_DESDE = 5;

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
 * Busca en el borde los muros que tapan una calle o un parque (por dentro hay vía o prado y por fuera nada) y los junta
 * en tramos. De los de calle solo cuentan los que cierran calzada. Sus tiles pasan a 'cierre' o 'reja' para que no se
 * rayen como manzana.
 */
function marcarBorde(filas, en, ancho, alto) {
  const lineas = new Map();
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    if (filas[y][x] !== 'wall') continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const dentro = en(x + dx, y + dy), clase = VIA.has(dentro) ? 'cierre' : VERDE.has(dentro) ? 'reja' : null;
      if (!clase || en(x - dx, y - dy) != null) continue;
      const clave = `${clase},${dx},${dy},${dy ? y : x}`;
      if (!lineas.has(clave)) lineas.set(clave, { clase, dx, dy, tiles: [] });
      lineas.get(clave).tiles.push({ x, y, t: dy ? x : y, calzada: esCalzada(dentro) });
      break;
    }
  }
  const borde = { cierre: [], reja: [] };
  for (const { clase, dx, dy, tiles } of lineas.values()) {
    let i = 0;
    while (i < tiles.length) {
      let j = i;
      while (j + 1 < tiles.length && tiles[j + 1].t === tiles[j].t + 1) j++;
      const tramo = tiles.slice(i, j + 1);
      if (clase === 'reja' || tramo.some(tile => tile.calzada)) {
        for (const tile of tramo) filas[tile.y][tile.x] = clase;
        borde[clase].push({ x0: tramo[0].x, y0: tramo[0].y, x1: tramo.at(-1).x, y1: tramo.at(-1).y, dx, dy });
      }
      i = j + 1;
    }
  }
  return borde;
}

/** Un óvalo de una sola pasada: el radio tiembla y la vuelta se pasa un poco del comienzo, como al cerrar un trazo. */
function ovaloMano(path, cx, cz, rx, rz, r, { jit = .5, n = 44, desde = 0, vuelta = 1 } = {}) {
  const a0 = desde * Math.PI * 2, total = Math.PI * 2 * vuelta, tiembla = jit * 2 / Math.min(rx, rz);
  let px = 0, pz = 0;
  for (let i = 0; i <= n; i++) {
    const a = a0 + total * i / n, d = 1 + (r() - .5) * tiembla;
    const x = cx + Math.cos(a) * rx * d, z = cz + Math.sin(a) * rz * d;
    if (i) path.quadraticCurveTo(px, pz, (px + x) / 2, (pz + z) / 2); else path.moveTo(x, z);
    px = x; pz = z;
  }
  path.lineTo(px, pz);
}

/**
 * Une tiles iguales en tramos: se calcula una vez. Sin Path2D (fuera del navegador) no hay plano.
 * @param {ReturnType<ReturnType<typeof import('../world/bogota/CityMapRaster.js').cityMapPlan>['tiles']>} tiles
 */
export function prepararPlano(tiles) {
  if (!tiles || typeof Path2D === 'undefined') return null;
  const { ancho, desdeZ, hastaZ, T, tipo, originX, originZ, viaducto, lago } = tiles;
  const alto = hastaZ - desdeZ + 1;
  const filas = [];
  for (let z = 0; z < alto; z++) {
    const fila = new Array(ancho);
    for (let x = 0; x < ancho; x++) fila[x] = tipo(x, z + desdeZ) ?? null;
    filas.push(fila);
  }
  const en = (x, y) => (y >= 0 && y < alto && x >= 0 && x < ancho ? filas[y][x] : null);
  const radioLago = lago ? (wx, wz) => Math.hypot((wx - lago.x) / lago.rx, (wz - lago.z) / lago.rz) : () => 9;
  const borde = marcarBorde(filas, en, ancho, alto);
  const solido = (x, y) => y >= 0 && y < alto && x >= 0 && x < ancho && esManzana(filas[y][x]);
  const r = azar(7331);
  const calle = new Path2D(), buseta = new Path2D(), agua = new Path2D(), lleno = new Path2D();
  const contorno = new Path2D(), achurado = new Path2D(), olas = new Path2D(), matas = new Path2D();
  const prado = new Path2D(), plaza = new Path2D(), juntas = new Path2D(), achuradoLejano = new Path2D();
  const puntos = new Path2D(), orilla = new Path2D(), ribera = new Path2D(), cebras = new Path2D(), copas = new Path2D();
  const barrera = new Path2D(), fleco = new Path2D(), reja = new Path2D();
  for (let y = 0; y < alto; y++) {
    let x = 0;
    while (x < ancho) {
      const c = filas[y][x];
      let j = x;
      while (j < ancho && filas[y][j] === c) j++;
      const wx = originX + x * T, wz = originZ + y * T, w = (j - x) * T;
      if (c === 'road') calle.rect(wx, wz, w, T + .04);
      else if (c === 'busway') buseta.rect(wx, wz, w, T + .04);
      else if (c === 'grass') prado.rect(wx, wz, w, T + .04);
      else if (c === 'plaza') plaza.rect(wx, wz, w, T + .04);
      else if (c === 'water') { if (radioLago(wx + w / 2, wz + T / 2) > 1.04) agua.rect(wx, wz, w, T + .04); } // el lago va aparte, como óvalo
      else if (esManzana(c)) lleno.rect(wx, wz, w, T + .04);
      x = j;
    }
  }
  // El lago: un óvalo lleno, su orilla de una pasada y, por dentro, la ribera a trazos sueltos.
  if (lago) {
    // El mismo contorno cierra la lámina de agua a ambos lados del viaducto.
    const pulso = { jit: .3, n: 24, desde: .37, vuelta: 1.035 }, rl = azar(1953);
    ovaloMano(orilla, lago.x, lago.z, lago.rx, lago.rz, azar(1492), pulso);
    agua.addPath(orilla);
    for (let t = rl() * .05; t < 1; t += .075 + rl() * .05) {
      ovaloMano(ribera, lago.x, lago.z, lago.rx - 2.6, lago.rz - 2.6, rl, { jit: .4, n: 5, desde: t, vuelta: .045 + rl() * .03 });
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
  for (let d = -H, i = 0; d < W; d += sep, i++) {
    const o = (r() - .5) * .9;
    const diagonal = new Path2D();
    lineaMano(diagonal, originX + d + o, originZ + H, originX + d + o + H, originZ, r, { over: 0, jit: .22, paso: 14 });
    achurado.addPath(diagonal);
    if (i % 2 === 0) achuradoLejano.addPath(diagonal);
  }
  // Pasto y agua: una marca cada tanto, no un relleno.
  const rm = azar(2024);
  for (let y = 0; y < alto; y += 2) for (let x = 0; x < ancho; x += 2) {
    const c = filas[y][x];
    const wx = originX + x * T + rm() * T * 1.4, wz = originZ + y * T + rm() * T * 1.4;
    if (c === 'grass' && rm() < .26) { matas.moveTo(wx - .8, wz - 1.1); matas.lineTo(wx, wz); matas.lineTo(wx + .9, wz - 1.4); }
    if (c === 'plaza') {
      juntas.moveTo(wx - .8, wz); juntas.lineTo(wx + .9, wz); juntas.lineTo(wx + .9, wz + .65);
    }
    if (c === 'water' && x % 4 === 0 && radioLago(wx, wz) < .8) { olas.moveTo(wx - 2, wz); olas.quadraticCurveTo(wx - 1, wz - 1, wx, wz); olas.quadraticCurveTo(wx + 1, wz + 1, wx + 2, wz); }
  }
  // Plazas y paseos: punteados, un punto sí y uno no para que no se vuelva una mancha.
  const rp = azar(1538);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    if (filas[y][x] !== 'plaza' || (x + y) % 2) continue;
    const wx = originX + (x + .5) * T + (rp() - .5) * .8, wz = originZ + (y + .5) * T + (rp() - .5) * .8;
    puntos.moveTo(wx, wz);
    puntos.lineTo(wx + .02, wz);
  }
  // El trazado es el mismo que se pisa. La piedra lleva dos hileras y el asfalto, franjas.
  const rz = azar(8086);
  for (const { x, z, dx, dz, length, width, piedra } of tiles.cruces ?? []) {
    const mitad = width / 2 - .15;
    if (piedra) {
      for (const lado of [-mitad, mitad]) {
        cebras.moveTo(x + dx * .15 + dz * lado, z + dz * .15 - dx * lado);
        cebras.lineTo(x + dx * (length - .15) + dz * lado, z + dz * (length - .15) - dx * lado);
      }
    } else {
      for (let d = .65; d < length - .3; d += 1.5) {
        const wx = x + dx * d, wz = z + dz * d, pulso = (rz() - .5) * .2;
        cebras.moveTo(wx - dz * mitad, wz + dx * mitad);
        cebras.lineTo(wx + dz * mitad + dx * pulso, wz - dx * mitad + dz * pulso);
      }
    }
  }
  // Copas: un circulito por árbol, cada uno con su pulso.
  const rc = azar(4711);
  for (const [x, z, escala = 1] of tiles.arboles ?? []) {
    const radio = Math.max(1.5, Math.min(3, 1.9 * escala));
    ovaloMano(copas, x, z, radio, radio, rc, { jit: .26, n: 7, desde: rc(), vuelta: 1.1 });
  }
  // Cierres del borde: la barrera con sus equis sobre la calle y, hacia afuera, el fleco de «hasta aquí».
  const rb = azar(6502);
  // Un tramo del borde en metros: de a hasta b a lo largo, la cara de adentro del muro y un punto a n metros de ella.
  const tramoDeBorde = ({ x0, y0, x1, y1, dx, dy }) => {
    const a = dy ? originX + x0 * T : originZ + y0 * T, b = dy ? originX + (x1 + 1) * T : originZ + (y1 + 1) * T;
    const cara = dy ? originZ + (y0 + (dy > 0 ? 1 : 0)) * T : originX + (x0 + (dx > 0 ? 1 : 0)) * T;
    return { a, b, fuera: dy ? -dy : -dx, p: (t, n) => (dy ? [t, cara + n] : [cara + n, t]) };
  };
  for (const tramo of borde.cierre) {
    const { a, b, fuera, p } = tramoDeBorde(tramo);
    lineaMano(barrera, ...p(a, 0), ...p(b, 0), rb, { over: .3, jit: .18, paso: 5 });
    const n = Math.max(1, Math.round((b - a) / 3.6)), s = 1.15;
    for (let i = 0; i < n; i++) {
      const t = a + (b - a) * (i + .5) / n;
      barrera.moveTo(...p(t - s, -s * .9)); barrera.lineTo(...p(t + s * .95, s));
      barrera.moveTo(...p(t + s, -s)); barrera.lineTo(...p(t - s * .92, s * .9));
    }
    for (let t = a + .6; t < b - .2; t += 1.15) {
      fleco.moveTo(...p(t, fuera * .35));
      fleco.lineTo(...p(t + .5 + (rb() - .5) * .3, fuera * (T - .1)));
    }
  }
  // La reja de los parques en el borde: una línea con sus barrotes cruzados.
  for (const tramo of borde.reja) {
    const { a, b, fuera, p } = tramoDeBorde(tramo);
    lineaMano(reja, ...p(a, fuera * .8), ...p(b, fuera * .8), rb, { over: .2, jit: .16, paso: 7 });
    for (let t = a + 1.2; t < b - .4; t += 2.4) {
      reja.moveTo(...p(t, fuera * .15));
      reja.lineTo(...p(t + (rb() - .5) * .2, fuera * 1.45));
    }
  }
  let tablero = null, bordesTablero = null, fueraDelTablero = null;
  if (viaducto?.puntos?.length > 1) {
    tablero = new Path2D();
    viaducto.puntos.forEach(([x, z], i) => (i ? tablero.lineTo(x, z) : tablero.moveTo(x, z)));
    // Los dos bordes de la troncal elevada, a medio ancho del eje y siguiendo su curva.
    bordesTablero = new Path2D();
    const eje = viaducto.puntos, medio = viaducto.ancho / 2;
    const [izquierdo, derecho] = [-1, 1].map(lado => eje.map(([x, z], i) => {
      const [ax, az] = eje[Math.max(0, i - 1)], [bx, bz] = eje[Math.min(eje.length - 1, i + 1)];
      const largo = Math.hypot(bx - ax, bz - az) || 1;
      return [x + (bz - az) / largo * medio * lado, z - (bx - ax) / largo * medio * lado];
    }));
    for (const borde of [izquierdo, derecho]) borde.forEach(([x, z], i) => (i ? bordesTablero.lineTo(x, z) : bordesTablero.moveTo(x, z)));
    // Todo el plano menos la franja de la troncal: el lago y su orilla pasan por debajo y ahí no se dibujan.
    fueraDelTablero = new Path2D();
    fueraDelTablero.rect(originX, originZ, ancho * T, alto * T);
    [...izquierdo, ...derecho.reverse()].forEach(([x, z], i) => (i ? fueraDelTablero.lineTo(x, z) : fueraDelTablero.moveTo(x, z)));
    fueraDelTablero.closePath();
  }
  let tableroMetro = null;
  if (tiles.metro?.tramos?.length) {
    tableroMetro = new Path2D();
    for (const tramo of tiles.metro.tramos) {
      tramo.forEach(([x, z], i) => (i ? tableroMetro.lineTo(x, z) : tableroMetro.moveTo(x, z)));
    }
  }
  return {
    calle, buseta, agua, orilla, prado, plaza, juntas, lleno, contorno, achurado, achuradoLejano, olas, matas,
    puntos, ribera, cebras, copas, barrera, fleco, reja, bordesTablero, fueraDelTablero,
    tablero, anchoTablero: viaducto?.ancho ?? 0,
    tableroMetro, anchoMetro: tiles.metro?.ancho ?? 7
  };
}

/** Dibuja el plano. El contexto ya viene en metros; k son píxeles por metro: las líneas conservan su grosor. */
export function trazarPlano(ctx, plano, k, { fino = k >= FINO_DESDE, cebras = k >= CEBRAS_DESDE } = {}) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(20,17,12,.12)';
  ctx.fill(plano.calle);
  ctx.fillStyle = 'rgba(20,17,12,.18)';
  ctx.fill(plano.buseta);
  ctx.fillStyle = 'rgba(233,219,180,.46)';
  ctx.fill(plano.plaza);
  ctx.fillStyle = 'rgba(20,17,12,.065)';
  ctx.fill(plano.prado);
  // El agua, sus olas y su orilla (la pasada gruesa y, por dentro, la ribera más fina) no se pintan bajo la troncal.
  ctx.save();
  if (plano.fueraDelTablero) ctx.clip(plano.fueraDelTablero, 'evenodd');
  ctx.fillStyle = 'rgba(20,17,12,.22)';
  ctx.fill(plano.agua);
  ctx.strokeStyle = MARCADOR;
  ctx.lineWidth = 1 / k;
  ctx.save();
  ctx.clip(plano.agua);
  ctx.stroke(plano.olas);
  ctx.restore();
  ctx.globalAlpha = .62;
  ctx.lineWidth = .9 / k;
  ctx.stroke(plano.ribera);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5 / k;
  ctx.stroke(plano.orilla);
  ctx.restore();
  ctx.strokeStyle = MARCADOR;
  // En el radar los puntos quedan muy juntos: van más finos para que la plaza no se vuelva una mancha.
  ctx.globalAlpha = fino ? .6 : .5;
  ctx.lineWidth = (fino ? 2 : 1.3) / k;
  ctx.stroke(plano.puntos);
  ctx.save();
  ctx.clip(plano.prado);
  ctx.globalAlpha = .55;
  ctx.lineWidth = .9 / k;
  ctx.stroke(plano.matas);
  ctx.restore();
  if (k > 1.4) {
    ctx.save();
    ctx.clip(plano.plaza);
    ctx.globalAlpha = .35;
    ctx.lineWidth = .8 / k;
    ctx.stroke(plano.juntas);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (cebras) {
    ctx.globalAlpha = .32;
    ctx.lineWidth = 1 / k;
    ctx.stroke(plano.cebras);
    ctx.globalAlpha = 1;
  }
  if (plano.tablero) {
    ctx.strokeStyle = 'rgba(20,17,12,.12)';
    ctx.lineWidth = plano.anchoTablero;
    ctx.stroke(plano.tablero);
    // La troncal elevada: sus dos bordes y la línea discontinua del eje.
    ctx.strokeStyle = MARCADOR;
    ctx.globalAlpha = .5;
    ctx.lineWidth = .9 / k;
    ctx.stroke(plano.bordesTablero);
    ctx.globalAlpha = .75;
    ctx.lineWidth = 1.2 / k;
    ctx.setLineDash?.([3.6, 3]);
    ctx.stroke(plano.tablero);
    ctx.setLineDash?.([]);
    ctx.globalAlpha = 1;
  }
  if (plano.tableroMetro) {
    ctx.save();
    // Traviesas cortas sobre la tinta del viaducto. Se distinguen de la ruta peatonal continua.
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(20,17,12,.24)';
    ctx.lineWidth = plano.anchoMetro;
    ctx.stroke(plano.tableroMetro);
    ctx.strokeStyle = MARCADOR;
    ctx.lineWidth = .95 / k;
    ctx.stroke(plano.tableroMetro);
    ctx.setLineDash([1.1 / k, 6 / k]);
    ctx.lineWidth = Math.min(plano.anchoMetro, 4 / k);
    ctx.stroke(plano.tableroMetro);
    ctx.restore();
  }
  ctx.save();
  ctx.clip(plano.lleno);
  ctx.fillStyle = 'rgba(20,17,12,.2)';
  ctx.fill(plano.lleno);
  ctx.strokeStyle = MARCADOR;
  ctx.globalAlpha = .65;
  ctx.lineWidth = .85 / k;
  ctx.stroke(k < 1.4 ? plano.achuradoLejano : plano.achurado);
  ctx.restore();
  ctx.strokeStyle = MARCADOR;
  ctx.lineWidth = 1.6 / k;
  ctx.stroke(plano.contorno);
  // El borde: la reja de los parques y, en las calles, el fleco fino hacia afuera con la barrera de equis encima.
  ctx.globalAlpha = .8;
  ctx.lineWidth = 1.1 / k;
  ctx.stroke(plano.reja);
  ctx.globalAlpha = .6;
  ctx.lineWidth = .8 / k;
  ctx.stroke(plano.fleco);
  ctx.globalAlpha = 1;
  ctx.lineWidth = (fino ? 1.5 : 1) / k; // en el radar las equis quedan pegadas: más finas para que no sean un borrón
  ctx.stroke(plano.barrera);
  if (fino) {
    ctx.fillStyle = 'rgba(20,17,12,.1)';
    ctx.fill(plano.copas);
    ctx.globalAlpha = .8;
    ctx.lineWidth = 1 / k;
    ctx.stroke(plano.copas);
  }
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
