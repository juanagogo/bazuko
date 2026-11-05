// src/character/gaitFamilies.js
// Familias de andar y reposo: clips intermedios horneados al cargar, una vez por cuerpo y familia.
// Mezclan en espacio local dos andares reales con la fase normalizada (cada ciclo empieza cuando el
// pie izquierdo pisa delante) y cada persona tiene un solo clip de andar en su mezclador, así que
// elegir familia no cuesta nada por cuadro. Las medidas de `measureLocomotion` salen del clip ya
// mezclado, para que los pies no patinen. Nada de esto toca la raíz física.
import { AnimationClip, AnimationMixer, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createRetargeter } from './retarget.js';
import { measureLocomotion } from './locomotion.js';
import { createSkinSupport } from './mixamoGrounding.js';
import { PoseRig } from './poseRig.js';

const DEFAULT_GAIT = 'normal';

// Reparto entre el andar erguido (0) y Sad Walk (1) por grupo de huesos. La cabeza va aparte
// porque Sad Walk la deja caer demasiado para llevarla todo el tiempo. El reposo se hornea sobre el
// cuerpo y se encorva lo que diga `reposo` (radianes de columna, cuello, hombros y rodillas). `apoyo`: lo que
// se dobla la rodilla de la pierna que pisa, en radianes, y lo que sube y baja la cadera en un paso, en metros.
export const GAIT_FAMILIES = Object.freeze({
  firme: { legs: .12, torso: .05, neck: 0, arms: .1, apoyo: { rodilla: .1, vaiven: .07 }, reposo: { spine: -.02, neck: -.03, shoulders: 0, knees: 0 } },
  normal: { legs: .5, torso: .35, neck: .12, arms: .5, apoyo: { rodilla: .14, vaiven: .06 }, reposo: { spine: .03, neck: .04, shoulders: .02, knees: .01 } },
  cansado: { legs: .85, torso: .7, neck: .42, arms: .9, apoyo: { rodilla: .2, vaiven: .05 }, reposo: { spine: .11, neck: .17, shoulders: .08, knees: .05 } },
  lento: { legs: 1, torso: .85, neck: .45, arms: 1, apoyo: { rodilla: .26, vaiven: .045 }, reposo: { spine: .17, neck: .2, shoulders: .1, knees: .09 } },
  // El jugador anda a 3 m/s, velocidad de trote. Este paso añade un tercer clip entre andar y correr:
  // piernas largas de `run` (`zancada`) con el torso, la cabeza y los brazos sueltos de quien va
  // cansado, para que no parezca correr hasta que corra. Despacio sigue siendo el andar cansado.
  trote: { legs: .85, torso: .75, neck: .3, arms: 1, zancada: .74, reposo: { spine: .11, neck: .17, shoulders: .08, knees: .05 } }
});

/** Familia válida; una desconocida o ausente es la normal. */
export const resolveGait = name => (Object.hasOwn(GAIT_FAMILIES, name ?? '') ? name : DEFAULT_GAIT);

// Altura de la piel de la planta sobre el piso: la suela de tenis y botas baja 1,6 cm más que la
// piel, y los zapatos casi nada. Con 1,2 cm ni el calzado se hunde a la vista ni el pie descalzo flota.
const FOOT_CLEARANCE = .012;
const FOOT_BONES = /(?:Left|Right)(?:Foot|ToeBase)$/;

const REST_SPAN = 6.4, REST_KEYS = 24;
const CYCLE_FPS = 30;

const groupOf = name => {
  if (/Hips|UpLeg|Leg|Foot|Toe/.test(name)) return 'legs';
  if (/Neck|Head/.test(name)) return 'neck';
  if (/Spine/.test(name)) return 'torso';
  return 'arms';
};

/** Copia del esqueleto, sin mallas, para muestrear y posar sin tocar el cuerpo original. */
function boneRig(scene) {
  let hips = null;
  scene.traverse(node => { if (!hips && node.isBone && /hips$/i.test(node.name)) hips = node; });
  if (!hips) throw new Error('El cuerpo no tiene cadera');
  scene.updateMatrixWorld(true);
  const root = new Group();
  // El padre de la cadera se resume en la raíz de la copia: los clips escriben posición local.
  hips.parent.matrixWorld.decompose(root.position, root.quaternion, root.scale);
  const copy = hips.clone(true);
  root.add(copy);
  const bones = new Map();
  copy.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  root.updateMatrixWorld(true);
  return { root, bones, hips: copy };
}

const findBone = (bones, suffix) => [...bones.values()].find(bone => bone.name.endsWith(suffix));

const samplers = clip => new Map(clip.tracks.map(track => [track.name, track.createInterpolant()]));

const contactCache = new Map();
/**
 * Fase (0–1) en que el pie izquierdo pisa delante: mayor separación adelante entre los dos pies.
 * Depende del clip, no del cuerpo, así que se mide una sola vez por nombre de clip.
 */
function contactPhase(rig, clip, cacheKey = null) {
  if (cacheKey && contactCache.has(cacheKey)) return contactCache.get(cacheKey);
  const left = findBone(rig.bones, 'LeftFoot'), right = findBone(rig.bones, 'RightFoot');
  const mixer = new AnimationMixer(rig.root);
  const action = mixer.clipAction(clip).play();
  const a = new Vector3(), b = new Vector3();
  const STEPS = 60;
  const reach = [];
  for (let i = 0; i < STEPS; i++) {
    action.time = i / STEPS * clip.duration;
    mixer.update(0);
    rig.root.updateMatrixWorld(true);
    reach.push(left.getWorldPosition(a).z - right.getWorldPosition(b).z);
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig.root);
  let best = 0;
  for (let i = 1; i < STEPS; i++) if (reach[i] > reach[best]) best = i;
  // Parábola por los tres vecinos: el pico cae entre muestras.
  const before = reach[(best + STEPS - 1) % STEPS], after = reach[(best + 1) % STEPS], curve = before - 2 * reach[best] + after;
  const phase = ((best + (Math.abs(curve) > 1e-9 ? .5 * (before - after) / curve : 0)) / STEPS + 1) % 1;
  if (cacheKey) contactCache.set(cacheKey, phase);
  return phase;
}

/**
 * Mezcla dos ciclos con la fase normalizada. `share(nombreDeHueso)` da cuánto toma del segundo.
 * El clip empieza en la pisada izquierda y su último cuadro coincide con el primero.
 */
function blendCycles(name, first, second, share, { phaseA = 0, phaseB = 0, duration = null } = {}) {
  const span = duration ?? first.duration;
  const frames = Math.max(9, Math.round(span * CYCLE_FPS) + 1);
  const times = new Float32Array(frames);
  for (let i = 0; i < frames; i++) times[i] = i / (frames - 1) * span;
  const fromA = samplers(first), fromB = samplers(second);
  const tracks = [];
  for (const track of first.tracks) {
    const other = fromB.get(track.name);
    if (!other) continue;
    const self = fromA.get(track.name);
    const size = track.getValueSize();
    const values = new Float32Array(frames * size);
    const boneName = track.name.slice(0, track.name.lastIndexOf('.'));
    const t = share(boneName);
    for (let i = 0; i < frames; i++) {
      const phase = i / (frames - 1);
      const a = self.evaluate(((phaseA + phase) % 1) * first.duration);
      const b = other.evaluate(((phaseB + phase) % 1) * second.duration);
      if (size === 4) Quaternion.slerpFlat(values, i * 4, a, 0, b, 0, t);
      else for (let k = 0; k < size; k++) values[i * size + k] = a[k] + (b[k] - a[k]) * t;
    }
    tracks.push(size === 4 ? new QuaternionKeyframeTrack(track.name, times, values) : new VectorKeyframeTrack(track.name, times, values));
  }
  return new AnimationClip(name, span, tracks);
}

/** Da la vuelta a un ciclo para que empiece en su pisada izquierda. */
export function alignCycle(name, clip, phase) {
  return blendCycles(name, clip, clip, () => 0, { phaseA: phase, phaseB: phase });
}

function hipTrack(clip, hips) {
  return clip.tracks.find(track => track.name === `${hips.name}.position`);
}

/** Copia del clip con la pista de cadera sustituida. No toca el original. */
function withHipHeights(clip, hips, lifts) {
  const result = clip.clone();
  const track = hipTrack(result, hips);
  for (let i = 0; i < track.times.length; i++) track.values[i * 3 + 1] += lifts[i];
  return result;
}

/**
 * Asienta un clip sobre el piso con la planta a `clearance` y lo devuelve en una copia.
 * `follow` deja la planta pegada al piso en cada cuadro, para un andar o un reposo que siempre
 * apoya; sin él toda la curva sube igual y un correr conserva sus fases de vuelo.
 */
function settleOnGround(support, rig, clip, { clearance = FOOT_CLEARANCE, follow = true } = {}) {
  const track = hipTrack(clip, rig.hips);
  if (!track) return clip;
  const mixer = new AnimationMixer(rig.root);
  const action = mixer.clipAction(clip).play();
  const frames = track.times.length;
  const lifts = new Float32Array(frames);
  let highest = -Infinity;
  for (let i = 0; i < frames; i++) {
    action.time = track.times[i];
    mixer.update(0);
    lifts[i] = clearance - support.minimumY();
    highest = Math.max(highest, lifts[i]);
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig.root);
  if (!follow) lifts.fill(highest);
  else {
    // Cubre el máximo de los vecinos y lo redondea con una media: nunca queda por debajo y la
    // cadera no tiembla al pasar de un pie al otro. El primero y el último cuadro son el mismo.
    const count = frames - 1, radius = 2;
    const covered = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let top = -Infinity;
      for (let d = -radius; d <= radius; d++) top = Math.max(top, lifts[(i + d + count) % count]);
      covered[i] = top;
    }
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++) sum += covered[(i + d + count) % count];
      lifts[i] = sum / (radius * 2 + 1);
    }
    lifts[count] = lifts[0];
  }
  const result = withHipHeights(clip, rig.hips, lifts);
  result.userData.grounding = { clearance, follow, maxLift: Math.max(...lifts) };
  return result;
}

// Hasta dónde sobre su piso cuenta un tobillo como pie que pisa.
const STANCE_ANKLE = .05;

/**
 * Los dos andares originales pisan con la rodilla doblada unos 30° y la cadera baja, como quien camina
 * agachado. Sube la cadera de cada cuadro hasta que la pierna que pisa quede doblada lo que diga `rodilla`,
 * sin que la cadera suba y baje más de `vaiven`, y vuelve a resolver las dos piernas. Tobillos y pies conservan
 * su lugar y su orientación en el mundo, así que la zancada y el contacto con el piso no cambian. Devuelve una copia.
 */
function extendStance(clip, rig, stance) {
  const hipsTrack = hipTrack(clip, rig.hips);
  if (!hipsTrack || !stance) return clip;
  const { rodilla: flex, vaiven } = stance;
  const frames = hipsTrack.times.length, count = frames - 1;
  const tracks = clip.tracks.filter(track => track.times.length === frames);
  const pose = (from, i) => {
    for (const track of from) {
      const bone = rig.bones.get(track.name.slice(0, track.name.lastIndexOf('.')));
      if (!bone) continue;
      if (track.name.endsWith('.quaternion')) bone.quaternion.fromArray(track.values, i * 4);
      else if (bone === rig.hips) bone.position.fromArray(track.values, i * 3);
    }
    rig.root.updateMatrixWorld(true);
  };
  const { thigh, shin } = rig.length;
  const bent = Math.sqrt(thigh * thigh + shin * shin + 2 * thigh * shin * Math.cos(flex)), straight = thigh + shin - 1e-3;
  const legs = ['left', 'right'].map(side => ({ side, ankles: [], knees: [], hips: [], feet: [], floor: Infinity }));
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pose(tracks, i);
    heights[i] = rig.hips.position.y;
    for (const leg of legs) {
      const ankle = rig.where(`${leg.side}Foot`);
      leg.ankles.push(ankle);
      leg.knees.push(rig.where(`${leg.side}Leg`));
      leg.hips.push(rig.where(`${leg.side}UpLeg`));
      leg.feet.push(rig.joints[`${leg.side}Foot`].getWorldQuaternion(new Quaternion()));
      leg.floor = Math.min(leg.floor, ankle.y);
    }
  }
  // Cuánto puede subir la cadera: la pierna que pisa llega a `bent`, las dos a casi estiradas cuando pisan
  // a la vez, y la que va por el aire solo a no quedarse corta.
  const rise = (hip, ankle, length) => {
    const dx = hip.x - ankle.x, dz = hip.z - ankle.z, across = length * length - dx * dx - dz * dz;
    return across > 0 ? ankle.y + Math.sqrt(across) - hip.y : 0;
  };
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const down = legs.map(leg => leg.ankles[i].y < leg.floor + STANCE_ANKLE);
    const length = down[0] && down[1] ? straight : bent;
    raw[i] = Math.max(0, Math.min(...legs.map((leg, k) => rise(leg.hips[i], leg.ankles[i], down[k] ? length : straight))));
  }
  const lowest = heights.reduce((best, height, i) => Math.min(best, height + raw[i]), Infinity);
  for (let i = 0; i < count; i++) raw[i] = Math.min(raw[i], Math.max(0, lowest + vaiven - heights[i]));
  // Toma el mínimo de los vecinos y lo redondea con una media: nunca sube más de lo que la pierna alcanza.
  const radius = 1, eroded = new Float32Array(count), lifts = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let least = Infinity;
    for (let d = -radius; d <= radius; d++) least = Math.min(least, raw[(i + d + count) % count]);
    eroded[i] = least;
  }
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let d = -radius; d <= radius; d++) sum += eroded[(i + d + count) % count];
    lifts[i] = sum / (radius * 2 + 1);
  }
  const result = clip.clone();
  result.userData = { ...clip.userData, stance: { flex, lift: Math.max(...lifts) } };
  const trackOf = (key) => result.tracks.find(track => track.name === `${rig.joints[key].name}.quaternion`);
  const parent = new Quaternion(), pole = new Vector3();
  const written = legs.flatMap(({ side }) => [`${side}UpLeg`, `${side}Leg`, `${side}Foot`]).map(key => [key, trackOf(key)]);
  if (written.some(([, track]) => !track)) return clip;
  const newHips = hipTrack(result, rig.hips);
  for (let i = 0; i < count; i++) {
    pose(tracks, i);
    rig.hips.position.y += lifts[i];
    newHips.values[i * 3 + 1] = rig.hips.position.y;
    rig.root.updateMatrixWorld(true);
    for (const leg of legs) {
      rig.reachLeg(leg.side, leg.ankles[i], pole.copy(leg.knees[i]).sub(leg.hips[i]));
      const foot = rig.joints[`${leg.side}Foot`];
      foot.quaternion.copy(foot.parent.getWorldQuaternion(parent).invert().multiply(leg.feet[i]));
      foot.updateMatrixWorld(true);
    }
    for (const [key, track] of written) rig.joints[key].quaternion.toArray(track.values, i * 4);
  }
  // El último cuadro es el primero.
  newHips.values[count * 3 + 1] = newHips.values[1];
  for (const [, track] of written) for (let k = 0; k < 4; k++) track.values[count * 4 + k] = track.values[k];
  return result;
}

/** Soporte de la planta, en una copia del cuerpo: el cuerpo original no se mueve al medir. */
function footSupport(scene) {
  const root = clone(scene);
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const hips = [...bones.values()].find(bone => /hips$/i.test(bone.name));
  return { rig: { root, bones, hips }, support: createSkinSupport(root, { bones: FOOT_BONES }) };
}

/** Rotaciones de las que parten los brazos y las manos colgando, sacadas de `standing` si lo hay. */
export function standingFrozen(rig, standing = null) {
  rig.reference = null; rig.referenceHip = null;
  rig.reset();
  if (standing) rig.applyClip(standing, 0);
  const frozen = new Map();
  for (const bone of rig.bones.values()) frozen.set(bone, bone.quaternion.clone());
  return frozen;
}

/**
 * Una persona de pie, sobre el cuerpo: pies fijos en el piso, brazos colgando y la cadera en el punto
 * `turn` (radianes) de su vaivén lento, en el que pasa el peso de una pierna a la otra. Las piernas
 * salen de buscar el tobillo, así que los pies no se mueven. La familia la encorva con `reposo`.
 */
export function standAt(rig, frozen, family, turn) {
  const { spine, neck, shoulders, knees } = family.reposo;
  const hip = rig.marks.hipJoint, ankleY = rig.marks.ankleY + FOOT_CLEARANCE;
  const wide = hip.x + .012;
  // La altura sale de la pierna: un poco menos que estirada, según cuánto dobla la rodilla la familia.
  const { thigh, shin } = rig.length;
  const flex = .07 + knees * 2.6;
  const leg = Math.sqrt(thigh * thigh + shin * shin + 2 * thigh * shin * Math.cos(flex));
  const lift = ankleY + Math.sqrt(leg * leg - .012 * .012) - hip.y;
  const place = (side, z, out) => {
    const sign = side === 'left' ? 1 : -1;
    rig.reachLeg(side, new Vector3(sign * wide, ankleY, z), new Vector3(sign * .15, 0, 1));
    rig.flatFoot(side, out);
  };
  const hang = (side, out, sag) => {
    const sign = side === 'left' ? 1 : -1;
    rig.point(`${side}Arm`, sign * out, -1, -.015);
    rig.point(`${side}ForeArm`, sign * (out * .4), -1, sag);
    rig.hand(side, new Vector3(-sign * .08, -1, sag * .9), new Vector3(-sign, 0, .25));
  };
  const weight = Math.sin(turn), slow = Math.sin(turn * 2 + .7);
  for (const [bone, quaternion] of frozen) bone.quaternion.copy(quaternion);
  rig.hips.position.copy(rig.bindP);
  // Cae una pizca sobre la pierna que carga: la cadera se desplaza y baja del lado libre.
  rig.moveHips(weight * .017, lift - Math.abs(weight) * .002, -spine * .06);
  rig.orient('hips', spine * .15, slow * .012, weight * .016);
  rig.orient('spine', spine * .45, slow * .018, weight * .004);
  rig.orient('spine1', spine * .75, slow * .03, -weight * .004);
  rig.orient('spine2', spine, slow * .04, -weight * .01);
  rig.orient('neck', spine + neck * .35 - .03, slow * .05, -weight * .006);
  rig.orient('head', neck * .8, slow * .08, weight * .004);
  rig.orient('leftShoulder', shoulders, 0, 0).orient('rightShoulder', shoulders, 0, 0);
  hang('left', .1, .1 + spine * .4);
  hang('right', .1, .1 + spine * .4);
  place('left', .012, .12);
  place('right', -.018, .17);
}

/** El reposo es un vaivén de `standAt`, una vuelta completa en `REST_SPAN` segundos. */
function bakeRest(rig, standing, family) {
  const frozen = standingFrozen(rig, standing);
  const bones = [...rig.bones.values()];
  const keys = REST_KEYS + 1;
  const times = new Float32Array(keys);
  const rotations = bones.map(() => new Float32Array(keys * 4));
  const heights = new Float32Array(keys * 3);
  for (let i = 0; i < keys; i++) {
    times[i] = i / REST_KEYS * REST_SPAN;
    standAt(rig, frozen, family, (i % REST_KEYS) / REST_KEYS * Math.PI * 2);
    bones.forEach((bone, k) => bone.quaternion.toArray(rotations[k], i * 4));
    rig.hips.position.toArray(heights, i * 3);
  }
  const tracks = bones.map((bone, k) => new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations[k]));
  tracks.push(new VectorKeyframeTrack(`${rig.hips.name}.position`, times, heights));
  return new AnimationClip('idle', REST_SPAN, tracks);
}

const TORSO = [['spine', 'hips'], ['spine1', 'spine'], ['spine2', 'spine1'], ['neck', 'spine2'], ['head', 'neck'], ['leftShoulder', 'spine2'], ['rightShoulder', 'spine2']];
const ARMS = [['leftArm', 'leftShoulder'], ['rightArm', 'rightShoulder']];
// Reparto de la inclinación entre las vértebras, de abajo arriba: más doblada cuanto más arriba.
const LEAN_SHARE = { spine: .6, spine1: .9, spine2: 1.15 };

/**
 * Endereza el tronco de un ciclo y lo devuelve en una copia. Los clips vienen de otro esqueleto con otra
 * curva de columna: en promedio el pecho queda girado 17°, la cabeza mira 22° a un lado y la columna se
 * dobla adelante y atrás entre una vértebra y otra. Cada hueso conserva su vaivén, pero su orientación
 * media pasa a ser la de pie más una inclinación repartida. Hombros y brazos parten así casi de lo mismo
 * que en reposo, y las posturas que siguen andando caen donde se hornearon. Cadera y piernas no cambian,
 * y los brazos mantienen su orientación de mundo, de modo que nada de esto mueve los pies ni la zancada.
 */
export function straightenTorso(clip, rig) {
  const trackOf = bone => clip.tracks.find(track => track.name === `${bone.name}.quaternion`);
  const parts = ['hips', ...TORSO.map(([key]) => key), ...ARMS.map(([key]) => key)];
  const tracks = Object.fromEntries(parts.map(key => [key, trackOf(rig.joints[key])]));
  if (parts.some(key => !tracks[key])) return clip;
  const frames = tracks.hips.times.length;
  if (parts.some(key => tracks[key].times.length !== frames)) return clip;
  const base = rig.hips.parent.getWorldQuaternion(new Quaternion());
  const q = new Quaternion(), parent = new Quaternion(), mean = new Quaternion(), fix = new Quaternion();
  // Orientación de mundo de cada hueso en cada cuadro, solo con productos de cuaterniones.
  const world = { hips: new Float32Array(frames * 4) };
  for (let i = 0; i < frames; i++) q.copy(base).multiply(parent.fromArray(tracks.hips.values, i * 4)).toArray(world.hips, i * 4);
  for (const [key, up] of [...TORSO, ...ARMS]) {
    world[key] = new Float32Array(frames * 4);
    for (let i = 0; i < frames; i++) {
      q.fromArray(world[up], i * 4).multiply(parent.fromArray(tracks[key].values, i * 4)).toArray(world[key], i * 4);
    }
  }
  // El último cuadro repite al primero: no cuenta dos veces en la media.
  const average = key => {
    const sum = [0, 0, 0, 0], first = new Quaternion().fromArray(world[key], 0);
    for (let i = 0; i < frames - 1; i++) {
      q.fromArray(world[key], i * 4);
      const sign = q.dot(first) < 0 ? -1 : 1;
      sum[0] += q.x * sign; sum[1] += q.y * sign; sum[2] += q.z * sign; sum[3] += q.w * sign;
    }
    return new Quaternion(sum[0], sum[1], sum[2], sum[3]).normalize();
  };
  const up = new Vector3(), forward = new Vector3();
  const bindOf = key => rig.bindWorld.get(rig.joints[key]);
  /** Cuánto se inclina al frente la orientación media de un hueso respecto a la de enlace. */
  const pitchOf = (key, orientation) => {
    q.copy(orientation).multiply(mean.copy(bindOf(key)).invert());
    up.set(0, 1, 0).applyQuaternion(q);
    forward.set(0, 0, 1).applyQuaternion(q);
    return { lean: Math.atan2(up.z, up.y), look: -Math.atan2(forward.y, Math.hypot(forward.x, forward.z)) };
  };
  const means = Object.fromEntries(TORSO.map(([key]) => [key, average(key)]));
  const spans = rig.length.torso, total = spans[0] + spans[1] + spans[2];
  const lean = (pitchOf('spine', means.spine).lean * spans[0] + pitchOf('spine1', means.spine1).lean * spans[1] + pitchOf('spine2', means.spine2).lean * spans[2]) / total;
  const targetPitch = {
    spine: lean * LEAN_SHARE.spine, spine1: lean * LEAN_SHARE.spine1, spine2: lean * LEAN_SHARE.spine2,
    neck: pitchOf('neck', means.neck).look, head: pitchOf('head', means.head).look, leftShoulder: 0, rightShoulder: 0
  };
  const axisX = new Vector3(1, 0, 0);
  const fixed = {};
  for (const [key] of TORSO) {
    fix.setFromAxisAngle(axisX, targetPitch[key]).multiply(bindOf(key)).multiply(mean.copy(means[key]).invert());
    fixed[key] = new Float32Array(frames * 4);
    for (let i = 0; i < frames; i++) q.copy(fix).multiply(parent.fromArray(world[key], i * 4)).toArray(fixed[key], i * 4);
  }
  const result = clip.clone();
  const write = (key, from, source) => {
    const track = result.tracks.find(item => item.name === `${rig.joints[key].name}.quaternion`);
    for (let i = 0; i < frames; i++) {
      q.fromArray(from, i * 4).invert().multiply(parent.fromArray(source, i * 4)).toArray(track.values, i * 4);
    }
  };
  for (const [key, above] of TORSO) write(key, fixed[above] ?? world[above], fixed[key]);
  for (const [key, above] of ARMS) write(key, fixed[above], world[key]);
  result.userData.lean = lean;
  return result;
}

/**
 * Clips de una familia para un cuerpo: reposo, andar y correr ya asentados, con la zancada medida.
 * `sources` = { upright, tired, run, standing } adaptados a este cuerpo.
 */
export function bakeGaitFamily(scene, sources, gait = DEFAULT_GAIT) {
  const family = GAIT_FAMILIES[resolveGait(gait)];
  const probe = boneRig(scene);
  const phases = {
    upright: contactPhase(probe, sources.upright, 'upright'),
    tired: contactPhase(probe, sources.tired, 'tired'),
    run: contactPhase(probe, sources.run, 'run')
  };
  const poseRig = new PoseRig(scene);
  const walk = straightenTorso(blendCycles('walk', sources.upright, sources.tired, name => family[groupOf(name)], {
    phaseA: phases.upright, phaseB: phases.tired,
    duration: sources.upright.duration + (sources.tired.duration - sources.upright.duration) * family.legs
  }), poseRig);
  const run = straightenTorso(alignCycle('run', sources.run, phases.run), poseRig);
  const idle = bakeRest(poseRig, sources.standing, family);
  const stride = family.zancada ?? 0;
  const trot = stride ? blendCycles('trote', walk, run, name => (groupOf(name) === 'legs' ? stride : 0), {
    duration: walk.duration + (run.duration - walk.duration) * stride
  }) : null;
  const { rig, support } = footSupport(scene);
  const out = {
    idle: settleOnGround(support, rig, idle).optimize(),
    walk: extendStance(settleOnGround(support, rig, walk), poseRig, family.apoyo),
    run: settleOnGround(support, rig, run, { follow: false })
  };
  out.idle.userData.source = out.walk.userData.source = out.run.userData.source = 'familia';
  out.walk.userData.gait = resolveGait(gait);
  if (trot) {
    out.trote = settleOnGround(support, rig, trot);
    out.trote.userData.source = 'familia';
    out.trote.userData.locomotion = measureLocomotion(scene, out.trote, out.run);
  }
  out.walk.userData.locomotion = measureLocomotion(scene, out.walk, out.trote ?? out.run);
  return out;
}

/** Adapta a un cuerpo los clips de los dos bancos de andar. */
export function buildGaitSources(body, uprightBank, tiredBank) {
  const pick = (bank, name) => {
    const clip = bank.animations.find(item => item.name === name);
    if (!clip) throw new Error(`Banco de andar: falta el clip «${name}».`);
    return clip;
  };
  const adapt = bank => createRetargeter(clone(bank.scene), clone(body.scene), { preserveHipHeight: true, hipSpace: 'world', flatFeet: true });
  const fromUpright = adapt(uprightBank), fromTired = adapt(tiredBank);
  return {
    upright: fromUpright(pick(uprightBank, 'walk')),
    tired: fromTired(pick(tiredBank, 'walk')),
    run: fromTired(pick(tiredBank, 'run')),
    standing: fromTired(pick(tiredBank, 'pedir'))
  };
}
