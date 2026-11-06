// src/character/hurto.js
// Robar con el cuerpo: meter la mano al bolsillo ajeno, sacar y guardar, disimular, quedar pillado,
// el raponazo y lo que hace la víctima (palparse, sobresaltarse). Se suma sobre la pose del mezclador
// como los golpes (ver ActionPose), con los mismos ejes del personaje: +X su izquierda, +Y arriba,
// +Z al frente. Los valores son de la mano DERECHA; `lado: -1` los refleja para la izquierda.
//
// Las poses son direcciones de brazo y antebrazo (no ángulos de Euler): valen igual para el
// esqueleto Mixamo y para el cuerpo procedural. Cuando hay `objetivo` (un punto del mundo: el
// bolsillo o el bolso de la víctima), las poses con `alcance` llevan la mano hasta ese punto con
// un IK de dos huesos, así la mano entra al bolsillo aunque la víctima sea más alta o esté de lado.
import { Quaternion, Vector3 } from 'three';

/** Duración de cada fase, en segundos. `meter` dura lo que dure la barra. */
export const HURTO = {
  entrar: .22, sacar: .9, soltar: .35, disimular: 1.05, pillado: 1.1, raponazo: 2.2,
  palparse: 1.3, sobresalto: .6, helado: 1.4
};

/** El tirón del raponazo: a este instante la mano ya está en el bolso. */
export const CONTACTO_RAPONAZO = .24;
/** Y a este, con el brazo todavía contra el pecho, lo arrancado se guarda: de ahí el cuerpo vuelve al clip. */
export const GUARDA_RAPONAZO = 1.9;

// Pecho (Spine2), cintura (Spine) y cabeza en radianes: x inclina adelante, y gira hacia su izquierda.
// `alcance` 1 = la mano va al objetivo si lo hay. `otra` 1 = la otra mano hace lo mismo, reflejada.
export const POSES_DE_HURTO = {
  colgando:    { brazo: [-.08, -1, 0], antebrazo: [-.05, -1, .1], pecho: [0, 0, 0], cintura: 0, cabeza: [0, 0, 0], mano: [0, 0, 0] },
  // La mano baja hasta la cadera de la víctima, el cuerpo se arrima y la cabeza mira de reojo.
  bolsillo:    { brazo: [-.15, -.75, .55], antebrazo: [0, -.45, .9], pecho: [.1, .14, 0], cintura: .1, cabeza: [.2, .22, 0], mano: [.25, 0, 0], alcance: 1 },
  // Dentro de la zona de la barra: los dedos se hunden.
  hondo:       { brazo: [-.12, -.8, .5], antebrazo: [.05, -.65, .75], pecho: [.14, .16, 0], cintura: .14, cabeza: [.28, .22, 0], mano: [.4, 0, 0], alcance: 1 },
  jalar:       { brazo: [-.2, -.98, -.05], antebrazo: [-.05, -.6, .8], pecho: [.04, .05, 0], cintura: .02, cabeza: [.1, .1, 0], mano: [.1, 0, 0] },
  // Al bolsillo de adentro de la chaqueta, mirando para otro lado.
  guardar:     { brazo: [-.25, -.9, .2], antebrazo: [.75, .35, .55], pecho: [0, 0, 0], cintura: 0, cabeza: [.05, -.2, 0], mano: [0, 0, 0] },
  rascarse:    { brazo: [-.55, .55, .2], antebrazo: [.55, .4, -.6], pecho: [0, 0, 0], cintura: 0, cabeza: [-.05, -.35, 0], mano: [0, 0, 0] },
  // «Tranquilo, tranquilo»: las dos manos arriba, el pecho atrás.
  manosArriba: { brazo: [-.6, -.62, .3], antebrazo: [-.12, .97, .06], pecho: [-.12, 0, 0], cintura: -.04, cabeza: [-.05, 0, 0], mano: [-.3, 0, 0], otra: 1 },
  carga:       { brazo: [-.3, -.7, -.65], antebrazo: [-.1, -.6, .8], pecho: [0, -.25, 0], cintura: 0, cabeza: [.05, .1, 0], mano: [0, 0, 0] },
  // El tirón: la mano al bolso o al pecho de la víctima, el cuerpo entero detrás.
  arrancar:    { brazo: [.1, -.25, .96], antebrazo: [.1, -.15, .98], pecho: [.15, .3, 0], cintura: .08, cabeza: [.08, .15, 0], mano: [.2, 0, 0], alcance: 1 },
  // Lo robado apretado contra el pecho mientras corre.
  apretar:     { brazo: [-.3, -.85, .4], antebrazo: [.8, .4, .45], pecho: [-.06, -.15, 0], cintura: 0, cabeza: [0, 0, 0], mano: [0, 0, 0] },
  // La víctima: la mano al bolsillo de atrás y la cabeza abajo, buscando.
  palparse:    { brazo: [-.18, -.95, -.28], antebrazo: [.4, -.62, -.68], pecho: [.06, -.1, 0], cintura: .04, cabeza: [.3, 0, 0], mano: [0, 0, 0] },
  // Las manos arriba, delante del pecho: se cubre, no le pega a nadie.
  sobresalto:  { brazo: [-.45, -.72, .4], antebrazo: [-.25, .85, .45], pecho: [-.15, 0, 0], cintura: -.05, cabeza: [-.1, 0, 0], mano: [-.2, 0, 0], otra: 1 }
};

// [segundo, pose]. `entra`: la fase empieza desde el clip (sube de peso); las demás siguen a otra fase.
// `sale`: lo que tarda en devolverle el cuerpo al clip al final.
const FASES = {
  meter:      { entra: true, sale: 0, claves: [[0, 'colgando'], [HURTO.entrar, 'bolsillo']] },
  sacar:      { sale: .2, claves: [[0, 'hondo'], [.12, 'jalar'], [.3, 'guardar'], [.7, 'guardar']] },
  soltar:     { sale: .35, claves: [[0, 'bolsillo'], [.25, 'colgando']] },
  disimular:  { sale: .2, claves: [[0, 'bolsillo'], [.2, 'colgando'], [.45, 'rascarse'], [.85, 'rascarse']] },
  pillado:    { sale: .25, claves: [[0, 'bolsillo'], [.15, 'manosArriba'], [.85, 'manosArriba']] },
  raponazo:   { entra: true, sale: .3, claves: [[0, 'colgando'], [.12, 'carga'], [CONTACTO_RAPONAZO, 'arrancar'], [.49, 'apretar'], [GUARDA_RAPONAZO, 'apretar']] },
  palparse:   { entra: true, sale: .3, claves: [[0, 'colgando'], [.25, 'palparse'], [1.0, 'palparse']] },
  sobresalto: { entra: true, sale: .2, claves: [[0, 'colgando'], [.12, 'sobresalto'], [.4, 'sobresalto']] },
  helado:     { entra: true, sale: .3, claves: [[0, 'colgando'], [.12, 'sobresalto'], [1.1, 'sobresalto']] }
};
export const FASES_DE_HURTO = Object.freeze(Object.keys(FASES));

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = v => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const duracion = fase => HURTO[fase] ?? Infinity;

/** La fase ya devolvió el cuerpo al clip. `meter` no termina sola. */
export function terminada(h) {
  return !h || !FASES[h.fase] || (Number.isFinite(duracion(h.fase)) && h.t >= duracion(h.fase));
}

/** Lo que tarda una fase en tomar el relevo de la anterior. */
const MEZCLA = .15;

const VECTORES = ['brazo', 'antebrazo', 'pecho', 'cabeza', 'mano'];
function nuevaMuestra() {
  return { brazo: [0, 0, 0], antebrazo: [0, 0, 0], pecho: [0, 0, 0], cabeza: [0, 0, 0], mano: [0, 0, 0],
    cintura: 0, otra: 0, alcance: 0, lado: 1, peso: 0, agachar: 0, objetivo: null, fase: null };
}
const _muestra = nuevaMuestra();
export { nuevaMuestra };

function mezclar(out, a, b, u) {
  for (const k of VECTORES) {
    const pa = a[k], pb = b[k], o = out[k];
    o[0] = pa[0] + (pb[0] - pa[0]) * u; o[1] = pa[1] + (pb[1] - pa[1]) * u; o[2] = pa[2] + (pb[2] - pa[2]) * u;
  }
  out.cintura = a.cintura + (b.cintura - a.cintura) * u;
  out.otra = (a.otra ?? 0) + ((b.otra ?? 0) - (a.otra ?? 0)) * u;
  out.alcance = (a.alcance ?? 0) + ((b.alcance ?? 0) - (a.alcance ?? 0)) * u;
}

function normalizar(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
}

/**
 * La pose del instante `h.t` de la fase `h.fase`, sin crear objetos: devuelve `out` (o una muestra
 * compartida, que vale hasta la siguiente llamada). `h.hondura` (0 a 1) hunde la mano en `meter`.
 * `peso` es la envolvente: sube desde el clip al empezar y vuelve a él al terminar.
 */
export function muestraDeHurto(h, out = _muestra) {
  const fase = FASES[h?.fase];
  out.fase = h?.fase ?? null;
  out.lado = h?.lado < 0 ? -1 : 1;
  out.objetivo = h?.objetivo ?? null;
  out.agachar = clamp01(h?.agachar ?? 0);
  if (!fase) { out.peso = 0; return out; }
  const t = Math.max(0, Number.isFinite(h.t) ? h.t : 0);
  const claves = fase.claves;
  let i = 0;
  while (i < claves.length - 1 && t >= claves[i + 1][0]) i++;
  const [t0, nombre0] = claves[i];
  const siguiente = claves[i + 1];
  const u = siguiente ? smooth((t - t0) / (siguiente[0] - t0)) : 0;
  mezclar(out, POSES_DE_HURTO[nombre0], POSES_DE_HURTO[siguiente?.[1] ?? nombre0], u);
  if (h.fase === 'meter') {
    const hondura = clamp01(h.hondura ?? 0) * smooth(t / HURTO.entrar);
    if (hondura > 0) mezclar(out, out, POSES_DE_HURTO.hondo, hondura);
  }
  const fin = duracion(h.fase);
  const entra = fase.entra ? smooth(t / .1) : 1;
  const sale = Number.isFinite(fin) && fase.sale > 0 ? 1 - smooth((t - (fin - fase.sale)) / fase.sale) : Number.isFinite(fin) && t >= fin ? 0 : 1;
  out.peso = entra * sale;
  // Una fase que empieza encima de otra sale de donde quedó la anterior (`desde`), sin salto.
  const desde = h.desde;
  if (desde?.fase && t < MEZCLA) {
    const u = smooth(t / MEZCLA);
    mezclar(out, desde, out, u);
    out.peso = desde.peso + (out.peso - desde.peso) * u;
  }
  // Con la otra mano ocupada (el paraguas, la bolsa) solo se mueve una.
  if (h.unaMano) out.otra = 0;
  normalizar(out.brazo); normalizar(out.antebrazo);
  return out;
}

// Para el IK, sin crear objetos por cuadro.
const _qi = new Quaternion();
const _hombro = new Vector3(), _codo = new Vector3(), _muneca = new Vector3(), _meta = new Vector3();
const _dir = new Vector3(), _polo = new Vector3(), _fijo = new Vector3(), _a = new Vector3();
const _pies = new Vector3(), _piesLuego = new Vector3(), _corrida = new Vector3();

/** Agacharse del todo: el muslo casi al frente, la canilla atrás, la espalda adelante (k = 1). */
const AGACHADO = { muslo: [.18, -.12, 1], canilla: [.03, -1, -.5], pie: [0, -.25, 1], cadera: .15, cintura: .5, pecho: .38 };

// El punto entre los dos pies; y la altura del más bajo. Sin pies (o sin cadera), false.
function pies(pose, out) {
  const izq = pose.slots.get('leftFoot')?.bone, der = pose.slots.get('rightFoot')?.bone;
  if (!izq || !der || !pose.joints?.hips?.parent) return false;
  izq.getWorldPosition(out);
  der.getWorldPosition(_a);
  const y = Math.min(out.y, _a.y);
  out.add(_a).multiplyScalar(.5);
  out.y = y;
  return true;
}

/**
 * Doblar rodillas y espalda para el bolsillo de alguien sentado o en el piso, con los pies donde
 * estaban: la cadera baja y se va atrás lo que haga falta (como el aterrizaje de ActionPose).
 */
function agacharse(pose, k) {
  const conPies = pies(pose, _pies);
  for (const [s, nombre] of [[1, 'left'], [-1, 'right']]) {
    pose._aim(`${nombre}UpLeg`, AGACHADO.muslo[0] * s, AGACHADO.muslo[1], AGACHADO.muslo[2], k);
    pose._aim(`${nombre}Leg`, AGACHADO.canilla[0] * s, AGACHADO.canilla[1], AGACHADO.canilla[2], k);
    // El pie procedural no tiene dedos que apuntar: su eje es el de la pierna.
    if (!pose.procedural) pose._aim(`${nombre}Foot`, AGACHADO.pie[0], AGACHADO.pie[1], AGACHADO.pie[2], k);
  }
  pose._rotate('hips', AGACHADO.cadera, 0, 0, k);
  if (conPies && pies(pose, _piesLuego)) {
    const hips = pose.joints.hips, padre = hips.parent;
    padre.updateWorldMatrix(true, false);
    _corrida.setFromMatrixPosition(padre.matrixWorld).add(_pies).sub(_piesLuego);
    padre.worldToLocal(_corrida);
    hips.position.add(_corrida);
    hips.updateMatrixWorld(true);
  }
  pose._rotate('lowerSpine', AGACHADO.cintura, 0, 0, k);
  pose._rotate('spine', AGACHADO.pecho, 0, 0, k);
}

/** El punto del mundo `objetivo` pasado a la dirección que necesita cada hueso, en ejes del personaje. */
function direccionesIK(pose, lado, objetivo, outBrazo) {
  const brazo = pose.slots.get(`${lado}Arm`), ante = pose.slots.get(`${lado}ForeArm`);
  if (!brazo || !ante) return false;
  brazo.bone.getWorldPosition(_hombro);
  ante.bone.getWorldPosition(_codo);
  const mano = pose.slots.get(`${lado}Hand`);
  const a = _hombro.distanceTo(_codo);
  const b = mano ? _codo.distanceTo(mano.bone.getWorldPosition(_muneca)) : a;
  // La palma pasa un poco de la muñeca: es la palma la que entra al bolsillo.
  const largo = b * 1.3;
  _meta.copy(objetivo);
  _dir.subVectors(_meta, _hombro);
  const d = Math.min(_dir.length(), (a + largo) * .999);
  if (d < 1e-4 || a < 1e-4) return false;
  _dir.normalize();
  // El codo hacia afuera y abajo, un poco atrás: como se mete la mano sin levantar el brazo.
  const s = lado === 'right' ? 1 : -1;
  _polo.set(-.6 * s, -.75, -.25).applyQuaternion(pose._frameQ);
  _polo.addScaledVector(_dir, -_polo.dot(_dir));
  if (_polo.lengthSq() < 1e-8) _polo.set(0, -1, 0);
  _polo.normalize();
  const cos = Math.min(1, Math.max(-1, (a * a + d * d - largo * largo) / (2 * a * d)));
  const sin = Math.sqrt(1 - cos * cos);
  _a.copy(_dir).multiplyScalar(cos * a).addScaledVector(_polo, sin * a);
  _qi.copy(pose._frameQ).invert();
  outBrazo.copy(_a).normalize().applyQuaternion(_qi);
  return true;
}

/**
 * Aplica una muestra sobre un `ActionPose` ya preparado para el cuadro (después del mezclador).
 * `weight` es el peso de la capa (ActionPose.hurtoWeight). En el cuerpo procedural no hay manos:
 * `_rotate` de la mano no hace nada y el IK usa un antebrazo tan largo como el brazo.
 */
export function aplicarHurto(pose, m, weight = 1) {
  const w = clamp01(weight) * m.peso;
  if (w <= .001) return;
  const s = m.lado < 0 ? -1 : 1;
  const lado = s > 0 ? 'right' : 'left', otro = s > 0 ? 'left' : 'right';
  // Primero las piernas: el hombro baja con ellas y el IK del brazo sale de ahí.
  if (m.agachar * w > .001) agacharse(pose, m.agachar * w);
  if (m.cintura) pose._rotate('lowerSpine', m.cintura, 0, 0, w);
  pose._rotate('spine', m.pecho[0], m.pecho[1] * s, m.pecho[2] * s, w);
  pose._rotate('head', m.cabeza[0], m.cabeza[1] * s, m.cabeza[2] * s, w);
  const alcance = m.objetivo ? m.alcance : 0;
  _fijo.set(m.brazo[0] * s, m.brazo[1], m.brazo[2]);
  if (alcance > .001 && direccionesIK(pose, lado, m.objetivo, _dir)) _fijo.lerp(_dir, alcance);
  pose._aim(`${lado}Arm`, _fijo.x, _fijo.y, _fijo.z, w);
  _fijo.set(m.antebrazo[0] * s, m.antebrazo[1], m.antebrazo[2]);
  const ante = pose.slots.get(`${lado}ForeArm`);
  if (alcance > .001 && ante) {
    // El antebrazo apunta desde donde quedó el codo: así la palma llega aunque el brazo no alcance del todo.
    ante.bone.getWorldPosition(_codo);
    _dir.subVectors(m.objetivo, _codo);
    if (_dir.lengthSq() > 1e-8) {
      _dir.normalize().applyQuaternion(_qi.copy(pose._frameQ).invert());
      _fijo.lerp(_dir, alcance);
    }
  }
  pose._aim(`${lado}ForeArm`, _fijo.x, _fijo.y, _fijo.z, w);
  pose._rotate(`${lado}Hand`, m.mano[0], m.mano[1] * s, m.mano[2] * s, w);
  if (m.otra > .001) {
    const wo = w * m.otra;
    pose._aim(`${otro}Arm`, -m.brazo[0] * s, m.brazo[1], m.brazo[2], wo);
    pose._aim(`${otro}ForeArm`, -m.antebrazo[0] * s, m.antebrazo[1], m.antebrazo[2], wo);
    pose._rotate(`${otro}Hand`, m.mano[0], -m.mano[1] * s, -m.mano[2] * s, wo);
  }
}

/** Las fases que la víctima hace con el cuerpo (ver features/stealReactions.js). */
export const FASES_DE_VICTIMA = Object.freeze(['palparse', 'sobresalto', 'helado']);

/** Un punto del mundo para el IK: no se comparte entre personajes. */
export const nuevoObjetivo = () => new Vector3();
