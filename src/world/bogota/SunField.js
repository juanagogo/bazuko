// Sombra de los edificios sin mapas de sombra: un campo de alturas de toda la ciudad, una sola
// textura y una consulta por píxel. Así la calidad baja también tiene sol, sombra y rincones oscuros,
// y las calidades con sombra real lo conservan más allá de los 45 m que cubre su mapa.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { COLPATRIA, COLPATRIA_ANNEX, bridgeCenter, bridgeNormal } from './Colpatria.js';
import { VIADUCT, viaductHeight } from './ColpatriaViaduct.js';
import { SMALL_BUILDING } from './SmallBuilding.js';
import { TERMINAL } from './TransitTerminal.js';
import { AVENUE_OVERPASS } from './AvenueLandmarks.js';
import { scanCityEdge } from './CityEdge.js';
import { OPEN_SKY, SUN_FIELD_HEIGHT, SUN_FIELD_SIDEWAYS, sunFieldUniforms } from './SunFieldShader.js';

export { SUN_FIELD_HEIGHT, chainSunField, fadeGlowInFog, patchSunFieldShader, sunFieldUniforms } from './SunFieldShader.js';

// Un cambio de 0,1° mueve la sombra de una casa unos centímetros: invisible y barato de recalcular.
const LIGHT_EPSILON = .0017;
// Por debajo de esta altura un obstáculo se ve por encima o a través: no cuenta como pared.
const LOW_FENCE = 2.5;

export function boxBlur(source, w, d, radius) {
  const out = new Float32Array(source.length), tmp = new Float32Array(source.length);
  const span = 2 * radius + 1;
  for (let z = 0; z < d; z++) {
    let sum = 0;
    const row = z * w;
    for (let x = -radius; x <= radius; x++) sum += source[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += source[row + Math.min(w - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let z = -radius; z <= radius; z++) sum += tmp[Math.max(0, Math.min(d - 1, z)) * w + x];
    for (let z = 0; z < d; z++) {
      out[z * w + x] = sum / span;
      sum += tmp[Math.min(d - 1, z + radius + 1) * w + x] - tmp[Math.max(0, z - radius) * w + x];
    }
  }
  return out;
}

/**
 * Altura de los objetos que tapan el sol, con un texel por metro.
 * R: altura de la sombra en ese punto (cambia con el sol). G: cielo visible al nivel del suelo.
 */
export class SunField {
  constructor({ x0, z0, width, depth }) {
    this.x0 = x0; this.z0 = z0;
    this.w = Math.ceil(width); this.d = Math.ceil(depth);
    const size = this.w * this.d;
    this.heights = new Float32Array(size);
    this.overhead = new Float32Array(size);
    this.shade = new Float32Array(size);
    this.data = new Uint8Array(size * 2);
    this.light = null;
    this.sweeps = 0;
    this.texture = new THREE.DataTexture(this.data, this.w, this.d, THREE.RGFormat);
    this.texture.name = 'Campo de sol de la ciudad';
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
  }

  /** Levanta un rectángulo en metros; los bordes caen en los bordes de los tiles. */
  fill(x0, x1, z0, z1, height) {
    const a = Math.max(0, Math.round(x0 - this.x0)), b = Math.min(this.w, Math.round(x1 - this.x0));
    const c = Math.max(0, Math.round(z0 - this.z0)), e = Math.min(this.d, Math.round(z1 - this.z0));
    for (let z = c; z < e; z++) for (let x = a; x < b; x++) {
      const i = z * this.w + x;
      if (height > this.heights[i]) this.heights[i] = height;
    }
  }

  /** Marca lo que tapa el cielo sin ser macizo debajo: tablero, cubiertas y copas de árbol. */
  cover(x0, x1, z0, z1, amount) {
    const a = Math.max(0, Math.round(x0 - this.x0)), b = Math.min(this.w, Math.round(x1 - this.x0));
    const c = Math.max(0, Math.round(z0 - this.z0)), e = Math.min(this.d, Math.round(z1 - this.z0));
    for (let z = c; z < e; z++) for (let x = a; x < b; x++) {
      const i = z * this.w + x;
      if (amount > this.overhead[i]) this.overhead[i] = amount;
    }
  }

  /** Cielo visible, una vez, cuando la ciudad ya tiene todas sus alturas. */
  bakeSky() {
    const { w, d, heights, overhead, data } = this, size = w * d;
    const solid = new Float32Array(size), tall = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      // El tablero del viaducto da sombra pero debajo se puede caminar: no cuenta como pared.
      const wall = overhead[i] > 0 ? 0 : heights[i];
      // Una reja se ve a través: da su poca sombra, pero no le quita cielo al andén de al lado.
      solid[i] = wall > LOW_FENCE ? 1 : 0;
      tall[i] = Math.min(wall, 18) / 18;
    }
    const near = boxBlur(solid, w, d, 2), canyon = boxBlur(tall, w, d, 6), roof = boxBlur(overhead, w, d, 2);
    for (let i = 0; i < size; i++) {
      // Dentro de un edificio no se oscurece nada: esos píxeles son azoteas, no piso.
      const open = solid[i] ? 1 : (1 - Math.min(.72, near[i] * .95 + canyon[i] * .65)) * (1 - roof[i] * .5);
      data[i * 2 + 1] = Math.round(open * 255);
    }
    this.texture.needsUpdate = true;
  }

  /**
   * Barrido desde el lado del sol: cada punto hereda la sombra del vecino más cercano al sol,
   * más baja según la inclinación. Recorre cada texel una vez, sin marchar rayos.
   */
  update(lx, ly, lz) {
    const previous = this.light;
    if (previous && Math.abs(previous.x - lx) + Math.abs(previous.y - ly) + Math.abs(previous.z - lz) < LIGHT_EPSILON) return false;
    this.light = { x: lx, y: ly, z: lz };
    const { w, d, heights, shade, data } = this, size = w * d;
    const horizontal = Math.hypot(lx, lz);
    if (horizontal < 1e-3) shade.set(heights);
    else {
      const alongX = Math.abs(lx) >= Math.abs(lz);
      const major = alongX ? lx : lz, minor = alongX ? lz : lx;
      const step = major > 0 ? 1 : -1, slope = minor / Math.abs(major);
      const drop = Math.hypot(1, slope) * Math.max(ly, .01) / horizontal;
      const offset = Math.floor(slope), frac = slope - offset;
      const majorCount = alongX ? w : d, minorCount = alongX ? d : w;
      const majorStride = alongX ? 1 : w, minorStride = alongX ? w : 1;
      for (let k = 0, i = step > 0 ? majorCount - 1 : 0; k < majorCount; k++, i -= step) {
        const prev = i + step, line = i * majorStride, prevLine = prev * majorStride;
        const hasPrev = prev >= 0 && prev < majorCount;
        for (let j = 0; j < minorCount; j++) {
          let height = heights[line + j * minorStride];
          if (hasPrev) {
            const a = j + offset, b = a + 1;
            const va = a >= 0 && a < minorCount ? shade[prevLine + a * minorStride] : 0;
            const vb = b >= 0 && b < minorCount ? shade[prevLine + b * minorStride] : 0;
            const carried = va + (vb - va) * frac - drop;
            if (carried > height) height = carried;
          }
          shade[line + j * minorStride] = height;
        }
      }
    }
    const scale = 255 / SUN_FIELD_HEIGHT;
    for (let i = 0; i < size; i++) {
      const value = shade[i] * scale + .5;
      data[i * 2] = value > 255 ? 255 : value;
    }
    this.texture.needsUpdate = true;
    this.sweeps++;
    return true;
  }

  /** Altura de sombra en un punto del mundo; útil para pruebas y para decidir sin GPU. */
  shadowHeightAt(x, z) {
    const i = Math.floor(x - this.x0), k = Math.floor(z - this.z0);
    if (i < 0 || k < 0 || i >= this.w || k >= this.d) return 0;
    return this.shade[k * this.w + i];
  }

  skyAt(x, z) {
    const i = Math.floor(x - this.x0), k = Math.floor(z - this.z0);
    if (i < 0 || k < 0 || i >= this.w || k >= this.d) return 1;
    return this.data[(k * this.w + i) * 2 + 1] / 255;
  }

  dispose() { this.texture.dispose(); }
}

let active = null;
let lastLight = null;

/** Material compartido de los charcos de luz de los faroles; apagado no gasta ni una llamada. */
const nightGlow = { material: null, amount: 0 };
export function registerNightGlow(material) { nightGlow.material = material; setNightGlow(nightGlow.amount); }
export function setNightGlow(amount) {
  nightGlow.amount = amount;
  if (!nightGlow.material) return;
  nightGlow.material.opacity = amount;
  nightGlow.material.visible = amount > .01;
}

/** Sigue la luz direccional de la escena: se llama cada cuadro y solo trabaja si el sol se movió. */
export function setSunFieldLight(direction) {
  lastLight = direction;
  sunFieldUniforms.uSunFieldSun.value.set(direction.x * SUN_FIELD_SIDEWAYS, direction.z * SUN_FIELD_SIDEWAYS);
  active?.update(direction.x, direction.y, direction.z);
}

export function activateSunField(field) {
  if (active && active !== field) active.dispose();
  active = field;
  sunFieldUniforms.uSunField.value = field?.texture ?? OPEN_SKY;
  const rect = sunFieldUniforms.uSunFieldRect.value;
  if (field) rect.set(field.x0, field.z0, 1 / field.w, 1 / field.d);
  else rect.set(0, 0, 1, 1);
  if (field && lastLight) field.update(lastLight.x, lastLight.y, lastLight.z);
}

const TILE_HEIGHTS = { wall: 9, storeD69: 5, colpatria: COLPATRIA.height, colpatriaAnnex: COLPATRIA_ANNEX.height, smallBuilding: SMALL_BUILDING.height };
// Lo que CityEdge dibuja sobre el tile de borde: la lámina del cierre y el pasamanos de la reja. Solo la fachada es un bloque.
const EDGE_HEIGHTS = { closure: 3.9, fence: 1.72, facade: TILE_HEIGHTS.wall };

function edgeHeights(map) {
  const heights = new Map();
  for (const { side, kind, a, b } of scanCityEdge(map)) for (let t = a; t <= b; t++) {
    const [x, z] = side.edge(map, t), key = z * map[0].length + x;
    heights.set(key, Math.max(heights.get(key) ?? 0, EDGE_HEIGHTS[kind]));
  }
  return heights;
}

/** Campo a partir de los edificios ya construidos y del mapa de tiles, sin depender de cada barrio. */
export function buildSunField(district) {
  const { map } = district, T = TILE_SIZE;
  const x0 = -T / 2, z0 = Math.min(TERMINAL.z0 ?? -74, -74) - 2;
  const field = new SunField({ x0, z0, width: map[0].length * T, depth: map.length * T - z0 - T / 2 });
  const edge = edgeHeights(map);
  for (let z = 0; z < map.length; z++) for (let x = 0; x < map[0].length; x++) {
    const height = (map[z][x] === 'wall' ? edge.get(z * map[0].length + x) : null) ?? TILE_HEIGHTS[map[z][x]];
    if (height) field.fill(x * T - T / 2, x * T + T / 2, z * T - T / 2, z * T + T / 2, height);
  }
  for (const building of district.buildingVisibility?.buildings ?? []) {
    const { min, max } = building.baseBounds;
    field.fill(min.x, max.x, min.z, max.z, building.height);
  }
  // Tablero del viaducto por franjas de un metro: da sombra y debajo queda penumbra.
  for (let z = Math.ceil(VIADUCT.start); z < VIADUCT.end; z++) {
    const deck = viaductHeight(z);
    const normal = bridgeNormal(z), half = VIADUCT.width / 2 / Math.max(.35, Math.abs(normal.x));
    const center = bridgeCenter(z);
    // Apenas sobre el asfalto: más alto dejaría al sol a medias el tablero y la parte baja de lo que va encima.
    field.fill(center - half, center + half, z, z + 1, deck + .2);
    if (deck > 2.2) field.cover(center - half, center + half, z, z + 1, Math.min(1, deck / 6));
  }
  const overpass = AVENUE_OVERPASS;
  if (overpass) {
    field.fill(overpass.x0, overpass.x1, overpass.z - 2, overpass.z + 2, overpass.clearance + 3.6);
    field.cover(overpass.x0, overpass.x1, overpass.z - 2, overpass.z + 2, .8);
  }
  field.fill(72.6, 77.4, -50.5, -9.5, 4.6);
  field.cover(72.6, 77.4, -50.5, -9.5, .9);
  // Marquesina y local de la estación de gasolina.
  field.fill(145.25, 162.75, 92.5, 107.5, 5.3);
  field.cover(145.25, 162.75, 92.5, 107.5, .85);
  field.fill(147.5, 160.5, 112, 116, 3.8);
  for (const tree of district.treePlan ?? []) {
    const r = 2.4 * (tree.scale ?? 1), top = 6.5 * (tree.scale ?? 1);
    // Copa redondeada: sin esto la sombra del árbol sería un cuadrado.
    for (let dz = -r; dz <= r; dz++) {
      const half = Math.sqrt(Math.max(0, r * r - dz * dz));
      field.fill(tree.x - half, tree.x + half, tree.z + dz, tree.z + dz + 1, top);
      field.cover(tree.x - half, tree.x + half, tree.z + dz, tree.z + dz + 1, .55);
    }
  }
  field.bakeSky();
  activateSunField(field);
  return field;
}
