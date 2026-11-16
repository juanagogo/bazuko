import * as THREE from 'three';
import { MeshKit, rgb, shade } from './MeshKit.js';
import { glowMaterial, followNight } from './StoreGlow.js';

// Un mercado de barrio inventado: su nombre y sus colores no se parecen a los de ninguna cadena.
const VERDE = '#1f5e3a';
export const D69_STORE = Object.freeze({ x0: 43, x1: 53, z0: 159, z1: 173, height: 5, name: 'Doña Inés' });

export function paintD69Store(map) {
  for (let z = 80; z <= 86; z++) for (let x = 22; x <= 26; x++) map[z][x] = 'storeD69';
}

// Paleta corta: muro claro y verde de la casa; el amarillo y el rojo son solo de los carteles y la fruta.
const C = {
  muro: rgb('#eeeadf'), verde: rgb(VERDE), verdeClaro: rgb('#2f7a4e'), crema: rgb('#fff3da'), marco: rgb('#b6bab8'),
  techo: rgb('#777a77'), grava: rgb('#8f918a'), zocalo: rgb('#5c625f'), piso: rgb('#c9c2b2'), equipo: rgb('#c3c7c5'),
  oscuro: rgb('#2b2f31'), tanque: rgb('#3c4246'), vidrio: rgb('#46433a'), claraboya: rgb('#5d8791'), luz: rgb('#fff1cf'),
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
const PORCH = 51.7;  // el frente del andén oriental se retira: queda un corredor cubierto dentro de la misma huella
const FLOOR = .16;
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

  // `face` describe un plano de fachada: origen, hacia dónde avanza un texto y hacia dónde mira.
  const EAST = z => ({ at: (u, y, out = 0) => [PORCH + .08 + out, y, z - u], normal: [1, 0, 0] });
  const NORTH = x => ({ at: (u, y, out = 0) => [x - u, y, 158.9 - out], normal: [0, 0, -1] });
  const panel = (face, u0, y0, w, h, color, out = 0) => kit.quad(face.at(u0, y0, out), face.at(u0 + w, y0, out),
    face.at(u0 + w, y0 + h, out), face.at(u0, y0 + h, out), color, { normal: face.normal, facing: face.normal });
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
  const poster = (face, u, y, top, price, color = C.amarillo) => lit(.9, () => {
    panel(face, u, y, 1.12, .86, color, .022);
    panel(face, u + .04, y + .56, 1.04, .26, C.rojo, .03);
    text(face, top, u + .56 - (top.length * 6 - 1) * .013, y + .6, .026, C.crema, .038);
    const size = Math.min(.045, 1 / (price.length * 6 - 1));
    text(face, price, u + .56 - (price.length * 6 - 1) * size / 2, y + .29 - size * 3.5, size, C.oscuro, .03);
  });
  // Lo que se ve tras el vidrio: góndolas con mercancía. De día queda oscuro; de noche es lo que alumbra.
  const shelves = (face, width) => lit(1.7, () => {
    const goods = [C.amarillo, C.rojo, C.crema, C.verdeClaro, C.naranja];
    for (const y of [.28, .86, 1.44]) {
      panel(face, .1, y - .05, width - .2, .04, shade(C.marco, .5), .012);
      for (let u = .14; u < width - .34;) {
        const w = .16 + random() * .22, h = .22 + random() * .2;
        panel(face, u, y, w, h, shade(goods[Math.floor(random() * goods.length)], .42), .012);
        u += w + .03;
      }
    }
  });
  // Vidrio oscuro de día; de noche deja ver la luz del local y sus tubos en el cielo raso.
  const glass = (face, u, y, w, h) => {
    lit(6, () => panel(face, u, y, w, h, C.vidrio));
    lit(14, () => { for (let t = .3; t + .9 < w; t += 1.3) panel(face, t, y + h - .3, .9, .05, C.vidrio, .012); });
  };

  // ---- Volumen: muros, pilares del corredor, franja verde con antepecho y techo hundido ----
  box(PORCH - 43, 3.8, 14, (43 + PORCH) / 2, 1.9, 166, C.muro, { bottom: .9 });
  for (const z of [159.6, 172.4]) {
    box(53 - PORCH, 3.8, 1.2, (53 + PORCH) / 2, 1.9, z, C.muro, { bottom: .9 });
    box(.06, .42, 1.2, 53.02, .21, z, C.zocalo);
  }
  // Pórticos verdes en las esquinas, sin ocupar la anchura del andén.
  for (const z of [159.3, 172.7]) box(.1, 3.8, .6, 53.04, 1.9, z, C.verde);
  box(10.04, .42, .05, 48, .21, 158.985, C.zocalo);
  for (const [w, d, x, z] of [[.36, 14.12, 52.88, 166], [.36, 14.12, 43.12, 166], [9.4, .36, 48, 159.12], [9.4, .36, 48, 172.88]]) {
    box(w, 1.3, d, x, 4.45, z, C.verde, { bottom: .85 });
    box(w + .04, .05, d + .04, x, 5.125, z, C.crema);
  }
  box(.02, .09, 14.12, 53.07, 3.87, 166, C.crema);
  box(10.12, .09, .02, 48, 3.87, 158.93, C.crema);
  box(9.4, .1, 13.4, 48, 4.5, 166, C.techo);

  // ---- Corredor cubierto: piso, cielo raso con lámparas, columnas ----
  lit(.2, () => box(53.02 - PORCH, FLOOR, 11.6, (53.02 + PORCH) / 2, FLOOR / 2, 166, C.piso));
  box(.06, FLOOR + .02, 11.6, 53, FLOOR / 2, 166, C.verdeClaro);
  lit(.16, () => {
    box(.01, 3.8, 11.6, PORCH + .006, 1.9, 166, C.muro, { skip: ONLY.px });
    box(1, .08, 11.6, PORCH + .5, 3.76, 166, shade(C.muro, .9));
  });
  lit(3, () => { for (const z of [161.8, 164.6, 167.4, 170.2]) box(.18, .03, 1.3, PORCH + .5, 3.71, z, C.luz); });
  for (const z of [163.9, 168]) {
    box(.3, 3.8, .3, 52.85, 1.9, z, C.muro);
    box(.34, .6, .34, 52.85, .3 + FLOOR, z, C.verde);
  }

  // ---- Frente: puertas de vidrio y dos vitrinas con carteles de oferta ----
  for (const z of [161.8, 166, 170]) {
    const face = EAST(z + 1.475), door = z === 161.8;
    box(.1, 2.9, 3.2, PORCH + .02, 1.57 + FLOOR, z, C.marco);
    glass(face, 0, .245 + FLOOR, 2.95, 2.65);
    if (!door) shelves(face, 2.95);
    box(.06, 2.7, .055, PORCH + .1, 1.57 + FLOOR, z, C.marco);
    if (door) {
      for (const side of [-1, 1]) box(.08, .55, .035, PORCH + .14, 1.5 + FLOOR, z + side * .13, C.marco);
      lit(.9, () => { panel(face, .5, 2.2, 1.95, .34, C.verde, .022); text(face, 'ABIERTO', .5 + .975 - 41 * .0175, 2.26, .035, C.crema, .03); });
    }
  }
  poster(EAST(166 + 1.475), .18, 1.2, 'OFERTA', '$990');
  poster(EAST(166 + 1.475), 1.66, 1.2, 'HOY', '2X1', C.crema);
  poster(EAST(170 + 1.475), .18, 1.2, 'PAN', '$500', C.crema);
  poster(EAST(170 + 1.475), 1.66, 1.2, 'FRUTA', '$1.990');
  // Marquesina sobre la entrada, con su luz por debajo
  box(53.3 - PORCH, .16, 3.5, (53.3 + PORCH) / 2, 3.05, 161.8, C.verde);
  box(.03, .17, 3.5, 53.31, 3.05, 161.8, C.crema);
  lit(2.5, () => box(1.2, .02, 2.9, 52.45, 2.96, 161.8, C.luz, { skip: ONLY.ny }));
  for (const z of [160.3, 163.3]) kit.tube([[53.2, 3.13, z], [52.9, 3.8, z]], .02, 4, C.oscuro);

  // ---- Frente lateral, visible desde la esquina de la calle ----
  box(5.7, 2.9, .1, 48, 1.57, 158.96, C.marco);
  glass(NORTH(48 + 2.725), 0, .245, 5.45, 2.65);
  shelves(NORTH(48 + 2.725), 5.45);
  for (const x of [46.18, 49.82]) box(.06, 2.7, .05, x, 1.57, 158.885, C.marco);
  poster(NORTH(48 + 2.725), .3, 1.25, 'OFERTA', '$1.500');
  poster(NORTH(48 + 2.725), 3.95, 1.25, 'HOY', '2X1', C.crema);

  // ---- En el corredor: fila de carritos, fruta a la puerta y bolardos al borde ----
  for (let i = 0; i < 5; i++) {
    const z = 171.2 - i * .44, y = FLOOR;
    kit.frustum(52.3, z, y + .45, y + .82, .4, .52, .5, .74, shade(C.marco, i % 2 ? .82 : 1), { bottom: .7, skipTop: true });
    box(.44, .01, .66, 52.3, y + .8, z, C.oscuro, { skip: ONLY.py });
    box(.4, .03, .56, 52.3, y + .2, z, shade(C.marco, .8));
    box(.5, .04, .05, 52.3, y + .92, z + .4, C.verdeClaro);
    for (const side of [-1, 1]) {
      box(.025, .5, .025, 52.3 + side * .2, y + .68, z + .37, shade(C.marco, .8));
      for (const end of [-1, 1]) box(.05, .1, .1, 52.3 + side * .19, y + .06, z + end * .24, C.oscuro);
    }
  }
  for (const x of [51.98, 52.62]) {
    kit.tube([[x, FLOOR, 171.72], [x, FLOOR + .98, 171.72], [x, FLOOR + .98, 168.9], [x, FLOOR, 168.9]], .03, 5, C.verdeClaro);
  }
  box(.46, .56, 1.62, 52, .28 + FLOOR, 164.3, C.madera, { bottom: .7 });
  [[C.naranja, C.naranja], [C.rojo, C.fruta], [C.fruta, C.amarillo]].forEach((fruit, n) => {
    kit.matrix = new THREE.Matrix4().compose(new THREE.Vector3(52.08, FLOOR + .68, 163.78 + n * .52),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -.5)), new THREE.Vector3(1, 1, 1));
    kit.box(0, 0, 0, .4, .14, .48, C.tabla, { skip: 'py' });
    kit.box(0, -.04, 0, .36, .02, .44, shade(C.madera, .7));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const r = .055 + random() * .012;
      kit.ellipsoid([-.12 + i * .12, .03 + random() * .02, -.165 + j * .11], [r, r, r], shade(fruit[(i + j) % 2], .9 + random() * .2), { rows: 3, cols: 5 });
    }
    kit.matrix = null;
  });
  for (const z of [160.6, 163, 165.2, 167.4, 169.6, 171.5]) {
    kit.tube([[53.2, .1, z], [53.2, .72, z]], .09, 6, C.verde);
    kit.tube([[53.2, .72, z], [53.2, .82, z]], .09, 6, C.crema, { caps: false });
    kit.tube([[53.2, .82, z], [53.2, .9, z]], .08, 6, C.verde);
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

  // Una sola malla para todo el edificio. Queda fuera de la fusión de la ciudad: su material cambia de noche.
  const building = new THREE.Mesh(kit.geometry(), glowMaterial(THREE.MeshStandardMaterial, { roughness: .85 }));
  building.name = 'Edificio D69';
  building.castShadow = building.receiveShadow = true;
  building.userData.noMerge = true;
  group.add(followNight(building));

  const sign = (x, z, yaw) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .95),
      new THREE.MeshBasicMaterial({ map: createSign({ title: 'DOÑA INÉS', sub: 'MERCADO DEL BARRIO', bg: VERDE, fg: '#fff3da', border: false, w: 512, h: 160 }) }));
    mesh.position.set(x, 4.4, z); mesh.rotation.y = yaw; group.add(mesh);
  };
  sign(53.13, 162, Math.PI / 2);
  sign(48, 158.87, Math.PI);
  return group;
}
