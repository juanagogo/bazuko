// src/entities/ExhaustedGait.js
// Caminar de persona agotada y desnutrida con cojera (pierna DERECHA lesionada).
// Capa procedural superpuesta sobre el clip Walking: se llama update() antes de
// mixer.update (fija el ritmo) y apply() despues (suma rotaciones a los huesos).
// Sin allocations por frame. Los angulos estan en radianes y se expresan en el
// marco del personaje (X = su izquierda, Y = arriba, Z = hacia adelante).
import * as THREE from 'three';

// ---------------------------------------------------------------- AJUSTES
export const GAIT = {
  WALK_TIMESCALE: 0.65,   // velocidad del clip Walking (1 = original)
  WALK_SPEED_SCALE: 0.62, // multiplicador de la velocidad de caminar del jugador (sincroniza con el timeScale)
  RUN_INTENSITY: 1.0,     // peso de la capa al correr (el resto de RUN_* la vuelve trote agotado)
  RATE_VAR: 0.12,         // irregularidad del ritmo de paso (+-)
  FADE_IN: 3.5,           // 1/s, velocidad de entrada de la capa
  FADE_OUT: 10,           // 1/s, salida al detenerse (~ fundido del mixer)

  // Cojera (pierna lesionada = derecha)
  LIMP: 1.0,              // escala global de la cojera
  HIP_DROP: 0.075,        // caida de cadera hacia el lado sano en apoyo de la pierna lesionada
  TRUNK_LEAN: 0.085,      // inclinacion del torso sobre la pierna lesionada
  INJ_STEP_DAMP: 0.38,    // 0..1 acorta el paso de la pierna lesionada (hacia pose neutra)
  OK_STEP_DAMP: 0.15,     // idem pierna sana
  INJ_FAST_STANCE: 0.15,  // la fase de apoyo lesionada pasa algo mas rapido
  KNEE_BASE: 0.09,        // flexion base de rodillas
  KNEE_INJ_EXTRA: 0.08,   // flexion extra de la rodilla lesionada al apoyar
  KNEE_JITTER: 0.045,     // inestabilidad de rodillas (ruido)
  DRAG_TOE: 0.40,         // punta del pie lesionado hacia abajo al arrastrar
  DRAG_EVERY: [4, 9],     // s entre arrastres
  DRAG_DURATION: [2.0, 3.2],

  // Postura
  HIP_PITCH: 0.05,
  SPINE_PITCH: [0.13, 0.12, 0.10], // Spine, Spine1, Spine2 (encorvado)
  NECK_PITCH: 0.12,
  HEAD_PITCH: 0.10,
  SHOULDER_DROP: 0.10,
  ARM_DAMP: 0.55,         // reduce el balanceo de brazos (hacia pose neutra)
  FOREARM_DAMP: 0.4,
  SWAY: 1.0,              // escala del balanceo irregular del torso

  // Cabeza que cae
  HEAD_DROP_EVERY: [7, 14],
  HEAD_DROP_DURATION: [1.5, 2.6],
  HEAD_DROP_PITCH: 0.30,
  NECK_DROP_PITCH: 0.14,

  // Temblor de manos
  TREMOR: 0.022,

  // Respiracion pesada y lenta
  BREATH_HZ: 0.2,
  BREATH_PITCH: 0.022,
  BREATH_SHOULDER: 0.025,

  // Pausas
  PAUSE_EVERY: [6, 12],   // s entre pausas (solo caminando)
  PAUSE_DURATION: [0.5, 1.0],
  PAUSE_EASE: 5,          // 1/s, suavidad de frenado/arranque
  PAUSE_WAIT_MAX: 1.5,    // s max esperando doble apoyo para pausar

  // ---- Correr = extension dolorosa del caminar agotado (trote lento, torpe, irregular) ----
  RUN_TIMESCALE: 1.15,    // velocidad del clip Running (1 = original); antes 0.62
  RUN_SPEED_SCALE: 1.1,   // (6 * 1.1 = 6.6 u/s; antes 0.55 => 3.3) multiplicador de la velocidad de correr (zancada corta => algo menos que el timeScale)
  RUN_FADE: 0.28,         // s, crossFade caminar<->correr
  RUN_BLEND: 4,           // 1/s, mezcla suave de los parametros caminar->correr
  RUN_RATE_VAR: 0.16,     // irregularidad del ritmo al correr
  RUN_INJ_FAST: 0.32,     // la pierna lesionada sale mas rapido del apoyo (no soporta el peso)
  RUN_STEP_DAMP_INJ: 0.50, // acorta la zancada de la pierna lesionada
  RUN_STEP_DAMP_OK: 0.30,  // y la sana (pasos cortos)
  RUN_LIMP_MULT: 0.6,     // + cojera (caida de cadera / inclinacion sobre la lesionada)
  RUN_TRUNK_PITCH: [0.09, 0.07, 0.05], // inclinacion extra de Spine, Spine1, Spine2 (como si fuera a caer)
  RUN_HIP_PITCH: 0.04,
  RUN_LATERAL: 0.10,      // balanceo lateral del torso segun el pie que apoya
  RUN_SWAY_MULT: 1.8,     // x balanceo irregular del torso
  RUN_ARM_DAMP: [0.5, 0.82],   // izq, der: der casi inmovil (asimetria)
  RUN_FOREARM_DAMP: [0.3, 0.6],
  RUN_SHRUG: 0.17,        // hombros encogidos (resta a SHOULDER_DROP)
  RUN_HEAD_PITCH: 0.12,   // cabeza colgando
  RUN_HEAD_NOD: 0.05,     // cabeceo con la respiracion
  RUN_KNEE_EXTRA: 0.08,   // rodillas mas flexionadas
  RUN_KNEE_JITTER_MULT: 1.6,
  RUN_TREMOR_MULT: 1.8,
  RUN_BREATH_HZ: 0.55,    // respiracion agitada
  RUN_BREATH_AMP: 2.4,    // x amplitud de pecho/hombros
  RUN_DRAG_TOE: 0.55,     // arrastre del pie lesionado
  RUN_DRAG_EVERY: [2.5, 5],
  RUN_DRAG_DURATION: [0.5, 0.9],
  RUN_STUMBLE_EVERY: [5, 9], // s entre tropiezos leves
  RUN_STUMBLE_DURATION: [0.6, 0.9],
  RUN_STUMBLE_SLOW: 0.4,  // frenada de ritmo durante el tropiezo
  RUN_STUMBLE_PITCH: 0.14, // cabeceo extra del torso
  RUN_STUMBLE_ARMS: 0.28  // brazos adelante para equilibrarse
};

const TAU = Math.PI * 2;
const rand = (r) => r[0] + Math.random() * (r[1] - r[0]);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// Ruido suave: suma de senos con frecuencias inconmensurables, rango ~[-1,1]
const noise = (t, s) =>
  Math.sin(t * 0.83 + s * 1.7) * 0.5 +
  Math.sin(t * 1.37 + s * 3.1) * 0.3 +
  Math.sin(t * 2.11 + s * 5.3) * 0.2;

// Temporales reutilizables
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _pw = new THREE.Quaternion();
const _rel = new THREE.Quaternion();
const _relInv = new THREE.Quaternion();
const _rootInv = new THREE.Quaternion();

const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'RightShoulder',
  'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand',
  'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'
];
const DAMPED = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
  'LeftUpLeg', 'RightUpLeg'];

export class ExhaustedGait {
  constructor(model) {
    this.model = model;
    this.b = {};
    for (const n of BONES) {
      this.b[n] = model.getObjectByName('mixamorig' + n) ||
                  model.getObjectByName('mixamorig:' + n) || null;
    }
    this.ok = !!(this.b.Hips && this.b.LeftUpLeg && this.b.RightUpLeg &&
                 this.b.LeftFoot && this.b.RightFoot);
    this.neutral = {};
    this.t = 0;
    this.weight = 0;       // 0..1 (ya incluye intensidad)
    this.rate = 1;         // multiplicador de ritmo (timeScale y velocidad)
    this.stance = 0.5;     // peso de apoyo de la pierna derecha (0..1)
    this._pauseF = 1;
    this._pauseT = 0;
    this._nextPause = rand(GAIT.PAUSE_EVERY);
    this._dropT = 0; this._dropDur = 1; this._nextDrop = rand(GAIT.HEAD_DROP_EVERY);
    this._dragT = 0; this._dragDur = 1; this._nextDrag = rand(GAIT.DRAG_EVERY);
    this._drop = 0; this._drag = 0;
    this._doubleSupport = false;
    this.runMix = 0;       // 0 = caminar, 1 = correr (mezcla suave de parametros)
    this._bph = 0;         // fase de respiracion (acumulada: la frecuencia cambia sin saltos)
    this._stumbleT = 0; this._stumbleDur = 1; this._nextStumble = rand(GAIT.RUN_STUMBLE_EVERY);
    this._stumble = 0;
  }

  get active() { return this.weight > 0.002; }

  // Guarda la pose neutra actual (modelo en pose quieta) para amortiguar balanceos
  captureNeutral() {
    for (const n of DAMPED) {
      if (this.b[n]) this.neutral[n] = this.b[n].quaternion.clone();
    }
  }

  // mode: 'walk' | 'run' | null. Llamar ANTES de mixer.update.
  update(dt, mode) {
    const G = GAIT;
    this.t += dt;
    const target = mode === 'walk' ? 1 : mode === 'run' ? G.RUN_INTENSITY : 0;
    const running = mode === 'run';
    // Mezcla caminar<->correr (al detenerse se mantiene el ultimo valor durante el fundido)
    if (mode) this.runMix += ((running ? 1 : 0) - this.runMix) * (1 - Math.exp(-dt * G.RUN_BLEND));
    this._bph += TAU * (G.BREATH_HZ + (G.RUN_BREATH_HZ - G.BREATH_HZ) * this.runMix) * dt;
    const f = target > this.weight ? G.FADE_IN : G.FADE_OUT;
    this.weight += (target - this.weight) * (1 - Math.exp(-dt * f));
    if (target === 0 && this.weight < 0.002) this.weight = 0;

    const walking = mode === 'walk';
    if (walking) {
      // Pausas: esperar doble apoyo (pies a ras y separados) para no congelar un pie en el aire
      if (this._pauseT > 0) {
        this._pauseT -= dt;
      } else {
        this._nextPause -= dt;
        if (this._nextPause <= 0 && (this._doubleSupport || this._nextPause < -G.PAUSE_WAIT_MAX)) {
          this._pauseT = rand(G.PAUSE_DURATION);
          this._nextPause = rand(G.PAUSE_EVERY);
        }
      }
      if (this._dropT > 0) this._dropT -= dt;
      else if ((this._nextDrop -= dt) <= 0) {
        this._dropDur = this._dropT = rand(G.HEAD_DROP_DURATION);
        this._nextDrop = rand(G.HEAD_DROP_EVERY);
      }
      if (this._dragT > 0) this._dragT -= dt;
      else if ((this._nextDrag -= dt) <= 0) {
        this._dragDur = this._dragT = rand(G.DRAG_DURATION);
        this._nextDrag = rand(G.DRAG_EVERY);
      }
    }
    if (running) {
      this._pauseT = 0;
      if (this._dragT > 0) this._dragT -= dt;
      else if ((this._nextDrag -= dt) <= 0) {
        this._dragDur = this._dragT = rand(G.RUN_DRAG_DURATION);
        this._nextDrag = rand(G.RUN_DRAG_EVERY);
      }
      if (this._stumbleT > 0) this._stumbleT -= dt;
      else if ((this._nextStumble -= dt) <= 0) {
        this._stumbleDur = this._stumbleT = rand(G.RUN_STUMBLE_DURATION);
        this._nextStumble = rand(G.RUN_STUMBLE_EVERY);
      }
    } else if (mode) {
      this._stumbleT = 0;
    }
    const pTarget = walking && this._pauseT > 0 ? 0 : 1;
    this._pauseF += (pTarget - this._pauseF) * (1 - Math.exp(-dt * G.PAUSE_EASE));

    // Envolventes suaves
    const env = (rem, dur) => {
      if (rem <= 0) return 0;
      const s = Math.sin(Math.PI * (1 - rem / dur));
      return s * s;
    };
    this._drop = env(this._dropT, this._dropDur);
    this._drag = env(this._dragT, this._dragDur);
    this._stumble = env(this._stumbleT, this._stumbleDur);

    if (walking) {
      const s = this.stance; // 1 = apoyada la derecha (lesionada)
      this.rate = this._pauseF *
        (1 + G.RATE_VAR * noise(this.t * 0.9, 7)) *
        (1 + G.INJ_FAST_STANCE * G.LIMP * (s - 0.5));
    } else if (running) {
      // Trote irregular; la pierna lesionada sale rapido del apoyo; el tropiezo frena el ritmo
      this.rate = (1 + G.RUN_RATE_VAR * noise(this.t * 1.1, 9)) *
        (1 + G.RUN_INJ_FAST * G.LIMP * (this.stance - 0.5)) *
        (1 - G.RUN_STUMBLE_SLOW * this._stumble);
    } else {
      this.rate = 1;
    }
  }

  // Rota "bone" en el marco del personaje (ver cabecera), sumando a la animacion
  _rot(bone, x, y, z) {
    if (!bone) return;
    bone.parent.getWorldQuaternion(_pw);
    _rel.copy(_rootInv).multiply(_pw);
    _relInv.copy(_rel).invert();
    _e.set(x, y, z, 'XYZ');
    _q.setFromEuler(_e);
    _qt.copy(_relInv).multiply(_q).multiply(_rel);
    bone.quaternion.premultiply(_qt);
  }

  _damp(name, k) {
    const b = this.b[name], n = this.neutral[name];
    if (b && n) b.quaternion.slerp(n, k);
  }

  // Llamar DESPUES de mixer.update
  apply() {
    if (!this.ok || this.weight <= 0.002) return;
    const G = GAIT, B = this.b, t = this.t;
    const k = this.weight;
    const rm = this.runMix, m = rm * k;
    const mix = (a, b) => a + (b - a) * rm;
    const model = this.model;
    const frame = model.parent || model;

    model.updateMatrixWorld(true);

    // Fase de apoyo a partir de la altura relativa de los pies (antes de modificar)
    const eL = B.LeftFoot.matrixWorld.elements;
    const eR = B.RightFoot.matrixWorld.elements;
    const dy = eL[13] - eR[13];
    const spread = Math.hypot(eL[12] - eR[12], eL[14] - eR[14]);
    this._doubleSupport = Math.abs(dy) < 0.03 && spread > 0.15;
    const tgt = clamp01(0.5 + 0.5 * (dy / mix(0.08, 0.13)));
    this.stance += (tgt - this.stance) * 0.35;
    const sR = this.stance, sL = 1 - sR;

    frame.getWorldQuaternion(_rootInv).invert();

    // Amortiguar balanceo de brazos y longitud de paso hacia la pose neutra
    const nz = noise(t * 0.7, 11);
    this._damp('LeftArm', mix(G.ARM_DAMP, G.RUN_ARM_DAMP[0]) * k);
    this._damp('RightArm', mix(G.ARM_DAMP, G.RUN_ARM_DAMP[1]) * k);
    this._damp('LeftForeArm', mix(G.FOREARM_DAMP, G.RUN_FOREARM_DAMP[0]) * k);
    this._damp('RightForeArm', mix(G.FOREARM_DAMP, G.RUN_FOREARM_DAMP[1]) * k);
    this._damp('RightUpLeg', mix(G.INJ_STEP_DAMP, G.RUN_STEP_DAMP_INJ) * G.LIMP * k * (0.85 + 0.15 * nz));
    this._damp('LeftUpLeg', mix(G.OK_STEP_DAMP, G.RUN_STEP_DAMP_OK) * k * (0.85 - 0.15 * nz));

    // Balanceo irregular de baja frecuencia
    const sw = G.SWAY * k * (1 + (G.RUN_SWAY_MULT - 1) * rm);
    const st = this._stumble * m;
    const swRoll = noise(t * 0.55, 1) * sw;
    const swYaw = noise(t * 0.45, 2) * sw;
    const swPitch = noise(t * 0.35, 3) * sw;
    const limp = G.LIMP * k * (1 + G.RUN_LIMP_MULT * rm);
    const breath = Math.sin(this._bph + 0.4 * Math.sin(t * 0.31)) * (1 + (G.RUN_BREATH_AMP - 1) * rm);
    const lat = (sR - 0.5) * 2 * G.RUN_LATERAL * m; // balanceo lateral segun el pie que apoya

    // Cadera y torso
    const hipRoll = -G.HIP_DROP * sR * limp;
    const hipPitch = (G.HIP_PITCH + G.RUN_HIP_PITCH * rm) * k;
    this._rot(B.Hips, hipPitch, swYaw * 0.04, hipRoll + swRoll * 0.02 - lat * 0.4);
    const lean = (G.TRUNK_LEAN + 0.5 * G.HIP_DROP) * sR * limp;
    const sp = G.RUN_TRUNK_PITCH, sPitch = G.RUN_STUMBLE_PITCH * st;
    this._rot(B.Spine, (G.SPINE_PITCH[0] + sp[0] * rm) * k + swPitch * 0.02 + sPitch * 0.4,
      swYaw * 0.05, lean + swRoll * 0.03 + lat * 0.6);
    this._rot(B.Spine1, (G.SPINE_PITCH[1] + sp[1] * rm) * k + sPitch * 0.35,
      swYaw * 0.04, swRoll * 0.04 + lat * 0.4);
    this._rot(B.Spine2, (G.SPINE_PITCH[2] + sp[2] * rm) * k + sPitch * 0.25 + breath * G.BREATH_PITCH * k,
      swYaw * 0.03, swRoll * 0.03);

    // Cuello y cabeza (caida ocasional)
    const dr = this._drop * k;
    this._rot(B.Neck, G.NECK_PITCH * k + G.NECK_DROP_PITCH * dr + G.RUN_HEAD_PITCH * 0.5 * m, swYaw * 0.03, 0);
    this._rot(B.Head, G.HEAD_PITCH * k + G.HEAD_DROP_PITCH * dr + G.RUN_HEAD_PITCH * 0.5 * m +
      breath * G.RUN_HEAD_NOD * m + sPitch * 0.5, -swYaw * 0.05, -swRoll * 0.03 - lat * 0.5);

    // Hombros caidos + respiracion
    const lift = breath * G.BREATH_SHOULDER * k;
    const drop = G.SHOULDER_DROP * k - G.RUN_SHRUG * m; // al correr: encogidos y tensos
    this._rot(B.LeftShoulder, 0, 0, -drop + lift);
    this._rot(B.RightShoulder, 0, 0, drop - lift);

    // Brazos sueltos y temblor de manos
    const tr = G.TREMOR * k * (1 + (G.RUN_TREMOR_MULT - 1) * rm);
    const trem = (f1, f2, s) => (Math.sin(TAU * f1 * t + s) * 0.6 + Math.sin(TAU * f2 * t + s * 2.3) * 0.4) * tr;
    const armFwd = G.RUN_STUMBLE_ARMS * st; // en el tropiezo los brazos se adelantan
    this._rot(B.LeftArm, 0.04 * k - armFwd, 0, 0);
    this._rot(B.RightArm, 0.04 * k - armFwd * 0.6, 0, 0);
    this._rot(B.LeftHand, trem(6.3, 9.1, 0.2), trem(7.7, 11.3, 1.1), trem(5.9, 8.3, 2.0));
    this._rot(B.RightHand, trem(6.9, 9.7, 3.0), trem(7.1, 10.7, 4.1), trem(6.1, 8.9, 5.2));

    // Piernas: rodillas flexionadas e inestables, pie lesionado que se arrastra
    const jm = 1 + (G.RUN_KNEE_JITTER_MULT - 1) * rm;
    const kjR = noise(t * 0.8, 21) * G.KNEE_JITTER * k * jm;
    const kjL = noise(t * 0.7, 22) * G.KNEE_JITTER * k * jm;
    const kb = G.KNEE_BASE + G.RUN_KNEE_EXTRA * rm;
    const kneeR = (kb + G.KNEE_INJ_EXTRA * sR * G.LIMP * (1 + rm)) * k + kjR;
    const kneeL = kb * k + kjL;
    const uR = -0.5 * kneeR, uL = -0.5 * kneeL;
    this._rot(B.RightUpLeg, uR, 0, 0);
    this._rot(B.LeftUpLeg, uL, 0, 0);
    this._rot(B.RightLeg, kneeR, 0, 0);
    this._rot(B.LeftLeg, kneeL, 0, 0);

    // Pie: compensar la cadena para mantenerlo plano al apoyar; punta caida al arrastrar
    const hp = hipPitch;
    const drag = this._drag * (1 - sR) * mix(G.DRAG_TOE, G.RUN_DRAG_TOE) * limp;
    this._rot(B.RightFoot, -(hp + uR + kneeR) * (0.5 + 0.5 * sR) + drag, 0, 0);
    this._rot(B.LeftFoot, -(hp + uL + kneeL) * (0.5 + 0.5 * sL), 0, 0);
  }
}
