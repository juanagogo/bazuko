// Dos plazas sobre un asiento de 1,66 m. +X local apunta a la izquierda de quien se sienta.
export const BENCH_SIDE = .42;
const BENCH_FRONT = .1;

export function benchSeatPoint(spot, side) {
  const sin = Math.sin(spot.rot), cos = Math.cos(spot.rot);
  return { x: spot.x + sin * BENCH_FRONT + cos * side, z: spot.z + cos * BENCH_FRONT - sin * side };
}

export function freeBenchSide(spot, position, pedestrians = []) {
  if (!spot) return null;
  let left = true, right = true;
  for (const person of pedestrians) {
    const fixed = person.fijo;
    if (fixed?.benchSeat?.spot !== spot) continue;
    if (fixed.out) {
      const seat = person.home ?? benchSeatPoint(spot, fixed.benchSeat.side);
      if (Math.hypot(person.position.x - seat.x, person.position.z - seat.z) > .43) continue;
    }
    if (fixed.benchSeat.side > 0) left = false;
    else right = false;
    if (!left && !right) return null;
  }
  const offset = (position.x - spot.x) * Math.cos(spot.rot) - (position.z - spot.z) * Math.sin(spot.rot);
  return left && (offset >= 0 || !right) ? BENCH_SIDE : -BENCH_SIDE;
}
