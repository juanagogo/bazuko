import * as THREE from 'three';
import { chainSunField } from './SunFieldShader.js';
import { withVisualRandom } from './VisualRandom.js';
import { rng } from './textures.js';

export const FOUNTAIN_LEVELS = Object.freeze({ basin: .585, bowl: 3.017, crown: 4.17 });
export const FOUNTAIN_LIPS = {
  bowl: { count: 4, yaw: Math.PI / 8, sides: 64, fade: .77, full: .92 },
  crown: { count: 4, yaw: Math.PI / 4, sides: 64, fade: .71, full: .91 },
};
export const FOUNTAIN_NOZZLES = { count: 2, yaw: .92, radius: .258, height: 4.65 };

const TAU = 2 * Math.PI, GRAVITY = 9.81;
const NO_SPRAY = [0, 0, 0, 0];
const { lerp, smoothstep, clamp } = THREE.MathUtils;
const STREAMS = [
  { ...FOUNTAIN_LIPS.bowl, entry: 1.38, source: FOUNTAIN_LEVELS.bowl, radius: 1.553,
    height: 3.021, landing: 2.27, vy: -.18, width: .065, spray: 1 },
  { ...FOUNTAIN_LIPS.crown, entry: .543, source: FOUNTAIN_LEVELS.crown, radius: .708,
    height: 4.175, landing: 1.14, vy: -.13, width: .049, spray: .69 },
  { ...FOUNTAIN_NOZZLES, landing: .439, vy: .22, width: .022, spray: .42 },
];

export function fountainRimNotch(lip, angle) {
  return smoothstep(Math.cos((angle - lip.yaw) * lip.count), lip.fade, lip.full);
}

function timeToWater(height, verticalSpeed, level) {
  return (verticalSpeed + Math.sqrt(verticalSpeed ** 2 + 2 * GRAVITY * (height - level))) / GRAVITY;
}

function fountainMaterial(impacts, shore) {
  const uniforms = {
    fountainTime: { value: 0 },
    fountainRain: { value: 0 },
    fountainHorizon: { value: new THREE.Color('#a1b1bb') },
    fountainImpacts: { value: impacts },
    fountainShore: { value: shore },
  };
  const material = new THREE.MeshStandardMaterial({
    name: 'Fuente de La Candelaria · agua',
    roughness: .22, envMapIntensity: 1.1, transparent: true, depthWrite: false,
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    const varyings = 'varying vec2 vFountainXZ;\nvarying vec4 vFountainFlow;\nvarying float vSplashLife;\n';
    shader.vertexShader = varyings + `
uniform float fountainTime;
attribute vec4 fountainFlow;
attribute vec4 fountainParticle;
` + shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
vFountainXZ = position.xz;
vFountainFlow = fountainFlow;
vSplashLife = 0.0;
if (fountainFlow.y > 15.5) {
  vSplashLife = fract(fountainTime / fountainFlow.x + fountainParticle.w);
  float age = vSplashLife * fountainFlow.x;
  transformed += (fountainParticle.xyz - vec3(0.0, ${GRAVITY / 2} * age, 0.0)) * age;
}
`);
    shader.fragmentShader = varyings + `
uniform float fountainTime;
uniform float fountainRain;
uniform vec3 fountainHorizon;
uniform vec2 fountainImpacts[12];
uniform vec3 fountainShore;
` + shader.fragmentShader.replace('#include <normal_fragment_maps>', `
#include <normal_fragment_maps>
float fountainLayer = vFountainFlow.y;
float waterDistance = length(vViewPosition);
if (fountainLayer < 2.5) {
  int tier = int(fountainLayer + .5);
  float detail = 1.0 - smoothstep(22.0, 49.0, waterDistance);
  vec2 p = vFountainXZ;
  vec2 curl = vec2(p.x + .19 * sin(p.y * 3.9 + fountainTime * .66), p.y + .14 * cos(p.x * 3.7 - fountainTime * .74));
  vec2 slope = vec2(sin(dot(curl, vec2(9.0, 13.0)) + fountainTime * 3.1),
    cos(dot(curl, vec2(14.0, -8.0)) - fountainTime * 2.5)) * .07 * detail;
  float churn = 0.0;
  float ripples = 0.0;
  if (detail > .002) {
    float scale = tier == 0 ? 1.0 : (tier == 1 ? .65 : .39);
    for (int i = 0; i < 4; i++) {
      vec2 offset = p - fountainImpacts[tier * 4 + i];
      float radius = length(offset) / scale;
      vec2 axis = offset / max(length(offset), .02);
      float edge = sin(dot(offset, vec2(17.0, 23.0)) + fountainTime * 4.2 + float(i));
      float pressure = cos(radius * 43.0 - fountainTime * 23.0 + float(i) * 1.64 + edge * .65);
      float envelope = smoothstep(.046, .115, radius) * (1.0 - smoothstep(.18, .74, radius)) * detail;
      slope += axis * pressure * envelope * .33;
      ripples = max(ripples, smoothstep(.44, .95, pressure) * envelope * (.61 + .39 * edge));
      float bubbles = .5 + .5 * sin(dot(p, vec2(43.0, -31.0)) + edge * 3.3 - fountainTime * 5.4);
      float impact = 1.0 - smoothstep(.034, .163, radius + edge * .024);
      churn = max(churn, impact * (.36 + .64 * bubbles) * detail);
    }
    if (fountainRain > .025) {
      vec2 cell = floor(p * 3.2);
      float offset = fract(dot(cell, vec2(.374521, .743653)) + fract(cell.x * cell.y * .81231));
      float age = fract(fountainTime * 1.35 + offset);
      vec2 delta = fract(p * 3.2) - vec2(.35 + offset * .26, .39 + fract(offset * 7.3) * .22);
      float r = length(delta);
      float rainRing = (1.0 - smoothstep(.013, .078, abs(r - age * .32))) * (1.0 - age);
      slope += delta / max(r, .045) * rainRing * fountainRain * .19 * detail;
    }
  }
  normal = normalize(normal - mat3(viewMatrix) * vec3(slope.x, 0.0, slope.y));
  float sky = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.4);
  float shore = smoothstep(fountainShore[tier] - .075, fountainShore[tier], length(p));
  vec3 tintedSky = mix(vec3(.18, .27, .26), .72 * fountainHorizon, .57);
  vec3 water = mix(vec3(.045, .097, .079), tintedSky, .18 + sky * .73);
  diffuseColor.rgb *= mix(water * (1.0 - .28 * shore), vec3(.59, .72, .68), max(churn * .81, ripples * .21));
  diffuseColor.a *= mix(.49 + sky * .40 - shore * .13, .92, churn);
  roughnessFactor = .19 + .06 * fountainRain + .12 * churn;
} else if (fountainLayer < 15.5) {
  // El tiempo de vuelo conserva el ritmo de las estrías al acelerarse hacia el cuenco.
  float flight = vFountainFlow.z;
  float elapsed = (vFountainFlow.x - fountainTime) * 26.0 + fountainLayer * 1.9;
  float streak = sin(elapsed + 1.41 * sin(elapsed * .71 + vFountainFlow.w * 2.0));
  float strand = cos(elapsed * 1.8 - vFountainFlow.w + .9 * sin(elapsed * .49));
  float highlights = smoothstep(.32, .94, streak) * smoothstep(-.27, .78, strand);
  float aeration = smoothstep(.21, .89, flight);
  float glaze = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.6);
  float closeDetail = 1.0 - smoothstep(14.0, 32.0, waterDistance);
  float horizonLight = dot(fountainHorizon, vec3(.2126, .7152, .0722));
  vec3 reflection = mix(vec3(horizonLight), fountainHorizon, .28);
  vec3 body = mix(vec3(.23, .31, .30), vec3(.24, .27, .27), .3 + fountainRain * .7);
  vec3 light = mix(vec3(.77, .79, .75), reflection, .21);
  float sheen = .16 + highlights * .48 + glaze * .22 + aeration * .12;
  diffuseColor.rgb *= mix(body, light, mix(.41 + glaze * .15, sheen, closeDetail));
  float clearAlpha = .52 + highlights * .22 + glaze * .15 + aeration * .07;
  diffuseColor.a *= mix(.79, clearAlpha, closeDetail) * smoothstep(-.24, -.11, flight)
    * (1.0 - smoothstep(.964, 1.01, flight));
  roughnessFactor = .145 + aeration * .17 + highlights * .09;
} else {
  float alpha = smoothstep(0.0, .12, vSplashLife) * (1.0 - smoothstep(.78, 1.0, vSplashLife));
  diffuseColor.rgb *= mix(vec3(.61, .77, .73), fountainHorizon, .22);
  diffuseColor.a *= .81 * alpha * (1.0 - smoothstep(16.0, 35.0, waterDistance));
  roughnessFactor = .23;
}
`);
  };
  material.customProgramCacheKey = () => 'agua-fuente-candelaria';
  chainSunField(material);
  return { material, uniforms };
}

/** Las láminas, las caídas y las salpicaduras comparten malla y se sincronizan con la partida. */
export function buildPlazaFountainWater({ x, y, z, radius }) {
  return withVisualRandom(() => {
    const positions = [], normals = [], flow = [], particles = [], indices = [], impacts = [];
    const shore = new THREE.Vector3(radius - .067, 1.427, .600);
    const levels = [FOUNTAIN_LEVELS.basin, FOUNTAIN_LEVELS.bowl, FOUNTAIN_LEVELS.crown];
    const random = rng(219378);
    const vertex = (point, normal, state, spray = NO_SPRAY) => {
      positions.push(...point);
      normals.push(...normal);
      flow.push(...state);
      particles.push(...spray);
    };
    function joinRings(first, columns, rows) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
        const a = first + j * (columns + 1) + i, b = a + 1, c = a + columns + 1;
        indices.push(a, c, b, b, c, c + 1);
      }
    }
    function dish(inner, outer, level, segments, layer) {
      const first = positions.length / 3;
      const normal = [0, 1, 0], state = [0, layer, 0, 0];
      for (const r of [inner, outer]) for (let i = 0; i <= segments; i++) {
        const angle = i * TAU / segments;
        vertex([r * Math.sin(angle), level, r * Math.cos(angle)], normal, state);
      }
      joinRings(first, segments, 1);
    }
    dish(.73, shore.x, levels[0], 40, 0);
    dish(.289, shore.y, levels[1], FOUNTAIN_LIPS.bowl.sides, 1);
    dish(.199, shore.z, levels[2], FOUNTAIN_LIPS.crown.sides, 2);

    // Se guardan para el final del índice: las gotas transparentes se dibujan encima de las láminas.
    const splashes = [];
    for (const [layer, stream] of STREAMS.entries()) {
      const level = levels[layer];
      const duration = timeToWater(stream.height, stream.vy, level);
      const speed = (stream.landing - stream.radius) / duration;
      const ledgeTime = stream.entry ? (stream.radius - stream.entry) / speed : 0;
      for (let i = 0; i < 4; i++) {
        if (i >= stream.count) { impacts.push(new THREE.Vector2(-20, -20)); continue; }
        const heading = stream.yaw + i * TAU / stream.count;
        const sx = Math.sin(heading), sz = Math.cos(heading);
        const impact = new THREE.Vector2(stream.landing * sx, stream.landing * sz);
        impacts.push(impact);
        const first = positions.length / 3, rows = 28, ledge = stream.entry ? 6 : 0, sides = 8;
        for (let j = -ledge; j <= rows; j++) {
          const t = j < 0 ? ledgeTime * j / ledge : duration * j / rows;
          const flight = Math.max(0, t / duration);
          const vy = j < 0 ? (stream.height - stream.source) / ledgeTime : stream.vy - GRAVITY * t;
          const height = j < 0 ? lerp(stream.source + .004, stream.height, 1 + t / ledgeTime)
            : stream.height + (stream.vy - GRAVITY * t / 2) * t;
          const center = stream.radius + speed * t;
          const tangent = Math.hypot(speed, vy);
          const bite = .94 + .06 * Math.sin(flight * 23 + i * 2.1);
          // La película ancha del labio se recoge al acelerar fuera de la piedra.
          const narrowing = smoothstep(flight, 0, stream.entry ? .305 : .49);
          const width = stream.width * bite * (1 - .54 * narrowing);
          const depth = width * (stream.entry ? lerp(.21, .90, smoothstep(flight, 0, .21)) : 1);
          const radial = -vy / tangent, up = speed / tangent;
          for (let s = 0; s <= sides; s++) {
            const a = s * TAU / sides, along = Math.cos(a), across = Math.sin(a);
            const r = center + radial * along * depth, cross = across * width;
            const point = [r * sx + cross * sz, height + up * along * depth, r * sz - cross * sx];
            const normal = [radial * along * sx + across * sz, up * along, radial * along * sz - across * sx];
            vertex(point, normal, [t, 3 + layer * 4 + i, t / duration, a]);
          }
        }
        joinRings(first, sides, rows + ledge);
        for (let n = 0; n < 12; n++) {
          const angle = TAU * (n + random()) / 12, kick = .35 + random() * .75;
          splashes.push({ x: impact.x + Math.sin(angle) * .044 * stream.spray,
            y: level + .003, z: impact.y + Math.cos(angle) * .044 * stream.spray, level,
            vx: Math.sin(angle) * kick * stream.spray, vy: (.72 + random() * 1.28) * stream.spray ** .66,
            vz: Math.cos(angle) * kick * stream.spray, width: (.011 + random() * .014) * stream.spray ** .56 });
        }
        for (let n = 0; n < 5; n++) {
          const t = duration * (.35 + .47 * random()), center = stream.radius + speed * t;
          const side = ((n % 2) * 2 - 1) * (.15 + .31 * random()) * stream.spray;
          splashes.push({ x: center * sx + side * .085 * sz, y: stream.height + (stream.vy - GRAVITY * t / 2) * t,
            z: center * sz - side * .085 * sx, level, vx: sx * speed + side * sz, vy: stream.vy - GRAVITY * t,
            vz: sz * speed - side * sx, width: (.010 + random() * .01) * stream.spray ** .56 });
        }
      }
    }
    const axes = [[0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, -1, 0]];
    let low = levels[0], high = FOUNTAIN_NOZZLES.height;
    for (const { x, y, z, level, vx, vy, vz, width } of splashes) {
      const time = timeToWater(y, vy, level);
      const apex = Math.max(0, vy / GRAVITY);
      low = Math.min(low, level - width * 1.28);
      high = Math.max(high, y + (vy - GRAVITY * apex / 2) * apex + width * 1.28);
      const first = positions.length / 3, state = [time, 16, 0, 0], kick = [vx, vy, vz, random()];
      for (const normal of axes) {
        const [nx, ny, nz] = normal;
        vertex([x + width * nx, y + width * ny * 1.28, z + width * nz], normal, state, kick);
      }
      for (let i = 0; i < 4; i++) {
        const a = first + 1 + i, b = first + 1 + (i + 1) % 4;
        indices.push(first, a, b, first + 5, b, a);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('fountainFlow', new THREE.Float32BufferAttribute(flow, 4));
    geometry.setAttribute('fountainParticle', new THREE.Float32BufferAttribute(particles, 4));
    geometry.setIndex(indices);
    // Completar los límites estáticos con la altura que pueden alcanzar las gotas en el shader.
    geometry.computeBoundingBox();
    geometry.boundingBox.min.y = Math.min(geometry.boundingBox.min.y, low);
    geometry.boundingBox.max.y = Math.max(geometry.boundingBox.max.y, high);
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const { material, uniforms } = fountainMaterial(impacts, shore);
    const water = new THREE.Mesh(geometry, material);
    water.name = 'Lámina y caídas de la fuente';
    water.position.set(x, y, z);
    water.receiveShadow = true;
    water.userData.noMerge = true;
    water.userData.visualOnly = true;
    water.userData.update = dt => { uniforms.fountainTime.value += dt; };
    water.userData.setRain = amount => { uniforms.fountainRain.value = clamp(amount, 0, 1); };
    water.onBeforeRender = (_renderer, scene) => {
      if (scene.fog?.isFog) uniforms.fountainHorizon.value.copy(scene.fog.color);
    };
    return water;
  });
}
