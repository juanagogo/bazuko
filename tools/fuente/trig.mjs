// Seno y coseno propios, porque los de la máquina no dan el mismo último bit en todas.
// El seno de V8 sale del polinomio de fdlibm, y en aarch64 el compilador funde sus
// multiplicaciones y sumas en FMA mientras que en x86_64 no puede: el resultado cambia de una
// máquina a otra, y aquí un bit mueve un punto a la baldosa vecina y cambia la letra entera.
// Solo hay operaciones de doble precisión, que redondean igual en cualquier procesador.

const INV_PIO2 = 6.36619772367581382433e-01; // 2/pi
const PIO2_1 = 1.57079632673412561417e+00; // pi/2, primeros 33 bits
const PIO2_1T = 6.07710050650619224932e-11; // pi/2 - PIO2_1

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** Deja el ángulo como x = n·pi/2 + r, con r en [-pi/4, pi/4]. Sirve para los ángulos del generador, que no llegan a vuelta y media. */
const reducir = (x) => {
  const n = Math.round(x * INV_PIO2);
  return [n, (x - n * PIO2_1) - n * PIO2_1T];
};

const senoNucleo = (x) => {
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
};

const cosenoNucleo = (x) => {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
};

/** Seno de un ángulo en radianes. */
export function seno(x) {
  const [n, r] = reducir(x);
  switch (n & 3) {
    case 0: return senoNucleo(r);
    case 1: return cosenoNucleo(r);
    case 2: return -senoNucleo(r);
    default: return -cosenoNucleo(r);
  }
}

/** Coseno de un ángulo en radianes. */
export function coseno(x) {
  const [n, r] = reducir(x);
  switch (n & 3) {
    case 0: return cosenoNucleo(r);
    case 1: return -senoNucleo(r);
    case 2: return -cosenoNucleo(r);
    default: return senoNucleo(r);
  }
}
