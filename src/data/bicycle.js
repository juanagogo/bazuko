// Metros del mundo, +Z hacia delante. Geometría y posturas comparten estos contactos.
export const BICYCLE = Object.freeze({
  wheelRadius: .34, tire: .026, wheelbase: 1.16,
  seat: [0, .88, -.18], crank: [0, .43, -.08], crankRadius: .16,
  grip: [.27, 1.12, .32], steering: [0, .78, .48], maxSteer: .36,
  riderScale: 1.08, cycleFrames: 16, mountSeconds: .3,
  reverseSpeed: 1.6, reverseDelay: .2,
  rentalCost: 1000, honestReturnReward: 2000,
});

export function bicyclePedal(side, phase, out) {
  const angle = phase + (side === 'left' ? 0 : Math.PI);
  return out.set(side === 'left' ? .2 : -.2,
    BICYCLE.crank[1] - Math.sin(angle) * BICYCLE.crankRadius,
    BICYCLE.crank[2] + Math.cos(angle) * BICYCLE.crankRadius);
}

export function bicycleGrip(side, steer, out) {
  const x = side === 'left' ? BICYCLE.grip[0] : -BICYCLE.grip[0];
  const z = BICYCLE.grip[2] - BICYCLE.steering[2];
  return out.set(x * Math.cos(steer) + z * Math.sin(steer), BICYCLE.grip[1],
    BICYCLE.steering[2] - x * Math.sin(steer) + z * Math.cos(steer));
}

/** Tobillo al retroceder: apoyo largo y recuperación corta junto al suelo. */
export function bicycleGroundFoot(side, phase, out) {
  const turn = (((phase / (Math.PI * 2) + (side === 'right' ? .5 : 0)) % 1) + 1) % 1;
  const planted = turn < .6;
  const t = planted ? turn / .6 : (turn - .6) / .4;
  return out.set(side === 'left' ? .25 : -.25,
    planted ? 0 : Math.sin(t * Math.PI) * .05,
    planted ? -.25 + .35 * t : .1 - .35 * t);
}
