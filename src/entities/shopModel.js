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

  // ---- Caseta: escalón, muros con zócalo, techo de zinc y persiana enrollada ----
  box(0, FLOOR / 2, -.68, 2.4, FLOOR, 1.64, C.concreto, { bottom: .8 });
  box(0, FLOOR - .03, .135, 2.4, .061, .03, C.amarillo);
  const wall = (x, z, sx, sz) => {
    box(x, FLOOR + .36, z, sx + .02, .72, sz + .02, C.zocalo, { bottom: .72 });
    box(x, FLOOR + 1.56, z, sx, 1.68, sz, C.crema);
  };
  wall(0, -1.39, 2.4, .12);
  for (const side of [-1, 1]) wall(side * 1.15, -.7, .1, 1.38);
  lit(.42, () => box(0, FLOOR + 1.5, -1.32, 2.2, 1.7, .01, shade(C.crema, .92), { skip: FRONT }));
  box(0, FLOOR + 2.45, -.68, 2.62, .1, 1.66, C.concreto);
  for (let i = 0; i < 8; i++) box(-1.19 + i * .34, FLOOR + 2.52, -.68, .335, .04, 1.7, i % 2 ? C.zinc : C.zincOscuro);
  box(-.78, FLOOR + 2.59, -1.08, .24, .1, .12, C.ladrillo, { rotation: [0, .5, 0] });
  box(.86, FLOOR + 2.59, -.92, .24, .1, .12, C.ladrillo, { rotation: [0, -.3, 0] });
  box(.3, FLOOR + 2.58, -1.3, .5, .08, .1, C.madera, { rotation: [0, .12, 0] });
  box(0, FLOOR + 2.27, .0, 2.22, .26, .2, C.metal);
  for (let i = 0; i < 4; i++) box(0, FLOOR + 2.17 + i * .065, .0, 2.23, .014, .21, shade(C.metal, .7));
  for (const side of [-1, 1]) box(side * 1.14, FLOOR + 1.07, .0, .07, 2.14, .07, shade(C.metal, .85));
  lit(3, () => box(-.3, FLOOR + 2.37, -.7, 1.3, .04, .07, C.tubo));

  // ---- Estantería del fondo: frascos, tarros, cajas, bolsas y rollos ----
  lit(.5, () => {
    const colors = [C.amarillo, C.rojo, C.crema, C.azul, C.blanco, C.verde];
    for (const y of [FLOOR + 1.08, FLOOR + 1.52, FLOOR + 1.94]) {
      box(0, y, -1.2, 2.18, .035, .26, C.tabla);
      const top = y + .018;
      for (let x = -1; x < .98;) {
        const kind = Math.floor(random() * 5), color = pick(colors);
        if (kind === 0) { // botella
          kit.tube([[x + .04, top, -1.18], [x + .04, top + .2, -1.18]], .042, 6, color);
          kit.tube([[x + .04, top + .2, -1.18], [x + .04, top + .28, -1.18]], .018, 5, C.blanco);
          x += .11;
        } else if (kind === 1) { // tarros apilados
          for (let k = 0; k < 2; k++) kit.tube([[x + .05, top + k * .125, -1.18], [x + .05, top + k * .125 + .115, -1.18]], .05, 6, k ? pick(colors) : color);
          x += .13;
        } else if (kind === 2) { // caja
          const w = .1 + random() * .08, h = .13 + random() * .12;
          box(x + w / 2, top + h / 2, -1.17, w, h, .16, color);
          x += w + .025;
        } else if (kind === 3) { // bolsa
          kit.frustum(x + .07, -1.17, top, top + .2, .1, .08, .14, .03, color);
          x += .16;
        } else { // rollos
          for (const [dx, dy] of [[0, 0], [.105, 0], [.052, .09]]) kit.tube([[x + .05 + dx, top + .05 + dy, -1.26], [x + .05 + dx, top + .05 + dy, -1.1]], .05, 6, C.blanco);
          x += .23;
        }
      }
    }
  });

  // ---- Mostrador con la franja roja; encima: vitrina del pan, pesa y cubetas de huevos ----
  box(-.34, FLOOR + .475, -.2, 1.52, .95, .42, C.blanco, { bottom: .8 });
  box(-.34, FLOOR + .78, -.2, 1.54, .16, .44, C.rojo);
  box(-.34, FLOOR + .975, -.2, 1.58, .05, .5, C.crema);
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
  box(-.16, counter + .04, -.2, .22, .08, .2, C.azul);
  box(-.16, counter + .1, -.2, .04, .05, .04, C.metal);
  kit.disc([-.16, counter + .13, -.2], [0, 1, 0], .13, 8, C.zinc, { edge: C.zincOscuro });
  box(-.16, counter + .17, -.31, .14, .18, .03, C.blanco);
  box(-.16, counter + .19, -.292, .012, .1, .008, C.rojo, { rotation: [0, 0, .5] });
  // Cubetas de huevos
  for (let k = 0; k < 4; k++) box(.2, counter + .02 + k * .04, -.2, .27, .035, .27, shade(C.carton, k % 2 ? 1 : .88), { rotation: [0, k * .07, 0] });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    kit.ellipsoid([.2 + (i - 1) * .08, counter + .18, -.2 + (j - 1) * .08], [.03, .04, .03], C.huevo, { rows: 2, cols: 4 });
  }

  // ---- Nevera de bebidas: el frente es lo que más brilla de noche ----
  box(.79, FLOOR + .95, -.3, .58, 1.9, .56, C.blanco, { bottom: .82 });
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
  [[C.naranja, C.naranja], [C.rojo, C.verde], [C.verde, C.platano]].forEach((fruit, n) => {
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
  [[-.98, C.amarillo], [-.74, C.rojo], [.34, C.amarillo]].forEach(([x, color], n) => {
    box(x, hang - .38, .075, .012, .76, .006, C.blanco);
    for (let k = 0; k < 5; k++) box(x, hang - .09 - k * .15, .085, .13, .13, .02, k % 2 ? color : shade(color, .86), { rotation: [0, 0, (k + n) % 2 ? .22 : -.22] });
  });
  kit.tube([[.04, hang, .1], [.04, hang - .5, .1]], .016, 4, C.verde);
  [[hang - .16, 6, .8], [hang - .3, 6, 1], [hang - .43, 5, 1.12]].forEach(([y, count, ripe], tier) => {
    for (let i = 0; i < count; i++) {
      const a = (i + tier * .5) / count * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
      kit.tube([[.04 + cx * .03, y, .1 + cz * .03], [.04 + cx * .1, y - .07, .1 + cz * .1], [.04 + cx * .085, y - .19, .1 + cz * .085]],
        .026, 4, shade(C.platano, ripe * (.92 + (i % 2) * .12)));
    }
  });

  // ---- Toldo de rayas, un poco caído, con cenefa recortada y tira de bombillos ----
  const drop = .38, length = .98, tilt = .025;
  placed(at(0, FLOOR + 2.47, .1, drop, 0, tilt), () => {
    for (let i = 0; i < 8; i++) box(-1.19 + i * .34, 0, length / 2, .34, .03, length, i % 2 ? C.crema : C.azul, { bottom: .8 });
    lit(.55, () => box(0, -.018, length / 2, 2.7, .004, length - .04, shade(C.bombillo, .7), { skip: 'px nx py pz nz' }));
    for (const side of [-1, 1]) kit.tube([[side * 1.36, -.02, 0], [side * 1.36, -.02, length]], .016, 4, C.oscuro);
    kit.tube([[-1.36, -.02, length], [1.36, -.02, length]], .016, 4, C.oscuro);
  });
  const edgeY = FLOOR + 2.47 - Math.sin(drop) * length, edgeZ = .1 + Math.cos(drop) * length;
  placed(at(0, edgeY, edgeZ, 0, 0, tilt), () => {
    for (let i = 0; i < 8; i++) {
      const x0 = -1.36 + i * .34, x1 = x0 + .34, color = i % 2 ? C.azul : C.crema;
      for (const facing of [[0, 0, 1], [0, 0, -1]]) {
        const tone = facing[2] > 0 ? color : shade(color, .7);
        kit.quad([x0, -.1, 0], [x1, -.1, 0], [x1, .01, 0], [x0, .01, 0], tone, { facing });
        kit.quad([x0, -.1, 0], [(x0 + x1) / 2, -.2, 0], [(x0 + x1) / 2, -.2, 0], [x1, -.1, 0], tone, { normal: facing, facing });
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
  box(0, FLOOR + 2.9, -.06, 2.66, .7, .03, C.oscuro);
  for (const x of [-1, 1]) kit.tube([[x, FLOOR + 2.56, -.5], [x, FLOOR + 3.05, -.08]], .016, 4, C.oscuro);

  // ---- En las esquinas del frente, dentro de lo sólido: canastas de gaseosa a un lado; silla y mesita al otro ----
  const crate = (x, y, z, color, turn = 0) => placed(at(x, y, z, 0, turn, 0), () => {
    box(0, .12, 0, .34, .24, .44, color, { bottom: .78 });
    box(0, .13, 0, .345, .07, .3, shade(color, .55));
    box(0, .241, 0, .28, .004, .38, shade(color, .45), { skip: 'px nx ny pz nz' });
  });
  [C.rojo, C.rojo, C.amarillo, C.rojo].forEach((color, k) => crate(-1.01, SIDEWALK + k * .245, .4, color, (k % 2 ? .03 : -.03)));
  [C.amarillo, C.rojo].forEach((color, k) => crate(-.64, SIDEWALK + k * .245, .5, color, (k % 2 ? -.04 : .03)));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    const x = -1.1 + i * .09, z = .265 + j * .09, y = SIDEWALK + 4 * .245;
    kit.tube([[x, y - .04, z], [x, y + .09, z]], .026, 5, C.vidrio);
    box(x, y + .1, z, .03, .02, .03, C.zinc);
  }
  // Silla plástica de lado, con el espaldar contra la esquina
  const seat = SIDEWALK + .42;
  placed(at(.94, 0, .5, 0, -Math.PI / 2, 0), () => {
    for (const dx of [-.17, .17]) for (const dz of [-.17, .17]) box(dx, SIDEWALK + .21, dz, .035, .42, .035, C.blanco, { bottom: .8 });
    box(0, seat, 0, .42, .035, .42, C.blanco);
    box(0, seat + .27, -.21, .42, .46, .035, C.blanco, { rotation: [-.1, 0, 0] });
    for (const dx of [-.2, .2]) {
      box(dx, seat + .2, -.02, .035, .035, .4, C.blanco);
      box(dx, seat + .1, .16, .035, .2, .035, C.blanco);
    }
  });
  // Mesita con el termo del tinto
  for (const dx of [-.14, .14]) for (const dz of [-.14, .14]) box(.54 + dx, SIDEWALK + .22, .53 + dz, .03, .44, .03, C.rojo, { bottom: .75 });
  box(.54, SIDEWALK + .455, .53, .36, .03, .36, C.rojo);
  kit.tube([[.48, SIDEWALK + .47, .5], [.48, SIDEWALK + .7, .5]], .045, 6, C.oscuro);
  kit.tube([[.48, SIDEWALK + .7, .5], [.48, SIDEWALK + .76, .5]], .03, 6, C.rojo);
  for (const dx of [.1, .15]) box(.5 + dx, SIDEWALK + .5, .62 - dx, .045, .06, .045, C.blanco);

  return kit.geometry();
}
