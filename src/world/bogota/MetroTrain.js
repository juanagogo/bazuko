// Carrocería del tren de pruebas de la Caracas. Mantiene los tres vagones a escala del mapa.
import * as THREE from 'three';
import { Batch, FACES } from './ZoneGeometry.js';
import { trainRect } from './MetroTrainTextures.js';
import { withVisualRandom } from './VisualRandom.js';
import { animateMetroTrain, METRO_RUN } from './MetroOperation.js';

const WIDTH = 1.55, HALF_LENGTH = 9, CABIN_JOIN = 7.2;
const DOORS = [-6.6, -2.25, 2.25, 6.6];
const CABIN_DOORS = [-6.6, -2.55, 1.31, 4.89];
const BOX_TOP_SIDES = FACES.front | FACES.back | FACES.left | FACES.right | FACES.top;
// Secciones de abajo hacia arriba. z es el avance del morro y x es su semiancho.
const NOSE = [
  [-1.44, 10.32, 1.04], [-1.20, 10.60, 1.14], [-.84, 10.53, 1.25], [-.40, 10.40, 1.26],
  [.12, 10.16, 1.24], [.62, 9.88, 1.17], [1.08, 9.51, 1.10], [1.45, 9.17, 1.02],
  [1.67, 8.89, .91], [1.77, 8.59, .73]
];
const ROOF = [
  [-1.55, 1.18], [-1.48, 1.43], [-1.25, 1.65], [-.77, 1.77], [.77, 1.77],
  [1.25, 1.65], [1.48, 1.43], [1.55, 1.18]
];
const FACE_SAMPLES = [-1, -.67, -.34, 0, .34, .67, 1];
const SECTIONS = [...new Set([...NOSE.map(([y]) => y), ...ROOF.map(([, y]) => y), -1.39, -1.2, -.66])].sort((a, b) => a - b);
const BODY_EDGE = [[1.54, -1.44], [1.55, -1.39], ...ROOF.slice(4).reverse()];

function finish(batch, group, name) {
  batch.finish(group, { name, castShadow: false, receiveShadow: false });
}

function bar(f, material, u, y, normal, width, height, cell) {
  f.panel(material, u, y, normal, width, height, trainRect(cell));
}

/** Recuadro achaflanado con la imagen completa del atlas, mirando hacia fuera. */
function inset(f, material, u, y, normal, w, h, bevel, cell) {
  const left = u - w / 2, right = u + w / 2, top = y + h;
  const contour = [[left + bevel, y], [right - bevel, y], [right, y + bevel], [right, top - bevel],
    [right - bevel, top], [left + bevel, top], [left, top - bevel], [left, y + bevel]];
  const [x0, y0, x1, y1] = trainRect(cell);
  const uv = (x, yy) => [x0 + (x1 - x0) * (x - left) / w, y0 + (y1 - y0) * (yy - y) / h];
  for (let i = 1; i + 1 < contour.length; i++) {
    const [a, b, c] = [contour[0], contour[i], contour[i + 1]];
    f.tri(material, [...a, normal], [...b, normal], [...c, normal], [...uv(...a), ...uv(...b), ...uv(...c)]);
  }
}

function roof(batch, material, z0, z1) {
  const red = trainRect('rojoTecho');
  for (let i = 0; i + 1 < ROOF.length; i++) {
    const [x0, y0] = ROOF[i], [x1, y1] = ROOF[i + 1];
    batch.quad(material, [x1, y1, z0], [x0, y0, z0], [x0, y0, z1], [x1, y1, z1], red);
  }
  const rim = batch.frame(4);
  for (const z of [-4.15, 3.46]) {
    rim.box(material, 0, 1.73, z, 1.61, .115, 3.77, trainRect('bajo'), BOX_TOP_SIDES);
    rim.box(material, -.39, 1.845, z, .71, .185, 3.31, trainRect('respiradero'), BOX_TOP_SIDES);
    rim.box(material, .39, 1.845, z, .71, .185, 3.31, trainRect('respiradero'), BOX_TOP_SIDES);
  }
}

function end(batch, material, face, z) {
  const f = batch.frame(face, z);
  f.panel(material, 0, -1.39, 0, 2.74, 2.56, trainRect('caucho'));
  f.panel(material, 0, -.98, .01, 1.31, 1.94, trainRect('negro'));
  f.panel(material, 0, 1.17, 0, 2.62, .33, trainRect('rojoSombra'));
}

/** El fuelle alcanza el hombro del techo y une las cajas a través del vano de 60 cm. */
function bellows(car, material) {
  const joint = new Batch();
  const rings = [-9.6, -9.545, -9.485, -9.415, -9.345, -9.275, -9.205, -9.135, -9.065, -9];
  const contour = [[-1.50, -1.40], [1.50, -1.40], [1.55, 1.18], [1.48, 1.43],
    [1.25, 1.65], [.76, 1.77], [-.76, 1.77], [-1.25, 1.65], [-1.48, 1.43], [-1.55, 1.18]];
  const at = (i, j) => {
    const [x, y] = contour[j % contour.length], crimp = i % 2 === 1 && i < rings.length - 1;
    return [x * (crimp ? .978 : 1), y - (crimp && y > 1.18 ? .028 : 0), rings[i]];
  };
  for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < contour.length; j++) {
    joint.quad(material, at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
  }
  finish(joint, car, 'Fuelle entre vagones');
}

function sideDetails(body, trim, windows, mats, lowZ, highZ, cab) {
  const doors = cab < 0 ? CABIN_DOORS.map(z => -z).reverse() : cab > 0 ? CABIN_DOORS : DOORS;
  for (const face of [0, 1]) {
    const direction = face === 0 ? -1 : 1;
    const f = body.frame(face, WIDTH), r = trim.frame(face, WIDTH), g = windows.frame(face, WIDTH);
    const u = z => z * direction;
    const center = u((lowZ + highZ) / 2), length = highZ - lowZ;
    bar(f, mats.carroceria, center, -1.39, 0, length, 2.57, 'rojo');
    bar(r, mats.remate, center, -1.39, .001, length, .17, 'bajo');
    bar(r, mats.remate, center, -1.22, .003, length, .56, 'plata');
    bar(r, mats.remate, center, -.66, .004, length, .075, 'amarillo');
    for (const z of doors) {
      inset(g, mats.vidrio, u(z), -1.25, .009, 1.6, 2.39, .065, 'junta');
      for (const du of [-.386, .386]) {
        const x = u(z) + du;
        inset(g, mats.vidrio, x, -.45, .013, .703, 1.51, .057, 'vidrio');
        bar(g, mats.vidrio, x, -1.165, .013, .704, .68, 'amarillo');
        bar(g, mats.vidrio, x, -1.08, .017, .446, .45, 'plata');
      }
      bar(r, mats.remate, u(z), -1.30, .014, 1.73, .052, 'plata');
    }
    for (let i = 0; i + 1 < doors.length; i++) {
      const middle = (doors[i] + doors[i + 1]) / 2;
      // Dos ventanas con montantes rojos entre ellas y hasta el marco de cada puerta.
      const width = Math.min(1.14, (doors[i + 1] - doors[i] - 1.6 - .5) / 2);
      const offset = width / 2 + .075;
      for (const dz of [-offset, offset]) {
        inset(g, mats.vidrio, u(middle + dz), -.07, .009, width, 1.03, .065, 'junta');
        inset(g, mats.vidrio, u(middle + dz), -.015, .012, width - .12, .90, .052, 'vidrio');
      }
    }
    if (cab) {
      inset(g, mats.vidrio, u(cab * 6.48), -.37, .01, .68, 1.23, .10, 'junta');
      inset(g, mats.vidrio, u(cab * 6.48), -.29, .015, .5, 1.02, .075, 'vidrio');
    }
    bar(f, mats.carroceria, u((doors[1] + doors[2]) / 2), -.56, .007, 1.18, .414, 'metro');
    for (const z of [-5.86, 5.86]) {
      const bogie = trim.frame(face, .76);
      bogie.box(mats.remate, u(z), -1.64, 0, 1.75, .35, .4, trainRect('bajo'), BOX_TOP_SIDES);
      for (const dz of [-.57, .57]) {
        const x = u(z + dz), y = -1.51, n = .21;
        const rect = trainRect('caucho'), uv = [rect[0], rect[1], rect[2], rect[1], rect[2], rect[3]];
        const tread = trainRect('bajo');
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6, b = (i + 1) * Math.PI / 6;
          const p = (angle, depth) => [x + Math.cos(angle) * .195, y + Math.sin(angle) * .181, depth];
          bogie.tri(mats.remate, [x, y, n], p(a, n), p(b, n), uv);
          // La banda de rodadura se prolonga hasta la cabeza del riel, a 70 cm del eje.
          bogie.quad(mats.remate, p(b, n), p(a, n), p(a, -.18), p(b, -.18), tread);
        }
      }
    }
  }
}

function cabPoint(dir, u, y, lift = 0) {
  const right = NOSE.findIndex(([height]) => height >= y);
  const start = NOSE[Math.max(0, right - 1)], end = NOSE[Math.max(0, right)];
  const t = right > 0 ? (y - start[0]) / (end[0] - start[0]) : 0;
  const x = u * THREE.MathUtils.lerp(start[2], end[2], t);
  const z = THREE.MathUtils.lerp(start[1], end[1], t) - .235 * u * u;
  // La cabina posterior conserva el extremo del último vagón en vez de prolongarlo.
  const length = dir > 0 ? z : CABIN_JOIN + (z - CABIN_JOIN) * (HALF_LENGTH - CABIN_JOIN) / (10.6 - CABIN_JOIN);
  return [dir * x, y, dir * (length + lift)];
}

function strip(batch, material, p, y0, w0, y1, w1, d, rect) {
  const [u0, v0, u1, v1] = rect;
  for (let i = 0; i + 1 < FACE_SAMPLES.length; i++) {
    const left = FACE_SAMPLES[i], right = FACE_SAMPLES[i + 1];
    const a = THREE.MathUtils.lerp(u0, u1, (left + 1) / 2);
    const b = THREE.MathUtils.lerp(u0, u1, (right + 1) / 2);
    batch.quadUV(material, p(left * w0, y0, d), p(right * w0, y0, d),
      p(right * w1, y1, d), p(left * w1, y1, d), [a, v0, b, v0, b, v1, a, v1]);
  }
}

function nose(body, glass, mats, dir) {
  const p = (u, y, n) => cabPoint(dir, u, y, n);
  const red = trainRect('rojo');
  const entry = (u, y) => {
    const index = Math.max(1, BODY_EDGE.findIndex(([, height]) => height >= y));
    const [x0, y0] = BODY_EDGE[index - 1], [x1, y1] = BODY_EDGE[index];
    return [dir * u * THREE.MathUtils.lerp(x0, x1, (y - y0) / (y1 - y0)), y, dir * CABIN_JOIN];
  };
  for (let i = 0; i + 1 < SECTIONS.length; i++) {
    const y0 = SECTIONS[i], y1 = SECTIONS[i + 1];
    strip(body, mats.carroceria, p, y0, 1, y1, 1, 0, red);
    for (const side of [-1, 1]) {
      const surface = (t, y, n = 0) => {
        const [x0, , z0] = entry(side, y), [x1, , z1] = p(side, y);
        return [THREE.MathUtils.lerp(x0, x1, t) + dir * side * n, y, THREE.MathUtils.lerp(z0, z1, t)];
      };
      const draw = (points, color) => body.quad(mats.carroceria,
        ...(side > 0 ? points.reverse() : points), trainRect(color));
      const blade = y => THREE.MathUtils.clamp(.63 - y * .24, .23, .97);
      const lowerSeam = surface(blade(y0), y0), upperSeam = surface(blade(y1), y1);
      draw([surface(0, y0), lowerSeam, upperSeam, surface(0, y1)], 'rojo');
      draw([lowerSeam, surface(1, y0), surface(1, y1), upperSeam], 'negro');
    }
  }
  const top = NOSE.at(-1)[0], bottom = NOSE[0][0];
  body.quad(mats.carroceria, entry(1, top), entry(-1, top), p(-1, top), p(1, top), trainRect('negro'));
  body.quad(mats.carroceria, entry(-1, bottom), entry(1, bottom), p(1, bottom), p(-1, bottom), trainRect('bajo'));
  // El acristalamiento sigue el parabrisas abombado. Debajo quedan el rótulo y las aletas de los faros.
  const mask = [[-.94, .42], [-.70, .53], [-.40, .66], [.12, .78], [.62, .86], [1.08, .91],
    [1.45, .86], [1.67, .69], [1.735, .47]];
  for (let i = 0; i + 1 < mask.length; i++) {
    const [y0, w0] = mask[i], [y1, w1] = mask[i + 1];
    const [u0, v0, u1, v1] = trainRect(i < 2 ? 'negro' : 'parabrisas');
    const vertical = y => THREE.MathUtils.lerp(v0, v1, THREE.MathUtils.clamp((y + .4) / 2.135, 0, 1));
    const rect = i < 2 ? [u0, v0, u1, v1] : [u0, vertical(y0), u1, vertical(y1)];
    strip(glass, mats.vidrio, p, y0, w0, y1, w1, .029, rect);
  }
  strip(glass, mats.vidrio, p, 1.105, .48, 1.32, .48, .052, trainRect('pruebas'));
  strip(glass, mats.vidrio, p, -.78, .26, -.46, .32, .046, trainRect('insignia'));
  for (const side of [-1, 1]) {
    const ordered = points => side < 0 ? points.reverse() : points;
    const cheek = [[-1.37, .62, .91], [-1.20, .68, .99], [-.84, .74, .99], [-.40, .81, .99],
      [.12, .87, .99], [.62, .92, .99], [1.08, .96, .99]];
    for (let i = 0; i + 1 < cheek.length; i++) {
      const [y0, u0, v0] = cheek[i], [y1, u1, v1] = cheek[i + 1];
      glass.quad(mats.vidrio, ...ordered([p(side * u0, y0, .02), p(side * v0, y0, .02),
        p(side * v1, y1, .02), p(side * u1, y1, .02)]), trainRect('negro'));
    }
    const white = trainRect('plata');
    const tip = p(side, -1.33, .006);
    const sideUVs = [white[0], white[1], white[2], white[1], white[2], white[3]];
    if (side < 0) body.tri(mats.carroceria, entry(side * 1.003, -1.32), tip, entry(side * 1.003, -.65), sideUVs);
    else body.tri(mats.carroceria, tip, entry(side * 1.003, -1.32), entry(side * 1.003, -.65), sideUVs);
  }
  const front = body.frame(dir > 0 ? 4 : 5, dir > 0 ? 10.52 : 8.93);
  front.box(mats.carroceria, 0, -1.57, 0, .75, .32, .14, trainRect('caucho'), BOX_TOP_SIDES);
}

function headlightGeometry() {
  const shape = withVisualRandom(() => new THREE.Shape()); // El molde no forma parte de la secuencia de la ciudad.
  shape.moveTo(-.18, -.052); shape.lineTo(.17, -.046); shape.lineTo(.24, -.007);
  shape.lineTo(.18, .037); shape.lineTo(-.12, .057); shape.lineTo(-.24, .024); shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function headlights(car, material, geometry, dir) {
  const north = dir < 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (const side of [-1, 1]) {
    const create = () => new THREE.Mesh(geometry, material);
    const headlight = north ? withVisualRandom(create) : create();
    if (north) headlight.userData.visualOnly = true;
    headlight.name = north ? 'Faro cabina norte' : 'Faro cabina sur';
    const [x, y, z] = cabPoint(dir, side * .88, -.36, .047);
    headlight.position.set(x, y, z);
    headlight.rotation.set(-.44, side * .32, side * .71);
    if (north) headlight.rotateOnWorldAxis(up, Math.PI);
    car.add(headlight);
  }
}

export const METRO_TRAIN_NAME = 'Tren del Metro · pruebas';

export function addMetroTrain(group, mats, ballast, { x, trackHeight }) {
  const carY = trackHeight + 2;
  const train = withVisualRandom(() => new THREE.Group());
  train.name = METRO_TRAIN_NAME;
  train.userData.mergeChildren = true;
  train.userData.dynamicBounds = true;
  const northLamps = withVisualRandom(() => mats.faro.clone());
  northLamps.name = 'Faros cabina norte';
  let lampGeometry;
  for (let i = 0; i < 3; i++) {
    const cab = i === 0 ? 1 : i === 2 ? -1 : 0;
    const lowZ = cab < 0 ? -CABIN_JOIN : -HALF_LENGTH, highZ = cab > 0 ? CABIN_JOIN : HALF_LENGTH;
    const car = new THREE.Group();
    car.name = `Vagón Metro ${i + 1}`;
    const body = new Batch(), trim = new Batch(), upper = new Batch(), windows = new Batch();
    sideDetails(body, trim, windows, mats, lowZ, highZ, cab);
    roof(upper, mats.remate, lowZ, highZ);
    body.quad(mats.carroceria, [-1.54, -1.389, lowZ], [1.54, -1.389, lowZ],
      [1.54, -1.389, highZ], [-1.54, -1.389, highZ], trainRect('bajo'));
    if (cab >= 0) end(body, mats.carroceria, 5, HALF_LENGTH);
    if (cab <= 0) end(body, mats.carroceria, 4, HALF_LENGTH);
    if (cab) {
      const shell = cab > 0 ? new Batch() : body;
      nose(shell, windows, mats, cab);
      if (cab > 0) finish(shell, car, 'Morro redondeado');
    }
    finish(body, car, 'Carrocería');
    finish(trim, car, 'Franja y bastidor');
    finish(upper, car, 'Cubierta y ventilación');
    finish(windows, car, 'Puertas, ventanas y parabrisas');
    if (i < 2) bellows(car, ballast);
    if (i === 0) lampGeometry = headlightGeometry();
    if (cab) headlights(car, cab > 0 ? mats.faro : northLamps, lampGeometry, cab);
    car.position.set(x + 1.9, carY, METRO_RUN.initialCenter + (1 - i) * 18.6);
    train.add(car);
  }
  animateMetroTrain(train, mats.faro, northLamps);
  group.add(train);
  return train;
}
