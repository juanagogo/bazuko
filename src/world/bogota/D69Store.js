import * as THREE from 'three';
import { MeshKit, rgb, shade } from './MeshKit.js';
import { glowMaterial, followNight } from './StoreGlow.js';
import { addD69Display, addD69Vestibule, createD69Glass } from './D69Display.js';
import { addD69ShoppingCarts } from './D69ShoppingCarts.js';

// Un mercado de barrio inventado: su nombre y sus colores no se parecen a los de ninguna cadena.
const VERDE = '#1f5e3a';
export const D69_STORE = Object.freeze({ x0: 43, x1: 53, z0: 159, z1: 173, height: 5, name: 'Doña Inés' });

export function paintD69Store(map) {
  for (let z = 80; z <= 86; z++) for (let x = 22; x <= 26; x++) map[z][x] = 'storeD69';
}

// Paleta corta: muro claro y verde de la casa; el amarillo y el rojo son solo de los carteles y la fruta.
const C = {
  muro: rgb('#dcd4c2'), verde: rgb('#2b5a40'), verdeClaro: rgb('#3b6c50'), crema: rgb('#ece0c4'), marco: rgb('#b6bab8'),
  barro: rgb('#6f6556'), revoque: rgb('#bdb8ad'),
  techo: rgb('#777a77'), grava: rgb('#8f918a'), zocalo: rgb('#5c625f'), piso: rgb('#c9c2b2'), equipo: rgb('#c3c7c5'),
  oscuro: rgb('#2b2f31'), tanque: rgb('#3c4246'), vidrio: rgb('#3a3127'), cielo: rgb('#55524b'), calido: rgb('#8a6a3a'), claraboya: rgb('#5d8791'), luz: rgb('#fff1cf'),
  amarillo: rgb('#f2c230'), rojo: rgb('#c0392b'), naranja: rgb('#e58a1f'), fruta: rgb('#6f9a3a'), madera: rgb('#7a5a3a'), tabla: rgb('#b08a58')
};
// Letras de puntos 5×7 para los carteles de oferta: geometría, sin texturas nuevas.
const GLYPHS = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110', I: '01110,00100,00100,00100,00100,00100,01110',
  E: '11111,10000,10000,11110,10000,10000,11111', F: '11111,10000,10000,11110,10000,10000,10000',
  H: '10001,10001,10001,11111,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001', O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000', R: '11110,10001,10001,11110,10100,10010,10001', T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110', X: '10001,10001,01010,00100,01010,10001,10001', Y: '10001,10001,01010,00100,00100,00100,00100',
  0: '01110,10001,10011,10101,11001,10001,01110', 1: '00100,01100,00100,00100,00100,00100,01110', 2: '01110,10001,00001,00010,00100,01000,11111',
  5: '11111,10000,11110,00001,00001,10001,01110', 9: '01110,10001,10001,01111,00001,00010,01100', $: '00100,01111,10100,01110,00101,11110,00100',
  '.': '00000,00000,00000,00000,00000,01100,01100', ' ': '00000,00000,00000,00000,00000,00000,00000'
};
// El frente oriental va apenas remetido: lo que se ve queda donde uno choca, en el borde del lote (x = 53).
const PORCH = 52.55;
const BAY = 51.9, BAY_Z0 = 168.9, BAY_Z1 = 171.8; // nicho de los carritos, cerrado con su baranda
const FLOOR = .16;
const DOOR = 161.8, DISPLAY = 166.9;
const FRAME_X = PORCH + .02, FRAME_DEPTH = .126;
const EAST_OPENINGS = [DOOR, DISPLAY].map(z => ({ z, glass: PORCH + .08, back: BAY + .019, width: 2.95,
  bottom: FLOOR + .245, top: FLOOR + .245 + 2.65, lining: FRAME_X - FRAME_DEPTH / 2 }));
const ONLY = { px: 'nx py ny pz nz', nz: 'px nx py ny pz', py: 'px nx ny pz nz', ny: 'px nx py pz nz' };

/** Fachada comercial propia; el acceso principal mira al andén oriental. */
export function buildD69Store({ createSign }) {
  const group = new THREE.Group(); group.name = 'Tienda D69';
  const kit = new MeshKit({ alpha: true });
  kit.alphaValue = 0;
  const box = (w, h, d, x, y, z, color, options) => kit.box(x, y, z, w, h, d, color, options);
  // Lo que brilla de noche se dibuja dentro de `lit`: el alfa del vértice es cuánto.
  const lit = (amount, draw) => { kit.alphaValue = amount; draw(); kit.alphaValue = 0; };
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // La mugre lleva su propio azar: `random` reparte las góndolas y la fruta.
  let mugre = 4111;
  const entre = (a, b) => a + (mugre = (mugre * 16807) % 2147483647) / 2147483647 * (b - a);

  // `face` describe un plano de fachada: origen, hacia dónde avanza un texto y hacia dónde mira.
  const EAST = (z, x = PORCH + .08) => ({ at: (u, y, out = 0) => [x + out, y, z - u], normal: [1, 0, 0] });
  const NORTH = (x, z = 158.9) => ({ at: (u, y, out = 0) => [x - u, y, z - out], normal: [0, 0, -1] });
  const panel = (face, u0, y0, w, h, color, out = 0) => kit.quad(face.at(u0, y0, out), face.at(u0 + w, y0, out),
    face.at(u0 + w, y0 + h, out), face.at(u0, y0 + h, out), color, { normal: face.normal, facing: face.normal });
  const quad = (face, a, b, c, d, color, out) => kit.quad(face.at(...a, out), face.at(...b, out), face.at(...c, out), face.at(...d, out),
    color, { normal: face.normal, facing: face.normal });

  // Muros y antepecho van más oscuros abajo; la mugre termina en el mismo color de la pintura que tapa.
  const ZOCALO_MURO = .72;
  const muroEn = y => shade(C.muro, ZOCALO_MURO + (1 - ZOCALO_MURO) * y / 3.8);
  const verdeEn = y => shade(C.verde, .85 + .25 * (y - 3.8) / 1.3);
  const mezcla = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  // Reparte `n` posiciones sobre los tramos [u0, u1] de una cara, con algo de juego en cada una.
  const repartir = (n, tramos) => {
    const total = tramos.reduce((s, [a, b]) => s + b - a, 0);
    return Array.from({ length: n }, (_, i) => {
      let t = (i + entre(.15, .85)) / n * total;
      for (const [a, b] of tramos) { if (t <= b - a) return a + t; t -= b - a; }
      return tramos.at(-1)[1];
    });
  };
  // Salpique de barro sobre el zócalo: el borde de arriba sube y baja y se pierde en la pared.
  const PIE = .38;
  const salpique = (face, u0, u1, out = .01) => {
    const n = Math.max(2, Math.round((u1 - u0) / .25));
    const borde = () => [entre(.62, 1), mezcla(C.barro, muroEn(PIE), entre(.1, .45))];
    let left = borde();
    for (let i = 0; i < n; i++) {
      const right = borde(), a = u0 + (u1 - u0) * i / n, b = u0 + (u1 - u0) * (i + 1) / n;
      quad(face, [a, PIE], [b, PIE], [b, right[0]], [a, left[0]], [left[1], right[1], muroEn(right[0]), muroEn(left[0])], out);
      left = right;
    }
  };
  // Chorreón: baja desde arriba, se adelgaza y termina en el color de la pared.
  const chorreon = (face, u, top, largo, ancho, arriba, abajo, out) =>
    quad(face, [u + ancho * .28, top - largo], [u + ancho * .72, top - largo], [u + ancho, top], [u, top], [abajo, abajo, arriba, arriba], out);
  const desconche = (face, u, y, w, h, out = .01) => {
    const j = () => entre(-.3, .3);
    quad(face, [u + w * j(), y + h * j()], [u + w * (1 + j()), y + h * j()], [u + w * (1 + j()), y + h * (1 + j())], [u + w * j(), y + h * (1 + j())],
      [shade(C.revoque, .96), C.revoque, shade(C.revoque, 1.03), C.revoque], out);
  };
  const text = (face, value, u, y, size, color, out) => {
    let column = 0;
    for (const ch of value) {
      (GLYPHS[ch] ?? GLYPHS[' ']).split(',').forEach((row, r) => {
        // Cada tramo seguido de puntos es un solo rectángulo.
        for (let c = 0; c < 5; c++) {
          if (row[c] !== '1') continue;
          let end = c;
          while (row[end + 1] === '1') end++;
          panel(face, u + (column + c) * size, y + (6 - r) * size, (end - c + 1) * size, size, color, out);
          c = end;
        }
      });
      column += 6;
    }
  };
  // Pocos carteles y grandes: se leen desde el andén.
  const poster = (face, u, y, top, price, color = C.amarillo, w = 1.34) => lit(.9, () => {
    const h = w * .74, dot = w * .024, size = Math.min(w * .044, (w - .14) / (price.length * 6 - 1));
    panel(face, u, y, w, h, color, .022);
    panel(face, u + .04, y + h * .66, w - .08, h * .3, C.rojo, .03);
    text(face, top, u + w / 2 - (top.length * 6 - 1) * dot / 2, y + h * .81 - dot * 3.5, dot, C.crema, .038);
    text(face, price, u + w / 2 - (price.length * 6 - 1) * size / 2, y + h * .34 - size * 3.5, size, C.oscuro, .03);
  });
  // Ambas góndolas consumen el mismo reparto que antes, seguido por la fruta del andén.
  const stockRows = width => Array.from({ length: 3 }, () => {
    const row = [];
    for (let u = .14; u < width - .34;) {
      const w = .16 + random() * .22, h = .22 + random() * .2;
      row.push({ u, w, h, kind: Math.floor(random() * 5) });
      u += w + .03;
    }
    return row;
  });
  const shelves = (face, width) => lit(1.7, () => {
    const goods = [C.amarillo, C.rojo, C.crema, C.verdeClaro, C.naranja];
    stockRows(width).forEach((row, i) => {
      const y = .28 + i * .58;
      panel(face, .1, y - .05, width - .2, .04, shade(C.marco, .5), .012);
      for (const { u, w, h, kind } of row) panel(face, u, y, w, h, shade(goods[kind], .42), .012);
    });
  });
  // Vidrio oscuro de día, con algo de cielo arriba y un reflejo en diagonal; de noche se ve encendido y cálido.
  const glass = (face, u, y, w, h) => {
    lit(2.4, () => {
      const abajo = C.vidrio, arriba = C.cielo, ancho = Math.min(.5, w * .16), a = u + w * .18, b = u + w * .5;
      panel(face, u, y, w, h, [abajo, abajo, arriba, arriba]);
      quad(face, [a, y], [a + ancho, y], [b + ancho, y + h], [b, y + h], [shade(abajo, 1.25), shade(abajo, 1.25), shade(arriba, 1.25), shade(arriba, 1.25)], .004);
    });
    lit(3, () => { for (let t = .3; t + .9 < w; t += 1.3) panel(face, t, y + h - .3, .9, .05, C.calido, .012); });
  };

  // ---- Volumen: muros, franja verde con antepecho y techo hundido ----
  box(BAY - 43, 3.8, 14, (43 + BAY) / 2, 1.9, 166, C.muro, { bottom: ZOCALO_MURO });
  box(PORCH - BAY, 3.8, BAY_Z0 - 159, (BAY + PORCH) / 2, 1.9, (159 + BAY_Z0) / 2, C.muro, { bottom: ZOCALO_MURO, skip: 'px' });
  for (const [z, depth, x] of [[159.6, 1.2, PORCH], [168.7, .4, PORCH], [172.4, 1.2, BAY]]) {
    box(53 - x, 3.8, depth, (53 + x) / 2, 1.9, z, C.muro, { bottom: ZOCALO_MURO });
    box(.06, .42, depth, 53.02, .21, z, C.zocalo, { bottom: .75 });
  }
  // Pórticos verdes en las esquinas, sin ocupar la anchura del andén.
  for (const z of [159.3, 172.7]) box(.1, 3.8, .6, 53.04, 1.9, z, C.verde, { bottom: .7, top: 1.06 });
  box(10.04, .42, .05, 48, .21, 158.985, C.zocalo, { bottom: .75 });
  for (const [w, d, x, z] of [[.36, 14.12, 52.88, 166], [.36, 14.12, 43.12, 166], [9.4, .36, 48, 159.12], [9.4, .36, 48, 172.88]]) {
    box(w, 1.3, d, x, 4.45, z, C.verde, { bottom: .85, top: 1.1 });
    box(w + .04, .05, d + .04, x, 5.125, z, C.crema);
  }
  box(.02, .09, 14.12, 53.07, 3.87, 166, C.crema);
  box(10.12, .09, .02, 48, 3.87, 158.93, C.crema);
  box(9.4, .1, 13.4, 48, 4.5, 166, C.techo);

  // ---- Años encima, solo en lo que da al andén: barro al pie, chorreones bajo el remate y pintura saltada ----
  const muroNorte = NORTH(53, 159);
  salpique(muroNorte, 0, 2.15); salpique(muroNorte, 7.85, 10);
  for (const [z0, z1] of [[160.2, 159.6], [168.9, 168.5], [172.4, 171.8]]) salpique(EAST(z0, 53), 0, z0 - z1);
  for (const [face, n, tramos] of [[EAST(173.06, 53.06), 14, [[.08, 9.3], [12.85, 14]]], [NORTH(53.06, 158.94), 10, [[.08, 3.3], [6.85, 10]]]]) {
    for (const u of repartir(n, tramos)) {
      const largo = entre(.35, .9);
      chorreon(face, u, 5.1, largo, entre(.04, .12), shade(C.verde, entre(.62, .8)), verdeEn(5.1 - largo), .008);
    }
  }
  for (const u of repartir(8, [[.1, 2], [8, 9.85]])) {
    const largo = entre(.3, 1.1);
    chorreon(muroNorte, u, 3.8, largo, entre(.05, .16), shade(C.muro, .74), muroEn(3.8 - largo), .01);
  }
  for (const [face, u0, u1] of [[EAST(160.2, 53), .08, .3], [EAST(172.4, 53), .1, .32], [muroNorte, .3, 1.7], [muroNorte, 8.2, 9.5], [muroNorte, .2, 1.6]]) {
    desconche(face, entre(u0, u1), entre(1.2, 2.6), entre(.1, .26), entre(.07, .18));
  }

  // ---- Frente remetido: umbral, alero con lámparas que vuela sobre el andén ----
  lit(.2, () => {
    box(53.02 - PORCH, FLOOR, 11.6, (53.02 + PORCH) / 2, FLOOR / 2, 166, C.piso);
    box(PORCH - BAY, FLOOR, BAY_Z1 - BAY_Z0, (PORCH + BAY) / 2, FLOOR / 2, (BAY_Z0 + BAY_Z1) / 2, C.piso);
  });
  box(.06, FLOOR + .02, 11.6, 53, FLOOR / 2, 166, C.verdeClaro);
  // De noche alumbran la vitrina y el alero, no el muro del fondo.
  lit(.06, () => {
    // Sustituye el paño continuo por cuatro lados de cada vano, con el mismo degradado exterior.
    const face = EAST(BAY_Z0, PORCH + .011);
    const wall = (z0, z1, y0, y1) => {
      const tone = y => shade(C.muro, .78 * (.8 + .2 * y / 3.8));
      panel(face, BAY_Z0 - z1, y0, z1 - z0, y1 - y0, [tone(y0), tone(y0), tone(y1), tone(y1)]);
    };
    let end = 160.2;
    for (const { z, width, bottom, top } of EAST_OPENINGS) {
      const left = z - width / 2, right = z + width / 2;
      wall(end, left, 0, 3.8);
      wall(left, right, 0, bottom);
      wall(left, right, top, 3.8);
      end = right;
    }
    wall(end, BAY_Z0, 0, 3.8);
    box(.01, 3.8, BAY_Z1 - BAY_Z0, BAY + .006, 1.9, (BAY_Z0 + BAY_Z1) / 2, shade(C.muro, .78 * .8), { skip: ONLY.px, bottom: .8 });
  });
  lit(.1, () => {
    box(53.33 - PORCH, .08, 11.6, (53.33 + PORCH) / 2, 3.76, 166, shade(C.muro, .9));
    box(PORCH - BAY, .08, BAY_Z1 - BAY_Z0, (PORCH + BAY) / 2, 3.76, (BAY_Z0 + BAY_Z1) / 2, shade(C.muro, .9));
  });
  box(.03, .1, 11.6, 53.34, 3.76, 166, C.crema);
  lit(3, () => { for (const [x, z] of [[PORCH + .34, 161.8], [PORCH + .34, 166.9], [52.4, 170.35]]) box(.18, .03, 1.3, x, 3.71, z, C.luz); });

  // ---- Frente: puertas de vidrio y una vitrina con dos carteles de oferta ----
  for (const opening of EAST_OPENINGS) {
    const { z, width, bottom, top } = opening;
    const face = EAST(z + width / 2), door = z === DOOR;
    const frame = (3.2 - width) / 2;
    for (const side of [-1, 1]) {
      box(FRAME_DEPTH, top - bottom, frame, FRAME_X, (bottom + top) / 2, z + side * (width + frame) / 2, C.marco);
      box(FRAME_DEPTH, frame, 3.2, FRAME_X, (bottom + top) / 2 + side * (top - bottom + frame) / 2, z, C.marco);
    }
    if (door) addD69Vestibule(kit, opening, FLOOR);
    else addD69Display(kit, opening, stockRows(width));
    box(.06, 2.7, .055, PORCH + .1, 1.57 + FLOOR, z, C.marco);
    if (door) {
      for (const side of [-1, 1]) box(.08, .55, .035, PORCH + .14, 1.5 + FLOOR, z + side * .13, C.marco);
      lit(.9, () => { panel(face, .5, 2.2, 1.95, .34, C.verde, .022); text(face, 'ABIERTO', .5 + .975 - 41 * .0175, 2.26, .035, C.crema, .03); });
    }
  }
  poster(EAST(166.9 + 1.475), .1, 1.15, 'OFERTA', '$990');
  poster(EAST(166.9 + 1.475), 1.51, 1.15, 'HOY', '2X1', C.crema);
  poster(EAST(165.05, PORCH + .012), 0, 1.5, 'FRUTA', '$1990', C.crema, 1.4);
  // Marquesina sobre la entrada, con su luz por debajo: vuela sobre el andén, por encima de quien pasa.
  box(53.32 - PORCH, .16, 3.5, (53.32 + PORCH) / 2, 3.05, 161.8, C.verde);
  box(.03, .17, 3.5, 53.335, 3.05, 161.8, C.crema);
  lit(2.5, () => box(.6, .02, 2.9, PORCH + .4, 2.96, 161.8, C.luz, { skip: ONLY.ny }));
  for (const z of [160.3, 163.3]) kit.tube([[53.2, 3.13, z], [52.9, 3.72, z]], .02, 4, C.oscuro);

  // ---- Frente lateral, visible desde la esquina de la calle ----
  box(5.7, 2.9, .1, 48, 1.57, 158.96, C.marco);
  glass(NORTH(48 + 2.725), 0, .245, 5.45, 2.65);
  shelves(NORTH(48 + 2.725), 5.45);
  for (const x of [46.18, 49.82]) box(.06, 2.7, .05, x, 1.57, 158.885, C.marco);
  poster(NORTH(48 + 2.725), .25, 1.15, 'OFERTA', '$1500', C.amarillo, 1.5);
  poster(NORTH(48 + 2.725), 3.7, 1.15, 'HOY', '2X1', C.crema, 1.5);

  // ---- Pegado a la fachada, dentro de lo sólido: carritos en su nicho, fruta y bolardos ----
  addD69ShoppingCarts(kit, { x: 52.36, y: FLOOR, lastZ: 171.3 });
  for (const x of [52.03, 52.86]) {
    kit.tube([[x, FLOOR, BAY_Z1 - .08], [x, FLOOR + .98, BAY_Z1 - .08], [x, FLOOR + .98, BAY_Z0 + .08], [x, FLOOR, BAY_Z0 + .08]], .03, 5, C.verdeClaro);
  }
  kit.tube([[52.86, FLOOR + .52, BAY_Z1 - .08], [52.86, FLOOR + .52, BAY_Z0 + .08]], .022, 4, C.verdeClaro);
  box(.24, .56, 1.62, 52.74, .28 + FLOOR, 164.35, C.madera, { bottom: .7 });
  [[C.naranja, C.naranja], [C.rojo, C.fruta], [C.fruta, C.amarillo]].forEach((fruit, n) => {
    kit.matrix = new THREE.Matrix4().compose(new THREE.Vector3(52.74, FLOOR + .68, 163.83 + n * .52),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -.5)), new THREE.Vector3(1, 1, 1));
    kit.box(0, 0, 0, .3, .14, .48, C.tabla, { skip: 'py' });
    kit.box(0, -.04, 0, .26, .02, .44, shade(C.madera, .7));
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      const r = .055 + random() * .012;
      kit.ellipsoid([-.065 + i * .13, .03 + random() * .02, -.165 + j * .11], [r, r, r], shade(fruit[(i + j) % 2], .9 + random() * .2), { rows: 3, cols: 5 });
    }
    kit.matrix = null;
  });
  for (const z of [160.42, 163.18, 165.52, 168.3]) {
    kit.tube([[52.8, .1, z], [52.8, .72, z]], .09, 6, C.verde);
    kit.tube([[52.8, .72, z], [52.8, .82, z]], .09, 6, C.crema, { caps: false });
    kit.tube([[52.8, .82, z], [52.8, .9, z]], .08, 6, C.verde);
  }

  // ---- Techo: lo que más se ve desde la cámara alta ----
  const deck = 4.55;
  for (let z = 161.2; z < 172; z += 2.4) box(9.4, .03, .05, 48, deck + .015, z, shade(C.techo, .7), { skip: ONLY.py });
  box(2.4, .04, 2.1, 51.1, deck + .02, 168.6, C.grava, { skip: ONLY.py });
  box(2.8, .04, 1.7, 47.6, deck + .02, 171.4, shade(C.techo, .82), { skip: ONLY.py });
  // Equipos de aire, con su ventilador arriba y el ducto que entra al local
  for (const z of [169.7, 167.5]) {
    for (const side of [-1, 1]) box(1.3, .08, .1, 45.2, deck + .04, z + side * .3, C.oscuro);
    box(1.3, .46, .85, 45.2, deck + .31, z, C.equipo, { bottom: .8 });
    box(.01, .32, .7, 45.856, deck + .31, z, C.oscuro, { skip: ONLY.px });
    kit.disc([45.2, deck + .545, z], [0, 1, 0], .3, 8, C.oscuro, { edge: shade(C.oscuro, 1.6) });
  }
  box(2.5, .24, .3, 46.6, deck + .2, 168.6, C.marco, { bottom: .8 });
  box(.44, .4, .44, 47.9, deck + .2, 168.6, C.marco, { bottom: .8 });
  // Claraboya: de noche deja ver la luz del local desde arriba
  box(1.36, .16, 5.16, 49.2, deck + .08, 165, shade(C.equipo, .8));
  lit(2.2, () => {
    for (const side of [-1, 1]) {
      kit.quad([49.2 + side * .6, deck + .16, 162.5], [49.2 + side * .6, deck + .16, 167.5], [49.2, deck + .5, 167.5], [49.2, deck + .5, 162.5],
        shade(C.claraboya, side > 0 ? 1 : .8), { facing: [side, 1, 0] });
    }
    for (const z of [162.5, 167.5]) {
      kit.quad([48.6, deck + .16, z], [49.8, deck + .16, z], [49.2, deck + .5, z], [49.2, deck + .5, z], C.claraboya, { facing: [0, 0, z < 165 ? -1 : 1] });
    }
  });
  for (let z = 162.5; z <= 167.51; z += 1.25) for (const side of [-1, 1]) {
    kit.tube([[49.2 + side * .62, deck + .17, z], [49.2, deck + .52, z]], .022, 4, C.marco, { caps: false });
  }
  // Tanque de agua y su tubería
  box(1.4, .08, 1.4, 45.4, deck + .04, 161.4, C.oscuro);
  kit.tube([[45.4, deck + .08, 161.4], [45.4, deck + .5, 161.4]], .62, 10, C.tanque);
  kit.tube([[45.4, deck + .5, 161.4], [45.4, deck + .56, 161.4]], .5, 10, shade(C.tanque, 1.3));
  kit.tube([[46, deck + .05, 161.4], [47.6, deck + .05, 161.4], [47.6, deck + .05, 159.8]], .035, 5, C.marco);
  // Trampilla de acceso y dos respiraderos
  box(.9, .2, .9, 51.6, deck + .1, 171.4, C.equipo, { bottom: .8 });
  box(.96, .04, .96, 51.6, deck + .22, 171.4, C.marco);
  for (const [x, z] of [[51.2, 163.6], [47.3, 164.2]]) {
    kit.tube([[x, deck, z], [x, deck + .3, z]], .1, 6, C.marco);
    kit.tube([[x, deck + .3, z], [x, deck + .38, z]], .18, 6, C.equipo);
  }

  // El edificio opaco es una malla. Queda fuera de la fusión de la ciudad: su material cambia de noche.
  const building = new THREE.Mesh(kit.geometry(), glowMaterial(THREE.MeshStandardMaterial, { roughness: .85 }));
  building.name = 'Edificio D69';
  building.castShadow = building.receiveShadow = true;
  building.userData.noMerge = true;
  group.add(followNight(building), createD69Glass(EAST_OPENINGS));

  const sign = (x, z, yaw) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .95),
      new THREE.MeshBasicMaterial({ map: createSign({ title: 'DOÑA INÉS', sub: 'MERCADO DEL BARRIO', bg: VERDE, fg: '#fff3da', border: false, w: 512, h: 160 }) }));
    mesh.position.set(x, 4.4, z); mesh.rotation.y = yaw; group.add(mesh);
  };
  sign(53.13, 162, Math.PI / 2);
  sign(48, 158.87, Math.PI);
  return group;
}
