// src/world/bogota/parkedCars.js
// Cuánto se aparta del andén un carro parqueado y cómo se sube al sardinel. Sin DOM: lo comparten el juego y las pruebas.

/** La marca del puesto (`getParkingSpots`) queda a esta distancia del andén. */
const MARK_TO_CURB = .6;
const CURB_GAP = .1;
// El carril va a 3 m del andén y `_carInPath` deja pasar con (ancho propio + ancho ajeno) / 2 + .15, así que con
// la buseta (2,30) el centro del parqueado no se puede correr más de 3 − .6 − 1,15 − .15 = 1,10 − ancho / 2.
// Se dejan 5 cm de holgura. El carro ancho se monta unos 20 cm en el sardinel, como se parquea en Bogotá;
// correrlo más frena para siempre a la buseta y detrás de ella se atasca la red.
const LANE_ALLOWANCE = 1.05;
/** El andén queda a esta altura sobre la calzada (`HEIGHTS` de `StreetDetails.js`). */
const CURB_HEIGHT = .12;

/** Metros que se aparta del andén un carro de ese ancho, sin invadir lo que necesita la buseta del carril. */
export function parkedCarShift(width) {
  return Math.max(0, Math.min(width / 2 + CURB_GAP - MARK_TO_CURB, LANE_ALLOWANCE - width / 2));
}

/** Metros del ancho del carro que pasan del borde del andén; 0 en el que cabe en la calzada. */
export function parkedCarCurbOverlap(width) {
  return Math.max(0, width / 2 - parkedCarShift(width) - MARK_TO_CURB);
}

const runsAlongZ = spot => Math.abs(spot.rot - Math.PI / 2) < .01;

/** Lado del andén (+1 o −1) en la Z local del carro, que es la X del mundo en una calle a lo largo de Z y la Z en la otra. */
function curbSide(spot) {
  // La marca siempre está corrida hacia su andén.
  return Math.sign(runsAlongZ(spot) ? spot.x - Math.round(spot.x / 2) * 2 : spot.z - Math.round(spot.z / 2) * 2);
}

/** Desplazamiento en el mundo desde la marca del puesto. */
export function parkedCarOffset(spot, width) {
  const away = -curbSide(spot) * parkedCarShift(width);
  return runsAlongZ(spot) ? { x: away, z: 0 } : { x: 0, z: away };
}

/**
 * Deja el carro en su puesto. El que no cabe en la calzada sube al sardinel las llantas de ese lado: se ladean y se levantan la
 * carrocería y sus ruedas, nunca `car.group`, del que leen carril y colisión. El lado de la calle queda apoyado en la calzada.
 */
export function parkCar(car, spot) {
  const { x, z } = parkedCarOffset(spot, car.width), side = curbSide(spot);
  car.position.x += x; car.position.z += z;
  if (parkedCarCurbOverlap(car.width) > 1e-6) {
    car.vehicle.group.rotation.x = -side * Math.atan(CURB_HEIGHT / car.width);
    car.vehicle.group.position.y += CURB_HEIGHT / 2;
  }
  car.setCurb(side, MARK_TO_CURB + parkedCarShift(car.width));
}
