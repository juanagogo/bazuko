// src/world/bogota/texturasAzotea.js
// Azoteas y costados de los bloques de relleno: ladrillo a la vista en las cuatro caras y, arriba, latas de zinc
// traslapadas o la losa de siempre, con lo de toda azotea de obra sin terminar: tanque, columnas con varillas a la
// espera, piedras, ladrillos y llantas que sujetan las latas, y ropa tendida.
//
// No trae textura ni material propios, y es a propósito: un material nuevo en un edificio abre lotes cerrados nuevos
// (BuildingVisibility.buildClosedView) y una malla más por techo clona una geometría más, y las dos cosas gastan azar
// del juego antes de que nazca la gente. Las latas salen de las celdas del atlas de detalles que ya usan las casas y
// todo va dentro de la única malla del techo: mismos lotes, mismas mallas, mismo azar.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import { detailAtlas } from './textures-calle.js';

// Three sortea un identificador por cada material, geometría y malla. Lo que nace aquí lo hace con un azar propio para
// que la ciudad y su gente gasten los mismos números de siempre.
const azarPropio = rng(0x417a07ea);
const sinGastarAzar = (crear) => {
  const delJuego = Math.random;
  Math.random = azarPropio;
  try { return crear(); } finally { Math.random = delJuego; }
};

// El molde de vida de azotea de cada ciudad armada.
const porCiudad = new WeakMap();
/** El material de la vida de azotea de una casa ya registrada: clonarlo deja el techo en esos mismos lotes cerrados. */
function moldeDeVida(visibilidad) {
  if (porCiudad.has(visibilidad)) return porCiudad.get(visibilidad);
  let molde = null;
  for (const edificio of visibilidad.buildings) for (const malla of edificio.roofPart?.meshes ?? []) {
    if (!molde && malla.name === 'Azotea con vida' && !Array.isArray(malla.material)) molde = malla.material;
  }
  if (molde) porCiudad.set(visibilidad, molde);
  return molde;
}

/** Lote de piezas con UV del atlas de detalles; `u` corre por x y `v` por z, en metros desde el centro del bloque. */
function lote() {
  const out = { position: [], normal: [], uv: [], index: [] };
  const quad = (points, normal, rect) => {
    const base = out.position.length / 3;
    // Una normal para la cara, o una por esquina en lo que es redondo.
    points.forEach((p, i) => { const n = Array.isArray(normal[0]) ? normal[i] : normal; out.position.push(p[0], p[1], p[2]); out.normal.push(n[0], n[1], n[2]); });
    out.uv.push(rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]);
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  return {
    out, quad,
    /** Caja con la base en `y` y sin tapa inferior. */
    box(rect, u, y, v, w, h, d) {
      const a0 = u - w / 2, a1 = u + w / 2, c0 = v - d / 2, c1 = v + d / 2, y1 = y + h;
      quad([[a0, y, c1], [a1, y, c1], [a1, y1, c1], [a0, y1, c1]], [0, 0, 1], rect);
      quad([[a1, y, c0], [a0, y, c0], [a0, y1, c0], [a1, y1, c0]], [0, 0, -1], rect);
      quad([[a1, y, c1], [a1, y, c0], [a1, y1, c0], [a1, y1, c1]], [1, 0, 0], rect);
      quad([[a0, y, c0], [a0, y, c1], [a0, y1, c1], [a0, y1, c0]], [-1, 0, 0], rect);
      quad([[a0, y1, c1], [a1, y1, c1], [a1, y1, c0], [a0, y1, c0]], [0, 1, 0], rect);
    },
    /** Lámina acostada, apenas levantada de un lado para que no quede a ras. `porZ`: la celda corre a lo largo de z. */
    lamina(rect, u, y, v, w, d, caida = .05, porZ = false) {
      const a0 = u - w / 2, a1 = u + w / 2, c0 = v - d / 2, c1 = v + d / 2;
      quad(porZ ? [[a0, y + caida, c0], [a0, y, c1], [a1, y, c1], [a1, y + caida, c0]]
        : [[a0, y, c1], [a1, y, c1], [a1, y + caida, c0], [a0, y + caida, c0]], [0, 1, 0], rect);
    },
    /** Tela colgada, de cara a z. */
    panel(rect, u, y, v, w, h) {
      quad([[u - w / 2, y - h / 2, v], [u + w / 2, y - h / 2, v], [u + w / 2, y + h / 2, v], [u - w / 2, y + h / 2, v]], [0, 0, 1], rect);
    },
    /** Piedra: prisma torcido de cinco o seis lados, más angosto arriba y con la cara de arriba inclinada. */
    piedra(rect, u, y, v, radio, alto, lados, giro) {
      const abajo = [], arriba = [];
      for (let i = 0; i < lados; i++) {
        const a = giro + i / lados * Math.PI * 2, k = 1 + .22 * Math.sin(a * 2 + giro * 3);
        abajo.push([u + Math.sin(a) * radio * k, y, v + Math.cos(a) * radio * k]);
        arriba.push([u + Math.sin(a) * radio * k * .68, y + alto * (1 + .32 * Math.cos(a - giro * 2)), v + Math.cos(a) * radio * k * .68]);
      }
      for (let i = 0; i < lados; i++) {
        const j = (i + 1) % lados, m = giro + (i + .5) / lados * Math.PI * 2;
        quad([abajo[i], abajo[j], arriba[j], arriba[i]], [Math.sin(m) * .92, .39, Math.cos(m) * .92], rect);
      }
      quad([arriba[0], arriba[1], arriba[2], arriba[3]], [0, 1, 0], rect);
      quad([arriba[0], arriba[3], arriba[4], arriba[lados - 1]], [0, 1, 0], rect);
    },
    /** `redondo`: la celda da una sola vuelta y la luz no marca las caras. */
    cilindro(rect, u, y, v, r0, r1, h, lados = 8, redondo = false) {
      const slope = (r0 - r1) / Math.max(h, 1e-3), length = Math.hypot(1, slope), ny = slope / length, du = (rect[2] - rect[0]) / lados;
      for (let i = 0; i < lados; i++) {
        const a = i / lados * Math.PI * 2, b = (i + 1) / lados * Math.PI * 2, m = (a + b) / 2;
        const puntos = [[u + Math.sin(a) * r0, y, v + Math.cos(a) * r0], [u + Math.sin(b) * r0, y, v + Math.cos(b) * r0],
          [u + Math.sin(b) * r1, y + h, v + Math.cos(b) * r1], [u + Math.sin(a) * r1, y + h, v + Math.cos(a) * r1]];
        if (!redondo) { quad(puntos, [Math.sin(m) / length, ny, Math.cos(m) / length], rect); continue; }
        const na = [Math.sin(a) / length, ny, Math.cos(a) / length], nb = [Math.sin(b) / length, ny, Math.cos(b) / length];
        quad(puntos, [na, nb, nb, na], [rect[0] + du * i, rect[1], rect[0] + du * (i + 1), rect[3]]);
      }
    }
  };
}

/** La lata oxidada del todo: el extremo de la celda de zinc que ya se comió el óxido, con su misma onda. */
const oxidada = ({ lata: [u0, v0, u1, v1] }) => [u0, v0, u0 + (u1 - u0) * .22, v1];

/**
 * Techo de latas: tiras de un metro que caen todas hacia un mismo borde. Cada lata se levanta un poco y pisa a la que
 * sigue en el traslapo. Cubre toda la huella. Devuelve a qué altura queda la lata de encima en cada punto.
 */
function latas(piezas, UV, r, { ancho, fondo, alto: y, girada }) {
  const largo = girada ? ancho : fondo, traves = girada ? fondo : ancho, hojas = [];
  // Debajo, una tapa entera: por ninguna rendija se ve el interior.
  piezas.lamina(UV.rust, 0, y, 0, ancho, fondo, 0);
  let pendiente = null, haciaMas = false;
  for (let t = -traves / 2; t < traves / 2 - .01;) {
    // La última tira y la última lata llegan hasta el borde: no quedan astillas.
    const suerte = r();
    let w = .92 + suerte * .16;
    if (traves / 2 - t - w < .45) w = traves / 2 - t;
    // El techo entero cae de 8 a 14 cm hacia uno de sus bordes: el agua corre a lo largo de las latas.
    if (pendiente === null) { pendiente = (.08 + suerte * .06) / largo; haciaMas = suerte * 8 % 1 < .5; }
    const subida = (l) => (haciaMas ? largo / 2 - l : l + largo / 2) * pendiente;
    for (let l = -largo / 2; l < largo / 2 - .01;) {
      let d = 1.5 + r() * 1.1;
      if (largo / 2 - l - d < .6) d = largo / 2 - l;
      const k = r();
      // Zinc gris de onda con el óxido que asoma del traslapo, placa lisa y opaca u oxidada del todo: ninguna brilla como nueva.
      const celda = k < .72 ? UV.lata : k < .86 ? UV.canvas : oxidada(UV);
      // La onda corre a lo largo de la lata.
      const cara = r() < .5 ? celda : [celda[0], celda[3], celda[2], celda[1]];
      const traslapo = .12 + r() * .08, paso = .035 + r() * .03;
      // El lado bajo queda metido debajo de la lata anterior; el alto se levanta y pisa a la que sigue.
      const l0 = haciaMas ? l : Math.max(-largo / 2, l - traslapo), l1 = haciaMas ? Math.min(largo / 2, l + d + traslapo) : l + d;
      const h0 = y + .035 + subida(l0) + (haciaMas ? paso : 0), h1 = y + .035 + subida(l1) + (haciaMas ? 0 : paso);
      // El óxido de la celda nace en el lado bajo, donde asoma del traslapo.
      const rect = haciaMas ? [cara[2], cara[1], cara[0], cara[3]] : cara, t0 = t, t1 = t + w;
      const cae = (h0 - h1) / (l1 - l0), unidad = Math.hypot(1, cae), normal = [girada ? cae / unidad : 0, 1 / unidad, girada ? 0 : cae / unidad];
      piezas.quad(girada ? [[l0, h0, t1], [l1, h1, t1], [l1, h1, t0], [l0, h0, t0]] : [[t0, h0, l0], [t0, h1, l1], [t1, h1, l1], [t1, h0, l0]], normal, rect);
      hojas.push([l0, l1, t0, t1, h0, h1]);
      l += d;
    }
    t += w;
  }
  return (u, v) => {
    const l = girada ? u : v, t = girada ? v : u;
    let alto = y + .035;
    for (const [l0, l1, t0, t1, h0, h1] of hojas) {
      if (l >= l0 && l <= l1 && t >= t0 - .01 && t <= t1 + .01) alto = Math.max(alto, h0 + (h1 - h0) * (l - l0) / (l1 - l0));
    }
    return alto;
  };
}

/** Lo que sujeta una lata: una llanta vieja, un ladrillo o una piedra. */
function peso(piezas, UV, r, u, y, v) {
  const k = r();
  if (k < .26) { piezas.cilindro(UV.tire, u, y, v, .31, .31, .17); piezas.lamina(UV.tire, u, y + .17, v, .44, .44, 0); }
  else if (k < .6) piezas.box(UV.rust, u, y, v, .24, .08, .12);
  else {
    const ancho = .2 + r() * .14, alto = .11 + r() * .08, giro = r() * 10;
    piezas.piedra(UV.canvas, u, y, v, ancho * .62, alto * .8, giro % 1 < .5 ? 5 : 6, giro);
  }
}

/** Losa gris y sucia, por paños de dos metros, con alguna lata suelta que tapa una gotera. Cubre toda la huella. */
function losaGris(piezas, UV, r, { ancho, fondo, alto: y }) {
  const nx = Math.max(1, Math.round(ancho / 2)), nz = Math.max(1, Math.round(fondo / 2)), w = ancho / nx, d = fondo / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const c = UV.canvas, k = Math.floor(r() * 4);
    // Cada paño gira la celda: las manchas no se repiten en fila.
    const celda = [k & 1 ? c[2] : c[0], k & 2 ? c[3] : c[1], k & 1 ? c[0] : c[2], k & 2 ? c[1] : c[3]];
    piezas.lamina(celda, -ancho / 2 + (i + .5) * w, y + .012, -fondo / 2 + (j + .5) * d, w, d, 0, r() < .5);
  }
  const sueltas = Math.min(Math.floor(ancho * fondo / 14) + (r() < .6 ? 1 : 0), 4);
  for (let i = 0; i < sueltas; i++) {
    const porZ = r() < .5, lw = porZ ? .95 : 1.7 + r() * .6, ld = porZ ? 1.7 + r() * .6 : .95;
    if (lw > ancho - .7 || ld > fondo - .7) continue;
    const u = (r() * 2 - 1) * (ancho / 2 - .35 - lw / 2), v = (r() * 2 - 1) * (fondo / 2 - .35 - ld / 2);
    piezas.lamina(r() < .6 ? UV.lata : oxidada(UV), u, y + .04 + i * .012, v, lw, ld, (r() - .5) * .05, porZ);
    peso(piezas, UV, r, u + (r() - .5) * lw * .6, y + .07, v + (r() - .5) * ld * .6);
    if (r() < .6) peso(piezas, UV, r, u + (r() - .5) * lw * .6, y + .07, v + (r() - .5) * ld * .6);
  }
}

/** Lo que hay encima: tanque, varillas a la espera, pesos sobre las latas y ropa. Todo dentro de la huella. */
function vidaDeAzotea(piezas, UV, r, { ancho, fondo, alto, ruina, conPesos, encima }) {
  const hw = ancho / 2 - .3, hd = fondo / 2 - .3, y = alto + .08;
  const esquinas = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let i = esquinas.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [esquinas[i], esquinas[j]] = [esquinas[j], esquinas[i]]; }
  const amplio = ancho >= 3.6 && fondo >= 3.6;
  let tanque = null;
  if (!ruina && amplio && r() < .8) {
    const [a, b] = esquinas.pop(), u = a * (hw - .6), v = b * (hd - .6);
    tanque = [u, v];
    // Sobre latas, la base asoma lo mismo que sobre la losa.
    const base = encima ? Math.max(.22, encima(u, v) + .14 - y) : .22;
    piezas.box(UV.canvas, u, y, v, 1.15, base, 1.15);
    // La tapa toma la franja de arriba de la celda, la del polvo que aclara el sol.
    const t = UV.tank, tapa = [t[0], t[3] - (t[3] - t[1]) * .16, t[2], t[3]];
    piezas.cilindro(t, u, y + base, v, .5, .55, 1.02, 16, true);
    piezas.cilindro(tapa, u, y + base + 1.02, v, .56, .12, .15, 16, true);
    // La bajante del tanque, oxidada.
    if (r() < .5) { piezas.box(UV.rust, u - a * .62, y, v, .05, 1.1, .05); piezas.box(UV.rust, u - a * .36, y + 1.08, v, .55, .05, .05); }
  }
  // Varillas de la plancha que nunca se fundió: la casa sigue esperando otro piso.
  if (ruina || r() < .7) {
    const cuantas = Math.min(2 + Math.floor(r() * 3), esquinas.length);
    for (let i = 0; i < cuantas; i++) {
      const [a, b] = esquinas[i], u = a * (hw + .12), v = b * (hd + .12), tocon = .3 + r() * .6;
      piezas.box(UV.canvas, u, alto, v, .3, tocon, .3);
      for (const [ku, kv] of [[-.09, -.09], [.09, -.09], [-.09, .09], [.09, .09]]) {
        piezas.box(UV.rebar, u + ku, alto + tocon, v + kv, .03, .7 + r() * .9, .03);
      }
    }
  }
  const libre = (u, v) => !tanque || Math.hypot(u - tanque[0], v - tanque[1]) > 1.05;
  // Las latas no van clavadas: las sujetan piedras, ladrillos y llantas viejas.
  const pesos = conPesos ? Math.min(Math.round(ancho * fondo / 6) + 2 + Math.floor(r() * 3), 14) : 0;
  for (let i = 0; i < pesos; i++) {
    const u = (r() * 2 - 1) * (hw - .1), v = (r() * 2 - 1) * (hd - .1);
    if (libre(u, v)) peso(piezas, UV, r, u, encima ? encima(u, v) : y, v);
  }
  if (!ruina && ancho >= 4.4 && r() < .5) {
    // Dos parales, dos cuerdas y lo que se esté secando.
    const v = (r() * 2 - 1) * hd * .35, largo = Math.min(hw * 1.5, 5.2), cuerda = y + 1.72;
    if (libre(-largo / 2, v) && libre(largo / 2, v) && libre(0, v)) {
      for (const u of [-largo / 2, largo / 2]) piezas.box(UV.wood, u, y, v, .06, 1.8, .06);
      for (const k of [-.14, .14]) piezas.box(UV.rust, 0, cuerda, v + k, largo, .012, .012);
      const prendas = 3 + Math.floor(r() * 4), telas = [UV.cloth, UV.cloth2, UV.cloth3];
      for (let i = 0; i < prendas; i++) {
        const u = -largo / 2 + largo * (i + .5) / prendas + (r() - .5) * .15, w = .36 + r() * .3, h = .5 + r() * .45;
        piezas.panel(telas[Math.floor(r() * telas.length)], u, cuerda - h / 2, v + (i % 2 ? .14 : -.14), w, h);
      }
    }
  }
}

/** Sobre la losa, solo concreto (es el material de ese techo): tanque de fibrocemento, columnas a medio fundir y cuarto de escalera. */
function obraEnLosa(piezas, r, { ancho, fondo, alto: y }) {
  const hw = ancho / 2 - .3, hd = fondo / 2 - .3, LOSA = [.08, .08, .3, .3];
  const esquinas = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let i = esquinas.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [esquinas[i], esquinas[j]] = [esquinas[j], esquinas[i]]; }
  if (ancho >= 3.6 && fondo >= 3.6 && r() < .75) {
    const [a, b] = esquinas.pop(), u = a * (hw - .6), v = b * (hd - .6);
    piezas.box(LOSA, u, y, v, 1.2, .2, 1.2);
    piezas.box(LOSA, u, y + .2, v, .95, .85, .95);
    piezas.box(LOSA, u, y + 1.05, v, 1.05, .06, 1.05);
  }
  if (ancho >= 6 && fondo >= 6 && r() < .45) {
    const [a, b] = esquinas.pop(), u = a * (hw - 1), v = b * (hd - 1);
    piezas.box(LOSA, u, y, v, 1.9, 2.2, 1.9);
    piezas.box(LOSA, u, y + 2.2, v, 2.1, .1, 2.1);
  }
  const cuantas = Math.min(1 + Math.floor(r() * 3), esquinas.length);
  for (let i = 0; i < cuantas; i++) {
    const [a, b] = esquinas[i];
    piezas.box(LOSA, a * (hw + .12), y, b * (hd + .12), .3, .3 + r() * .7, .3);
  }
}

/**
 * Antepecho de ladrillo sobre una pared (cara 0 y 1: las de x; 4 y 5: las de z): la azotea queda como terraza de obra y
 * no como tapa de caja. Las hiladas siguen las de la pared. Los de z se acortan para no pisar las esquinas de los de x.
 */
const JUNTA = 21 / 24;
function antepecho(piezas, cara, altura, { ancho, fondo, alto, uv }) {
  const GRUESO = .14, enX = cara < 2, signo = cara === 0 || cara === 4 ? 1 : -1;
  const medio = (enX ? ancho : fondo) / 2, largo = enX ? fondo : ancho - GRUESO * 2;
  if (largo < .6) return;
  const fuera = signo * (medio - .015), dentro = signo * (medio - GRUESO), y0 = alto, y1 = alto + altura;
  const [bw, bh] = uv.brick, P = (a, y, c) => enX ? [c, y, a] : [a, y, c], N = (c) => enX ? [c, 0, 0] : [0, 0, c];
  const muro = (c, normal) => {
    // El orden de los vértices sigue a la normal: así la cara mira hacia donde se ilumina.
    const haciaZ = enX ? normal > 0 : normal < 0, a0 = haciaZ ? largo / 2 : -largo / 2;
    piezas.quad([P(a0, y0, c), P(-a0, y0, c), P(-a0, y1, c), P(a0, y1, c)], N(normal), [0, y0 / bh, largo / bw, y1 / bh]);
  };
  muro(fuera, signo);
  muro(dentro, -signo);
  const c0 = Math.min(fuera, dentro), c1 = Math.max(fuera, dentro);
  piezas.quad(enX
    ? [P(-largo / 2, y1, c0), P(largo / 2, y1, c0), P(largo / 2, y1, c1), P(-largo / 2, y1, c1)]
    : [P(-largo / 2, y1, c1), P(largo / 2, y1, c1), P(largo / 2, y1, c0), P(-largo / 2, y1, c0)],
  // El canto es el mortero de una junta entre hiladas, no una fila de ladrillos acostados a pleno sol.
  [0, 1, 0], [0, JUNTA, largo / bw, JUNTA]);
}

const geometriaDe = ({ out }) => {
  const geometry = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'uv']) geometry.setAttribute(key, new THREE.Float32BufferAttribute(out[key], key === 'uv' ? 2 : 3));
  geometry.setIndex(out.index);
  return geometry;
};

/**
 * Viste un bloque de relleno y lo registra en la visibilidad de edificios (devuelve lo que devuelve el registro).
 * El zócalo queda de concreto, como estaba; `uv` trae las unidades de ladrillo y de losa de la ciudad.
 */
export function vestirRelleno({ shell, visibilidad, x, z, ancho, fondo, alto, ruina = false, ladrillo, uv }) {
  const r = rng((Math.imul(x + 11, 73856093) ^ Math.imul(z + 5, 19349663) ^ 0x2e71a05) >>> 0);
  // La mitad (y toda ruina) con latas, tres de cada diez con losa gris y lo suyo encima, el resto con la losa de siempre.
  const suerte = r(), tipo = ruina || suerte < .5 ? 'latas' : suerte < .82 ? 'gris' : 'losa', girada = r() < .5;
  // Las cuatro paredes altas pasan de losa a ladrillo: mismas mallas, y el material ya lo usan las casas.
  const ku = uv.slab[0] / uv.brick[0], kv = uv.slab[1] / uv.brick[1];
  for (const pared of shell.walls.values()) {
    const malla = pared.children[0], coords = malla.geometry.attributes.uv;
    malla.material = ladrillo;
    for (let i = 0; i < coords.count; i++) coords.setXY(i, coords.getX(i) * ku, coords.getY(i) * kv);
  }
  // El registro gasta lo mismo que antes: cinco piezas, cinco materiales.
  const edificio = visibilidad.register(shell);
  const parte = edificio?.roofPart, techo = shell.roof.children[0];
  if (!parte || !techo?.geometry.index) return edificio;
  sinGastarAzar(() => {
    const piezas = lote(), molde = tipo !== 'losa' ? moldeDeVida(visibilidad) : null;
    let geometry;
    if (molde) {
      const UV = detailAtlas().uv;
      let encima = null;
      if (tipo === 'latas') encima = latas(piezas, UV, r, { ancho, fondo, alto, girada });
      else losaGris(piezas, UV, r, { ancho, fondo, alto });
      vidaDeAzotea(piezas, UV, r, { ancho, fondo, alto, ruina, conPesos: tipo === 'latas', encima });
      geometry = geometriaDe(piezas);
      // Copia del material de las azoteas de las casas: se atenúa con este techo y cierra en sus lotes de siempre.
      const material = molde.clone(), losa = techo.material;
      parte.materials[parte.materials.indexOf(losa)] = material;
      techo.material = material;
      losa.dispose();
    } else {
      obraEnLosa(piezas, r, { ancho, fondo, alto });
      if (!piezas.out.index.length) return;
      const obra = geometriaDe(piezas);
      geometry = mergeGeometries([techo.geometry, obra]);
      obra.dispose();
      if (!geometry) return;
    }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    techo.geometry.dispose();
    techo.geometry = geometry;
    parte.bounds.union(new THREE.Box3().setFromObject(techo).expandByScalar(.08));
  });
  // Lo que queda en pie de una ruina no tiene antepecho; en lo demás, alguna pared se quedó sin levantar o a media altura.
  if (!ruina) sinGastarAzar(() => {
    const base = .3 + r() * .26;
    [...shell.walls].forEach(([cara, pared], i) => {
      const altura = base * (r() < .22 ? .45 : 1), malla = pared.children[0], piezas = lote();
      if (r() < .12 || !malla?.geometry.index) return;
      antepecho(piezas, cara, altura, { ancho, fondo, alto, uv });
      if (!piezas.out.index.length) return;
      const remate = geometriaDe(piezas), geometry = mergeGeometries([malla.geometry, remate]);
      remate.dispose();
      if (!geometry) return;
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      malla.geometry.dispose();
      malla.geometry = geometry;
      edificio.wallParts[i]?.bounds.union(new THREE.Box3().setFromObject(malla).expandByScalar(.08));
    });
  });
  return edificio;
}
