// src/entities/npc/steering.js
// Esquivarse en la calle. Cada cuadro, quien va andando mira a los pocos que tiene a menos de 6 m por delante, calcula
// cuándo y a qué distancia se van a cruzar y, si se van a rozar, se corre hacia su derecha sobre la línea de su ruta
// (los dos a su derecha: se pasan hombro izquierdo con hombro izquierdo). Si no hay sitio, cede el de menor número.
// A quien viene corriendo le abre paso. El giro sale de correrse a una velocidad limitada y de volver despacio a la
// línea: así no tiembla ni hace zigzag. Mejor frenar un momento que vibrar. Si a uno no le cabe correrse (un poste,
// el borde), el otro no cuenta con su mitad: se corre todo él. Y si aun así quedan frente a frente, trabados, un
// desempate fijo: cede el de menor número (espera donde está, o da un paso atrás si lo tiene encima) y el otro se
// corre de una y pasa.
//
// A alguien quieto (el jugador parado, uno que espera) lo rodea por el lado en que cabe, aunque no sea el suyo. Si
// dos que vienen de frente tienen que rodear al mismo quieto por el mismo lado y no caben los dos a la vez (un
// cuello), hacen un acuerdo como en la calle: el que ya va pasando (ya metido en el cuello) termina de pasar; si
// ninguno ha entrado, pasa primero el que llega antes. El otro baja el paso o espera un poco antes del quieto, en la
// línea de este, y pasa después; y si detrás del que pasó viene otro en fila, lo deja pasar también (dos como mucho,
// unos 4 s). Ceder nunca acerca a nadie a un quieto: quien ya está a su lado se queda en su lado. Quedarse esperando
// así no es estar trabado: buscar otro camino queda para cuando el que estorba está quieto y no hay ningún lado libre.
//
// Varios quietos juntos (una pareja que charla) son un solo estorbo: los rodea por fuera, por el andén; si no cabe y
// entre dos hay hueco, pasa por el medio despacio y de a uno; si no, espera sin arrimárseles. Con una pared a un lado
// le pasa justo a un quieto, despacio. Y ningún paso de lado, venga de donde venga, le mete el cuerpo encima a otro
// (`sideStepRoom`).
//
// Solo aritmética sobre los vecinos de la rejilla (crowd.js): nada de memoria nueva por cuadro.

import { hypot } from './hypot.js';

export const AVOID = {
  query: 6,          // m: vecinos que cuentan. Dos de frente a paso normal se ven unos 2,3 s antes de cruzarse
  runnerQuery: 7,    // m: a quien viene corriendo lo ve desde más lejos
  ahead: -.3,        // coseno: detrás de esto no lo mira (salvo que esté encima)
  horizon: 2.5,      // s: lo que se cruza más tarde no le preocupa todavía
  waryHorizon: 4,    // s: al jugador que le da recelo lo empieza a rodear antes, para abrirse sin correrse más rápido
  personal: .45,     // m de espacio personal de cada uno: dos personas buscan pasar a .9 m entre centros
  body: .27,         // m de radio del cuerpo: más cerca que dos cuerpos ya es un roce
  enough: .7,        // m entre centros con los que pasa sin frenar aunque no tenga todo su espacio
  slack: .05,        // m: si le falta menos que esto para su espacio, no le estorba
  stop: .75,         // m: con alguien así de cerca en su camino se detiene
  maxSide: .8,       // m que se corre de la línea de su ruta (la baldosa mide 2)
  extraSide: .3,     // m de más que se corre, si hay andén, cuando alguien quieto se le metió al lado y no le pasa
  sideRate: .5,      // m/s al correrse para esquivar a otro que anda
  sideAccel: .8,     // m/s² con que arranca y termina de correrse: entra y sale suave, el cuerpo no da un quiebre
  roundRate: .6,     // m/s al correrse para rodear a alguien quieto, o con el otro ya encima
  roundAccel: 4,     // m/s² al rodear a alguien quieto
  dodgeAccel: 8,     // m/s² al quitarse del camino de quien corre, en un desempate o con el otro ya encima: ahí sí es un paso brusco
  dodgeRate: 1.3,    // m/s al quitarse del camino de quien corre
  relaxRate: .5,     // m/s al volver a la línea
  hold: .8,          // s que conserva el lado después de pasar
  headOn: .25,       // m: con el otro tan centrado da igual por dónde: a la derecha
  centered: .05,     // m: lo mismo, con el otro ya encima (a menos de `faceOff`)
  runner: 2.6,       // m/s: desde aquí es alguien que viene corriendo
  runnerRoom: 1.5,   // m que le abre a quien corre
  yieldTime: 1.2,    // s: un cruce así de cerca en el tiempo hace frenar a quien cede
  deadEnd: 4,        // s parado frente a alguien quieto, sin ningún lado libre: busca otro camino
  stuckYield: 1.2,   // s: camino a su puesto del corrillo, trabado así de rato se queda o busca otro puesto
  standoff: .4,      // s frente a frente trabados antes del desempate
  unstuck: .3,       // m: la cuenta de trabado solo se borra cuando de verdad avanzó esto desde donde se trabó
  wedged: 1,         // s trabados sin que el desempate los suelte: quien pasa se abre más allá de su tope
  letGo: .5,         // s con el otro lado libre: quien eligió un lado por donde no cabe lo suelta y pasa por el otro
  neckReach: 6,      // m: alguien quieto hasta aquí por delante, que lo obliga a salirse de su línea, puede ser un cuello
  neckSeek: 10,      // m: rodeando a un quieto, busca hasta aquí a quien viene de frente hacia él (más allá de `query`)
  neckHold: 1.2,     // m antes del quieto donde espera quien cede el cuello (antes de él, no a su lado)
  neckSlow: 3,       // m antes del quieto desde donde frena quien cede, si tiene que parar
  neckPace: .6,      // ritmo: si con bajar hasta aquí llega después del otro, no se para
  neckTie: .3,       // s: llegan al cuello con menos diferencia que esto: cede el de menor número
  neckWindow: 2.4,   // s: llegan con más diferencia que esto: no coinciden en el cuello
  neckMax: 8,        // s: un acuerdo de cuello que dura más que esto se suelta
  queueGap: 3.5,     // m: quien viene así de cerca detrás del que acaba de pasar, en su sentido, pasa con él (en fila)
  queueMax: 2,       // cuántos de la fila deja pasar quien cede, además del primero
  queueTime: 4,      // s desde que pasó el primero: después, el siguiente de la fila ya no pasa con ellos
  touchRoom: .25,    // m sobre el roce (dos cuerpos): desde ahí, un paso de lado que lo acerque a otro se acorta hasta nada
  groupGap: 1.8,     // m entre centros: dos quietos más juntos que esto no dejan pasar entre ellos (son un grupo)
  groupReach: 5,     // m: a un grupo de quietos que tiene así de cerca por delante ya decide por qué lado rodearlo
  groupSide: 2.4,    // m que se corre como mucho para rodear un grupo, si el andén da
  groupWait: 1,      // m del más cercano del grupo donde espera, si no hay por dónde pasar
  threadGap: 1.25,   // m entre centros de dos quietos lado a lado: con esto, si no hay por dónde rodear, pasa entre ellos
  threadSpeed: .5,   // m/s al pasar entre dos quietos, o justo al lado de uno
  threadWait: 2.2,   // m antes de los dos quietos donde espera a que salga del hueco el que viene de frente
  squeeze: .62,      // m entre centros: con esto pasa justo al lado de un quieto, despacio, si no hay más sitio
  groupBack: 10,     // m: frente a un grupo sin paso solo toma otra ruta si no lo devuelve más que esto
  groupPatience: 20, // s: esperando así, al final toma la otra ruta aunque lo devuelva (nadie espera para siempre)
  backMax: .3,       // m que se echa atrás como mucho quien cede en un desempate
  faceOff: 1.2,      // m entre centros: así de cerca cuenta como frente a frente
  backOff: .4,       // m/s del paso atrás de quien cede, si el otro le quedó encima
  closeRoom: .6,     // m entre centros: más cerca, quien cede se echa un poco atrás
  passClear: .6,     // m de lado: rodeando a un quieto, así de corrido de él ya no lo roza al pasarle
  umbrella: .25,     // m de más que pide quien lleva el paraguas abierto
  accel: 1.4,        // de ritmo por segundo al recuperar el paso
  brake: 3,          // de ritmo por segundo al frenar
  stopBrake: 6       // de ritmo por segundo al pararse en seco porque tiene a alguien encima (0,17 s, no de golpe)
};

/**
 * Máximo acercamiento entre dos que se mueven en línea recta. `rx, rz`: dónde está el otro respecto a uno;
 * `ux, uz`: su velocidad respecto a uno. Escribe en `out` el tiempo (0..horizon) y la distancia en ese momento,
 * y dónde queda el otro (`ex`, `ez`) en ese instante. Sin velocidad relativa, el momento es ahora.
 */
export function closestApproach(rx, rz, ux, uz, horizon, out) {
  const uu = ux * ux + uz * uz;
  let t = uu > 1e-6 ? -(rx * ux + rz * uz) / uu : 0;
  if (t < 0) t = 0;
  else if (t > horizon) t = horizon;
  out.t = t;
  out.ex = rx + ux * t;
  out.ez = rz + uz * t;
  out.dist = hypot(out.ex, out.ez);
  return out;
}

/**
 * Hacia qué lado se corre: +1 derecha, −1 izquierda. `fx, fz` es hacia dónde va y `ex, ez` dónde le queda el otro
 * al cruzarse. De frente (el otro a menos de `centered` de su línea) siempre a la derecha; si el otro ya pasa por un
 * lado, al contrario.
 */
export function chooseSide(fx, fz, ex, ez, centered = AVOID.headOn) {
  const lateral = ex * -fz + ez * fx; // + = el otro le queda a la derecha
  if (Math.abs(lateral) < centered) return 1;
  return lateral > 0 ? -1 : 1;
}

const _ca = { t: 0, dist: 0, ex: 0, ez: 0 };
const _seek = new Int32Array(32);

/**
 * El espacio que pide quien anda (`npc`, con su mente) con `agent`: el personal de los dos y los paraguas abiertos;
 * más con el jugador si le tiene recelo, y más con quien corre.
 */
function roomWith(mind, npc, agent, fast) {
  let want = AVOID.personal * 2 + (npc.stance === 'paraguas' ? AVOID.umbrella : 0) + (agent.stance === 'paraguas' ? AVOID.umbrella : 0);
  if (agent.isPlayer && mind.playerRoom > want) want = mind.playerRoom;
  if (fast && AVOID.runnerRoom > want) want = AVOID.runnerRoom;
  return want;
}

/** Lo más que se corre de su línea por `agent`: al jugador que le da recelo lo rodea más abierto, si el andén da. */
function sideLimit(mind, agent) {
  return agent.isPlayer && mind.playerRoom > AVOID.personal * 2 ? Math.max(AVOID.maxSide, mind.playerRoom) : AVOID.maxSide;
}

const _spot = new Int32Array(16);

/**
 * ¿Hay alguien parado (otro que `still`) en el sitio por donde le pasaría a `still` corrido a `side`? Ese lado está
 * ocupado: no cabe por ahí aunque el piso dé.
 */
function taken(mind, still, side) {
  const grid = mind.system?.grid, npc = mind.npc;
  if (!still || !grid) return false;
  const fx = mind._segX, fz = mind._segZ, delta = side - mind.side;
  const along = (still.position.x - npc.position.x) * fx + (still.position.z - npc.position.z) * fz;
  const x = npc.position.x + fx * along - fz * delta, z = npc.position.z + fz * along + fx * delta;
  const touch = AVOID.body * 2, n = grid.query(x, z, touch, _spot);
  for (let k = 0; k < n; k++) {
    const i = _spot[k], agent = grid.agents[i];
    if (!agent || agent === npc || agent === still || grid.speed[i] > .2 || Math.abs(agent.position.y - npc.position.y) > 1.5) continue;
    if (hypot(agent.position.x - x, agent.position.z - z) < touch) return true;
  }
  return false;
}

/**
 * Por dónde rodear a alguien quieto que está a `sl` m de su línea (+ derecha): el lado (m respecto a la línea) en que
 * le pasa a `want`. Si ya eligió (`prefer`: +1 por la derecha del quieto, −1 por la izquierda) y ese lado cabe, sigue
 * por ahí; si no, el que le pide menos paso de lado entre los que caben (`mind.roomFor`, y que no haya nadie parado
 * ahí: con `still`, el quieto, lo mira). NaN si no cabe por ninguno.
 */
export function passSide(mind, sl, want, limit, prefer = 0, still = null) {
  const right = sl + want, left = sl - want, lim = limit + 1e-6;
  const fits = value => Math.abs(value) <= lim && mind.roomFor(value) && !taken(mind, still, value);
  if (prefer > 0 && fits(right)) return right;
  if (prefer < 0 && fits(left)) return left;
  const near = Math.abs(right - mind.side) <= Math.abs(left - mind.side) ? right : left;
  const far = near === right ? left : right;
  if (fits(near)) return near;
  if (fits(far)) return far;
  return NaN;
}

/**
 * Lo mismo cuando no cabe holgado por ningún lado (una pared, un poste): el lado por donde le pasa justo, a `squeeze`
 * o más, sin tocarlo. Si caben los dos, el que ya eligió (`prefer`) o el más ancho (parejos, a su derecha); con `only`, solo vale el de
 * `prefer`. NaN si ni así.
 */
function squeezeSide(mind, sl, want, limit, prefer = 0, only = false, still = null) {
  const right = fit(mind, clamp(sl + want, limit)), left = fit(mind, clamp(sl - want, limit));
  const r = right - sl >= AVOID.squeeze && !taken(mind, still, right), l = sl - left >= AVOID.squeeze && !taken(mind, still, left);
  if (prefer > 0 && (r || only)) return r ? right : NaN;
  if (prefer < 0 && (l || only)) return l ? left : NaN;
  if (r && l) return right - sl >= sl - left - .1 ? right : left; // casi igual de anchos: a su derecha
  return r ? right : l ? left : NaN;
}

const _group = new Int32Array(8), _gq = new Int32Array(24);

/**
 * ¿Es `agent` (el de la rejilla en `i`) alguien quieto de verdad? El jugador parado, alguien sin ruta (mira, espera,
 * conversa), quien espera en el borde para cruzar, o quien va por su ruta a su paso pero tan despacio que casi no
 * avanza. Quien va por su ruta y bajó el paso o se paró un momento (cede, espera su turno) no cuenta: con ese vale la
 * esquiva de siempre y el desempate.
 */
function stillAt(grid, i) {
  const agent = grid.agents[i], mind = agent.mind;
  return grid.speed[i] <= .2 && !(mind && agent.target && !mind.waiting && mind.pace < .9);
}

/**
 * Dos o más quietos con menos hueco entre ellos del que deja pasar a una persona (una pareja que charla, dos que miran,
 * dos seguidos en la línea) son un solo estorbo: se rodean todos por el mismo lado. Junta en `_group` los quietos a
 * menos de `groupGap` de `still` o de otro del grupo (sin contar a `self`). El grupo es el mismo lo mire quien lo
 * mire. Devuelve cuántos son (1 si está solo).
 */
function groupOf(grid, still, self) {
  const n = grid.query(still.position.x, still.position.z, AVOID.groupGap * 3, _gq);
  let count = 0;
  for (let k = 0; k < n; k++) if (grid.agents[_gq[k]] === still) { _group[count++] = _gq[k]; break; }
  if (!count) return 0;
  for (let g = 0; g < count; g++) {
    const a = grid.agents[_group[g]];
    for (let k = 0; k < n && count < _group.length; k++) {
      const i = _gq[k], b = grid.agents[i];
      if (!b || b === self || !stillAt(grid, i) || Math.abs(b.position.y - a.position.y) > 1.5) continue;
      let seen = false;
      for (let h = 0; h < count && !seen; h++) seen = _group[h] === i;
      if (seen || hypot(b.position.x - a.position.x, b.position.z - a.position.z) >= AVOID.groupGap) continue;
      _group[count++] = i;
    }
  }
  return count;
}

/**
 * El grupo de `_group` visto por quien va en (`px`, `pz`) hacia (`fx`, `fz`) con su mente `mind`: deja en `_gr` el lado
 * más corrido a cada mano (m respecto a su línea), el más cercano y el más lejano por delante, y la distancia al más
 * cercano.
 */
const _gr = { lo: 0, hi: 0, along: 0, far: 0, near: 0 };
function frameGroup(mind, grid, count, px, pz, fx, fz) {
  _gr.lo = Infinity; _gr.hi = -Infinity; _gr.along = Infinity; _gr.far = -Infinity; _gr.near = Infinity;
  for (let g = 0; g < count; g++) {
    const a = grid.agents[_group[g]], rx = a.position.x - px, rz = a.position.z - pz;
    const along = rx * fx + rz * fz, lat = rx * -fz + rz * fx + mind.side;
    if (lat < _gr.lo) _gr.lo = lat;
    if (lat > _gr.hi) _gr.hi = lat;
    if (along < _gr.along) _gr.along = along;
    if (along > _gr.far) _gr.far = along;
    const d = hypot(rx, rz);
    if (d < _gr.near) _gr.near = d;
  }
}

/**
 * Por dónde rodear a un grupo de quietos (`groupOf`, visto con `frameGroup`): por fuera de todos, del lado en que cabe; si caben los dos,
 * por el que tenga más andén. Puede correrse más que `maxSide`, hasta donde haya andén de verdad (`mind.sidewalkFor`
 * hasta pasar el grupo), nunca a la calzada. Si con todo su espacio no cabe, prueba con el justo (`enough`). NaN si no
 * cabe por ningún lado.
 */
function passGroup(mind, want, prefer = 0) {
  const length = Math.max(1, _gr.far + 1), lim = AVOID.groupSide + 1e-6;
  const fits = value => Math.abs(value) <= lim && mind.roomFor(value) && mind.sidewalkFor(value, length);
  for (let k = 0; k < (want > AVOID.enough ? 2 : 1); k++) {
    const room = k ? AVOID.enough : want, right = _gr.hi + room, left = _gr.lo - room;
    if (prefer > 0 && fits(right)) return right;
    if (prefer < 0 && fits(left)) return left;
    const r = fits(right), l = fits(left);
    if (r && l) {
      // Los dos caben: por el que deja más andén del otro lado del paso (medio metro más allá), y si no, el más cercano.
      const rr = fits(right + .5), ll = fits(left - .5);
      if (rr !== ll) return rr ? right : left;
      return Math.abs(right - mind.side) <= Math.abs(left - mind.side) ? right : left;
    }
    if (r || l) return r ? right : left;
  }
  return NaN;
}

/** Suelta el acuerdo de cuello que tenga, para los dos. */
export function dropNeck(mind) {
  const other = mind.neckWith?.mind;
  if (other && other.neckWith === mind.npc) { other.neckWith = null; other.neckStill = null; }
  mind.neckWith = null; mind.neckStill = null;
}

function setNeck(mind, other, still, first, dir, queued = false) {
  mind.neckWith = other; mind.neckStill = still; mind.neckFirst = first; mind.neckDir = dir >= 0 ? 1 : -1;
  mind.neckSince = mind.system.time; mind.neckX = still.position.x; mind.neckZ = still.position.z;
  mind.neckQueued = queued; mind.neckLine = false;
}

/**
 * Quien cedía ya se cruzó con el que pasó primero: anota quién fue, por si detrás de él viene otro en fila. Si este
 * acuerdo ya era con uno de la fila, la fila sigue; si no, empieza ahora.
 */
function notePassed(yielder, passer, still) {
  if (yielder.neckQueued && yielder.queueStill === still) yielder.queueCount++;
  else { yielder.queueStill = still; yielder.queueSince = yielder.system.time; yielder.queueCount = 0; }
  yielder.queueAfter = passer;
}

/**
 * ¿Viene `npc` en fila detrás del que acaba de pasarle a `yielder` por el mismo quieto? A menos de `queueGap` del que
 * pasó, sin pasar de `queueMax` además del primero ni de `queueTime` desde que pasó el primero.
 */
function inQueue(yielder, npc, still) {
  const last = yielder.queueAfter;
  if (!last || last === npc || yielder.queueStill !== still || yielder.queueCount >= AVOID.queueMax ||
    yielder.system.time - yielder.queueSince > AVOID.queueTime) return false;
  return hypot(npc.position.x - last.position.x, npc.position.z - last.position.z) <= AVOID.queueGap;
}

/**
 * ¿Sigue el acuerdo de cuello? Se suelta cuando ya se cruzaron, si el quieto se movió, si el otro ya no está en la calle
 * o si se alargó demasiado. Al cruzarse, quien cedía anota quién pasó (la fila).
 */
function keepNeck(mind, npc, fx, fz) {
  const other = mind.neckWith;
  if (!other) return false;
  const sys = mind.system, om = other.mind, s = mind.neckStill;
  const alive = om?.neckWith === npc && om.seenFrame >= sys.frame - 1 && !other._disposed && sys.time - mind.neckSince < AVOID.neckMax &&
    hypot(s.position.x - mind.neckX, s.position.z - mind.neckZ) < .5;
  if (alive && (other.position.x - npc.position.x) * fx + (other.position.z - npc.position.z) * fz > 0) return true;
  if (alive) {
    if (mind.neckFirst) notePassed(om, npc, s);
    else notePassed(mind, other, s);
  }
  dropNeck(mind);
  return false;
}

/**
 * Un quieto (`still`, a `along` m por delante y `sl` m de su línea) y alguien que viene de frente (`other`): si los dos
 * lo tienen que rodear por el mismo lado y llegan casi a la vez, no caben juntos. El que ya está metido en el cuello
 * (más cerca del quieto que donde se espera) termina de pasar. Si no (o si ya van metidos los dos), quien acaba de
 * ceder deja pasar también al que viene en fila detrás del que pasó; y si no, pasa primero el que llega antes y, con
 * menos de `neckTie` de diferencia, cede el de menor número. El acuerdo queda
 * escrito en las dos mentes, así no dependen de que cada uno saque la misma cuenta en su cuadro.
 */
function formNeck(mind, npc, grid, fx, fz, speed, still, along, sl, want, other) {
  const om = other.mind, sys = mind.system;
  if (om.neckWith || om._steerFrame < sys.frame - 1) return;
  const gx = om._segX, gz = om._segZ;
  if (gx * fx + gz * fz > -.5) return; // no viene de frente
  const rx = still.position.x - other.position.x, rz = still.position.z - other.position.z;
  let oAlong = rx * gx + rz * gz, osl = rx * -gz + rz * gx + om.side;
  const oWant = roomWith(om, other, still, false);
  if (oAlong < .3 || Math.abs(osl) >= oWant) return; // ya lo pasó, o a él no le estorba
  // Un grupo de quietos es un solo cuello: cada uno lo rodea por fuera de todos, y cuenta desde el primero que tiene.
  const count = groupOf(grid, still, npc);
  let mine, theirs;
  if (count >= 2) {
    frameGroup(om, grid, count, other.position.x, other.position.z, gx, gz);
    theirs = passGroup(om, oWant); osl = (_gr.lo + _gr.hi) / 2; oAlong = _gr.along;
    frameGroup(mind, grid, count, npc.position.x, npc.position.z, fx, fz);
    mine = passGroup(mind, want); sl = (_gr.lo + _gr.hi) / 2; along = _gr.along;
  } else {
    const limit = sideLimit(mind, still), oLimit = sideLimit(om, still);
    const prefer = mind.sideLockAgent === still ? mind.roundSign : 0, oPrefer = om.sideLockAgent === still ? om.roundSign : 0;
    mine = passSide(mind, sl, want, limit, prefer, still); theirs = passSide(om, osl, oWant, oLimit, oPrefer, still);
    if (Number.isNaN(mine)) mine = squeezeSide(mind, sl, want, limit, prefer, false, still);
    if (Number.isNaN(theirs)) theirs = squeezeSide(om, osl, oWant, oLimit, oPrefer, false, still);
  }
  if (Number.isNaN(mine) || Number.isNaN(theirs)) return;
  // Por lados distintos del quieto no se estorban. De frente, la derecha de uno es la izquierda del otro.
  if ((mine - sl) * (theirs - osl) * (fx * gx + fz * gz) <= 0) return;
  const mineAt = along / Math.max(.3, speed), theirsAt = oAlong / Math.max(.3, other.walkSpeed ?? speed);
  if (Math.abs(mineAt - theirsAt) > AVOID.neckWindow) return;
  // Metido en el cuello: más cerca del quieto que el punto donde espera quien cede (con 10 cm de holgura, para que
  // quien ya espera ahí no cuente como metido).
  const mineIn = along < AVOID.neckHold - .1, theirsIn = oAlong < AVOID.neckHold - .1;
  let first, queued = false;
  if (mineIn !== theirsIn) first = mineIn;
  else if (inQueue(om, npc, still)) { first = true; queued = true; }
  else if (inQueue(mind, other, still)) { first = false; queued = true; }
  else first = mineAt < theirsAt - AVOID.neckTie ? true : theirsAt < mineAt - AVOID.neckTie ? false : mind.id > om.id;
  setNeck(mind, other, still, first, mine - sl, queued && !first);
  setNeck(om, npc, still, !first, theirs - osl, queued && first);
}

/**
 * Quien viene de frente con su mente, el más cercano hasta `radius`: el que rodea a un quieto lo busca más allá de los
 * vecinos de siempre, para acordar el cuello antes de salirse hacia un lado que después tendría que dejarle al otro.
 */
function comingFrom(npc, grid, fx, fz, radius) {
  const px = npc.position.x, pz = npc.position.z, n = grid.query(px, pz, radius, _seek);
  let best = null, bestD2 = radius * radius;
  for (let k = 0; k < n; k++) {
    const i = _seek[k], agent = grid.agents[i], oSpeed = grid.speed[i];
    if (agent === npc || !agent?.mind || oSpeed <= .3 || oSpeed > AVOID.runner) continue;
    if (Math.abs(agent.position.y - npc.position.y) > 1.5) continue;
    const rx = agent.position.x - px, rz = agent.position.z - pz, d2 = rx * rx + rz * rz;
    if (d2 >= bestD2 || rx * fx + rz * fz <= 0 || grid.vx[i] * fx + grid.vz[i] * fz >= -.5 * oSpeed) continue;
    best = agent; bestD2 = d2;
  }
  return best;
}

/**
 * Cede el cuello: se pone en la línea del quieto, para que el otro salga por el lado libre sin toparse con él, y llega
 * a `neckHold` antes del quieto cuando el otro ya pasó por ahí. Si le alcanza con bajar el paso hasta `neckPace`, solo
 * lo baja; si no, frena desde `neckSlow` y espera ahí. Ponerse detrás del quieto vale mientras todavía está a
 * `neckHold` o más; más cerca, ceder es quedarse en su lado. Esperar su turno no cuenta como estar trabado.
 */
function yieldNeck(mind, npc, grid, fx, fz, speed, closeAhead) {
  const s = mind.neckStill, other = mind.neckWith, om = other.mind;
  const rx = s.position.x - npc.position.x, rz = s.position.z - npc.position.z;
  let along = rx * fx + rz * fz, sl = rx * -fz + rz * fx + mind.side;
  // Con un grupo, espera antes del primero del grupo y a su sombra (entre el más corrido a cada mano).
  const count = groupOf(grid, s, npc);
  if (count >= 2) {
    frameGroup(mind, grid, count, npc.position.x, npc.position.z, fx, fz);
    along = _gr.along; sl = Math.min(_gr.hi, Math.max(_gr.lo, mind.side));
  }
  // Una vez que empezó a meterse detrás del quieto termina de hacerlo, aunque el paso lo haya arrimado un poco: a medio
  // camino quedaría atravesado en el lado por donde pasa el otro.
  if (along >= AVOID.neckHold) mind.neckLine = true;
  const inLine = mind.neckLine && along >= AVOID.neckHold - .3;
  mind.wantSide = inLine ? fit(mind, clamp(sl, sideLimit(mind, s))) : mind.side;
  // Mientras se corre sigue dando pasos cortos: cuenta con eso para no pasarse del punto donde espera.
  const toHold = along - AVOID.neckHold - .3 * Math.abs(mind.wantSide - mind.side);
  const theirsAt = ((s.position.x - other.position.x) * om._segX + (s.position.z - other.position.z) * om._segZ + AVOID.neckHold) /
    Math.max(.3, other.walkSpeed ?? speed);
  let pace = 0;
  if (toHold > 0) {
    const late = theirsAt > 0 ? toHold / (speed * theirsAt) : 1;
    pace = late >= AVOID.neckPace ? Math.min(1, late) : Math.min(1, Math.sqrt(toHold / (AVOID.neckSlow - AVOID.neckHold)));
  }
  mind.wantPace = closeAhead ? 0 : pace;
  mind.yielding = true;
  mind.blockedFor = 0;
  mind.blockerStill = false;
  mind.sideLock = mind.wantSide >= mind.side ? 1 : -1; mind.sideLockAgent = other; mind.sideHold = AVOID.hold;
}

/**
 * Decide el lado y el ritmo de este cuadro. `mind` guarda el estado (side, sideLock, blockedFor...) y responde
 * `roomFor(side)`: si correrse a ese lado es pisable. `fx, fz` es la dirección del tramo de su ruta y `speed` su
 * velocidad deseada. Deja en `mind.wantSide` el lado pedido (m respecto a la línea de su ruta), en `mind.wantPace`
 * el ritmo (0..1), en `mind.dodging` si se quita del camino de alguien que corre y en `mind.yielding` si cede.
 */
export function avoid(mind, grid, fx, fz, speed, dt) {
  const npc = mind.npc, px = npc.position.x, pz = npc.position.z;
  const out = mind.system.neighbors;
  const n = grid.query(px, pz, AVOID.runnerQuery, out);
  const vx = fx * speed, vz = fz * speed;
  let facingOn = false, first = 2, urgent = Infinity, side = 0, need = 0, blocker = null, closeAhead = false, closeStill = false, pass = NaN, passAlong = 0, passLat = 0;
  let runner = false, cooperates = false, sameWay = false, leads = false, follow = 1, room2 = 0, dist = 0, blockerSpeed = 0, near = 0, blockerAlong = 0;
  let prefer = 0, behind = false, behindAlong = 0, behindLat = 0; // el que estorba cede un cuello y va en su mismo sentido
  // stay: ya casi a la altura de un quieto y corrido hacia un lado (+1 su derecha, −1 su izquierda): sigue por ese.
  // beside: además ya le pasa sin rozarlo.
  let blockerIsStill = false, stay = 0, beside = false;
  // Para el cuello: el quieto más cercano que tiene por delante y lo obliga a salirse de su línea, y el más cercano de
  // los que vienen de frente.
  let still = null, stillAlong = Infinity, stillLat = 0, stillWant = 0, coming = null, comingD2 = Infinity;
  const pact = keepNeck(mind, npc, fx, fz) ? mind.neckWith : null;
  for (let k = 0; k < n; k++) {
    const i = out[k], agent = grid.agents[i];
    if (agent === npc || !agent) continue;
    const rx = agent.position.x - px, rz = agent.position.z - pz, d2 = rx * rx + rz * rz;
    if (d2 < 1e-8 || d2 > AVOID.runnerQuery * AVOID.runnerQuery) continue;
    const fast = grid.speed[i] > AVOID.runner;
    // Al jugador que le da recelo lo tiene en cuenta desde más lejos, para rodearlo abierto con tiempo.
    if (!fast && d2 > AVOID.query * AVOID.query && !(agent.isPlayer && mind.playerRoom > 0)) continue;
    if (Math.abs(agent.position.y - npc.position.y) > 1.5) continue; // otro piso: el tablero, una escalera
    const d = Math.sqrt(d2);
    const touching = d < AVOID.body * 2;
    const along = rx * fx + rz * fz, lat = rx * -fz + rz * fx; // lat: + = le queda a la derecha
    const front = along / d;
    if (front < AVOID.ahead && !touching) continue;
    // Alguien encima y en su camino: se detiene, pase lo que pase con la cuenta.
    const facing = d < AVOID.stop && front > .4 && Math.abs(lat) < AVOID.body * 2;
    if (facing) { closeAhead = true; if (grid.speed[i] <= .3) closeStill = true; }
    const ovx = grid.vx[i], ovz = grid.vz[i], oSpeed = grid.speed[i];
    const want = roomWith(mind, npc, agent, fast);
    const isStill = !fast && stillAt(grid, i);
    if (isStill && along > .3 && along <= AVOID.neckReach && along < stillAlong && Math.abs(lat + mind.side) < want) {
      still = agent; stillAlong = along; stillLat = lat + mind.side; stillWant = want;
    }
    if (!fast && agent.mind && oSpeed > .3 && along > 0 && ovx * fx + ovz * fz < -.5 * oSpeed && d2 < comingD2) { coming = agent; comingD2 = d2; }
    // Con otro que viene de frente por su ruta no cuenta el paso de lado que el otro esté dando: si cada uno le
    // descontara al otro lo que se corre, uno solo terminaría corriéndose todo. Cuenta por dónde viene.
    const am = agent.mind;
    const headOn = !fast && !!am && oSpeed > .3 && am._steerFrame >= mind.system.frame - 1 && am._segX * fx + am._segZ * fz < -.8;
    const along2 = headOn ? ovx * am._segX + ovz * am._segZ : 0;
    const wx = headOn ? am._segX * along2 : ovx, wz = headOn ? am._segZ * along2 : ovz;
    closestApproach(rx, rz, wx - vx, wz - vz, agent.isPlayer && mind.playerRoom > AVOID.personal * 2 ? AVOID.waryHorizon : AVOID.horizon, _ca);
    if (_ca.dist >= want - AVOID.slack && !touching) continue;
    // Quien lo tiene parado (encima y por delante) es quien le estorba, antes que cualquier cuenta; entre dos así, el
    // más cercano.
    const t = touching || facing ? 0 : _ca.t, rank = facing ? 0 : 1;
    if (rank > first || rank === first && (t > urgent || t === urgent && (!facing || d >= near))) continue;
    first = rank; urgent = t; blocker = agent; facingOn = headOn; room2 = want; dist = _ca.dist; blockerSpeed = oSpeed; near = d; blockerAlong = along;
    need = want - _ca.dist;
    runner = fast;
    pass = NaN;
    blockerIsStill = isStill;
    if (fast) {
      // Le abre paso hacia el lado de la línea del que corre en que ya está.
      const ux = ovx / oSpeed, uz = ovz / oSpeed;
      const onRight = rx * uz - rz * ux >= 0;                 // uno queda a la derecha del que corre
      const ax = onRight ? -uz : uz, az = onRight ? ux : -ux; // hacia afuera de su línea
      side = ax * -fz + az * fx >= 0 ? 1 : -1;
      if (need < .4) need = .4;
      cooperates = false; sameWay = false; leads = false; follow = 1; behind = false; beside = false; stay = 0;
    } else {
      beside = false; stay = 0;
      // Encima ya no hay tiempo de cruzarse de lado los dos a su derecha: se aparta de donde le queda el otro. En un
      // cuello en que pasa primero, se aparta hacia su lado libre.
      side = agent === pact && mind.neckFirst ? mind.neckDir
        : mind.sideLockAgent === agent && mind.sideLock ? mind.sideLock
          : chooseSide(fx, fz, _ca.ex, _ca.ez, d < AVOID.faceOff ? AVOID.centered : AVOID.headOn);
      // A alguien quieto lo rodea por el lado en que cabe, aunque sea el contrario.
      if (isStill) {
        // Ya casi a su altura y corrido hacia un lado: sigue por ese lado aunque le quede menos espacio, y nunca hacia
        // él. Cruzarle por delante para pasar por el otro sería meterle el cuerpo encima; solo lo hace si todavía le
        // queda con qué (no lo roza al cruzar) y por su lado no pasa ni justo.
        const limit = sideLimit(mind, agent);
        stay = along < AVOID.stop && Math.abs(lat) >= AVOID.centered ? (lat < 0 ? 1 : -1) : 0;
        if (stay && along >= AVOID.body * 2 + .06 && Number.isNaN(squeezeSide(mind, lat + mind.side, want, limit, stay, true, agent))) stay = 0;
        prefer = agent === mind.neckStill && mind.neckFirst ? mind.neckDir : mind.sideLockAgent === agent ? mind.roundSign : 0;
        pass = passSide(mind, lat + mind.side, want, limit, stay || prefer, agent);
        if (stay && !((pass - lat - mind.side) * stay > 0)) {
          let most = fit(mind, clamp(lat + mind.side + stay * want, limit));
          // Si ni así le pasa sin rozarlo (se le metió al lado), se corre un poco más de la cuenta, si el andén da.
          if ((most - lat - mind.side) * stay < AVOID.squeeze) {
            const more = clamp(lat + mind.side + stay * AVOID.squeeze, limit + AVOID.extraSide);
            if (mind.roomFor(more) && mind.sidewalkFor(more, 1)) most = more;
          }
          pass = stay > 0 ? Math.max(mind.side, most) : Math.min(mind.side, most);
        }
        // Y si ya no lo tiene por delante (va a su lado): sigue andando por ahí.
        beside = stay !== 0 && !facing;
        passAlong = along; passLat = lat + mind.side;
        if (!Number.isNaN(pass) && Math.abs(pass - mind.side) > 1e-3) side = pass > mind.side ? 1 : -1;
      }
      const toward = ovx * fx + ovz * fz;
      // Dos que se esquivan de frente reparten: cada uno pone la mitad. Con alguien quieto, o a quien no le cabe
      // correrse, todo es suyo.
      cooperates = !!agent.mind && oSpeed > .2 && toward < 0 && !agent.mind.cramped;
      sameWay = oSpeed > .2 && toward / oSpeed > .5;
      leads = oSpeed > .05 && toward / oSpeed > .5; // va adelante en su mismo sentido, aunque sea muy despacio
      follow = sameWay ? Math.max(0, Math.min(1, toward / Math.max(.1, speed))) : 1;
      if (cooperates) need *= .5;
      const om = agent.mind;
      behind = !!om?.neckWith && !om.neckFirst && along > 0 && om._segX * fx + om._segZ * fz > .5;
      behindAlong = along; behindLat = lat + mind.side;
      if (behind) follow = Math.max(0, Math.min(1, toward / Math.max(.1, speed)));
    }
  }
  // Un grupo de quietos (una pareja que charla) se decide temprano: a `groupReach` ya elige por qué lado rodearlos a
  // todos. Si no cabe por ningún lado y son dos lado a lado con hueco, pasa entre ellos despacio; si no, espera a un
  // metro del más cercano. Con un grupo no hay acuerdo de cuello: ese es de un solo quieto.
  let group = 0, thread = NaN, closed = false, tight = false, turn = false, gAlong = 0, gNear = 0, gFar = 0;
  // beyond: quien le estorba es otro que anda y viene de más allá de un quieto que tiene cerca por delante.
  const ahead = still && stillAlong <= AVOID.groupReach ? still : null;
  const beyond = !!blocker && !blockerIsStill && !runner && !!ahead && stillAlong < blockerAlong;
  const gStill = blocker ? (blockerIsStill && !runner ? blocker : beyond ? ahead : null) : ahead;
  if (gStill) group = groupOf(grid, gStill, npc);
  if (group >= 2) frameGroup(mind, grid, group, px, pz, fx, fz);
  // Si al grupo lo puede rodear, con el que viene de más allá se esquiva como siempre. Si solo queda el hueco entre
  // ellos, o nada, primero es el grupo: no se le echa encima por esquivar al otro, y al otro le deja el turno.
  if (group >= 2 && beyond && !Number.isNaN(passGroup(mind, stillWant))) group = 0;
  // Dos lado a lado con hueco para una persona: se puede pasar entre ellos, por el medio.
  let gap = NaN;
  if (group === 2) {
    const a = grid.agents[_group[0]].position, b = grid.agents[_group[1]].position;
    const open = hypot(a.x - b.x, a.z - b.z), mid = (_gr.lo + _gr.hi) / 2;
    if (open >= AVOID.threadGap && Math.abs(_gr.hi - _gr.lo) >= .8 * open && Math.abs(mid) <= AVOID.groupSide && mind.roomFor(mid)) gap = mid;
  }
  // Ya a la altura de uno del grupo: si le va pasando por fuera, sigue por ese lado como con un quieto solo; si va por
  // el hueco entre dos, sigue por el medio (no se le arrima a uno por abrirse del otro).
  const inside = beside && !Number.isNaN(gap) && mind.side > _gr.lo && mind.side < _gr.hi;
  if (beside && !inside) group = 0;
  if (group >= 2) {
    beside = false;
    gAlong = _gr.along; gNear = _gr.near; gFar = _gr.far;
    const want = blocker && !beyond ? room2 : stillWant;
    // Ya eligió lado con este grupo (o pasa primero en su cuello): sigue por ahí si cabe.
    let prefer = 0;
    for (let g = 0; g < group; g++) {
      const a = grid.agents[_group[g]];
      if (a === mind.neckStill && mind.neckFirst) prefer = mind.neckDir;
      else if (a === mind.sideLockAgent && !prefer) prefer = mind.roundSign;
    }
    if (!blocker || beyond) {
      blocker = gStill; room2 = want; urgent = stillAlong / Math.max(.3, speed); dist = Math.abs(stillLat); blockerSpeed = 0; near = _gr.near;
      cooperates = false; sameWay = false; follow = 1; blockerIsStill = true; facingOn = false; behind = false;
    }
    pass = inside ? NaN : passGroup(mind, want, prefer);
    if (!Number.isNaN(pass)) {
      passAlong = _gr.along; passLat = pass > (_gr.lo + _gr.hi) / 2 ? _gr.hi : _gr.lo;
      side = pass > mind.side ? 1 : -1;
    } else thread = gap;
    closed = Number.isNaN(pass) && Number.isNaN(thread);
  }
  mind.blockerGroup = closed; // un grupo sin paso (un quieto solo que cierra el paso se decide más abajo)
  // Ya rodeando al quieto y sin nadie de frente a la vista: el que llega a la vez está a unos dos tramos de distancia.
  if (!pact && still && !coming && blocker === still) coming = comingFrom(npc, grid, fx, fz, Math.min(AVOID.neckSeek, 2 * stillAlong + 1));
  if (!pact && still && coming) formNeck(mind, npc, grid, fx, fz, speed, still, stillAlong, stillLat, stillWant, coming);
  mind.dodging = runner;
  mind.yielding = false;
  mind.passing = false;
  mind.backOff = false;
  mind.cramped = false;
  mind.rounding = false;
  mind.brisk = false;
  mind.hardStop = closeAhead && !runner;
  if (mind.neckWith && !mind.neckFirst && (!blocker || blocker === mind.neckWith || blocker === mind.neckStill)) {
    yieldNeck(mind, npc, grid, fx, fz, speed, closeAhead);
    return;
  }
  if (behind && !runner) {
    // Detrás de quien cede un cuello, en su mismo sentido: hace fila a su espalda (en la línea del quieto, así deja libre
    // el lado por donde pasa el otro) y a un metro, y sigue cuando él siga. Esperar en la fila no es estar trabado.
    mind.wantSide = behindAlong > AVOID.faceOff ? fit(mind, clamp(behindLat, sideLimit(mind, blocker))) : mind.side;
    mind.wantPace = closeAhead ? 0 : Math.min(1, Math.max(follow, (behindAlong - 1) / 1.5));
    mind.yielding = true;
    mind.blockedFor = 0;
    mind.blockerStill = false;
    mind.sideLock = mind.wantSide >= mind.side ? 1 : -1; mind.sideLockAgent = blocker; mind.sideHold = AVOID.hold;
    return;
  }
  if (!blocker) {
    // Nadie en el camino: conserva el lado un rato (y con quién lo eligió: si vuelve a estorbarle en ese rato, se
    // corre para el mismo lado, no para el que le copia al otro) y después vuelve despacio a su línea.
    // Parado porque tiene a alguien quieto encima, aunque la esquiva ya no lo cuente como estorbo: sigue trabado.
    mind.blockerStill = mind.hardStop && closeStill;
    stuckClock(mind, mind.blockerStill, dt, px, pz);
    // Con quien se cruza de frente el lado no se vence por reloj: lo sostiene hasta que se cruzaron (el otro ya quedó
    // medio metro atrás) y entonces vuelve a su línea. Si el otro cambió de rumbo o se fue, también lo suelta.
    const met = mind.headOnWith, mm = met?.mind;
    if (met) {
      const rx = met.position.x - px, rz = met.position.z - pz;
      if (mm && !met._disposed && mm.seenFrame >= mind.system.frame - 1 && rx * fx + rz * fz > -.5 &&
        rx * rx + rz * rz < AVOID.query * AVOID.query && mm._segX * fx + mm._segZ * fz < -.5) {
        mind.wantSide = mind.side;
        mind.wantPace = closeAhead ? 0 : 1;
        return;
      }
      mind.headOnWith = null; mind.sideHold = 0;
    }
    mind.sideHold -= dt;
    if (mind.sideHold <= 0) { mind.sideLock = 0; mind.sideLockAgent = null; }
    mind.wantSide = mind.sideHold > 0 ? mind.side : 0;
    mind.wantPace = closeAhead ? 0 : 1;
    return;
  }
  mind.headOnWith = facingOn ? blocker : null;
  mind.sideLock = side; mind.sideLockAgent = blocker;
  mind.sideHold = AVOID.hold;
  mind.roundSign = Number.isNaN(pass) ? 0 : pass >= passLat ? 1 : -1;
  const limit = sideLimit(mind, blocker);
  let target;
  if (!Number.isNaN(pass)) target = pass; // un quieto con un lado libre: hasta ahí, que ya se sabe que cabe
  else if (!Number.isNaN(thread)) target = thread; // entre los dos de un grupo, por el medio
  else if (closed) target = mind.side; // un grupo sin paso: no se arrima a ninguno mientras espera
  else if (blockerIsStill && !runner) {
    // Un quieto sin sitio holgado por ningún lado (una pared, un poste): mira los dos y, si por alguno pasa sin
    // tocarlo, va por ese (y sigue por ese: no cambia de idea a mitad de camino). Si no, está cerrado: espera sin
    // arrimársele.
    const best = squeezeSide(mind, passLat, room2, limit, stay || prefer, stay !== 0, blocker);
    mind.cramped = true;
    if (Number.isNaN(best)) { closed = true; target = mind.side; }
    else { target = best; tight = true; mind.roundSign = best >= passLat ? 1 : -1; mind.sideLock = mind.roundSign; }
  } else {
    // ¿Cabe? Si no, lo más que quepa (`fit`); si nada, sigue en su línea y cede o se acomoda.
    target = fit(mind, clamp(mind.side + side * need, limit));
    if (Math.abs(target - mind.side) < Math.abs(side * need) - .05) mind.cramped = true;
    // Por el lado que eligió no le cabe pasarle a uno que va adelante en su mismo sentido, más despacio. El lado es
    // firme mientras lo que lo hizo elegirlo siga ahí (no vacila); pero si el otro lado ya lleva `letGo` libre, lo
    // suelta y pasa por ese. Con quien viene de frente o está parado cediendo no: ahí cambiar de lado es copiarse.
    if (mind.cramped && leads) {
      const across = (blocker.position.x - px) * -fz + (blocker.position.z - pz) * fx + mind.side - side * room2;
      if (Math.abs(across) <= limit && mind.roomFor(across) && sideClear(mind, npc, grid, n, blocker, across, fx, fz)) {
        const frame = mind.system.frame;
        mind.freeFor = mind.freeFrame === frame - 1 ? mind.freeFor + dt : 0;
        mind.freeFrame = frame;
        if (mind.freeFor >= AVOID.letGo) { side = -side; mind.sideLock = side; target = across; mind.cramped = false; }
      }
    }
  }
  // Frente a frente y trabados: el desempate (ver arriba). Solo entre dos que se tienen el uno al otro por delante, y
  // no entre dos que ya tienen un acuerdo de cuello.
  const other = blocker.mind;
  if (other && !runner && !sameWay && near < AVOID.faceOff && other.sideLockAgent === npc && blocker !== mind.neckWith &&
    (mind.blockedFor > AVOID.standoff || other.blockedFor > AVOID.standoff)) {
    // El que pasa se aparta de una todo lo que hace falta, hacia donde ya está respecto al otro (nadie se le cruza por
    // delante al otro, así no se copian); derecho de frente, a su derecha.
    const lat = (blocker.position.x - px) * -fz + (blocker.position.z - pz) * fx; // + = el otro a su derecha
    const away = lat > .05 ? -1 : 1, full = Math.max(0, room2 - Math.abs(lat));
    target = fit(mind, clamp(mind.side + away * full, limit));
    // Si con eso todavía se rozan (ya iba arrimado a su tope) y el otro tampoco logró apartarse (siguen trabados), se
    // abre un poco más de la cuenta, si el andén da.
    if (mind.blockedFor > AVOID.wedged && Math.abs(lat) + Math.abs(target - mind.side) < AVOID.enough) {
      const more = clamp(mind.side + away * full, limit + AVOID.extraSide);
      if (mind.roomFor(more) && mind.sidewalkFor(more, 1)) target = more;
    }
    mind.sideLock = away;
    mind.passing = true;
    if (mind.id < other.id) {
      // Cede: se queda donde está y no avanza hasta que el otro pase (si al otro no le cabe correrse, se aparta él
      // también, para el lado contrario); con el otro encima, se echa un poco atrás.
      mind.yielding = true;
      if (!other.cramped) target = mind.side;
      mind.backOff = near < AVOID.closeRoom;
      mind.wantSide = target;
      mind.wantPace = 0;
      mind.blockerStill = blockerSpeed <= .3;
      if (mind.blockerStill) mind.blockedFor += dt; // mientras el otro se mueve, espera tranquilo
      return;
    }
  }
  // La distancia a la que va a pasar si logra correrse lo que pide (de frente, lo corrido se suma entero).
  const passes = dist + Math.abs(target - mind.side) * (cooperates ? 2 : 1);
  const soon = Math.min(1, urgent / AVOID.yieldTime);
  let pace = 1;
  if (runner) pace = soon * .4;                        // a quien corre se le cede, haya sitio o no
  else if (group >= 2 && !Number.isNaN(pass)) pace = 1; // un grupo con un lado libre: por ahí, ya se sabe que cabe
  else if (sameWay) pace = passes >= AVOID.enough ? 1 : follow; // detrás de alguien: adelanta o va a su paso
  else if (passes >= Math.min(room2, AVOID.enough + .2)) pace = 1;
  else if (passes >= AVOID.enough) pace = Math.max(.6, soon);
  else {
    // No alcanza a correrse: entre dos que van andando por su ruta cede el de menor número (frena hasta parar) y el
    // otro solo baja el paso, aunque el que cede ya vaya despacio. Con alguien quieto o que no esquiva, cede uno.
    // Quien espera en el borde del andén para cruzar tiene a dónde ir, pero está quieto: a ese se le cede. En un
    // cuello manda el acuerdo.
    const walking = !!blocker.mind && !!blocker.target && !(blocker.fleeTimer > 0) && !blocker.mind.waiting;
    const yields = blocker === mind.neckWith ? !mind.neckFirst : !walking || mind.id < blocker.mind.id;
    mind.yielding = yields;
    pace = yields ? soon * .3 : Math.max(.45, soon);
  }
  // Rodeando a un quieto por su lado libre: se corre a paso de esquivar y no llega a su altura antes de estar a
  // `passClear` de él de ese lado.
  if (beside) {
    // Ya pasándole al lado con lo que cabe: sigue, despacio si va justo, sin pararse a su lado.
    mind.rounding = true;
    mind.yielding = false;
    pace = Math.max(pace, .5);
  } else if (!Number.isNaN(pass)) {
    mind.rounding = true;
    const toward = pass >= passLat ? 1 : -1;
    const left = (passLat + toward * AVOID.passClear - mind.side) * toward;
    if (left > 0) pace = Math.min(pace, Math.max(0, (passAlong - AVOID.personal) / (Math.max(.3, speed) * left / AVOID.roundRate)));
  } else if (!Number.isNaN(thread)) {
    // Entre dos quietos: derecho por el medio y despacio (`threadSpeed`), y no se mete antes de estar centrado.
    mind.yielding = false;
    mind.rounding = true;
    pace = Math.min(1, AVOID.threadSpeed / Math.max(.3, speed) + Math.max(0, gAlong - AVOID.faceOff) / 2);
    const off = Math.abs(thread - mind.side);
    if (off > .05) pace = Math.min(pace, Math.max(0, (gAlong - AVOID.personal) / (Math.max(.3, speed) * off / AVOID.roundRate)));
    // Por el hueco cabe uno. Si de frente viene otro por ahí mismo y llega antes (o ya va metido), le deja el hueco: lo
    // espera a un par de metros, con sitio para esquivarse cuando salga. A la par, espera el de menor número. Quien ya
    // está entrando no espera. Esperar el turno no es estar trabado.
    if (coming && gAlong > AVOID.faceOff) {
      const cx = coming.position.x - px, cz = coming.position.z - pz, theirs = cx * fx + cz * fz - gFar;
      const near = Math.abs(cx * -fz + cz * fx + mind.side - thread) < 1 && theirs < AVOID.neckReach;
      if (near && (theirs < gAlong - .2 || theirs <= gAlong + .2 && mind.id < coming.mind.id)) {
        turn = true;
        mind.yielding = true;
        pace = Math.min(pace, Math.max(0, (gAlong - AVOID.threadWait) / 1.5));
      }
    }
  } else if (tight) {
    // Al lado de un quieto con menos sitio del que quisiera: si es poco menos, baja el paso; si va justo, despacio. Y
    // sin llegar a su altura antes de correrse.
    mind.yielding = false;
    mind.rounding = true;
    pace = Math.abs(target - passLat) >= AVOID.enough ? Math.max(.6, soon)
      : Math.min(1, AVOID.threadSpeed / Math.max(.3, speed) + Math.max(0, passAlong - AVOID.faceOff) / 2);
    const toward = target >= passLat ? 1 : -1;
    const left = (passLat + toward * AVOID.passClear - mind.side) * toward;
    if (left > 0) pace = Math.min(pace, Math.max(0, (passAlong - AVOID.personal) / (Math.max(.3, speed) * left / AVOID.roundRate)));
  } else if (closed) {
    // Cerrado (un quieto o un grupo sin paso): se acerca hasta `groupWait` del más cercano y ahí espera.
    mind.yielding = true;
    pace = Math.min(1, Math.max(0, ((group >= 2 ? gNear : near) - AVOID.groupWait) / .8));
  }
  if (closeAhead && !runner) pace = 0;
  // Trabado: frenado del todo. Ceder a quien se mueve o esperar el turno en un hueco no cuenta. El reloj sirve para el
  // desempate (`standoff`) y, si el que estorba está quieto, para buscar otro camino (`deadEnd`).
  mind.blockerStill = blockerSpeed <= .3;
  stuckClock(mind, pace < .25 && !turn && !(mind.yielding && !mind.blockerStill), dt, px, pz);
  // Con el otro ya encima, o si con el paso suave ya no alcanza a correrse antes de cruzarse, se corre con decisión.
  mind.brisk = !runner && (near < AVOID.faceOff || urgent < Math.abs(target - mind.side) / AVOID.sideRate + .3);
  mind.wantSide = target;
  mind.wantPace = pace;
}

const clamp = (value, limit) => (value > limit ? limit : value < -limit ? -limit : value);

/**
 * ¿Está libre el carril `across` (corrimiento sobre su línea) por delante? No cuenta `blocker` ni quien ya quedó
 * atrás; sí cualquier otro, ande o no, que tenga hasta `query` por delante a menos de dos espacios personales de ahí.
 * Mira los `n` vecinos que `avoid` acaba de consultar.
 */
function sideClear(mind, npc, grid, n, blocker, across, fx, fz) {
  const px = npc.position.x, pz = npc.position.z, out = mind.system.neighbors;
  for (let k = 0; k < n; k++) {
    const agent = grid.agents[out[k]];
    if (!agent || agent === npc || agent === blocker) continue;
    if (Math.abs(agent.position.y - npc.position.y) > 1.5) continue;
    const rx = agent.position.x - px, rz = agent.position.z - pz, along = rx * fx + rz * fz;
    if (along < -.5 || along > AVOID.query) continue;
    if (Math.abs(rx * -fz + rz * fx + mind.side - across) < AVOID.personal * 2) return false;
  }
  return true;
}

/**
 * La cuenta de trabado. Sube mientras está frenado del todo (`held`) y no se borra por un respiro: con el otro justo a
 * la distancia de parada, «lo tengo encima» se prende y se apaga de un cuadro a otro, y si cada vez volviera a cero dos
 * parados frente a frente no llegarían nunca al desempate ni a buscar otro camino. Solo se borra cuando de verdad
 * avanzó `unstuck` desde donde se trabó.
 */
function stuckClock(mind, held, dt, px, pz) {
  if (held) {
    if (!(mind.blockedFor > 0)) { mind.stuckX = px; mind.stuckZ = pz; }
    mind.blockedFor += dt;
  } else if (mind.blockedFor > 0) {
    const dx = px - mind.stuckX, dz = pz - mind.stuckZ;
    if (dx * dx + dz * dz > AVOID.unstuck * AVOID.unstuck) mind.blockedFor = 0;
  }
}

/**
 * Lo pedido si cabe o, si no, lo más que quepa entre donde está y lo pedido (cuatro pasos de bisección: en un pasillo
 * angosto se arrima hasta la pared, menos dos dedos: pegado al borde mismo, el paso siguiente ya no sería pisable); si
 * nada, se queda donde está.
 */
function fit(mind, target) {
  if (mind.roomFor(target)) return target;
  let fits = mind.side, over = target;
  for (let k = 0; k < 4; k++) { const mid = (fits + over) / 2; if (mind.roomFor(mid)) fits = mid; else over = mid; }
  const edge = fits + (over > fits ? -.02 : .02);
  return (edge - mind.side) * (fits - mind.side) > 0 ? edge : mind.side;
}

const _near = new Int32Array(32);

/**
 * La red de seguridad de todo paso de lado, venga de donde venga (ceder, rodear, el desempate, volver a su línea):
 * ninguno le mete el cuerpo encima a otro, esté quieto o ande (a quien corre se le quita del camino como sea).
 * Devuelve qué parte del paso (`dx`, `dz`) puede dar `npc`: entero si no lo acerca a nadie que tenga a menos de un roce
 * más `touchRoom`; si lo acerca, cada vez menos cuanto más cerca esté, y nada cuando ya se tocan. Alejarse siempre se
 * puede.
 */
export function sideStepRoom(grid, npc, dx, dz) {
  const px = npc.position.x, pz = npc.position.z, touch = AVOID.body * 2, reach = touch + AVOID.touchRoom;
  const n = grid.query(px, pz, reach, _near);
  let part = 1;
  for (let k = 0; k < n; k++) {
    const i = _near[k], agent = grid.agents[i];
    if (agent === npc || !agent || grid.speed[i] > AVOID.runner) continue;
    if (Math.abs(agent.position.y - npc.position.y) > 1.5) continue;
    const rx = agent.position.x - px, rz = agent.position.z - pz, d2 = rx * rx + rz * rz;
    if (d2 >= reach * reach || d2 < 1e-8) continue;
    // Lo acerca si el paso va hacia él (a menos de unos 70°): con alguien justo delante, un paso de lado no lo acerca.
    const d = Math.sqrt(d2), toward = rx * dx + rz * dz;
    if (toward <= .35 * d * Math.sqrt(dx * dx + dz * dz)) continue;
    const room = (d - touch) / AVOID.touchRoom;
    if (room < part) part = room > 0 ? room : 0;
  }
  return part;
}

/**
 * Un paso de lado de `mind.side` hacia `target`: sin pasar de `rate` m/s y sin quiebres, arranca y frena con `accel`
 * m/s² (llega a su sitio ya sin velocidad, y no se pasa). La velocidad lateral queda en `mind.sideVel`. Devuelve el nuevo lado.
 */
export function easeSide(mind, target, rate, accel, dt) {
  const left = target - mind.side, far = Math.abs(left);
  if (far < 1e-4 && Math.abs(mind.sideVel) <= accel * dt) { mind.sideVel = 0; return target; }
  // La velocidad con que todavía alcanza a frenar antes de llegar.
  const cruise = Math.min(rate, Math.sqrt(2 * accel * far)) * (left >= 0 ? 1 : -1);
  // Si viene más rápido de lo que ahí le toca (venía de un paso brusco, o le cambiaron el sitio), frena con firmeza: no
  // se pasa de largo.
  const over = cruise * mind.sideVel < 0 || Math.abs(mind.sideVel) > Math.abs(cruise);
  mind.sideVel = approach(mind.sideVel, cruise, over && accel < AVOID.roundAccel ? AVOID.roundAccel : accel, dt);
  const step = mind.sideVel * dt;
  if (step * left > 0 && Math.abs(step) >= far) { mind.sideVel = 0; return target; }
  return mind.side + step;
}

/** Lleva `current` hacia `target` sin pasar de `rate` por segundo. */
export function approach(current, target, rate, dt) {
  const step = rate * dt;
  if (target > current + step) return current + step;
  if (target < current - step) return current - step;
  return target;
}

/**
 * ¿Lo va a llevar por delante alguien que corre? Para quien está parado: devuelve el sentido (+1/−1, sobre la
 * perpendicular a la carrera) en que se aparta, o 0 si no hace falta. `out` recibe la dirección de escape.
 */
export function runnerThreat(px, pz, ax, az, vx, vz, out) {
  const speed = hypot(vx, vz);
  if (speed < AVOID.runner) return 0;
  const rx = px - ax, rz = pz - az; // uno respecto al que corre
  const ux = vx / speed, uz = vz / speed;
  const along = rx * ux + rz * uz;
  if (along < 0 || along > speed * AVOID.yieldTime + .5) return 0; // ya pasó, o le falta mucho
  const lateral = rx * -uz + rz * ux; // + = uno queda a la derecha del que corre
  if (Math.abs(lateral) > AVOID.runnerRoom) return 0;
  const sign = lateral >= 0 ? 1 : -1;
  out.x = -uz * sign; out.z = ux * sign;
  out.need = AVOID.runnerRoom - Math.abs(lateral);
  return sign;
}
