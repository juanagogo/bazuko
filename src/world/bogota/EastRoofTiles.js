import { CLAY_PROFILE, CLAY_ROOF, detailRect } from './ZoneTextures.js';

/** Una sección de canal y cobija sigue visible en el borde y la silueta de cada agua. */
export function claySlope(f, material, { left, right, n, y, ridgeN, ridgeY, phase }) {
  const unit = CLAY_ROOF.meters, tile = unit / CLAY_ROOF.columns;
  const length = Math.hypot(ridgeN - n, ridgeY - y) / unit;
  const offsetU = (phase % CLAY_ROOF.columns) / CLAY_ROOF.columns;
  const offsetV = ((phase >>> 4) % CLAY_ROOF.courses) / CLAY_ROOF.courses;
  const front = n > ridgeN;
  for (let col = Math.floor(left / tile); col * tile < right; col++) {
    for (let edge = 1; edge < CLAY_PROFILE.length; edge++) {
      const [x0, h0] = CLAY_PROFILE[edge - 1], [x1, h1] = CLAY_PROFILE[edge];
      const start = (col + x0) * tile, end = (col + x1) * tile;
      const a = Math.max(left, start), b = Math.min(right, end);
      if (a >= b) continue;
      const ha = h0 + (h1 - h0) * (a - start) / (end - start);
      const hb = h0 + (h1 - h0) * (b - start) / (end - start);
      const [u0, u1, r0, r1] = front ? [a, b, ha, hb] : [b, a, hb, ha];
      const s0 = offsetU + u0 / unit, s1 = offsetU + u1 / unit;
      f.quadUV(material, [u0, y + r0, n], [u1, y + r1, n], [u1, ridgeY + r1, ridgeN], [u0, ridgeY + r0, ridgeN],
        [s0, offsetV, s1, offsetV, s1, offsetV + length, s0, offsetV + length]);
      // El barro termina en un canto, sobre la tabla que cierra los canes de madera.
      f.quadUV(material, [u0, y - .033, n], [u1, y - .033, n], [u1, y + r1, n], [u0, y + r0, n],
        [s0, offsetV, s1, offsetV, s1, offsetV + .075, s0, offsetV + .075]);
    }
  }
}

/** Caballetes semicilíndricos solapados. El ala de Chapinero lleva la cumbrera perpendicular. */
export function clayRidge(f, detail, start, end, across, height, { perpendicular = false, width = .4 } = {}) {
  const radius = width / 2, count = Math.max(1, Math.round((end - start) / .38));
  const P = (run, angle, scale) => {
    const side = across + radius * Math.cos(angle) * scale;
    const y = height + radius * .74 * Math.sin(angle) * scale;
    return perpendicular ? [side, y, -run] : [run, y, side];
  };
  const [u0, v0, u1, v1] = detailRect('terracotta'), uc = (u0 + u1) / 2;
  for (let i = 0; i < count; i++) {
    const a = start + (end - start) * i / count, b = start + (end - start) * (i + 1) / count;
    for (let j = 0; j < 4; j++) {
      const a0 = Math.PI * j / 4, a1 = Math.PI * (j + 1) / 4;
      const near0 = P(a, a0, 1.08), near1 = P(a, a1, 1.08);
      const far0 = P(b, a0, .92), far1 = P(b, a1, .92);
      f.quad(detail, near0, far0, far1, near1, 'terracotta');
      if (i > 0) f.quad(detail, P(a, a0, .92), near0, near1, P(a, a1, .92), 'terracotta');
      // Canto cerrado hacia el hastial y al final de la hilada.
      if (i === 0) f.tri(detail, P(a, 0, 0), near0, near1, [uc, v0, u0, v0, u1, v1]);
      if (i === count - 1) f.tri(detail, P(b, 0, 0), far1, far0, [uc, v0, u1, v1, u0, v0]);
    }
  }
}
