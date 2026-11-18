// src/world/bogota/busLiveries.js
// Colores de los buses de Bogotá, solo colores y formas: sin logos, nombres ni operadores. Cada librea dice de qué
// color es la carrocería y cómo se rotula; la textura de detalle (carDetail.js) la dibuja con ellas.

const STRIPES = [
  { main: '#1b4a8c', line: '#c4202a', upper: '#1b4a8c' },
  { main: '#2c8a3e', line: '#c4202a', upper: '#2c8a3e' },
  { main: '#c4202a', line: '#e6b422', upper: '#c4202a' },
  { main: '#e6b422', line: '#2c8a3e', upper: '#2c8a3e' },
  { main: '#2c8a3e', line: '#e6b422', upper: '#c4202a' },
  { main: '#1b4a8c', line: '#e6b422', upper: '#e6b422' },
];

/** Azul zonal, naranja complementario, vinotinto especial, verde alimentador, rojo troncal con frente amarillo y busetas viejas rayadas. */
export const LIVERIES = Object.freeze([
  { id: 'zonal', share: 40, body: '#1c56b0', roof: '#f1f3f4', old: false },
  { id: 'busetaVieja', share: 33, body: '#f4f2ea', roof: '#f4f2ea', old: true },
  { id: 'complementario', share: 12, body: '#ec7a18', roof: '#f1f3f4', old: false },
  { id: 'especial', share: 8, body: '#6e1630', roof: '#dfe3e6', old: false },
  { id: 'alimentador', share: 4, body: '#2f9a4a', roof: '#f1f3f4', old: false },
  { id: 'troncal', share: 3, body: '#c8202c', roof: '#e6e8ea', front: '#f0c419', old: false },
]);

export const STRIPE_VARIANTS = STRIPES.length;

/** Librea y variante de rayas según la semilla revuelta del vehículo: la suma de los pesos es 100. */
export function pickLivery(h) {
  let roll = (h >>> 11) % 100;
  for (const livery of LIVERIES) { if (roll < livery.share) return { livery, stripe: (h >>> 19) % STRIPES.length }; roll -= livery.share; }
  return { livery: LIVERIES[0], stripe: 0 };
}

export const liveryKey = (livery, stripe) => livery.old ? `${livery.id}${stripe}` : livery.id;

/** Dibuja la librea sobre la textura blanca de detalle, multiplicando para conservar sombras y juntas. */
export function paintLivery(ctx, { sx, sy, tx, ty, W, H, body }, livery, stripe) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const rect = (color, x0, x1, y0, y1) => { ctx.fillStyle = color; ctx.fillRect(x0, sy(y1), x1 - x0, sy(y0) - sy(y1)); };
  if (livery.old) {
    const s = STRIPES[stripe];
    ctx.fillStyle = livery.body; ctx.fillRect(0, 0, W, H);
    rect(s.main, 0, W, 1.02, 1.30);
    rect(s.line, 0, W, .93, .985);
    rect(s.line, 0, W, 1.335, 1.385);
    rect(s.upper, 0, W, 2.78, 2.9);
  } else {
    // El cuerpo hasta la línea del techo; el techo queda blanco o gris claro por la carta superior.
    rect(livery.body, 0, W, 0, 2.72);
    if (livery.front) rect(livery.front, sx(3.12), W, 0, 2.72);
    rect('#f4f4f2', 0, W, .5, .56);
    ctx.fillStyle = livery.roof;
    ctx.fillRect(0, 0, W, sy(2.72));
  }
  ctx.restore();
}
