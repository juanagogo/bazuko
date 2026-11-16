// src/entities/cambuche/piezas.js
// Las seis piezas que se arman una por una (base, techo, paredes, colchón, fogón, vela), cada una como una maqueta
// de caras planas. Medidas del modelo de rebusque (el cambuche las lleva a la escala del mundo). La entrada mira
// hacia +Z, que es donde aparece el jugador, y el techo sube hacia el frente derecho, como en el modelo terminado.
import * as THREE from 'three';
import { Maqueta, PALETA as P } from './maqueta.js';

const X0 = -1.6, X1 = 1.6, Z0 = -1.2, Z1 = .78;

/** Altura del techo armado a mano sobre el punto (x, z). */
export const techoArmado = (x, z) => 1.38 + .17 * x + .13 * z;

/** Giro que acuesta algo plano sobre una superficie de alturas (llanta, lámina). */
export function acostado(h, x, z, d = .25) {
  return [Math.PI / 2 - Math.atan((h(x, z + d) - h(x, z - d)) / (2 * d)), 0, Math.atan((h(x + d, z) - h(x - d, z)) / (2 * d)), 'ZYX'];
}

export function base() {
  const m = new Maqueta(11), r = m.r;
  // Tres hojas de cartón solapadas: cada una queda un poco encima de la anterior.
  for (let i = 0; i < 3; i++) {
    m.caja(.94, .04, 2.36, i === 1 ? P.cartonViejo : P.carton, { en: [-.9 + i * .88, .03 + i * .012, .04], giro: [0, (r() - .5) * .08, 0] });
  }
  // Tapas de caja que sobran por el borde.
  m.caja(.5, .03, .34, P.cartonViejo, { en: [1.42, .05, 1.02], giro: [0, .3, .1] });
  m.caja(.42, .03, .3, P.carton, { en: [-1.48, .05, -.92], giro: [0, -.2, -.08] });
  return m;
}

export function techo() {
  const m = new Maqueta(23), r = m.r, h = techoArmado;
  for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) {
    m.palo([x + (r() - .5) * .1, 0, z + (r() - .5) * .1], [x, h(x, z) + .1, z], .036);
  }
  m.palo([X0 - .12, h(X0 - .12, Z1) - .03, Z1], [X1 + .12, h(X1 + .12, Z1) - .03, Z1], .03);
  m.palo([X0 - .12, h(X0 - .12, Z0) - .03, Z0], [X1 + .12, h(X1 + .12, Z0) - .03, Z0], .03);
  m.palo([.05, h(.05, Z0) - .03, Z0 - .06], [.05, h(.05, Z1) - .03, Z1 + .06], .026);
  // La lona se comba entre los palos; lo que va encima sigue esa comba.
  const comba = (x, z) => .06 * Math.sin(Math.PI * (x - X0) / (X1 - X0)) * Math.sin(Math.PI * (z - Z0) / (Z1 - Z0));
  const lona = (x, z) => {
    const cx = Math.min(Math.max(x, X0), X1), cz = Math.min(Math.max(z, Z0), Z1);
    return h(cx, cz) + .05 - comba(cx, cz);
  };
  // Plástico negro abajo: sobra por atrás y por la izquierda, y ahí cuelga.
  m.tela(8, 5, (u, v) => {
    const x = -1.9 + u * 3.62, z = -1.55 + v * 2.37;
    return [x, lona(x, z) - .03 - (Math.max(0, X0 - x) + Math.max(0, Z0 - z)) * .85, z];
  }, P.plastico, { tono: .4 });
  // Lona azul encima, con dos remiendos de otra lona.
  m.tela(8, 6, (u, v) => {
    const x = -1.2 + u * 3, z = -1.3 + v * 2.3;
    return [x, lona(x, z) - Math.max(0, x - X1) * .9 - Math.max(0, z - Z1) * .5 - Math.max(0, Z0 - z) * .6, z];
  }, (u, v) => (u > .5 && u < .75 && v > .34 && v < .66) || (u < .125 && v > .66) ? P.lonaClara : P.lona, { tono: .13 });
  // Dos tiras de cinta gris sobre una rasgadura.
  for (const [x0, z0, x1, z1] of [[-.62, -.74, -.02, -.8], [-.5, -.56, -.08, -.6]]) {
    const largo = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / largo * .09, nz = (x1 - x0) / largo * .09;
    m.tela(2, 1, (u, v) => {
      const x = x0 + (x1 - x0) * u + nx * (v - .5), z = z0 + (z1 - z0) * u + nz * (v - .5);
      return [x, lona(x, z) + .018, z];
    }, P.cinta, { tono: .04 });
  }
  // Lo que la sujeta: piedras, una llanta vieja y cuerdas a estacas.
  for (const [x, z, radio] of [[-1.05, -1.15, .1], [1.5, -1.1, .09], [1.55, .6, .1], [-1.0, .7, .085], [.3, .8, .075]]) {
    m.piedra(radio, [x, lona(x, z), z]);
  }
  m.llanta(.3, [.85, lona(.85, -.45) + .1, -.45], acostado(lona, .85, -.45));
  for (const [x, z, dx, dz] of [[X0, Z0, -.5, -.42], [X1, Z0, .5, -.42], [X0, Z1, -.5, .4], [X1, Z1, .48, .4]]) {
    m.palo([x, h(x, z) + .06, z], [x + dx, .04, z + dz], .008, P.cuerda, 4);
    m.palo([x + dx, 0, z + dz], [x + dx * 1.04, .15, z + dz * 1.04], .02, P.palo, 4);
  }
  return m;
}

export function paredes() {
  const m = new Maqueta(37), r = m.r, h = techoArmado;
  const tabla = (x, z, w, girada, color = [P.tablaVieja, P.tabla, P.tabla, P.tablaClara][Math.floor(r() * 4)], alto = h(x, z) - .06 - r() * .1) =>
    m.tabla(girada ? .035 : w, alto, girada ? w : .035, color, { en: [x, 0, z], giro: [0, 0, girada ? 0 : (r() - .5) * .05] });
  // Fondo: tablas y dos cajas grandes abiertas.
  for (const [x, w, carton] of [[-1.46, .28], [-1.17, .28], [-.66, .72, true], [-.15, .28], [.14, .28], [.65, .72, true], [1.16, .28], [1.45, .28]]) {
    if (carton) m.tabla(w, Math.min(1.15, h(x, Z0) - .1), .02, x < 0 ? P.carton : P.cartonViejo, { en: [x, 0, Z0 + .01], tono: .05 });
    else tabla(x, Z0, w - .02, false);
  }
  m.caja(3.24, .07, .03, P.tablaVieja, { en: [0, .62, Z0 + .04], giro: [0, 0, .03] });
  // Costados: el izquierdo con un cartón, el derecho de tablas hasta la entrada.
  for (let i = 0; i < 5; i++) {
    const z = Z0 + .2 + i * .4;
    if (i === 2) m.tabla(.02, h(X0, z) - .12, .4, P.carton, { en: [X0 - .01, 0, z], tono: .05 });
    else tabla(X0, z, .37, true);
    tabla(X1, z, .37, true);
  }
  m.caja(.03, .07, 1.95, P.tablaVieja, { en: [X0 - .04, .58, -.2], giro: [.02, 0, 0] });
  m.caja(.03, .07, 1.95, P.tablaVieja, { en: [X1 + .04, .7, -.2], giro: [-.02, 0, 0] });
  // Frente: una caja de cartón y dos tablas a la izquierda; a la derecha queda la entrada.
  m.tabla(.8, h(-1.2, Z1) - .1, .02, P.carton, { en: [-1.18, 0, Z1 + .01], tono: .05 });
  tabla(-.62, Z1, .27, false); tabla(-.33, Z1, .27, false); tabla(-.04, Z1, .26, false);
  // La cobija de cortina, recogida a un lado para que se vea adentro.
  cortina(m, .12, .95, Z1 + .04, x => h(x, Z1) - .05, .07);
  return m;
}

/** Cobija colgada de `x0` a `x1` y recogida hacia `x0` con un nudo a media altura; lleva dos rayas claras. */
export function cortina(m, x0, x1, z, arriba, abajo) {
  return m.tela(6, 10, (u, v) => {
    // Ancha arriba, apretada en el nudo y otra vez suelta abajo.
    const ancho = 1 - .62 * Math.sin(Math.PI * Math.min(1, v / .62) / 2) + .3 * Math.max(0, v - .62) / .38;
    const top = arriba(x0 + (x1 - x0) * u) - .06 * Math.sin(Math.PI * u);
    return [x0 + (x1 - x0) * u * ancho, top - (top - abajo) * v, z + Math.sin(u * Math.PI * 4) * .035 * (.3 + v)];
  }, (u, v) => (v > .1 && v < .2) || (v > .8 && v < .9) ? P.raya : P.cobija, { tono: .16 });
}

export function cama() {
  const m = new Maqueta(41), x = -.5, z = -.2;
  // Estiba: tres largueros y las tablas de encima.
  for (const dx of [-.45, 0, .45]) m.caja(.09, .08, 1.98, P.tablaVieja, { en: [x + dx, .09, z] });
  for (let i = 0; i < 6; i++) m.caja(1.04, .025, .2, P.tabla, { en: [x, .143, z - .86 + i * .345] });
  // Colchón, almohada y la cobija doblada a los pies.
  m.caja(.95, .16, 1.9, P.colchon, { en: [x, .235, z], tono: .05 });
  m.caja(.5, .08, .3, P.sabana, { en: [x, .35, z - .74], giro: [.06, .1, 0], tono: .04 });
  m.caja(.99, .05, 1.02, P.cobija, { en: [x, .335, z + .43], giro: [0, .03, 0], tono: .08 });
  m.caja(1, .052, .1, P.raya, { en: [x, .336, z + .12], giro: [0, .03, 0], tono: .04 });
  m.caja(1, .052, .1, P.raya, { en: [x, .336, z + .74], giro: [0, .03, 0], tono: .04 });
  return m;
}

/** El fogón: tres piedras, la olla tiznada encima, leña y las latas. Centro en el origen. */
export function fogon() {
  const m = new Maqueta(53), r = m.r;
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * Math.PI * 2 / 3;
    m.piedra(.105, [Math.cos(a) * .2, 0, Math.sin(a) * .2]);
  }
  m.cilindro(.3, .012, P.ceniza, { lados: 9, en: [0, 0, 0], tono: .15 });
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + .4;
    m.palo([Math.cos(a) * .27, .025, Math.sin(a) * .27], [-Math.cos(a) * .06, .06, -Math.sin(a) * .06], .02, P.tizne, 4);
  }
  // Olla: el fondo negro de tizne, el borde y la tapa.
  m.cilindro(.125, .06, P.tizne, { lados: 8, en: [0, .17, 0], radioArriba: .135, tono: .2 });
  m.cilindro(.135, .1, P.olla, { lados: 8, en: [0, .23, 0], tono: .25 });
  m.cilindro(.145, .016, P.lata, { lados: 8, en: [0, .33, 0], tono: .1 });
  m.cilindro(.02, .03, P.tizne, { lados: 5, en: [0, .346, 0] });
  m.caja(.05, .02, .03, P.tizne, { en: [.15, .3, 0] }); m.caja(.05, .02, .03, P.tizne, { en: [-.15, .3, 0] });
  // Las latas del fogón y un atado de leña.
  for (const [x, z, acostada] of [[-.38, .12], [-.44, -.04], [-.33, -.2, true]]) {
    m.cilindro(.045, .11, P.lata, { lados: 6, en: acostada ? [x, .045, z] : [x, 0, z], giro: acostada ? [Math.PI / 2, 0, .6] : [0, r() * 3, 0], tono: .14 });
  }
  for (let i = 0; i < 3; i++) m.palo([.3 + i * .05, .03 + (i === 1 ? .05 : 0), -.28], [.42 + i * .04, .03 + (i === 1 ? .05 : 0), .2], .022, P.palo, 4);
  return m;
}

/** Las brasas, aparte: brillan solas. */
export function brasas() {
  const m = new Maqueta(59), r = m.r;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05, d = .03 + r() * .09;
    m.caja(.05 + r() * .03, .03, .04 + r() * .03, i % 2 ? '#ff5a12' : '#ff8a2a', { en: [Math.cos(a) * d, .03, Math.sin(a) * d], giro: [0, r() * 3, 0], tono: .2 });
  }
  return m;
}

/** El rincón de la vela: un cajón de nicho con la estampa, la vela delante y una matica en un tarro. */
export function vela() {
  const m = new Maqueta(61);
  // Cajón parado, abierto hacia el frente.
  m.caja(.36, .02, .22, P.tabla, { en: [0, .01, 0] }); m.caja(.36, .02, .22, P.tabla, { en: [0, .33, 0] });
  m.caja(.02, .32, .22, P.tablaVieja, { en: [-.17, .17, 0] }); m.caja(.02, .32, .22, P.tablaVieja, { en: [.17, .17, 0] });
  m.caja(.34, .32, .015, P.tablaVieja, { en: [0, .17, -.1] });
  // Estampa: una figura de manto azul con su resplandor, sin rostro ni nombre.
  m.caja(.15, .21, .008, P.cera, { en: [0, .135, -.07], giro: [-.14, 0, 0], tono: .02 });
  m.pon(new THREE.CircleGeometry(.062, 3), P.lona, { en: [0, .112, -.058], giro: [-.14, 0, Math.PI / 2], escala: [1.25, .8, 1], tono: .03 });
  m.pon(new THREE.CircleGeometry(.03, 6), '#e2b23c', { en: [0, .19, -.066], giro: [-.14, 0, 0], tono: .03 });
  m.pon(new THREE.CircleGeometry(.017, 6), P.raya, { en: [0, .188, -.063], giro: [-.14, 0, 0], tono: .02 });
  // Tapa de tarro de plato y la vela.
  m.cilindro(.05, .008, P.lata, { lados: 7, en: [.02, .02, .2] });
  m.cilindro(.02, .1, P.cera, { lados: 6, en: [.02, .028, .2], tono: .03 });
  // Matica en un tarro.
  m.cilindro(.055, .12, P.guacal, { lados: 7, en: [.36, 0, .1], radioArriba: .062, tono: .1 });
  m.cilindro(.05, .01, P.tierra, { lados: 7, en: [.36, .112, .1] });
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    m.pon(new THREE.ConeGeometry(.032, .17, 3).translate(0, .085, 0), P.hoja, { en: [.36, .11, .1], giro: [.45 + (i % 2) * .2, a, 0, 'YXZ'], tono: .16 });
  }
  m.pon(new THREE.ConeGeometry(.026, .2, 3).translate(0, .1, 0), P.hoja, { en: [.36, .11, .1], tono: .16 });
  return m;
}

/** Dónde arde la vela, en las medidas de la pieza. */
export const LLAMA_VELA = Object.freeze([.02, .145, .2]);
