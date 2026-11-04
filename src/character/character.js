import * as THREE from 'three';
import { PALETTES, DEFAULT_LOOK, normalizeLook } from './look.js';
import { animationDamping } from './SecondaryMotion.js';
import { ActionPose } from './ActionPose.js';
import { createWeapon } from './props.js';
import { createCigarette, puffReach, emberGlow } from './smoking.js';
import { createPipe, createLighter, basucoReach, isLit, BASUCO } from './pipe.js';

export { DEFAULT_LOOK };

const lerp = THREE.MathUtils.lerp;
const clamp01 = value => Math.min(1, Math.max(0, value));
const ease = (start, end, value) => {
  const u = clamp01((value - start) / (end - start));
  return u * u * (3 - 2 * u);
};
const lam = (color) => new THREE.MeshLambertMaterial({ color });

// Calada del personaje liviano: brazo izquierdo con la mano en la boca y el cigarrillo
// en el antebrazo (posición y giro en sus ejes).
export const PUFF_POSE = {
  elbL: -0.97, armLx: -1.45, armLz: -0.67, headX: 0.12,
  cigarette: [-0.01, -0.25, 0.05], cigaretteRotation: [1.21, 0.14, -1.02]
};

// Basuco del personaje liviano: agachado, pipa en la izquierda y encendedor en la derecha.
export const BASUCO_POSE_LIVIANO = {
  pose: { lean: 0.35, headX: 0.12, kneeL: 0.7, kneeR: 0.7, legL: -0.35, legR: -0.35,
    armLx: -1.45, armLz: -0.67, elbL: -0.97, armRx: -1.3, armRz: 0.55, elbR: -1.2 },
  pipe: [-0.01, -0.25, 0.05], pipeRotation: [1.21, 0.14, -1.02],
  lighter: [0.0, -0.25, 0.05], lighterRotation: [0, 0, 0]
};

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
    const foot = new THREE.Group();
    // Coincide con el extremo histórico que usa el ragdoll para sus cajas.
    foot.position.set(0, -.24, 0);
    knee.add(foot);
    return { hip, knee, foot, side };
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
    const s = { upper: new THREE.Group(), lower: new THREE.Group(), shoe: new THREE.Group() };
    l.hip.add(s.upper);
    l.knee.add(s.lower);
    l.foot.add(s.shoe);
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
      clear(s.shoe);
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
        s.shoe.add(shoe);
      } else if (L.zapatos === 'chanclas') {
        s.shoe.add(mesh(new THREE.BoxGeometry(0.13, 0.06, 0.22), M.skin, 0, -0.23, 0.04));
        s.shoe.add(mesh(new THREE.BoxGeometry(0.15, 0.025, 0.25), M.shoe, 0, -0.27, 0.04));
        s.shoe.add(mesh(new THREE.BoxGeometry(0.14, 0.02, 0.04), M.shoe, 0, -0.2, 0.08));
      } else {
        s.shoe.add(mesh(new THREE.BoxGeometry(0.16, 0.16, 0.25), M.shoe, 0, -0.2, 0.035));
        s.shoe.add(mesh(new THREE.BoxGeometry(0.165, 0.035, 0.26), lam('#2a1d14'), 0, -0.275, 0.035));
      }
      // El zapato gira desde el tobillo, independiente de la espinilla.
      for (const part of s.shoe.children) part.position.sub(legs[i].foot.position);
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

  const pose = { lean: 0, twist: 0, sway: 0, armLx: 0, armRx: 0, armLz: 0, armRz: 0, elbL: 0, elbR: 0, legL: 0, legR: 0, kneeL: 0, kneeR: 0, bob: 0, crouch: 0, lie: 0, headX: 0, headY: 0 };
  let phase = 0;
  let actionTime = 0, previousAction = null, previousProgress = 0;
  let idleTime = Math.random() * 20;
  let blink = 2;
  const ragdollRig = { hips, spine: torso, head,
    leftArm: arms[0].shoulder, leftForeArm: arms[0].elbow,
    rightArm: arms[1].shoulder, rightForeArm: arms[1].elbow,
    leftUpLeg: legs[0].hip, leftLeg: legs[0].knee,
    rightUpLeg: legs[1].hip, rightLeg: legs[1].knee,
    leftFoot: legs[0].foot, rightFoot: legs[1].foot };
  const actionPose = new ActionPose(ragdollRig, { procedural: true });
  let weapon = null, weaponId = null, disposed = false;
  function setWeapon(id) {
    if (weaponId === id) return;
    weapon?.dispose();
    weaponId = id || null;
    weapon = createWeapon(weaponId);
    if (!weapon) return;
    // La tabla del arma casera atravesaría el piso si colgara en línea con el antebrazo: va inclinada hacia adelante.
    const long = weaponId === 'arma';
    weapon.object.position.set(0, -.2, 0);
    weapon.object.rotation.set(long ? -.96 : 0, 0, Math.PI);
    weapon.object.scale.setScalar(long ? 1 : 1.25);
    arms[1].elbow.add(weapon.object);
  }

  // Cigarrillo en la mano izquierda (al final del antebrazo)
  let cigarette = null;
  function setSmoking(on, kind = 'cigarrillo') {
    const want = on ? kind : null;
    if ((cigarette?.kind ?? null) === want) return;
    cigarette?.dispose();
    cigarette = null;
    if (!want) return;
    cigarette = createCigarette(want);
    cigarette.kind = want;
    cigarette.object.position.fromArray(PUFF_POSE.cigarette);
    cigarette.object.rotation.fromArray(PUFF_POSE.cigaretteRotation);
    cigarette.object.scale.setScalar(1.4);
    arms[0].elbow.add(cigarette.object);
  }
  const _mouthOffset = new THREE.Vector3();

  // Pipa y encendedor del basuco en las manos
  let basucoProps = null;
  function setBasuco(on) {
    if (!!basucoProps === !!on) return;
    if (basucoProps) { basucoProps.pipe.dispose(); basucoProps.lighter.dispose(); basucoProps = null; return; }
    const P = BASUCO_POSE_LIVIANO;
    const pipe = createPipe(), lighter = createLighter();
    pipe.object.position.fromArray(P.pipe); pipe.object.rotation.fromArray(P.pipeRotation);
    lighter.object.position.fromArray(P.lighter); lighter.object.rotation.fromArray(P.lighterRotation);
    for (const o of [pipe.object, lighter.object]) o.scale.setScalar(1.4);
    arms[0].elbow.add(pipe.object);
    arms[1].elbow.add(lighter.object);
    basucoProps = { pipe, lighter };
  }

  function update(dt, { speed = 0, running = false, action = null, t = 0, load = 0, dirt = 0, wet = 0, look: lookAt = 0, movement = {}, actionProgress, attack = null, smoke = null, basuco: pipeT = null, point = 0 } = {}) {
    if (disposed) return;
    actionPose.restore();
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    if (action !== previousAction || (Number.isFinite(actionProgress) && actionProgress < previousProgress - .01)) actionTime = 0;
    else actionTime += dt;
    previousAction = action;
    previousProgress = Number.isFinite(actionProgress) ? actionProgress : 0;
    const progress = duration => Number.isFinite(actionProgress) ? clamp01(actionProgress) : clamp01(actionTime / duration);
    idleTime += dt;
    const detached = movement.swimming || movement.grounded === false;
    const handsBlocked = detached || movement.landing > 0 || action === 'recibirGolpe' || action === 'dormir';
    const pipeAllowed = !handsBlocked && !attack && action !== 'golpear' && speed < .15 && pipeT != null;
    if (handsBlocked || attack || action === 'golpear' || pipeAllowed || point) smoke = null;
    if (!pipeAllowed) pipeT = null;
    if (handsBlocked || attack || smoke || pipeAllowed) lookAt = 0;
    if (cigarette) cigarette.object.visible = !handsBlocked && !attack && action !== 'golpear' && !pipeAllowed;
    if (weapon) weapon.object.visible = !detached && !pipeAllowed && action !== 'dormir';
    if (basucoProps) {
      basucoProps.pipe.object.visible = pipeAllowed;
      basucoProps.lighter.object.visible = pipeAllowed;
    }
    const gaitSpeed = detached ? 0 : speed;
    const target = { lean: 0, twist: 0, sway: 0, armLx: 0, armRx: 0, armLz: 0.12, armRz: -0.12, elbL: -0.2, elbR: -0.2, legL: 0, legR: 0, kneeL: 0, kneeR: 0, bob: 0, crouch: 0, lie: 0, headX: 0, headY: lookAt };
    const amp = Math.min(1, gaitSpeed / 3) * (running ? 1 : .78);
    if (gaitSpeed > 0.15) {
      // La fase sigue la distancia, no el reloj: al frenar el pie no sigue dando pasos.
      // Una vuelta contiene dos apoyos; el corredor usa una zancada más larga.
      const stride = lerp(2.1, 3.4, Math.min(1, Math.max(0, (gaitSpeed - 3) / 3)));
      phase = (phase + dt * gaitSpeed / stride * Math.PI * 2) % (Math.PI * 2);
      const s = Math.sin(phase);
      // La rodilla se recoge durante el paso de recuperación y cede al apoyar.
      const leftSwing = Math.max(0, -Math.cos(phase));
      const rightSwing = Math.max(0, Math.cos(phase));
      target.legL = s * .68 * amp;
      target.legR = -s * .68 * amp;
      target.kneeL = (.08 + leftSwing * (running ? .85 : .58)) * amp;
      target.kneeR = (.08 + rightSwing * (running ? .85 : .58)) * amp;
      target.armLx = -s * .58 * amp;
      target.armRx = s * .58 * amp;
      target.elbL = -.2 - (running ? .45 : .12) * amp;
      target.elbR = -.2 - (running ? .45 : .12) * amp;
      target.lean = .045 * amp + (running ? .09 * amp : 0);
      target.twist = s * .07 * amp;
      target.sway = -s * .035 * amp;
      target.headX = -target.lean * .35;
      target.headY = lookAt - target.twist * .35;
      target.bob = (Math.cos(phase * 2) - 1) * .012 * amp;
    } else {
      const breath = Math.sin(idleTime * 2.05);
      target.bob = breath * .004;
      target.lean = breath * .015;
      target.twist = Math.sin(idleTime * .61) * .015;
      target.sway = Math.sin(idleTime * .79) * .012;
      target.headX = Math.sin(idleTime * 0.9) * 0.04;
      target.headY = Math.cos(idleTime * 0.7) * 0.07 + lookAt;
      target.armLz = 0.14 + breath * 0.015;
      target.armRz = -0.14 - breath * 0.015;
    }
    if (!action) target.lean += Math.min(1, Math.max(0, load)) * .04;
    else target.twist = target.sway = 0;
    if (wet > 0.5 && gaitSpeed < 0.15 && !detached) {
      target.armLz = -0.3; target.armRz = 0.3; target.armLx = -0.6; target.armRx = -0.6; target.elbL = -1.5; target.elbR = -1.5;
    }
    const basePose = { ...target };
    let gestureWeight = 1;
    switch (detached ? null : action) {
      case 'buscar': {
        // Un brazo busca mientras el otro sostiene; no agita ambos como hélices.
        const reach = .5 + .5 * Math.sin(actionTime * 3.6);
        target.lean = .54; target.headX = .16;
        target.armLx = -.72; target.elbL = -.8;
        target.armRx = -.8 - reach * .35; target.elbR = -.25 - (1 - reach) * .55;
        target.armRz = .12; target.twist = -.06 + reach * .09;
        target.kneeL = .75; target.kneeR = 1.05; target.legL = -.38; target.legR = -.55;
        target.crouch = .075;
        break;
      }
      case 'pedir': {
        const offer = .5 + .5 * Math.sin(actionTime * 3.2);
        target.armRx = -1.05 - offer * .16; target.elbR = -.55;
        target.armRz = .2; target.armLx = -.15; target.elbL = -.5;
        target.lean = .055; target.headX = .025 + Math.sin(actionTime * 2.7) * .025;
        target.headY = -.08;
        break;
      }
      case 'banar': {
        const wash = Math.sin(actionTime * 4.8);
        target.armLx = -2.1 + wash * .25; target.armRx = -2.1 - wash * .25;
        target.armLz = -.35; target.armRz = .35;
        target.elbL = -.95; target.elbR = -.95; target.lean = .14; target.headX = .18;
        break;
      }
      case 'comer':
      case 'beber': {
        const p = progress(1.8);
        const sip = action === 'beber';
        gestureWeight = ease(0, .22, p) * (1 - ease(.72, 1, p));
        target.armRx = sip ? -1.55 : -1.45; target.armRz = .62;
        target.elbR = sip ? -.85 : -.97;
        target.headX = sip ? -.13 : .08 + Math.sin(p * Math.PI * 6) * .018;
        target.armLx = -.2; target.elbL = -.5;
        break;
      }
      case 'cagar':
        target.lean = .45; target.headX = -.1;
        target.kneeL = 2.1; target.kneeR = 2.1; target.legL = -1.15; target.legR = -1.15;
        target.armLx = -.65; target.armRx = -.65; target.elbL = -.6; target.elbR = -.6;
        // La flexión real de las piernas determina la altura, sin hundir las suelas.
        target.crouch = .2;
        break;
      case 'lanzar': {
        const p = progress(.8);
        const windup = ease(0, .32, p);
        const release = ease(.32, .5, p);
        const recover = ease(.56, 1, p);
        gestureWeight = ease(0, .12, p) * (1 - recover);
        target.lean = -.12 * windup + .27 * release;
        target.twist = -.25 * windup + .5 * release;
        target.headX = -.04;
        target.armRx = -2.65 * windup + 1.4 * release;
        target.elbR = -1.25 + 1.15 * release;
        target.armRz = -.16;
        target.armLx = -.5 + .5 * release; target.elbL = -.7;
        break;
      }
      case 'temblor': {
        const w = Math.sin(actionTime * 24);
        target.headX = w * .07; target.headY = Math.cos(actionTime * 21) * .09;
        target.armLx = -.65 + w * .1; target.armRx = -.65 - w * .1;
        target.elbL = target.elbR = -1.2;
        target.kneeL = .1 + Math.max(0, w * .08); target.kneeR = .1 + Math.max(0, -w * .08);
        break;
      }
      case 'saludo': {
        const p = progress(1.5);
        gestureWeight = ease(0, .2, p) * (1 - ease(.78, 1, p));
        target.armRx = -2.5; target.armRz = -.25 + Math.sin(p * Math.PI * 6) * .2;
        target.elbR = -.65; target.headY = -.06; target.headX = -.03;
        break;
      }
      case 'calentarse': {
        const p = progress(2.8);
        // Echar a andar baja las manos, igual que en el modelo realista.
        gestureWeight = gaitSpeed < .15 ? ease(0, .2, p) * (1 - ease(.86, 1, p)) : 0;
        target.armLx = target.armRx = -1.25;
        target.armLz = -.16; target.armRz = .16;
        target.elbL = target.elbR = -.42;
        target.lean = .07; target.headX = .09;
        break;
      }
      case 'dormir':
        target.lie = 1;
        target.lean = target.twist = target.sway = 0;
        target.legL = -.18; target.legR = -.28;
        target.kneeL = .25; target.kneeR = .48;
        target.armLx = -.18; target.armRx = -.25;
        target.armLz = -.08; target.armRz = .08;
        target.elbL = -1.05; target.elbR = -.9;
        target.headX = .07; target.headY = .12;
        break;
      default:
    }
    if (gestureWeight < 1) {
      for (const key of Object.keys(target)) target[key] = lerp(basePose[key], target[key], gestureWeight);
    }
    if (smoke && action !== 'dormir') {
      // sosteniéndolo con el codo algo doblado; en la calada, la mano sube a la boca
      const r = puffReach(smoke.puff);
      target.elbL = lerp(Math.min(target.elbL, -0.5), PUFF_POSE.elbL, r);
      target.armLx = lerp(target.armLx, PUFF_POSE.armLx, r);
      target.armLz = lerp(target.armLz, PUFF_POSE.armLz, r);
      target.headX = lerp(target.headX, PUFF_POSE.headX, r);
    }
    cigarette?.setGlow(emberGlow(smoke?.puff));
    if (pipeT != null) {
      const r = basucoReach(pipeT);
      for (const [key, value] of Object.entries(BASUCO_POSE_LIVIANO.pose)) target[key] = lerp(target[key], value, r);
      target.crouch = lerp(target.crouch, .035, r);
    }
    if (basucoProps) {
      const lit = isLit(pipeT);
      basucoProps.lighter.setFlame(lit, pipeT ?? 0);
      basucoProps.pipe.setGlow(lit ? 0.6 + 0.4 * Math.sin((pipeT ?? 0) * 9) ** 2 : Math.max(0, 1 - ((pipeT ?? 0) - BASUCO.bend - BASUCO.light)));
    }
    const k = animationDamping(dt, 12);
    for (const key of Object.keys(pose)) pose[key] = lerp(pose[key], target[key], k);

    const [aL, aR] = arms;
    const [lL, lR] = legs;
    torso.rotation.set(pose.lean, pose.twist, pose.sway);
    head.rotation.set(pose.headX, pose.headY, 0);
    aL.shoulder.rotation.set(pose.armLx, 0, pose.armLz);
    aR.shoulder.rotation.set(pose.armRx, 0, pose.armRz);
    aL.elbow.rotation.x = pose.elbL;
    aR.elbow.rotation.x = pose.elbR;
    lL.hip.rotation.x = pose.legL;
    lR.hip.rotation.x = pose.legR;
    lL.knee.rotation.x = pose.kneeL;
    lR.knee.rotation.x = pose.kneeR;
    // Los tobillos contrarrestan la flexión para que las suelas no atraviesen el suelo.
    lL.foot.rotation.x = -pose.legL - pose.kneeL;
    lR.foot.rotation.x = -pose.legR - pose.kneeR;
    const support = (leg, knee) => .24 * Math.cos(leg) + .24 * Math.cos(leg + knee) + .04;
    const groundSupport = Math.max(support(pose.legL, pose.kneeL), support(pose.legR, pose.kneeR));
    hips.position.y = detached ? .52 : lerp(groundSupport, .52, pose.lie);
    body.rotation.x = -pose.lie * Math.PI / 2;
    body.position.y = pose.lie * 0.3;
    body.position.z = -pose.lie * 0.55;
    actionPose.apply(dt, { speed, running, action, actionProgress, movement, attack, point });

    // parpadeo
    blink -= dt;
    const closed = blink < 0.12 || pose.lie > .7;
    if (blink < 0) blink = 2 + Math.random() * 3;
    for (const e of eyes) e.scale.y = closed ? 0.12 : 1;

    const s = 0.7 + Math.min(1, load) * 0.7;
    sack.scale.set(s, s * 1.15, s * 0.85);
    sack.visible = load > 0.02;
    M.top.color.set(PALETTES.ropa[look.arribaColor]).multiplyScalar(1 - dirt * 0.35 - wet * 0.15);
  }

  return {
    group: root,
    ragdollRig,
    get look() { return look; },
    /** Cuánto sigue acostado, de 0 (de pie) a 1 */
    get sleepWeight() { return pose.lie; },
    setLook(l) {
      look = normalizeLook(l);
      build();
    },
    setSmoking,
    setBasuco,
    setWeapon,
    dispose() {
      if (disposed) return;
      disposed = true;
      actionPose.restore();
      weapon?.dispose(); cigarette?.dispose();
      basucoProps?.pipe.dispose(); basucoProps?.lighter.dispose();
      const geometries = new Set(), materials = new Set();
      root.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of [object.material].flat()) if (material) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      root.removeFromParent();
    },
    pipeBowl(target) { return basucoProps ? basucoProps.pipe.top.getWorldPosition(target) : null; },
    cigaretteTip(target) { return cigarette ? cigarette.tip.getWorldPosition(target) : null; },
    mouth(target) {
      return target.copy(head.localToWorld(_mouthOffset.set(0, -0.115, 0.26)));
    },
    update,
  };
}
