// Tapicerías pintadas en el atlas de molduras. Los vivos y las franjas se leen a través del vidrio.
const UPHOLSTERY = {
  seat: { base: '#424850', side: '#292d34', insert: '#555c64', edge: '#747a81', thread: '#69717a' },
  seatVinilo: { base: '#373d40', side: '#24282a', insert: '#42484b', edge: '#60696c', thread: '#545a5c' },
  seatPopular: { base: '#414c58', side: '#2a3139', insert: '#54636f', edge: '#7a8c98', thread: '#7f8e9f' },
  seatClasico: { base: '#8c7557', side: '#68553e', insert: '#a28a68', edge: '#bba582', thread: '#c1aa87' },
};

export function drawUpholstery(ctx, rects) {
  for (const [name, colors] of Object.entries(UPHOLSTERY)) {
    const [x, y, w, h] = rects[name];
    const seam = Math.round(w * .17), center = w - seam * 2;
    ctx.fillStyle = colors.base;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = colors.insert;
    ctx.fillRect(x + seam, y, center, h);
    if (name === 'seatClasico') {
      // Vinilo de color miel por fuera y paño listado por dentro.
      ctx.fillStyle = '#70533c';
      for (let u = 6; u < center - 3; u += 11) {
        ctx.fillRect(x + seam + u, y, 2, h);
        ctx.fillRect(x + seam + u + 3, y, 1, h);
      }
    } else if (name === 'seatPopular') {
      // Grupos de hebras claras en espiga entre costuras solas.
      ctx.fillStyle = colors.thread;
      for (let v = 2; v < h - 2; v += 5) for (let u = 3; u < center - 4; u += 8) {
        const offset = Math.floor(v / 5) % 2;
        ctx.fillRect(x + seam + u + offset, y + v, 2, 1);
        ctx.fillRect(x + seam + u + 2 + offset, y + v + 1, 2, 1);
      }
    }
    const falloff = ctx.createLinearGradient(0, y, 0, y + h);
    falloff.addColorStop(0, 'rgba(238,237,229,.08)');
    falloff.addColorStop(.55, 'rgba(22,18,15,0)');
    falloff.addColorStop(1, 'rgba(22,18,15,.32)');
    ctx.fillStyle = falloff;
    ctx.fillRect(x, y, w, h);
    for (const side of [seam, w - seam]) {
      ctx.fillStyle = colors.side;
      ctx.fillRect(x + side - 2, y, 4, h);
      ctx.fillStyle = colors.edge;
      ctx.fillRect(x + side, y, 1.5, h);
    }
    for (const v of [h * .27, h * .66]) {
      ctx.fillStyle = colors.side;
      ctx.fillRect(x + seam + 2, y + v, center - 4, name === 'seatVinilo' ? 2.3 : 1.2);
      ctx.fillStyle = colors.thread;
      for (let u = 4; u < center - 4; u += 5) ctx.fillRect(x + seam + u, y + v - 1, 2, 1);
    }
  }
}
