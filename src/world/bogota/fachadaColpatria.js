import * as THREE from 'three';
import { azarPropio, sinGastarAzar, lienzo } from './concretoViaducto.js';

// Fachada de la torre: franjas verticales de concreto y vidrio. Una baldosa cubre 4 vanos (entre nervios) por
// 16 pisos y se repite; tres lienzos chicos comparten el dibujo: color, oficinas encendidas y brillo del vidrio.

const VANOS = 4, PISOS = 16, PISO = 3, PRIMER_PISO = 5;
// Dentro de un vano: nervio, vidrio, aleta de concreto, vidrio, aleta, vidrio, nervio (fracciones del vano).
const FRANJAS = [[.125, .19], [.405, .19], [.685, .19]];

// Muestra del vestíbulo del acceso, pintada sobre un nervio: en la torre queda detrás de una costilla y en el anexo
// detrás de los paneles grises. Vidrio oscuro de día y, de noche, una luz tibia y tenue que baja desde el cielo raso.
const MUESTRA = { x: 2 / 256, y: 100 / 256, ancho: 3 / 256, alto: 16 / 256 };
function muestra(ctx, t, arriba, abajo) {
  const g = ctx.createLinearGradient(0, MUESTRA.y * t, 0, (MUESTRA.y + MUESTRA.alto) * t);
  g.addColorStop(0, arriba); g.addColorStop(1, abajo);
  ctx.fillStyle = g; ctx.fillRect(MUESTRA.x * t, MUESTRA.y * t, MUESTRA.ancho * t, MUESTRA.alto * t);
}

function pintar(tamano, cada) {
  const hoja = lienzo(tamano, tamano);
  if (!hoja) return null;
  const vano = tamano / VANOS, piso = tamano / PISOS;
  cada(hoja.ctx, vano, piso, tamano);
  return hoja.canvas;
}

let texturas;
/** `{ map, emissiveMap, brillo }` o `null` si no hay lienzo (pruebas de node). */
export function fachadaDeTorre() {
  if (texturas !== undefined) return texturas;
  texturas = sinGastarAzar(0x0c01fa7a, () => {
    const rnd = azarPropio(0x70aae5);
    // Qué ventanas tienen persiana y cuáles quedan encendidas de noche: lo mismo en los tres lienzos.
    const ventanas = [];
    for (let p = 0; p < PISOS; p++) for (let v = 0; v < VANOS; v++) {
      const oficina = rnd() < .2, fria = rnd() < .55;
      for (let f = 0; f < FRANJAS.length; f++) ventanas.push({
        p, v, f, tono: rnd(), persiana: rnd() < .22 ? .25 + rnd() * .5 : 0,
        luz: oficina ? .55 + rnd() * .45 : rnd() < .05 ? .35 + rnd() * .4 : 0, fria
      });
    }
    const color = pintar(512, (ctx, vano, piso, t) => {
      ctx.fillStyle = '#b4b0a2'; ctx.fillRect(0, 0, t, t);
      // Concreto lavado por la lluvia: vetas verticales largas.
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = rnd() < .5 ? `rgba(222,218,204,${.04 + rnd() * .06})` : `rgba(70,68,60,${.04 + rnd() * .08})`;
        ctx.fillRect(rnd() * t, rnd() * t, 1 + rnd() * 3, 20 + rnd() * 120);
      }
      for (const w of ventanas) {
        const [fx, fw] = FRANJAS[w.f], x = (w.v + fx) * vano, y = t - (w.p + 1) * piso, ancho = fw * vano;
        // Antepecho de vidrio opaco abajo y ventana arriba.
        const base = 58 + Math.floor(w.tono * 18);
        ctx.fillStyle = `rgb(${base - 6},${base + 12},${base + 20})`; ctx.fillRect(x, y, ancho, piso);
        ctx.fillStyle = `rgb(${base - 16},${base - 2},${base + 4})`; ctx.fillRect(x, y + piso * .72, ancho, piso * .28);
        if (w.persiana) { ctx.fillStyle = 'rgba(150,152,142,.55)'; ctx.fillRect(x + 1, y + 1, ancho - 2, piso * .72 * w.persiana); }
        ctx.fillStyle = 'rgba(20,24,26,.6)'; ctx.fillRect(x, y, 1, piso); ctx.fillRect(x + ancho - 1, y, 1, piso);
      }
      // Chorreones bajo cada losa, sobre las aletas de concreto.
      for (let p = 0; p < PISOS; p++) {
        ctx.fillStyle = 'rgba(50,48,42,.2)'; ctx.fillRect(0, t - p * piso - 2, t, 2);
      }
      muestra(ctx, t, 'rgb(50,62,68)', 'rgb(38,47,52)');
    });
    if (!color) return null;
    const luz = pintar(256, (ctx, vano, piso, t) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, t, t);
      for (const w of ventanas) {
        if (!w.luz) continue;
        const [fx, fw] = FRANJAS[w.f], x = (w.v + fx) * vano, y = t - (w.p + 1) * piso, ancho = fw * vano;
        const k = w.luz, [r, g, b] = w.fria ? [226, 236, 255] : [255, 214, 150];
        ctx.fillStyle = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
        ctx.fillRect(x, y, ancho, piso * .72);
      }
      muestra(ctx, t, 'rgb(88,62,36)', 'rgb(28,20,13)');
    });
    // Verde: aspereza; azul: metal. El vidrio refleja el cielo y el concreto no.
    const brillo = pintar(256, (ctx, vano, piso, t) => {
      ctx.fillStyle = 'rgb(0,235,0)'; ctx.fillRect(0, 0, t, t);
      for (const w of ventanas) {
        const [fx, fw] = FRANJAS[w.f], x = (w.v + fx) * vano, y = t - (w.p + 1) * piso, ancho = fw * vano;
        ctx.fillStyle = w.persiana ? 'rgb(0,90,120)' : 'rgb(0,46,175)'; ctx.fillRect(x, y, ancho, piso);
      }
      muestra(ctx, t, 'rgb(0,46,175)', 'rgb(0,46,175)');
    });
    const textura = (canvas, srgb, nombre) => {
      const tx = new THREE.CanvasTexture(canvas);
      if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = 4; tx.name = nombre;
      return tx;
    };
    // UV del vestíbulo: el centro de la muestra, de su pie a su cabeza, sin tocar sus bordes.
    const margen = 1 / 256, u = MUESTRA.x + MUESTRA.ancho / 2;
    return { map: textura(color, true, 'Fachada de la torre'), emissiveMap: textura(luz, true, 'Oficinas encendidas de la torre'),
      brillo: textura(brillo, false, 'Brillo del vidrio de la torre'),
      vestibulo: { u, pie: 1 - MUESTRA.y - MUESTRA.alto + margen, cabeza: 1 - MUESTRA.y - margen } };
  });
  return texturas;
}

/**
 * Acomoda las UV de una caja de fachada para que los vanos caigan entre los nervios y los pisos sobre los
 * travesaños. `vanosX` y `vanosZ` son los vanos de las caras que miran a Z y a X; `margen`, lo que el primer
 * nervio se separa de la esquina.
 */
export function vestirFachada(geometry, ancho, altura, fondo, { vanosX, vanosZ, margen = .4 } = {}) {
  const uv = geometry.attributes.uv;
  const paso = (largo, vanos) => (largo - margen * 2) / vanos * VANOS;
  const pasoZ = paso(fondo, vanosZ ?? Math.round(fondo / 2.85)), pasoX = paso(ancho, vanosX ?? Math.round(ancho / 2.85));
  for (let i = 0; i < uv.count; i++) {
    const cara = Math.floor(i / 4), u = uv.getX(i), v = uv.getY(i);
    if (cara === 2 || cara === 3) continue;
    const largo = cara < 2 ? fondo : ancho;
    uv.setXY(i, (u * largo - margen) / (cara < 2 ? pasoZ : pasoX), (v * altura - PRIMER_PISO) / (PISOS * PISO));
  }
  uv.needsUpdate = true;
}

/** Viste el material del vidrio; las oficinas siguen a las franjas de luz, que la ciudad prende de noche. */
export function vestirVidrio(material, franjas) {
  const fachada = fachadaDeTorre();
  if (!fachada) return material;
  material.map = fachada.map; material.color.set('#ffffff');
  material.roughnessMap = material.metalnessMap = fachada.brillo; material.roughness = 1; material.metalness = 1;
  material.emissiveMap = fachada.emissiveMap; material.emissive.set('#ffffff'); material.emissiveIntensity = 0;
  material.onBeforeRender = () => {
    const noche = THREE.MathUtils.clamp((franjas[0].emissiveIntensity - .05) / 1.75, 0, 1);
    material.emissiveIntensity = noche * 1.15;
  };
  material.needsUpdate = true;
  return material;
}

let nervio;
/** Concreto claro de los nervios y remates: lavado por la lluvia desde arriba, con juntas por piso y mugre al pie. */
export function vestirNervios(material) {
  if (nervio === undefined) nervio = sinGastarAzar(0x0c01be70, () => {
    const hoja = lienzo(64, 512);
    if (!hoja) return null;
    const { ctx, canvas } = hoja, rnd = azarPropio(0x4e7f10);
    ctx.fillStyle = '#bcb8a9'; ctx.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = rnd() < .45 ? `rgba(226,222,208,${.05 + rnd() * .08})` : `rgba(66,62,54,${.05 + rnd() * .1})`;
      ctx.fillRect(rnd() * 64, rnd() * 512, 2 + rnd() * 8, 30 + rnd() * 170);
    }
    for (let i = 0; i < 9; i++) {
      const largo = 40 + rnd() * 150, g = ctx.createLinearGradient(0, 0, 0, largo);
      g.addColorStop(0, `rgba(52,50,44,${.2 + rnd() * .2})`); g.addColorStop(1, 'rgba(52,50,44,0)');
      ctx.fillStyle = g; ctx.fillRect(rnd() * 60, 0, 3 + rnd() * 7, largo);
    }
    for (let y = 9; y < 512; y += 14) { ctx.fillStyle = 'rgba(48,46,40,.16)'; ctx.fillRect(0, y, 64, 1); }
    const pie = ctx.createLinearGradient(0, 470, 0, 512);
    pie.addColorStop(0, 'rgba(50,46,40,0)'); pie.addColorStop(1, 'rgba(50,46,40,.5)');
    ctx.fillStyle = pie; ctx.fillRect(0, 470, 64, 42);
    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace; textura.anisotropy = 4; textura.name = 'Concreto de los nervios de la torre';
    return textura;
  });
  if (!nervio) return material;
  material.map = nervio; material.color.set('#ffffff'); material.needsUpdate = true;
  return material;
}
