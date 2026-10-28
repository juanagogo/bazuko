// Rodeo lento alrededor de una persona que no se quita, validado completo antes de empezar
// contra personas, vehículos y calzada. La carrocería gira como un carro real: el eje trasero
// sigue la trayectoria con un radio de giro mínimo y la trompa se aparta primero. El conductor
// puede girar el volante detenido, así que la curva empieza en cuanto el carro se mueve.
import { PLAYER_RADIUS } from '../utils/constants.js';

export const DETOUR_SPEED = 2.5;
export const REVERSE_SPEED = .8;
// A paso de maniobra basta con unos 30 cm entre la carrocería y el cuerpo de quien se rodea.
const PASS_MARGIN = PLAYER_RADIUS + .3;
// Si el carro quedó casi tocando a alguien, avanzar nunca puede acercarlo más: primero retrocede.
const CONTACT_MARGIN = PLAYER_RADIUS + .1;
const VEHICLE_MARGIN = .25;
// Del giro a tope a uno más abierto: cerca del andén conviene no barrer la esquina contraria.
const TURN_RADII = [4.5, 6.5, 9];
const REAR_OVERHANG = .9;
// Rodear a alguien con un acompañante a su lado (El Chato se detiene a 2,4 m) exige pasar
// al otro carril completo; la calzada y los vehículos validan cada pose de todos modos.
const MAX_OFFSET = 5.5;
// En la inflexión de la curva la esquina delantera sale más que el resto: puede volar sobre el
// sardinel unos centímetros, como en cualquier carro, mientras las ruedas siguen en la calzada.
const CURB_OVERHANG = .3;
const MAX_ANGLE = 50 * Math.PI / 180;
const STEP = .15;
const BACKOFFS = [0, .6, 1.2, 1.6, 2, 3];

// Medio cambio de carril con dos arcos de radio mínimo: desplazamiento y ángulo a `t` metros.
function sCurve(t, radius, length, offset) {
  const half = length / 2, arc = Math.min(t, length - t);
  const rise = radius - Math.sqrt(Math.max(0, radius * radius - arc * arc));
  return { y: t <= half ? rise : offset - rise, angle: Math.asin(Math.min(1, arc / radius)) };
}

/** Desplazamiento y giro del eje trasero, `u` metros a lo largo del carril desde el origen del plan. */
function rearPose(detour, u) {
  const { offset, radius, length, turnAt, returnAt } = detour, sign = Math.sign(offset), size = Math.abs(offset);
  if (u <= turnAt || u >= returnAt + length) return { y: 0, angle: 0 };
  if (u < turnAt + length) { const pose = sCurve(u - turnAt, radius, length, size); return { y: sign * pose.y, angle: sign * pose.angle }; }
  if (u <= returnAt) return { y: offset, angle: 0 };
  const pose = sCurve(u - returnAt, radius, length, size);
  return { y: sign * (size - pose.y), angle: -sign * pose.angle };
}

/** Desplazamiento lateral del centro (positivo a la izquierda) y ángulo respecto al carril. */
export function detourLateral(detour, s) {
  // El centro va `axle` metros por delante del eje trasero sobre el rumbo de la carrocería.
  let u = s - detour.axle, pose = rearPose(detour, u);
  for (let i = 0; i < 4; i++) { u = s - detour.axle * Math.cos(pose.angle); pose = rearPose(detour, u); }
  return { lateral: pose.y + detour.axle * Math.sin(pose.angle), angle: pose.angle };
}

/** Posición y rumbo de la carrocería en el plan, a partir del carril sin desplazar. */
export function applyDetour(detour, s, position, direction) {
  const { lateral, angle } = detourLateral(detour, s);
  // Izquierda respecto al rumbo con Y hacia arriba: (dz, -dx).
  const leftX = direction.z, leftZ = -direction.x;
  position.x += leftX * lateral; position.z += leftZ * lateral;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const x = direction.x * cos + leftX * sin, z = direction.z * cos + leftZ * sin;
  direction.x = x; direction.z = z;
}

// Separación aproximada entre la carrocería y un punto (negativa si queda dentro).
function boxGap(cx, cz, hx, hz, halfLength, halfWidth, px, pz) {
  const dx = px - cx, dz = pz - cz;
  return Math.max(Math.abs(dx * hx + dz * hz) - halfLength, Math.abs(-dx * hz + dz * hx) - halfWidth);
}

// Cada carrocería se aproxima con tres círculos a lo largo de su eje.
export function circles(x, z, hx, hz, length, width, out) {
  const r = width / 2 + .1, reach = Math.max(0, length / 2 - width / 2);
  out.length = 0;
  for (const k of [-1, 0, 1]) out.push(x + hx * reach * k, z + hz * reach * k, r);
  return out;
}

export function vehiclesOverlap(a, b) {
  for (let i = 0; i < a.length; i += 3) for (let j = 0; j < b.length; j += 3) {
    const limit = a[i + 2] + b[j + 2] + VEHICLE_MARGIN;
    if ((a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2 < limit * limit) return true;
  }
  return false;
}

/**
 * Busca el rodeo más corto que deje a la persona a un costado. `sample(s, position, direction)`
 * entrega el carril sin desplazar a `s` metros del carro. `others` son vehículos con
 * `{ x, z, hx, hz, length, width, speed }`; se proyecta su avance durante toda la maniobra.
 * Si traen `poseAt(t)`, se usa esa posición prevista en el mismo instante de la maniobra.
 * Devuelve null si ninguna alternativa es segura: el conductor sigue esperando.
 */
export function planDetour({ sample, car, person, people = [], others = [], isDrivable = null, laneLimit = 2.2, reverse = true }) {
  const position = { x: 0, z: 0 }, direction = { x: 0, z: 0 };
  // Posición a lo largo del carril y al costado de cada persona cercana al trayecto.
  const locate = p => {
    let at = null, side = 0, best = Infinity;
    for (let s = -car.length / 2; s <= 20; s += .25) {
      sample(s, position, direction);
      const dx = p.x - position.x, dz = p.z - position.z;
      const along = Math.abs(dx * direction.x + dz * direction.z);
      if (along < best) { best = along; at = s; side = dx * direction.z - dz * direction.x; }
    }
    return best > 1 ? null : { at, side };
  };
  const target = locate(person);
  if (!target) return null;
  // Quien acompaña a la persona (otro peatón, un perro) se rodea junto con ella: el hueco
  // tiene que dejar a todo el grupo del mismo lado.
  const group = [target, ...people.map(locate).filter(p => p && Math.abs(p.at - target.at) < 4 && Math.abs(p.side - target.side) < 4)];
  const need = car.width / 2 + PASS_MARGIN + .1;
  const left = Math.max(...group.map(p => p.side)) + need, right = Math.min(...group.map(p => p.side)) - need;
  const personAt = Math.max(...group.map(p => p.at));
  const candidates = [left, left + .3, left + .6, right, right - .3, right - .6]
    .filter(offset => Math.abs(offset) <= MAX_OFFSET && (isDrivable || Math.abs(offset) <= laneLimit))
    // Se adelanta por la izquierda salvo que la derecha exija claramente menos.
    .sort((a, b) => (Math.abs(a) - (a > 0 ? .4 : 0)) - (Math.abs(b) - (b > 0 ? .4 : 0)));
  const shape = [], other = [];
  // La maniobra nunca acerca la carrocería a nadie más de lo que ya está detenida.
  sample(0, position, direction);
  const nearby = [person, ...people].map(p => ({ p, limit: Math.min(PASS_MARGIN,
    boxGap(position.x, position.z, direction.x, direction.z, car.length / 2, car.width / 2, p.x, p.z) - .02) }));
  const axle = Math.max(0, car.length / 2 - REAR_OVERHANG);
  for (const offset of candidates) for (const radius of TURN_RADII) {
    const angle = Math.acos(1 - Math.abs(offset) / (2 * radius));
    if (angle > MAX_ANGLE) continue;
    const length = 2 * radius * Math.sin(angle);
    for (const back of reverse ? BACKOFFS : [0]) {
      // Gira desde que arranca y vuelve al carril cuando la cola ya dejó atrás a la persona.
      const turnAt = -back - axle;
      const returnAt = Math.max(turnAt + length, personAt + REAR_OVERHANG + PASS_MARGIN + .3);
      const detour = { offset, back, radius, length, turnAt, returnAt, axle,
        end: returnAt + length + axle + .2, personLimit: Math.max(nearby[0].limit, CONTACT_MARGIN) };
      const duration = back / REVERSE_SPEED + (detour.end + back) / DETOUR_SPEED;
      // Una pose de la maniobra es segura si no toca personas, calzada ajena ni vehículos.
      const clear = (s, shifted, time) => {
        sample(s, position, direction);
        if (shifted) applyDetour(detour, s, position, direction);
        const hx = direction.x, hz = direction.z, halfLength = car.length / 2, halfWidth = car.width / 2;
        for (const { p, limit } of nearby) {
          if (boxGap(position.x, position.z, hx, hz, halfLength, halfWidth, p.x, p.z) < (shifted ? Math.max(limit, CONTACT_MARGIN) : limit)) return false;
        }
        if (isDrivable) {
          for (const [f, w] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0]]) {
            const side = (halfWidth - CURB_OVERHANG) * w;
            if (!isDrivable(position.x + hx * halfLength * f + hz * side, position.z + hz * halfLength * f - hx * side)) return false;
          }
        } else if (shifted && Math.abs(detourLateral(detour, s).lateral) > laneLimit + .4) return false;
        circles(position.x, position.z, hx, hz, car.length, car.width, shape);
        // Quien viene de frente o por detrás también se mueve mientras dura la maniobra.
        for (const vehicle of others) {
          // Un carro que está rodeando sigue su propia trayectoria: basta saber dónde estará entonces.
          if (vehicle.poseAt) {
            const pose = vehicle.poseAt(time);
            circles(pose.x, pose.z, pose.hx, pose.hz, vehicle.length, vehicle.width, other);
            if (vehiclesOverlap(shape, other)) return false;
            continue;
          }
          for (const t of [0, time, duration]) {
            const travel = Math.max(0, vehicle.speed ?? 0) * t;
            circles(vehicle.x + vehicle.hx * travel, vehicle.z + vehicle.hz * travel, vehicle.hx, vehicle.hz, vehicle.length, vehicle.width, other);
            if (vehiclesOverlap(shape, other)) return false;
            if (!(vehicle.speed > .5)) break;
          }
        }
        return true;
      };
      let safe = true;
      // Retroceso recto por el carril y luego el rodeo hacia adelante.
      for (let s = 0; s >= -back && safe; s -= STEP) safe = clear(s, false, -s / REVERSE_SPEED);
      for (let s = -back; s <= detour.end && safe; s += STEP) safe = clear(s, true, back / REVERSE_SPEED + (s + back) / DETOUR_SPEED);
      if (safe) return detour;
    }
  }
  return null;
}
