// Rodaje de pruebas del juego en una sola vía, con una cabina operativa en cada extremo.
export const METRO_RUN = Object.freeze({
  northStop: -39.1,
  stationStop: 86.25,
  initialCenter: 76.4,
  topSpeed: 9,
  acceleration: 1.05,
  braking: 1.2,
  stationPause: 10,
  northPause: 6.5
});

const run = METRO_RUN;
const distance = run.stationStop - run.northStop;
const accelerateFor = run.topSpeed / run.acceleration;
const brakeFor = run.topSpeed / run.braking;
const brakeFrom = distance - run.topSpeed * brakeFor / 2;
const cruiseUntil = brakeFrom / run.topSpeed + accelerateFor / 2;
const travel = cruiseUntil + brakeFor;
export const METRO_PERIOD = 2 * travel + run.stationPause + run.northPause;
// La primera partida alcanza a ver llegar el tren desde el lado del cambuche.
const firstPhase = travel - Math.sqrt(2 * (run.stationStop - run.initialCenter) / run.braking);

function displacement(t) {
  if (t < accelerateFor) return .5 * run.acceleration * t * t;
  if (t < cruiseUntil) return run.topSpeed * (t - accelerateFor / 2);
  return distance - .5 * run.braking * (travel - t) ** 2;
}

export function animateMetroTrain(train, southLamps, northLamps) {
  const lightCabs = (direction) => {
    const white = '#ffefd4', red = '#ea2a32';
    southLamps.color.set(direction > 0 ? white : red);
    northLamps.color.set(direction < 0 ? white : red);
  };
  let phase = firstPhase, direction = 1;
  lightCabs(direction);
  train.userData.update = dt => {
    phase = (phase + dt) % METRO_PERIOD;
    let center, cab;
    const returnTime = phase - travel - run.stationPause;
    if (phase < travel) { center = run.northStop + displacement(phase); cab = 1; }
    else if (returnTime < 0) { center = run.stationStop; cab = 1; }
    else if (returnTime < travel) { center = run.stationStop - displacement(returnTime); cab = -1; }
    else { center = run.northStop; cab = -1; }
    train.position.z = center - run.initialCenter;
    if (direction !== cab) { direction = cab; lightCabs(cab); }
  };
}
