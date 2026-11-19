import * as THREE from 'three';
import { Batch, FACES, NO_BACK } from './ZoneGeometry.js';
import { COMMERCIAL_STREET } from './EastZones.js';
import { withVisualRandom } from './VisualRandom.js';
import { patchSunFieldShader } from './SunFieldShader.js';

const THRESHOLD = .12;
const HEAD = 2.62;
const FLOOR = .66;
const BACK = -3.7;
const BULB = '#fff0c7';
const materialsByDistrict = new WeakMap();

export function calle7ShopRoom(lot, x, sign) {
  if (lot.face !== 5 || lot.z0 !== COMMERCIAL_STREET.z1 + 4) return null;
  if (x === 337 && sign === 'signTinto') return 'cafe';
  if (x === 330 && sign === 'signChicha') return 'chicha';
  return null;
}

// BuildingVisibility clona los materiales de cada pared y del lote agrupado.
class ShopInteriorMaterial extends THREE.MeshStandardMaterial {
  onBeforeCompile(shader) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float shopLight; varying float vShopLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShopLight = shopLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShopLight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= diffuseColor.rgb * vShopLight;');
    patchSunFieldShader(shader);
  }
}

function shopMaterials(zone) {
  if (materialsByDistrict.has(zone)) return materialsByDistrict.get(zone);
  const room = withVisualRandom(() => new ShopInteriorMaterial({
    vertexColors: true, roughness: .92, emissive: '#ffd2a5', emissiveIntensity: 0
  }));
  room.name = 'Luz interior de Calle 7';
  room.userData.batchAttributes = ['color', 'shopLight'];
  room.userData.windowGlow = .95;
  const glass = withVisualRandom(() => new THREE.MeshStandardMaterial({
    color: '#aabfb9', metalness: .16, roughness: .21, opacity: .17,
    transparent: true, depthWrite: false, forceSinglePass: true, envMapIntensity: .7
  }));
  glass.name = 'Vidrio de Calle 7';
  const materials = { room, glass };
  materialsByDistrict.set(zone, materials);
  return materials;
}

// Se conservan los UV y la separación de 15 mm entre el zócalo y el muro alto de createBuildingShell.
function cutWall(mesh, face, width, depth, offset, openings) {
  const uv = mesh.geometry.attributes.uv, p = mesh.geometry.attributes.position;
  const uMin = Math.min(uv.getX(0), uv.getX(1)), uMax = Math.max(uv.getX(0), uv.getX(1));
  const vMin = Math.min(uv.getY(0), uv.getY(2)), vMax = Math.max(uv.getY(0), uv.getY(2));
  const bottom = Math.min(p.getY(0), p.getY(2)), top = Math.max(p.getY(0), p.getY(2));
  const batch = new Batch(), f = batch.frame(face, depth / 2 + offset);
  const paint = (left, right, low, high) => {
    if (right <= left || high <= low) return;
    const u0 = THREE.MathUtils.lerp(uMin, uMax, left / width + .5);
    const u1 = THREE.MathUtils.lerp(uMin, uMax, right / width + .5);
    const v0 = THREE.MathUtils.lerp(vMin, vMax, (low - bottom) / (top - bottom));
    const v1 = THREE.MathUtils.lerp(vMin, vMax, (high - bottom) / (top - bottom));
    f.panel(mesh.material, (left + right) / 2, low, 0, right - left, high - low, [u0, v0, u1, v1]);
  };
  let edge = -width / 2;
  for (const { u, w } of openings) {
    const left = u - w / 2, right = u + w / 2;
    paint(edge, left, bottom, top);
    paint(left, right, bottom, Math.min(top, THRESHOLD));
    paint(left, right, Math.max(bottom, HEAD), top);
    edge = right;
  }
  paint(edge, width / 2, bottom, top);
  const data = batch.groups.get(mesh.material), geometry = mesh.geometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  geometry.setIndex(data.index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  mesh.name = 'Ladrillo alrededor del vano';
}

function shopFrame(f, g, zone, glass, { u, w, kind }) {
  const left = u - w / 2, right = u + w / 2, meeting = left + 1.12;
  const wood = kind === 'cafe' ? 'iron' : 'woodRed';
  const trim = zone.detail;
  // Jambas con caras interiores, cargadero y umbral. El vidrio queda en el fondo del marco.
  for (const edge of [left + .065, right - .065]) f.box(trim, edge, THRESHOLD, -.15, .13, HEAD - THRESHOLD, .3, wood, NO_BACK);
  f.box(trim, u, HEAD - .13, -.15, w, .13, .3, wood, NO_BACK);
  f.box(trim, meeting, THRESHOLD, -.153, .105, HEAD - THRESHOLD - .11, .22, wood, NO_BACK);
  const display = (meeting + right) / 2, span = right - meeting;
  f.box(trim, display, THRESHOLD, -.128, span, .51, .26, 'stoneGray', NO_BACK);
  f.box(trim, display, .624, -.112, span, .09, .28, wood, NO_BACK);
  f.box(trim, display, 2.08, -.153, span, .048, .105, wood, NO_BACK);
  for (const part of [-.165, .165]) f.box(trim, display + span * part, .705, -.159, .047, 1.79, .1, wood, NO_BACK);
  g.panel(glass, display, .706, -.19, span - .095, 1.788);

  const door = (left + meeting) / 2;
  // Tres peldaños dentro del vano recuperan la cota del piso existente.
  for (let step = 0; step < 3; step++) {
    f.box(trim, door, THRESHOLD + step * .18, -.106 - step * .187, 1.005, .18, .224, 'stoneGray', NO_BACK);
  }
  for (const edge of [left + .16, meeting - .067]) f.box(trim, edge, FLOOR, -.62, .061, 1.84, .088, wood, NO_BACK);
  const doorWidth = 1.12 - .18;
  f.box(trim, door + .02, FLOOR, -.62, doorWidth, .18, .106, wood, NO_BACK);
  f.box(trim, door + .02, 2.45, -.62, doorWidth, .052, .086, wood, NO_BACK);
  f.box(trim, meeting - .18, 1.16, -.544, .033, .24, .065, 'stoneLight', NO_BACK);
  g.panel(glass, door + .02, FLOOR + .168, -.633, doorWidth - .063, 1.625);
  return display;
}

/** Vasijas, pocillos y pantallas en pocos anillos para que se lean desde el andén. */
function vessel(f, color, u, n, rings) {
  const sides = 8;
  const point = ([y, radius], i) => {
    const angle = i * Math.PI * 2 / sides;
    return [u + Math.cos(angle) * radius, y, n + Math.sin(angle) * radius];
  };
  for (let side = 0; side < sides; side++) for (let i = 1; i < rings.length; i++) {
    f.quad(color, point(rings[i - 1], side), point(rings[i], side), point(rings[i], side + 1), point(rings[i - 1], side + 1));
  }
}

function coffeeCounter(f, u) {
  f.box('#744226', u, FLOOR, -1.38, 2.03, .82, .58);
  f.box('#b27840', u, 1.43, -1.38, 2.14, .095, .65);
  for (let i = -4; i <= 4; i++) f.box('#9a6337', u + i * .219, .72, -1.082, .095, .65, .032);
  const machine = u - .23;
  f.box('#8c9a89', machine, 1.52, -1.38, .92, .316, .45);
  f.box('#252c29', machine, 1.574, -1.147, .73, .18, .035);
  f.box('#c8b98e', machine, 1.529, -1.125, .86, .043, .19);
  for (const x of [machine - .185, machine + .18]) {
    f.box('#b6ad91', x, 1.656, -1.114, .187, .036, .052);
    vessel(f, '#dcd3b7', x, -1.13, [[1.571, .033], [1.654, .053], [1.654, .04], [1.595, .031]]);
  }
  f.box('#7c6150', u + .63, 1.52, -1.3, .35, .047, .325);
  for (const x of [u + .55, u + .72]) vessel(f, '#f1dfad', x, -1.25, [[1.568, .047], [1.676, .073], [1.676, .06], [1.604, .044]]);
  f.box('#302c22', u + .18, 1.62, BACK + .16, 1.5, .59, .055);
  for (const y of [1.78, 1.88, 2.03]) f.box('#c1b68e', u + .05, y, BACK + .194, .82 - (y - 1.78) * .8, .013, .008);
}

function coffeeTable(f, u) {
  const n = -.92, wood = '#946134', steel = '#373d38';
  f.box(steel, u, FLOOR, n, .086, .65, .086);
  vessel(f, steel, u, n, [[FLOOR, .19], [FLOOR + .045, .19], [FLOOR + .085, .08]]);
  vessel(f, wood, u, n, [[1.28, .33], [1.33, .34], [1.34, .018]]);
  vessel(f, '#eee1bd', u - .073, n + .086, [[1.339, .062], [1.415, .075], [1.415, .057], [1.36, .048]]);
  f.box('#d3b68b', u + .11, 1.338, n - .05, .16, .012, .18);
  for (const [x, z] of [[u - .48, n - .16], [u + .41, n - .39]]) {
    f.box(steel, x, FLOOR, z, .056, .46, .056);
    vessel(f, wood, x, z, [[1.095, .15], [1.144, .168], [1.151, .012]]);
  }
}

function chichaCounter(f, u) {
  f.box('#86483b', u, FLOOR, -1.37, 2.08, .74, .62);
  f.box('#a37148', u, 1.36, -1.37, 2.22, .11, .69);
  f.box('#b07b50', u, .86, -1.048, 1.88, .1, .048);
  for (const [x, scale, color] of [[u - .56, 1, '#bd692e'], [u + .25, .74, '#965033']]) {
    const y = 1.47;
    vessel(f, color, x, -1.27, [[y, .19 * scale], [y + .16 * scale, .28 * scale],
      [y + .34 * scale, .295 * scale], [y + .44 * scale, .154 * scale], [y + .47 * scale, .157 * scale],
      [y + .47 * scale, .12 * scale], [y + .34 * scale, .12 * scale]]);
  }
  for (const base of [1.08, 1.55]) {
    f.box('#7e4a31', u - .34, base, -2.47, 1.73, .058, .32);
    for (let i = 0; i < 7; i++) {
      const x = u - 1.03 + i * .216, y = base + .06, h = .19 + (i % 3) * .065;
      vessel(f, i % 2 ? '#806034' : '#576b45', x, -2.39, [[y, .051], [y + h * .72, .059], [y + h * .84, .025], [y + h, .026]]);
    }
  }
}

function interior(frame, { u, w, kind }, display) {
  const cafe = kind === 'cafe', plaster = cafe ? '#c0ac8d' : '#b48e64';
  const left = u - w / 2 + .087, right = u + w / 2 - .087;
  frame.box('#9a8a72', u, HEAD - .04, BACK / 2 - .013, w - .16, .045, -BACK - .028, null, FACES.bottom);
  const columns = Math.ceil((right - left) / .49), rows = 8;
  const cellW = (right - left) / columns, cellD = (-BACK - .022) / rows;
  // El relleno de las lámparas se interpola sobre paños cortos, también en los muros de la trastienda.
  for (const [low, high] of [[FLOOR, 1.27], [1.27, 1.97], [1.97, HEAD]]) {
    for (let column = 0; column < columns; column++) {
      frame.panel(plaster, left + (column + .5) * cellW, low, BACK, cellW, high - low);
    }
    for (let row = 0; row < rows; row++) {
      const near = -.022 - row * cellD, far = near - cellD;
      frame.quad(plaster, [left, low, near], [left, low, far], [left, high, far], [left, high, near]);
      frame.quad(plaster, [right, low, far], [right, low, near], [right, high, near], [right, high, far]);
    }
  }
  for (const x of [left, right]) frame.box(cafe ? '#544439' : '#70493b', x, FLOOR, BACK / 2, .062, .25, -BACK - .04);
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
    const a = left + x * cellW, n = -.014 - z * cellD;
    const paint = (x + z) % 2 ? '#8d806c' : cafe ? '#b0a68b' : '#a07b61';
    frame.box(paint, a + cellW / 2, FLOOR - .005, n - cellD / 2, cellW - .007, .005, cellD - .008, null, FACES.top);
  }
  const lamp = display - .25;
  frame.box('#352820', lamp, 2.28, -.96, .022, .305, .022);
  vessel(frame, cafe ? '#c5bb9f' : '#ab7042', lamp, -.96, [[2.2, .231], [2.31, .147], [2.34, .053]]);
  vessel(frame, BULB, lamp, -.96, [[2.166, .077], [2.185, .129], [2.239, .12]]);
  if (cafe) {
    coffeeCounter(frame, display + .02);
    coffeeTable(frame, display - 1.88);
  } else chichaCounter(frame, display - .09);
  return frame.P(lamp, 2.2, -.96);
}

function finishRooms(batch, parent, material, face, depth, lamps) {
  const position = [], normal = [], uv = [], color = [], shopLight = [], index = [];
  const f = batch.frame(face, depth / 2), origin = f.P(0, 0, 0), away = f.P(0, 0, -1);
  const nx = away[0] - origin[0], nz = away[2] - origin[2];
  // La luz disminuye hacia la trastienda. El mismo color se usa para el relleno cálido de noche.
  for (const [paint, data] of batch.groups) {
    const from = position.length / 3, tint = new THREE.Color(paint);
    position.push(...data.position);
    normal.push(...data.normal);
    uv.push(...data.uv);
    for (let i = 0; i < data.position.length; i += 3) {
      const x = data.position[i], y = data.position[i + 1], z = data.position[i + 2];
      const d = (x - origin[0]) * nx + (z - origin[2]) * nz;
      const bounce = 1.14 - .40 * (d / -BACK) + .15 * Math.max(0, data.normal[i + 1]);
      color.push(tint.r * bounce, tint.g * bounce, tint.b * bounce);
      let d2 = Infinity;
      for (const source of lamps) d2 = Math.min(d2, (x - source[0]) ** 2 + (y - source[1]) ** 2 + (z - source[2]) ** 2);
      shopLight.push(paint === BULB ? 1.75 : .23 + .86 / (1 + .58 * d2));
    }
    for (const id of data.index) index.push(from + id);
  }
  const mesh = withVisualRandom(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    geometry.setAttribute('shopLight', new THREE.Float32BufferAttribute(shopLight, 1));
    geometry.setIndex(index);
    return new THREE.Mesh(geometry, material);
  });
  mesh.name = 'Interiores de Calle 7';
  mesh.userData.visualOnly = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

export function addCalle7ShopRooms(shell, zone, face, width, depth, openings, facade) {
  const high = shell.walls.get(face), low = shell.base.children.find(mesh => {
    const n = mesh.geometry.attributes.normal, p = mesh.geometry.attributes.position;
    return n.getZ(0) === -1 && p.getZ(0) === -depth / 2;
  });
  cutWall(low, face, width, depth, 0, openings);
  cutWall(high.children[0], face, width, depth, -.015, openings);
  const { room, glass } = shopMaterials(zone);
  const panes = new Batch(), rooms = new Batch();
  const g = panes.frame(face, depth / 2), inside = rooms.frame(face, depth / 2);
  const lamps = openings.map(opening => interior(inside, opening, shopFrame(facade, g, zone, glass, opening)));
  panes.finish(high, { name: 'Paños de vidrio de Calle 7', castShadow: false, visualOnly: true });
  finishRooms(rooms, high, room, face, depth, lamps);
}
