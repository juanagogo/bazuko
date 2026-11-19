// src/world/bogota/carLibreas.js
// Rótulos del transporte público: lo que un taxi lleva pintado en las puertas y la librea de cada buseta.
// Empresas, teléfonos, números internos y recorridos son inventados: ninguno copia el de una empresa real.
// Solo datos y dibujo: no crea materiales ni texturas y no gasta azar del juego. Lo pintado va por dos caminos:
// - sin letras (damero del taxi, franjas de la buseta), en el mapa de detalle del esmalte (carDetail.js): recibe el polvo,
//   la laca y el reflejo de la chapa. Esa carta sirve a los dos costados, así que un texto saldría al revés en uno;
// - las letras, en celdas transparentes del atlas (carAtlas.js) con solo la tinta: el material de las lámparas descarta
//   lo transparente y debajo queda el esmalte de verdad, del amarillo que tenga cada taxi.

/** Azar propio y sembrado para el desgaste de cada rótulo: nunca toca Math.random. */
export function azarPropio(semilla) {
  let a = (semilla >>> 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lo que se arme dentro de `crear` saca sus identificadores de un azar propio: el del juego queda como estaba. */
export function conAzarPropio(semilla, crear) {
  const delJuego = Math.random;
  Math.random = azarPropio(semilla);
  try { return crear(); } finally { Math.random = delJuego; }
}

const semillaDe = texto => { let h = 2166136261; for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619); return h >>> 0; };

/**
 * Librea de un vehículo público, que la fábrica pasa como variante de su mapa de detalle: el taxi lleva el damero pintado
 * en la chapa y cada buseta las franjas de la empresa de su ruta. `h` es la semilla revuelta del carro.
 */
export function libreaDe(kind, h, otra = '') {
  const propia = kind === 'taxi' ? 'taxi' : kind === 'buseta' ? `ruta${(h >>> 3) % 4}` : '';
  // Si la fábrica ya traía otra variante (un nivel de mugre, por ejemplo), se suman: «ruta2+otra».
  return propia && otra ? `${propia}+${otra}` : propia || otra;
}
/** ¿Lleva damero de taxi esta variante? */
export const esTaxi = variante => variante.split('+').includes('taxi');
/** Ruta de buseta que nombra la variante (0 si no nombra ninguna). */
export const rutaDe = variante => Number(/ruta(\d)/.exec(variante)?.[1] ?? 0);

const TONOS = new Set();
/**
 * Esmalte nuevo para la fábrica. El primero de cada color nace con el azar del juego, como siempre; los de sus otras
 * libreas, con azar propio: el juego gasta lo mismo que cuando había un esmalte por color.
 */
export function esmalteDeLibrea(clave, variante, crear) {
  const tono = variante ? clave.slice(0, clave.length - variante.length - 1) : clave, primero = !TONOS.has(tono);
  TONOS.add(tono);
  return primero ? crear() : conAzarPropio(semillaDe(clave), crear);
}

// Amarillos de taxi: el de siempre, uno asoleado y uno repintado. El primero es el esmalte de la carrocería.
export const TAXI_YELLOWS = ['#e8b321', '#d9ab35', '#e9a312'];
// Número interno de cada taxi, uno por placa pública (mismo orden que PUBLIC_PLATES).
export const TAXI_INTERNOS = ['047', '112', '305', '219', '086', '154', '271', '033', '198', '240', '126', '063', '178', '292', '317', '205'];

// Empresas de taxi inventadas, con teléfonos de prefijo 555, que no existe.
export const TAXI_EMPRESAS = [
  { nombre: 'RADIO TAXI EL CHATO', telefono: '555 01 47' },
  { nombre: 'TAXIS EL CAMBUCHE', telefono: '555 02 19' },
];

const INK = '#15130f';

/** Deja la celda sin fondo. Con tinta clara, un velo invisible de blanco evita el filo oscuro en el borde de las letras. */
function vaciar(ctx, [x, y, w, h], clara = false) {
  ctx.clearRect(x, y, w, h);
  if (clara) { ctx.fillStyle = 'rgba(255,255,255,.004)'; ctx.fillRect(x, y, w, h); }
}

/**
 * Uso sobre la tinta ya pintada: el polvo de la calle la aclara desde abajo y la pintura saltada deja ver la chapa.
 * Solo toca la tinta: lo transparente sigue transparente.
 */
function gastar(ctx, [x, y, w, h], semilla, fuerza = 1, opaca = false) {
  const azar = azarPropio(semilla);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalCompositeOperation = 'source-atop';
  const polvo = ctx.createLinearGradient(0, y, 0, y + h);
  polvo.addColorStop(0, 'rgba(112,94,68,.12)'); polvo.addColorStop(.5, 'rgba(112,94,68,.2)'); polvo.addColorStop(1, `rgba(112,94,68,${Math.min(.7, .46 * fuerza)})`);
  ctx.fillStyle = polvo; ctx.fillRect(x, y, w, h);
  // Una pieza opaca (el acrílico del capacete, una calcomanía) no se agujerea: sus rayones son marcas claras.
  if (!opaca) ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = ctx.fillStyle = opaca ? 'rgba(255,244,214,.22)' : '#000';
  for (let i = 0; i < 18 * fuerza; i++) {
    const px = x + azar() * w, py = y + azar() * h, largo = 2 + azar() * 8;
    ctx.lineWidth = .6 + azar() * .9;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + largo, py + (azar() - .5) * 3); ctx.stroke();
  }
  for (let i = 0; i < 46 * fuerza; i++) ctx.fillRect(x + azar() * w, y + azar() * h, .8 + azar() * 1.4, .8 + azar() * 1.4);
  ctx.restore();
}

/**
 * Puerta trasera del taxi: número interno grande y la placa debajo, en tinta negra sobre el amarillo del carro.
 * Hay una celda por placa: el mismo desplazamiento de la placa trae el número de ese carro.
 */
export function drawTaxiDoor(ctx, rect, plate, index) {
  const [x, y, w] = rect;
  vaciar(ctx, rect);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 40px "Arial Black", Impact, sans-serif';
  ctx.fillText(TAXI_INTERNOS[index % TAXI_INTERNOS.length], x + w / 2, y + 23, w - 12);
  ctx.fillRect(x + 10, y + 43, w - 20, 3);
  ctx.font = '900 16px "Arial Black", sans-serif';
  ctx.fillText(plate.code.replace(' ', ' · '), x + w / 2, y + 55, w - 14);
  gastar(ctx, rect, 7001 + index * 131);
}

/** Puerta delantera: empresa y teléfono a brocha, como los pinta cada afiliadora. */
export function drawTaxiCompany(ctx, rect, empresa, index = 0) {
  const [x, y, w] = rect;
  vaciar(ctx, rect);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 25px "Arial Black", Impact, sans-serif';
  ctx.fillText(empresa.nombre, x + w / 2, y + 19, w - 12);
  ctx.fillRect(x + 8, y + 35, w - 16, 3);
  ctx.font = '900 23px "Arial Black", sans-serif';
  ctx.fillText(`TEL. ${empresa.telefono}`, x + w / 2, y + 51, w - 40);
  gastar(ctx, rect, 9103 + index * 977, 1.6);
}

/** Placa pintada en el techo, para que se lea desde arriba: solo las letras, sobre el esmalte del carro. */
export function drawTaxiRoof(ctx, rect, plate, index) {
  const [x, y, w, h] = rect;
  vaciar(ctx, rect);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 38px "Arial Black", Impact, sans-serif';
  ctx.fillText(plate.code, x + w / 2, y + h / 2 + 2, w - 8);
  gastar(ctx, rect, 6113 + index * 59, .8);
}

/**
 * Damero del taxi sobre el mapa de detalle: cuadros negros de 5 cm en dos filas, bajo las ventanas y de arco a arco.
 * El otro cuadro es el amarillo del carro. `altura(x)` da el borde de abajo de la franja en cada punto del costado.
 */
export const DAMERO_ALTO = .10;
export function pintarDamero(ctx, { sx, sy }, x0, x1, altura) {
  const lado = DAMERO_ALTO / 2, cuadros = Math.max(2, Math.round((x1 - x0) / lado)), paso = (x1 - x0) / cuadros;
  ctx.fillStyle = 'rgba(18,16,14,.93)';
  for (let i = 0; i < cuadros; i++) {
    const xa = x0 + i * paso, y = altura(xa + paso / 2) + (i % 2 ? 0 : lado);
    const px0 = Math.round(sx(xa)), px1 = Math.round(sx(xa + paso)), py0 = Math.round(sy(y + lado)), py1 = Math.round(sy(y));
    ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
  }
}

/** Capacete: acrílico amarillo algo quemado por el sol, con marco y letras negras. */
export function drawTaxiSign(ctx, rect) {
  const [x, y, w, h] = rect;
  const luz = ctx.createLinearGradient(0, y, 0, y + h);
  luz.addColorStop(0, '#f6e27c'); luz.addColorStop(.55, '#f0c83a'); luz.addColorStop(1, '#d9a51c');
  ctx.fillStyle = luz; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 38px "Arial Black", Impact, sans-serif'; ctx.fillText('TAXI', x + w / 2, y + h / 2 + 2, w - 22);
  gastar(ctx, rect, 4409, .5, true);
}

// ===== Busetas =====

// Esmaltes de fondo de la buseta: hueso, crema y azul lavado. Los elige la fábrica con la semilla del carro.
export const BUS_PAINTS = ['#f1eee2', '#e6d6a6', '#bfd2df'];

// Cada ruta tiene su tablero, sus dos cartones y su propia pintura. Las bandas [desde, hasta, color] se miden
// desde el piso. La que cruza de 1,06 a 1,34 m carga el nombre de la empresa.
export const BUS_LIBREAS = [
  {
    empresa: 'COOTRANS EL CAMBUCHE', letra: '#fff1cb', canal: '#397655',
    tablero: { num: '14-2', dest: 'SOACHA', via: 'CRA 10 · SAN MATEO · BOSA', fondo: '#175339', ficha: '#f1d064' },
    bandas: [[.43, .89, '#628e76'], [.93, 1.01, '#d6ab41'], [1.04, 1.39, '#3b895d'], [1.41, 1.46, '#cca641']],
    cartones: [['SOACHA', 'SAN MATEO', '#c9d53e'], ['BOSA', 'CRA 10', '#b99a68']] },
  {
    empresa: 'RUTAS DE LA CAPITAL', letra: '#fff1db', canal: '#385e91',
    tablero: { num: '314', dest: 'ENGATIVÁ', via: 'CL 80 · VÍA CORINTO · MINUTO', fondo: '#224780', ficha: '#f1b378' },
    bandas: [[.43, .83, '#6b86ad'], [.905, .98, '#bd4544'], [1.025, 1.39, '#376ba5'], [1.425, 1.493, '#bc4644']],
    cartones: [['ENGATIVÁ', 'CALLE 80', '#e4873c'], ['MINUTO', 'CORINTO', '#b99a68']] },
  {
    empresa: 'FLOTA LA ESQUINITA', letra: '#fff1d9', canal: '#9b4343',
    tablero: { num: 'E25', dest: 'SUBA · CENTRO', via: 'CALLE 100 · CRA 7MA', fondo: '#78272d', ficha: '#f7e9ba' },
    bandas: [[.40, .96, '#ac4a4e'], [.96, 1.012, '#e1c693'], [1.024, 1.385, '#ad414a'], [1.414, 1.466, '#994540']],
    cartones: [['SUBA', 'CALLE 100', '#dfcf45'], ['CENTRO', 'CRA 7MA', '#b99a68']] },
  {
    empresa: 'EXPRESO EL CHATO', letra: '#fff3d3', canal: '#a7653a',
    tablero: { num: '496', dest: 'FONTIBÓN', via: 'CL 26 · SALITRE · GERMANIA', fondo: '#793c24', ficha: '#b9ce83' },
    bandas: [[.40, .79, '#d18a54'], [.90, 1.015, '#4c8055'], [1.04, 1.395, '#ac5931'], [1.425, 1.48, '#4c8055']],
    cartones: [['FONTIBÓN', 'CALLE 26', '#df6f8d'], ['SALITRE', 'GERMANIA', '#b99a68']] },
];

// Lo que el dueño de cada buseta manda pintar en el vidrio de atrás, en vinilo claro. Una por ruta, dos renglones.
export const BUS_FRASES = [['DIOS ES', 'MI GUÍA'], ['EL CONSENTIDO', 'DE MI MAMÁ'], ['NO ME SIGA', 'QUE VOY PERDIDO'], ['GRACIAS', 'MADRE MÍA']];

// Recuadro del número interno en el voladizo trasero: ahí la franja se interrumpe y queda el fondo de la buseta.
export const BUS_NUMERO = { x0: -3.47, x1: -2.83, y0: 1.04, y1: 1.36 };

/**
 * Franjas de la empresa sobre el mapa de detalle de la buseta: dan la vuelta completa, porque la cara y la cola usan
 * la misma carta lateral. Multiplican lo ya pintado, para no borrar juntas ni sombras, y el polvo y los chorreones del
 * uso se pintan después, encima.
 */
export function pintarLibreaBuseta(ctx, { sx, sy, tx, ty, W, H, body }, indice) {
  const librea = BUS_LIBREAS[indice % BUS_LIBREAS.length], n = BUS_NUMERO;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H);
  ctx.rect(Math.round(sx(n.x0)), Math.round(sy(n.y1)), Math.round(sx(n.x1)) - Math.round(sx(n.x0)), Math.round(sy(n.y0)) - Math.round(sy(n.y1)));
  ctx.clip('evenodd');
  ctx.globalCompositeOperation = 'multiply';
  for (const [y0, y1, color] of librea.bandas) { ctx.fillStyle = color; ctx.fillRect(0, Math.round(sy(y1)), W, Math.round(sy(y0)) - Math.round(sy(y1))); }
  ctx.restore();

  // El color de la canal dobla sobre el techo desde el canto de la ventana.
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  const x0 = -3.64, x1 = 3.52, pasos = 24;
  const alero = (paso, fraccion) => {
    const x = x0 + (x1 - x0) * paso / pasos;
    return [tx(x), ty(body.edgeZ(x) * fraccion)];
  };
  ctx.beginPath(); ctx.moveTo(...alero(0, .99));
  for (let i = 1; i <= pasos; i++) ctx.lineTo(...alero(i, .99));
  for (let i = pasos; i >= 0; i--) ctx.lineTo(...alero(i, .83));
  ctx.closePath(); ctx.fillStyle = librea.canal; ctx.fill();
  ctx.restore();
}

/** Registros de carrocería, tornillos y solapes de chapa, en la misma carta lateral que la pintura. */
export function pintarPanelesBuseta(ctx, { sx, sy, pxX, pxY, body, seam }) {
  const tornillo = (x, y) => {
    ctx.fillStyle = 'rgba(43,38,32,.53)'; ctx.fillRect(sx(x) - 1.35, sy(y) - 1.3, 2.7, 2.6);
    ctx.fillStyle = 'rgba(248,235,206,.58)'; ctx.fillRect(sx(x) - .6, sy(y) - 1.25, 1.45, 1.2);
  };
  const tapas = [[-3.15, -2.02, .63, .91], [1.29, 1.86, .64, .89]];
  for (const [x0, x1, y0, y1] of tapas) {
    const w = (x1 - x0) * pxX, h = (y1 - y0) * pxY;
    ctx.beginPath(); ctx.roundRect(sx(x0), sy(y1), w, h, 2.5); seam();
    ctx.fillStyle = 'rgba(43,38,32,.35)'; ctx.fillRect(sx(x1 - .15), sy(y1 - .055), .10 * pxX, 2);
    for (const x of [x0 + .033, x1 - .033]) for (const y of [y0 + .029, y1 - .029]) tornillo(x, y);
  }
  // Respiradero angosto estampado en la tapa delantera.
  const agujero = .17 * pxX;
  for (const y of [.71, .745, .78]) {
    ctx.fillStyle = 'rgba(36,33,30,.56)'; ctx.fillRect(sx(1.4), sy(y), agujero, 1.8);
    ctx.fillStyle = 'rgba(247,235,207,.24)'; ctx.fillRect(sx(1.4), sy(y) + 1.8, agujero, 1);
  }
  // Cubrejunta justo debajo de las ventanas, con remaches menos expuestos hacia los extremos.
  for (const [x0, x1] of body.spec.windows) {
    for (const x of [x0 + .06, (x0 + x1) * .5, x1 - .06]) tornillo(x, body.belt(x) - .048);
  }
}

// Dónde asoma el tubo de escape de la buseta: metros desde el eje, hacia la izquierda, y altura de su centro.
export const BUS_ESCAPE = Object.freeze({ z: .8, y: .5 });
const HOLLIN_BUSETA = '27,24,20', POLVO_BUSETA = '125,110,88';

/**
 * Mugre de trabajo de toda buseta, sobre la librea: el hollín del exosto que sube por el voladizo trasero, la grasa
 * que baja de cada paral de las ventanas y el roce de las manos junto a la puerta. `parales` son las X de los parales.
 * Con `escape`, además, la cola y el frente: el hollín que nace en el tubo y sube abriéndose, los chorreones finos bajo
 * las ventanas de atrás y el polvo con insectos del tercio bajo del frente. La cola y el frente leen la misma carta que
 * los costados, espejada: lo que se pinta a un lado del eje sale también al otro.
 */
export function pintarMugreBuseta(ctx, { sx, sy, body }, parales, cola, puerta, escape = null) {
  const hollin = ctx.createRadialGradient(sx(cola + .15), sy(.6), 4, sx(cola + .15), sy(.6), sx(cola + 1.5) - sx(cola + .15));
  hollin.addColorStop(0, 'rgba(22,20,18,.62)'); hollin.addColorStop(.45, 'rgba(22,20,18,.26)'); hollin.addColorStop(1, 'rgba(22,20,18,0)');
  ctx.fillStyle = hollin; ctx.fillRect(sx(cola), sy(2.0), sx(cola + 1.5) - sx(cola), sy(.4) - sy(2.0));
  const azar = azarPropio(0xB0CA);
  for (const x of parales) {
    const largo = .16 + azar() * .3, ancho = 2 + azar() * 3, hilo = ctx.createLinearGradient(0, sy(1.6), 0, sy(1.6 - largo));
    hilo.addColorStop(0, `rgba(30,27,23,${.3 + azar() * .22})`); hilo.addColorStop(1, 'rgba(30,27,23,0)');
    ctx.fillStyle = hilo; ctx.fillRect(sx(x) - ancho / 2 + (azar() - .5) * 4, sy(1.6), ancho, sy(1.6 - largo) - sy(1.6));
  }
  const roce = ctx.createRadialGradient(sx(puerta), sy(1.5), 2, sx(puerta), sy(1.5), sx(puerta + .34) - sx(puerta));
  roce.addColorStop(0, 'rgba(40,34,28,.3)'); roce.addColorStop(1, 'rgba(40,34,28,0)');
  ctx.fillStyle = roce; ctx.fillRect(sx(puerta - .34), sy(1.84), sx(puerta + .34) - sx(puerta - .34), sy(1.16) - sy(1.84));
  if (!escape || !body) return;

  // Hollín: 55 % desde la boca del tubo hasta pasar la defensa; sube 62 cm y se abre hasta 90 cm. Tres capas, para
  // que el borde no sea un corte.
  const enCola = (a, y) => sx(body.around('tail', Math.max(0, a), y, 0)[0]), FRANJAS = 30, ALTO = .62;
  for (let i = 0; i < FRANJAS; i++) {
    const t = (i + .5) / FRANJAS, y = escape.y - .03 + t * ALTO, medio = .05 + .4 * Math.pow(t, .8);
    const fuerza = .55 * (1 - Math.pow(Math.max(0, (t - .72) / .28), 1.4));
    const y0 = sy(y + ALTO / FRANJAS / 2), y1 = sy(y - ALTO / FRANJAS / 2);
    for (const [ancho, parte] of [[1, .3], [.66, .4], [.33, .55]]) {
      const xa = enCola(escape.z - medio * ancho, y), xb = enCola(escape.z + medio * ancho, y);
      ctx.fillStyle = `rgba(${HOLLIN_BUSETA},${(fuerza * parte).toFixed(3)})`;
      ctx.fillRect(Math.min(xa, xb), y0, Math.abs(xb - xa), y1 - y0);
    }
  }
  const chorreon = (x, alto, largo, ancho, fuerza) => {
    const hilo = ctx.createLinearGradient(0, sy(alto), 0, sy(alto - largo));
    hilo.addColorStop(0, `rgba(${HOLLIN_BUSETA},${fuerza.toFixed(3)})`); hilo.addColorStop(1, `rgba(${HOLLIN_BUSETA},0)`);
    ctx.fillStyle = hilo; ctx.fillRect(x - ancho / 2, sy(alto), ancho, sy(alto - largo) - sy(alto));
  };
  // Chorreones finos: bajo la ventana de la cola, hacia las esquinas, y bajo las dos últimas ventanas de cada costado.
  const fino = azarPropio(0xB0CB);
  for (let i = 0; i < 7; i++) chorreon(enCola(.66 + fino() * .42, 1.6), 1.7, .1 + fino() * .26, .8 + fino() * .9, .22 + fino() * .2);
  for (let i = 0; i < 16; i++) chorreon(sx(cola + .4 + fino() * 2.3), 1.6, .08 + fino() * fino() * .34, .7 + fino() * .8, .12 + fino() * .18);

  // Frente: polvo al 30 % abajo, que se pierde hacia arriba y al doblar la esquina, y los insectos de la carretera.
  const frente = -cola, enFrente = (a, y) => sx(body.around('nose', Math.max(0, a), y, 0)[0]);
  for (let i = 0; i < 7; i++) {
    const x1 = i ? frente - .34 - (i - 1) * .1 : frente + .01, x0 = i ? x1 - .1 : frente - .34, resto = 1 - i / 7;
    const polvo = ctx.createLinearGradient(0, sy(1.42), 0, sy(.5));
    polvo.addColorStop(0, `rgba(${POLVO_BUSETA},0)`); polvo.addColorStop(.45, `rgba(${POLVO_BUSETA},${(.2 * resto).toFixed(3)})`); polvo.addColorStop(1, `rgba(${POLVO_BUSETA},${(.3 * resto).toFixed(3)})`);
    ctx.fillStyle = polvo; ctx.fillRect(sx(x0), sy(1.42), sx(x1) - sx(x0), sy(.5) - sy(1.42));
  }
  for (let i = 0; i < 46; i++) {
    const y = .84 + fino() * fino() * 1.1, x = enFrente(.68 + fino() * .44, y), lado = .5 + fino() * .9;
    ctx.fillStyle = `rgba(38,32,24,${(.35 + fino() * .35).toFixed(3)})`;
    ctx.fillRect(x - lado / 2, sy(y) - lado / 2, lado, lado * (1 + fino()));
  }
}

/**
 * Pinta la fila de una ruta en el piso de busetas del atlas: el nombre de la empresa, que va recortado sobre la franja,
 * la frase del vidrio de atrás y los dos ruteros de cartón del panorámico. `cells` trae los rectángulos de esa fila.
 */
export function drawBusLivery(ctx, cells, index) {
  const librea = BUS_LIBREAS[index % BUS_LIBREAS.length];
  const [nx, ny, nw] = cells.librea;
  vaciar(ctx, cells.librea, true);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Letra a brocha con su sombra, como la pinta el rotulista.
  for (const [dx, color] of [[2.8, '#211c18'], [0, librea.letra]]) {
    ctx.fillStyle = color;
    ctx.font = 'italic 900 35px "Arial Black", Arial, sans-serif';
    ctx.fillText(librea.empresa, nx + nw / 2 + dx, ny + 24 + dx, nw - 32);
    ctx.font = '900 15px Arial, sans-serif';
    ctx.fillText('SERVICIO COLECTIVO · TEL. 555 03 ' + (11 + index * 17), nx + nw / 2 + dx * .5, ny + 49 + dx * .5, nw - 64);
  }
  gastar(ctx, cells.librea, 5200 + index * 311, .55);
  // Frase del vidrio de atrás: letra cursiva recortada, en el amarillo pálido del vinilo viejo.
  const [fx, fy, fw] = cells.frase, [uno, dos] = BUS_FRASES[index % BUS_FRASES.length];
  vaciar(ctx, cells.frase, true);
  ctx.fillStyle = ctx.strokeStyle = index % 2 ? '#e9e4d2' : '#e6d68a';
  ctx.font = 'italic 900 24px Georgia, "Times New Roman", serif';
  // El trazo engorda la letra: de lejos, una cursiva fina se deshace.
  ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
  for (const [renglon, y] of [[uno, fy + 19], [dos, fy + 46]]) { ctx.fillText(renglon, fx + fw / 2, y, fw - 12); ctx.strokeText(renglon, fx + fw / 2, y, fw - 12); }
  gastar(ctx, cells.frase, 6400 + index * 173, 1.4);
  cells.cartones.forEach((rect, i) => {
    const [cx, cy, cw, ch] = rect, [arriba, abajo, fondo] = librea.cartones[i], azar = azarPropio(8800 + index * 53 + i * 7);
    ctx.fillStyle = fondo; ctx.fillRect(cx, cy, cw, ch);
    // Cartón asoleado: más pálido hacia una esquina y con el borde ajado.
    const sol = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
    sol.addColorStop(0, 'rgba(255,250,232,.3)'); sol.addColorStop(1, 'rgba(70,56,36,.18)');
    ctx.fillStyle = sol; ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = '#31271f'; ctx.lineWidth = 4; ctx.strokeRect(cx + 2, cy + 2, cw - 4, ch - 4);
    ctx.fillStyle = 'rgba(242,227,195,.65)';
    for (const xs of [cx + 6, cx + cw - 21]) ctx.fillRect(xs, cy + 4, 15, 5);
    // Letra de marcador, cada cartón un poco torcido.
    ctx.save(); ctx.translate(cx + cw / 2, cy + ch / 2); ctx.rotate((azar() - .5) * .05);
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 31px "Arial Black", Arial, sans-serif'; ctx.fillText(arriba, 0, -11, cw - 16);
    ctx.fillRect(-cw * .34, 4, cw * .68, 1.6);
    ctx.font = '900 22px "Arial Black", Arial, sans-serif'; ctx.fillText(abajo, 0, 17, cw - 18);
    ctx.restore();
  });
}

/** Tablero de dos líneas con ficha de ruta, como las placas rotuladas de los colectivos. */
export function drawBusRoute(ctx, [x, y, w, h], { num, dest, via, fondo, ficha }) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#221f1b'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#eee1bb'; ctx.fillRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = fondo; ctx.fillRect(62, 5, w - 67, 35);
  ctx.fillStyle = ficha; ctx.fillRect(5, 5, 55, h - 10);
  ctx.fillStyle = '#24211c'; ctx.fillRect(10, h - 15, 45, 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 29px "Arial Black", Arial, sans-serif'; ctx.fillText(num, 32.5, 27, 47);
  ctx.font = '900 17px "Arial Black", Arial, sans-serif'; ctx.fillText(via, 62 + (w - 67) / 2, 50, w - 76);
  ctx.fillStyle = '#fff6dc'; ctx.font = 'italic 900 25px "Arial Black", Arial, sans-serif';
  ctx.fillText(dest, 62 + (w - 67) / 2, 23, w - 76);
  ctx.restore();
}

/** Las hojas de la puerta se pintan juntas. La celda se gira para aprovechar la fila del atlas. */
export function drawBusDoor(ctx, [x, y, w, h]) {
  ctx.save(); ctx.translate(x + w, y); ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#1d2323'; ctx.fillRect(0, 0, h, w);
  for (let i = 0; i < 2; i++) {
    const left = 3 + i * h / 2, width = h / 2 - 6;
    ctx.fillStyle = '#7b837f'; ctx.fillRect(left, 5, width, w - 13);
    ctx.fillStyle = '#252a2a'; ctx.fillRect(left + 2, 8, width - 4, 142);
    // El vidrio alto lleva un canto de caucho. Abajo van la chapa y la puntera de aluminio.
    const glass = ctx.createLinearGradient(0, 13, 0, 142);
    glass.addColorStop(0, '#4e6263'); glass.addColorStop(.47, '#3c5256'); glass.addColorStop(1, '#253638');
    ctx.fillStyle = glass; ctx.fillRect(left + 4, 12, width - 8, 133);
    ctx.fillStyle = '#a5aca1'; ctx.fillRect(left + 3, 154, width - 6, 2); ctx.fillRect(left + 2, w - 28, width - 4, 14);
    ctx.fillStyle = '#4b5551'; ctx.fillRect(left + 3, 157, width - 6, w - 187);
    ctx.fillStyle = '#575e58';
    for (const at of [w - 25, w - 20, w - 16]) ctx.fillRect(left + 3, at, width - 6, 1.5);
    const bisagra = i ? left + width - 6 : left - 1;
    for (const at of [64, 203]) {
      ctx.fillStyle = '#424640'; ctx.fillRect(bisagra, at, 7, 16);
      ctx.fillStyle = '#b3b8aa'; ctx.fillRect(bisagra + 2, at + 1, 3, 11);
    }
  }
  // Jaladera vertical atornillada al montante de la hoja delantera.
  ctx.fillStyle = '#272a26'; ctx.fillRect(h / 2 + 4, 128, 6, 42);
  ctx.fillStyle = '#d1c8a9'; ctx.fillRect(h / 2 + 4, 125, 5, 4); ctx.fillRect(h / 2 + 4, 170, 5, 4);
  ctx.fillStyle = '#9c9c8e'; ctx.fillRect(h / 2 + 6, 129, 3, 41);
  ctx.restore();
}

/** Calcomanía de la cola de toda buseta: la pregunta de siempre y un teléfono que no existe. */
export function drawBusConduzco(ctx, rect) {
  const [x, y, w, h] = rect;
  ctx.fillStyle = '#e6e1d0'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#8f2424'; ctx.fillRect(x, y, w, 26);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f1ead2'; ctx.font = '900 18px "Arial Black", Impact, sans-serif'; ctx.fillText('¿CÓMO CONDUZCO?', x + w / 2, y + 14, w - 12);
  ctx.fillStyle = INK; ctx.font = '900 19px "Arial Black", Impact, sans-serif'; ctx.fillText('TEL. 555 04 40', x + w / 2, y + 46, w - 16);
  gastar(ctx, rect, 3307, 1.2, true);
}
