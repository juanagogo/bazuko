import { rng } from './textures.js';

// El zócalo del edificio llega a 65 cm. Sobre él hay 9,5 cm de retranqueo hasta el muro original.
export const ANTEPECHO_BOTELLERO = .66;
const FONDO = -.089;
const TIPOS = [
  // Alto, radio, altura del hombro y arranque del cuello en fracciones de la botella.
  { alto: .374, radio: .052, hombro: .61, cuello: .79, vidrio: '#366844', reflejo: '#a4bd83', papel: '#e3d3ab', tinta: '#496247', tapa: '#a26a48', sello: 'SECO' },
  { alto: .303, radio: .067, hombro: .64, cuello: .77, vidrio: '#8e4d20', reflejo: '#e7af62', papel: '#e5c581', tinta: '#813c29', tapa: '#a8884c', sello: 'RON' },
  { alto: .354, radio: .055, hombro: .59, cuello: .77, vidrio: '#90aaa0', reflejo: '#e7ece0', papel: '#dcdcc7', tinta: '#2b5874', tapa: '#426481', sello: 'CAÑA' },
  { alto: .387, radio: .055, hombro: .58, cuello: .81, vidrio: '#503932', reflejo: '#ae7966', papel: '#e3d5b0', tinta: '#763749', tapa: '#823d4a', sello: 'VINO' },
  { alto: .291, radio: .046, hombro: .55, cuello: .78, vidrio: '#80521f', reflejo: '#d09844', papel: '#b75236', tinta: '#f0cf91', tapa: '#b89543', sello: 'MALTA' },
  { alto: .328, radio: .061, hombro: .66, cuello: .79, vidrio: '#497676', reflejo: '#a5ccc2', papel: '#d3c89d', tinta: '#375c58', tapa: '#b57d54', sello: 'FINO' }
];

// Celdas de cada envase en unidades de la celda botellas (64 × 64, pintada a 2×).
const ETIQUETAS = TIPOS.map((_, i) => [(i % 3) * 21 + 1, Math.floor(i / 3) * 26 + 12, 20, 24]);
const TRASERA = [1, 1, 28, 8], MADERA = [32, 1, 18, 8], HIERRO = [53, 1, 9, 8];

/** La franja del fondo conserva las existencias en penumbra. Cada botella recibe la vuelta completa de su etiqueta. */
export function pintarBotellero(ctx, [x, y, w, h]) {
  ctx.save();
  ctx.translate(x + 1, y + 1);
  ctx.scale((w - 2) / 64, (h - 2) / 64);
  ctx.fillStyle = 'rgba(51,41,33,.93)'; ctx.fillRect(0, 0, 31, 11);
  const pared = ctx.createLinearGradient(0, 0, 0, 10);
  pared.addColorStop(0, 'rgba(10,16,17,.61)'); pared.addColorStop(1, 'rgba(133,103,74,.26)');
  ctx.fillStyle = pared; ctx.fillRect(0, 0, 31, 11);
  const tabla = ctx.createLinearGradient(0, 0, 0, 10);
  tabla.addColorStop(0, '#987954'); tabla.addColorStop(.24, '#a48864');
  tabla.addColorStop(.4, '#71573f'); tabla.addColorStop(.8, '#694c38'); tabla.addColorStop(1, '#473b30');
  ctx.fillStyle = tabla; ctx.fillRect(30, 0, 22, 11);
  const metal = ctx.createLinearGradient(52, 0, 64, 0);
  metal.addColorStop(0, '#252926'); metal.addColorStop(.28, '#586057'); metal.addColorStop(.52, '#444a43'); metal.addColorStop(1, '#232724');
  ctx.fillStyle = metal; ctx.fillRect(52, 0, 12, 11);

  TIPOS.forEach((tipo, i) => {
    const [left, top, width, height] = ETIQUETAS[i];
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(width, height);
    const vidrio = ctx.createLinearGradient(0, 0, 1, 0);
    for (const [at, color] of [[0, tipo.vidrio], [.19, '#292a22'], [.32, tipo.vidrio], [.39, tipo.reflejo],
      [.435, tipo.vidrio], [.64, tipo.vidrio], [.73, tipo.reflejo], [.80, tipo.vidrio], [1, tipo.vidrio]]) vidrio.addColorStop(at, color);
    // El margen repite el vidrio para los mipmaps, también al costado de las etiquetas.
    ctx.fillStyle = vidrio; ctx.fillRect(-.05, -.05, 1.10, 1.10);
    const licor = ctx.createLinearGradient(0, .18, 0, 1);
    licor.addColorStop(0, 'rgba(251,224,166,.18)'); licor.addColorStop(.22, 'rgba(43,31,19,.03)');
    licor.addColorStop(.85, 'rgba(23,22,14,.11)'); licor.addColorStop(1, 'rgba(16,22,17,.67)');
    ctx.fillStyle = licor; ctx.fillRect(0, .19, 1, .81);
    ctx.fillStyle = 'rgba(247,246,220,.56)'; ctx.fillRect(.365, .23, .023, .19);
    ctx.fillStyle = 'rgba(247,246,220,.46)'; ctx.fillRect(.694, .43, .025, .42);
    ctx.fillStyle = 'rgba(239,229,183,.32)'; ctx.fillRect(.23, .928, .58, .023);

    // Cartela de papel, filete, marca del tipo de bebida y dos líneas de imprenta.
    const y0 = i === 1 || i === 5 ? .43 : .49, y1 = i === 4 ? .84 : .81;
    ctx.fillStyle = tipo.papel;
    ctx.beginPath();
    ctx.moveTo(.24, y0 + .035); ctx.lineTo(.46, y0); ctx.lineTo(.64, y0 + .015);
    ctx.lineTo(.755, y0 + .04); ctx.lineTo(.755, y1 - .02); ctx.lineTo(.49, y1 + .019); ctx.lineTo(.24, y1 - .015);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = tipo.tinta; ctx.fillRect(.256, y0 + .056, .48, .021);
    ctx.fillRect(.267, y1 - .055, .46, .018);
    ctx.fillRect(.405, y1 - .11, .19, .017);
    ctx.save();
    ctx.scale(1 / width, 1 / height);
    ctx.fillStyle = tipo.tinta; ctx.font = 'bold 4px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tipo.sello, width * .5, height * ((y0 + y1) / 2 - .012), width * .405);
    ctx.restore();
    ctx.fillStyle = tipo.tapa; ctx.fillRect(-.05, -.05, 1.10, .162);
    for (let j = 0; j < 10; j++) { ctx.fillStyle = 'rgba(250,231,175,.35)'; ctx.fillRect(j / 10, 0, .027, .093); }
    ctx.fillStyle = 'rgba(44,31,20,.62)'; ctx.fillRect(0, .093, 1, .02);
    if (i === 3 || i === 4) { ctx.fillStyle = tipo.papel; ctx.fillRect(.22, .165, .57, .043); }
    ctx.restore();
  });
  ctx.restore();
}

function recorte([u0, v0, u1, v1], [x, y, w, h]) {
  const du = (u1 - u0) / 64, dv = (v1 - v0) / 64;
  return [u0 + x * du, v1 - (y + h) * dv, u0 + (x + w) * du, v1 - y * dv];
}

function modelo(tipo, plano) {
  const { alto, radio, hombro, cuello } = tipo;
  const perfil = [[0, .80], [.044, 1], [hombro, 1], [hombro + .052, .87], [cuello, .34],
    [.89, .31], [.898, .39], [.982, .39], [1, .32], [1, 0]];
  const position = [], normal = [], uv = [], index = [];
  const lados = plano ? 4 : 8;
  for (let j = 0; j < perfil.length; j++) {
    const [altura, ancho] = perfil[j], antes = perfil[Math.max(0, j - 1)], despues = perfil[Math.min(j + 1, perfil.length - 1)];
    const pendiente = (antes[1] - despues[1]) * radio / Math.max(.0001, (despues[0] - antes[0]) * alto);
    for (let i = 0; i <= lados; i++) {
      const s = plano ? .25 + .5 * i / lados : i / lados;
      const theta = (s - .5) * Math.PI * 2, sx = Math.sin(theta), sz = Math.cos(theta);
      // Los envases de frente ancho se aplanan por detrás y caben enteros bajo el cajón de la persiana.
      const espesor = Math.min(.048, radio);
      position.push(sx * radio * ancho, altura * alto, plano ? 0 : sz * espesor * ancho);
      const nx = sx, nz = sz * radio / espesor, l = Math.hypot(nx, pendiente, nz);
      if (plano) normal.push(0, 0, 1); else normal.push(nx / l, pendiente / l, nz / l);
      uv.push(s, altura);
      if (j > 0 && i < lados) {
        const a = (j - 1) * (lados + 1) + i, b = a + lados + 1;
        index.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  }
  return { position, normal, uv, index };
}

const REDONDAS = TIPOS.map(tipo => modelo(tipo, false)), PLANAS = TIPOS.map(tipo => modelo(tipo, true));

/** Todas las piezas se estampan en la malla que ya tenía esta fachada, con el mismo atlas de luz. */
export function ponerBotellero(life, UV, u, ancho, tope, semilla, reja, plano) {
  const azar = rng(semilla >>> 0), celda = UV.botellas, pared = recorte(celda, TRASERA);
  const madera = recorte(celda, MADERA), hierro = recorte(celda, HIERRO), etiquetas = ETIQUETAS.map(r => recorte(celda, r));
  const fondo = plano ? .022 : FONDO, centroEnvase = plano ? .026 : -.028;
  const pieza = (rect, x, y, n, w, h, d) => {
    if (plano) life.panel(rect, x, y + h / 2, n, w, h);
    else life.box(rect, x, y, n, w, h, d);
  };
  const bajo = ANTEPECHO_BOTELLERO, dentro = ancho - .13, izquierda = u - dentro / 2;
  life.panel(UV.wood, u, (.07 + bajo) / 2, .022, ancho, bajo - .07);
  life.panel(pared, u, (bajo + tope) / 2, fondo, ancho, tope - bajo);
  for (const lado of [-1, 1]) {
    pieza(hierro, u + lado * (ancho / 2 - .029), bajo, plano ? .029 : -.005, .058, tope - bajo, .166);
  }
  const filas = [.696, 1.163, 1.634], columnas = Math.max(3, Math.floor(dentro / .175)), paso = dentro / columnas;
  for (const [fila, y] of filas.entries()) {
    if (y >= tope) break;
    pieza(madera, u, y - .039, plano ? .024 : -.012, dentro + .018, .039, .151);
    let tipo = (fila + Math.floor(azar() * TIPOS.length)) % TIPOS.length, quedan = 1 + Math.floor(azar() * 3);
    for (let i = 0; i < columnas; i++) {
      if (!quedan) {
        tipo = (tipo + 1 + Math.floor(azar() * (TIPOS.length - 1))) % TIPOS.length;
        quedan = 2 + Math.floor(azar() * 3);
      }
      quedan--;
      const libre = azar() < .13, x = izquierda + paso * (i + .5) + (azar() - .5) * .026;
      const escala = .95 + azar() * .11, n = centroEnvase + (plano ? 0 : (azar() - .5) * .011);
      if (!libre) life.estampa((plano ? PLANAS : REDONDAS)[tipo], etiquetas[tipo], x, y, n, escala);
    }
  }
  if (reja) {
    const n = plano ? .032 : .074, barras = Math.max(3, Math.round(dentro / .28)), altura = tope - bajo;
    for (let i = 1; i < barras; i++) pieza(hierro, izquierda + dentro * i / barras, bajo, n, .018, altura, .019);
    for (const y of [bajo + .41, bajo + .91]) if (y + .018 < tope) pieza(hierro, u, y, n, dentro, .018, .024);
  }
}
