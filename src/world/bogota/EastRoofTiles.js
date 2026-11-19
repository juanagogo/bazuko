import { detailRect } from './ZoneTextures.js';
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
