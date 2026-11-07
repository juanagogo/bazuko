// src/systems/rebusque/semaforo.js
// El reloj del semáforo y la geometría de un carro quieto, para el rebusque. Puro: sin Three.js ni DOM.
//
// Los tiempos copian `signalState` de world/bogota/TrafficSignals.js (ciclo de 36 s, ejes desfasados 18 s, verde
// mientras la fase va por debajo de 14). Si cambian allá, cambian aquí: tests/rebusque-semaforo.test.js compara las dos.
// Las zonas usan los mismos márgenes con que TrafficSystem decide si un carro cede (`_personInCar`, `_personAtNose`).

export const CICLO_S = 36;
export const DESFASE_EJE_S = 18;
export const VERDE_S = 14;

/** Rumbo de un carro: el frente es +X local, así que (cos yaw, −sin yaw), igual que `stoppedAtRed`. */
export function rumbo(car) {
  const yaw = car?.group?.rotation?.y ?? 0;
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/** Eje del semáforo que obedece el carro: 0 si va más en X que en Z, como `TrafficSignals.redAhead`. */
export function ejeDe(car) {
  const h = rumbo(car);
  return Math.abs(h.x) >= Math.abs(h.z) ? 0 : 1;
}

/** Fase del eje (0 a 36) en el instante `time` de los semáforos. */
export function faseDe(time, eje) {
  return ((time - eje * DESFASE_EJE_S) % CICLO_S + CICLO_S) % CICLO_S;
}

/** Segundos para el verde del eje: 0 si ya está en verde. */
export function segundosParaVerdeEje(time, eje) {
  const fase = faseDe(time, eje);
  return fase < VERDE_S ? 0 : CICLO_S - fase;
}

/** Segundos que le quedan al rojo (o al amarillo) del carro; Infinity si no hay semáforos que consultar. */
export function segundosParaVerde(signals, car) {
  if (!Number.isFinite(signals?.time)) return Infinity;
  return segundosParaVerdeEje(signals.time, ejeDe(car));
}

/** ¿Está el punto dentro de un cruce? `margen` encoge la caja: el borde de la cebra todavía es de la cola. */
export function dentroDeCruce(nodes, pos, margen = .3) {
  for (const n of nodes ?? []) {
    if (pos.x > n.x0 + margen && pos.x < n.x1 - margen && pos.z > n.z0 + margen && pos.z < n.z1 - margen) return true;
  }
  return false;
}

/** Índice del cruce más cercano (distancia a su caja) a menos de `max` metros; −1 si no hay. Da la «esquina». */
export function cruceCercano(nodes, pos, max = 30) {
  let mejor = -1, d2 = max * max;
  (nodes ?? []).forEach((n, i) => {
    const dx = Math.max(n.x0 - pos.x, 0, pos.x - n.x1), dz = Math.max(n.z0 - pos.z, 0, pos.z - n.z1);
    const d = dx * dx + dz * dz;
    if (d <= d2) { d2 = d; mejor = i; }
  });
  return mejor;
}

/** Coordenadas del punto en el carro: `a` hacia adelante desde el centro y `s` hacia su derecha (+Z local). */
export function localDe(car, pos, out = { a: 0, s: 0 }) {
  const h = rumbo(car), dx = pos.x - car.position.x, dz = pos.z - car.position.z;
  out.a = dx * h.x + dz * h.z;
  out.s = dx * -h.z + dz * h.x;
  return out;
}

const _l = { a: 0, s: 0 };

/**
 * Dónde queda el punto respecto a un carro quieto:
 *  - 'nariz': delante de la trompa, por donde el carro va a arrancar.
 *  - 'flanco': pegado a la carrocería, donde el carro ya cede.
 *  - 'banda': la franja junto al costado donde el carro todavía no frena pero el golpe sí alcanza.
 *  - 'fuera': ninguna de las anteriores.
 */
export function zonaDeCarro(car, pos) {
  const L = car.length ?? 4.2, W = car.width ?? 1.8;
  const { a, s } = localDe(car, pos, _l), lado = Math.abs(s);
  if (a >= L / 2 - .75 && a <= L / 2 + 5.5 && lado < W / 2 + .7) return 'nariz';
  if (Math.abs(a) < L / 2 + .8 && lado < W / 2 + .55) return 'flanco';
  if (Math.abs(a) < L / 2 + .8 && lado >= W / 2 + .5 && lado < W / 2 + .75) return 'banda';
  return 'fuera';
}

/** Punto de un carro dado en coordenadas locales (a adelante, s a la derecha), en el piso. */
export function puntoLocal(car, a, s, out = { x: 0, y: 0, z: 0 }) {
  const h = rumbo(car), p = car.position;
  out.x = p.x + h.x * a - h.z * s;
  out.z = p.z + h.z * a + h.x * s;
  out.y = p.y ?? 0;
  return out;
}

/** Donde se para el que limpia: frente al capó, a medio metro de la trompa. */
export function puntoParabrisas(car, out) {
  return puntoLocal(car, (car.length ?? 4.2) / 2 + .45, 0, out);
}

/**
 * Lado del conductor (−1 izquierda, +1 derecha) y dónde queda su ventana, en metros desde el centro. Cuenta el puesto,
 * no la puerta por la que se aborda: la buseta se sube por la derecha (driverDoor.side 1) y se maneja por la izquierda.
 */
export function puertaDe(car) {
  const v = car?.vehicle, z = v?.driverAnchor?.z;
  if (Number.isFinite(z) && z !== 0) return { x: v.driverAnchor.x ?? .05, lado: Math.sign(z) };
  const door = v?.driverDoor;
  return { x: door?.x ?? .05, lado: door?.side ?? -1 };
}

/** Junto a la ventana del conductor, fuera de la banda donde no frenan: a W/2 + .8 del eje. */
export function puntoVentana(car, out) {
  const { x, lado } = puertaDe(car);
  return puntoLocal(car, x, lado * ((car.width ?? 1.8) / 2 + .8), out);
}
