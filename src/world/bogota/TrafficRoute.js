/** Circuito de carril cerrado, con tramos rectos y giros circulares. Coordenadas en metros. */
export class TrafficRoute {
  constructor(left, right, top, bottom, radius = 1) {
    if (radius <= 0 || right - left <= radius * 2 || bottom - top <= radius * 2) {
      throw new Error('El circuito de tráfico necesita espacio para sus giros.');
    }
    this.key = [left, right, top, bottom, radius].join(':');
    const line = (x, z, dx, dz, length) => ({ x, z, dx, dz, length });
    const arc = (x, z, angle) => ({ x, z, angle, radius, length: Math.PI * radius / 2 });
    this.segments = [
      line(left + radius, top, 1, 0, right - left - 2 * radius),
      arc(right - radius, top + radius, -Math.PI / 2),
      line(right, top + radius, 0, 1, bottom - top - 2 * radius),
      arc(right - radius, bottom - radius, 0),
      line(right - radius, bottom, -1, 0, right - left - 2 * radius),
      arc(left + radius, bottom - radius, Math.PI / 2),
      line(left, bottom - radius, 0, -1, bottom - top - 2 * radius),
      arc(left + radius, top + radius, Math.PI)
    ];
    this.length = this.segments.reduce((sum, segment) => sum + segment.length, 0);
  }

  /** Reparto de las dos filas del tramo en que va esa distancia (solo las vías de un carril lo traen). */
  layoutAt(distance) {
    let remaining = ((distance % this.length) + this.length) % this.length;
    for (const segment of this.segments) {
      if (remaining > segment.length) { remaining -= segment.length; continue; }
      return segment.layout ?? null;
    }
    return this.segments.at(-1).layout ?? null;
  }

  sample(distance, position, direction) {
    let remaining = ((distance % this.length) + this.length) % this.length;
    for (const segment of this.segments) {
      if (remaining > segment.length) { remaining -= segment.length; continue; }
      if (segment.radius) {
        const angle = segment.angle + remaining / segment.radius;
        position.set(segment.x + Math.cos(angle) * segment.radius, 0, segment.z + Math.sin(angle) * segment.radius);
        direction.set(-Math.sin(angle), 0, Math.cos(angle));
      } else {
        position.set(segment.x + segment.dx * remaining, 0, segment.z + segment.dz * remaining);
        direction.set(segment.dx, 0, segment.dz);
      }
      return;
    }
  }
}
