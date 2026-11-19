import * as THREE from 'three';
import { azarPropio, lienzo, sinGastarAzar } from './concretoViaducto.js';

// Maletín vial de plástico: perfil de barrera (pie ancho, cintura, hombro y lomo) estirado a lo largo, con las puntas
// recogidas. X es el ancho, Y la altura y Z el largo; mide lo mismo que la caja de 0,5 × 0,75 × 1,2 m que reemplaza.
const MEDIO = [[.25, 0], [.25, .07], [.15, .3], [.17, .6], [.11, .735]];
const LOMO = [0, .75];
const PERFIL = [...MEDIO.map(([x, y]) => [-x, y]), LOMO, ...MEDIO.map(([x, y]) => [x, y]).reverse()];
const LARGO = 1.2, PUNTA = .06, RECOGE = [.84, .97], ALTO = .75;

// V sube por cada costado hasta el lomo (0 al pie, 1 arriba): los dos costados comparten la misma pintura.
const recorrido = (() => {
  const tramos = [0];
  for (let i = 1; i <= 5; i++) tramos.push(tramos[i - 1] + Math.hypot(PERFIL[i][0] - PERFIL[i - 1][0], PERFIL[i][1] - PERFIL[i - 1][1]));
  const vs = tramos.map(t => t / tramos[5]);
  return PERFIL.map((_, i) => .02 + .96 * vs[i <= 5 ? i : 10 - i]);
})();

function normalesDelPerfil() {
  const caras = [];
  for (let i = 0; i < PERFIL.length - 1; i++) {
    const dx = PERFIL[i + 1][0] - PERFIL[i][0], dy = PERFIL[i + 1][1] - PERFIL[i][1], l = Math.hypot(dx, dy);
    caras.push([-dy / l, dx / l]);
  }
  return PERFIL.map((_, i) => {
    const a = caras[Math.max(0, i - 1)], b = caras[Math.min(caras.length - 1, i)];
    const nx = a[0] + b[0], ny = a[1] + b[1], l = Math.hypot(nx, ny);
    return [nx / l, ny / l];
  });
}

/** Las piezas de la malla, iguales para todos los maletines: 78 triángulos. */
export function piezasDeMaletin() {
  const pos = [], nor = [], uv = [], idx = [];
  const normales = normalesDelPerfil(), n = PERFIL.length;
  const cortes = [-LARGO / 2, -LARGO / 2 + PUNTA, LARGO / 2 - PUNTA, LARGO / 2];
  cortes.forEach((z, c) => {
    const punta = c === 0 || c === 3, lado = Math.sign(z);
    PERFIL.forEach(([x, y], i) => {
      pos.push(punta ? x * RECOGE[0] : x, (punta ? y * RECOGE[1] : y) - ALTO / 2, z);
      const [nx, ny] = normales[i];
      if (punta) { const l = Math.hypot(nx * .6, ny * .6, .8); nor.push(nx * .6 / l, ny * .6 / l, lado * .8 / l); }
      else nor.push(nx, ny, 0);
      uv.push((z + LARGO / 2) / LARGO, recorrido[i]);
    });
  });
  for (let c = 0; c < 3; c++) for (let i = 0; i < n - 1; i++) {
    const a = c * n + i, b = a + 1, d = a + n, e = d + 1;
    idx.push(a, e, b, a, d, e);
  }
  // Las tapas, por peldaños entre puntos a la misma altura: así la pintura de las tapas también va por alturas.
  for (const lado of [-1, 1]) {
    const base = pos.length / 3, z = lado * LARGO / 2;
    PERFIL.forEach(([x, y], i) => {
      pos.push(x * RECOGE[0], y * RECOGE[1] - ALTO / 2, z);
      nor.push(0, 0, lado);
      uv.push(lado < 0 ? .012 + (x + .25) * .06 : .988 - (x + .25) * .06, recorrido[i]);
    });
    const tri = (p, q, r) => lado > 0 ? idx.push(base + p, base + q, base + r) : idx.push(base + p, base + r, base + q);
    for (let k = 0; k < 4; k++) { tri(k, n - 1 - k, n - 2 - k); tri(k, n - 2 - k, k + 1); }
    tri(4, 6, 5);
  }
  return {
    index: new THREE.Uint16BufferAttribute(idx, 1),
    position: new THREE.Float32BufferAttribute(pos, 3),
    normal: new THREE.Float32BufferAttribute(nor, 3),
    uv: new THREE.Float32BufferAttribute(uv, 2)
  };
}

/** Cada maletín lleva su geometría, como cuando era una caja, pero todas comparten los mismos búferes. */
export function geometriaDeMaletin(piezas) {
  const geometria = new THREE.BufferGeometry();
  geometria.setIndex(piezas.index);
  for (const nombre of ['position', 'normal', 'uv']) geometria.setAttribute(nombre, piezas[nombre]);
  return geometria;
}

/** Más o menos uno de cada cuatro queda corrido entre 10 y 20°, según una cuenta fija con su sitio (sin azar). */
export function giroDeMaletin(x, z) {
  let h = Math.imul(Math.round(x * 10), 0x1b873593) ^ Math.imul(Math.round(z * 10), 0xcc9e2d51);
  h = Math.imul(h ^ h >>> 15, 0x2c1b3c6d); h ^= h >>> 12;
  if ((h >>> 0) % 4) return 0;
  return (h >>> 20 & 1 ? 1 : -1) * (10 + (h >>> 8) % 11) * Math.PI / 180;
}

// La pintura: un lienzo de 256 × 256, arriba el naranja y abajo el blanco. U va a lo largo; V, del pie al lomo.
const LADO = 256, FRANJA = 128;
let pintura;

function pintarMaletin(ctx, rnd, oy, naranja) {
  const fila = v => oy + (1 - (.02 + .96 * v)) * FRANJA;
  const alto = (v0, v1) => fila(v0) - fila(v1);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, oy, LADO, FRANJA); ctx.clip();
  ctx.fillStyle = naranja ? '#a85424' : '#bdb9ac'; ctx.fillRect(0, oy, LADO, FRANJA);
  const sol = ctx.createLinearGradient(0, fila(1), 0, fila(0));
  sol.addColorStop(0, naranja ? 'rgba(190,150,118,.34)' : 'rgba(205,196,166,.24)');
  sol.addColorStop(.5, 'rgba(120,100,80,0)');
  sol.addColorStop(1, 'rgba(38,30,22,.26)');
  ctx.fillStyle = sol; ctx.fillRect(0, oy, LADO, FRANJA);
  for (let i = 0; i < 70; i++) {
    const claro = rnd() < .45;
    ctx.fillStyle = claro ? `rgba(225,215,195,${.03 + rnd() * .05})` : `rgba(48,38,28,${.04 + rnd() * .07})`;
    ctx.fillRect(rnd() * LADO, oy + rnd() * FRANJA, 8 + rnd() * 40, 3 + rnd() * 14);
  }
  if (naranja) {
    for (const [v0, v1] of [[.42, .495], [.575, .65]]) {
      const y = fila(v1), h = alto(v0, v1);
      ctx.fillStyle = 'rgba(194,188,172,.88)'; ctx.fillRect(0, y, LADO, h);
      ctx.fillStyle = 'rgba(150,140,122,.35)'; ctx.fillRect(0, y + h - 1.5, LADO, 1.5);
      for (let i = 0; i < 4; i++) {
        const x = rnd() * LADO, w = 6 + rnd() * 34;
        let arriba = rnd() * h * .5, abajo = h * (.5 + rnd() * .5);
        ctx.fillStyle = `rgba(150,80,42,${.55 + rnd() * .35})`;
        for (let d = 0; d < w; d += 2) {
          arriba = Math.max(0, Math.min(h * .8, arriba + (rnd() - .5) * 2.6));
          abajo = Math.max(arriba + 1, Math.min(h, abajo + (rnd() - .5) * 2.6));
          ctx.fillRect(x + d, y + arriba, 2, abajo - arriba);
        }
      }
      for (let i = 0; i < 46; i++) {
        ctx.fillStyle = rnd() < .7 ? `rgba(150,82,44,${.3 + rnd() * .4})` : `rgba(70,58,46,${.2 + rnd() * .3})`;
        ctx.fillRect(rnd() * LADO, y + rnd() * h, 3 + rnd() * 26, rnd() < .8 ? 1 : 2);
      }
      ctx.fillStyle = 'rgba(96,80,60,.22)'; ctx.fillRect(0, y, LADO, h);
    }
  }
  if (!naranja) {
    for (let i = 0; i < 28; i++) {
      const x = rnd() * LADO, y0 = fila(.7 + rnd() * .12), largo = alto(.15 + rnd() * .35, .7);
      const chorro = ctx.createLinearGradient(0, y0, 0, y0 + largo);
      chorro.addColorStop(0, `rgba(86,78,64,${.12 + rnd() * .16})`); chorro.addColorStop(1, 'rgba(86,78,64,0)');
      ctx.fillStyle = chorro; ctx.fillRect(x, y0, 1 + rnd() * 3, largo);
    }
    ctx.fillStyle = 'rgba(92,86,72,.18)'; ctx.fillRect(0, oy, LADO, FRANJA);
  }
  const barro = ctx.createLinearGradient(0, fila(.42), 0, fila(0));
  barro.addColorStop(0, 'rgba(92,76,54,0)');
  barro.addColorStop(.55, `rgba(92,76,54,${naranja ? .18 : .32})`);
  barro.addColorStop(1, `rgba(78,64,46,${naranja ? .55 : .78})`);
  ctx.fillStyle = barro; ctx.fillRect(0, fila(.42), LADO, alto(0, .42) + 2);
  for (let i = 0; i < (naranja ? 160 : 420); i++) {
    const v = .4 * Math.pow(rnd(), 1.7), x = rnd() * LADO, y = fila(v), r = .5 + rnd() * (v < .12 ? 2.6 : 1.6);
    ctx.fillStyle = `rgba(${70 + rnd() * 30 | 0},${58 + rnd() * 24 | 0},${40 + rnd() * 18 | 0},${.35 + rnd() * .5})`;
    ctx.beginPath(); ctx.ellipse(x, y, r * (1 + rnd()), r, 0, 0, Math.PI * 2); ctx.fill();
    if (rnd() < .06) ctx.fillRect(x - .5, y, 1, 2 + rnd() * 8);
  }
  for (let i = 0; i < 60; i++) {
    const enPie = rnd() < .6, v = enPie ? .04 + rnd() * .32 : .66 + rnd() * .16;
    ctx.fillStyle = rnd() < .55 ? `rgba(232,222,204,${.12 + rnd() * .22})` : `rgba(30,26,22,${.14 + rnd() * .24})`;
    ctx.save(); ctx.translate(rnd() * LADO, fila(v)); ctx.rotate((rnd() - .5) * .5);
    ctx.fillRect(0, 0, 4 + rnd() * 30, rnd() < .75 ? 1 : 2); ctx.restore();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(24,22,20,${.12 + rnd() * .16})`;
    ctx.beginPath(); ctx.ellipse(rnd() * LADO, fila(.03 + rnd() * .12), 8 + rnd() * 22, 1.5 + rnd() * 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  const polvo = ctx.createLinearGradient(0, fila(1), 0, fila(.74));
  polvo.addColorStop(0, `rgba(158,146,124,${naranja ? .5 : .42})`); polvo.addColorStop(1, 'rgba(158,146,124,0)');
  ctx.fillStyle = polvo; ctx.fillRect(0, oy, LADO, alto(.74, 1) + 4);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${120 + rnd() * 50 | 0},${110 + rnd() * 44 | 0},${92 + rnd() * 36 | 0},${.25 + rnd() * .4})`;
    ctx.fillRect(rnd() * LADO, fila(.72 + rnd() * .28), 1, 1);
  }
  for (const v of [.3645, .706]) {
    ctx.fillStyle = 'rgba(36,30,24,.38)'; ctx.fillRect(0, fila(v), LADO, 1.2);
    ctx.fillStyle = 'rgba(238,226,206,.1)'; ctx.fillRect(0, fila(v) - 1.4, LADO, 1);
  }
  for (const [u0, u1] of [[.2, .38], [.62, .8]]) {
    const x = u0 * LADO, w = (u1 - u0) * LADO, y = fila(1) - 2, h = alto(.84, 1) + 2;
    ctx.fillStyle = 'rgba(44,36,28,.8)';
    ctx.beginPath(); ctx.moveTo(x + 5, y);
    ctx.arcTo(x + w, y, x + w, y + h, 5); ctx.arcTo(x + w, y + h, x, y + h, 5); ctx.arcTo(x, y + h, x, y, 5); ctx.arcTo(x, y, x + w, y, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(18,14,10,.35)'; ctx.fillRect(x + 4, y, w - 8, h * .6);
    ctx.fillStyle = 'rgba(232,220,196,.14)'; ctx.fillRect(x + 3, y + h, w - 6, 1.5);
    ctx.fillStyle = 'rgba(20,16,12,.3)'; ctx.fillRect(x + 2, y + h + 1.5, w - 4, 1.5);
  }
  for (const u of [.07, .93]) {
    const x = u * LADO, y = fila(1);
    ctx.fillStyle = 'rgba(30,26,22,.6)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = naranja ? 'rgba(128,66,34,.9)' : 'rgba(150,146,134,.9)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  for (const [x0, x1] of [[0, 16], [LADO, LADO - 16]]) {
    const junta = ctx.createLinearGradient(x0, 0, x1, 0);
    junta.addColorStop(0, 'rgba(40,33,26,.55)'); junta.addColorStop(1, 'rgba(40,33,26,0)');
    ctx.fillStyle = junta; ctx.fillRect(Math.min(x0, x1), oy, 16, FRANJA);
  }
  ctx.restore();
}

/** Las dos pinturas de los maletines, en un solo lienzo: comparten la imagen y cada una toma su mitad. */
export function pinturaDeMaletines() {
  if (pintura !== undefined) return pintura;
  pintura = sinGastarAzar(0x0c0b0a1e, () => {
    const hoja = lienzo(LADO, LADO);
    if (!hoja) return null;
    const { ctx, canvas } = hoja, rnd = azarPropio(0x3a1e7a);
    pintarMaletin(ctx, rnd, 0, true);
    pintarMaletin(ctx, rnd, FRANJA, false);
    const naranja = new THREE.CanvasTexture(canvas);
    naranja.colorSpace = THREE.SRGBColorSpace;
    naranja.anisotropy = 4;
    naranja.name = 'Maletines de obra';
    naranja.repeat.set(1, .5);
    const blanco = naranja.clone();
    naranja.offset.set(0, .5);
    return { naranja, blanco };
  });
  return pintura;
}
