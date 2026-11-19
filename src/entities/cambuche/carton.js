// Las cajas abiertas del cambuche. El mismo atlas kraft sirve para la cara, el canto ondulado y la cinta.
import * as THREE from 'three';
import { Maqueta, azar } from './maqueta.js';

const BALDOSA = 256;
const ATLAS = BALDOSA * 2;
const ANCHOS = [0, .075, .38, .48, .51, .71, .94, 1];
const LARGOS = [0, .075, .29, .32, .66, .71, .93, 1];
const PAPELES = ['#c3a073', '#ad8a60', '#c7a879', '#bd965d'];

function pintarPanel(ctx, variante) {
  const r = azar(301 + variante * 41);
  ctx.save();
  ctx.translate(variante % 2 * BALDOSA, Math.floor(variante / 2) * BALDOSA);
  ctx.beginPath();
  ctx.rect(0, 0, BALDOSA, BALDOSA);
  ctx.clip();
  ctx.fillStyle = PAPELES[variante];
  ctx.fillRect(0, 0, BALDOSA, BALDOSA);

  // Fibras cortas y manchas absorbidas por el papel, sin vetas largas de madera.
  for (let i = 0; i < 4200; i++) {
    const x = r() * BALDOSA, y = r() * 211;
    ctx.fillStyle = r() > .51 ? 'rgba(255,232,184,.19)' : 'rgba(57,35,21,.12)';
    ctx.fillRect(x, y, .6 + r() * 2.6, .35 + r() * .65);
  }
  for (const [x, y, rx, ry] of [[24, 18, 44, 24], [226, 189, 72, 29], [168, 119, 41, 32]]) {
    ctx.save();
    ctx.translate(x + (r() - .5) * 27, y + (r() - .5) * 17);
    ctx.scale(rx, ry);
    const mancha = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    mancha.addColorStop(0, 'rgba(60,38,22,.28)');
    mancha.addColorStop(.63, 'rgba(81,53,33,.14)');
    mancha.addColorStop(1, 'rgba(81,53,33,0)');
    ctx.fillStyle = mancha;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  // Los dobleces de las solapas conservaron una línea clara junto al papel aplastado.
  for (const y of [69, 146]) {
    ctx.fillStyle = 'rgba(255,231,184,.28)'; ctx.fillRect(6, y - 1.2, 244, 1.5);
    ctx.fillStyle = 'rgba(74,46,27,.26)'; ctx.fillRect(6, y, 244, 2.8);
  }
  ctx.fillStyle = 'rgba(92,61,32,.22)'; ctx.fillRect(123, 6, 3, 204);
  if (variante === 0 || variante === 2) {
    ctx.fillStyle = variante === 0 ? 'rgba(217,177,99,.63)' : 'rgba(172,121,58,.58)';
    ctx.beginPath();
    ctx.moveTo(112, 12); ctx.lineTo(132, 12); ctx.lineTo(133, 78);
    ctx.lineTo(128, 76); ctx.lineTo(126, 83); ctx.lineTo(113, 80);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(247,212,151,.50)'; ctx.fillRect(112, 14, 1.6, 62);
  }
  if (variante === 0 || variante === 3) {
    // Restos de la tinta de transporte de una misma caja.
    ctx.fillStyle = variante === 3 ? 'rgba(111,53,41,.60)' : 'rgba(65,66,59,.52)';
    for (const x of [172, 190]) {
      ctx.fillRect(x - 1.8, 98, 3.6, 18);
      ctx.beginPath(); ctx.moveTo(x, 90); ctx.lineTo(x - 7, 101); ctx.lineTo(x + 7, 101); ctx.closePath(); ctx.fill();
    }
    ctx.fillRect(162, 120, 38, 2.8);
    for (let x = 159; x < 206; x += 4) ctx.fillRect(x, 132, 1.2 + r() * 2, 7 + r() * 2);
  }

  // Dos pieles claras y las celdas de papel ondulado expuestas entre ellas.
  ctx.fillStyle = '#81603c'; ctx.fillRect(0, 216, BALDOSA, 35);
  ctx.strokeStyle = '#c6a474'; ctx.lineWidth = 1.25;
  ctx.beginPath(); ctx.moveTo(0, 233);
  for (let x = 0; x < BALDOSA; x += 4) {
    ctx.quadraticCurveTo(x + 1, 221, x + 2, 233);
    ctx.quadraticCurveTo(x + 3, 244, x + 4, 233);
  }
  ctx.stroke();
  ctx.fillStyle = '#cfb07d'; ctx.fillRect(0, 217, BALDOSA, 4); ctx.fillRect(0, 243, BALDOSA, 4);
  ctx.restore();
}

export function materialCarton() {
  let map = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      for (let i = 0; i < PAPELES.length; i++) pintarPanel(ctx, i);
      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
    }
  }
  return new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : '#c3a073', vertexColors: true, roughness: .93 });
}

function lamina(ancho, fondo, grueso, variante) {
  const positions = [], uv = [], index = [];
  const xAtlas = variante % 2 * BALDOSA, yAtlas = Math.floor(variante / 2) * BALDOSA;
  const lado = variante % 2 ? 1 : -1, extremo = variante < 2 ? 1 : -1;
  const punto = (u, v) => {
    const du = lado > 0 ? u : 1 - u, dv = extremo > 0 ? v : 1 - v;
    const esquina = Math.max(0, (du - .72) / .28) * Math.max(0, (dv - .75) / .25);
    const doblez = Math.max(0, 1 - Math.abs(v - .32) / .075) * .009
      + Math.max(0, 1 - Math.abs(v - .68) / .065) * .006;
    return [
      ancho * (u - .5 - lado * .055 * esquina),
      grueso / 2 + doblez + esquina * .025,
      fondo * (v - .5 - extremo * .042 * esquina)
    ];
  };
  const vertice = ([x, y, z], px, py) => {
    const i = positions.length / 3;
    positions.push(x, y, z);
    uv.push((xAtlas + px) / ATLAS, 1 - (yAtlas + py) / ATLAS);
    return i;
  };
  for (const v of LARGOS) for (const u of ANCHOS) vertice(punto(u, v), 6 + u * 244, 6 + v * 204);
  for (let j = 0; j + 1 < LARGOS.length; j++) for (let i = 0; i + 1 < ANCHOS.length; i++) {
    const a = j * ANCHOS.length + i, b = a + 1, c = a + ANCHOS.length, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const borde = (muestras, coord) => {
    const inicio = positions.length / 3;
    for (const t of muestras) {
      const [x, y, z] = punto(...coord(t));
      vertice([x, y, z], 6 + t * 244, 219);
      vertice([x, y - grueso, z], 6 + t * 244, 245);
    }
    for (let i = inicio; i + 2 < positions.length / 3; i += 2) index.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
  };
  borde(LARGOS, v => [0, v]);
  borde(ANCHOS, u => [u, 1]);
  borde(LARGOS, v => [1, 1 - v]);
  borde(ANCHOS, u => [1 - u, 0]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

function hoja(maqueta, variante, ancho, fondo, grueso, en, giro) {
  maqueta.pon(lamina(ancho, fondo, grueso, variante), '#ffffff', { en, giro, tono: .01, conUV: true });
}

export function trozoCarton() {
  const panel = new Maqueta(631);
  hoja(panel, 0, .39, .31, .013, [0, .0065, 0], [0, 0, 0]);
  return panel.geometria();
}

export function cartonesSueltos() {
  const m = new Maqueta(7);
  // Conservan la distribución de los cuatro cartones que señalan el lote.
  hoja(m, 2, .6047, .5, .017, [-.6133, .020, .4769], [0, 2.0971, 0]);
  hoja(m, 1, .7173, .5, .016, [.0486, .032, -.2037], [0, 2.9338, 0]);
  hoja(m, 3, .8720, .5, .019, [.6524, .044, .1244], [0, 2.7636, 0]);
  hoja(m, 0, .8813, .5, .017, [.2636, .056, -.1694], [0, 1.0690, 0]);
  return m;
}

export function baseCarton() {
  const m = new Maqueta(11);
  // Las tres hojas que aíslan del suelo se sobreponen. Las tapas chicas quedan cerca del borde.
  hoja(m, 0, .94, 2.36, .022, [-.9, .030, .04], [0, .0009, 0]);
  hoja(m, 1, .94, 2.36, .022, [-.02, .042, .04], [0, .0136, 0]);
  hoja(m, 2, .94, 2.36, .022, [.86, .054, .04], [0, .0244, 0]);
  hoja(m, 1, .5, .34, .014, [1.42, .05, 1.02], [0, .3, .1]);
  hoja(m, 3, .42, .3, .014, [-1.48, .05, -.92], [0, -.2, -.08]);
  return m;
}
