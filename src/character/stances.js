// src/character/stances.js
// Biblioteca de posturas horneadas una vez por cuerpo, sobre una copia que nadie dibuja. Cada postura
// se arma de pie, en el espacio del personaje (+X su izquierda, +Y arriba, +Z al frente), buscando con
// las manos y los pies los puntos del propio cuerpo, y se guarda como rotaciones locales. Por cuadro
// `BodyLanguage` solo hace `slerp` hacia ellas. El cuerpo liviano y el completo comparten esqueleto,
// así que comparten también la biblioteca. Ninguna postura toca la raíz física: la cadera, como mucho.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { GAIT_FAMILIES, standAt, standingFrozen } from './gaitFamilies.js';
import { PoseRig } from './poseRig.js';

const V = (x, y, z) => new Vector3(x, y, z);
const SIGN = { left: 1, right: -1 };
const SIDES = ['left', 'right'];
const OTHER = { left: 'right', right: 'left' };

// Las bancas miden 45 cm en el mundo y el cuerpo se dibuja a 1,08.
const SEAT_HEIGHT = .45 / 1.08;
const LIE_LIFT = .1 / 1.08; // cuánto sobre el piso queda la espalda de quien está tendido
// Dónde apoya la muñeca derecha al levantarse, en ejes del personaje. Lo que se le cayó queda ahí mismo (ver `HAND_ON_FLOOR`).
const HAND_PLANT = V(-.3, .1, .1);

// ---------- piezas comunes ----------

/** Cadera a una altura y distancia del origen, con la pelvis inclinada. */
function setHips(rig, y, z, tilt = 0, roll = 0, yaw = 0) {
  rig.hips.position.set(0, y, z);
  rig.root.updateMatrixWorld(true);
  rig.orient('hips', tilt, yaw, roll);
}

/** Columna en radianes del mundo, de abajo arriba; cuello y cabeza aparte. */
function bendSpine(rig, [low, mid, high], neck, head, yaw = 0) {
  rig.orient('spine', low, yaw * .2);
  rig.orient('spine1', mid, yaw * .5);
  rig.orient('spine2', high, yaw * .8);
  rig.orient('neck', neck, yaw);
  rig.orient('head', head, yaw * 1.2);
}

/** Pie plano, en el piso, con la rodilla hacia `pole`. */
function plantFoot(rig, side, x, z, out, pole) {
  const sign = SIGN[side];
  rig.reachLeg(side, V(sign * x, rig.marks.ankleY, z), V(sign * pole[0], pole[1], pole[2]));
  rig.flatFoot(side, out);
}

/** Mano que cuelga suelta de su muñeca. */
function looseHand(rig, side, fingers = V(0, -1, .15), curl = .28) {
  const sign = SIGN[side];
  rig.hand(side, V(-sign * .1 + fingers.x * sign, fingers.y, fingers.z), V(-sign, 0, .25));
  rig.curl(side, curl);
}

const lean = (rig, x, z = 0) => {
  rig.turn('spine', x * .3, 0, z * .3).turn('spine1', x * .35, 0, z * .35).turn('spine2', x * .35, 0, z * .35);
  return rig;
};

// ---------- posturas ----------

function bolsillos(rig, m) {
  for (const side of SIDES) {
    const sign = SIGN[side];
    // La muñeca entra por la boca del bolsillo y la mano queda dentro del muslo, tapada por la tela.
    rig.reachArm(side, V(sign * (m.hip.x + m.pocket), m.hip.y + .015, m.hip.z + .05), V(sign * .9, -.05, -.45));
    rig.hand(side, V(-sign * .1, -.98, -.1), V(-sign * .9, .05, .4));
    rig.curl(side, .5, .35);
  }
}

function brazosCruzados(rig, m) {
  // La mano derecha agarra el brazo izquierdo por encima; la izquierda se mete bajo el derecho.
  const y = m.chest.y - .105, z = m.front;
  rig.reachArm('right', V(.052, y, z + .05), V(-.7, -1, .12));
  rig.hand('right', V(.94, .14, -.3), V(-.05, -.25, -1));
  rig.curl('right', .55, .35);
  rig.reachArm('left', V(-.05, y - .058, z + .018), V(.7, -1, .12));
  rig.hand('left', V(-.94, .1, -.32), V(.05, .15, -1));
  rig.curl('left', .62, .35);
}

function telefono(rig, m) {
  rig.turn('neck', 0, 0, .05).turn('head', 0, 0, .06);
  const head = rig.where('head', V(0, 0, 0));
  rig.reachArm('right', V(head.x - m.ear - .035, head.y - .05, head.z + .05), V(-.62, -1, .22));
  rig.hand('right', V(.14, .94, .1), V(1, -.1, .1));
  rig.curl('right', .42, .4);
}

function celular(rig, m, alt) {
  rig.turn('neck', .26, 0, 0).turn('head', alt ? .34 : .28, alt ? .05 : 0, 0);
  rig.reachArm('right', V(-.075, m.chest.y - .105 + (alt ? .012 : 0), m.front + .085), V(-.7, -.85, -.1));
  rig.hand('right', V(.32, .4, .88), V(.1, .92, -.4));
  rig.curl('right', .55, alt ? .55 : .25);
}

function manosAtras(rig, m) {
  lean(rig, -.035);
  const y = m.hip.y + .07, z = m.back - .055;
  rig.reachArm('left', V(.012, y, z), V(.95, -.1, -.5));
  rig.hand('left', V(-.8, -.5, -.1), V(.1, .1, 1));
  rig.curl('left', .4, .3);
  rig.reachArm('right', V(.012 - .09, y - .03, z - .014), V(-.95, -.1, -.5));
  rig.hand('right', V(.82, -.42, -.05), V(-.05, .3, 1));
  rig.curl('right', .55, .35);
}

function hablar(rig, m, alt) {
  rig.turn('head', alt ? .02 : -.015, alt ? -.06 : .05, 0);
  const lift = alt ? .075 : 0;
  rig.reachArm('right', V(-.215 - lift * .4, m.hip.y + .115 + lift, m.hip.z + .235), V(-.9, -.6, -.4));
  rig.hand('right', V(.45, .22 + lift, .85), V(.55, .8, -.2));
  rig.curl('right', alt ? .18 : .3, .1);
  rig.reachArm('left', V(.205, m.hip.y + .035 + (alt ? 0 : .03), m.hip.z + .17), V(.9, -.6, -.4));
  rig.hand('left', V(-.3, .05, .9), V(-.5, .8, -.15));
  rig.curl('left', .35, .1);
}

function fumarQuieto(rig, m, alt) {
  // La mano izquierda lleva el cigarrillo y la derecha sostiene ese codo por debajo.
  if (alt) {
    rig.turn('head', -.05, .05, 0);
    rig.reachArm('left', V(.038, m.head.y - .075, m.head.z + .19), V(.55, -1, .05));
    rig.hand('left', V(-.72, .62, -.1), V(-.3, -.15, -1));
  } else {
    rig.reachArm('left', V(.095, m.chest.y + .1, m.front + .045), V(.45, -1, .05));
    rig.hand('left', V(-.42, .86, .3), V(-.8, -.2, -.55));
  }
  rig.curl('left', .3, .35);
  const elbow = rig.where('leftForeArm', V(0, 0, 0));
  rig.reachArm('right', V(elbow.x - .055, m.chest.y - .19, m.front + .012), V(-.8, -1, .05));
  rig.hand('right', V(.9, .34, -.2), V(-.05, .7, -.7));
  rig.curl('right', .45, .3);
}

function sentado(rig, m) {
  setHips(rig, m.sit, -.2, -.34);
  bendSpine(rig, [-.2, .02, .24], .22, .05);
  plantFoot(rig, 'left', .16, .24, .2, [.35, 1, .6]);
  plantFoot(rig, 'right', .14, .19, .08, [.3, 1, .6]);
  // Los antebrazos descansan sobre las rodillas y las manos cuelgan.
  for (const side of SIDES) {
    const sign = SIGN[side], knee = rig.where(`${side}Leg`, V(0, 0, 0));
    rig.reachArm(side, V(knee.x + sign * .01, knee.y + .07, knee.z + .02), V(sign * .95, -.7, -.35));
    rig.hand(side, V(-sign * .18, -.72, .66), V(-sign * .6, -.3, -.7));
    rig.curl(side, .3);
  }
}

function acurrucado(rig, m) {
  setHips(rig, m.sit, -.15, -.18);
  bendSpine(rig, [.22, .56, .86], .72, .62);
  plantFoot(rig, 'left', .13, .2, .1, [.25, 1, .7]);
  plantFoot(rig, 'right', .115, .17, .05, [.25, 1, .7]);
  // Los brazos rodean las canillas y las manos se agarran por delante.
  const left = rig.where('leftLeg', V(0, 0, 0)), right = rig.where('rightLeg', V(0, 0, 0));
  const y = (left.y + right.y) / 2 - .13, z = Math.max(left.z, right.z) + .085;
  rig.reachArm('left', V(.03, y, z), V(1, -.1, -.45));
  rig.hand('left', V(-.92, -.12, .1), V(0, .25, -1));
  rig.curl('left', .6, .4);
  rig.reachArm('right', V(-.04, y + .03, z + .012), V(-1, -.1, -.45));
  rig.hand('right', V(.92, -.05, .1), V(0, .2, -1));
  rig.curl('right', .65, .4);
}

function banca(rig, m) {
  setHips(rig, m.seat, -.09, -.08);
  bendSpine(rig, [-.08, -.03, .03], .04, .02);
  plantFoot(rig, 'left', .135, .32, .18, [.1, .6, 1]);
  plantFoot(rig, 'right', .125, .36, .14, [.1, .6, 1]);
  // Manos sobre los muslos, cerca de la rodilla.
  for (const side of SIDES) {
    const sign = SIGN[side], knee = rig.where(`${side}Leg`), hip = rig.where(`${side}UpLeg`);
    const on = hip.clone().lerp(knee, .6);
    rig.reachArm(side, V(on.x, on.y + .118, on.z - .005), V(sign * .9, -.5, -.5));
    rig.hand(side, V(-sign * .12, -.5, .86), V(-sign * .1, -.86, -.5));
    rig.curl(side, .25);
  }
}

function pedir(rig, m) {
  // De rodillas, sentado sobre los talones, con una mano adelantada.
  setHips(rig, m.kneel, -.03, .22);
  bendSpine(rig, [.2, .3, .38], .36, .3);
  for (const side of SIDES) {
    const sign = SIGN[side];
    const knee = V(sign * .135, m.kneeHeight, .23);
    rig.reachLeg(side, V(sign * .1, m.kneeHeight + .015, knee.z - rig.length.shin), V(sign * .1, -.25, 1));
    rig.orient(`${side}Foot`, 2.82, sign * .1);
    rig.orient(`${side}Toe`, 2.82, sign * .1);
  }
  const chest = rig.where('spine2', V(0, 0, 0));
  rig.reachArm('right', V(-.1, chest.y - .16, chest.z + .42), V(-.9, -.8, -.1));
  rig.hand('right', V(.14, .1, .97), V(.1, .95, -.1));
  rig.curl('right', .34, .18);
  rig.reachArm('left', V(.17, m.kneel + .1, .11), V(.95, -.3, -.35));
  rig.hand('left', V(-.1, -.55, .82), V(-.2, -.82, -.55));
  rig.curl('left', .28);
}

function paraguas(rig, m) {
  rig.reachArm('right', V(-.135, m.shoulder.y - .07, m.shoulder.z + .235), V(-.42, -1, -.12));
  rig.hand('right', V(.74, -.1, .66), V(.66, .1, -.74));
  rig.curl('right', .95, .75);
}

function cubrirse(rig, m) {
  lean(rig, .05);
  rig.turn('neck', .14, 0, 0).turn('head', .14, 0, 0);
  const top = rig.where('head', V(0, 0, 0));
  rig.reachArm('right', V(top.x - .07, top.y + m.crown - .015, top.z - .012), V(-1, .12, .32));
  rig.hand('right', V(.72, -.02, .68), V(0, -1, .05));
  rig.curl('right', .22, .1);
}

function nariz(rig, m) {
  rig.turn('neck', .05, 0, 0);
  const head = rig.where('head', V(0, 0, 0));
  rig.reachArm('right', V(head.x - .018, head.y - .017, head.z + m.nose + .1), V(-.85, -.9, .1));
  rig.hand('right', V(.1, .75, -.66), V(.1, -.66, -.75));
  rig.curl('right', .58, .55);
}

function huir(rig, m) {
  rig.orient('spine', .1).orient('spine1', .24).orient('spine2', .36).orient('neck', .16).orient('head', -.04);
  for (const side of SIDES) {
    const sign = SIGN[side], front = side === 'left' ? .03 : -.03;
    const shoulder = rig.where(`${side}Arm`, V(0, 0, 0));
    rig.reachArm(side, V(shoulder.x - sign * .03, shoulder.y - .16, shoulder.z + .2 + front), V(sign * .55, -.8, -.5));
    rig.hand(side, V(-sign * .3, .62, .72), V(-sign * .85, -.2, -.45));
    rig.curl(side, .42, .25);
  }
}

function tendido(rig) {
  // Se arma de pie y al final la cadera acuesta todo: aquí +Z es el techo y -Z el piso. Los pies quedan donde estaban.
  rig.turn('neck', -.08, .24, 0).turn('head', -.1, .28, .05);
  rig.point('leftArm', .84, .46, -.14);
  rig.point('leftForeArm', .62, .78, -.08);
  rig.hand('left', V(.64, .76, -.04), V(-.15, 0, 1));
  rig.curl('left', .36, .2);
  rig.point('rightArm', -.9, .12, -.15);
  rig.point('rightForeArm', -.9, -.32, -.12);
  rig.hand('right', V(-.86, -.4, -.05), V(.05, 0, 1));
  rig.curl('right', .3, .2);
  const ankle = rig.marks.hipJoint.y - (rig.length.thigh + rig.length.shin);
  rig.reachLeg('left', V(.235, ankle + .055, -.04), V(.5, 0, 1));
  rig.orient('leftFoot', -.7, .62);
  rig.orient('leftToe', -.7, .62);
  rig.reachLeg('right', V(-.15, ankle + .215, -.03), V(-.25, 0, 1));
  rig.orient('rightFoot', -.45, -.34);
  rig.orient('rightToe', -.45, -.34);
  const { x, y, z } = rig.hips.position;
  rig.hips.position.set(x, z + LIE_LIFT, -y);
  rig.root.updateMatrixWorld(true);
  rig.turn('hips', -Math.PI / 2, 0, 0);
}

// ---------- caer y pararse ----------
// `BodyLanguage` pasa por estas poses en orden, sin girar el grupo entero: los pies se quedan y lo que se mueve es la cadera.

/** Le fallan las piernas: la cadera cae hacia atrás sobre las rodillas dobladas y los brazos se sueltan hacia adelante. */
function cede(rig, m) {
  setHips(rig, m.hipBone - .36, -.13, -.3);
  bendSpine(rig, [-.2, -.02, .14], .24, .1);
  plantFoot(rig, 'left', m.hip.x + .03, .05, .22, [.3, .1, 1]);
  plantFoot(rig, 'right', m.hip.x + .02, -.04, .26, [.3, .1, 1]);
  rig.point('leftArm', .72, -.3, .62);
  rig.point('leftForeArm', .45, .22, .86);
  rig.point('rightArm', -.7, -.36, .6);
  rig.point('rightForeArm', -.42, .12, .9);
  looseHand(rig, 'left', V(.1, .1, 1), .2);
  looseHand(rig, 'right', V(.1, .05, 1), .2);
}

/** Ya en el piso, de nalgas: las rodillas todavía arriba, el tronco se va de espaldas y los brazos buscan el suelo. */
function golpe(rig, m) {
  setHips(rig, m.sit + .02, -.6, -1.02);
  bendSpine(rig, [-1.02, -.86, -.68], -.28, -.1);
  plantFoot(rig, 'left', .16, -.02, .28, [.4, 1, .3]);
  plantFoot(rig, 'right', .13, .03, .32, [.4, 1, .3]);
  rig.point('leftArm', .78, -.42, -.46);
  rig.point('leftForeArm', .56, -.72, -.4);
  rig.point('rightArm', -.8, -.4, -.44);
  rig.point('rightForeArm', -.58, -.74, -.36);
  rig.curl('left', .2); rig.curl('right', .2);
}

/** Se incorpora: sentado, con la mano derecha de apoyo atrás y la izquierda en la rodilla. */
function incorpora(rig, m) {
  setHips(rig, m.sit, -.62, -.6);
  bendSpine(rig, [-.34, -.08, .14], .22, .12);
  plantFoot(rig, 'left', .15, -.08, .18, [.4, 1, .35]);
  plantFoot(rig, 'right', .17, -.17, .36, [.7, .9, .2]);
  const pelvis = rig.where('hips');
  rig.reachArm('right', V(pelvis.x - .3, .1, pelvis.z - .1), V(-.7, .4, -.6));
  rig.hand('right', V(-.3, -.12, -.92), V(0, -1, -.1));
  rig.curl('right', .12, .08);
  const knee = rig.where('leftLeg');
  rig.reachArm('left', V(knee.x - .02, knee.y + .08, knee.z - .03), V(.9, -.4, -.3));
  rig.hand('left', V(-.1, -.6, .75), V(-.1, -.75, -.6));
  rig.curl('left', .3);
}

/** Una mano y una rodilla: el pie izquierdo plantado, la rodilla derecha en el piso y la mano derecha empuja. */
function rodilla(rig, m) {
  setHips(rig, m.over + .37, -.26, .46);
  bendSpine(rig, [.86, 1.2, 1.42], .9, .42);
  plantFoot(rig, 'left', .15, .2, .16, [.2, .5, 1]);
  const kneeZ = -.08;
  rig.reachLeg('right', V(-.11, m.kneeHeight + .05, kneeZ - rig.length.shin), V(-.1, -.25, 1));
  rig.orient('rightFoot', 2.82, -.1);
  rig.orient('rightToe', 2.82, -.1);
  rig.reachArm('right', V(HAND_PLANT.x, HAND_PLANT.y, HAND_PLANT.z), V(-.85, .3, -.4));
  rig.hand('right', V(-.15, -.45, .88), V(0, -.88, -.45));
  rig.curl('right', .14, .1);
  const knee = rig.where('leftLeg');
  rig.reachArm('left', V(knee.x - .01, knee.y + .09, knee.z - .1), V(.9, -.1, -.4));
  rig.hand('left', V(-.08, -.75, .65), V(-.1, -.65, -.75));
  rig.curl('left', .32);
}

/** Las piernas ya casi estiradas y el tronco todavía abajo: las manos empujan los muslos. El tronco sube de último. */
function empuje(rig, m) {
  setHips(rig, m.hipBone - .2, -.12, .5);
  bendSpine(rig, [.72, .96, 1.08], .82, .48);
  plantFoot(rig, 'left', m.hip.x + .04, .1, .18, [.2, .1, 1]);
  plantFoot(rig, 'right', m.hip.x + .03, -.08, .22, [.2, .1, 1]);
  for (const side of SIDES) {
    const sign = SIGN[side], knee = rig.where(`${side}Leg`), hip = rig.where(`${side}UpLeg`);
    const on = hip.clone().lerp(knee, .78);
    rig.reachArm(side, V(on.x + sign * .012, on.y + .085, on.z + .075), V(sign * .9, .2, -.4));
    rig.hand(side, V(-sign * .14, -.75, .62), V(0, -.62, -.75));
    rig.curl(side, .3);
  }
}

/** Noqueado en la banca: sigue sentado, con el tronco vencido hacia adelante y los brazos caídos. */
function desplomado(rig, m) {
  setHips(rig, m.seat - .015, -.05, -.03);
  bendSpine(rig, [.1, .38, .6], .78, .66, .2);
  rig.turn('head', 0, 0, .24);
  plantFoot(rig, 'left', .17, .38, .26, [.2, .6, 1]);
  plantFoot(rig, 'right', .12, .42, .1, [.1, .6, 1]);
  rig.point('leftArm', .28, -.95, .24);
  rig.point('leftForeArm', .02, -.62, .78);
  looseHand(rig, 'left', V(-.1, -.8, .55), .3);
  rig.point('rightArm', -.3, -.95, .22);
  rig.point('rightForeArm', -.16, -.95, .26);
  looseHand(rig, 'right', V(.05, -1, .1), .34);
}

/** Sin sitio para irse de espaldas: se escurre y queda sentado en el piso, con los pies hacia adelante. */
function recostado(rig, m) {
  setHips(rig, m.sit, .02, -.42);
  bendSpine(rig, [-.2, .1, .4], .62, .6, .24);
  rig.turn('head', 0, 0, .18);
  rig.reachLeg('left', V(.2, rig.marks.ankleY + .03, .74), V(.6, 1, .3));
  rig.orient('leftFoot', -.95, .42);
  rig.orient('leftToe', -.95, .42);
  plantFoot(rig, 'right', .24, .44, .5, [1, .7, .3]);
  rig.point('leftArm', .5, -.85, .12);
  rig.point('leftForeArm', .22, -.5, .82);
  looseHand(rig, 'left', V(-.2, -.5, .8), .3);
  rig.point('rightArm', -.52, -.85, -.02);
  rig.point('rightForeArm', -.56, -.8, .2);
  rig.hand('right', V(-.45, -.5, .7), V(.2, -.8, -.5));
  rig.curl('right', .28);
}

/** Dormido y noqueado no se mueve de donde está: la postura es la misma. */
const KO_POSES = {
  cede, golpe, tendido, incorpora, rodilla, empuje, desplomado, recostado,
  dormido: (rig, m) => dormido(rig, m),
  pedir: (rig, m) => pedir(rig, m),
  'de-pie': () => {}
};

/** Pierna doblada a un lado, con el pie acostado de canto: así pasa de plantado a recogido sin que la punta baje al piso. */
function tuckLeg(rig, side, x, y, z, pole, toe) {
  const sign = SIGN[side];
  rig.reachLeg(side, V(sign * x, rig.marks.ankleY + y, z), V(sign * pole[0], pole[1], pole[2]));
  rig.orient(`${side}Foot`, toe[0], sign * toe[1], sign * toe[2]);
  rig.orient(`${side}Toe`, toe[0], sign * toe[1], sign * toe[2]);
}

/**
 * Poses de paso: a medio camino entre otras dos, con el tronco y los brazos por donde ya iban y las piernas rehechas.
 * Entre dos poses `slerp` lleva cada hueso por el camino corto, y a una pierna que cambia mucho ese camino le cruza el piso.
 */
const KO_STEPS = {
  flexiona: { between: ['de-pie', 'cede'], legs(rig, m) {
    plantFoot(rig, 'left', m.hip.x + .02, .05, .12, [.3, .1, 1]);
    plantFoot(rig, 'right', m.hip.x + .01, -.02, .14, [.3, .1, 1]);
  } },
  sienta: { between: ['cede', 'golpe'], legs(rig, m) {
    plantFoot(rig, 'left', m.hip.x + .02, .02, .25, [.35, .6, .65]);
    plantFoot(rig, 'right', m.hip.x + .01, -.01, .29, [.35, .6, .65]);
  } },
  recoge: { between: ['incorpora', 'rodilla'], legs(rig) {
    plantFoot(rig, 'left', .15, .06, .17, [.3, .8, .6]);
    tuckLeg(rig, 'right', .32, .16, -.5, [1, .55, .15], [0, 1.57, .4]);
  } },
  abre: { between: ['incorpora', 'recoge'], legs(rig) {
    plantFoot(rig, 'left', .15, -.01, .17, [.35, .9, .45]);
    tuckLeg(rig, 'right', .26, .06, -.33, [1, .75, .25], [0, .8, 0]);
  } },
  pisa: { between: ['rodilla', 'empuje'], legs(rig) {
    plantFoot(rig, 'left', .15, .14, .17, [.2, .3, 1]);
    rig.reachLeg('right', V(-.12, rig.marks.ankleY + .15, -.24), V(-.15, .2, 1));
    rig.orient('rightFoot', .75, -.1);
    rig.orient('rightToe', .2, -.1);
  } },
  rueda: { between: ['dormido', 'rodilla'], at: .3, legs(rig) {
    rig.reachLeg('left', V(.56, rig.marks.ankleY + .12, .26), V(.3, 1, .4));
    rig.flatFoot('left', -.9);
    rig.reachLeg('right', V(.62, rig.marks.ankleY + .07, .1), V(.3, .8, .6));
    rig.flatFoot('right', 1.1);
  } },
  cruza: { between: ['rueda', 'rodilla'], at: .35, legs(rig) {
    rig.reachLeg('left', V(.36, rig.marks.ankleY + .1, .2), V(.3, 1, .4));
    rig.flatFoot('left', -.3);
    rig.reachLeg('right', V(.22, rig.marks.ankleY + .09, -.12), V(-.7, .6, .5));
    rig.orient('rightFoot', 0, .6, 1);
    rig.orient('rightToe', 0, .6, 1);
  } },
  despierta: { between: ['cruza', 'rodilla'], at: .5, legs(rig) {
    plantFoot(rig, 'left', .18, .15, .15, [.3, .8, .6]);
    tuckLeg(rig, 'right', .3, .16, -.45, [1, .55, .15], [0, 1.57, .4]);
  } },
  encoge: { between: ['cede', 'recostado'], legs(rig) {
    plantFoot(rig, 'left', .2, .3, .3, [.5, .8, .5]);
    plantFoot(rig, 'right', .2, .2, .35, [.6, .8, .4]);
  } },
  desliza: { between: ['recostado', 'empuje'], legs(rig) {
    plantFoot(rig, 'left', .18, .34, .28, [.3, .8, .5]);
    plantFoot(rig, 'right', .18, .2, .34, [.4, .8, .4]);
  } },
  // De rodillas saca primero los pies de debajo: las rodillas se abren y los pies quedan de canto.
  'saca-pies': { between: ['pedir', 'golpe'], at: .4, legs(rig) {
    tuckLeg(rig, 'left', .22, .08, -.26, [1, .75, .3], [0, 1.57, 1.57]);
    tuckLeg(rig, 'right', .22, .08, -.26, [1, .75, .3], [0, 1.57, 1.57]);
  } },
  'se-tiende': { between: ['saca-pies', 'tendido'], legs(rig) {
    rig.reachLeg('left', V(.3, rig.marks.ankleY + .03, -.2), V(.75, .6, .1));
    rig.orient('leftFoot', -.5, 1, .8);
    rig.orient('leftToe', -.5, 1, .8);
    rig.reachLeg('right', V(-.27, rig.marks.ankleY + .05, -.26), V(-.75, .6, .1));
    rig.orient('rightFoot', -.5, -1, -.8);
    rig.orient('rightToe', -.5, -1, -.8);
  } }
};

function cargar(side) {
  return rig => {
    const sign = SIGN[side];
    // El lado que carga baja y el torso se aparta un poco del peso.
    rig.turn(`${side}Shoulder`, 0, 0, sign * .1);
    lean(rig, .012, sign * .045);
    rig.point(`${side}Arm`, sign * .13, -1, -.02);
    rig.point(`${side}ForeArm`, sign * .1, -1, .03);
    rig.hand(side, V(-sign * .04, -1, .05), V(-sign, 0, .1));
    rig.curl(side, .88, .7);
  };
}

function atender(rig, m) {
  // Manos juntas al frente, sin afán, esperando al siguiente cliente.
  lean(rig, .025);
  rig.turn('head', -.02, 0, 0);
  rig.reachArm('left', V(.065, m.hip.y + .165, m.belly + .055), V(.9, -.7, -.3));
  rig.hand('left', V(-.86, .12, .42), V(-.1, -.3, -1));
  rig.curl('left', .45, .25);
  rig.reachArm('right', V(-.07, m.hip.y + .18, m.belly + .08), V(-.9, -.7, -.3));
  rig.hand('right', V(.86, .1, .4), V(.1, -.3, -1));
  rig.curl('right', .38, .2);
}

function dormido(rig, m) {
  // Primero el ovillo de pie; después, la cadera acuesta todo el cuerpo sobre su lado derecho.
  rig.orient('spine', .14).orient('spine1', .34).orient('spine2', .52).orient('neck', .6).orient('head', .68);
  rig.point('leftUpLeg', .05, -.48, .88); rig.point('leftLeg', .02, -.76, -.65);
  rig.point('rightUpLeg', -.02, -.72, .7); rig.point('rightLeg', -.02, -.9, -.45);
  rig.flatFoot('left', .05, .55); rig.flatFoot('right', .05, .55);
  const head = rig.where('head', V(0, 0, 0));
  // El brazo de abajo se dobla sobre el piso, delante del pecho, y la mano queda bajo la mejilla.
  rig.turn('rightShoulder', 0, .85, 0);
  rig.reachArm('right', V(head.x - .125, head.y + .03, head.z + .1), V(.1, -.85, .5));
  rig.hand('right', V(.05, .72, -.68), V(1, 0, .1));
  rig.curl('right', .25, .2);
  rig.reachArm('left', V(.02, head.y - .17, head.z + .22), V(.9, -.6, .1));
  rig.hand('left', V(-.2, .7, .68), V(-.86, -.1, -.5));
  rig.curl('left', .42, .3);
  rig.hips.position.set(.24, m.sleepHeight, .02);
  rig.root.updateMatrixWorld(true);
  rig.orient('hips', 0, 0, Math.PI / 2);
}

function barriga(rig, m) {
  lean(rig, .1);
  rig.turn('neck', .1, 0, 0).turn('head', .12, 0, 0);
  rig.reachArm('right', V(-.05, m.hip.y + .115, m.belly + .045), V(-.95, -.6, -.1));
  rig.hand('right', V(.86, .28, .2), V(0, -.25, -1));
  rig.curl('right', .34, .15);
  rig.reachArm('left', V(.1, m.hip.y + .065, m.belly + .04), V(.95, -.6, -.1));
  rig.hand('left', V(-.88, .18, .15), V(0, -.2, -1));
  rig.curl('left', .42, .15);
}

function frotarse(rig, m, alt) {
  // Brazos cruzados contra el pecho y manos que suben y bajan por el brazo contrario.
  rig.turn('spine2', .05, 0, 0).turn('neck', .06, 0, 0);
  rig.turn('leftShoulder', .05, 0, -.05).turn('rightShoulder', .05, 0, .05);
  const slide = alt ? .04 : -.015;
  for (const side of SIDES) {
    const sign = SIGN[side], other = SIGN[OTHER[side]];
    const arm = rig.where(`${OTHER[side]}Arm`, V(0, 0, 0));
    const low = side === 'left' ? .035 : 0;
    rig.reachArm(side, V(arm.x * .5, arm.y - .15 - low + (side === 'left' ? -slide : slide), arm.z + .13 - low * .3), V(sign * .5, -1, .15));
    rig.hand(side, V(other * .9, -.1, -.42), V(other * .3, -.02, -.95));
    rig.curl(side, .62, .3);
  }
}

function rascarse(rig, m, alt) {
  rig.turn('neck', .03, 0, 0).turn('head', .02, 0, alt ? .045 : .02);
  const head = rig.where('head', V(0, 0, 0));
  rig.reachArm('right', V(head.x - .105 + (alt ? .012 : 0), head.y + .045 + (alt ? .018 : 0), head.z + .005), V(-.82, -.55, .42));
  rig.hand('right', V(.36, .82, -.14 + (alt ? .1 : 0)), V(.9, -.4, 0));
  rig.curl('right', alt ? .62 : .46, .35);
}

function encogido(rig, m) {
  // Bajo la lluvia o con frío: hombros arriba, cabeza metida y manos juntas al frente.
  lean(rig, .1);
  rig.turn('neck', -.02, 0, 0).turn('head', .08, 0, 0);
  rig.turn('leftShoulder', .06, 0, .1).turn('rightShoulder', .06, 0, -.1);
  for (const side of SIDES) {
    const sign = SIGN[side];
    rig.reachArm(side, V(sign * .1, m.hip.y + .115, m.belly + .085), V(sign * 1, -.35, -.4));
    rig.hand(side, V(-sign * .82, .2, .45), V(-sign * .1, -.15, -1));
    rig.curl(side, .55, .35);
  }
}

function cambiarPeso(rig, m) {
  // Todo el peso sobre la pierna derecha, la izquierda suelta.
  const pelvis = rig.where('hips', V(0, 0, 0));
  rig.moveHips(-.045, -.006, .004);
  rig.orient('hips', 0, -.05, -.05);
  rig.turn('spine', 0, 0, .02).turn('spine1', 0, .02, .035).turn('spine2', 0, .03, .03);
  rig.turn('head', 0, -.05, -.03);
  plantFoot(rig, 'left', m.hip.x + .05, pelvis.z + .07, .3, [.15, 0, 1]);
  plantFoot(rig, 'right', m.hip.x - .003, pelvis.z - .015, .14, [.1, 0, 1]);
}

const mirar = yaw => rig => {
  rig.turn('spine2', 0, yaw * .1, 0).turn('neck', 0, yaw * .32, 0).turn('head', -.02, yaw * .56, 0);
};

/**
 * Sin aire después de correr: la cadera atrás, el tronco doblado desde la cadera (unos 54°), las manos apoyadas encima
 * de los muslos, más cerca de la rodilla que de la cadera, con los brazos casi estirados y los codos algo abiertos, las
 * rodillas dobladas unos 14° y la cabeza colgando. La alternativa es tomar aire: el tronco sube unos 3° y los hombros
 * unos 2 cm, con las manos en el mismo sitio.
 */
function sinAire(rig, m, alt) {
  const breath = alt ? 1 : 0;
  setHips(rig, m.hipBone - .07, -.14, .64 - breath * .02);
  bendSpine(rig, [.86 - breath * .04, 1.04 - breath * .06, 1.1 - breath * .07], 1.2 - breath * .04, 1.36 - breath * .03);
  plantFoot(rig, 'left', m.hip.x + .04, .05, .18, [.15, 0, 1]);
  plantFoot(rig, 'right', m.hip.x + .035, .05, .2, [.15, 0, 1]);
  // Los hombros se van adelante y abajo, colgados de los brazos; al tomar aire suben.
  rig.turn('leftShoulder', 0, -.2, breath * .1 - .12).turn('rightShoulder', 0, .2, .12 - breath * .1);
  for (const side of SIDES) {
    const sign = SIGN[side], knee = rig.where(`${side}Leg`), hip = rig.where(`${side}UpLeg`);
    const on = hip.clone().lerp(knee, .72);
    rig.reachArm(side, V(on.x + sign * .012, on.y + .075, on.z + .06), V(sign * .9, .15, -.4));
    rig.hand(side, V(-sign * .18, -.72, .66), V(0, -.65, -.75));
    rig.curl(side, .3);
  }
}

/** Habla por el radio de la solapa: la mano izquierda lo aprieta junto al hombro, la cabeza ladeada hacia ella y la derecha en la cintura. */
function radioSolapa(rig, m) {
  rig.turn('neck', .05, .08, -.1).turn('head', .06, .1, -.12);
  const shoulder = rig.where('leftArm', V(0, 0, 0));
  rig.reachArm('left', V(shoulder.x - .075, shoulder.y - .045, m.front + .015), V(.85, -.7, -.1));
  rig.hand('left', V(-.35, .85, .2), V(-.25, -.1, -.95));
  rig.curl('left', .45, .3);
  const hip = rig.where('rightUpLeg', V(0, 0, 0));
  rig.reachArm('right', V(hip.x - .085, hip.y + .13, hip.z + .02), V(-1, .1, -.5));
  rig.hand('right', V(.25, -.9, .2), V(.95, 0, .1));
  rig.curl('right', .35);
}

// El agarrón de un agente, con la mano izquierda (en la derecha va la pistola con fichado 3): el aviso, el zarpazo, el
// agarre y el traspié cuando no alcanza.

/** La muñeca a `along` m por delante del hombro izquierdo con el codo doblado `elbow` radianes, a la altura `y`. */
function grabReach(rig, elbow, y, inward = .08) {
  const shoulder = rig.where('leftArm', V(0, 0, 0)), a = rig.length.arm, f = rig.length.forearm;
  const reach = Math.sqrt(a * a + f * f + 2 * a * f * Math.cos(elbow));
  const across = shoulder.x - inward, drop = y - shoulder.y;
  const along = Math.sqrt(Math.max(0, reach * reach - inward * inward - drop * drop));
  return V(across, y, shoulder.z + along);
}

/**
 * El aviso: el tronco 11° adelante con la cabeza derecha, clavada en él; la mano izquierda estirada al frente a la altura
 * del hombro, abierta, con el codo doblado unos 70°, y la derecha atrás.
 */
function aviso(rig, m) {
  lean(rig, .33);
  rig.turn('neck', -.12, 0, 0).turn('head', -.14, 0, 0);
  const shoulder = rig.where('leftArm', V(0, 0, 0));
  rig.reachArm('left', grabReach(rig, 70 * Math.PI / 180, shoulder.y - .02), V(.75, -.6, -.3));
  rig.hand('left', V(-.15, .2, .97), V(-.25, -.35, .9));
  rig.curl('left', .12, .1);
  const hip = rig.where('rightUpLeg', V(0, 0, 0));
  rig.reachArm('right', V(hip.x - .1, hip.y + .1, hip.z - .2), V(-.5, -.2, -.8));
  looseHand(rig, 'right', V(0, -1, -.2), .35);
}

/**
 * El zarpazo: el brazo izquierdo se va del todo, adelante y un poco abajo, con el tronco girado unos 20° tras él y más
 * echado; la mano abierta y el brazo derecho atrás.
 */
function zarpazo(rig, m) {
  lean(rig, .45);
  rig.turn('spine', 0, -.08, 0).turn('spine1', 0, -.12, 0).turn('spine2', 0, -.15, 0).turn('neck', -.15, .1, 0).turn('head', -.17, .12, 0);
  const shoulder = rig.where('leftArm', V(0, 0, 0));
  rig.reachArm('left', V(shoulder.x - .1, shoulder.y - .12, shoulder.z + rig.length.arm + rig.length.forearm + .05), V(.8, -.6, -.1));
  rig.hand('left', V(-.1, -.1, 1), V(-.2, -.6, .78));
  rig.curl('left', .08, .05);
  const hip = rig.where('rightUpLeg', V(0, 0, 0));
  rig.reachArm('right', V(hip.x - .12, hip.y + .08, hip.z - .28), V(-.5, -.2, -.8));
  looseHand(rig, 'right', V(0, -1, -.3), .4);
}

/**
 * Cuando ya se le zafó dos veces no estira el brazo: se le tira encima. El tronco echado unos 30° con la cabeza arriba,
 * clavada en él, y los dos brazos adelante y abiertos, a la altura del pecho, para abrazarlo por donde quiebre.
 */
function embestida(rig, m) {
  lean(rig, .95);
  rig.turn('neck', -.3, 0, 0).turn('head', -.35, 0, 0);
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1, shoulder = rig.where(`${side}Arm`, V(0, 0, 0));
    const reach = (rig.length.arm + rig.length.forearm) * .88;
    rig.reachArm(side, V(shoulder.x + sign * .16, shoulder.y - .12, shoulder.z + reach), V(sign * .8, -.6, -.2));
    rig.hand(side, V(-sign * .25, .1, .96), V(-sign * .3, -.5, .8));
    rig.curl(side, .15, .1);
  }
}

/** El agarre: la mano izquierda cerrada sobre el hombro de él, el codo doblado, y el tronco ya echado atrás, frenando. */
function agarre(rig, m) {
  lean(rig, -.15);
  rig.turn('neck', .06, 0, 0).turn('head', .07, 0, 0);
  const shoulder = rig.where('leftArm', V(0, 0, 0));
  rig.reachArm('left', grabReach(rig, 55 * Math.PI / 180, shoulder.y + .02), V(.7, -.7, -.2));
  rig.hand('left', V(-.1, -.35, .93), V(-.15, -.9, .3));
  rig.curl('left', .75, .5);
  const hip = rig.where('rightUpLeg', V(0, 0, 0));
  rig.reachArm('right', V(hip.x - .12, hip.y + .1, hip.z + .05), V(-.8, -.3, -.4));
  looseHand(rig, 'right');
}

/**
 * El zarpazo que no alcanzó: el brazo izquierdo barre de largo cruzándole el cuerpo, abajo; el tronco pasado unos 32° y
 * echado unos 35°, la cabeza caída y el brazo derecho abierto para no irse de bruces.
 */
function traspie(rig, m) {
  lean(rig, 1.15);
  rig.turn('spine', 0, -.13, 0).turn('spine1', 0, -.2, 0).turn('spine2', 0, -.24, 0).turn('neck', .2, 0, 0).turn('head', .25, 0, 0);
  rig.reachArm('left', V(-.12, m.hip.y + .08, m.front + .22), V(.6, -.5, -.6));
  rig.hand('left', V(-.6, -.55, .58), V(-.5, -.3, -.8));
  rig.curl('left', .3);
  const shoulder = rig.where('rightArm', V(0, 0, 0));
  rig.reachArm('right', V(shoulder.x - .42, shoulder.y - .22, shoulder.z + .08), V(-.3, -.9, -.3));
  rig.hand('right', V(-.85, -.4, .3), V(0, -1, .1));
  rig.curl('right', .25);
}

// Sentado en un carro, el piso del personaje es el piso del carro. Las dos alturas las usa `patrolCar.js` para poner la
// raíz: de la articulación de la cadera al piso, sentado y ya en el borde del asiento con un pie en la calle.
export const CAR_SEAT_HIP = .25;
export const CAR_EDGE_HIP = .6;
const CAR_KNEE = 95 * Math.PI / 180;

/**
 * Sentado en la patrulla: la cadera baja, las rodillas a unos 95°, el tronco recostado unos 12° contra el espaldar y la
 * cabeza apenas adelantada. Las manos van sobre los muslos.
 */
function patrulla(rig, m) {
  setHips(rig, CAR_SEAT_HIP / 1.08 + m.over, 0, -.2);
  bendSpine(rig, [-.21, -.21, -.2], -.06, .04);
  const { thigh, shin } = rig.length;
  for (const side of SIDES) {
    const hip = rig.where(`${side}UpLeg`, V(0, 0, 0));
    const reach = Math.sqrt(thigh * thigh + shin * shin - 2 * thigh * shin * Math.cos(CAR_KNEE));
    const ahead = Math.sqrt(Math.max(0, reach * reach - (hip.y - rig.marks.ankleY) ** 2));
    plantFoot(rig, side, .13, hip.z + ahead, .1, [.08, 1, .5]);
    const sign = SIGN[side], knee = rig.where(`${side}Leg`), on = rig.where(`${side}UpLeg`).clone().lerp(knee, .55);
    rig.reachArm(side, V(on.x, on.y + .11, on.z), V(sign * .9, -.5, -.5));
    rig.hand(side, V(-sign * .12, -.3, .94), V(-sign * .1, -.94, -.3));
    rig.curl(side, .25);
  }
}

/** Devuelve tronco, cuello y cabeza a como estaban: lo que una pose usó de ellos solo para ubicar los brazos. */
function releaseTorso(rig) {
  for (const key of ['spine', 'spine1', 'spine2', 'neck', 'head']) rig.joints[key].quaternion.copy(rig.reference.get(rig.joints[key]));
  rig.root.updateMatrixWorld(true);
}

/**
 * En el borde del asiento, ya girado hacia la puerta, con el pie de afuera (`lead`) plantado en la calle y el otro
 * todavía adentro, recogido. La mano de ese lado empuja sobre la rodilla y la otra se apoya atrás, en el asiento. No toca
 * tronco ni cabeza: esos van con `agachado` y `cabeza-baja`, que entran y salen a su propio tiempo.
 */
function baja(lead) {
  const other = OTHER[lead], sign = SIGN[lead];
  return (rig, m) => {
    setHips(rig, CAR_EDGE_HIP / 1.08 + m.over, 0, .12, 0, sign * .12);
    bendSpine(rig, [.44, .5, .52], .5, .5);
    plantFoot(rig, lead, .17, .37, .16, [.25, .3, 1]);
    rig.reachLeg(other, V(-sign * .12, rig.marks.ankleY + .2, -.04), V(-sign * .2, .4, 1));
    rig.flatFoot(other, .05, .35);
    const knee = rig.where(`${lead}Leg`);
    rig.reachArm(lead, V(knee.x + sign * .02, knee.y + .09, knee.z - .03), V(sign * .9, -.2, -.5));
    rig.hand(lead, V(-sign * .15, -.6, .78), V(0, -.75, -.65));
    rig.curl(lead, .3);
    const hip = rig.where(`${other}UpLeg`, V(0, 0, 0));
    rig.reachArm(other, V(hip.x - sign * .16, hip.y - .02, hip.z - .2), V(-sign * .8, .1, -.6));
    rig.hand(other, V(-sign * .2, -.55, -.8), V(0, -.85, .5));
    rig.curl(other, .2);
    releaseTorso(rig);
  };
}

/** Doblado desde la cintura unos 28°, como para pasar bajo el marco de una puerta: solo el tronco. */
function agachado(rig) {
  rig.orient('spine', .44).orient('spine1', .5).orient('spine2', .52);
}

/** La cabeza agachada: solo cuello y cabeza. */
function cabezaBaja(rig) {
  rig.turn('neck', .16, 0, 0).turn('head', .24, 0, 0);
}

// ---------- catálogo ----------

// `walk`: se conserva andando. `hip`: mueve la cadera. `transition`: segundos de entrada. `motion`:
// oscilación entre la pose y su alternativa, lenta en quien habla o mira el celular y más viva en quien
// se rasca ({ rate } en vueltas por segundo, con tope en body-language-guards.test.js; `pulse` deja la
// alternativa solo un rato de cada ciclo, para un gesto que se repite y descansa).
// `arms`: peso sobre brazos y manos, para que el clip de debajo se siga notando. `anchored`: las manos
// van con la cadera, no con el pecho, y al andar los brazos compensan lo que se inclina el tronco.
// `steady`: la mano va delante de la cara o sostiene algo, y al andar el pecho gira menos para que no baile.
const CATALOG = {
  // Lo que pide el diseño
  bolsillos: { pose: bolsillos, walk: true, anchored: true },
  'brazos-cruzados': { pose: brazosCruzados, walk: false },
  telefono: { pose: telefono, walk: true, steady: true },
  celular: { pose: celular, walk: true, steady: true, alt: true, motion: { rate: .13 } },
  'manos-atras': { pose: manosAtras, walk: true, anchored: true },
  hablar: { pose: hablar, walk: false, alt: true, motion: { rate: .31 } },
  'fumar-quieto': { pose: fumarQuieto, walk: false, alt: true, motion: { rate: .085, pulse: .22 } },
  sentado: { pose: sentado, walk: false, hip: true, transition: .8 },
  acurrucado: { pose: acurrucado, walk: false, hip: true, transition: .9 },
  banca: { pose: banca, walk: false, hip: true, transition: .7 },
  pedir: { pose: pedir, walk: false, hip: true, transition: .9 },
  paraguas: { pose: paraguas, walk: true, steady: true },
  cubrirse: { pose: cubrirse, walk: true },
  nariz: { pose: nariz, walk: true, steady: true },
  huir: { pose: huir, walk: true, arms: .7, torso: .7, transition: .2 },
  tendido: { pose: tendido, walk: false, hip: true, transition: .5 },
  'cargar-derecha': { pose: cargar('right'), walk: true, arms: .9 },
  'cargar-izquierda': { pose: cargar('left'), walk: true, arms: .9 },
  // Lo que además hace falta
  atender: { pose: atender, walk: false },
  dormido: { pose: dormido, walk: false, hip: true, transition: 1.2 },
  barriga: { pose: barriga, walk: false, transition: .5 },
  frotarse: { pose: frotarse, walk: false, alt: true, motion: { rate: .62 }, transition: .5 },
  rascarse: { pose: rascarse, walk: false, alt: true, motion: { rate: 1.05 }, transition: .45 },
  encogido: { pose: encogido, walk: true, transition: .6 },
  'cambiar-peso': { pose: cambiarPeso, walk: false, hip: true, transition: .9 },
  'mirar-izquierda': { pose: mirar(1), walk: false, transition: .6 },
  'mirar-derecha': { pose: mirar(-1), walk: false, transition: .6 },
  'sin-aire': { pose: sinAire, walk: false, hip: true, alt: true, motion: { rate: 1.1 }, transition: .45 },
  'radio-solapa': { pose: radioSolapa, walk: false, transition: .4 },
  // El agarrón: entra suave el aviso, el zarpazo en tres o cuatro cuadros, el agarre en lo que frenan (de 20° adelante
  // a 5° atrás) y el traspié de una.
  aviso: { pose: aviso, walk: true, transition: .2 },
  zarpazo: { pose: zarpazo, walk: true, transition: .05 },
  embestida: { pose: embestida, walk: true, transition: .15 },
  agarre: { pose: agarre, walk: true, transition: .3 },
  traspie: { pose: traspie, walk: true, transition: .08 },
  // Los agentes en la patrulla y al bajarse (ver `PoliceOfficer._updateExit`)
  patrulla: { pose: patrulla, walk: false, hip: true, transition: .5 },
  'baja-izquierda': { pose: baja('left'), walk: false, hip: true, transition: .3 },
  'baja-derecha': { pose: baja('right'), walk: false, hip: true, transition: .3 },
  agachado: { pose: agachado, walk: true, transition: .2 },
  'cabeza-baja': { pose: cabezaBaja, walk: true, transition: .2 }
};

/** Dónde toca el piso la mano derecha al levantarse: lo que se le cayó queda a su alcance. */
export const HAND_ON_FLOOR = Object.freeze({ x: HAND_PLANT.x, z: HAND_PLANT.z });

/** Todas las posturas que se pueden pedir. */
export const STANCE_NAMES = Object.freeze(Object.keys(CATALOG));

const ANGLE_EPS = .003;
const FINGER = /Hand(?:Thumb|Index|Middle|Ring|Pinky)\d/;
const ARM = /(?:Shoulder|Arm|Hand)/;
const TORSO = /(?:Spine|Neck|Head)/;
const STEADY = .6;

/** Medidas de este cuerpo, tomadas de pie: a qué distancia están sus bolsillos, su frente y su espalda. */
function measure(rig) {
  const hip = rig.where('leftUpLeg', V(0, 0, 0)), chest = rig.where('spine2', V(0, 0, 0));
  const head = rig.where('head', V(0, 0, 0)), shoulder = rig.where('leftArm', V(0, 0, 0));
  const pelvis = rig.where('hips', V(0, 0, 0));
  const height = head.y / 1.484;
  const woman = hip.x < .1;
  return {
    hip, chest, head, shoulder, pelvis,
    // Medidas del torso y la cabeza, por encima de lo que ocupan los huesos.
    pocket: woman ? .06 : .052,
    front: chest.z + (woman ? .205 : .195) * height,
    belly: pelvis.z + (woman ? .13 : .135),
    back: pelvis.z - (woman ? .14 : .135),
    ear: .085 * height, crown: .19 * height, nose: .1 * height,
    hipBone: rig.hips.position.y, over: rig.hips.position.y - hip.y,
    sit: .115 * (woman ? 1.04 : 1) + (rig.hips.position.y - hip.y),
    seat: SEAT_HEIGHT + .105 + (rig.hips.position.y - hip.y),
    kneeHeight: woman ? .04 : .05,
    kneel: .315 * height + (rig.hips.position.y - hip.y),
    sleepHeight: .18
  };
}

/** Lo que `pose` dejó distinto de la referencia, como rotaciones locales. */
function capture(rig, entry) {
  const before = rig.reference;
  const out = [];
  for (const [bone, quaternion] of before) {
    if (bone.quaternion.angleTo(quaternion) < ANGLE_EPS) continue;
    const name = bone.name;
    const peso = ARM.test(name) ? entry.arms ?? 1 : TORSO.test(name) ? entry.torso ?? 1 : 1;
    out.push({ boneName: name, quaternion: bone.quaternion.clone(), peso, dedo: FINGER.test(name) });
  }
  if (entry.steady) {
    for (const key of ['spine', 'spine1', 'spine2']) {
      const bone = rig.joints[key];
      if (!out.some(item => item.boneName === bone.name)) out.push({ boneName: bone.name, quaternion: before.get(bone).clone(), peso: STEADY, dedo: false });
    }
  }
  return out;
}

/** Añade a cada hueso de la pose su rotación en la alternativa; el que no cambia allí la repite. */
function withAlternative(entries, altEntries) {
  const byName = new Map(altEntries.map(item => [item.boneName, item]));
  return entries.map(item => ({ ...item, alt: byName.get(item.boneName)?.quaternion ?? item.quaternion }));
}

/**
 * Hornea todas las posturas de un cuerpo. `standing` es el clip del que salen los brazos colgando.
 * Devuelve Map(nombre → { entries, hip, hipDrop, walk, anchored, transition, motion }) y los datos de `style`.
 */
export function bakeStances(scene, standing = null) {
  const rig = new PoseRig(scene);
  const frozen = standingFrozen(rig, standing);
  standAt(rig, frozen, GAIT_FAMILIES.normal, 0);
  rig.remember();
  const m = measure(rig);
  const hipStanding = rig.hips.position.clone();
  const stances = new Map();
  for (const [name, entry] of Object.entries(CATALOG)) {
    rig.reset();
    entry.pose(rig, m, false);
    let entries = capture(rig, entry);
    const hip = entry.hip ? rig.hips.position.clone() : null;
    if (entry.alt) {
      rig.reset();
      entry.pose(rig, m, true);
      entries = withAlternative(entries, capture(rig, entry));
    }
    stances.set(name, {
      name, entries, hip, hipDrop: hip ? hipStanding.y - hip.y : 0,
      walk: !!entry.walk, anchored: !!entry.anchored, transition: entry.transition ?? .35, motion: entry.motion ?? null
    });
  }
  const knockout = bakeKnockout(rig, m);
  rig.reset();
  const holds = bakeHolds(rig, m);
  rig.reset();
  return { stances, knockout, style: bakeStyle(rig), holds };
}

/**
 * Las poses de caer y pararse, con un valor por hueso en el mismo orden en todas: entre dos de ellas `BodyLanguage`
 * solo interpola. Devuelve { bones: [{ boneName, dedo }], keys: { nombre: { q: [Quaternion], hip: Vector3 } } }.
 */
function bakeKnockout(rig, m) {
  const all = [...rig.reference.keys()];
  const poses = Object.entries(KO_POSES).map(([name, pose]) => {
    rig.reset();
    pose(rig, m, false);
    return [name, all.map(bone => bone.quaternion.clone()), rig.hips.position.clone()];
  });
  for (const [name, { between: [a, b], at = .5, legs }] of Object.entries(KO_STEPS)) {
    const from = poses.find(pose => pose[0] === a), to = poses.find(pose => pose[0] === b);
    all.forEach((bone, i) => bone.quaternion.slerpQuaternions(from[1][i], to[1][i], at));
    rig.hips.position.lerpVectors(from[2], to[2], at);
    rig.root.updateMatrixWorld(true);
    legs(rig, m);
    poses.push([name, all.map(bone => bone.quaternion.clone()), rig.hips.position.clone()]);
  }
  const moved = all.map((bone, i) => poses.some(([, q]) => q[i].angleTo(rig.reference.get(bone)) >= ANGLE_EPS));
  const pick = q => q.filter((_, i) => moved[i]);
  const keys = {};
  for (const [name, q, hip] of poses) keys[name] = { q: pick(q), hip };
  return { bones: all.filter((_, i) => moved[i]).map(bone => ({ boneName: bone.name, dedo: FINGER.test(bone.name) })), keys };
}

const CANE_RUN_GRIP = .4; // m del extremo del bastón a donde lo agarra al correr

/**
 * Marcos de las manos para objetos rígidos. Con la postura puesta, un objeto atado al hueso con estos
 * valores queda en la muñeca y con los ejes del personaje: +Y es arriba aunque la mano esté torcida.
 * `telefono` va en los ejes de la mano: +Y hacia los dedos y +Z hacia donde mira la palma.
 */
function bakeHolds(rig, m) {
  const decompose = (bone, matrix) => {
    const position = V(0, 0, 0), quaternion = new Quaternion(), scale = V(1, 1, 1);
    matrix.decompose(position, quaternion, scale);
    return { boneName: bone.name, position, quaternion, scale };
  };
  const holds = {};
  for (const [name, side] of [['paraguas', 'right'], ['cargar-izquierda', 'left'], ['cargar-derecha', 'right']]) {
    rig.reset();
    CATALOG[name].pose(rig, m, false);
    rig.root.updateMatrixWorld(true);
    const bone = rig.joints[`${side}Hand`];
    const wrist = bone.getWorldPosition(V(0, 0, 0));
    const frame = new Matrix4().copy(bone.matrixWorld).invert().multiply(new Matrix4().makeTranslation(wrist.x, wrist.y, wrist.z));
    holds[name] = { ...decompose(bone, frame), height: wrist.y };
  }
  const hand = rig.joints.rightHand;
  const { axis, palm } = rig._handFrame('right');
  const across = V(0, 0, 0).crossVectors(axis, palm).normalize();
  // El celular queda sobre la palma, un poco adelante de la muñeca.
  const grip = new Matrix4().makeBasis(across, axis, palm).setPosition(V(0, 0, 0).addScaledVector(axis, .085).addScaledVector(palm, .024));
  holds.telefono = decompose(hand, grip);
  // Corriendo, el bastón va agarrado por la mitad y atravesado en el puño: ni arrastra ni apunta hacia atrás.
  const run = new Matrix4().makeBasis(palm, across, axis).setPosition(V(0, 0, 0).addScaledVector(axis, .07).addScaledVector(palm, .02).addScaledVector(across, CANE_RUN_GRIP));
  holds['baston-correr'] = decompose(hand, run);
  return holds;
}

/** Lo que `style` necesita de este cuerpo: ejes locales de la columna y brazos abajo. */
function bakeStyle(rig) {
  const axisOf = (key, x, y, z) => {
    const bone = rig.joints[key];
    const q = bone.getWorldQuaternion(new Quaternion()).invert();
    return { boneName: bone.name, axis: V(x, y, z).applyQuaternion(q).normalize() };
  };
  const forward = (key, share) => ({ ...axisOf(key, 1, 0, 0), share });
  const side = (key, share) => ({ ...axisOf(key, 0, 0, 1), share });
  const down = key => ({ boneName: rig.joints[key].name, quaternion: rig.joints[key].quaternion.clone() });
  const inShoulder = (arm, shoulder) => ({
    boneName: rig.joints[arm].name,
    axis: V(1, 0, 0).applyQuaternion(rig.joints[shoulder].getWorldQuaternion(new Quaternion()).invert()).normalize()
  });
  return {
    stoop: [forward('spine', .24), forward('spine1', .36), forward('spine2', .4), forward('neck', -.2), forward('head', -.12)],
    head: [forward('neck', .45), forward('head', .55)],
    sway: [side('spine', .5), side('spine1', .5), side('neck', -.35), side('head', -.25)],
    arms: ['leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'].map(down),
    knee: down('rightLeg'),
    leanBack: [inShoulder('leftArm', 'leftShoulder'), inShoulder('rightArm', 'rightShoulder')]
  };
}
