// src/entities/npc/room.js
// ¿Cabe el cuerpo? Antes de correrse de lado o de echarse para atrás, el peatón mira que lo que va a pisar sea red
// (andén o cruce) y que no haya nada sólido a la altura del cuerpo en todo el trecho, no solo donde termina: un poste
// a medio camino también lo para. Mismo criterio que `Npc._solidAt` (cajas estáticas de `collisions`, radio del
// cuerpo), con una sola consulta por trecho y sin cierres ni listas nuevas por llamada.

import { hypot } from './hypot.js';

const _solids = [];
const BODY = .2;   // m de radio del cuerpo, el de Npc al huir
const WALK_STEP = .25; // m entre dos puntos de la red que se miran a lo largo del trecho

/** ¿Hay algo sólido a la altura del cuerpo en (x, z)? */
export function solidAt(collisions, x, y, z, r = BODY) {
  if (!collisions?.queryStatic) return false;
  const list = collisions.queryStatic(x - r, z - r, x + r, z + r, _solids);
  for (let i = 0; i < list.length; i++) {
    const box = list[i].box;
    if (box.max.y > y + .5 && box.min.y < y + 1.2 && x > box.min.x - r && x < box.max.x + r && z > box.min.z - r && z < box.max.z + r) return true;
  }
  return false;
}

/**
 * ¿Puede ir de (x, z) a (x + dx, z + dz) sin salirse de la red ni meterse en algo sólido? La red se mira cada 25 cm
 * (las baldosas miden 2 m) y los sólidos en todo el trecho, con el cuerpo alrededor. Si el peatón ya estaba metido en
 * una caja (lo empujaron), lo deja salir de ella: solo cuenta entrar en una.
 */
export function pathClear(npc, x, z, dx, dz) {
  const steps = Math.max(1, Math.ceil(hypot(dx, dz) / WALK_STEP));
  for (let k = 1; k <= steps; k++) if (!npc.isWalkable(x + dx * k / steps, z + dz * k / steps)) return false;
  return !crossesSolid(npc.collisions, npc.position, x, z, dx, dz);
}

/**
 * ¿Se ve (x1, z1) desde (x0, z0) a la altura de la cara? Ninguna caja estática a esa altura en medio (un poste, un
 * kiosco, una mata alta). Sin colisiones, todo se ve.
 */
export function sightClear(collisions, y, x0, z0, x1, z1) {
  if (!collisions?.queryStatic) return true;
  const dx = x1 - x0, dz = z1 - z0;
  const list = collisions.queryStatic(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), _solids);
  for (let i = 0; i < list.length; i++) {
    const box = list[i].box;
    if (!(box.max.y > y + 1.2 && box.min.y < y + 1.7)) continue;
    let enter = 0, exit = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 <= box.min.x || x0 >= box.max.x) continue; }
    else {
      const a = (box.min.x - x0) / dx, b = (box.max.x - x0) / dx;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    if (Math.abs(dz) < 1e-9) { if (z0 <= box.min.z || z0 >= box.max.z) continue; }
    else {
      const a = (box.min.z - z0) / dz, b = (box.max.z - z0) / dz;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    if (enter < exit) return false;
  }
  return true;
}

/** ¿El trecho de (x, z) a (x + dx, z + dz), con el cuerpo alrededor, entra en una caja en la que no está ya `at`? */
function crossesSolid(collisions, at, x, z, dx, dz, r = BODY) {
  if (!collisions?.queryStatic) return false;
  const y = at.y;
  const list = collisions.queryStatic(Math.min(x, x + dx) - r, Math.min(z, z + dz) - r, Math.max(x, x + dx) + r, Math.max(z, z + dz) + r, _solids);
  for (let i = 0; i < list.length; i++) {
    const box = list[i].box;
    if (!(box.max.y > y + .5 && box.min.y < y + 1.2)) continue;
    const minX = box.min.x - r, maxX = box.max.x + r, minZ = box.min.z - r, maxZ = box.max.z + r;
    if (at.x > minX && at.x < maxX && at.z > minZ && at.z < maxZ) continue; // ya está dentro de esta: puede salir
    // El trecho contra la caja agrandada, eje por eje: entra si los dos intervalos en que está dentro se pisan.
    let enter = 0, exit = 1;
    if (Math.abs(dx) < 1e-9) { if (x <= minX || x >= maxX) continue; }
    else {
      const a = (minX - x) / dx, b = (maxX - x) / dx;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    if (Math.abs(dz) < 1e-9) { if (z <= minZ || z >= maxZ) continue; }
    else {
      const a = (minZ - z) / dz, b = (maxZ - z) / dz;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    if (enter < exit) return true;
  }
  return false;
}
