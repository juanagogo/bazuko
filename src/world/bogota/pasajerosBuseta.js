// src/world/bogota/pasajerosBuseta.js
// La gente que va sentada en la buseta, de hombros para arriba, y el cielo raso que la alumbra: todo pintado en un solo
// lienzo que comparten las busetas. Va en una lámina por costado y otra bajo el techo, en una sola malla por buseta.
// Es solo dibujo: no cambia medidas ni choques, y nada de lo que nace aquí gasta el azar del juego.
import * as THREE from 'three';
import { azarPropio, conAzarPropio } from './carLibreas.js';
import { chainSunField } from './SunFieldShader.js';

const PASO = .96, PUESTOS = 6;
export const LIENZO = Object.freeze({ W: 1024, H: 512, fila: 224, techo: 64 });
// La lámina empieza un palmo detrás del primer espaldar: cada puesto del lienzo cae delante del suyo.
export const LAMINA = Object.freeze({ x0: -3.05, x1: -3.05 + PASO * PUESTOS, y0: 1.5, y1: 2.3, z: .84 });
export const TECHO = Object.freeze({ x0: -3.52, x1: 3.3, y: 2.78, z: .9 });
export const TUBOS = Object.freeze([-2.62, -.92, .78, 2.48]);
export const TUBO_LARGO = 1.1;

// Dos filas de seis puestos; `null` es un puesto libre. Ropa de calle bogotana, apagada.
export const GENTE = Object.freeze([
  [
    { piel: '#a97f5e', pelo: '#1d1713', largo: true, ropa: '#6b6258', tipo: 'ruana', raya: '#8c8271' },
    null,
    { piel: '#8f6447', pelo: '#15110e', ropa: '#4a5140', tipo: 'chaqueta', cuello: '#32382c', gorra: '#2f3947' },
    { piel: '#b88f6e', pelo: '#201a15', ropa: '#3b3d42', tipo: 'saco', capucha: true, celular: true },
    null,
    { piel: '#a57a5a', pelo: '#8d8a84', ropa: '#5a4433', tipo: 'chaqueta', cuello: '#3d2d21', bigote: '#77736c' },
  ],
  [
    { piel: '#9a6e4f', pelo: '#17120f', ropa: '#2a2c30', tipo: 'chaqueta', cuello: '#1c1d20', dormido: true, gorro: '#5a3d38' },
    { piel: '#b58c6c', pelo: '#2a1e17', mono: true, ropa: '#7a7264', tipo: 'saco', bufanda: '#6a3d41' },
    null,
    { piel: '#8a6045', pelo: '#120f0d', ropa: '#3c4a5c', tipo: 'chaqueta', cuello: '#2b3644', bigote: '#16120f' },
    { piel: '#ad8363', pelo: '#3a2a1f', largo: true, ropa: '#4f5a57', tipo: 'saco' },
    null,
  ],
]);

// Cada reparto dice, para el costado de la acera y para el otro, qué fila lleva y cuántos puestos se corre.
export const REPARTOS = Object.freeze([[[0, 0], [1, 0]], [[1, 2], [0, 4]], [[0, 3], [1, 1]], [[1, 5], [0, 2]]]);
export function repartoDe(semilla) {
  let h = Math.imul((Math.abs(Math.trunc(semilla)) || 0) + 0x7f4a7c15, 0x2c1b3c6d);
  h ^= h >>> 15; h = Math.imul(h, 0x297a2d39); h ^= h >>> 13;
  return (h >>> 0) % REPARTOS.length;
}

const canal = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const tono = (hex, k, a = 1) => `rgba(${[0, 1, 2].map(i => Math.max(0, Math.min(255, Math.round(canal(hex, i) * k)))).join(',')},${a})`;

function cabeza(ctx, p) {
  const craneo = () => { ctx.beginPath(); ctx.ellipse(0, 0, .09, .108, 0, 0, Math.PI * 2); ctx.ellipse(.014, -.032, .07, .084, 0, 0, Math.PI * 2); };
  const piel = ctx.createRadialGradient(.05, .035, .01, .01, 0, .17);
  piel.addColorStop(0, tono(p.piel, 1.12)); piel.addColorStop(.5, tono(p.piel, .96)); piel.addColorStop(1, tono(p.piel, .58));
  ctx.fillStyle = piel; craneo(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(.08, .014); ctx.lineTo(.107, -.021); ctx.lineTo(.079, -.036); ctx.closePath(); ctx.fill();
  // Oreja, y la sombra de la mandíbula y del cuello: sin ella la cara es un óvalo plano.
  ctx.fillStyle = tono(p.piel, .74); ctx.beginPath(); ctx.ellipse(-.022, -.006, .013, .024, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); craneo(); ctx.clip();
  const sombra = ctx.createLinearGradient(.09, .02, -.06, -.11);
  sombra.addColorStop(0, 'rgba(20,12,8,0)'); sombra.addColorStop(.55, 'rgba(20,12,8,.1)'); sombra.addColorStop(1, 'rgba(20,12,8,.5)');
  ctx.fillStyle = sombra; ctx.fillRect(-.12, -.14, .26, .28);
  ctx.restore();
  // La cuenca del ojo, el costado de la nariz y el pómulo van en sombra suave: un punto negro sobre un óvalo es un muñeco.
  ctx.save(); craneo(); ctx.clip();
  const cuenca = ctx.createRadialGradient(.056, .017, .004, .056, .017, .036);
  cuenca.addColorStop(0, 'rgba(34,18,12,.42)'); cuenca.addColorStop(1, 'rgba(34,18,12,0)');
  ctx.fillStyle = cuenca; ctx.fillRect(.01, -.03, .1, .09);
  const pomulo = ctx.createRadialGradient(.03, -.05, .01, .03, -.05, .07);
  pomulo.addColorStop(0, 'rgba(34,18,12,.26)'); pomulo.addColorStop(1, 'rgba(34,18,12,0)');
  ctx.fillStyle = pomulo; ctx.fillRect(-.06, -.13, .16, .15);
  const frente = ctx.createRadialGradient(.05, .06, .004, .05, .06, .05);
  frente.addColorStop(0, 'rgba(255,238,214,.2)'); frente.addColorStop(1, 'rgba(255,238,214,0)');
  ctx.fillStyle = frente; ctx.fillRect(-.02, 0, .13, .11);
  ctx.restore();
  ctx.strokeStyle = 'rgba(30,16,11,.38)'; ctx.lineCap = 'round'; ctx.lineWidth = .007;
  ctx.beginPath(); ctx.moveTo(.08, .01); ctx.quadraticCurveTo(.086, -.014, .083, -.034); ctx.stroke();
  ctx.strokeStyle = 'rgba(24,15,11,.8)';
  ctx.lineWidth = .008; ctx.beginPath(); ctx.moveTo(.032, .036); ctx.quadraticCurveTo(.052, .043, .072, .034); ctx.stroke();
  if (p.dormido) {
    ctx.lineWidth = .005; ctx.beginPath(); ctx.moveTo(.04, .014); ctx.quadraticCurveTo(.053, .006, .066, .013); ctx.stroke();
    ctx.fillStyle = 'rgba(36,14,12,.75)'; ctx.beginPath(); ctx.ellipse(.073, -.062, .011, .007, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.lineWidth = .0055; ctx.beginPath(); ctx.moveTo(.04, .016); ctx.quadraticCurveTo(.054, .021, .067, .014); ctx.stroke();
    ctx.fillStyle = 'rgba(18,12,10,.85)'; ctx.beginPath(); ctx.ellipse(.056, .014, .0055, .005, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = .004; ctx.beginPath(); ctx.moveTo(.08, .016); ctx.lineTo(.09, .013); ctx.stroke();
    ctx.strokeStyle = 'rgba(74,30,26,.7)'; ctx.lineWidth = .0055; ctx.beginPath(); ctx.moveTo(.058, -.064); ctx.quadraticCurveTo(.074, -.068, .088, -.06); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,16,11,.22)'; ctx.lineWidth = .005; ctx.beginPath(); ctx.moveTo(.062, -.079); ctx.lineTo(.08, -.077); ctx.stroke();
  }
  if (p.bigote) { ctx.strokeStyle = p.bigote; ctx.lineWidth = .011; ctx.beginPath(); ctx.moveTo(.06, -.049); ctx.lineTo(.094, -.047); ctx.stroke(); }
  // Pelo: tapa la coronilla y la nuca y deja la sien; el brillo de arriba le da volumen.
  const pelo = ctx.createLinearGradient(0, .11, -.04, -.08);
  pelo.addColorStop(0, tono(p.pelo, 1.7)); pelo.addColorStop(.35, tono(p.pelo, 1)); pelo.addColorStop(1, tono(p.pelo, .7));
  ctx.fillStyle = pelo;
  ctx.beginPath(); ctx.moveTo(.072, .068);
  ctx.bezierCurveTo(.06, .135, -.105, .13, -.098, .0);
  ctx.bezierCurveTo(-.096, -.04, -.085, -.07, -.066, -.082);
  if (p.largo) { ctx.bezierCurveTo(-.12, -.14, -.115, -.26, -.07, -.3); ctx.bezierCurveTo(-.03, -.26, -.03, -.14, -.045, -.06); }
  ctx.bezierCurveTo(-.05, -.03, -.045, .0, -.03, .022);
  ctx.bezierCurveTo(-.01, .05, .03, .058, .072, .068); ctx.fill();
  if (p.mono) { ctx.beginPath(); ctx.ellipse(-.092, .062, .042, .04, 0, 0, Math.PI * 2); ctx.fill(); }
  const tela = p.gorra ?? p.gorro;
  if (tela) {
    const copa = ctx.createLinearGradient(.02, .13, -.05, .02);
    copa.addColorStop(0, tono(tela, 1.35)); copa.addColorStop(1, tono(tela, .72));
    ctx.fillStyle = copa;
    ctx.beginPath(); ctx.moveTo(.088, .04); ctx.bezierCurveTo(.08, .14, -.11, .145, -.1, .018); ctx.closePath(); ctx.fill();
    if (p.gorra) { ctx.fillStyle = tono(tela, .6); ctx.beginPath(); ctx.moveTo(.07, .05); ctx.lineTo(.178, .03); ctx.lineTo(.18, .014); ctx.lineTo(.078, .028); ctx.closePath(); ctx.fill(); }
    else { ctx.fillStyle = tono(tela, 1.22); ctx.beginPath(); ctx.moveTo(.09, .046); ctx.lineTo(-.1, .024); ctx.lineTo(-.099, -.004); ctx.lineTo(.089, .018); ctx.closePath(); ctx.fill(); }
  }
  if (p.celular) {
    ctx.save(); craneo(); ctx.clip();
    const luz = ctx.createRadialGradient(.08, -.05, .005, .08, -.05, .11);
    luz.addColorStop(0, 'rgba(168,194,236,.34)'); luz.addColorStop(1, 'rgba(168,194,236,0)');
    ctx.fillStyle = luz; ctx.fillRect(-.12, -.14, .26, .28);
    ctx.restore();
  }
}

function torso(ctx, p) {
  const ruana = p.tipo === 'ruana';
  const silueta = () => {
    ctx.beginPath();
    if (ruana) { ctx.moveTo(.03, 1.5); ctx.bezierCurveTo(.05, 1.74, .13, 1.89, .24, 1.925); ctx.lineTo(.385, 1.915); ctx.bezierCurveTo(.5, 1.88, .6, 1.72, .64, 1.5); }
    else { ctx.moveTo(.11, 1.5); ctx.bezierCurveTo(.1, 1.72, .12, 1.87, .225, 1.918); ctx.lineTo(.39, 1.906); ctx.bezierCurveTo(.47, 1.88, .52, 1.8, .53, 1.66); ctx.lineTo(.54, 1.5); }
    ctx.closePath();
  };
  const tela = ctx.createLinearGradient(.5, 1.93, .14, 1.5);
  tela.addColorStop(0, tono(p.ropa, 1.2)); tela.addColorStop(.45, tono(p.ropa, .95)); tela.addColorStop(1, tono(p.ropa, .55));
  ctx.fillStyle = tela; silueta(); ctx.fill();
  ctx.save(); silueta(); ctx.clip();
  if (ruana) {
    for (const [y, grosor] of [[1.6, .03], [1.69, .016], [1.76, .03]]) {
      ctx.strokeStyle = tono(p.raya, 1, .7); ctx.lineWidth = grosor;
      ctx.beginPath(); ctx.moveTo(0, y - .03); ctx.quadraticCurveTo(.33, y + .035, .7, y - .04); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(16,13,11,.6)'; ctx.beginPath(); ctx.moveTo(.27, 1.93); ctx.lineTo(.4, 1.92); ctx.lineTo(.37, 1.82); ctx.closePath(); ctx.fill();
  } else {
    // El brazo de este lado: un cilindro de luz sobre el cuerpo, con su pliegue en la sisa.
    const brazo = ctx.createLinearGradient(.2, 0, .41, 0);
    brazo.addColorStop(0, tono(p.ropa, .5, .9)); brazo.addColorStop(.5, tono(p.ropa, 1.12, .9)); brazo.addColorStop(1, tono(p.ropa, .58, .9));
    ctx.fillStyle = brazo;
    ctx.beginPath(); ctx.moveTo(.205, 1.5); ctx.bezierCurveTo(.2, 1.76, .21, 1.9, .3, 1.905); ctx.bezierCurveTo(.4, 1.9, .41, 1.76, .405, 1.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(10,9,8,.5)'; ctx.lineWidth = .008;
    ctx.beginPath(); ctx.moveTo(.42, 1.89); ctx.quadraticCurveTo(.47, 1.72, .475, 1.5); ctx.stroke();
  }
  // Pliegues: la tela se arruga del hombro al codo y bajo la sisa.
  ctx.lineCap = 'round';
  for (const [x0, y0, cx, cy, x1, y1, grosor, tinta] of [
    [.27, 1.87, .22, 1.76, .25, 1.62, .014, 'rgba(8,8,9,.26)'], [.36, 1.86, .39, 1.74, .36, 1.6, .012, 'rgba(8,8,9,.22)'],
    [.31, 1.88, .3, 1.76, .32, 1.64, .012, 'rgba(240,232,214,.1)'], [.44, 1.84, .5, 1.74, .49, 1.6, .012, 'rgba(8,8,9,.2)'],
  ]) { ctx.strokeStyle = tinta; ctx.lineWidth = grosor; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke(); }
  if (p.celular) {
    const luz = ctx.createRadialGradient(.5, 1.79, .01, .5, 1.79, .17);
    luz.addColorStop(0, 'rgba(176,205,255,.4)'); luz.addColorStop(1, 'rgba(176,205,255,0)');
    ctx.fillStyle = luz; ctx.fillRect(0, 1.5, PASO, .5);
  }
  // Lo que queda bajo la línea de la ventana va en sombra.
  const abajo = ctx.createLinearGradient(0, 1.5, 0, 1.74);
  abajo.addColorStop(0, 'rgba(8,8,9,.62)'); abajo.addColorStop(1, 'rgba(8,8,9,0)');
  ctx.fillStyle = abajo; ctx.fillRect(0, 1.5, PASO, .24);
  ctx.restore();
  if (p.capucha) { ctx.fillStyle = tono(p.ropa, .78); ctx.beginPath(); ctx.ellipse(.215, 1.93, .08, .05, .3, 0, Math.PI * 2); ctx.fill(); }
}

function persona(ctx, p) {
  torso(ctx, p);
  const giro = p.celular ? -.4 : p.dormido ? .3 : 0, atras = p.dormido ? -.03 : 0;
  ctx.fillStyle = tono(p.piel, .7);
  ctx.beginPath(); ctx.moveTo(.275, 1.9); ctx.lineTo(.37, 1.9); ctx.lineTo(.365 + atras, 2); ctx.lineTo(.285 + atras, 2); ctx.closePath(); ctx.fill();
  if (p.cuello) {
    ctx.fillStyle = p.cuello;
    ctx.beginPath(); ctx.moveTo(.225, 1.915); ctx.lineTo(.265, 1.975); ctx.lineTo(.305, 1.925); ctx.closePath(); ctx.fill();
    ctx.fillStyle = tono(p.cuello, 1.3);
    ctx.beginPath(); ctx.moveTo(.33, 1.925); ctx.lineTo(.385, 1.962); ctx.lineTo(.43, 1.875); ctx.lineTo(.37, 1.85); ctx.closePath(); ctx.fill();
  }
  if (p.bufanda) {
    const lana = ctx.createLinearGradient(.4, 1.96, .25, 1.75);
    lana.addColorStop(0, tono(p.bufanda, 1.2)); lana.addColorStop(1, tono(p.bufanda, .62));
    ctx.fillStyle = lana;
    ctx.beginPath(); ctx.ellipse(.318, 1.932, .082, .04, -.08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(.37, 1.92); ctx.lineTo(.43, 1.905); ctx.lineTo(.455, 1.7); ctx.lineTo(.4, 1.7); ctx.closePath(); ctx.fill();
  }
  ctx.save();
  ctx.translate(.32 + atras, 1.955); ctx.rotate(giro); ctx.translate(.015, .12);
  cabeza(ctx, p);
  ctx.restore();
  if (p.celular) {
    ctx.strokeStyle = tono(p.ropa, .9); ctx.lineWidth = .075; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(.36, 1.6); ctx.lineTo(.53, 1.73); ctx.stroke();
    ctx.fillStyle = tono(p.piel, .92); ctx.beginPath(); ctx.ellipse(.555, 1.765, .03, .034, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(.575, 1.81); ctx.rotate(-.35);
    ctx.fillStyle = '#0d0e10'; ctx.fillRect(-.026, -.06, .052, .12);
    ctx.fillStyle = '#c4d8f6'; ctx.fillRect(-.02, -.052, .034, .104);
    ctx.restore();
  }
}

/** Pinta las dos filas de pasajeros y, abajo, el cielo raso con sus cuatro lámparas y su mugre. */
export function pintarPasajeros(ctx) {
  const { W, H, fila, techo } = LIENZO, pxX = W / (PASO * PUESTOS), pxY = fila / (LAMINA.y1 - LAMINA.y0);
  ctx.clearRect(0, 0, W, H);
  GENTE.forEach((puestos, f) => puestos.forEach((p, i) => {
    if (!p) return;
    ctx.save();
    ctx.setTransform(pxX, 0, 0, -pxY, i * PASO * pxX, f * fila + LAMINA.y1 * pxY);
    ctx.beginPath(); ctx.rect(0, LAMINA.y0, PASO, LAMINA.y1 - LAMINA.y0); ctx.clip();
    persona(ctx, p);
    ctx.restore();
  }));
  // Grano sobre lo pintado: un relleno parejo se lee como plástico.
  const azar = azarPropio(0xB05E7D);
  ctx.save(); ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = azar() < .62 ? `rgba(12,10,9,${.05 + azar() * .1})` : `rgba(236,226,208,${.03 + azar() * .06})`;
    ctx.fillRect(azar() * W, azar() * fila * 2, 1 + azar() * 2.2, 1 + azar() * 2.2);
  }
  ctx.restore();

  // Cielo raso: lámina clara percudida, con juntas, goteras viejas y la mugre que se junta en las orillas.
  const y0 = H - techo, largo = TECHO.x1 - TECHO.x0, aX = x => (x - TECHO.x0) / largo * W;
  ctx.fillStyle = '#8f9288'; ctx.fillRect(0, y0, W, techo);
  for (let i = 0; i < 46; i++) {
    const x = azar() * W, y = y0 + azar() * techo, r = 8 + azar() * 30, mancha = ctx.createRadialGradient(x, y, 1, x, y, r);
    mancha.addColorStop(0, `rgba(62,52,38,${.1 + azar() * .16})`); mancha.addColorStop(1, 'rgba(62,52,38,0)');
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, techo); ctx.clip();
    ctx.translate(x, y); ctx.scale(1, .34 + azar() * .3); ctx.translate(-x, -y);
    ctx.fillStyle = mancha; ctx.fillRect(x - r, y - r * 3, r * 2, r * 6);
    ctx.restore();
  }
  const orilla = ctx.createLinearGradient(0, y0, 0, H);
  orilla.addColorStop(0, 'rgba(26,24,20,.5)'); orilla.addColorStop(.26, 'rgba(26,24,20,.06)'); orilla.addColorStop(.74, 'rgba(26,24,20,.06)'); orilla.addColorStop(1, 'rgba(26,24,20,.5)');
  ctx.fillStyle = orilla; ctx.fillRect(0, y0, W, techo);
  ctx.fillStyle = 'rgba(22,20,18,.42)';
  for (let x = TECHO.x0 + .62; x < TECHO.x1; x += 1.14) ctx.fillRect(Math.round(aX(x)), y0, 2, techo);
  for (const x of TUBOS) {
    const cx = aX(x), cy = y0 + techo / 2, medio = TUBO_LARGO / 2 / largo * W;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, techo); ctx.clip();
    ctx.translate(cx, cy); ctx.scale(1, .2); ctx.translate(-cx, -cy);
    const halo = ctx.createRadialGradient(cx, cy, medio * .3, cx, cy, medio * 1.5);
    halo.addColorStop(0, 'rgba(238,242,240,.7)'); halo.addColorStop(1, 'rgba(238,242,240,0)');
    ctx.fillStyle = halo; ctx.fillRect(cx - medio * 1.5, cy - medio * 1.5, medio * 3, medio * 3);
    ctx.restore();
    ctx.fillStyle = '#eef2ee'; ctx.fillRect(cx - medio, cy - 3, medio * 2, 6);
    ctx.fillStyle = 'rgba(40,38,34,.8)'; ctx.fillRect(cx - medio - 5, cy - 4, 5, 8); ctx.fillRect(cx + medio, cy - 4, 5, 8);
  }
}

// Lo que alumbran las lámparas del techo: sigue al aviso de la buseta, que solo enciende con las luces.
const LUZ = { value: new THREE.Color(0, 0, 0) }, TONO_LUZ = new THREE.Color(.42, .47, .53);

let MATERIAL = null;
function materialDePasajeros() {
  if (MATERIAL) return MATERIAL;
  let mapa;
  if (typeof document === 'undefined') mapa = new THREE.Texture();
  else {
    const lienzo = document.createElement('canvas');
    lienzo.width = LIENZO.W; lienzo.height = LIENZO.H;
    const ctx = lienzo.getContext('2d');
    if (ctx) pintarPasajeros(ctx);
    mapa = new THREE.CanvasTexture(lienzo);
  }
  mapa.colorSpace = THREE.SRGBColorSpace; mapa.wrapS = THREE.RepeatWrapping; mapa.anisotropy = 4;
  mapa.name = 'Pasajeros y cielo raso de buseta';
  const material = new THREE.MeshStandardMaterial({ map: mapa, roughness: 1, metalness: 0, alphaTest: .5, side: THREE.DoubleSide });
  material.name = 'Pasajeros de buseta';
  material.onBeforeCompile = shader => {
    shader.uniforms.uLuzBuseta = LUZ;
    // Por detrás no se ve la cara al revés: queda la silueta oscura de alguien de espaldas. Adentro el techo tapa el sol
    // y lo que alumbra es la claridad de la ventana.
    shader.fragmentShader = `uniform vec3 uLuzBuseta;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#include <map_fragment>
        if ( ! gl_FrontFacing ) diffuseColor.rgb = diffuseColor.rgb * .1 + vec3( .008, .008, .01 );`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = uLuzBuseta * diffuseColor.rgb;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= .6; reflectedLight.directSpecular *= 0.;
        reflectedLight.indirectDiffuse *= vec3( 2.1, 1.85, 1.6 );`);
  };
  material.customProgramCacheKey = () => 'pasajeros-buseta';
  return MATERIAL = chainSunField(material);
}

const GEOMETRIAS = [];
function geometriaDe(reparto) {
  if (GEOMETRIAS[reparto]) return GEOMETRIAS[reparto];
  const { x0, x1, y0, y1, z } = LAMINA, { H, fila, techo } = LIENZO, P = [], N = [], U = [], I = [];
  const cara = (puntos, normal, uvs) => {
    const base = P.length / 3;
    for (let i = 0; i < 4; i++) { P.push(...puntos[i]); N.push(...normal); U.push(...uvs[i]); }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  REPARTOS[reparto].forEach(([f, corre], lado) => {
    const s = lado ? -1 : 1, u0 = corre / PUESTOS, u1 = u0 + 1, v0 = 1 - (f + 1) * fila / H + .5 / H, v1 = 1 - f * fila / H - .5 / H;
    // El frente de cada lámina mira hacia afuera por su costado.
    const a = s > 0 ? [x0, u0] : [x1, u1], b = s > 0 ? [x1, u1] : [x0, u0];
    cara([[a[0], y0, s * z], [b[0], y0, s * z], [b[0], y1, s * z], [a[0], y1, s * z]], [0, 0, s], [[a[1], v0], [b[1], v0], [b[1], v1], [a[1], v1]]);
  });
  const t = TECHO, vt = techo / H - .5 / H;
  cara([[t.x0, t.y, -t.z], [t.x1, t.y, -t.z], [t.x1, t.y, t.z], [t.x0, t.y, t.z]], [0, -1, 0], [[0, .5 / H], [1, .5 / H], [1, vt], [0, vt]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(I), 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.name = `Pasajeros de buseta, reparto ${reparto}`;
  return GEOMETRIAS[reparto] = g;
}

/**
 * Sienta a los pasajeros en una buseta recién armada: una malla más, con el material y el lienzo de todas, que se apaga
 * de lejos con las molduras y los vidrios. La semilla del vehículo elige cuál de los cuatro repartos lleva.
 */
export function ponerPasajeros(vehiculo, semilla) {
  const reparto = repartoDe(Number.isFinite(semilla) ? semilla : vehiculo.routeIndex ?? 0);
  return conAzarPropio(0xB05E7C + reparto, () => {
    const malla = new THREE.Mesh(geometriaDe(reparto), materialDePasajeros());
    malla.name = 'Pasajeros y cielo raso';
    malla.castShadow = malla.receiveShadow = false;
    malla.userData.reparto = reparto;
    const faros = vehiculo.headlightMaterial;
    malla.onBeforeRender = () => { LUZ.value.copy(TONO_LUZ).multiplyScalar(faros?.emissiveIntensity ?? 0); };
    vehiculo.bodyVisual.add(malla);
    vehiculo.details?.push(malla);
    return malla;
  });
}
