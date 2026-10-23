import * as THREE from 'three';
import { PALETTES, DEFAULT_LOOK, normalizeLook } from './look.js';

export { DEFAULT_LOOK };

const lerp = THREE.MathUtils.lerp;
const lam = (color) => new THREE.MeshLambertMaterial({ color });

function capsule(r, len, m) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 12);
  g.translate(0, -len / 2 - r * 0.6, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}
function mesh(geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

let stripeTex = null;
function stripes() {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 8, 64);
  x.fillStyle = '#9a9a9a';
  for (let y = 0; y < 64; y += 16) x.fillRect(0, y, 8, 7);
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.repeat.set(1, 2);
  return stripeTex;
}

/**
 * Personaje cabezón original de Rebusque, con piezas intercambiables
 * (pelo, barba, ropa, calzado, cabeza) sobre un esqueleto fijo. Mira hacia +Z.
 */
export function createCharacter(initial = DEFAULT_LOOK) {
  const M = {
    skin: lam('#d39a6d'),
    hair: lam('#1b1410'),
    top: lam('#c0392b'),
    top2: lam('#e8e3d6'),
    bottom: lam('#33445c'),
    stripe: lam('#f4f1e8'),
    shoe: lam('#1c1c1c'),
    sole: lam('#eeeeee'),
    hat: lam('#c0392b'),
    sack: lam('#9b8a62'),
    white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    iris: new THREE.MeshBasicMaterial({ color: '#3b2416' }),
    pupil: new THREE.MeshBasicMaterial({ color: '#0b0b0b' }),
    mouth: new THREE.MeshBasicMaterial({ color: '#5a2a22' }),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.52;
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  const head = new THREE.Group();
  head.position.y = 0.72;
  torso.add(head);

  // cabeza fija: cráneo, orejas, ojos, nariz, boca
  const skull = mesh(new THREE.SphereGeometry(0.27, 20, 16), M.skin);
  skull.scale.set(1, 0.95, 0.95);
  head.add(skull);
  for (const x of [-0.27, 0.27]) head.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), M.skin, x, -0.02, 0));
  head.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), M.skin, 0, -0.045, 0.255));
  head.add(mesh(new THREE.BoxGeometry(0.08, 0.018, 0.02), M.mouth, 0, -0.115, 0.24));
  const eyes = [];
  for (const x of [-0.1, 0.1]) {
    const g = new THREE.Group();
    const sclera = mesh(new THREE.SphereGeometry(0.05, 12, 10), M.white);
    sclera.scale.set(1, 1.15, 0.45);
    const iris = mesh(new THREE.SphereGeometry(0.03, 10, 8), M.iris, 0, -0.004, 0.018);
    iris.scale.set(1, 1.15, 0.5);
    const pupil = mesh(new THREE.SphereGeometry(0.014, 8, 6), M.pupil, 0, -0.004, 0.03);
    const shine = mesh(new THREE.SphereGeometry(0.008, 6, 4), M.white, 0.012, 0.012, 0.036);
    g.add(sclera, iris, pupil, shine);
    g.position.set(x, 0, 0.235);
    head.add(g);
    eyes.push(g);
  }

  const sack = mesh(new THREE.SphereGeometry(0.22, 14, 10), M.sack, 0, 0.28, -0.27);
  torso.add(sack);

  // esqueleto de brazos y piernas
  function armRig(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.25, 0.36, 0);
    torso.add(shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.21;
    shoulder.add(elbow);
    return { shoulder, elbow, side };
  }
  function legRig(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0, 0);
    hips.add(hip);
    const knee = new THREE.Group();
    knee.position.y = -0.24;
    hip.add(knee);
    return { hip, knee, side };
  }
  const arms = [armRig(1), armRig(-1)];
  const legs = [legRig(1), legRig(-1)];

  // contenedores de piezas intercambiables
  const slots = { torso: new THREE.Group(), head: new THREE.Group(), arms: [], legs: [] };
  torso.add(slots.torso);
  head.add(slots.head);
  arms.forEach((a) => {
    const s = { upper: new THREE.Group(), lower: new THREE.Group() };
    a.shoulder.add(s.upper);
    a.elbow.add(s.lower);
    slots.arms.push(s);
  });
  legs.forEach((l) => {
    const s = { upper: new THREE.Group(), lower: new THREE.Group() };
    l.hip.add(s.upper);
    l.knee.add(s.lower);
    slots.legs.push(s);
  });
  const clear = (g) => {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => o.geometry?.dispose());
    }
  };

  let look = normalizeLook(initial);
  let bulk = 1;

  function build() {
    const L = look;
    M.skin.color.set(PALETTES.piel[L.piel]);
    M.hair.color.set(PALETTES.pelo[L.peloColor]);
    M.iris.color.set(PALETTES.ojos[L.ojos]);
    M.top.color.set(PALETTES.ropa[L.arribaColor]);
    M.bottom.color.set(PALETTES.ropa[L.abajoColor]);
    M.shoe.color.set(PALETTES.zapato[L.zapatoColor]);
    M.hat.color.set(PALETTES.ropa[L.cabezaColor]);
    M.top.map = L.arriba === 'rayas' ? stripes() : null;
    M.top.needsUpdate = true;

    bulk = L.contextura === 'delgado' ? 0.86 : L.contextura === 'robusto' ? 1.2 : 1;
    const typeB = L.cuerpo === 'b';
    root.scale.setScalar(L.estatura);

    // ---- torso ----
    clear(slots.torso);
    const chest = mesh(new THREE.CapsuleGeometry(0.2, 0.2, 4, 14), M.top, 0, 0.24, 0);
    chest.scale.set((typeB ? 1.02 : 1.15) * bulk, 1, 0.85 * Math.sqrt(bulk));
    slots.torso.add(chest);
    const hipBand = mesh(new THREE.CylinderGeometry(0.19 * bulk * (typeB ? 1.12 : 1), 0.2 * bulk * (typeB ? 1.14 : 1), 0.12, 14), M.bottom, 0, 0.02, 0);
    slots.torso.add(hipBand);
    if (typeB) {
      for (const x of [-0.085, 0.085]) {
        const b = mesh(new THREE.SphereGeometry(0.075 * bulk, 10, 8), M.top, x, 0.3, 0.15 * Math.sqrt(bulk));
        b.scale.set(1, 0.85, 0.7);
        slots.torso.add(b);
      }
    }
    if (L.arriba === 'buzo') {
      const hood = mesh(new THREE.TorusGeometry(0.15, 0.06, 8, 16), M.top, 0, 0.5, -0.04);
      hood.rotation.x = Math.PI / 2 + 0.25;
      slots.torso.add(hood);
      slots.torso.add(mesh(new THREE.BoxGeometry(0.22 * bulk, 0.09, 0.02), M.stripe, 0, 0.14, 0.17 * Math.sqrt(bulk) + 0.005));
      for (const x of [-0.04, 0.04]) slots.torso.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 4), M.stripe, x, 0.4, 0.17));
    } else if (L.arriba === 'chaqueta') {
      slots.torso.add(mesh(new THREE.BoxGeometry(0.012, 0.36, 0.02), M.stripe, 0, 0.22, 0.175 * Math.sqrt(bulk)));
      const collar = mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 14), M.top, 0, 0.47, 0);
      collar.rotation.x = Math.PI / 2;
      slots.torso.add(collar);
    } else {
      const neck = mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 14), M.top, 0, 0.46, 0.01);
      neck.rotation.x = Math.PI / 2;
      slots.torso.add(neck);
    }

    // ---- brazos ----
    const longSleeve = L.arriba !== 'camiseta';
    slots.arms.forEach((s, i) => {
      clear(s.upper);
      clear(s.lower);
      const r = 0.068 * Math.sqrt(bulk);
      s.upper.add(capsule(r, 0.12, longSleeve ? M.top : M.skin));
      if (!longSleeve) {
        const sleeve = capsule(r * 1.12, 0.03, M.top);
        s.upper.add(sleeve);
      }
      if (L.arriba === 'sudadera' || L.arriba === 'buzo') {
        const st = mesh(new THREE.BoxGeometry(0.02, 0.18, 0.05), M.stripe, arms[i].side * r, -0.13, 0);
        s.upper.add(st);
      }
      s.lower.add(capsule(r * 0.95, 0.08, longSleeve ? M.top : M.skin));
      s.lower.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), M.skin, 0, -0.2, 0));
    });

    // ---- piernas y calzado ----
    slots.legs.forEach((s, i) => {
      clear(s.upper);
      clear(s.lower);
      const r = 0.085 * Math.sqrt(bulk) * (typeB ? 1.04 : 1);
      const shorts = L.abajo === 'pantaloneta';
      s.upper.add(capsule(r, 0.1, M.bottom));
      s.lower.add(capsule(r * 0.94, 0.06, shorts ? M.skin : M.bottom));
      if (L.abajo === 'sudadera') {
        s.upper.add(mesh(new THREE.BoxGeometry(0.02, 0.2, 0.04), M.stripe, legs[i].side * r, -0.12, 0));
        s.lower.add(mesh(new THREE.BoxGeometry(0.02, 0.16, 0.04), M.stripe, legs[i].side * r * 0.94, -0.1, 0));
      }
      if (L.zapatos === 'tenis') {
        const shoe = mesh(new THREE.BoxGeometry(0.15, 0.08, 0.25), M.shoe, 0, -0.23, 0.04);
        shoe.add(mesh(new THREE.BoxGeometry(0.155, 0.03, 0.255), M.sole, 0, -0.045, 0));
        s.lower.add(shoe);
      } else if (L.zapatos === 'chanclas') {
        s.lower.add(mesh(new THREE.BoxGeometry(0.13, 0.06, 0.22), M.skin, 0, -0.23, 0.04));
        s.lower.add(mesh(new THREE.BoxGeometry(0.15, 0.025, 0.25), M.shoe, 0, -0.27, 0.04));
        s.lower.add(mesh(new THREE.BoxGeometry(0.14, 0.02, 0.04), M.shoe, 0, -0.2, 0.08));
      } else {
        s.lower.add(mesh(new THREE.BoxGeometry(0.16, 0.16, 0.25), M.shoe, 0, -0.2, 0.035));
        s.lower.add(mesh(new THREE.BoxGeometry(0.165, 0.035, 0.26), lam('#2a1d14'), 0, -0.275, 0.035));
      }
    });

    // ---- cabeza: pelo, cejas, barba, accesorio ----
    clear(slots.head);
    const hatOn = L.cabeza !== 'nada';
    const H = slots.head;
    const capTop = (s = 1.02) => {
      const c = mesh(new THREE.SphereGeometry(0.275 * s, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hair, 0, 0.02, -0.015);
      c.scale.set(1, 0.92, 0.96);
      return c;
    };
    switch (L.pelo) {
      case 'rapado': {
        const c = capTop(1.0);
        c.scale.set(1, 0.8, 0.95);
        if (!hatOn) H.add(c);
        break;
      }
      case 'corto':
        if (!hatOn) {
          H.add(capTop());
          H.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), M.hair, 0, 0.17, 0.2));
        }
        break;
      case 'crespo': {
        const n = hatOn ? 8 : 18;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const ring = i % 3;
          const rad = 0.2 - ring * 0.05;
          const y = hatOn ? -0.02 : 0.12 + ring * 0.08;
          H.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), M.hair, Math.cos(a) * rad, y, Math.sin(a) * rad * 0.9 - 0.03));
        }
        if (!hatOn) H.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), M.hair, 0, 0.27, -0.02));
        break;
      }
      case 'largo':
        if (!hatOn) H.add(capTop());
        {
          const back = mesh(new THREE.BoxGeometry(0.5, 0.42, 0.14), M.hair, 0, -0.08, -0.2);
          H.add(back);
          for (const x of [-0.24, 0.24]) H.add(mesh(new THREE.BoxGeometry(0.07, 0.36, 0.2), M.hair, x, -0.06, -0.06));
        }
        break;
      case 'cola':
        if (!hatOn) H.add(capTop());
        {
          const tail = capsule(0.06, 0.18, M.hair);
          tail.position.set(0, 0.06, -0.27);
          tail.rotation.x = -0.4;
          H.add(tail);
        }
        break;
      case 'mohicano':
        if (!hatOn) for (let i = 0; i < 5; i++) H.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.09), M.hair, 0, 0.27 - Math.abs(i - 1.5) * 0.02, 0.16 - i * 0.09));
        break;
      default:
    }
    const browH = L.cejas === 'gruesas' ? 0.03 : 0.015;
    for (const x of [-0.1, 0.1]) {
      const b = mesh(new THREE.BoxGeometry(0.09, browH, 0.02), M.hair, x, 0.085, 0.245);
      b.rotation.z = x > 0 ? -0.12 : 0.12;
      H.add(b);
    }
    if (L.barba === 'bigote' || L.barba === 'candado') H.add(mesh(new THREE.BoxGeometry(0.13, 0.03, 0.03), M.hair, 0, -0.085, 0.245));
    if (L.barba === 'candado') H.add(mesh(new THREE.BoxGeometry(0.08, 0.07, 0.05), M.hair, 0, -0.17, 0.215));
    if (L.barba === 'completa') {
      const beard = mesh(new THREE.SphereGeometry(0.245, 14, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.35), M.hair, 0, -0.02, 0.025);
      H.add(beard);
      H.add(mesh(new THREE.BoxGeometry(0.13, 0.03, 0.03), M.hair, 0, -0.085, 0.245));
    }
    if (L.cabeza === 'gorra' || L.cabeza === 'gorra-atras') {
      const crown = mesh(new THREE.SphereGeometry(0.285, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), M.hat, 0, 0.05, 0);
      H.add(crown);
      const back = L.cabeza === 'gorra-atras' ? -1 : 1;
      const visor = mesh(new THREE.BoxGeometry(0.34, 0.03, 0.2), M.hat, 0, 0.11, 0.28 * back);
      visor.rotation.x = 0.18 * back;
      H.add(visor);
      H.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), M.hat, 0, 0.33, 0));
    } else if (L.cabeza === 'sombrero') {
      H.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 24), M.hat, 0, 0.13, 0));
      H.add(mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.22, 20), M.hat, 0, 0.25, 0));
      H.add(mesh(new THREE.CylinderGeometry(0.272, 0.272, 0.05, 20), M.pupil, 0, 0.16, 0));
    } else if (L.cabeza === 'panoleta') {
      const band = mesh(new THREE.SphereGeometry(0.283, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), M.hat, 0, 0.04, -0.01);
      H.add(band);
      H.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), M.hat, 0, 0.06, -0.28));
    }
  }
  build();

  const pose = { lean: 0, armLx: 0, armRx: 0, armLz: 0, armRz: 0, elbL: 0, elbR: 0, legL: 0, legR: 0, kneeL: 0, kneeR: 0, bob: 0, lie: 0, headX: 0, headY: 0 };
  let phase = 0;
  let blink = 2;

  function update(dt, { speed = 0, running = false, action = null, t = 0, load = 0, dirt = 0, wet = 0, look: lookAt = 0 }) {
    const target = { lean: 0, armLx: 0, armRx: 0, armLz: 0.12, armRz: -0.12, elbL: -0.2, elbR: -0.2, legL: 0, legR: 0, kneeL: 0, kneeR: 0, bob: 0, lie: 0, headX: 0, headY: lookAt };
    const amp = Math.min(1, speed / 3.6) * (running ? 1.1 : 0.9);
    if (speed > 0.15) {
      phase += dt * (5 + speed * 2.2);
      const s = Math.sin(phase);
      target.legL = s * 0.8 * amp;
      target.legR = -s * 0.8 * amp;
      target.kneeL = Math.max(0, Math.sin(phase + Math.PI / 2)) * 0.9 * amp;
      target.kneeR = Math.max(0, Math.sin(phase - Math.PI / 2)) * 0.9 * amp;
      target.armLx = -s * 0.8 * amp;
      target.armRx = s * 0.8 * amp;
      target.lean = 0.06 * amp + (running ? 0.1 : 0);
      target.bob = Math.abs(Math.cos(phase)) * 0.05 * amp;
    } else {
      target.bob = Math.sin(t * 2.8) * 0.012;
      target.headX = Math.sin(t * 0.9) * 0.06;
      target.headY = Math.cos(t * 0.7) * 0.08 + lookAt;
      target.armLz = 0.14 + Math.sin(t * 2.8) * 0.015;
      target.armRz = -0.14 - Math.sin(t * 2.8) * 0.015;
    }
    if (wet > 0.5 && speed < 0.15) {
      target.armLz = -0.3; target.armRz = 0.3; target.armLx = -0.6; target.armRx = -0.6; target.elbL = -1.5; target.elbR = -1.5;
    }
    switch (action) {
      case 'buscar': {
        const w = Math.sin(t * 10);
        target.lean = 0.7; target.headX = 0.2;
        target.armLx = -1.3 + w * 0.3; target.armRx = -1.3 - w * 0.3;
        target.kneeL = 0.6; target.kneeR = 0.6; target.legL = -0.4; target.legR = -0.4;
        break;
      }
      case 'pedir':
        target.armRx = -1.4; target.elbR = -0.2; target.lean = 0.1; target.headX = Math.sin(t * 2) * 0.05;
        break;
      case 'banar': {
        const w = Math.sin(t * 9);
        target.armLx = -2.8 + w * 0.2; target.armRx = -2.8 - w * 0.2; target.elbL = -1.2; target.elbR = -1.2; target.lean = 0.3;
        break;
      }
      case 'comer':
        target.armRx = -1.5; target.elbR = -1.8;
        break;
      case 'cagar':
        target.lean = 0.55; target.headX = 0.3;
        target.kneeL = 1.35; target.kneeR = 1.35; target.legL = -0.9; target.legR = -0.9;
        target.armLx = -0.4; target.armRx = -0.4; target.elbL = -0.8; target.elbR = -0.8;
        break;
      case 'lanzar': {
        const w = Math.sin(t * 12);
        target.lean = -0.25; target.headX = -0.1;
        target.armRx = -2.6 + w * 0.2; target.elbR = -0.3; target.armLx = 0.4;
        break;
      }
      case 'temblor': {
        const w = Math.sin(t * 36);
        target.headX = w * 0.18; target.headY = Math.cos(t * 28) * 0.25;
        target.armLx = -0.8 + w * 0.25; target.armRx = -0.8 - w * 0.25;
        target.kneeL = Math.max(0, w * 0.15); target.kneeR = Math.max(0, -w * 0.15);
        break;
      }
      case 'saludo': {
        target.armRx = -2.7; target.armRz = -0.3 + Math.sin(t * 9) * 0.35; target.elbR = -0.4;
        break;
      }
      case 'saltar': {
        target.bob = 0.16;
        target.legL = 0.45; target.legR = 0.35;
        target.kneeL = 0.95; target.kneeR = 0.8;
        target.armLx = -0.55; target.armRx = -0.55;
        target.armLz = -0.55; target.armRz = 0.55;
        target.lean = 0.12;
        break;
      }
      case 'golpear': {
        const punchCycle = Math.sin(t * 18);
        target.lean = 0.18;
        target.armRx = -1.65 + punchCycle * 0.15;
        target.elbR = -0.05;
        target.armRz = -0.15;
        target.armLx = -1.25;
        target.elbL = -1.8;
        target.armLz = 0.35;
        target.legR = -0.35;
        target.legL = 0.3;
        break;
      }
      case 'dormir':
        target.lie = 1;
        break;
      default:
    }
    const k = Math.min(1, dt * 12);
    for (const key of Object.keys(pose)) pose[key] = lerp(pose[key], target[key], k);

    const [aL, aR] = arms;
    const [lL, lR] = legs;
    torso.rotation.x = pose.lean;
    head.rotation.set(pose.headX, pose.headY, 0);
    aL.shoulder.rotation.set(pose.armLx, 0, pose.armLz);
    aR.shoulder.rotation.set(pose.armRx, 0, pose.armRz);
    aL.elbow.rotation.x = pose.elbL;
    aR.elbow.rotation.x = pose.elbR;
    lL.hip.rotation.x = pose.legL;
    lR.hip.rotation.x = pose.legR;
    lL.knee.rotation.x = pose.kneeL;
    lR.knee.rotation.x = pose.kneeR;
    hips.position.y = 0.52 + pose.bob - (action === 'buscar' ? 0.08 : (action === 'cagar' ? 0.28 : 0));
    body.rotation.x = -pose.lie * Math.PI / 2;
    body.position.y = pose.lie * 0.3;
    body.position.z = -pose.lie * 0.55;

    // parpadeo
    blink -= dt;
    const closed = blink < 0.12;
    if (blink < 0) blink = 2 + Math.random() * 3;
    for (const e of eyes) e.scale.y = closed ? 0.12 : 1;

    const s = 0.7 + Math.min(1, load) * 0.7;
    sack.scale.set(s, s * 1.15, s * 0.85);
    sack.visible = load > 0.02;
    M.top.color.set(PALETTES.ropa[look.arribaColor]).multiplyScalar(1 - dirt * 0.35 - wet * 0.15);
  }

  return {
    group: root,
    get look() { return look; },
    setLook(l) {
      look = normalizeLook(l);
      build();
    },
    update,
  };
}
