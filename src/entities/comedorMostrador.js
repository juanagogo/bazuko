import * as THREE from 'three';
import { withVisualRandom } from '../world/bogota/VisualRandom.js';
import { Piezas } from './puestoPiezas.js';

const SURFACE = 1.02;
const POT_X = -.72, POT_Z = .34;
const STEEL = '#b5b8b3', SHADOW_STEEL = '#757a78', EDGE_STEEL = '#c6c8c0';
const BROTH = '#96723f';

function spun(pieces, points, at, color, segments = 24) {
  const profile = points.map(([radius, y]) => new THREE.Vector2(radius, y));
  pieces.pieza(new THREE.LatheGeometry(profile, segments), color, at);
}

function rod(pieces, from, to, radius, color, segments = 8) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
  const axis = new THREE.Vector3(0, 1, 0);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments, 1, true);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(axis, direction.normalize()));
  pieces.pieza(geometry, color, a.add(b).multiplyScalar(.5).toArray());
}

function cabinet(pieces) {
  pieces.caja(2.53, .13, .61, '#242e2b', [0, .215, .28]);
  pieces.caja(2.58, .71, .67, '#3d5a51', [0, .596, .30]);
  for (const x of [-.85, 0, .85]) {
    pieces.caja(.805, .602, .024, '#496558', [x, .590, .64]);
    pieces.caja(.805, .015, .029, '#597164', [x, .896, .644]);
    pieces.caja(.805, .019, .021, '#304940', [x, .283, .644]);
  }
  for (const x of [-1.286, 1.286]) pieces.caja(.018, .702, .66, '#52655d', [x, .596, .30]);
}

function countertop(pieces) {
  pieces.caja(2.70, .062, .756, STEEL, [0, SURFACE - .031, .30]);
  // Una pestaña doblada y una vuelta redonda reparten los reflejos en el canto de entrega.
  pieces.caja(2.69, .031, .021, SHADOW_STEEL, [0, SURFACE - .060, .676]);
  rod(pieces, [-1.34, SURFACE - .017, .678], [1.34, SURFACE - .017, .678], .017, EDGE_STEEL);
  pieces.caja(2.68, .075, .022, STEEL, [0, SURFACE + .033, -.068]);
  pieces.caja(2.66, .010, .024, EDGE_STEEL, [0, SURFACE + .072, -.068]);
}

function stockpot(pieces) {
  const at = [POT_X, SURFACE, POT_Z];
  // Asa, pared y borde redoblado. El regreso del perfil forma la cara interior de la olla.
  spun(pieces, [[0, 0], [.257, 0], [.288, .020], [.301, .071], [.310, .392], [.322, .403],
    [.323, .414], [.315, .422], [.302, .418], [.294, .396], [.286, .075], [.255, .032], [0, .032]], at, STEEL, 32);
  spun(pieces, [[.287, .041], [.300, .062], [.298, .082]], at, SHADOW_STEEL, 32);
  for (const side of [-1, 1]) {
    const atGrip = (span, z) => [POT_X + side * span, SURFACE + .309, POT_Z + z];
    const a = atGrip(.302, -.083), b = atGrip(.397, -.077), c = atGrip(.401, .072), d = atGrip(.302, .083);
    for (const [u, v] of [[a, b], [b, c], [c, d]]) rod(pieces, u, v, .012, SHADOW_STEEL);
    for (const p of [a, d]) pieces.tubo(.021, .021, .013, 10, EDGE_STEEL, p, [0, 0, Math.PI / 2]);
  }
}

function sancocho(pieces) {
  const y = SURFACE + .341;
  pieces.tubo(.289, .289, .006, 28, BROTH, [POT_X, y, POT_Z]);
  // Trozos de papa, plátano y hierbas dentro del caldo, por debajo del borde.
  const ingredients = [
    [-.16, .06, .052, '#c09a59'], [.09, -.13, .042, '#ba994f'], [.17, .12, .053, '#c7ab68'],
    [-.10, -.16, .043, '#ad844d'], [.07, .18, .050, '#be9c61'], [.03, .031, .038, '#ad7842']
  ];
  for (const [x, z, size, color] of ingredients) {
    pieces.pieza(new THREE.IcosahedronGeometry(size, 0), color, [POT_X + x, y + .009, POT_Z + z], [.0, x * 11, .17], [1.2, .28, .76]);
  }
  for (const [x, z] of [[-.18, -.06], [.17, -.079], [-.036, .18], [.035, -.13], [.185, .038], [-.12, .11], [-.17, .152]]) {
    pieces.caja(.015, .002, .007, '#696a3d', [POT_X + x, y + .004, POT_Z + z], [0, x * 20, 0]);
  }
}

function ladle(pieces) {
  const scoop = [POT_X + .08, SURFACE + .321, POT_Z - .12];
  const rim = [.0, .016, .048, .066, .052, .0];
  const heights = [0, .004, .021, .048, .047, .009];
  spun(pieces, rim.map((r, i) => [r, heights[i]]), scoop, STEEL, 16);
  // Pasa por el borde; el mango cae hacia el lado desde el que se reparte la sopa.
  const stem = [scoop[0] + .039, scoop[1] + .046, scoop[2] + .029], rest = [-.432, 1.452, .404], tip = [-.245, 1.551, .566];
  rod(pieces, stem, rest, .008, EDGE_STEEL);
  rod(pieces, rest, tip, .012, SHADOW_STEEL);
  pieces.tubo(.014, .014, .018, 9, EDGE_STEEL, tip, [Math.PI / 3, 0, -.48]);
}

function trayPoints(width, depth, y) {
  const r = .026, x = width / 2 - r, z = depth / 2 - r;
  const corners = [[x, z], [-x, z], [-x, -z], [x, -z]];
  return corners.flatMap(([cx, cz], i) => [0, 1, 2].map(j => {
    const a = (i * 2 + j) * Math.PI / 4;
    return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  }));
}

/** Base cóncava y canto de una bandeja moldeada. El exterior toca la mesa o la banda inferior. */
function tray(pieces, width, depth, color, at, yaw = 0) {
  const rings = [trayPoints(width - .065, depth - .065, .008), trayPoints(width - .026, depth - .026, .031),
    trayPoints(width, depth, .031), trayPoints(width - .012, depth - .012, 0)];
  const positions = [], count = rings[0].length;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    positions.push(0, .008, 0, ...rings[0][next], ...rings[0][i]);
    for (let r = 0; r < rings.length - 1; r++) {
      const a = rings[r][i], b = rings[r][next], c = rings[r + 1][next], d = rings[r + 1][i];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  pieces.pieza(geometry, color, at, [0, yaw, 0]);
}

function bowl(pieces, radius, height, color, at) {
  spun(pieces, [[0, 0], [radius * .59, 0], [radius * .68, height * .11], [radius * .96, height * .80],
    [radius, height], [radius * .91, height], [radius * .58, height * .20], [0, height * .20]], at, color, 20);
}

function lunch(pieces) {
  const x = .61, z = .453;
  tray(pieces, .61, .40, '#526d58', [x, SURFACE, z]);
  const y = SURFACE + .009;
  bowl(pieces, .099, .081, '#ab6253', [x - .173, y, z - .046]);
  pieces.tubo(.082, .082, .006, 18, '#af8c59', [x - .173, y + .058, z - .046]);
  for (const [dx, dz, color] of [[-.019, -.032, '#ddbb79'], [.031, .005, '#bf9258'], [-.024, .029, '#aaa652']]) {
    pieces.pieza(new THREE.IcosahedronGeometry(.020, 0), color, [x - .173 + dx, y + .060, z - .046 + dz], [0, 0, 0], [1, .40, 1]);
  }
  bowl(pieces, .111, .026, '#cab164', [x + .065, y, z + .043]);
  pieces.pieza(new THREE.IcosahedronGeometry(.052, 1), '#e1d9bb', [x + .029, y + .025, z + .043], [0, .8, 0], [1.15, .44, .73]);
  pieces.caja(.066, .015, .026, '#b58c42', [x + .112, y + .022, z + .023], [0, -.43, .06]);
  pieces.pieza(new THREE.IcosahedronGeometry(.028, 0), '#8f623d', [x + .085, y + .028, z + .078], [0, 1, 0], [1.2, .55, .81]);
  bowl(pieces, .044, .110, '#65917a', [x + .184, y, z - .101]);
  pieces.tubo(.039, .039, .004, 14, '#9a6b3e', [x + .184, y + .096, z - .101]);
  rod(pieces, [x - .071, y + .011, z + .133], [x + .052, y + .014, z + .147], .005, EDGE_STEEL);
  pieces.disco(.020, 9, STEEL, [x + .068, y + .016, z + .149], [1.3, .55]);
}

function trayStack(pieces) {
  const colors = ['#64705d', '#a68b55', '#5c7863', '#a45e4b'];
  for (let i = 0; i < colors.length; i++) tray(pieces, .456, .276, colors[i], [.97 - .007 * i, SURFACE + .015 * i, .051], .028 * i);
}

function cutlery(pieces) {
  tray(pieces, .308, .171, SHADOW_STEEL, [-.035, SURFACE, .297], -.06);
  for (const z of [.252, .293, .333]) {
    rod(pieces, [-.14, SURFACE + .016, z], [.031, SURFACE + .020, z + .015], .0045, EDGE_STEEL);
    pieces.disco(.022, 10, STEEL, [.044, SURFACE + .021, z + .016], [1.13, .61]);
  }
}

function pantry(pieces) {
  pieces.caja(2.56, 1.68, .057, '#a6a69d', [0, 1.00, -.843]);
  const tiles = ['#d2cfc1', '#d8d4c6', '#c9c6ba'];
  for (let row = 0; row < 7; row++) for (let col = 0; col < 10; col++) {
    pieces.caja(.248, .223, .018, tiles[(col * 11 + row * 17) % tiles.length],
      [-1.143 + col * .254, .278 + row * .226, -.811]);
  }
  for (const y of [.605, 1.15]) {
    pieces.caja(2.52, .039, .324, STEEL, [0, y, -.670]);
    pieces.caja(2.52, .028, .017, SHADOW_STEEL, [0, y - .030, -.507]);
  }
  for (const x of [-1.262, 1.262]) pieces.caja(.035, 1.68, .36, '#606a64', [x, 1.00, -.680]);
}

const SUPPLIES = ['#b29a72', '#b3936a', '#8f9580', '#a98e63', '#aeb09d', '#ae8358', '#6d8068', '#b6a281', '#966650', '#788371'];

function supplies(pieces, index) {
  const x = -.98 + index % 5 * .49, y = index < 5 ? .625 : 1.17;
  const color = SUPPLIES[index];
  if (index === 6 || index === 9) {
    for (let i = 0; i < 4; i++) bowl(pieces, .080, .051, i % 2 ? '#a78850' : color, [x, y + i * .027, -.652]);
    return;
  }
  const tall = .20 + (index % 3) * .029, turn = (index % 3 - 1) * .11;
  pieces.en([x, y, -.661], [0, turn, 0], () => {
    pieces.caja(.248, tall - .022, .17, color, [0, (tall - .022) / 2, 0]);
    pieces.caja(.211, .027, .145, color, [0, tall - .020, -.006], [0, 0, .04]);
    pieces.caja(.108, .051, .003, '#d5c2a2', [-.014, tall * .47, .086]);
    pieces.caja(.069, .008, .002, '#88836b', [-.026, tall * .48, .088]);
  });
}

export function addComedorCounter(group) {
  const mount = (name, draw, { steel = false, shadow = true } = {}) => {
    const pieces = withVisualRandom(() => {
      const model = new Piezas();
      draw(model);
      return model;
    });
    // Se conserva una geometría, un material y una malla por cada pieza previa del puesto.
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: steel ? .36 : .79, metalness: steel ? .38 : 0 });
    const mesh = pieces.malla(material, { sombra: shadow });
    mesh.name = name;
    group.add(mesh);
  };
  mount('Frente del mostrador', cabinet);
  mount('Mesón de acero', countertop, { steel: true });
  mount('Olla de aluminio', stockpot, { steel: true });
  mount('Sancocho', sancocho, { shadow: false });
  mount('Cucharón', ladle, { steel: true, shadow: false });
  mount('Bandeja de almuerzo', lunch, { shadow: false });
  mount('Bandejas limpias', trayStack, { shadow: false });
  mount('Bandeja de cubiertos', cutlery, { steel: true, shadow: false });
  mount('Azulejo y estantes', pantry);
  SUPPLIES.forEach((_, i) => mount('Víveres y menaje', pieces => supplies(pieces, i), { shadow: false }));
}
