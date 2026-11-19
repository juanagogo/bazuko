// Charcos: el agua se queda junto al sardinel y en los baches del carril. En seco no dibujan nada.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { STATIC_CHUNK_SIZE, createRenderSectors, freezeStaticTransforms } from './StaticGeometry.js';
import { StreetBatch, tint, unit } from './StreetBatch.js';
import { inLakeTerrain, onLakeBridge } from './LakePark.js';
import { chainSunField } from './SunFieldShader.js';
import { asphaltPatches } from './StreetMarkings.js';

const T = TILE_SIZE;
const ROADS = new Set(['road', 'busway']);
const PAVED = new Set(['sidewalk', 'plaza']);
const LIFT = .017;
const CELL = 128, MASK_SIZE = CELL * 2;
const MAX_STEP = .025;
const STEP_WAVES = 4, WAVE_SECONDS = .78;
const STEP_SLOTS = new Float32Array(STEP_WAVES * 4);

// Cuatro pozos distintos (2 × 2 en la misma textura): cada uno es la unión de varias hondonadas.
const SHAPES = [
  { lobes: [[-.05, 0, .6], [.38, .2, .34]], phase: 1.1 },
  { lobes: [[-.34, .04, .44], [.3, -.08, .42]], phase: 2.7 },
  { lobes: [[0, -.1, .52], [-.4, .28, .28], [.42, .26, .25]], phase: 4.2 },
  { lobes: [[-.1, .02, .58], [.48, -.3, .2]], phase: 5.9 }
];

function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Hondura del pozo (0 fuera, 1 en lo más hondo): el nivel del agua la corta más arriba o más abajo. */
function depthAt(u, v, k) {
  const { lobes, phase } = SHAPES[k];
  let d = -1;
  for (const [cx, cy, r] of lobes) {
    const x = u - cx, y = v - cy, a = Math.atan2(y, x);
    const wobble = 1 + .12 * Math.sin(a * 3 + phase) + .08 * Math.sin(a * 5 + phase * 2.3) + .04 * Math.sin(a * 8 + phase * .7);
    d = Math.max(d, 1 - Math.hypot(x, y) / (r * wobble));
  }
  // El borde se rompe con ruido: ningún charco queda de óvalo limpio.
  d += (noise(u * 3.2 + 9, v * 3.2 + 4, k) - .5) * .4 + (noise(u * 7.5, v * 7.5, k + 7) - .5) * .14;
  const fade = Math.min(1, Math.max(0, (1 - Math.max(Math.abs(u), Math.abs(v))) / .16));
  return Math.min(1, Math.max(0, d * 1.25)) * fade;
}

let maskCache = null;
/** Hondura de los pozos, sin lienzo, para construirse igual en cualquier entorno. */
function puddleMask() {
  if (maskCache) return maskCache;
  const data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);
  for (let j = 0; j < MASK_SIZE; j++) for (let i = 0; i < MASK_SIZE; i++) {
    const k = (j >= CELL ? 2 : 0) + (i >= CELL ? 1 : 0);
    const u = ((i % CELL) + .5) / CELL * 2 - 1, v = ((j % CELL) + .5) / CELL * 2 - 1;
    const p = (j * MASK_SIZE + i) * 4;
    data[p] = data[p + 1] = data[p + 2] = 255;
    data[p + 3] = Math.round(depthAt(u, v, k) * 255);
  }
  const texture = new THREE.DataTexture(data, MASK_SIZE, MASK_SIZE, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.name = 'Forma de los charcos';
  texture.needsUpdate = true;
  texture.addEventListener('dispose', () => { maskCache = null; });
  maskCache = texture;
  return texture;
}

/** Dónde se acumula el agua. Determinista: la misma cuadra siempre se encharca en el mismo sitio. */
export function planPuddles(map, runs, heightAt = () => 0) {
  const tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  const fits = (set, x, z, hw, hd, along) => {
    const [dx, dz] = along === 'x' ? [hw, hd] : [hd, hw];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * dx, z + b * dz]);
    if (!corners.every(([px, pz]) => set.has(tile(px, pz)))) return false;
    // El agua es plana: nada de charcos sobre una rampa o un escalón.
    const y = corners.map(([px, pz]) => heightAt(px, pz));
    return Math.max(...y) - Math.min(...y) <= MAX_STEP;
  };
  const out = [];
  // Junto al sardinel: la calle tiene bombeo y el agua corre hacia el borde.
  for (const { axis, fixed, a, b, side } of runs) {
    for (let i = a; i <= b; i += 3) {
      if (unit(i, fixed, 71 + side) > .56) continue;
      const width = 1.8 + unit(fixed, i, 72) * 3.4, depth = .8 + unit(i, fixed, 73) * .8;
      const along = (i + unit(fixed, i, 74)) * T, across = fixed * T + side * (T / 2 + .03 + depth / 2);
      const [x, z] = axis === 'x' ? [along, across] : [across, along];
      if (fits(ROADS, x, z, width / 2, depth / 2, axis)) out.push({ x, z, width, depth, axis });
    }
  }
  // El remiendo se hunde con el paso de los carros: en casi la mitad se queda el agua.
  for (const patch of asphaltPatches(map)) {
    if (unit(Math.round(patch.x * 7), Math.round(patch.z * 7), 82) > .45) continue;
    const axis = Math.abs(Math.sin(patch.lane)) < .5 ? 'x' : 'z';
    const width = patch.trench ? patch.length * .6 : Math.min(patch.length, patch.width) * .8;
    const depth = patch.trench ? patch.width * .8 : width;
    if (fits(ROADS, patch.x, patch.z, width / 2, depth / 2, axis)) out.push({ x: patch.x, z: patch.z, width, depth, axis, patch: true });
  }
  // Baches del carril y losas hundidas del andén, más escasos.
  map.forEach((row, j) => row.forEach((type, i) => {
    const road = ROADS.has(type), paved = PAVED.has(type);
    if (!road && !paved) return;
    // Cada hueco que pinta la calle (mismo sorteo y mismo sitio que en StreetMarkings) guarda su agua.
    const hole = unit(i, j, 21);
    if (type === 'road' && hole >= .18 && hole < .184) {
      const x = i * T + (unit(i, j, 20) - .5) * 1.2, z = j * T + (unit(j, i, 20) - .5) * 1.2;
      if (fits(ROADS, x, z, .7, .6, 'x')) out.push({ x, z, width: 1.4, depth: 1.2, axis: 'x' });
      return;
    }
    if (unit(i, j, 75) > (road ? .03 : .014)) return;
    const axis = unit(j, i, 76) < .5 ? 'x' : 'z', width = (road ? 1.3 : .9) + unit(i, j, 77) * 1.7, depth = (road ? .8 : .55) + unit(j, i, 78) * .7;
    const x = i * T + (unit(i, j, 79) - .5) * .8, z = j * T + (unit(j, i, 80) - .5) * .8;
    if (fits(road ? ROADS : PAVED, x, z, width / 2, depth / 2, axis)) out.push({ x, z, width, depth, axis });
  }));
  return out;
}

/** Hilo de agua de 20 a 30 cm contra el sardinel, en tramos de un metro con el borde de afuera irregular. */
export function gutterBands(map, runs) {
  const out = [];
  for (const { axis, fixed, a, b, side } of runs) {
    const curb = fixed * T + side * (T / 2 + .015);
    const reach = k => .2 + unit(k, fixed * 2 + (side > 0 ? 1 : 0), 83) * .1;
    for (let k = Math.round(a * T - T / 2); k < Math.round(b * T + T / 2); k++) {
      const from = k, to = k + 1, mid = (from + to) / 2;
      const [x, z] = axis === 'x' ? [mid, curb + side * .15] : [curb + side * .15, mid];
      if (!ROADS.has(map[Math.round(z / T)]?.[Math.round(x / T)])) continue;
      out.push({ axis, side, curb, from, to, widths: [reach(from), reach(to)] });
    }
  }
  return out;
}

let puddleMaterial = null, lampGlow = null, formed = false;
const uniforms = {
  uPuddleLevel: { value: 0 }, uPuddleRain: { value: 0 }, uPuddleTime: { value: 0 }, uWetFloorEnv: { value: 1 },
  uPuddleSteps: { value: STEP_SLOTS }, uPuddleStepCount: { value: 0 }
};

const bucketKey = (x, z) => `${x},${z}`;

/** La misma interpolación lineal del atlas, evaluada a ras del agua. */
function maskDepth(data, u, v) {
  const px = Math.max(0, Math.min(MASK_SIZE - 1, u * MASK_SIZE - .5));
  const py = Math.max(0, Math.min(MASK_SIZE - 1, v * MASK_SIZE - .5));
  const x = Math.floor(px), y = Math.floor(py), i = (y * MASK_SIZE + x) * 4 + 3;
  const dx = x < MASK_SIZE - 1 ? 4 : 0, dy = y < MASK_SIZE - 1 ? MASK_SIZE * 4 : 0;
  const a = THREE.MathUtils.lerp(data[i], data[i + dx], px - x);
  const b = THREE.MathUtils.lerp(data[i + dy], data[i + dx + dy], px - x);
  return THREE.MathUtils.lerp(a, b, py - y) / 255;
}

/** La posición y UV salen de los mismos triángulos que se dibujan, incluidos los volteos del atlas. */
function onWater(positions, uv, a, b, c, x, y, z, edge, opacity, mask) {
  const ia = a * 3, ib = b * 3, ic = c * 3;
  const dx = x - positions[ia], dz = z - positions[ia + 2];
  const bx = positions[ib] - positions[ia], bz = positions[ib + 2] - positions[ia + 2];
  const cx = positions[ic] - positions[ia], cz = positions[ic + 2] - positions[ia + 2];
  const det = bx * cz - bz * cx;
  if (det === 0) return false;
  const wb = (dx * cz - dz * cx) / det, wc = (bx * dz - bz * dx) / det, wa = 1 - wb - wc;
  if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) return false;
  const floor = wa * positions[ia + 1] + wb * positions[ib + 1] + wc * positions[ic + 1] - LIFT;
  const height = y - floor;
  if (height < -.055 || height > .06) return false;
  const u = wa * uv[a * 2] + wb * uv[b * 2] + wc * uv[c * 2];
  const v = wa * uv[a * 2 + 1] + wb * uv[b * 2 + 1] + wc * uv[c * 2 + 1];
  return THREE.MathUtils.smoothstep(maskDepth(mask, u, v), edge, edge + .14) * opacity >= .2;
}

class PuddleFootsteps {
  constructor(material) {
    this.material = material;
    this.buckets = new Map();
    this.soles = Array.from({ length: 2 }, () => ({ center: new THREE.Vector3(), raised: false, valid: false }));
  }

  addChunk(geometry, ids) {
    const positions = geometry.getAttribute('position').array, uv = geometry.getAttribute('uv').array;
    const attribute = new Float32Array(positions.length / 3);
    for (const [i, id] of ids.entries()) {
      const a = i * 4, p = a * 3;
      attribute.fill(id, a, a + 4);
      const xs = [positions[p], positions[p + 3], positions[p + 6], positions[p + 9]];
      const zs = [positions[p + 2], positions[p + 5], positions[p + 8], positions[p + 11]];
      const x0 = Math.floor(Math.min(...xs) / T), x1 = Math.floor(Math.max(...xs) / T);
      const z0 = Math.floor(Math.min(...zs) / T), z1 = Math.floor(Math.max(...zs) / T);
      const quad = { positions, uv, a, id };
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const key = bucketKey(x, z);
        let bucket = this.buckets.get(key);
        if (!bucket) this.buckets.set(key, bucket = []);
        bucket.push(quad);
      }
    }
    geometry.setAttribute('aPuddleSurface', new THREE.BufferAttribute(attribute, 1));
  }

  /** Solo revisa los pozos que cruzan la celda de la suela. La película húmeda queda fuera. */
  step(x, y, z) {
    if (puddleMaterial !== this.material || !this.material.visible || !Number.isFinite(x + y + z)) return false;
    const nearby = this.buckets.get(bucketKey(Math.floor(x / T), Math.floor(z / T)));
    if (!nearby) return false;
    const edge = THREE.MathUtils.lerp(.62, .14, uniforms.uPuddleLevel.value) +
      Math.sin(x * 5.3 + z * 2.1) * Math.sin(z * 4.7 - x * 1.9) * .07;
    const { opacity, map } = this.material;
    for (const { positions, uv, a, id } of nearby) {
      if (!onWater(positions, uv, a, a + 1, a + 2, x, y, z, edge, opacity, map.image.data) &&
          !onWater(positions, uv, a, a + 2, a + 3, x, y, z, edge, opacity, map.image.data)) continue;
      const count = uniforms.uPuddleStepCount;
      if (count.value === STEP_WAVES) STEP_SLOTS.copyWithin(0, 4);
      else count.value++;
      const slot = (count.value - 1) * 4;
      STEP_SLOTS[slot] = x;
      STEP_SLOTS[slot + 1] = z;
      STEP_SLOTS[slot + 2] = 0;
      STEP_SLOTS[slot + 3] = id;
      return true;
    }
    return false;
  }

  updateFootfalls(player, wasGrounded) {
    const { soles } = this, { character } = player;
    if (puddleMaterial !== this.material || !this.material.visible || !wasGrounded || !player.isGrounded || player.inWater || player.ridingBike ||
        player.isStunned || player.isRagdollActive || player.groundSurface?.layer === 'viaduct' ||
        !(player.speed >= .15) || this.character !== character) {
      for (const sole of soles) sole.raised = false;
      this.character = character;
      return;
    }
    for (const sole of soles) sole.valid = false;
    character?.sampleSoleContacts?.(soles);
    if (!soles[0].valid || !soles[1].valid) return;
    const lift = THREE.MathUtils.clamp(player.speed * .008, .0015, .012);
    for (let i = 0; i < soles.length; i++) {
      const sole = soles[i];
      const { x, y, z } = sole.center;
      const aboveOther = y - soles[1 - i].center.y;
      // La altura relativa conserva el apoyo con ambos modelos, incluso con pasos cortos.
      if (aboveOther > lift) sole.raised = true;
      else if (sole.raised && aboveOther <= lift / 3 && y <= player.position.y + .06) {
        sole.raised = false;
        this.step(x, y, z);
      }
    }
  }
}

// El entorno fijo de la noche son vitrinas encendidas: en el piso mojado salían como cajas de luz flotando
// sobre la calzada. Como el agua del lago, de noche el piso mojado y los charcos casi no lo devuelven.
const FLOOR_ENV_NIGHT = .3, PUDDLE_ENV_NIGHT = .22;
const floorUniforms = { uWetFloorEnv: { value: 1 } };
let floorWetness = 0;

/** Pisos que se mojan con la lluvia: calzada, troncal, adoquín, andenes, plazas y pisos. */
export function wetsWithRain(name) {
  return ['road', 'busway', 'road_cobbles', 'floor'].includes(name) || name.startsWith('sidewalk') || name.startsWith('plaza');
}

/** Lo mojado que está el piso (0 a 1), como lo recibe su material. */
export function setFloorWetness(wet) {
  floorWetness = Math.min(1, Math.max(0, wet || 0));
}

function followNight(scene) {
  const night = 1 - Math.min(1, Math.max(0, scene?.userData?.environmentDay ?? 1));
  floorUniforms.uWetFloorEnv.value = 1 - floorWetness * night * (1 - FLOOR_ENV_NIGHT);
}

/** El reflejo del entorno en el piso baja de noche en lo que esté mojado; en seco y de día queda igual. */
export function wetFloorEnvironment(material, mask = null) {
  if (material.userData.wetFloor) return material;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.userData.wetFloor = true;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, floorUniforms);
    shader.fragmentShader = `uniform float uWetFloorEnv;\n${shader.fragmentShader}`.replace('#include <aomap_fragment>', `#include <aomap_fragment>
#if defined( USE_ENVMAP ) && defined( STANDARD )
  reflectedLight.indirectSpecular *= ${mask ? `mix(1.0, uWetFloorEnv, ${mask})` : 'uWetFloorEnv'};
#endif`);
  };
  material.customProgramCacheKey = () => `${key}|piso-mojado`;
  material.onBeforeRender = (_renderer, scene) => followNight(scene);
  return material;
}

// Los charcos de antes tomaban del azar de la ciudad 108 números: la textura, el material, sus diez lotes y
// los cuatro sectores que armaban solos. Los de ahora nacen con azar propio y toman esos mismos 108, cuantos
// charcos haya: la ciudad sembrada reparte igual lo que se sortea después, como los carros parqueados.
const CITY_DRAWS = 108;
let puddleIdState = 0x0c4a2c05;
const puddleRandom = () => {
  puddleIdState = puddleIdState + 0x6d2b79f5 | 0;
  let t = Math.imul(puddleIdState ^ puddleIdState >>> 15, 1 | puddleIdState);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

/**
 * La lluvia ya cayó: aparecen los charcos y el pavimento mojado devuelve más luz de los faroles.
 * `rain` es la lluvia que cae ahora (0 a 1): riza el agua y la llena de anillos de gota.
 */
export function setPuddles(wetness, rain = 0, dt = 0) {
  // El pozo tarda en llenarse y, ya lleno, aguanta cuando el asfalto empieza a secar: se encoge antes de irse.
  if (wetness >= .85) formed = true; else if (wetness < .1) formed = false;
  const k = Math.min(1, Math.max(0, formed ? (wetness - .1) / .5 : (wetness - .3) / .55)), level = k * k * (3 - 2 * k);
  uniforms.uPuddleLevel.value = level;
  uniforms.uPuddleRain.value = Math.min(1, Math.max(0, rain || 0));
  const elapsed = Math.max(0, dt);
  uniforms.uPuddleTime.value = (uniforms.uPuddleTime.value + elapsed) % 600;
  if (puddleMaterial) {
    puddleMaterial.opacity = .92 * Math.min(1, level * 3);
    puddleMaterial.visible = level > .01;
  }
  const count = uniforms.uPuddleStepCount;
  let kept = 0;
  if (level > .01) for (let i = 0; i < count.value; i++) {
    const slot = i * 4;
    const progress = STEP_SLOTS[slot + 2] + elapsed / WAVE_SECONDS;
    if (progress >= 1) continue;
    const next = kept++ * 4;
    if (next !== slot) STEP_SLOTS.copyWithin(next, slot, slot + 4);
    STEP_SLOTS[next + 2] = progress;
  }
  count.value = kept;
  lampGlow?.color.setScalar(1 + level * .2);
}

const FRAGMENT_DECLARATIONS = /* glsl */`
uniform float uPuddleLevel;
uniform float uPuddleRain;
uniform float uPuddleTime;
uniform float uWetFloorEnv;
uniform vec4 uPuddleSteps[${STEP_WAVES}];
uniform int uPuddleStepCount;
varying vec2 vPuddleXZ;
varying float vPuddleSurface;
`;

// El nivel del agua corta la hondura del pozo: lleno llega al borde, al secar queda solo lo hondo, con orilla húmeda.
const FRAGMENT_SHAPE = /* glsl */`
float puddleDepth = 1.0;
#ifdef USE_MAP
  puddleDepth = texture2D( map, vMapUv ).a;
#endif
// El borde se come distinto según dónde caiga el charco: la misma silueta no se repite igual.
float puddleEdge = mix( .62, .14, uPuddleLevel ) + sin( vPuddleXZ.x * 5.3 + vPuddleXZ.y * 2.1 ) * sin( vPuddleXZ.y * 4.7 - vPuddleXZ.x * 1.9 ) * .07;
float puddleBody = smoothstep( puddleEdge, puddleEdge + .14, puddleDepth );
float puddleFilm = smoothstep( puddleEdge - .14, puddleEdge + .02, puddleDepth );
diffuseColor.a *= max( puddleBody, puddleFilm * .5 );
`;

// Rizado leve siempre y, mientras llueve, anillos de gota que se abren y se apagan: todo calculado, sin textura.
const FRAGMENT_RIPPLES = /* glsl */`
#include <normal_fragment_maps>
{
  vec2 pw = vPuddleXZ;
  float pt = uPuddleTime;
  vec2 puddleTilt = vec2(
    sin( pw.x * 9.1 + pw.y * 4.3 + pt * 1.7 ) + sin( pw.y * 11.7 - pw.x * 5.2 - pt * 2.3 ),
    sin( pw.y * 8.3 - pw.x * 3.7 + pt * 1.9 ) + sin( - pw.x * 10.3 - pw.y * 6.1 - pt * 2.1 )
  ) * ( .01 + .028 * uPuddleRain );
  float puddleRing = 0.0;
  if ( uPuddleRain > .01 ) {
    vec2 pg = pw * 2.4;
    vec2 pid = floor( pg );
    float ph = fract( sin( dot( pid, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    float ph2 = fract( ph * 57.31 );
    vec2 pd = fract( pg ) - .5 - ( vec2( ph2, fract( ph * 13.7 ) ) - .5 ) * .36;
    float life = fract( pt * ( .7 + .6 * ph2 ) + ph * 7.0 );
    float pr = length( pd );
    float front = ( pr - life * .3 ) / .012;
    // Un anillo más fino que un píxel titila: de lejos se apaga.
    float near = smoothstep( .05, .015, length( fwidth( pg ) ) );
    puddleRing = exp( - front * front ) * ( 1.0 - life ) * step( ph2, .3 + .7 * uPuddleRain ) * near;
    puddleTilt += pd / max( pr, .001 ) * puddleRing * .18;
  }
  float stepCrest = 0.0;
  if ( uPuddleStepCount > 0 ) {
    float pixel = length( fwidth( pw ) );
    float waveWidth = max( .023, pixel * .7 );
    float nearStep = 1.0 - smoothstep( .055, .15, pixel );
    for ( int i = 0; i < ${STEP_WAVES}; i++ ) {
      if ( i >= uPuddleStepCount ) break;
      vec4 wave = uPuddleSteps[i];
      if ( abs( wave.w - vPuddleSurface ) > .5 || puddleBody < .01 ) continue;
      vec2 delta = pw - wave.xy;
      float dist = length( delta );
      float radius = .025 + wave.z * 1.09;
      float front = ( dist - radius ) / waveWidth;
      float back = ( dist - radius + .10 ) / waveWidth;
      float crest = exp( - front * front );
      float trailing = exp( - back * back ) * smoothstep( .07, .17, wave.z );
      float strength = ( 1.0 - smoothstep( .10, 1.0, wave.z ) ) * nearStep;
      stepCrest += ( crest + trailing * .58 ) * strength;
      puddleTilt += delta / max( dist, .001 ) * ( crest - trailing * .7 ) * strength * .34;
    }
  }
  normal = normalize( normal + ( viewMatrix * vec4( puddleTilt.x, 0.0, puddleTilt.y, 0.0 ) ).xyz * puddleBody );
  diffuseColor.rgb += puddleRing * puddleBody * .035;
  diffuseColor.rgb += stepCrest * puddleBody * .19;
}
`;

function puddleShader(shader) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = `attribute float aPuddleSurface;\nvarying float vPuddleSurface;\nvarying vec2 vPuddleXZ;\n${shader.vertexShader}`
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPuddleXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;\nvPuddleSurface = aPuddleSurface;');
  shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader
    .replace('#include <map_fragment>', FRAGMENT_SHAPE)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( .42, roughnessFactor, puddleBody );')
    .replace('#include <normal_fragment_maps>', FRAGMENT_RIPPLES)
    // El agua quieta vista en diagonal es espejo del cielo: sin esto el charco es una mancha oscura sobre asfalto oscuro.
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.specularColor = vec3( mix( .04, .075, puddleBody * smoothstep( puddleEdge, puddleEdge + .35, puddleDepth ) ) );
material.specularColorBlended = material.specularColor;`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectSpecular *= uWetFloorEnv;`);
}

/** Charcos y piso mojado. Los lotes van en su propio grupo, con sus sectores, y no en los de la calle (`group`). */
export function addStreetPuddles(group, district, runs, glowMaterial = null) {
  for (let i = 0; i < CITY_DRAWS; i++) Math.random();
  const cityRandom = Math.random;
  Math.random = puddleRandom;
  try { return buildPuddles(district, runs, glowMaterial); } finally { Math.random = cityRandom; }
}

function buildPuddles(district, runs, glowMaterial) {
  for (const [name, material] of Object.entries(district.groundMaterials ?? {})) if (wetsWithRain(name)) wetFloorEnvironment(material);
  if (district.lakeTerrain?.material) wetFloorEnvironment(district.lakeTerrain.material, 'lakePavingMix');
  const material = new THREE.MeshStandardMaterial({
    map: puddleMask(), vertexColors: true, transparent: true, opacity: 0, visible: false, depthWrite: false,
    roughness: .05, metalness: 0, envMapIntensity: 1.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  material.name = 'Calle: charcos';
  material.onBeforeCompile = puddleShader;
  material.customProgramCacheKey = () => 'charcos';
  chainSunField(material);
  material.onBeforeRender = (_renderer, scene) => {
    const night = 1 - Math.min(1, Math.max(0, scene?.userData?.environmentDay ?? 1));
    uniforms.uWetFloorEnv.value = 1 - night * (1 - PUDDLE_ENV_NIGHT);
  };
  puddleMaterial = material;
  lampGlow = glowMaterial;
  uniforms.uPuddleStepCount.value = 0;
  material.addEventListener('dispose', () => {
    if (puddleMaterial !== material) return;
    puddleMaterial = lampGlow = null;
    uniforms.uPuddleStepCount.value = 0;
  });
  const footsteps = district.streetPuddles = new PuddleFootsteps(material);
  const batch = new StreetBatch({ material, name: 'Charcos', receiveShadow: true, renderOrder: -2, chunkSize: STATIC_CHUNK_SIZE * 4 });
  const color = tint('#232a30');
  // Cuatro pozos por cuatro volteos: dieciséis siluetas con una sola textura.
  const variants = [];
  for (const [cx, cy] of [[0, 0], [.5, 0], [0, .5], [.5, .5]]) {
    variants.push([cx, cy, cx + .5, cy + .5], [cx + .5, cy, cx, cy + .5], [cx, cy + .5, cx + .5, cy], [cx + .5, cy + .5, cx, cy]);
  }
  const plan = planPuddles(district.map, runs, (x, z) => district.getGroundHeight(x, z));
  // La cuneta lleva agua de punta a punta: un rincón de la textura donde el pozo es hondo parejo.
  const deep = [.2275, .245, .2475, .255];
  let id = 0, previousBand;
  for (const band of gutterBands(district.map, runs)) {
    const { axis, side, curb, from, to, widths } = band;
    const at = (along, across) => {
      const [x, z] = axis === 'x' ? [along, across] : [across, along];
      return [x, district.getGroundHeight(x, z) + LIFT, z];
    };
    const [x, , z] = at((from + to) / 2, curb);
    if (onLakeBridge(x, z) || inLakeTerrain(x, z)) continue;
    const corners = [at(from, curb), at(to, curb), at(to, curb + side * widths[1]), at(from, curb + side * widths[0])];
    const [a, b, c] = corners, up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (up < 0) corners.reverse();
    if (previousBand?.axis !== axis || previousBand.side !== side || previousBand.curb !== curb || previousBand.to !== from) id++;
    const chunk = batch.quad(...corners, [0, 1, 0], deep, color);
    (chunk.puddleSurfaces ??= []).push(id);
    previousBand = band;
  }
  for (const { x, z, width, depth, axis } of plan) {
    if (onLakeBridge(x, z) || inLakeTerrain(x, z)) continue;
    const y = district.getGroundHeight(x, z) + LIFT;
    const chunk = batch.decal(x, y, z, width, depth, axis === 'x' ? 0 : Math.PI / 2, variants[Math.floor(unit(Math.round(x), Math.round(z), 81) * 16)], color);
    (chunk.puddleSurfaces ??= []).push(++id);
  }
  const holder = new THREE.Group();
  holder.name = 'Calle: charcos';
  holder.userData.noMerge = true;
  batch.finish(holder, (geometry, chunk) => footsteps.addChunk(geometry, chunk.puddleSurfaces));
  district.group.add(holder);
  const sectors = createRenderSectors(holder);
  if (district.renderSectors) district.renderSectors.push(...sectors);
  freezeStaticTransforms(holder);
  return plan.length;
}
