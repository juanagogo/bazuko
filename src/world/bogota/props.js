// src/world/bogota/props.js
// Objetos de calle de Bogotá y de El Cartucho. Cada función devuelve un THREE.Group;
// los que tienen `userData.update(dt, t)` se animan (fuego, toldos).
import * as THREE from 'three';
import { signTexture } from '../../utils/signs.js';
import { trashBag, cardboard, radialSprite } from './textures.js';
import { createFlame, fireGlow, stepFlames } from './flame.js';
import { createUrbanTree } from './UrbanTrees.js';
export { foliageWind } from './UrbanTrees.js';

const lam = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const std = (color, opts = {}) => {
  const parameters = { color, roughness: 0.85, ...opts };
  const material = new THREE.MeshStandardMaterial(parameters);
  // Solo estos materiales inmutables pueden compartir lote entre objetos.
  // Las partes que cambian de opacidad mantienen sus materiales propios.
  material.userData.staticMergeKey = `prop:${JSON.stringify(Object.keys(parameters).sort().map(key => [key, parameters[key]?.uuid ?? parameters[key]]))}`;
  return material;
};
const shadow = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
const rand = (a, b) => a + Math.random() * (b - a);

let _bagTex = null, _cardTex = null;
const bagMat = () => std('#ffffff', { map: (_bagTex ??= trashBag(5)).map ?? _bagTex, roughness: 0.4 });
const cardMat = () => std('#ffffff', { map: (_cardTex ??= cardboard(21)).map ?? _cardTex });

/** Caneca metálica con fuego (calentarse de noche) */
export function fireBarrel() {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.9, 12, 1, true), std('#4a3a2c', { metalness: 0.6, side: THREE.DoubleSide }));
  drum.position.y = 0.45;
  g.add(drum);
  const flame = createFlame(0.82, 1.18);
  flame.position.y = 0.7;
  g.add(flame);
  const light = new THREE.PointLight(0xff8a2a, 6, 9, 1.6);
  light.position.y = 1.4;
  g.add(light);
  const phase = rand(0, Math.PI * 2), glow = fireGlow();
  g.userData.setNight = glow.setNight;
  g.userData.update = (dt, t) => {
    stepFlames(t);
    // La forma se mece y la luz respira despacio: un parpadeo rápido molesta en toda la calle.
    flame.scale.y = 1.18 * (1 + Math.sin(t * 1.9 + phase) * 0.05);
    light.intensity = (5 + Math.sin(t * 2.4 + phase) * 0.35) * glow.step(dt);
  };
  return shadow(g);
}

/** Bolsas y cartones amontonados */
export function trashPile(n = 6) {
  const g = new THREE.Group();
  const bm = bagMat(), cm = cardMat();
  for (let i = 0; i < n; i++) {
    const bag = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.28, 0.42), 1), bm);
    bag.scale.y = rand(0.7, 0.95);
    bag.position.set(rand(-0.7, 0.7), 0.25, rand(-0.6, 0.6));
    bag.rotation.set(rand(0, 1), rand(0, 3), 0);
    g.add(bag);
  }
  for (let i = 0; i < n / 2; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(rand(0.4, 0.8), rand(0.02, 0.3), rand(0.3, 0.6)), cm);
    c.position.set(rand(-0.8, 0.8), 0.1, rand(-0.7, 0.7));
    c.rotation.y = rand(0, 3);
    g.add(c);
  }
  return shadow(g);
}

/** Zorra: carreta de madera de reciclador, cargada */
export function zorra() {
  const g = new THREE.Group();
  const wood = std('#6b4a2e');
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 1.9), wood);
  bed.position.y = 0.55;
  g.add(bed);
  for (const sx of [-0.55, 0.55]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 1.9), wood);
    side.position.set(sx, 0.78, 0);
    g.add(side);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 14), std('#1c1c1c'));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 1.1, 0.3, 0.2);
    g.add(wheel);
  }
  for (const sx of [-0.35, 0.35]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), wood);
    handle.rotation.x = Math.PI / 2 - 0.25;
    handle.position.set(sx, 0.75, -1.4);
    g.add(handle);
  }
  const load = trashPile(5);
  load.scale.setScalar(0.75);
  load.position.y = 0.6;
  g.add(load);
  return shadow(g);
}

/** Paraguas de vendedor ambulante */
export function umbrella(colors = ['#c0392b', '#f2c600']) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 6), std('#cccccc', { metalness: 0.5 }));
  pole.position.y = 1.1;
  g.add(pole);
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const seg = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.45, 1, 1, true, (i / segs) * Math.PI * 2, Math.PI * 2 / segs),
      std(colors[i % colors.length], { side: THREE.DoubleSide, roughness: 0.6 }));
    seg.position.y = 2.25;
    g.add(seg);
  }
  return shadow(g);
}

/** Chaza: puesto de dulces y cigarrillos sueltos (con o sin paraguas) */
export function chaza({ withUmbrella = true } = {}) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), std('#7a5a3a'));
  box.position.y = 0.75;
  g.add(box);
  for (const sx of [-0.4, 0.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), std('#3a3a3a'));
    leg.position.set(sx, 0.2, 0);
    g.add(leg);
  }
  const colors = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#ecf0f1', '#e67e22', '#9b59b6'];
  for (let i = 0; i < 14; i++) {
    const candy = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.14), std(colors[i % colors.length], { roughness: 0.4 }));
    candy.position.set(-0.38 + (i % 7) * 0.12, 1.13, -0.15 + Math.floor(i / 7) * 0.3);
    g.add(candy);
  }
  if (withUmbrella) {
    const u = umbrella(Math.random() < 0.5 ? ['#c0392b', '#f2c600'] : ['#2f6fb0', '#ecf0f1']);
    u.position.set(0.3, 0, 0.2);
    g.add(u);
  }
  return shadow(g);
}

/** Puesto de fritanga: parrilla con humo, mesa y banquitos */
export function fritanga() {
  const g = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.7), std('#8a6a4a'));
  table.position.y = 0.85;
  g.add(table);
  const grill = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.6, 12), std('#2a2a2a', { metalness: 0.5 }));
  grill.position.set(0.9, 0.5, 0);
  g.add(grill);
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.32, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a1a').multiplyScalar(1.8) }));
  coals.rotation.x = -Math.PI / 2;
  coals.position.set(0.9, 0.81, 0);
  g.add(coals);
  const light = new THREE.PointLight(0xff6a2a, 2.5, 5);
  light.position.set(0.9, 1.1, 0);
  g.add(light);
  for (let i = 0; i < 6; i++) {
    const food = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), std(i % 2 ? '#c8902a' : '#7a3a1a'));
    food.position.set(-0.5 + i * 0.15, 0.92, rand(-0.15, 0.15));
    g.add(food);
  }
  const u = umbrella(['#2e7d32', '#ecf0f1']);
  u.position.set(0, 0, 0.1);
  g.add(u);
  const glow = fireGlow();
  g.userData.setNight = glow.setNight;
  g.userData.update = (dt, t) => { light.intensity = (2.2 + Math.sin(t * 2.4) * 0.3) * glow.step(dt); };
  return shadow(g);
}

/** Cambuche ajeno: plástico negro y lona sobre palos */
export function shack() {
  const g = new THREE.Group();
  const stick = std('#4a3a28');
  for (const [x, z, h] of [[-1, -0.8, 1.3], [1, -0.8, 1.3], [-1, 0.8, 0.9], [1, 0.8, 0.9]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, h, 5), stick);
    s.position.set(x, h / 2, z);
    g.add(s);
  }
  const tarpColor = Math.random() < 0.5 ? '#1c1c1c' : '#1f5fbf';
  const tarp = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.9, 4, 4), std(tarpColor, { side: THREE.DoubleSide, roughness: 0.4 }));
  tarp.rotation.x = -Math.PI / 2 + 0.2;
  tarp.position.y = 1.12;
  g.add(tarp);
  const card = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 1.5), cardMat());
  card.position.y = 0.02;
  g.add(card);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 1.4), std(['#7a2c2c', '#3b4a6b', '#6b6b2a'][Math.floor(Math.random() * 3)]));
  blanket.position.set(-0.4, 0.1, 0);
  g.add(blanket);
  return shadow(g);
}

/** Colchón viejo tirado */
export function mattress() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 1.9), std('#9d9a86'));
  m.position.y = 0.08;
  m.rotation.y = rand(0, Math.PI);
  return shadow(new THREE.Group().add(m));
}

/** Cuerda con ropa colgada entre dos puntos (locales del grupo) */
export function clothesline(a, b, height = 2.4) {
  const g = new THREE.Group();
  const A = new THREE.Vector3(a.x, height, a.z), B = new THREE.Vector3(b.x, height, b.z);
  const len = A.distanceTo(B);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, len, 4), std('#dddddd'));
  rope.position.copy(A).lerp(B, 0.5);
  rope.lookAt(B);
  rope.rotateX(Math.PI / 2);
  g.add(rope);
  const n = Math.floor(len / 0.6);
  const colors = ['#c0392b', '#2f6fb0', '#ecf0f1', '#3f7a3a', '#e0962b', '#7a4fa0', '#1f1f1f'];
  for (let i = 1; i < n; i++) {
    const p = A.clone().lerp(B, i / n);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.4, rand(0.4, 0.7)), std(colors[i % colors.length], { side: THREE.DoubleSide }));
    cloth.position.set(p.x, height - 0.3, p.z);
    cloth.lookAt(cloth.position.clone().add(new THREE.Vector3(-(B.z - A.z), 0, B.x - A.x)));
    g.add(cloth);
  }
  return g;
}

/** Placa de nomenclatura vial de Bogotá: "Calle 10", "Carrera 15"… */
// Un solo lienzo con todos los nombres: un material para la ciudad, no uno por placa.
const PLATE_ATLAS = Object.freeze({ cellWidth: 256, cellHeight: 64, columns: 2, rows: 16 });
let plateAtlas = null;

/** Lámina azul con filete blanco; el número de la nomenclatura pesa más que la palabra. */
function drawPlate(ctx, x, y, width, height, text) {
  ctx.fillStyle = '#0b4a9c';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = 'rgba(0, 18, 60, .22)'; // la parte baja se ensucia primero
  ctx.fillRect(x, y + height * .62, width, height * .38);
  ctx.strokeStyle = '#eef2f5';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x + 4.5, y + 4.5, width - 9, height - 9);
  ctx.fillStyle = '#f6f8f9';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const font = size => `700 ${size}px "Arial Narrow", Arial, system-ui, sans-serif`;
  const middle = y + height * .53, room = width - 26;
  const address = /^(Calle|Carrera)\s+(.+)$/.exec(text);
  if (address) {
    const word = address[1].toUpperCase(), number = address[2];
    ctx.font = font(20); const wordWidth = ctx.measureText(word).width;
    ctx.font = font(40); const numberWidth = ctx.measureText(number).width;
    const start = x + (width - wordWidth - 9 - numberWidth) / 2;
    ctx.font = font(20); ctx.fillText(word, start, middle + 1);
    ctx.font = font(40); ctx.fillText(number, start + wordWidth + 9, middle);
    return;
  }
  let size = 30;
  ctx.font = font(size);
  while (size > 11 && ctx.measureText(text).width > room) ctx.font = font(--size);
  ctx.fillText(text, x + (width - ctx.measureText(text).width) / 2, middle);
}

function getPlateAtlas() {
  if (plateAtlas) return plateAtlas;
  const { cellWidth, cellHeight, columns, rows } = PLATE_ATLAS;
  // Las pruebas corren sin DOM: la placa queda azul lisa y conserva su geometría.
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  if (canvas) { canvas.width = cellWidth * columns; canvas.height = cellHeight * rows; }
  const ctx = canvas?.getContext?.('2d');
  const drawable = typeof ctx?.measureText === 'function';
  let map = null;
  if (drawable) {
    map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }
  plateAtlas = {
    ctx: drawable ? ctx : null, map, slots: new Map(),
    material: drawable ? std('#ffffff', { map, roughness: 0.46, metalness: 0.08 }) : std('#0b4a9c', { roughness: 0.46, metalness: 0.08 })
  };
  return plateAtlas;
}

function plateSlot(text) {
  const atlas = getPlateAtlas(), { cellWidth, cellHeight, columns, rows } = PLATE_ATLAS;
  if (!atlas.slots.has(text)) {
    // Sin celdas libres la placa queda en blanco, nunca con el nombre de otra calle.
    const index = Math.min(atlas.slots.size, columns * rows - 1), column = index % columns, row = Math.floor(index / columns);
    atlas.slots.set(text, { column, row });
    if (atlas.ctx && atlas.slots.size < columns * rows) {
      drawPlate(atlas.ctx, column * cellWidth, row * cellHeight, cellWidth, cellHeight, text);
      atlas.map.needsUpdate = true;
    }
  }
  const { column, row } = atlas.slots.get(text), width = cellWidth * columns, height = cellHeight * rows;
  return {
    u0: (column * cellWidth + 1) / width, u1: ((column + 1) * cellWidth - 1) / width,
    v0: 1 - ((row + 1) * cellHeight - 1) / height, v1: 1 - (row * cellHeight + 1) / height
  };
}

/** Lámina con grosor: cada cara lee bien desde su lado, sin letras al revés. */
function plateGeometry(text, width, height, thickness) {
  const geometry = new THREE.BoxGeometry(width, height, thickness), uv = geometry.attributes.uv, slot = plateSlot(text);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, slot.u0 + (slot.u1 - slot.u0) * uv.getX(i), slot.v0 + (slot.v1 - slot.v0) * uv.getY(i));
  }
  return geometry;
}

export function streetSign(lines) {
  const g = new THREE.Group();
  const galv = std('#9b9fa1', { metalness: 0.55, roughness: 0.55 }), clamp = std('#5f6264', { metalness: 0.5, roughness: 0.6 });
  const R = 0.032, topY = 2.93;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.15, topY, 8), galv);
  pole.position.y = topY / 2;
  g.add(pole);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * .35, R, 0.03, 8), clamp);
  cap.position.y = topY + 0.015;
  g.add(cap);
  const { material } = getPlateAtlas(), length = 0.94, height = 0.235, thickness = 0.02;
  lines.forEach((text, i) => {
    // Banderas que salen del tubo: el poste nunca tapa las letras. Cada una corre paralela
    // a la vía que nombra y se aleja de la esquina, donde está el semáforo.
    const frame = new THREE.Group();
    frame.position.y = 2.76 - i * 0.27;
    frame.rotation.y = i % 2 ? Math.PI / 2 : Math.PI;
    const plate = new THREE.Mesh(plateGeometry(text, length, height, thickness), material);
    plate.position.x = R + 0.01 + length / 2;
    frame.add(plate);
    for (const dy of [-0.07, 0.07]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(R * 2 + 0.11, 0.022, 0.03), clamp);
      strap.position.set(0.04, dy, 0);
      frame.add(strap);
    }
    g.add(frame);
  });
  return shadow(g);
}

/** Árbol sembrado: follaje recortado y ramas reales, compatibles con los lotes estáticos. */
export function tree(scale = 1, options = {}) { return createUrbanTree(scale, options); }

/** Estación del sistema de buses troncal en el separador de la avenida */
export function busStation(length = 16) {
  const g = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, length), std('#9a9a96'));
  platform.position.y = 0.45;
  g.add(platform);
  const glassMat = new THREE.MeshStandardMaterial({ color: '#a9c8d8', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  for (const sx of [-1.25, 1.25]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(length, 1.6), glassMat);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(sx, 1.7, 0);
    g.add(wall);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, length + 1), std('#c0392b'));
  roof.position.y = 3.3;
  g.add(roof);
  for (let z = -length / 2; z <= length / 2; z += 4) {
    for (const sx of [-1.2, 1.2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), std('#bbbbbb', { metalness: 0.6 }));
      col.position.set(sx, 2.1, z);
      g.add(col);
    }
  }
  const map = signTexture({ title: 'ESTACIÓN CALLE 10', sub: 'TRONCAL CARACAS', bg: '#c0392b', w: 1024, h: 256 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }));
  sign.rotation.y = Math.PI / 2;
  sign.position.set(0, 3.8, length / 2 - 1);
  g.add(sign);
  return shadow(g);
}

export const ARTICULATED_BUS_SIZE = Object.freeze({ length: 22.1, width: 2.72 });

/** Bus articulado rojo; el frente apunta hacia −Z local. */
export function articulatedBus() {
  const g = new THREE.Group();
  const wheels = [];
  const red = std('#b3261e', { roughness: 0.5, metalness: 0.3 });
  const glass = std('#1a2430', { roughness: 0.1, metalness: 0.5, emissive: '#e6983b', emissiveIntensity: 0.18 });
  for (const [z, len] of [[-4.6, 9], [4.6, 9]]) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.8, len), red);
    body.position.set(0, 1.75, z);
    g.add(body);
    for (const sx of [-1.26, 1.26]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(len - 1, 1), glass);
      win.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      win.position.set(sx, 2.3, z);
      g.add(win);
    }
    for (const wz of [z - len / 2 + 1.5, z + len / 2 - 1.5]) {
      for (const sx of [-1.15, 1.15]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14), std('#111111'));
        w.rotation.z = Math.PI / 2;
        w.position.set(sx, 0.5, wz);
        g.add(w);
        wheels.push(w);
      }
    }
  }
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.4, 16), std('#222222'));
  joint.rotation.x = Math.PI / 2;
  joint.position.y = 1.8;
  g.add(joint);
  g.userData.wheels = wheels;

  // Faros frontales hacia -Z y luces traseras hacia +Z
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(2.5) });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a12').multiplyScalar(2.0) });
  for (const sx of [-0.85, 0.85]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.08), headMat);
    head.position.set(sx, 0.95, -9.11);
    g.add(head);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.08), tailMat);
    tail.position.set(sx, 0.95, 9.11);
    g.add(tail);
  }

  // Haz de luz frontal sobre el asfalto (-Z)
  const busBeam = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 3.2),
    new THREE.MeshBasicMaterial({ color: '#ffe8c8', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  busBeam.rotation.x = -Math.PI / 2;
  busBeam.position.set(0, 0.03, -12.5);
  g.add(busBeam);

  // Tablero digital de destino LED en el visor frontal (-Z)
  let routeMap = null;
  if (typeof document !== 'undefined') {
    routeMap = signTexture({ title: 'B14 PORTAL NORTE', sub: 'TRONCAL CARACAS', bg: '#080c10', fg: '#ffb000', accent: '#ff8800', w: 512, h: 128 });
  }
  const routeSign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.35),
    new THREE.MeshBasicMaterial({ map: routeMap, color: new THREE.Color('#ffb81c').multiplyScalar(1.5), side: THREE.DoubleSide })
  );
  routeSign.rotation.y = Math.PI;
  routeSign.position.set(0, 2.9, -9.13);
  g.add(routeSign);

  return shadow(g);
}

/** Cerros orientales con la iglesia de Monserrate en la cima y faro nocturno */
export function cerros(width = 260) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(width, 70, 60, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const ridge = 22 + Math.sin(x * 0.03) * 10 + Math.sin(x * 0.081 + 1) * 6 + Math.sin(x * 0.17) * 2.5;
    // los vértices de arriba bajan a la cresta
    if (y > -35 + ridge) p.setY(i, -35 + ridge);
  }
  geo.computeVertexNormals();

  const farMat = new THREE.MeshBasicMaterial({ color: '#3d5245', fog: false });
  const far = new THREE.Mesh(geo, farMat);
  g.add(far);

  const nearMat = new THREE.MeshBasicMaterial({ color: '#2c3d33', fog: false });
  const near = new THREE.Mesh(geo.clone(), nearMat);
  near.scale.set(1.1, 0.75, 1);
  near.position.set(30, -8, 15);
  g.add(near);

  // Iglesia de Monserrate en la cima
  const churchMat = new THREE.MeshBasicMaterial({ color: '#e8e3d6', fog: false });
  const church = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 1), churchMat);
  const churchY = -35 + 22 + Math.sin(-18 * 0.03) * 10 + Math.sin(-18 * 0.081 + 1) * 6 + 1.6;
  church.position.set(-18, churchY, 2);
  g.add(church);

  // Cruz y faro luminoso de Monserrate
  const crossMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    fog: false,
    transparent: true,
    opacity: 0.25
  });
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.2), crossMat);
  crossV.userData.isCross = true;
  crossV.position.set(-18, churchY + 1.9, 2.2);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 0.2), crossMat);
  crossH.position.set(-18, churchY + 2.3, 2.2);
  g.add(crossV, crossH);

  g.userData.setNight = (isNight) => {
    if (isNight) {
      farMat.color.set('#0d1816');
      nearMat.color.set('#08100f');
      churchMat.color.set('#fff8e7');
      crossMat.opacity = 1.0;
      crossMat.color.set('#ffffff');
    } else {
      farMat.color.set('#3d5245');
      nearMat.color.set('#2c3d33');
      churchMat.color.set('#e8e3d6');
      crossMat.opacity = 0.25;
      crossMat.color.set('#fffae8');
    }
  };

  return g;
}

/** Letrero de neón comercial bogotano de fachada (Droguería, Panadería, Billar) */
export function neonSign({ title = 'DROGUERÍA', sub = '24 HORAS', color = '#00ff88', accent = '#ff2255' } = {}) {
  const g = new THREE.Group();
  g.userData.noMerge = true;

  // Soporte metálico a pared
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.5), std('#1a1a1a'));
  bracket.position.set(0, 0, -0.25);
  g.add(bracket);

  // Marco de la caja de luz
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.65, 0.12), std('#222222'));
  g.add(box);

  // Panel iluminado con texto
  let map = null;
  if (typeof document !== 'undefined') {
    map = signTexture({ title, sub, bg: '#08080c', fg: color, accent, w: 512, h: 192 });
  }
  const neonMat = new THREE.MeshBasicMaterial({
    map,
    color: new THREE.Color(color).multiplyScalar(1.4),
    side: THREE.DoubleSide
  });
  const faceFront = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.58), neonMat);
  faceFront.position.z = 0.065;
  const faceBack = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.58), neonMat);
  faceBack.position.z = -0.065;
  faceBack.rotation.y = Math.PI;
  g.add(faceFront, faceBack);

  // Parpadeo eléctrico sutil de neón nocturno
  g.userData.update = (dt, t) => {
    const flicker = 1.0 + Math.sin(t * 12.0) * 0.08 + (Math.random() < 0.015 ? -0.4 : 0);
    neonMat.color.set(color).multiplyScalar(flicker * 1.3);
  };

  return g;
}

/** Paradero zonal del transporte integrado (cubierta, panel de rutas y banca) */
export function sitpBusStop({ title = 'PARADERO ZONAL', code = '124A00', routes = ['128', 'C15', 'T12', '544A'] } = {}) {
  const g = new THREE.Group();
  const steel = std('#30353c', { metalness: 0.65, roughness: 0.35 });
  const blue = std('#003087', { metalness: 0.2, roughness: 0.5 });
  const yellow = std('#ffcd00', { metalness: 0.1, roughness: 0.5 });

  // Columnas traseras de soporte
  for (const sx of [-1.1, 1.1]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.45, 10), steel);
    col.position.set(sx, 1.225, -0.45);
    g.add(col);

    // Brazo en voladizo para la cubierta
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 1.05), steel);
    arm.position.set(sx, 2.4, 0.05);
    g.add(arm);
  }

  // Cubierta traslúcida curvada hacia el frente
  const roofMat = new THREE.MeshStandardMaterial({
    color: '#3a506b',
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide
  });
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 1.15, 6, 2), roofMat);
  roof.rotation.x = -Math.PI / 2 + 0.1;
  roof.position.set(0, 2.46, 0.05);
  g.add(roof);

  // Banca metálica perforada
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.38), std('#70767c', { metalness: 0.8, roughness: 0.3 }));
  bench.position.set(0, 0.48, -0.32);
  g.add(bench);

  // Tótem vertical de información de rutas en el extremo derecho
  const totem = new THREE.Mesh(new THREE.BoxGeometry(0.48, 2.5, 0.08), blue);
  totem.position.set(1.35, 1.25, -0.45);
  g.add(totem);

  const totemCap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.09), yellow);
  totemCap.position.set(1.35, 2.35, -0.45);
  g.add(totemCap);

  // Muestra de códigos de ruta en rectángulos distintivos
  const routeColors = ['#0033a0', '#c8102e', '#007a33', '#e87722'];
  routes.slice(0, 4).forEach((rt, idx) => {
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.1), std(routeColors[idx % routeColors.length]));
    badge.position.set(1.26 + (idx % 2) * 0.18, 1.85 - Math.floor(idx / 2) * 0.14, -0.405);
    g.add(badge);
  });

  return shadow(g);
}

/** Bolardo cilíndrico de andén bogotano con franja reflectiva superior */
export function bolardoBogotano({ color = '#2c2e30', reflectiveColor = '#f5c300' } = {}) {
  const g = new THREE.Group();
  const bodyMat = std(color, { roughness: 0.7, metalness: 0.3 });
  const reflectMat = new THREE.MeshStandardMaterial({
    color: reflectiveColor,
    roughness: 0.3,
    metalness: 0.1,
    emissive: reflectiveColor,
    emissiveIntensity: 0.15
  });

  // Base ancha a nivel de suelo
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.05, 14), bodyMat);
  base.position.y = 0.025;
  g.add(base);

  // Fuste o cuerpo principal
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.58, 14), bodyMat);
  shaft.position.y = 0.34;
  g.add(shaft);

  // Franja reflectiva
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.08, 14), reflectMat);
  ring.position.y = 0.65;
  g.add(ring);

  // Cabezal redondeado
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
  cap.position.y = 0.69;
  g.add(cap);

  return shadow(g);
}

/** Caneca pública de basura de acero inoxidable perforado montada sobre poste */
export function canecaDistrital() {
  const g = new THREE.Group();
  const steelMat = std('#a2a8ad', { metalness: 0.85, roughness: 0.2 });
  const darkMat = std('#1a1a1a', { roughness: 0.8 });

  // Poste de anclaje
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.15, 10), steelMat);
  post.position.y = 0.575;
  g.add(post);

  // Brazo de soporte lateral
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), steelMat);
  arm.position.set(0, 0.68, 0.09);
  g.add(arm);

  // Tambor de la papelera
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.52, 14, 1, true), steelMat);
  drum.position.set(0, 0.68, 0.22);
  g.add(drum);

  // Fondo y tapa interior
  const inside = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.14, 0.48, 12), darkMat);
  inside.position.set(0, 0.67, 0.22);
  g.add(inside);

  // Visera protectora de lluvia
  const lid = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.06, 14), steelMat);
  lid.position.set(0, 0.98, 0.22);
  g.add(lid);

  return shadow(g);
}

/** Carrito ambulante de café, aromática campesina y empanadas */
export function carritoTinto() {
  const g = new THREE.Group();
  const woodMat = std('#6b482b', { roughness: 0.8 });
  const darkSteel = std('#262626', { metalness: 0.6, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#eef6fc',
    roughness: 0.1,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide
  });

  // Cajón / mesa con ruedas
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.5), woodMat);
  cart.position.y = 0.58;
  g.add(cart);

  // 2 ruedas grandes traseras
  for (const sx of [-0.38, 0.38]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.035, 14), darkSteel);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx, 0.22, 0.12);
    g.add(wheel);

    // Patas delanteras de apoyo
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 6), darkSteel);
    leg.position.set(sx * 0.85, 0.16, -0.18);
    g.add(leg);
  }

  // Manillar para empujar
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.03, 0.03), darkSteel);
  handle.position.set(0, 0.82, 0.32);
  g.add(handle);

  // Termos de café y aromática (rojo, verde, azul, plateado)
  const thermosColors = ['#b81414', '#1e7b34', '#145bb8', '#b87314', '#c0c0c0'];
  thermosColors.forEach((color, i) => {
    const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), std(color, { roughness: 0.3, metalness: 0.3 }));
    flask.position.set(-0.24 + i * 0.12, 0.93, 0.1);
    g.add(flask);

    // Tapa dosificadora de bomba
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.05, 6), darkSteel);
    cap.position.set(-0.24 + i * 0.12, 1.06, 0.1);
    g.add(cap);
  });

  // Vitrina de pandebonos y empanadas
  const caseBox = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.22), glassMat);
  caseBox.position.set(0, 0.93, -0.1);
  g.add(caseBox);

  // Pasteles dorados dentro
  for (let p = 0; p < 4; p++) {
    const pastry = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), std('#cf8b2b', { roughness: 0.6 }));
    pastry.position.set(-0.12 + p * 0.08, 0.85, -0.1);
    g.add(pastry);
  }

  // Torre de vasitos blancos desechables apilados
  const cups = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.22, 8), std('#f8f9fa', { roughness: 0.6 }));
  cups.position.set(0.26, 0.93, -0.1);
  g.add(cups);

  // Paraguas colorido que cubre el carrito
  const u = umbrella(['#ffcd00', '#003087']);
  u.position.set(0.2, 0, 0.15);
  u.scale.setScalar(0.85);
  g.add(u);

  return shadow(g);
}

/** Cabina telefónica pública clásica sobre pedestal */
export function cabinaTelefonica() {
  const g = new THREE.Group();
  const steelMat = std('#40454d', { metalness: 0.6, roughness: 0.4 });
  const domeMat = std('#0b4a9c', { roughness: 0.35, metalness: 0.15 });

  // Poste principal
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.05, 10), steelMat);
  pole.position.y = 1.025;
  g.add(pole);

  // Cúpula o capota semicilíndrica azul protectora
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI, 0, Math.PI),
    domeMat
  );
  dome.rotation.x = Math.PI / 2;
  dome.rotation.z = Math.PI;
  dome.position.set(0, 1.55, 0.05);
  g.add(dome);

  // Consola metálica del teléfono
  const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 0.12), std('#889098', { metalness: 0.8, roughness: 0.25 }));
  consoleBox.position.set(0, 1.35, 0.14);
  g.add(consoleBox);

  // Teclado y ranura
  const keypad = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.12), std('#151515'));
  keypad.position.set(0, 1.32, 0.201);
  g.add(keypad);

  // Auricular
  const handset = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.05), std('#101010'));
  handset.position.set(-0.16, 1.38, 0.16);
  g.add(handset);

  return shadow(g);
}

/** Módulo / Kiosco urbano de periódicos, revistas y golosinas */
export function kioscoRevistas() {
  const g = new THREE.Group();
  const frameMat = std('#1f3a2b', { roughness: 0.6, metalness: 0.3 }); // verde oscuro institucional
  const counterMat = std('#8b5a2b', { roughness: 0.7 });

  // Cuerpo cerrado de la caseta
  const booth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.1, 1.1), frameMat);
  booth.position.y = 1.05;
  g.add(booth);

  // Ventana / hueco de atención al frente
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.35), counterMat);
  counter.position.set(0, 0.95, 0.45);
  g.add(counter);

  // Techo inclinado con alero
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.08, 1.35), std('#14241b', { roughness: 0.5 }));
  roof.rotation.x = 0.08;
  roof.position.set(0, 2.15, 0.05);
  g.add(roof);

  // Periódicos y revistas colgadas al frente
  const magColors = ['#c0392b', '#2980b9', '#f39c12', '#27ae60', '#8e44ad'];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      const mag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), std(magColors[(row * 5 + col) % magColors.length]));
      mag.position.set(-0.52 + col * 0.26, 1.35 - row * 0.26, 0.56);
      g.add(mag);
    }
  }

  // Letrero superior
  let bannerMap = null;
  if (typeof document !== 'undefined') {
    bannerMap = signTexture({ title: 'REVISTAS · PERIÓDICOS', sub: 'MINUTOS A TODO DESTINO', bg: '#102216', fg: '#ffea00', accent: '#ffffff', w: 512, h: 128 });
  }
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerMap, color: bannerMap ? 0xffffff : 0xffea00 });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.28), bannerMat);
  banner.position.set(0, 1.95, 0.56);
  g.add(banner);

  return shadow(g);
}
