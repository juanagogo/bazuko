// src/entities/cambuche/patio.js
// Lo que rodea al cambuche y lo que se le suma encima cuando ya está terminado: el patio (asiento, balde, ropa
// tendida, lo reciclado), las capas del techo sobre el modelo (zinc, polisombra, llanta y piedras)
// y la luz cálida de la noche. Medidas en metros del mundo, con el cambuche en el origen y la entrada en +Z.
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

/** Cuerda corta entre dos palos, en la esquina de atrás, con la ropa colgada. */
export function tendedero() {
  const m = new Maqueta(83);
  const a = [.45, 0, -2.25], b = [2.05, 0, -1.4], alto = 1.6;
  m.palo(a, [a[0] + .04, alto + .12, a[2] + .03], .032); m.palo(b, [b[0] - .05, alto + .1, b[2] - .02], .03);
  const linea = t => [a[0] + .04 + (b[0] - .09 - a[0]) * t, alto - .1 * Math.sin(Math.PI * t), a[2] + .03 + (b[2] - .05 - a[2]) * t];
  for (let i = 0; i < 6; i++) m.palo(linea(i / 6), linea((i + 1) / 6), .007, P.cuerda, 4);
  // Cada prenda cuelga entre dos puntos de la cuerda, se arruga hacia abajo y se ensucia en el ruedo.
  const prenda = (t0, t1, largo, color) => m.tela(4, 5, (u, v) => {
    const [x, y, z] = linea(t0 + (t1 - t0) * u);
    return [x + Math.sin(u * 5 + v * 2) * .035 * v, y - .01 - largo * v + .02 * Math.sin(u * 9) * v, z + Math.cos(u * 6 + v * 3) * .03 * v];
  }, color, { tono: .08, sombra: (u, v) => 1 - .25 * v * v });
  prenda(.08, .34, .5, P.camisa);
  prenda(.42, .6, .7, P.mezclilla);
  prenda(.68, .92, .42, P.cobija);
  return m;
}

/** Lo reciclado, recostado contra el cambuche: el cartón aplanado y amarrado, listo para llevar a vender. */
export function reciclaje() {
  const m = new Maqueta(97), r = m.r;
  // Cartón aplanado en un atado, con dos vueltas de cabuya.
  for (let i = 0; i < 5; i++) m.caja(.74 + r() * .06, .035, .52 + r() * .05, i % 2 ? P.cartonViejo : P.carton, { en: [-2.22, .03 + i * .037, .36], giro: [0, 1.35 + (r() - .5) * .08, 0], tono: .05 });
  for (const d of [-.18, .18]) m.caja(.016, .2, .58, P.cuerda, { en: [-2.22 + d * Math.cos(1.35), .1, .36 - d * Math.sin(1.35)], giro: [0, 1.35, 0] });
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
 * un alero de polisombra, cinta, una llanta, piedras, la cobija de cortina y la tabla del nombre (la pintura va
 * aparte, en `letreros.js`).
 */
export function cubierta(alturas) {
  const m = new Maqueta(101);
  const techo = (x, z) => alturas(x, z, .14);
  const orilla = (u, v) => Math.min(u, 1 - u, v, 1 - v) < .001 ? .62 : 1;
  // Teja de zinc: rígida, así que va en un plano que libra todo lo que tiene debajo. Vieja: óxido en bandas y
  // las orillas oscuras.
  {
    const cx = -.78, cz = -.72, w = 1.62, d = 1.02, giro = .1, n = 12;
    const at = (u, v) => { const lx = (u - .5) * w, lz = (v - .5) * d; return [cx + lx * Math.cos(giro) + lz * Math.sin(giro), cz - lx * Math.sin(giro) + lz * Math.cos(giro)]; };
    const corner = (u, v) => techo(...at(u, v));
    const plano = (u, v) => corner(0, 0) * (1 - u) * (1 - v) + corner(1, 0) * u * (1 - v) + corner(0, 1) * (1 - u) * v + corner(1, 1) * u * v;
    let sube = 0;
    for (let i = 0; i <= 6; i++) for (let k = 0; k <= 4; k++) sube = Math.max(sube, corner(i / 6, k / 4) - plano(i / 6, k / 4));
    const lamina = (u, v) => plano(u, v) + sube + .03;
    m.tela(n, 3, (u, v) => { const [x, z] = at(u, v); return [x, lamina(u, v) + (Math.round(u * n) % 2 ? .022 : 0), z]; },
      (u, v) => (u > .16 && u < .26) || (u > .58 && u < .67 && v > .34) || u > .92 || (v > .67 && u < .09) ? P.oxido : Math.floor(u * n) % 2 ? P.zinc : P.zincOscuro,
      { tono: .08, sombra: orilla });
    // La sujetan una llanta vieja y una piedra.
    const [lx, lz] = at(.62, .5), [px, pz] = at(.1, .22);
    m.llanta(.27, [lx, lamina(.62, .5) + .12, lz], acostado((x, z) => plano((x - cx) / w + .5, (z - cz) / d + .5), lx, lz));
    m.piedra(.1, [px, lamina(.1, .22) + .02, pz]);
  }
  // Cinta gris sobre una rasgadura de la lona del modelo.
  for (const [x0, z0, w, d] of [[-.95, .12, .5, .08], [-.85, -.05, .42, .08]]) {
    m.tela(3, 1, (u, v) => { const x = x0 + u * w, z = z0 + v * d; return [x, alturas(x, z, .2) + .03, z]; }, P.cinta, { tono: .06, sombra: orilla });
  }
  // Piedras que sujetan la lona.
  for (const [x, z, radio] of [[-1.5, .35, .1], [.95, -1.05, .09], [1.15, -.3, .085], [.1, .45, .08]]) m.piedra(radio, [x, techo(x, z) + .01, z]);
  // Alero de polisombra sobre el frente izquierdo, en dos palos, con la tabla del nombre colgada. La malla cuelga
  // entre sus apoyos y la orilla de afuera quedó dispareja.
  {
    const x0 = -1.78, x1 = -.25, z0 = .5, z1 = 1.62, borde = x => Math.max(techo(x, z0), techo(x, z0 - .2)) + .06;
    m.tela(8, 5, (u, v) => {
      const suelta = v === 1 ? .06 + .08 * Math.sin(u * 13) + .05 * Math.sin(u * 29) : 0;
      const x = x0 + (x1 - x0) * u + (u === 0 ? .06 : u === 1 ? -.06 : 0) * Math.sin(Math.PI * v);
      const cuelga = .1 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + .04 * Math.sin(Math.PI * u) * v + .03 * Math.sin(Math.PI * v);
      return [x, borde(x) + (1.52 - borde(x)) * v - cuelga - Math.abs(suelta) * .7, z0 + (z1 - z0) * v + suelta];
    }, P.polisombra, { tono: .14, sombra: (u, v) => orilla(u, v) < 1 ? .7 : 1 });
    m.palo([x0 + .04, 0, z1], [x0, 1.6, z1 - .03], .034); m.palo([x1 - .04, 0, z1 + .02], [x1, 1.6, z1 - .03], .034);
    m.palo([x0 - .1, 1.53, z1 - .02], [x1 + .1, 1.53, z1 - .02], .026);
    m.piedra(.085, [x0 + .5, borde(x0 + .5) - .02, z0]); m.piedra(.08, [x1 - .4, borde(x1 - .4) - .02, z0 + .02]);
    m.caja(TABLA.ancho, TABLA.alto, .025, P.tablaVieja, { en: TABLA.en, giro: [0, 0, TABLA.caida], tono: .05 });
    for (const d of [-.36, .36]) m.palo([TABLA.en[0] + d, 1.53, z1 - .02], [TABLA.en[0] + d, TABLA.en[1] + TABLA.alto / 2 - .02, TABLA.en[2]], .006, P.cuerda, 4);
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
