// src/entities/cambuche/patio.js
// Lo que rodea al cambuche y lo que se le suma encima cuando ya está terminado: el patio (asiento, balde, ropa
// tendida, lo reciclado), las capas del techo sobre el modelo (zinc, polisombra, plástico negro, llanta, piedras y
// cuerdas) y la luz cálida de la noche. Medidas en metros del mundo, con el cambuche en el origen y la entrada en +Z.
import * as THREE from 'three';
import { Maqueta, PALETA as P } from './maqueta.js';
import { acostado, cortina } from './piezas.js';

/** Con cuántas piezas armadas aparece cada parte del patio: se va poblando a medida que se arma. */
export const PATIO = Object.freeze({ rincon: 1, tendedero: 2, reciclaje: 4 });

/** Un guacal bocabajo de asiento y el balde del agua. */
export function rincon() {
  const m = new Maqueta(71), g = new Maqueta(72);
  // Guacal: cuatro parales, listones a los lados y encima.
  for (const [x, z] of [[-.2, -.15], [.2, -.15], [-.2, .15], [.2, .15]]) g.caja(.035, .3, .035, P.guacal, { en: [x, .15, z] });
  for (const y of [.07, .19]) {
    g.caja(.44, .05, .02, P.guacal, { en: [0, y, -.165] }); g.caja(.44, .05, .02, P.guacal, { en: [0, y, .165] });
    g.caja(.02, .05, .32, P.guacal, { en: [-.215, y, 0] }); g.caja(.02, .05, .32, P.guacal, { en: [.215, y, 0] });
  }
  for (let i = 0; i < 4; i++) g.caja(.085, .02, .34, P.guacal, { en: [-.165 + i * .11, .3, 0], tono: .12 });
  m.suma(g, [.3, 0, 1.82], .35);
  // Balde de pintura con agua.
  m.cilindro(.115, .26, P.balde, { lados: 8, en: [.9, 0, 2.06], radioArriba: .14, tono: .05 });
  m.cilindro(.125, .01, '#39485a', { lados: 8, en: [.9, .22, 2.06], tono: .03 });
  m.cilindro(.147, .02, P.balde, { lados: 8, en: [.9, .25, 2.06], tono: .04 });
  m.pon(new THREE.TorusGeometry(.14, .008, 3, 6, Math.PI), P.lata, { en: [.9, .26, 2.06], giro: [.9, .4, 0, 'YXZ'] });
  return m;
}

/** Cuerda entre dos palos, con la ropa colgada. */
export function tendedero() {
  const m = new Maqueta(83);
  const a = [2.78, 0, 1.15], b = [2.58, 0, -1.75], alto = 1.72;
  m.palo(a, [a[0] - .05, alto + .12, a[2] - .06], .032); m.palo(b, [b[0] + .04, alto + .1, b[2] + .08], .03);
  m.palo([a[0] - .05, alto, a[2] - .06], [a[0] + .28, .03, a[2] + .5], .009, P.cuerda, 4);
  m.palo([b[0] + .04, alto, b[2] + .08], [b[0] + .3, .03, b[2] - .45], .009, P.cuerda, 4);
  const linea = t => [a[0] - .05 + (b[0] + .09 - a[0]) * t, alto - .13 * Math.sin(Math.PI * t), a[2] - .06 + (b[2] + .14 - a[2]) * t];
  for (let i = 0; i < 6; i++) m.palo(linea(i / 6), linea((i + 1) / 6), .007, P.cuerda, 4);
  // Cada prenda cuelga entre dos puntos de la cuerda y se arruga hacia abajo.
  const prenda = (t0, t1, largo, color) => m.tela(3, 4, (u, v) => {
    const [x, y, z] = linea(t0 + (t1 - t0) * u);
    return [x + Math.sin(u * 5 + v * 2) * .03 * v, y - .01 - largo * v, z];
  }, color, { tono: .1 });
  prenda(.1, .27, .52, P.camisa);
  prenda(.33, .43, .72, P.mezclilla);
  prenda(.445, .545, .7, P.mezclilla);
  prenda(.62, .74, .44, P.cobija);
  prenda(.8, .9, .3, P.sabana);
  return m;
}

/** Lo reciclado, ordenado: costales de lona llenos y el cartón aplanado y amarrado. */
export function reciclaje() {
  const m = new Maqueta(97), r = m.r;
  const costal = (x, z, radio, alto, giro) => {
    // Panza ancha abajo, hombros caídos y la boca amarrada con cabuya.
    m.cilindro(radio * .92, alto * .62, P.costal, { lados: 6, radioArriba: radio, en: [x, 0, z], giro: [0, giro, 0], escala: [1.05, 1, .82], tono: .1 });
    m.cilindro(radio, alto * .26, P.costal, { lados: 6, radioArriba: radio * .2, en: [x, alto * .62, z], giro: [0, giro, 0], escala: [1.05, 1, .82], tono: .1 });
    m.cilindro(radio * .17, alto * .12, P.costal, { lados: 5, radioArriba: radio * .3, en: [x, alto * .88, z], giro: [.25, giro, 0], tono: .1 });
    m.caja(radio * .38, .025, radio * .38, P.cuerda, { en: [x, alto * .88, z], giro: [0, giro, 0] });
  };
  costal(-2.55, -1.0, .3, .58, .4); costal(-2.92, -.52, .27, .5, 1.3); costal(-2.46, -.42, .25, .44, 2.2);
  // Cartón aplanado en un atado, con dos vueltas de cabuya.
  for (let i = 0; i < 5; i++) m.caja(.78 + r() * .06, .035, .56 + r() * .05, i % 2 ? P.cartonViejo : P.carton, { en: [-2.62, .03 + i * .037, .42], giro: [0, .5 + (r() - .5) * .08, 0], tono: .05 });
  for (const d of [-.2, .2]) m.caja(.016, .2, .62, P.cuerda, { en: [-2.62 + d * Math.cos(.5), .1, .42 - d * Math.sin(.5)], giro: [0, .5, 0] });
  // Una llanta vieja recostada, con botellas aplastadas adentro.
  m.llanta(.3, [-2.2, .1, -1.72], [Math.PI / 2 - .12, 0, .05, 'ZYX']);
  return m;
}

/** Alturas del modelo terminado vistas desde arriba, para apoyarle cosas encima sin atravesarlo. */
export function alturasDelModelo(model, group, celda = .25) {
  group.updateWorldMatrix(true, true);
  const toGroup = group.matrixWorld.clone().invert(), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  const cells = new Map(), key = (i, k) => i * 4096 + k;
  model.traverse(object => {
    const positions = object.geometry?.attributes.position;
    if (!positions) return;
    matrix.multiplyMatrices(toGroup, object.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      const id = key(Math.floor(point.x / celda) + 2048, Math.floor(point.z / celda) + 2048);
      if (point.y > (cells.get(id) ?? 0)) cells.set(id, point.y);
    }
  });
  /** La mayor altura en un cuadro de `radio` metros alrededor del punto. */
  return (x, z, radio = 0) => {
    let top = 0;
    for (let i = Math.floor((x - radio) / celda); i <= Math.floor((x + radio) / celda); i++) {
      for (let k = Math.floor((z - radio) / celda); k <= Math.floor((z + radio) / celda); k++) top = Math.max(top, cells.get(key(i + 2048, k + 2048)) ?? 0);
    }
    return top;
  };
}

/**
 * Las capas que cuentan la historia desde arriba, apoyadas en el techo del modelo terminado: una teja de zinc,
 * un alero de polisombra, plástico negro echado a un lado, remiendos, una llanta, piedras, cuerdas, la cobija
 * de cortina y la tabla del nombre (la pintura va aparte, en `letreros.js`).
 */
export function cubierta(alturas) {
  const m = new Maqueta(101);
  const techo = (x, z) => alturas(x, z, .14);
  // Teja de zinc: rígida, así que va en un plano que libra todo lo que tiene debajo.
  {
    const cx = -.78, cz = -.72, w = 1.62, d = 1.02, giro = .1, n = 12;
    const at = (u, v) => { const lx = (u - .5) * w, lz = (v - .5) * d; return [cx + lx * Math.cos(giro) + lz * Math.sin(giro), cz - lx * Math.sin(giro) + lz * Math.cos(giro)]; };
    const corner = (u, v) => techo(...at(u, v));
    const plano = (u, v) => corner(0, 0) * (1 - u) * (1 - v) + corner(1, 0) * u * (1 - v) + corner(0, 1) * (1 - u) * v + corner(1, 1) * u * v;
    let sube = 0;
    for (let i = 0; i <= 6; i++) for (let k = 0; k <= 4; k++) sube = Math.max(sube, corner(i / 6, k / 4) - plano(i / 6, k / 4));
    const lamina = (u, v) => plano(u, v) + sube + .03;
    m.tela(n, 2, (u, v) => { const [x, z] = at(u, v); return [x, lamina(u, v) + (Math.round(u * n) % 2 ? .045 : 0), z]; },
      (u, v) => (u > .16 && u < .26 && v < .5) || (u > .9 && v > .5) ? P.oxido : Math.floor(u * n) % 2 ? P.zinc : P.zincOscuro, { tono: .07 });
    // La sujetan una llanta vieja y una piedra.
    const [lx, lz] = at(.62, .5), [px, pz] = at(.1, .22);
    m.llanta(.27, [lx, lamina(.62, .5) + .14, lz], acostado((x, z) => plano((x - cx) / w + .5, (z - cz) / d + .5), lx, lz));
    m.piedra(.1, [px, lamina(.1, .22) + .04, pz]);
  }
  // Remiendos y cinta sobre la lona del modelo.
  for (const [x0, z0, w, d, color] of [[.3, -.95, .5, .42, P.lonaClara], [-.95, .12, .5, .08, P.cinta], [-.85, -.05, .42, .08, P.cinta]]) {
    m.tela(2, 2, (u, v) => { const x = x0 + u * w, z = z0 + v * d; return [x, alturas(x, z, .2) + .035, z]; }, color, { tono: .06 });
  }
  // Piedras que sujetan la lona.
  for (const [x, z, radio] of [[-1.5, .35, .1], [.95, -1.05, .09], [1.15, -.3, .085], [.1, .45, .08]]) m.piedra(radio, [x, techo(x, z) + .01, z]);
  // Plástico negro echado sobre lo que se guarda al costado derecho: baja pegado a lo que tapa.
  {
    const filas = [];
    m.tela(5, 4, (u, v) => {
      const x = 1.08 + u * 1.0, z = -1.2 + v * 1.25;
      const y = Math.max(alturas(x, z, .16) + .05, .05), fila = Math.round(v * 4);
      return [x, filas[fila] = Math.min(filas[fila] ?? Infinity, y), z];
    }, P.plastico, { tono: .45 });
  }
  // Alero de polisombra sobre el frente izquierdo, en dos palos, con la tabla del nombre colgada.
  {
    const x0 = -1.78, x1 = -.25, z0 = .5, z1 = 1.62, borde = x => Math.max(techo(x, z0), techo(x, z0 - .2)) + .06;
    m.tela(6, 4, (u, v) => {
      const x = x0 + (x1 - x0) * u;
      return [x, borde(x) + (1.52 - borde(x)) * v - .07 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), z0 + (z1 - z0) * v];
    }, P.polisombra, { tono: .12 });
    m.palo([x0 + .04, 0, z1], [x0, 1.6, z1 - .03], .034); m.palo([x1 - .04, 0, z1 + .02], [x1, 1.6, z1 - .03], .034);
    m.palo([x0 - .1, 1.53, z1 - .02], [x1 + .1, 1.53, z1 - .02], .026);
    m.piedra(.085, [x0 + .5, borde(x0 + .5) - .02, z0]); m.piedra(.08, [x1 - .4, borde(x1 - .4) - .02, z0 + .02]);
    m.caja(TABLA.ancho, TABLA.alto, .025, P.tablaVieja, { en: TABLA.en, giro: [0, 0, TABLA.caida], tono: .05 });
    for (const d of [-.36, .36]) m.palo([TABLA.en[0] + d, 1.53, z1 - .02], [TABLA.en[0] + d, TABLA.en[1] + TABLA.alto / 2 - .02, TABLA.en[2]], .006, P.cuerda, 4);
  }
  // Cuerdas a estacas.
  for (const [x, z, sx, sz] of [[-1.55, -1.05, -2.2, -1.85], [1.2, -1.05, 1.95, -1.9]]) {
    m.palo([x, techo(x, z) + .03, z], [sx, .04, sz], .008, P.cuerda, 4);
    m.palo([sx, 0, sz], [sx + (sx - x) * .03, .16, sz + (sz - z) * .03], .02, P.palo, 4);
  }
  // La cobija de cortina, recogida a la izquierda de la entrada.
  cortina(m, .04, .9, .74, x => Math.min(Math.max(alturas(x, .5, .12), 1.3), 1.5), .1);
  return m;
}

/** La tabla con el nombre pintado: cuelga del alero, de cara a quien llega. */
export const TABLA = Object.freeze({ ancho: .98, alto: .24, en: [-1.0, 1.3, 1.605], caida: -.035 });

/** Luz cálida que sale por la entrada: un velo en el hueco y la mancha en el piso. Se suma, no tapa. */
export function resplandor() {
  const m = new Maqueta(113), calido = new THREE.Color('#ff9a3c');
  const luz = k => calido.clone().multiplyScalar(k);
  // Fuerte en el centro del hueco y nada en los bordes, para que no se vea el borde del velo.
  const hueco = (u, v) => Math.sin(Math.PI * u) ** 1.5 * Math.sin(Math.PI * Math.min(1, v * 1.15)) ** 1.2;
  m.tela(6, 6, (u, v) => [.3 + u * .95, .1 + v * 1.25, .68], (u, v) => luz(.3 * hueco(u, v)), { tono: 0, suave: true });
  m.tela(6, 4, (u, v) => [.72 + (u - .5) * (.9 + v * 1.3), .085, .78 + v * 1.3], (u, v) => luz(.22 * Math.sin(Math.PI * u) * (1 - v) ** 1.4), { tono: 0, suave: true });
  return m;
}

/** Rendijas entre las tablas de las paredes armadas a mano, en las medidas de la pieza. */
export function rendijas() {
  const m = new Maqueta(127), calido = new THREE.Color('#ff9a3c').multiplyScalar(.9);
  for (const z of [-.8, -.4, .4]) m.tela(1, 1, (u, v) => [-1.622, .12 + v * .62, z + u * .018], calido, { tono: 0 });
  for (const x of [-1.31, .0, 1.3]) m.tela(1, 1, (u, v) => [x + u * .018, .12 + v * .7, -1.222], calido, { tono: 0 });
  for (const z of [-.8, -.4]) m.tela(1, 1, (u, v) => [1.622, .12 + v * .8, z + u * .018], calido, { tono: 0 });
  return m;
}
