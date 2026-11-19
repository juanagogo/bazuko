// Los locales de noche: lo que alumbra tras cada vitrina, la mancha de luz que deja en el andén y los bombillos del mercado.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { tint } from './StreetBatch.js';
import { detailAtlas } from './textures-calle.js';
import { lienzo, sinGastarAzar } from './concretoViaducto.js';
import { MARKET } from './EastZones.js';
import { followNight, glowMaterial } from './StoreGlow.js';

/**
 * Cuánto alumbran los locales. Todo lo que se afina está aquí: con una noche más clara se bajan estos números
 * y no hace falta tocar nada más.
 */
export const LUZ_LOCALES = Object.freeze({
  vitrina: 1.05,      // brillo de lo que se ve tras la vitrina con la luz prendida
  fondo: .3,          // cuánto aclara la lámpara la pared del fondo junto al techo, de 0 a 1
  mostrador: .35,     // luz que le queda a la franja de abajo, donde está el mostrador
  anden: .26,         // fuerza de la mancha del andén frente a un local a plena luz
  fondoAnden: 3.6,    // metros que la mancha sale de la fachada hacia el sardinel
  margenAnden: 1.2,   // metros que la mancha pasa del ancho de la vitrina
  mediaPersiana: .5,  // lo que deja pasar una persiana a medio bajar
  chaza: .15,         // fuerza de la mancha bajo la linterna de una chaza
  radioChaza: 2.4,
  fritanga: .12,      // la fritanga alumbra más ancho y más flojo
  radioFritanga: 3,
  mercado: .15,       // fuerza de la mancha bajo el bombillo de cada puesto del mercado
  radioMercado: 2.7,
  bombillo: 1.6       // brillo del bombillo del mercado de noche (1 es su color a plena luz)
});

// Tonos de techo a piso. Ninguno es blanco limpio: el bombillo amarillea y el tubo tira a verde.
const BOMBILLO = ['#ffe9c4', '#a8743f'], BRASA = ['#ffd6a0', '#a35d2a'], TUBO = ['#e2f0e4', '#7c8f84'];
const PANTALLA = ['#bccbee', '#56648a'], FAMA = ['#ffdbd2', '#99605a'];

/**
 * La luz de cada celda del atlas que se ve tras una vitrina. `forma` rompe lo parejo: `medias` deja un lado con
 * el tubo fundido y `bombillo` alumbra solo alrededor de una bombilla colgada.
 */
export const LUCES = Object.freeze({
  abarrotes: { tono: BOMBILLO, fuerza: 1 },
  botellas: { tono: BOMBILLO, fuerza: .85, forma: 'medias' },
  farmacia: { tono: TUBO, fuerza: .92 },
  pan: { tono: BRASA, fuerza: .95 },
  carne: { tono: FAMA, fuerza: .9 },
  fruta: { tono: BOMBILLO, fuerza: .9 },
  pollos: { tono: BRASA, fuerza: 1 },
  mesas: { tono: BOMBILLO, fuerza: .8 },
  taller: { tono: BOMBILLO, fuerza: .7, forma: 'bombillo' },
  ferre: { tono: TUBO, fuerza: .8, forma: 'medias' },
  ropa: { tono: BOMBILLO, fuerza: .75 },
  barberia: { tono: TUBO, fuerza: .95 },
  // Una pantalla ilumina su mesa y deja escapar poca luz por la persiana.
  cabinas: { tono: PANTALLA, fuerza: .85, haciaAnden: .25 },
  billar: { tono: PANTALLA, fuerza: .7, forma: 'bombillo', haciaAnden: .55 },
  oficina: { tono: TUBO, fuerza: .7, forma: 'medias' },
  chatarra: { tono: BOMBILLO, fuerza: .5, forma: 'bombillo' },
  recepcion: { tono: TUBO, fuerza: .65 },
  papeleria: { tono: TUBO, fuerza: .8 },
  reja: { tono: BOMBILLO, fuerza: .6 }
});

const gris = nivel => { const v = Math.round(nivel * 255); return `rgb(${v},${v},${v})`; };

/** Rectángulo de una celda en píxeles de la máscara, con el texel de margen que el atlas deja alrededor. */
export function celdaDeLuz(nombre, ancho, altura) {
  const [u0, v0, u1, v1] = detailAtlas().uv[nombre];
  const x = Math.round(u0 * ancho) - 1, y = Math.round((1 - v1) * altura) - 1;
  return [x, y, Math.round(u1 * ancho) + 1 - x, Math.round((1 - v0) * altura) + 1 - y];
}

function pintar(ctx, imagen, ancho, altura) {
  const escala = imagen.width / ancho;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ancho, altura);
  for (const [nombre, { tono, fuerza, forma }] of Object.entries(LUCES)) {
    const [x, y, w, h] = celdaDeLuz(nombre, ancho, altura);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(imagen, x * escala, y * escala, w * escala, h * escala, x, y, w, h);
    // La lámpara aclara la pared del fondo cerca del techo; abajo quedan los colores de lo que se vende.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = LUZ_LOCALES.fondo;
    const lampara = ctx.createLinearGradient(0, y, 0, y + h);
    lampara.addColorStop(0, tono[0]); lampara.addColorStop(.3, tono[1]); lampara.addColorStop(.8, '#000');
    ctx.fillStyle = lampara;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    const caida = ctx.createLinearGradient(0, y, 0, y + h);
    caida.addColorStop(0, tono[0]); caida.addColorStop(1, tono[1]);
    ctx.fillStyle = caida;
    ctx.fillRect(x, y, w, h);
    const sombra = ctx.createLinearGradient(0, y, 0, y + h);
    sombra.addColorStop(0, gris(fuerza)); sombra.addColorStop(.68, gris(fuerza)); sombra.addColorStop(.86, gris(fuerza * LUZ_LOCALES.mostrador));
    ctx.fillStyle = sombra;
    ctx.fillRect(x, y, w, h);
    if (forma === 'medias') {
      const lado = ctx.createLinearGradient(x, 0, x + w, 0);
      lado.addColorStop(0, '#fff'); lado.addColorStop(.42, '#fff'); lado.addColorStop(.7, gris(.3)); lado.addColorStop(1, gris(.22));
      ctx.fillStyle = lado;
      ctx.fillRect(x, y, w, h);
    } else if (forma === 'bombillo') {
      const cx = x + w * .44, cy = y + h * .3;
      const foco = ctx.createRadialGradient(cx, cy, w * .06, cx, cy, w * .72);
      foco.addColorStop(0, '#fff'); foco.addColorStop(.45, gris(.5)); foco.addColorStop(1, gris(.12));
      ctx.fillStyle = foco;
      ctx.fillRect(x, y, w, h);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

let hecha = null;
/** Máscara de luz del atlas de mobiliario, a la mitad de su tamaño; `null` si no hay lienzo (pruebas de node). */
export function mascaraDeVitrinas() {
  const atlas = detailAtlas().texture, imagen = atlas.image;
  if (hecha?.atlas === atlas) return hecha.mascara;
  if (!imagen?.width) return null;
  const mascara = sinGastarAzar(0x71721a5, () => {
    const hoja = lienzo(imagen.width / 2, imagen.height / 2);
    if (!hoja) return null;
    pintar(hoja.ctx, imagen, imagen.width / 2, imagen.height / 2);
    const textura = new THREE.CanvasTexture(hoja.canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 4;
    textura.name = 'Luz de las vitrinas';
    return textura;
  });
  if (!mascara) return null;
  mascara.addEventListener('dispose', () => { if (hecha?.mascara === mascara) hecha = null; });
  hecha = { atlas, mascara };
  return mascara;
}

// Donde la fachada no tiene relieve, el local va pintado en la malla de la humedad.
const CON_LOCALES = new Set(['Vida de fachadas y azoteas', 'Humedad de fachadas']);

/**
 * Le pone la máscara a los dos materiales que llevan locales, casa por casa y en la vista agrupada. La ciudad ya prende y apaga
 * lo que lleva `windowGlow`; sin lienzo no cambia nada. Devuelve cuántos materiales quedaron con luz.
 */
export function encenderVitrinas(district) {
  const mascara = mascaraDeVitrinas();
  if (!mascara) return 0;
  const listos = new Set(), conocidos = new Set(district.facadeMats);
  const prender = material => {
    if (!CON_LOCALES.has(material?.name) || listos.has(material)) return;
    listos.add(material);
    material.emissiveMap = mascara;
    material.emissive.set('#ffffff');
    material.emissiveIntensity = 0;
    material.userData.windowGlow = LUZ_LOCALES.vitrina;
    material.needsUpdate = true;
    if (!conocidos.has(material)) district.facadeMats.push(material);
  };
  district.group.traverse(objeto => {
    if (Array.isArray(objeto.material)) objeto.material.forEach(prender);
    else prender(objeto.material);
  });
  for (const material of district.buildingVisibility?.closedMaterials?.values() ?? []) prender(material);
  return listos.size;
}

const SUELO = new Set(['road', 'busway', 'sidewalk', 'plaza', 'floor', 'dirt', 'grass']);

/**
 * Mancha de luz sobre lo que se pisa, partida por tiles para seguir la altura del andén y cortarse contra los muros.
 * `ex` y `ez` son las medias medidas; con `dx` o `dz` la mancha nace en la fachada y solo sale hacia ese lado.
 */
function mancha(glow, district, { x, z, ex, ez, dx = 0, dz = 0 }, color) {
  const T = TILE_SIZE, { map } = district;
  const x0 = dx > 0 ? x : x - ex, x1 = dx < 0 ? x : x + ex, z0 = dz > 0 ? z : z - ez, z1 = dz < 0 ? z : z + ez;
  let quads = 0;
  for (let tz = Math.round(z0 / T); tz <= Math.round(z1 / T); tz++) {
    for (let tx = Math.round(x0 / T); tx <= Math.round(x1 / T); tx++) {
      if (!SUELO.has(map[tz]?.[tx])) continue;
      const a = Math.max(tx * T - T / 2, x0), b = Math.min(tx * T + T / 2, x1);
      const c = Math.max(tz * T - T / 2, z0), d = Math.min(tz * T + T / 2, z1);
      if (a >= b || c >= d) continue;
      const y = district.getGroundHeight(tx * T, tz * T) + .03;
      const u = v => .5 + .5 * (v - x) / ex, w = v => .5 - .5 * (v - z) / ez;
      glow.quad([a, y, d], [b, y, d], [b, y, c], [a, y, c], [0, 1, 0], [u(a), w(d), u(b), w(c)], color);
      quads++;
    }
  }
  return quads;
}

/** Tono de la mancha del andén: el de arriba de la vitrina, lavado, para que no pinte el piso de color. */
function tonoDeAnden(interior, fuerza) {
  const luz = LUCES[interior] ?? LUCES.abarrotes;
  return tint(luz.tono[0], fuerza * (.35 + .65 * luz.fuerza));
}

/**
 * Luz de los locales en el piso, en el mismo lote de los faroles: media mancha que sale de cada vitrina abierta y
 * se pierde hacia el sardinel, y una redonda bajo cada puesto de calle y de la plaza de mercado. Devuelve cuántos cuadros pintó.
 */
export function addShopPools(glow, district) {
  const L = LUZ_LOCALES;
  let quads = 0;
  for (const local of district.vitrinas ?? []) {
    const medio = local.ancho / 2 + L.margenAnden, fuerza = L.anden * (local.estado === 'media' ? L.mediaPersiana : 1);
    quads += mancha(glow, district, { x: local.x, z: local.z, dx: local.dx, dz: local.dz,
      ex: local.dx ? L.fondoAnden : medio, ez: local.dz ? L.fondoAnden : medio }, tonoDeAnden(local.interior, fuerza));
  }
  for (const puesto of district.puestos ?? []) {
    const fritanga = puesto.kind === 'fritanga', radio = fritanga ? L.radioFritanga : L.radioChaza;
    quads += mancha(glow, district, { x: puesto.x, z: puesto.z, ex: radio, ez: radio }, tint('#ffc27a', fritanga ? L.fritanga : L.chaza));
  }
  if (district.map[MARKET.z0]?.[MARKET.x0] === 'plaza') for (const puesto of puestosDelMercado()) {
    quads += mancha(glow, district, { x: puesto.x, z: puesto.z + puesto.frente * .6, ex: L.radioMercado, ez: L.radioMercado }, tint('#ffc27a', L.mercado));
  }
  return quads;
}

/**
 * Los seis puestos de la plaza de mercado, en dos filas que se miran. El puesto se corre hasta 15 cm a lo largo
 * de su fila al construirse; para colgar un bombillo y pintar su luz no hace falta más precisión.
 */
export function puestosDelMercado() {
  const T = TILE_SIZE, x0 = MARKET.x0 * T, x1 = MARKET.x1 * T, z0 = MARKET.z0 * T, z1 = MARKET.z1 * T, puestos = [];
  for (let fila = 0; fila < 2; fila++) for (let col = 0; col < 3; col++) {
    puestos.push({ x: x0 + (x1 - x0) * (col + .5) / 3, z: z0 + (z1 - z0) * (fila === 0 ? .24 : .76), frente: fila === 0 ? 1 : -1, lado: (fila + col) % 2 ? 1 : -1 });
  }
  return puestos;
}

/**
 * Un bombillo colgado de un cable sobre la mercancía de cada puesto del mercado, todos en una malla aparte que no
 * gasta el azar de la ciudad. De día es una bombilla apagada; de noche brilla sin alumbrar nada: su luz en el piso
 * la pinta `addShopPools`.
 */
export function colgarBombillos(parent) {
  return sinGastarAzar(0xb0b1110, () => {
    const p = [], n = [], c = [], vidrio = tint('#ffc477'), cable = tint('#1b1a18');
    const bola = new THREE.IcosahedronGeometry(.055, 1), caja = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const pieza = (geometria, x, y, z, sx, sy, sz, color, brillo) => {
      const pos = geometria.attributes.position, nor = geometria.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        p.push(x + pos.getX(i) * sx, y + pos.getY(i) * sy, z + pos.getZ(i) * sz);
        n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        c.push(color[0], color[1], color[2], brillo);
      }
    };
    for (const puesto of puestosDelMercado()) {
      const x = puesto.x + puesto.lado * .7, z = puesto.z + puesto.frente * .95, y = 1.86 + (puesto.lado > 0 ? .07 : 0);
      pieza(bola, x, y, z, 1, 1.25, 1, vidrio, LUZ_LOCALES.bombillo);
      pieza(caja, x, y + .085, z, .034, .05, .034, cable, 0);
      pieza(caja, x, (y + .11 + 2.44) / 2, z, .012, 2.44 - y - .11, .012, cable, 0);
    }
    bola.dispose(); caja.dispose();
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geometria.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geometria.setAttribute('color', new THREE.Float32BufferAttribute(c, 4));
    geometria.computeBoundingBox();
    geometria.computeBoundingSphere();
    const material = glowMaterial(THREE.MeshLambertMaterial, { flatShading: false });
    material.name = 'Bombillos del mercado';
    const malla = followNight(new THREE.Mesh(geometria, material), { day: .05, night: 1 });
    malla.name = 'Bombillos del mercado';
    malla.userData.noMerge = true;
    malla.matrixAutoUpdate = false;
    parent.add(malla);
    return malla;
  });
}

/** Lo que se prende al armar la calle: las vitrinas de toda la ciudad y, si está la plaza de mercado, sus bombillos. */
export function encenderLocales(district, calle) {
  if (district.map[MARKET.z0]?.[MARKET.x0] === 'plaza') colgarBombillos(calle);
  return encenderVitrinas(district);
}
