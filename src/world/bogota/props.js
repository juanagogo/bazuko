// src/world/bogota/props.js
// Objetos de calle de Bogotá y de El Cartucho. Cada función devuelve un THREE.Group;
// los que tienen `userData.update(dt, t)` se animan (fuego, toldos).
import * as THREE from 'three';
import { signTexture } from '../../utils/signs.js';
import { trashBag, cardboard, radialSprite } from './textures.js';

const lam = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
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
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.03, 0.5, 7),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(['#ff7a1a', '#ffb347', '#ffd27a'][i]).multiplyScalar(2.5), transparent: true, opacity: 0.85 }));
    f.position.set(rand(-0.08, 0.08), 1.0, rand(-0.08, 0.08));
    g.add(f);
    flames.push(f);
  }
  const light = new THREE.PointLight(0xff8a2a, 6, 9, 1.6);
  light.position.y = 1.4;
  g.add(light);
  g.userData.update = (dt, t) => {
    flames.forEach((f, i) => { const k = 0.8 + Math.sin(t * (13 + i * 5)) * 0.15 + Math.sin(t * (29 + i)) * 0.1; f.scale.set(1, k, 1); });
    light.intensity = 5 + Math.sin(t * 17) * 1.2 + Math.sin(t * 31) * 0.8;
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
  g.userData.update = (dt, t) => { light.intensity = 2.2 + Math.sin(t * 9) * 0.4; };
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
export function streetSign(lines) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6), std('#666666', { metalness: 0.5 }));
  pole.position.y = 1.4;
  g.add(pole);
  lines.forEach((text, i) => {
    const map = signTexture({ title: text, bg: '#ffffff', fg: '#1b1b1b', w: 512, h: 128 });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshStandardMaterial({ map, roughness: 0.7, side: THREE.DoubleSide }));
    plate.position.set(0, 2.65 - i * 0.32, 0);
    plate.rotation.y = i % 2 ? Math.PI / 2 : 0;
    g.add(plate);
  });
  return shadow(g);
}

/** Árbol urbano (urapán / eucalipto) con suave vaivén por viento andino */
export function tree(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 3, 7), std('#4a3a2a'));
  trunk.position.y = 1.5;
  g.add(trunk);

  const foliage = new THREE.Group();
  foliage.position.y = 3.2;
  const greens = ['#2f5a2a', '#3a6b30', '#26492a'];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.9, 1.4), 0), std(greens[i % 3], { flatShading: true }));
    c.position.set(rand(-0.6, 0.6), rand(0, 1), rand(-0.6, 0.6));
    foliage.add(c);
  }
  g.add(foliage);
  g.scale.setScalar(scale);

  // Animación orgánica de viento andino
  const phase = rand(0, Math.PI * 2);
  const freq = rand(1.4, 1.9);
  g.userData.update = (dt, t) => {
    foliage.rotation.z = Math.sin(t * freq + phase) * 0.05;
    foliage.rotation.x = Math.cos(t * (freq * 0.8) + phase) * 0.035;
  };

  return shadow(g);
}

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

export const ARTICULATED_BUS_SIZE = Object.freeze({ length: 18.2, width: 2.52 });

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
