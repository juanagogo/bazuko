import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cajaBiselada } from '../props/Banca.js';
import { rng } from './textures.js';
import { withVisualRandom } from './VisualRandom.js';
import { patchSunFieldShader } from './SunFieldShader.js';

const SIDES = 48;
const DEPTH = .60;
const WATER_Y = .663;
const DRAIN = .053;

// Perfil del vaciado. La cota del labio es .84 m y el fondo cae hacia el sumidero.
const BASIN = [[0, .46], [.44, .46], [.485, .468], [.699, .713], [.733, .752],
  [.746, .781], [.75, .80], [.75, .818], [.741, .832], [.726, .84], [.65, .84],
  [.635, .833], [.622, .817], [.61, .788], [.566, .718], [.54, .672], [.519, .649],
  [.435, .637], [.218, .62], [.07, .612], [DRAIN, .608], [DRAIN, .585], [0, .585]];

function lathe(profile, sides = SIDES) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), sides);
}

let grain;
function concreteGrain() {
  return grain ??= withVisualRandom(() => {
    const size = 128, pixels = new Uint8Array(size * size * 4), random = rng(0x70696c61);
    // Huecos y granos de dos tamaños, sobre árido gris tibio. El mismo relieve se lee en todas las pilas.
    const grains = Array.from({ length: 134 }, () => ({
      x: random() * size, y: random() * size,
      radius: 1.1 + 2.9 * random() ** 2, shade: (random() - .50) * 79
    }));
    const spots = new Float32Array(size * size);
    for (const { x, y, radius, shade } of grains) {
      for (let a = Math.floor(x - radius); a <= x + radius; a++) for (let b = Math.floor(y - radius); b <= y + radius; b++) {
        const d = Math.hypot(a - x, (b - y) * .87);
        const i = ((a + size) % size) + ((b + size) % size) * size;
        spots[i] += shade * (1 - THREE.MathUtils.smoothstep(d, radius * .35, radius));
      }
    }
    const grid = Array.from({ length: 64 }, () => (random() - .5) * 27);
    const tone = (x, y) => grid[(y % 8) * 8 + (x % 8)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const a = Math.floor(x / 16), b = Math.floor(y / 16);
      const u = THREE.MathUtils.smoothstep(x % 16, 0, 16), v = THREE.MathUtils.smoothstep(y % 16, 0, 16);
      const lo = THREE.MathUtils.lerp(tone(a, b), tone(a + 1, b), u);
      const hi = THREE.MathUtils.lerp(tone(a, b + 1), tone(a + 1, b + 1), u);
      const mottle = THREE.MathUtils.lerp(lo, hi, v);
      const i = y * size + x, value = THREE.MathUtils.clamp(Math.round(210 + mottle + spots[i] + (random() - .50) * 18), 0, 255);
      pixels.set([value, value, value, 255], i * 4);
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.name = 'Árido fino de las pilas';
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  });
}

class ConcreteBasinMaterial extends THREE.MeshStandardMaterial {
  onBeforeCompile(shader) {
    shader.uniforms.uBasinGrain = { value: this.map };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBasinPosition; varying vec3 vBasinNormal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvBasinNormal = objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBasinPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uBasinGrain;
        varying vec3 vBasinPosition, vBasinNormal;
        float basinGrain(vec3 p, vec3 n) {
          vec3 weights = pow(abs(normalize(n)), vec3(4.));
          weights /= max(.001, weights.x + weights.y + weights.z);
          p *= 3.2;
          return weights.x * texture2D(uBasinGrain, p.zy + vec2(.13, .41)).r
            + weights.y * texture2D(uBasinGrain, p.xz + vec2(.31, .67)).r
            + weights.z * texture2D(uBasinGrain, p.xy).r;
        }`)
      .replace('#include <map_fragment>', 'float grain = basinGrain(vBasinPosition, vBasinNormal); diffuseColor.rgb *= grain;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float radius = length(vBasinPosition.xz * vec2(1., 1. / ${DEPTH.toFixed(2)}));
        float polished = smoothstep(.785, .839, vBasinPosition.y) * smoothstep(.606, .70, radius);
        float underTap = smoothstep(-.452, -.385, vBasinPosition.z) * (1. - smoothstep(-.11, .025, vBasinPosition.z));
        float trail = (vBasinPosition.x + .025 * sin(29. * vBasinPosition.z)) / (.064 + (.84 - vBasinPosition.y) * .29);
        float splash = underTap * exp(-trail * trail) * smoothstep(.59, .65, vBasinPosition.y);
        float level = ${WATER_Y.toFixed(3)} + .0045 * sin(vBasinPosition.z * 48. + vBasinPosition.x * 22.);
        float tide = (1. - smoothstep(.003, .021, abs(vBasinPosition.y - level))) * (1. - smoothstep(.552, .599, radius));
        float damp = clamp(.83 * splash + .42 * tide, 0., 1.);
        diffuseColor.rgb *= (1. + .13 * polished) * mix(vec3(1.), vec3(.66, .72, .69), damp);
        diffuseColor.rgb *= .87 + .13 * smoothstep(.018, .26, vBasinPosition.y);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= 1. - .17 * polished - .29 * damp;')
      // Una misma escala en el borde, fondo y pedestal, sin estirar el grano de un anillo al siguiente.
      .replace('#include <normal_fragment_maps>', `#ifdef USE_BUMPMAP
        float relief = grain * bumpScale * (1. - .49 * polished);
        normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(relief), dFdy(relief)), faceDirection);
      #endif`);
    patchSunFieldShader(shader);
  }
}

class ShallowWaterMaterial extends THREE.MeshStandardMaterial {
  onBeforeCompile(shader) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBasinWaterUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBasinWaterUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBasinWaterUv;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 ripple = vec2(sin(dot(vBasinWaterUv, vec2(39., 11.))), cos(dot(vBasinWaterUv, vec2(17., 32.)))) * .014;
        normal = normalize(normal + mat3(viewMatrix) * vec3(ripple.x, 0., ripple.y));
        float facing = clamp(abs(dot(normalize(vViewPosition), normal)), 0., 1.);
        float fresnel = pow(1. - facing, 2.4);
        float shore = smoothstep(.90, .993, length((vBasinWaterUv - .5) * 2.));
        diffuseColor.a *= mix(.42, .95, fresnel) * (1. - .33 * shore);
        diffuseColor.rgb *= 1. + .12 * shore;`);
    patchSunFieldShader(shader);
  }
}

/** Estos materiales pertenecen a la pila. La puerta y los torniquetes conservan los suyos. */
export function createPilaSurfaceMaterials() {
  const map = concreteGrain();
  const concrete = { map, bumpMap: map, bumpScale: .005, roughness: .92, envMapIntensity: .37 };
  return {
    concreto: new ConcreteBasinMaterial({ ...concrete, color: '#b0aa9d' }),
    concretoOscuro: new ConcreteBasinMaterial({ ...concrete, color: '#908a7d' }),
    agua: new ShallowWaterMaterial({ color: '#527c83', roughness: .21, metalness: .04, envMapIntensity: .96,
      transparent: true, opacity: .77, depthWrite: false, forceSinglePass: true })
  };
}

let hardware;
function hardwareMaterials() {
  return hardware ??= withVisualRandom(() => {
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .39, metalness: .63, envMapIntensity: .94 });
    const handle = new THREE.MeshStandardMaterial({ color: '#8c3329', metalness: .19, roughness: .61 });
    metal.userData.shared = handle.userData.shared = true;
    return { metal, handle };
  });
}

function faucetGeometry(tube, path) {
  const pieces = [];
  const tint = (geometry, color) => {
    const c = new THREE.Color(color), p = geometry.attributes.position, attr = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const tone = .90 + .10 * Math.sin(2.9 * i + .6) ** 2;
      c.toArray(attr, i * 3);
      for (let n = i * 3; n < i * 3 + 3; n++) attr[n] *= tone;
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(attr, 3));
    pieces.push(geometry);
  };
  tint(tube, '#9baba9');
  tint(lathe([[.031, .837], [.043, .837], [.046, .843], [.046, .855], [.041, .863], [.032, .863]], 20).translate(0, 0, -.402), '#9aa7a5');
  tint(new THREE.CylinderGeometry(.042, .044, .035, 6).translate(0, .879, -.405), '#a18b6a');
  tint(new THREE.CylinderGeometry(.032, .037, .023, 14).translate(0, .908, -.408), '#756f60');
  const tip = path.getPointAt(1), tangent = path.getTangentAt(1).negate();
  const nozzle = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  const collar = (profile, color) => tint(lathe(profile, 20).applyQuaternion(nozzle).translate(...tip), color);
  collar([[.022, -.013], [.035, -.013], [.041, -.008], [.041, .011], [.037, .019], [.035, .025], [.034, .025]], '#778581');
  collar([[.027, -.015], [.038, -.015], [.039, -.010], [.036, -.007], [.027, -.007], [.027, -.015]], '#bbc5bf');
  collar([[.022, -.012], [.023, -.005], [.023, .012], [.024, .012], [.024, -.012], [.022, -.012]], '#3d4540');

  // Aro del desagüe, rejilla hundida y garganta oscura debajo de los espacios entre barras.
  tint(lathe([[.043, .604], [.064, .604], [.063, .611], [.06, .614], [.049, .614], [.043, .611], [.043, .604]], 24), '#717e77');
  tint(new THREE.CircleGeometry(.047, 24).rotateX(-Math.PI / 2).translate(0, .588, 0), '#292e29');
  for (const x of [-.027, 0, .027]) {
    const d = 2 * Math.sqrt(.046 ** 2 - x * x);
    tint(cajaBiselada(.009, .007, d, .0015).translate(x, .605, 0), '#6f7972');
  }
  const result = mergeGeometries(pieces);
  for (const geometry of pieces) geometry.dispose();
  return result;
}

export function addPublicBasin(group, materials) {
  const { metal, handle } = hardwareMaterials();
  const base = new THREE.Mesh(cajaBiselada(.52, .52, .38, .018).translate(0, .26, 0), materials.concretoOscuro);
  const basin = new THREE.Mesh(lathe(BASIN).scale(1, 1, DEPTH), materials.concreto);
  // El disco nace de la intersección real con el talud. El agua tapa el fondo y la rejilla sigue debajo.
  const [a, b] = [BASIN[16], BASIN[15]];
  const radius = THREE.MathUtils.lerp(a[0], b[0], (WATER_Y - a[1]) / (b[1] - a[1])) + .0008;
  const water = new THREE.Mesh(new THREE.CircleGeometry(radius, SIDES).rotateX(-Math.PI / 2)
    .scale(1, 1, DEPTH).translate(0, WATER_Y, 0), materials.agua);
  const path = new THREE.CatmullRomCurve3([[0, .77, -.41], [0, .99, -.41], [0, 1.12, -.36], [0, 1.12, -.15], [0, 1.04, -.12]]
    .map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const tube = new THREE.TubeGeometry(path, 26, .035, 12, false);
  // El arco suave conserva la cota superior y el remate dentro de la planta de la pila anterior.
  const pipe = tube.attributes.position;
  for (let i = 0; i < pipe.count; i++) {
    pipe.setY(i, Math.min(pipe.getY(i), 1.171));
    pipe.setZ(i, Math.max(pipe.getZ(i), -.45));
  }
  const faucet = new THREE.Mesh(withVisualRandom(() => faucetGeometry(tube, path)), metal);
  const lever = new THREE.Mesh(cajaBiselada(.21, .045, .07, .009).translate(.06, .99, -.40), handle);
  base.name = 'Pila pública · pedestal';
  basin.name = 'Pila pública · cuenco y labio';
  water.name = 'Pila pública · agua baja';
  faucet.name = 'Pila pública · llave y sumidero';
  lever.name = 'Pila pública · palanca';
  for (const mesh of [base, basin, faucet, lever]) mesh.castShadow = mesh.receiveShadow = true;
  water.receiveShadow = true;
  group.add(base, basin, water, faucet, lever);
}
