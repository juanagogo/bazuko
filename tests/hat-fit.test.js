import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HAT_SECTORS, hatEdgeProfile, edgeHeightAt } from '../src/character/hatFit.js';

// Anillo de vértices alrededor de (cx, cz): borde inferior inclinado (más bajo atrás) y copa arriba.
function ring({ cx = 0, cz = 0.05, r = 0.09, front = 1.6, back = 1.55, top = 1.7 } = {}) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const t = (Math.cos(a) + 1) / 2; // 1 adelante (+Z), 0 atrás
    out.push(x, back + (front - back) * t, z, x * 0.5, top, z * 0.5);
  }
  return new Float32Array(out);
}

test('el perfil del sombrero sigue el borde inferior en cada dirección', () => {
  const p = hatEdgeProfile(ring());
  assert.equal(p.edge.length, HAT_SECTORS);
  assert.ok(Math.abs(p.center[0]) < 1e-3 && Math.abs(p.center[1] - 0.05) < 1e-3);
  assert.ok(Math.abs(edgeHeightAt(p, 0, 1) - 1.6) < 0.01, 'adelante');
  assert.ok(Math.abs(edgeHeightAt(p, 0, -1) - 1.55) < 0.01, 'atrás');
  const side = edgeHeightAt(p, 1, 0);
  assert.ok(side > 1.56 && side < 1.59, `costado ${side}`);
});

test('un sector sin vértices no recorta el pelo de ese lado', () => {
  // solo la mitad delantera del anillo: los sectores de atrás quedan vacíos
  const pts = [];
  const all = ring();
  for (let i = 0; i < all.length; i += 3) if (all[i + 2] >= 0.05) pts.push(all[i], all[i + 1], all[i + 2]);
  const p = hatEdgeProfile(new Float32Array(pts));
  assert.ok(Math.max(...p.edge) >= 1.7 - 1e-6, 'los sectores vacíos quedan en la copa');
  assert.ok(Math.min(...p.edge) < 1.61);
});
