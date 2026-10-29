// src/character/melee.js
// Animación procedural de golpes sobre el esqueleto Mixamo del personaje realista.
// No hay clips de pelea: después de que el mixer pose el cuerpo (caminar, quieto…) se suma una rotación
// por hueso según la fase del ataque. Los giros se definen en ejes del personaje (+X su izquierda,
// +Y arriba, +Z al frente) y se convierten al espacio del padre de cada hueso, así funcionan igual
// con los brazos colgando o en movimiento. Cada personaje tiene su propio estado; no toca los clips.
import * as THREE from 'three';
import { findBone } from './props.js';

// Fracción del `windup` que se usa en cargar el golpe; el resto es el latigazo hacia el impacto.
const COCK = 0.6;
const FOLLOW = 30; // rapidez con la que la pose sigue al objetivo (1/s): suaviza empalmes entre golpes

// Ranuras del vector de pose
const TY = 0, TX = 1, RA = 2, RF = 5, LA = 8, LF = 11, SIZE = 14;

// Guardia: puño delante del mentón con el codo cerrado (no a la altura de la cara)
const GUARD_A = [-0.75, -0.4, 0], GUARD_F = [-1.4, -0.2, 0];

// Pose con el atacante a la derecha (a: brazo, f: antebrazo; ga/gf: guardia). `ty` gira el torso sobre Y
// (+ adelanta el hombro derecho), `tx` lo inclina hacia delante. Rotaciones en radianes, ejes del personaje.
const pose = (ty, tx, a, f, ga = GUARD_A, gf = GUARD_F) => ({ ty, tx, a, f, ga, gf });

function flat(p, side) {
  const out = new Float32Array(SIZE);
  const m = side === 'L' ? -1 : 1; // espejo: invierte giro lateral (Y, Z) e intercambia brazos
  out[TY] = p.ty * m; out[TX] = p.tx;
  const put = (at, v) => { out[at] = v[0]; out[at + 1] = v[1] * m; out[at + 2] = v[2] * m; };
  put(side === 'L' ? LA : RA, p.a); put(side === 'L' ? LF : RF, p.f);
  put(side === 'L' ? RA : LA, p.ga); put(side === 'L' ? RF : LF, p.gf);
  return out;
}

const step = (side, cock, strike) => ({ side, cock: flat(cock, side), strike: flat(strike, side) });

const POSES = {
  // jab (izq.), cruzado (der.), gancho (izq.)
  punos: [
    step('L', pose(-0.15, 0.05, [-0.75, 0.35, 0], [-1.45, 0.2, 0]), pose(0.2, 0.1, [-1.5, 0.3, 0], [-0.1, 0, 0])),
    step('R', pose(-0.35, 0.05, [-0.7, 0.25, 0], [-1.5, 0.2, 0]), pose(0.55, 0.15, [-1.45, 0.3, 0], [-0.1, 0, 0])),
    step('L', pose(-0.5, 0, [-1.1, -0.7, 0], [-1.6, 0, 0]), pose(0.7, 0.1, [-1.3, 0.9, 0], [-1.5, 0, 0]))
  ],
  // tajo horizontal, revés y estocada
  cuchillo: [
    step('R', pose(-0.55, 0.1, [-1.3, -0.8, 0], [-0.7, 0, 0], [-0.6, -0.2, 0], [-1.2, 0, 0]), pose(0.65, 0.15, [-1.35, 0.85, 0], [-0.25, 0, 0], [-0.6, -0.2, 0], [-1.2, 0, 0])),
    step('R', pose(0.5, 0.1, [-1.3, 0.8, 0], [-0.6, 0, 0], [-0.6, -0.2, 0], [-1.2, 0, 0]), pose(-0.6, 0.15, [-1.3, -0.9, 0], [-0.25, 0, 0], [-0.6, -0.2, 0], [-1.2, 0, 0])),
    step('R', pose(-0.3, 0.05, [-0.6, 0.2, 0], [-1.6, 0, 0]), pose(0.4, 0.2, [-1.45, 0.15, 0], [-0.05, 0, 0]))
  ],
  // tajo desde arriba en diagonal y estocada
  botella_picada: [
    step('R', pose(-0.2, -0.1, [-2.7, -0.25, 0], [-0.8, 0, 0]), pose(0.3, 0.4, [-1.3, 0.2, 0], [-0.25, 0, 0])),
    step('R', pose(-0.3, 0.05, [-0.6, 0.2, 0], [-1.6, 0, 0]), pose(0.45, 0.25, [-1.4, 0.2, 0], [-0.1, 0, 0]))
  ]
};

const poseFor = (attack) => {
  const list = POSES[attack.weapon] ?? POSES.punos;
  return list[Math.min(attack.step ?? 0, list.length - 1)];
};

/** Lado ('L' | 'R') del brazo que golpea en este ataque. */
export const attackSide = (attack) => (attack ? poseFor(attack).side : 'R');

const easeOut = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const COCK_AMOUNT = -0.35;

/**
 * Qué tan extendido está el golpe: de -0.35 (cargado hacia atrás) a 1 (impacto), 0 en reposo.
 * Sirve para el cuerpo procedural, que no tiene huesos Mixamo.
 */
export function attackExtension(attack) {
  if (!attack) return 0;
  const p = clamp01(attack.progress ?? 0);
  if (attack.phase === 'windup') {
    if (p < COCK) return COCK_AMOUNT * easeOut(p / COCK);
    return COCK_AMOUNT + (1 - COCK_AMOUNT) * easeOut((p - COCK) / (1 - COCK));
  }
  if (attack.phase === 'active') return 1;
  return 1 - smooth(p);
}

// Cuánto del giro del torso toma cada vértebra
const TORSO = [['Spine', 0.25], ['Spine1', 0.35], ['Spine2', 0.4]];
const ARMS = [['RightArm', RA], ['RightForeArm', RF], ['LeftArm', LA], ['LeftForeArm', LF]];

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _f = new THREE.Quaternion();
const _p = new THREE.Quaternion();

/**
 * Superposición de ataque para un esqueleto. `frame` es el objeto cuyos ejes definen el espacio del
 * personaje (la raíz de la instancia). Llamar a `apply` cada cuadro después de `mixer.update`.
 */
export function createMeleeOverlay(bones, frame) {
  const torso = TORSO.map(([name, share]) => ({ bone: findBone(bones, name), share })).filter((t) => t.bone);
  const arms = ARMS.map(([name, at]) => ({ bone: findBone(bones, name), at })).filter((a) => a.bone);
  const cur = new Float32Array(SIZE);
  const goal = new Float32Array(SIZE);

  function target(attack) {
    if (!attack) { goal.fill(0); return; }
    const { cock, strike } = poseFor(attack);
    const p = clamp01(attack.progress ?? 0);
    let from, to, k;
    if (attack.phase === 'windup') {
      if (p < COCK) { from = null; to = cock; k = easeOut(p / COCK); }
      else { from = cock; to = strike; k = easeOut((p - COCK) / (1 - COCK)); }
    } else if (attack.phase === 'active') { from = strike; to = strike; k = 1; }
    else { from = strike; to = null; k = smooth(p); }
    for (let i = 0; i < SIZE; i++) {
      const a = from ? from[i] : 0, b = to ? to[i] : 0;
      goal[i] = a + (b - a) * k;
    }
  }

  // Gira `bone` por (x, y, z) en ejes del personaje: q_local = rel⁻¹ · R · rel, con rel = frame⁻¹ · padre
  function rotate(bone, x, y, z) {
    if (!x && !y && !z) return;
    frame.getWorldQuaternion(_f).invert();
    bone.parent.getWorldQuaternion(_p);
    _p.premultiply(_f);
    _q.setFromEuler(_e.set(x, y, z, 'YXZ'));
    _q.premultiply(_f.copy(_p).invert()).multiply(_p);
    bone.quaternion.premultiply(_q);
  }

  const overlay = {
    active: false,
    apply(dt, attack) {
      target(attack);
      const k = 1 - Math.exp(-FOLLOW * dt);
      let energy = 0;
      for (let i = 0; i < SIZE; i++) {
        cur[i] += (goal[i] - cur[i]) * k;
        energy += Math.abs(cur[i]);
      }
      overlay.active = !!attack || energy > 0.002;
      if (!overlay.active) { cur.fill(0); return; }
      for (const t of torso) rotate(t.bone, cur[TX] * t.share, cur[TY] * t.share, 0);
      for (const a of arms) rotate(a.bone, cur[a.at], cur[a.at + 1], cur[a.at + 2]);
    }
  };
  return overlay;
}
