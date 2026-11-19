import { pathClear, sightClear } from './room.js';

const WALK_STEP = .25;
export const CONVERSATION_FLOOR_GAP = .45;
const PASSER_HEIGHT = 1;
const OPEN_GAP = 2;
const _sample = { x: 0, z: 0 };

export const onSidewalk = (npc, point = npc.position) => npc.navigation?.isSidewalkAt?.(point) ?? true;

function alongSidewalk(npc, from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / WALK_STEP));
  for (let i = 1; i <= steps; i++) {
    _sample.x = from.x + dx * i / steps;
    _sample.z = from.z + dz * i / steps;
    if (!onSidewalk(npc, _sample) || Math.abs((npc.groundHeight?.(_sample.x, _sample.z) ?? from.y) - from.y) > CONVERSATION_FLOOR_GAP) return false;
  }
  return true;
}

/** Los gestos y las voces se encuentran en el mismo piso, sin una pared o calzada en medio. */
export function canFace(a, b, fixedPair) {
  const from = a.position, to = b.position;
  if (Math.abs(from.y - to.y) > CONVERSATION_FLOOR_GAP) return false;
  if (!fixedPair && a.navigation === b.navigation && !alongSidewalk(a, from, to)) return false;
  return sightClear(a.collisions ?? b.collisions, (from.y + to.y) / 2, from.x, from.z, to.x, to.z);
}

/** Comprueba el trecho completo antes de mover un peatón, también si empieza y termina en el andén. */
export function conversationPath(npc, spot) {
  const from = npc.position;
  return alongSidewalk(npc, from, spot) && (!npc.isWalkable || pathClear(npc, from.x, from.z, spot.x - from.x, spot.z - from.z));
}

function distanceToPair(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}

/** Se cede solo a quien entra por medio o ya está esperando que la pareja le abra paso. */
export function findPasser(a, b, pedestrians, player, yielding) {
  const from = a.position, to = b.position;
  const height = (from.y + to.y) / 2;
  const radius = yielding ? .74 : .54;
  if (player && Math.abs(player.position.y - height) < PASSER_HEIGHT) {
    const { x, z } = player.position;
    const aheadX = player.vx * .5, aheadZ = player.vz * .5;
    const steps = Math.ceil(Math.hypot(aheadX, aheadZ) / WALK_STEP);
    for (let i = 0; i <= steps; i++) {
      const part = i / (steps || 1);
      if (distanceToPair(x + aheadX * part, z + aheadZ * part, from, to) < radius) return player;
    }
  }
  for (const other of pedestrians) {
    if (other === a || other === b || other?._disposed || !other?.position) continue;
    const { position, mind } = other;
    if (Math.abs(position.y - height) >= PASSER_HEIGHT) continue;
    const distance = distanceToPair(position.x, position.z, from, to);
    const waiting = !other.moving && other.target && mind?.blockerGroup && (mind.sideLockAgent === a || mind.sideLockAgent === b);
    if (distance < radius || (waiting && distance < 2.4)) return other;
  }
  return null;
}

/** Abre hueco a lo largo de la pareja. Los fijos y quien no tiene sitio se quedan donde estaban. */
export function passageSpot(npc, partner) {
  if (npc.fijo) return null;
  const { x, y, z } = npc.position;
  const dx = x - partner.position.x, dz = z - partner.position.z;
  const apart = Math.hypot(dx, dz);
  if (apart < .01) return null;
  // Después del primero pueden pasar otros. Abrir el mismo hueco no los separa cada vez más.
  const retreat = Math.min(partner.fijo ? .76 : .45, (OPEN_GAP - apart) / (partner.fijo ? 1 : 2));
  if (retreat < .1) return null;
  for (const length of [retreat, retreat / 2]) {
    const spot = { x: x + dx * length / apart, y, z: z + dz * length / apart };
    if (conversationPath(npc, spot)) return spot;
  }
  return null;
}
