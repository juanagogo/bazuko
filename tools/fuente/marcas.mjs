// Todo trazo de la interfaz que no es letra: rayitas, círculos, tachones, reglas, tapitas.
// Sale del mismo simulador de marcador que la fuente, así que tiene la misma mano.
// Uso: npm run fuente. Escribe src/ui/css/marcas.css con imágenes SVG dentro de la hoja.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inkStrokes, contoursToPath, l, c, rnd } from './nib.mjs';

const SALIDA = process.argv[2] ?? fileURLToPath(new URL('../../src/ui/css/marcas.css', import.meta.url));
const TINTA = '#14110C', ROJO = '#AB1D17', CINTA = '#E9DBB4', CANTO = '#3B2913'; // los mismos valores de base.css

const uri = (w, h, body, extra = '') =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'${extra}>${body}</svg>`).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%27/g, "'")}")`;

/** Trazos a un <path> relleno. */
function tinta(strokes, { color = TINTA, nib, seed = 1, amp = 2, wave = 60, opacity = null }) {
  const cs = inkStrokes(strokes, { nib, seed, amp, wave, tol: .25 });
  const d = contoursToPath(cs);
  return `<path fill='${color}'${opacity ? ` fill-opacity='${opacity}'` : ''} d='${d}'/>`;
}

// ---------- rayado: la masa de las barras, igual al de las manzanas del mapa ----------
// Baldosa que se repite a lo ancho. Cada raya cabe entera en su baldosa: no hay costura.
function rayado({ w = 96, h = 24, n = 8, color = TINTA, seed = 3, nib = { angle: 62, w: 6.4, t: 4, r: .9 } } = {}) {
  const r = rnd(seed), banda = w / n, strokes = [];
  for (let i = 0; i < n; i++) {
    const x = banda * (i + .5), lean = banda * (.2 + r() * .08);
    strokes.push(l(x + lean, 2.4 + r() * 1.2, x - lean, h - 2.4 - r() * 1.2));
  }
  return uri(w, h, tinta(strokes, { color, nib, seed, amp: .25, wave: 40 }));
}

// ---------- rayas de nivel: «Te tienen fichado ///» ----------
function tresRayas(color, seed = 6) {
  const r = rnd(seed), strokes = [];
  for (let i = 0; i < 3; i++) {
    const x = 6 + i * 12, lean = 2.6 + r() * .9;
    strokes.push(l(x + lean, 2 + r() * 1.4, x - lean, 20 - r() * 1.4));
  }
  return uri(36, 22, tinta(strokes, { color, nib: { angle: 62, w: 5.4, t: 3, r: .8 }, seed, amp: .25, wave: 40 }));
}

// ---------- círculo a mano: elegido ----------
// Tamaño fijo y a escala 1:1: se corta en nueve partes, así que las esquinas nunca se estiran y el óvalo sigue
// la forma de la palabra. Ver .elegido en base.css.
function circulo(seed, color = ROJO, grosor = { angle: 30, w: 5.6, t: 3, r: 1 }) {
  // Vuelta y un poquito: la mano se pasa de donde empezó, siempre.
  const W = 120, H = 64, r = rnd(seed), pts = [];
  const a0 = -1.9 - r() * .5, cx = W / 2, cy = H / 2;
  const vueltas = 1.09 + r() * .05;
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = a0 + t * Math.PI * 2 * vueltas;
    const k = 1 + (t - .5) * .05 + (r() - .5) * .012;
    pts.push([cx + Math.cos(a) * 53 * k, cy + Math.sin(a) * 26 * k]);
  }
  return uri(W, H, tinta([{ kind: 'curve', pts }], { color, nib: grosor, seed, amp: .25 }), ` width='${W}' height='${H}'`);
}

// ---------- tachón: no disponible ----------
const tachon = (seed, color = TINTA) => uri(200, 40, tinta([c([4, 26], [60, 19], [130, 21], [197, 13])], { color, nib: { angle: 24, w: 9, t: 4, r: 1 }, seed, amp: .8 }), " preserveAspectRatio='none'");

// ---------- reglas: para tablas y divisiones ----------
const reglaH = (seed, color = TINTA) => uri(600, 8, tinta([c([0, 5], [160, 3.4], [340, 4.4], [600, 3])], { color, nib: { angle: 18, w: 5, t: 2.4, r: .6 }, seed, amp: .9, wave: 110 }), " preserveAspectRatio='none'");
const reglaV = (seed, color = TINTA) => uri(8, 300, tinta([c([4.6, 0], [3.2, 90], [4.6, 200], [3.2, 300])], { color, nib: { angle: 62, w: 5, t: 2.4, r: .6 }, seed, amp: .7, wave: 80 }), " preserveAspectRatio='none'");

// ---------- la tapita del joystick ----------
function tapa() {
  const pts = [], N = 21;
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, R = i % 2 ? 44 : 39;
    pts.push([50 + Math.cos(a) * R, 50 + Math.sin(a) * R]);
  }
  const fondo = `<path fill='${CINTA}' d='M${pts.map((q) => q.join(' ')).join('L')}Z'/>`;
  const borde = tinta([{ kind: 'poly', pts }], { nib: { angle: 30, w: 3.4, t: 2, r: .6 }, seed: 8, amp: .2 });
  const dentro = tinta([{ kind: 'curve', pts: [[50, 22], [26, 30], [20, 52], [30, 74], [52, 79], [74, 70], [80, 48], [70, 28], [46, 21]] }], { nib: { angle: 30, w: 3.2, t: 1.8, r: .5 }, seed: 9, amp: .3 });
  return uri(100, 100, fondo + borde + dentro);
}

// Círculo grande del joystick, abierto: se ve la mano y no tapa el mundo.
function aroJoystick() {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const a = -1.2 + i / 20 * Math.PI * 2 * 1.06;
    pts.push([100 + Math.cos(a) * 91, 100 + Math.sin(a) * 91]);
  }
  return uri(200, 200, tinta([{ kind: 'curve', pts }], { color: CINTA, nib: { angle: 30, w: 8, t: 4.2, r: 1.4 }, seed: 12, amp: .5 }));
}

// ---------- el marco del radar: cuatro pasadas que se cruzan en las esquinas ----------
function marco(seed) {
  const W = 300, H = 190;
  const s = [c([-3, 6], [90, 4], [200, 5.4], [303, 3.5]), c([296, -3], [294.6, 70], [296, 130], [295, 194]), c([304, 185], [200, 186.4], [90, 184.6], [-4, 186]), c([4.6, 194], [5.6, 120], [4, 60], [5, -4])];
  return uri(W, H, tinta(s, { nib: { angle: 28, w: 3.8, t: 2.1, r: .5 }, seed, amp: .6, wave: 50 }), " preserveAspectRatio='none'");
}

// ---------- para la leyenda del mapa: las mismas marcas que usa el plano ----------
const olas = uri(40, 26, tinta([c([2, 8], [11, 3], [20, 10], [29, 4], [38, 8]), c([4, 19], [13, 14], [22, 21], [30, 15], [37, 19])], { nib: { angle: 28, w: 3.4, t: 1.9, r: .5 }, seed: 23, amp: .2 }));
const matas = uri(40, 26, tinta([l(5, 7, 8, 12), l(8, 12, 11, 6), l(25, 5, 28, 10), l(28, 10, 31, 4), l(14, 18, 17, 23), l(17, 23, 20, 17), l(31, 18, 34, 23), l(34, 23, 37, 17)], { nib: { angle: 28, w: 2.8, t: 1.6, r: .4 }, seed: 24, amp: .1 }));

// ---------- el corte de cada pieza: filo y canto, pintados por partes con border-image ----------
// Una sola imagen por corte, sin clip-path ni seudoelementos: cada pieza cuesta una sola capa pintada y su fondo
// (--cara, flautas) sigue siendo un color que cambia con la lluvia. Las esquinas no se estiran; los bordes se
// estiran a lo largo, así que el grueso del filo no cambia con el tamaño de la pieza.
const LADO = 36, CORTE = 12; // imagen de 36 px en partes de 12
const FILO = 2.2, CANTO_D = 2.6, CANTO_A = 3.4;
const fuera = { a: 3, d: 6, b: 6, i: 3 }; // lo que la imagen sale de la pieza: arriba, derecha, abajo, izquierda
function corte(seed) {
  const r = rnd(seed), j = (a, b) => +(a + r() * (b - a)).toFixed(2);
  const I = fuera.i, A = fuera.a, D = LADO - fuera.d, B = LADO - fuera.b; // los bordes de la pieza dentro de la imagen
  // Cara: nunca se sale de la pieza. Cada borde queda plano en las esquinas y se inclina en su parte estirable.
  const ar = [j(.2, 1.5), j(.2, 1.5)], de = [j(.2, 1.5), j(.2, 1.5)], ab = [j(.2, 1.5), j(.2, 1.5)], iz = [j(.2, 1.5), j(.2, 1.5)];
  const ch = () => (r() < .5 ? j(.8, 2.2) : 0); // la esquina a veces queda mordida por el bisturí
  const [c1, c2, c3, c4] = [ch(), ch(), ch(), ch()];
  const cara = [
    [I + iz[0], A + ar[0] + c1], [I + iz[0] + c1, A + ar[0]], [CORTE, A + ar[0]], [LADO - CORTE, A + ar[1]],
    [D - de[0] - c2, A + ar[1]], [D - de[0], A + ar[1] + c2], [D - de[0], CORTE], [D - de[1], LADO - CORTE],
    [D - de[1], B - ab[0] - c3], [D - de[1] - c3, B - ab[0]], [LADO - CORTE, B - ab[0]], [CORTE, B - ab[1]],
    [I + iz[1] + c4, B - ab[1]], [I + iz[1], B - ab[1] - c4], [I + iz[1], LADO - CORTE], [I + iz[0], CORTE],
  ];
  // Hacia dónde crece cada punto: los de la derecha y los de abajo se llevan el canto.
  const crecer = (pts, dIz, dAr, dDe, dAb) => pts.map(([x, y]) => [x < LADO / 2 ? x - dIz : x + dDe, y < LADO / 2 ? y - dAr : y + dAb]);
  const canto = crecer(cara, 0, 0, CANTO_D, CANTO_A);
  const filo = crecer(canto, FILO, FILO, FILO, FILO);
  const d = (pts) => `M${pts.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join('L')}Z`;
  const cuerpo = `<path fill='${TINTA}' fill-rule='evenodd' d='${d(filo)}${d(canto)}'/><path fill='${CANTO}' fill-rule='evenodd' d='${d(canto)}${d(cara)}'/>`;
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${LADO}' height='${LADO}' viewBox='0 0 ${LADO} ${LADO}'>${cuerpo}</svg>`).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%27/g, "'")}")`;
}

// ---------- los extremos en zigzag de la cinta: solo el verbo principal de cada pantalla ----------
// Dientes, filo y sombra en una sola imagen que rodea la caja. El centro lo pinta el fondo de la pieza.
const ZIG = { i: 8, a: 2, d: 9, b: 4, cuerpo: 19, alto: 32, diente: 6 };
function zigzag(seed) {
  const r = rnd(seed), j = (a, b) => +(a + r() * (b - a)).toFixed(2);
  const { i: I, a: A, cuerpo, alto, diente: S } = ZIG, D = I + cuerpo, B = A + alto;
  const W = D + ZIG.d, H = B + ZIG.b;
  const y = (t) => +(A + alto * t).toFixed(2);
  // A la derecha empieza y acaba en valle; a la izquierda, en punta: como la cinta rasgada a mano.
  const de = [[D, A], [D + S - j(0, .8), y(.15)], [D, y(.31)], [D + S - j(0, .8), y(.47)], [D, y(.63)], [D + S - j(0, .8), y(.81)], [D, B]];
  const iz = [[I - S + j(0, .8), B], [I, y(.84)], [I - S + j(0, .8), y(.67)], [I, y(.5)], [I - S + j(0, .8), y(.33)], [I, y(.18)], [I - S + j(0, .8), A]];
  const d = `M${[...de, ...iz].map(([x, q]) => `${+x.toFixed(2)} ${q}`).join('L')}Z`;
  const borde = `fill='${TINTA}' stroke='${TINTA}' stroke-width='3' stroke-linejoin='round'`;
  return uri(W, H, `<path transform='translate(1 2.4)' ${borde} d='${d}'/><path ${borde} d='${d}'/><path fill='${CINTA}' d='${d}'/>`, ` width='${W}' height='${H}'`);
}

const css = `/* Generado por tools/fuente/marcas.mjs con el mismo marcador de la letra: no editar a mano. */
:root{
  --corte-a:${corte(11)};
  --corte-b:${corte(23)};
  --corte-c:${corte(37)};
  --corte-d:${corte(41)};
  --m-zigzag:${zigzag(7)};
  --m-rayado:${rayado()};
  --m-rayado-cinta:${rayado({ color: CINTA, seed: 9 })};
  --m-tres:${tresRayas(TINTA)};
  --m-tres-cinta:${tresRayas(CINTA, 8)};
  --m-circulo:${circulo(2)};
  --m-circulo-b:${circulo(5)};
  --m-circulo-tinta:${circulo(2, TINTA)};
  --m-tachon:${tachon(3)};
  --m-marco:${marco(5)};
  --m-regla:${reglaH(2)};
  --m-regla-v:${reglaV(4)};
  --m-tapa:${tapa()};
  --m-aro:${aroJoystick()};
  --m-olas:${olas};
  --m-matas:${matas};
}
`;
fs.writeFileSync(SALIDA, css);
console.log('marcas.css', Buffer.byteLength(css), 'bytes');
