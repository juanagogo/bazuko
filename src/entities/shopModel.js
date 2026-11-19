// src/entities/shopModel.js
// La caseta de La Esquinita en una sola geometría con color por vértice.
import * as THREE from 'three';
import { MeshKit, rgb, shade } from '../world/bogota/MeshKit.js';

// Paleta corta: crema y azul del aviso, rojo de acento; la mercancía pone el resto.
const C = {
  crema: rgb('#e8dfc8'), zocalo: rgb('#245a8c'), azul: rgb('#2f6fb0'), rojo: rgb('#c0392b'), amarillo: rgb('#e9bd3a'),
  blanco: rgb('#f0ece2'), concreto: rgb('#b3aea2'), zinc: rgb('#a3abad'), zincOscuro: rgb('#878f92'), metal: rgb('#737b80'),
  oscuro: rgb('#2c2f33'), madera: rgb('#7a5a3a'), tabla: rgb('#b08a58'), pan: rgb('#c98a3c'), huevo: rgb('#ead6b8'),
  carton: rgb('#b6a586'), naranja: rgb('#e58a1f'), verde: rgb('#6f9a3a'), platano: rgb('#d9b521'), ladrillo: rgb('#a5553a'),
  frio: rgb('#d6eef5'), bombillo: rgb('#ffc861'), tubo: rgb('#fff3d6'), vidrio: rgb('#3b2a1c')
};
// La lona del toldo, del mismo tono gastado que las de la calle.
const L = { pizarra: rgb('#406382'), hueso: rgb('#d5cebb'), sol: rgb('#cdc9bd'), mugre: rgb('#5a5246') };
// Canastas, silla y mesa de afuera: plástico viejo y empolvado. La silla y la mesa quedan junto a la luz de la tienda,
// que de día y de noche las aclara: van más oscuras para que se vean de su color y no blancas ni rojo vivo.
const Q = { rojo: rgb('#94372b'), amarillo: rgb('#b39236'), polvo: rgb('#9a9180'), silla: rgb('#d8d3c5', .78), mugre: rgb('#7d796f'), mesa: rgb('#8f3b30', .74) };
// Muros, mostrador, nevera y fruta, con el uso encima.
const G = {
  crema: rgb('#dcd2b9'), zocalo: rgb('#35526d'), mostrador: rgb('#d9d1bf'), franja: rgb('#9a3e32'), barro: rgb('#6c604f'), borde: rgb('#a68c45'),
  nevera: rgb('#d5d0c3', .82), pesa: rgb('#4d6378'), naranja: rgb('#c27b2e'), rojo: rgb('#9b3c2e'), verde: rgb('#6a8838'), platano: rgb('#c6a63e')
};
const SHEET = {
  painted: rgb('#d4c6aa'), dust: rgb('#8e7e64'), patched: rgb('#b6ad99'),
  blue: rgb('#41617a'), deepBlue: rgb('#283f54'), rail: rgb('#805146'), trim: rgb('#a1957d')
};
// La mercancía va en dos tonos: el del empaque abajo y el de la tapa o la etiqueta arriba.
const MERCANCIA = [['#b8963e', '#7d6a45'], ['#97402f', '#b5a68a'], ['#cfc4a8', '#7a6648'], ['#3f5f80', '#a9a493'], ['#c9c4b6', '#5f6e75'], ['#5f7a3c', '#9c8f66']]
  .map(par => par.map(c => rgb(c)));
const mezcla = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ruido = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const FLOOR = .24;     // piso de la caseta: un escalón sobre el andén
const SIDEWALK = .12;  // lo que queda afuera se apoya en el andén
const FRONT = 'px nx py ny nz'; // caras que se saltan cuando solo se ve el frente

/**
 * Geometría de la tienda en coordenadas del grupo: el frente mira a +Z.
 * El sólido del juego va de x −1,2 a 1,2 y de z −0,75 a 0,75: lo que se apoya en el andén queda dentro.
 */
export function buildShopGeometry() {
  const kit = new MeshKit({ alpha: true });
  kit.alphaValue = 0;
  const box = (x, y, z, sx, sy, sz, color, options) => kit.box(x, y, z, sx, sy, sz, color, options);
  // Lo que brilla de noche se dibuja dentro de `lit`: el alfa del vértice es cuánto.
  const lit = (amount, draw) => { kit.alphaValue = amount; draw(); kit.alphaValue = 0; };
  const placed = (matrix, draw) => { kit.matrix = matrix; draw(); kit.matrix = null; };
  const at = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = list => list[Math.floor(random() * list.length)];
  const dosTonos = (desde, [a, b], y0, y1) => {
    for (let i = desde; i < kit.vertexCount; i++) {
      const t = Math.min(1, Math.max(0, ((kit.positions[i * 3 + 1] - y0) / (y1 - y0) - .5) / .4));
      kit.colors.splice(i * 3, 3, ...mezcla(a, b, t));
    }
  };

  // ---- Caseta: escalón, muros con zócalo, techo de zinc y persiana enrollada ----
  box(0, FLOOR / 2, -.68, 2.4, FLOOR, 1.64, C.concreto, { bottom: .8 });
  box(0, FLOOR - .03, .135, 2.4, .061, .03, G.borde, { bottom: .8 });
  const wall = (x, z, sx, sz, skip = '') => {
    box(x, FLOOR + .36, z, sx + .02, .72, sz + .02, G.zocalo, { bottom: .6, skip });
    box(x, FLOOR + 1.56, z, sx, 1.68, sz, G.crema, { top: .86, skip });
  };
  wall(0, -1.39, 2.4, .12);
  for (const side of [-1, 1]) {
    wall(side * 1.15, -.7, .1, 1.38, side < 0 ? 'nx' : 'px');
    const facing = [side, 0, 0], heights = [.96, 1.12, 1.65, 2.64];
    const tone = (col, row) => {
      const n = ruido(col + side * 31, row + 12);
      const base = col < 2 ? mezcla(SHEET.painted, SHEET.patched, .3) : SHEET.painted;
      const damp = [.36, .19, .045, .16][row];
      return shade(mezcla(base, SHEET.dust, damp * (.63 + n * .66)), .91 + .11 * n);
    };
    // Los costados se leen primero al llegar por Calle 9: pintura lavada, juntas y chapa acanalada abajo.
    const skin = (a, b, y, top, x0, x1, color) => kit.quad(
      [side * x0, y, a], [side * x1, y, b], [side * x1, top, b], [side * x0, top, a], color, { facing });
    for (let col = 0; col < 4; col++) {
      const a = -1.39 + col * .345, b = a + .345;
      for (let row = 0; row < heights.length - 1; row++) {
        skin(a, b, heights[row], heights[row + 1], 1.2, 1.2,
          [tone(col, row), tone(col + 1, row), tone(col + 1, row + 1), tone(col, row + 1)]);
      }
    }
    // El empalme pasa detrás del cartel. Bajo un remache se escurre óxido hasta el zócalo.
    const seam = side > 0 ? -.91 : -.53;
    skin(seam - .009, seam, .985, 2.64, 1.201, 1.203, shade(SHEET.patched, .83));
    skin(seam, seam + .012, .985, 2.64, 1.203, 1.201, shade(SHEET.painted, 1.09));
    const stain = mezcla(SHEET.patched, SHEET.rail, .46), fade = shade(SHEET.painted, .91);
    kit.quad([side * 1.2007, 1.02, seam - .005], [side * 1.2007, 1.02, seam + .02],
      [side * 1.2007, 1.49, seam + .014], [side * 1.2007, 1.49, seam - .023], [fade, fade, stain, stain], { facing });
    const rivet = (y, z, x) => kit.quad([side * x, y, z - .015], [side * x, y + .015, z],
      [side * x, y, z + .015], [side * x, y - .015, z], SHEET.trim, { facing });
    rivet(1.49, seam - .003, 1.205);
    for (let i = 0; i < 8; i++) {
      const a = -1.4 + i * .175, b = a + .175;
      const blue = shade(SHEET.blue, .86 + ruido(i + side, 33) * .19);
      for (const [l, r, x0, x1, power] of [[a, a + .068, 1.2, 1.217, 1.12], [a + .068, b, 1.217, 1.2, .91]]) {
        const color = shade(blue, power);
        skin(l, r, FLOOR, .962, x0, x1, [shade(color, .74), shade(color, .65), color, color]);
      }
    }
    const inside = side > 0 ? 'nx' : 'px';
    box(side * 1.203, .964, -.7, .031, .07, 1.4, SHEET.deepBlue, { skip: `${inside} pz nz ny` });
    for (const z of [-1.33, -.035]) box(side * 1.201, 1.453, z, .027, 2.41, .058, SHEET.rail, { bottom: .69, skip: `${inside} py ny nz` });
    for (const z of [-1.34, -.052]) for (const y of [.56, 2.34]) rivet(y, z, 1.217);
  }
  lit(.42, () => box(0, FLOOR + 1.5, -1.32, 2.2, 1.7, .01, shade(C.crema, .92), { skip: FRONT }));
  box(0, FLOOR + 2.45, -.68, 2.62, .1, 1.66, C.concreto);
  // Traslapos y nervios de las chapas, con goterón al borde que da a la calle.
  const roof = { l: -1.3575, r: 1.3575, y: FLOOR + 2.54, back: -1.53, front: .17 };
  for (let i = 0; i < 8; i++) {
    const a = roof.l + (roof.r - roof.l) * i / 8, b = roof.l + (roof.r - roof.l) * (i + 1) / 8;
    const paint = shade(i % 2 ? C.zinc : C.zincOscuro, .92 + ruido(i, 8) * .21);
    for (const [l, r, low, high, tone] of [[a, a + .024, 0, .022, 1.13], [a + .024, a + .053, .022, 0, .89], [a + .053, b, 0, 0, 1]]) {
      kit.quad([l, roof.y + low, roof.back], [r, roof.y + high, roof.back],
        [r, roof.y + high, roof.front], [l, roof.y + low, roof.front], shade(paint, tone), { facing: [0, 1, 0] });
    }
  }
  box(0, roof.y - .021, -.68, roof.r - roof.l, .042, 1.7, C.zincOscuro, { skip: 'py' });
  box(0, FLOOR + 2.461, .147, 2.66, .076, .075, SHEET.deepBlue, { bottom: .61, skip: 'nx px nz ny' });
  box(-.78, FLOOR + 2.59, -1.08, .24, .1, .12, C.ladrillo, { rotation: [0, .5, 0] });
  box(.86, FLOOR + 2.59, -.92, .24, .1, .12, C.ladrillo, { rotation: [0, -.3, 0] });
  box(.3, FLOOR + 2.58, -1.3, .5, .08, .1, C.madera, { rotation: [0, .12, 0] });
  box(0, FLOOR + 2.27, .0, 2.22, .26, .2, C.metal);
  for (let i = 0; i < 4; i++) box(0, FLOOR + 2.17 + i * .065, .0, 2.23, .014, .21, shade(C.metal, .7));
  for (const side of [-1, 1]) box(side * 1.14, FLOOR + 1.07, .0, .07, 2.14, .07, shade(C.metal, .85));
  lit(3, () => box(-.3, FLOOR + 2.37, -.7, 1.3, .04, .07, C.tubo));

  // ---- Estantería del fondo: frascos, tarros, cajas, bolsas y rollos ----
  lit(.5, () => {
    const colors = MERCANCIA;
    for (const y of [FLOOR + 1.08, FLOOR + 1.52, FLOOR + 1.94]) {
      box(0, y, -1.2, 2.18, .035, .26, C.tabla);
      const top = y + .018;
      for (let x = -1; x < .98;) {
        const kind = Math.floor(random() * 5), color = pick(colors), desde = kit.vertexCount;
        if (kind === 0) { // botella
          kit.tube([[x + .04, top, -1.18], [x + .04, top + .2, -1.18]], .042, 6, color[0]);
          kit.tube([[x + .04, top + .2, -1.18], [x + .04, top + .28, -1.18]], .018, 5, color[1]);
          dosTonos(desde, color, top, top + .28);
          x += .11;
        } else if (kind === 1) { // tarros apilados
          for (let k = 0; k < 2; k++) {
            const par = k ? pick(colors) : color, tarro = kit.vertexCount;
            kit.tube([[x + .05, top + k * .125, -1.18], [x + .05, top + k * .125 + .115, -1.18]], .05, 6, par[0]);
            dosTonos(tarro, par, top + k * .125, top + k * .125 + .115);
          }
          x += .13;
        } else if (kind === 2) { // caja
          const w = .1 + random() * .08, h = .13 + random() * .12;
          box(x + w / 2, top + h / 2, -1.17, w, h, .16, color[0]);
          dosTonos(desde, color, top, top + h);
          x += w + .025;
        } else if (kind === 3) { // bolsa
          kit.frustum(x + .07, -1.17, top, top + .2, .1, .08, .14, .03, color[0]);
          dosTonos(desde, color, top, top + .2);
          x += .16;
        } else { // rollos
          for (const [dx, dy] of [[0, 0], [.105, 0], [.052, .09]]) kit.tube([[x + .05 + dx, top + .05 + dy, -1.26], [x + .05 + dx, top + .05 + dy, -1.1]], .05, 6, MERCANCIA[4][0]);
          x += .23;
        }
      }
    }
  });

  // ---- Mostrador con la franja roja; encima: vitrina del pan, pesa y cubetas de huevos ----
  box(-.34, FLOOR + .475, -.2, 1.52, .95, .42, G.mostrador, { bottom: .8, skip: 'pz' });
  // El frente, en seis tramos: barro salpicado abajo, mugre donde se apoyan las manos.
  const FILAS = [0, .07, .16, .45, .7, .95];
  const frente = (j, r) => {
    const n = ruido(j, 11 + r);
    if (r === 0) return mezcla(G.mostrador, G.barro, .55 + .3 * n);
    if (r === 1) return mezcla(G.mostrador, G.barro, .15 + .5 * n * n);
    if (r === 2) return mezcla(G.mostrador, G.barro, .12 * n);
    if (r === 3) return shade(G.mostrador, .96 + .05 * n);
    return mezcla(G.mostrador, Q.mugre, (r === 4 ? .14 : .28) + .14 * n);
  };
  for (let j = 0; j < 6; j++) for (let r = 0; r + 1 < FILAS.length; r++) {
    const xa = -1.1 + j * 1.52 / 6, xb = xa + 1.52 / 6, ya = FLOOR + FILAS[r], yb = FLOOR + FILAS[r + 1];
    kit.quad([xa, ya, .01], [xb, ya, .01], [xb, yb, .01], [xa, yb, .01], [frente(j, r), frente(j + 1, r), frente(j + 1, r + 1), frente(j, r + 1)], { facing: [0, 0, 1] });
  }
  box(-.34, FLOOR + .78, -.2, 1.54, .16, .44, G.franja, { bottom: .82 });
  box(-.34, FLOOR + .975, -.2, 1.58, .05, .5, mezcla(G.crema, Q.mugre, .22));
  const counter = FLOOR + 1;
  lit(.35, () => {
    box(-.74, counter + .015, -.2, .62, .03, .34, C.tabla);
    for (const [x, z, turn] of [[-.92, -.26, .3], [-.74, -.14, -.2], [-.56, -.25, .5], [-.84, -.12, 1.2], [-.62, -.13, -.6]]) {
      placed(at(x, counter + .075, z, 0, turn, 0), () => kit.ellipsoid([0, 0, 0], [.085, .05, .05], v => shade(C.pan, .75 + v * .4), { rows: 3, cols: 5 }));
    }
  });
  for (const x of [-1.04, -.44]) for (const z of [-.36, -.04]) box(x, counter + .16, z, .018, .32, .018, C.metal);
  for (const z of [-.36, -.04]) box(-.74, counter + .32, z, .62, .018, .018, C.metal);
  for (const x of [-1.04, -.44]) box(x, counter + .32, -.2, .018, .018, .34, C.metal);
  // Pesa de plato
  box(-.16, counter + .04, -.2, .22, .08, .2, G.pesa);
  box(-.16, counter + .1, -.2, .04, .05, .04, C.metal);
  kit.disc([-.16, counter + .13, -.2], [0, 1, 0], .13, 8, C.zinc, { edge: C.zincOscuro });
  box(-.16, counter + .17, -.31, .14, .18, .03, C.blanco);
  box(-.16, counter + .19, -.292, .012, .1, .008, G.rojo, { rotation: [0, 0, .5] });
  // Cubetas de huevos
  for (let k = 0; k < 4; k++) box(.2, counter + .02 + k * .04, -.2, .27, .035, .27, shade(C.carton, k % 2 ? 1 : .88), { rotation: [0, k * .07, 0] });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    kit.ellipsoid([.2 + (i - 1) * .08, counter + .18, -.2 + (j - 1) * .08], [.03, .04, .03], C.huevo, { rows: 2, cols: 4 });
  }

  // ---- Nevera de bebidas: el frente es lo que más brilla de noche ----
  box(.79, FLOOR + .95, -.3, .58, 1.9, .56, G.nevera, { bottom: .7 });
  lit(.85, () => box(.79, FLOOR + .86, -.016, .48, 1.4, .01, C.frio, { skip: FRONT }));
  lit(.9, () => {
    const drinks = [C.rojo, C.naranja, C.vidrio, C.verde, C.amarillo];
    for (let row = 0; row < 4; row++) for (let i = 0; i < 5; i++) {
      const x = .61 + i * .09, y = FLOOR + .3 + row * .34;
      box(x, y, -.008, .06, .19, .01, drinks[(i + row) % drinks.length], { skip: FRONT });
      box(x, y + .12, -.008, .028, .05, .01, C.blanco, { skip: FRONT });
    }
    box(.79, FLOOR + 1.73, -.012, .5, .24, .012, C.rojo, { skip: FRONT });
    box(.79, FLOOR + 1.73, -.006, .3, .07, .012, C.crema, { skip: FRONT });
  });
  for (let row = 0; row < 4; row++) box(.79, FLOOR + .19 + row * .34, -.006, .48, .018, .014, C.metal, { skip: FRONT });
  for (const x of [.535, 1.045]) box(x, FLOOR + .86, -.005, .03, 1.44, .03, C.metal);
  box(.585, FLOOR + .9, .012, .022, .5, .03, C.oscuro);

  // ---- Fruta al frente, en cajas inclinadas hacia el andén ----
  box(-.2, FLOOR + .2, .15, 1.24, .4, .26, C.madera, { bottom: .7 });
  [[G.naranja, G.naranja], [G.rojo, G.verde], [G.verde, G.platano]].forEach((fruit, n) => {
    placed(at(-.6 + n * .4, FLOOR + .52, .2, .55, 0, 0), () => {
      box(0, 0, 0, .38, .14, .34, C.tabla, { skip: 'py' });
      box(0, -.04, 0, .34, .02, .3, shade(C.madera, .7));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const r = .05 + random() * .012;
        kit.ellipsoid([-.11 + i * .11, .03 + random() * .02, -.1 + j * .1], [r, r, r], shade(fruit[(i + j) % 2], .9 + random() * .2), { rows: 3, cols: 5 });
      }
    });
  });

  // ---- Lo que cuelga del frente: tiras de paquetes y un racimo de plátano ----
  const hang = FLOOR + 2.14;
  [[-.98, MERCANCIA[0]], [-.74, MERCANCIA[1]], [.34, MERCANCIA[0]]].forEach(([x, par], n) => {
    box(x, hang - .38, .075, .012, .76, .006, MERCANCIA[4][0]);
    for (let k = 0; k < 5; k++) {
      const desde = kit.vertexCount, y = hang - .09 - k * .15;
      const tono = shade(par[0], k % 2 ? .8 : .7);
      box(x, y, .085, .13, .13, .02, tono, { rotation: [0, 0, (k + n) % 2 ? .22 : -.22] });
      dosTonos(desde, [tono, mezcla(tono, par[1], .5)], y - .08, y + .08);
    }
  });
  kit.tube([[.04, hang, .1], [.04, hang - .5, .1]], .016, 4, G.verde);
  [[hang - .16, 6, .8], [hang - .3, 6, 1], [hang - .43, 5, 1.12]].forEach(([y, count, ripe], tier) => {
    for (let i = 0; i < count; i++) {
      const a = (i + tier * .5) / count * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
      kit.tube([[.04 + cx * .03, y, .1 + cz * .03], [.04 + cx * .1, y - .07, .1 + cz * .1], [.04 + cx * .085, y - .19, .1 + cz * .085]],
        .026, 4, shade(G.platano, ripe * (.92 + (i % 2) * .12)));
    }
  });

  // ---- Toldo de lona vieja, un poco caído, con cenefa raída y tira de bombillos ----
  const drop = .38, length = .98, tilt = .025, ROWS = 6;
  const MANCHAS = [[1, 2], [3, 1], [6, 3], [7, 2]];
  // Color de la lona en la raya i, columna k (0 a 2) y fila r (0 junto a la pared, ROWS en el borde).
  const lonaEn = (i, k, r) => {
    let c = mezcla(i % 2 ? L.hueso : L.pizarra, L.sol, .05 + .32 * (1 - r / ROWS) ** 1.4);
    if (i === 4 && r >= 2 && r <= 4) c = mezcla(c, L.sol, k === 1 && r === 3 ? .42 : .24);
    if (r === 0) c = mezcla(c, L.mugre, .28 + .16 * ruido(i, k));
    else if (k === 1 && r <= 2 && (i === 1 || i === 2 || i === 5)) c = mezcla(c, L.mugre, .24 / r);
    for (const [si, sr] of MANCHAS) {
      if (i !== si || r < sr) continue;
      c = shade(c, k === 1 ? Math.min(1, .62 + .12 * (r - sr)) : r === sr ? .84 : 1);
    }
    if (r === ROWS) c = mezcla(c, L.mugre, .22);
    return shade(c, .94 + .1 * ruido(i * 7 + k, r));
  };
  placed(at(0, FLOOR + 2.47, .1, drop, 0, tilt), () => {
    for (let i = 0; i < 8; i++) {
      const x0 = -1.36 + i * .34, skip = 'py' + (i < 7 ? ' px' : '') + (i > 0 ? ' nx' : '');
      box(x0 + .17, 0, length / 2, .34, .03, length, mezcla(i % 2 ? L.hueso : L.pizarra, L.mugre, .2), { bottom: .8, skip });
      for (let k = 0; k < 2; k++) for (let r = 0; r < ROWS; r++) {
        const xa = x0 + k * .17, xb = xa + .17, za = r / ROWS * length, zb = (r + 1) / ROWS * length;
        kit.quad([xa, .015, za], [xb, .015, za], [xb, .015, zb], [xa, .015, zb],
          [lonaEn(i, k, r), lonaEn(i, k + 1, r), lonaEn(i, k + 1, r + 1), lonaEn(i, k, r + 1)], { facing: [0, 1, 0] });
      }
    }
    lit(.55, () => box(0, -.018, length / 2, 2.7, .004, length - .04, shade(C.bombillo, .7), { skip: 'px nx py pz nz' }));
    for (const side of [-1, 1]) kit.tube([[side * 1.36, -.02, 0], [side * 1.36, -.02, length]], .016, 4, C.oscuro);
    kit.tube([[-1.36, -.02, length], [1.36, -.02, length]], .016, 4, C.oscuro);
  });
  const edgeY = FLOOR + 2.47 - Math.sin(drop) * length, edgeZ = .1 + Math.cos(drop) * length;
  placed(at(0, edgeY, edgeZ, 0, 0, tilt), () => {
    const corner = j => -.1 + (ruido(j, 3) - .5) * .026;
    for (let i = 0; i < 8; i++) {
      const x0 = -1.36 + i * .34, x1 = x0 + .34, color = mezcla(i % 2 ? L.pizarra : L.hueso, L.sol, .1);
      const y0 = corner(i), y1 = corner(i + 1), tipX = (x0 + x1) / 2 + (ruido(i, 6) - .5) * .04;
      const tipY = i === 5 ? -.15 : -.2 + (ruido(i, 5) - .5) * .045;
      for (const facing of [[0, 0, 1], [0, 0, -1]]) {
        const k = facing[2] > 0 ? 1 : .7, top = shade(color, k), hem = shade(mezcla(color, L.mugre, .3), k);
        const tip = shade(mezcla(color, L.mugre, .42), k);
        kit.quad([x0, y0, 0], [x1, y1, 0], [x1, .01, 0], [x0, .01, 0], [hem, hem, top, top], { facing });
        kit.quad([x0, y0, 0], [tipX, tipY, 0], [tipX, tipY, 0], [x1, y1, 0], [hem, tip, tip, hem], { normal: facing, facing });
      }
    }
  });
  for (const side of [-1, 1]) kit.tube([[side * 1.3, FLOOR + 2.0, .04], [side * 1.36, edgeY - .03, edgeZ - .02]], .014, 4, C.oscuro);
  const wire = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    wire.push([-1.36 + t * 2.72, edgeY + .02 - .16 * (1 - (2 * t - 1) ** 2), edgeZ + .04]);
  }
  kit.tube(wire, .007, 3, C.oscuro, { caps: false });
  lit(1.7, () => { for (const p of wire.slice(1, -1)) kit.ellipsoid([p[0], p[1] - .05, p[2]], [.05, .06, .05], C.bombillo, { rows: 2, cols: 4 }); });
  // Respaldo del aviso sobre el techo
  box(0, FLOOR + 2.9, -.06, 2.66, .7, .03, SHEET.deepBlue);
  for (const y of [FLOOR + 2.565, FLOOR + 3.232]) box(0, y, -.043, 2.66, .035, .028, SHEET.trim, { skip: FRONT });
  for (const x of [-1, 1]) kit.tube([[x, FLOOR + 2.56, -.5], [x, FLOOR + 3.05, -.08]], .016, 4, C.oscuro);

  // ---- En las esquinas del frente, dentro de lo sólido: canastas de gaseosa a un lado; silla y mesita al otro ----
  // Las caras que se ven van caladas, seis por cuatro huecos; abajo, polvo del andén.
  const crate = (x, y, z, color, turn, { caladas, tapa, polvo }) => placed(at(x, y, z, 0, turn, 0), () => {
    const H = .24, hueco = mezcla(shade(color, .3), C.vidrio, .45);
    const tono = (c, h) => shade(mezcla(c, Q.polvo, polvo * Math.max(0, 1 - h / .16)), .88 + .12 * Math.min(1, h / .12));
    for (const [cara, nx, nz, half, ancho] of [['pz', 0, 1, .22, .34], ['nz', 0, -1, .22, .34], ['px', 1, 0, .17, .44], ['nx', -1, 0, .17, .44]]) {
      const p = (s, h, off) => [nx * (half + off) - nz * s, h, nz * (half + off) + nx * s];
      const plano = (s0, s1, h0, h1, off, c) => kit.quad(p(s0, h0, off), p(s1, h0, off), p(s1, h1, off), p(s0, h1, off),
        [tono(c, h0), tono(c, h0), tono(c, h1), tono(c, h1)], { facing: [nx, 0, nz] });
      plano(-ancho / 2, ancho / 2, 0, H, 0, color);
      if (!caladas.includes(cara)) continue;
      const m = .025, b = .012, gap = .012, h = (H - .065 - 3 * gap) / 4, w = (ancho - 2 * m - 5 * b) / 6;
      for (let r = 0; r < 4; r++) plano(-ancho / 2 + m, ancho / 2 - m, .03 + r * (h + gap), .03 + r * (h + gap) + h, .003, hueco);
      for (let j = 1; j < 6; j++) {
        const s = -ancho / 2 + m + j * w + (j - 1) * b;
        plano(s, s + b, .03, H - .035, .006, color);
      }
    }
    if (tapa) {
      kit.quad([-.17, H, .22], [.17, H, .22], [.17, H, -.22], [-.17, H, -.22], color, { facing: [0, 1, 0] });
      kit.quad([-.15, H + .002, .2], [.15, H + .002, .2], [.15, H + .002, -.2], [-.15, H + .002, -.2], hueco, { facing: [0, 1, 0] });
    }
  });
  [Q.rojo, Q.rojo, Q.amarillo, Q.rojo].forEach((color, k) => crate(-1.01, SIDEWALK + k * .245, .4, shade(color, .93 + .12 * ruido(k, 1)),
    k % 2 ? .03 : -.03, { caladas: k > 1 ? 'pz nx px' : 'pz nx', tapa: k === 3, polvo: k ? .16 : .42 }));
  [Q.amarillo, Q.rojo].forEach((color, k) => crate(-.64, SIDEWALK + k * .245, .5, shade(color, .93 + .12 * ruido(k, 2)),
    k % 2 ? -.04 : .03, { caladas: 'pz px', tapa: k === 1, polvo: k ? .16 : .42 }));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    const x = -1.1 + i * .09, z = .265 + j * .09, y = SIDEWALK + 4 * .245;
    kit.tube([[x, y - .04, z], [x, y + .09, z]], .026, 5, C.vidrio);
    box(x, y + .1, z, .03, .02, .03, C.zinc);
  }
  // Silla plástica de lado, con el espaldar contra la esquina
  const seat = SIDEWALK + .42;
  placed(at(.94, 0, .5, 0, -Math.PI / 2, 0), () => {
    for (const dx of [-.17, .17]) for (const dz of [-.17, .17]) box(dx, SIDEWALK + .21, dz, .035, .42, .035, Q.silla, { bottom: .62 });
    box(0, seat, 0, .42, .035, .42, Q.silla, { skip: 'py' });
    // Asiento con la mugre gris donde uno se sienta.
    const sucio = (i, j) => i === 1 && j === 1 ? mezcla(Q.silla, Q.mugre, .55) : i === 1 || j === 1 ? mezcla(Q.silla, Q.mugre, .22) : shade(Q.silla, .96 + .06 * ruido(i, j));
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const xa = -.21 + i * .21, za = -.21 + j * .21, y = seat + .0175;
      kit.quad([xa, y, za], [xa + .21, y, za], [xa + .21, y, za + .21], [xa, y, za + .21],
        [sucio(i, j), sucio(i + 1, j), sucio(i + 1, j + 1), sucio(i, j + 1)], { facing: [0, 1, 0] });
    }
    box(0, seat + .27, -.21, .42, .46, .035, Q.silla, { rotation: [-.1, 0, 0], bottom: .9 });
    for (const dx of [-.2, .2]) {
      box(dx, seat + .2, -.02, .035, .035, .4, mezcla(Q.silla, Q.mugre, .15));
      box(dx, seat + .1, .16, .035, .2, .035, Q.silla, { bottom: .9 });
    }
  });
  // Mesita con el termo del tinto
  for (const dx of [-.14, .14]) for (const dz of [-.14, .14]) box(.54 + dx, SIDEWALK + .22, .53 + dz, .03, .44, .03, Q.mesa, { bottom: .62 });
  box(.54, SIDEWALK + .455, .53, .36, .03, .36, Q.mesa, { bottom: .8 });
  kit.tube([[.48, SIDEWALK + .47, .5], [.48, SIDEWALK + .7, .5]], .045, 6, C.oscuro);
  kit.tube([[.48, SIDEWALK + .7, .5], [.48, SIDEWALK + .76, .5]], .03, 6, Q.mesa);
  for (const dx of [.1, .15]) box(.5 + dx, SIDEWALK + .5, .62 - dx, .045, .06, .045, C.blanco);

  return kit.geometry();
}
