// La caja con que se mide si dos vehículos se montan: la de la moto sale de su malla; la del carro, de su largo y ancho;
// la del bus lleva el largo sobre z local. Pruebas de separación por ejes, sin asignar nada por cuadro.

/** Rellena `out` con el centro, los dos ejes y las mitades de la caja del vehículo, en el plano. */
export function vehicleBox(car, isBus = false, out = {}) {
  const yaw = car.group.rotation.y, cos = Math.cos(yaw), sin = Math.sin(yaw);
  const fitted = car.collider;
  const hl = fitted ? (fitted.x1 - fitted.x0) / 2 : car.length / 2, hw = fitted ? fitted.hw : car.width / 2;
  const shift = fitted ? (fitted.x0 + fitted.x1) / 2 : 0;
  // ejes locales: x (cos, -sin) y z (sin, cos); el largo va sobre x, salvo el bus que lo lleva sobre z
  out.cx = car.position.x + cos * shift; out.cz = car.position.z - sin * shift;
  out.ax = cos; out.az = -sin; out.bx = sin; out.bz = cos;
  out.ha = isBus ? hw : hl; out.hb = isBus ? hl : hw;
  return out;
}

/** Cuánto se montan dos cajas (la menor penetración sobre los cuatro ejes); 0 si no se tocan. */
export function overlapDepth(a, b) {
  let min = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = i < 2 ? a : b, ux = i % 2 ? s.bx : s.ax, uz = i % 2 ? s.bz : s.az;
    const reach = box => box.ha * Math.abs(box.ax * ux + box.az * uz) + box.hb * Math.abs(box.bx * ux + box.bz * uz);
    const depth = reach(a) + reach(b) - Math.abs((a.cx - b.cx) * ux + (a.cz - b.cz) * uz);
    if (depth <= 0) return 0;
    if (depth < min) min = depth;
  }
  return min;
}
