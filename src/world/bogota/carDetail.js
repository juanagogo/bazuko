// src/world/bogota/carDetail.js
// Textura de detalle de cada modelo: multiplica el esmalte con juntas de puertas, capó y baúl, sombras de
// manijas y de los pasos de rueda. En textura y con mipmaps, las líneas se funden de lejos sin titilar.
import * as THREE from 'three';
import { SIDE_V, TOP_V } from './carLoft.js';

const W = 1024, H = 512;
// Juntas finas y de poco contraste: las de 7 mm casi negras parecían cortes hechos a la lámina.
const GAP = 'rgba(14,14,16,.5)', SOFT = 'rgba(14,14,16,.08)';

function draw(ctx, spec, body) {
  const { L, axleF, axleR, archR, archY, gaps = {} } = spec, xTail = body.xTail;
  const sx = x => (x - xTail) / L * W;
  const sy = y => H - SIDE_V * y / body.chartH * H;
  const tx = x => body.topUv(x, 0)[0] * W;
  const ty = z => H - (TOP_V + (1 - TOP_V) * z / body.chartZ) * H;
  const pxX = W / L, pxY = SIDE_V * H / body.chartH;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  // Sombra baja: el costado se oscurece hacia el estribo por el reflejo del pavimento y el polvo.
  // Tiras sin solaparse: el pixel compartido de dos tiras translúcidas se vería como una raya vertical.
  for (let i = 0; i < 96; i++) {
    const x = -L / 2 + L * (i + .5) / 96, b = body.bottom0(x), g = ctx.createLinearGradient(0, sy(b + .17), 0, sy(b - .01));
    const px0 = Math.round(W * i / 96), px1 = Math.round(W * (i + 1) / 96);
    g.addColorStop(0, 'rgba(20,18,16,0)'); g.addColorStop(1, 'rgba(20,18,16,.34)');
    ctx.fillStyle = g; ctx.fillRect(px0, sy(b + .17), px1 - px0, sy(b - .01) - sy(b + .17));
  }
  // Oclusión alrededor de cada paso de rueda.
  for (const ax of [axleF, axleR]) {
    ctx.save(); ctx.translate(sx(ax), sy(archY)); ctx.scale(pxX, pxY);
    const g = ctx.createRadialGradient(0, 0, archR - .01, 0, 0, archR + .11);
    g.addColorStop(0, 'rgba(10,10,12,.62)'); g.addColorStop(.25, 'rgba(10,10,12,.26)'); g.addColorStop(1, 'rgba(10,10,12,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, archR + .11, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  const archTop = x => {
    for (const ax of [axleF, axleR]) { const R = archR + .04, dx = Math.abs(x - ax); if (dx < R) return archY + Math.sqrt(R * R - dx * dx); }
    return -1;
  };
  // Si hay faldón, la puerta muere contra él: dos líneas paralelas tan juntas se verían como una franja.
  const sill = x => Math.max(body.bottom0(x) + (spec.sillCut ?? (spec.rocker ?? .085) + .025), archTop(x));
  const stroke = (color, width) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; ctx.stroke(); };
  const seam = () => { stroke(SOFT, 3.4); stroke(GAP, 1.15); };
  const faint = () => { stroke('rgba(14,14,16,.06)', 3); stroke('rgba(14,14,16,.3)', 1.05); };

  // Puertas: bajan de la cintura y rodean el arco de la rueda cuando lo alcanzan.
  for (const [x0, x1] of gaps.doors ?? []) {
    ctx.beginPath(); ctx.moveTo(sx(x0), sy(body.belt(x0) - .004));
    const steps = 22;
    for (let i = 0; i <= steps; i++) { const x = x0 + (x1 - x0) * i / steps; ctx.lineTo(sx(x), sy(sill(x))); }
    ctx.lineTo(sx(x1), sy(body.belt(x1) - .004));
    seam();
  }
  // Baguetas de cuenco bajo las manijas ya van en la geometría; aquí su sombra.
  for (const [hx, hy] of body.cups ?? []) {
    ctx.save(); ctx.translate(sx(hx), sy(hy)); ctx.scale(pxX, pxY);
    const g = ctx.createRadialGradient(0, 0, .01, 0, 0, .1);
    g.addColorStop(0, 'rgba(8,8,10,.5)'); g.addColorStop(1, 'rgba(8,8,10,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, .1, .045, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  // Tapa de gasolina.
  if (gaps.fuel) {
    const [fx, fy] = gaps.fuel, w = .17 * pxX, h = .15 * pxY;
    // Casi invisible: la tapa de gasolina real solo se adivina por una junta mínima.
    ctx.beginPath(); ctx.roundRect(sx(fx) - w / 2, sy(fy) - h / 2, w, h, 3); stroke('rgba(14,14,16,.2)', 1);
  }
  // Juntas de los parachoques con los guardabarros: arrancan del arco, suben poco y corren tenues hacia el extremo.
  if (!spec.noBumperSeam) {
    for (const [ax, dir, tip] of [[axleF, 1, body.xNose - spec.noseLen * .55], [axleR, -1, body.xTail + spec.tailLen * .55]]) {
      const x = ax + dir * archR * .78, y0 = archTop(x), y1 = Math.min(y0 + .1, body.shoulder(x) - .05);
      ctx.beginPath(); ctx.moveTo(sx(x), sy(y0));
      // Con pliegue bajo, el resto de la junta ya lo dibuja la malla: aquí solo el tramo que sube del arco.
      if (body.lowLine) ctx.lineTo(sx(x + dir * .012), sy(Math.max(body.lowLine(x), y0 + .01)));
      else { ctx.lineTo(sx(x + dir * .02), sy(y1)); ctx.lineTo(sx(tip), sy(y1 + .01)); }
      faint();
    }
  }

  // Carta superior: juntas del capó y del baúl.
  const line = (x0, z0, x1, z1) => { ctx.beginPath(); ctx.moveTo(tx(x0), ty(z0)); ctx.lineTo(tx(x1), ty(z1)); seam(); };
  if (gaps.hood && spec.windshield) {
    const cowl = spec.windshield[1] + .01, front = gaps.hood;
    line(front, 0, front, body.edgeZ(front) * .86);
    ctx.beginPath(); ctx.moveTo(tx(front), ty(body.edgeZ(front) * .86));
    for (let i = 1; i <= 8; i++) { const x = front + (cowl - front) * i / 8; ctx.lineTo(tx(x), ty(body.edgeZ(x) * .9)); }
    seam();
  }
  if (gaps.trunk) {
    line(gaps.trunk, 0, gaps.trunk, body.edgeZ(gaps.trunk) * .86);
    const end = body.xTail + spec.tailLen * .3;
    ctx.beginPath(); ctx.moveTo(tx(gaps.trunk), ty(body.edgeZ(gaps.trunk) * .86));
    for (let i = 1; i <= 6; i++) { const x = gaps.trunk + (end - gaps.trunk) * i / 6; ctx.lineTo(tx(x), ty(body.edgeZ(x) * .9)); }
    seam();
  }
  if (gaps.hatch) {
    const [a, b] = gaps.hatch;
    line(b, 0, b, body.edgeZ(b) * .9);
    ctx.beginPath(); ctx.moveTo(tx(b), ty(body.edgeZ(b) * .9));
    for (let i = 1; i <= 6; i++) { const x = b + (a - b) * i / 6; ctx.lineTo(tx(x), ty(body.edgeZ(x) * .92)); }
    seam();
  }
  // Goteras del techo: la canal larga a cada lado.
  if (spec.windshield && spec.backlight && !spec.bed) {
    const x0 = spec.backlight[1] + .02, x1 = spec.windshield[0] - .02;
    ctx.beginPath(); ctx.moveTo(tx(x0), ty(body.edgeZ(x0) * .9));
    for (let i = 1; i <= 8; i++) { const x = x0 + (x1 - x0) * i / 8; ctx.lineTo(tx(x), ty(body.edgeZ(x) * .9)); }
    stroke(SOFT, 3);
  }
  if (spec.detail) spec.detail(ctx, { sx, sy, tx, ty, pxX, pxY, W, H, body, seam, stroke });
}

const maps = new Map();
/** Textura por modelo, dibujada una sola vez y compartida entre todos los carros de ese modelo. */
export function getDetailMap(spec, body) {
  let texture = maps.get(spec.id);
  if (texture) return texture;
  if (typeof document === 'undefined') {
    texture = new THREE.Texture();
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (ctx) draw(ctx, spec, body);
    texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.generateMipmaps = true;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `Detalle ${spec.id}`;
  maps.set(spec.id, texture);
  return texture;
}
