import * as THREE from 'three';
import { FOUNTAIN_LEVELS, FOUNTAIN_LIPS, FOUNTAIN_NOZZLES } from './PlazaFountainWater.js';
import { chainSunField } from './SunFieldShader.js';
import { withVisualRandom } from './VisualRandom.js';

/** La humedad se queda en el vaso, la marca de nivel y las bocas de rebose de la piedra. */
export function plazaFountainStone(source, { x, y, z, radius }) {
  const material = withVisualRandom(() => source.clone());
  material.name = 'Piedra mojada de la fuente';
  const originAndRadius = new THREE.Vector4(x, y, z, radius);
  const level = Object.fromEntries(Object.entries(FOUNTAIN_LEVELS).map(([key, value]) => [key, value.toFixed(3)]));
  material.onBeforeCompile = shader => {
    shader.uniforms.fountainStoneOrigin = { value: originAndRadius };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 fountainStoneOrigin;\nvarying vec3 vFountainStone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFountainStone = position - fountainStoneOrigin.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 fountainStoneOrigin;\nvarying vec3 vFountainStone;')
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 rock = vFountainStone;
float radius = length(rock.xz);
float height = rock.y + .009 * sin(rock.x * 33. + rock.z * 21.) + .005 * cos(rock.z * 48.);
float wall = 1.0 - smoothstep(fountainStoneOrigin.w - .07, fountainStoneOrigin.w - .048, radius);
float bottom = smoothstep(.34, .366, height) * wall * (1.0 - smoothstep(${level.basin} + .025, ${level.basin} + .091, height));
float bowl = smoothstep(2.947, 2.977, height) * (1.0 - smoothstep(1.423, 1.489, radius))
  * (1.0 - smoothstep(${level.bowl}, ${level.bowl} + .063, height));
float crown = smoothstep(4.128, 4.147, height) * (1.0 - smoothstep(.578, .633, radius))
  * (1.0 - smoothstep(${level.crown}, ${level.crown} + .062, height));
float azimuth = atan(rock.x, rock.z + .000001) + .014 * sin(rock.y * 48.);
float bowlDrip = smoothstep(.94, .996, cos(${FOUNTAIN_LIPS.bowl.count.toFixed(1)} * (azimuth - ${FOUNTAIN_LIPS.bowl.yaw.toFixed(6)})))
  * smoothstep(2.79, 2.99, height) * (1.0 - smoothstep(3.04, 3.075, height)) * smoothstep(1.39, 1.51, radius);
float crownDrip = smoothstep(.90, .987, cos(${FOUNTAIN_LIPS.crown.count.toFixed(1)} * (azimuth - ${FOUNTAIN_LIPS.crown.yaw.toFixed(6)})))
  * smoothstep(4.04, 4.14, height) * (1.0 - smoothstep(4.182, 4.21, height)) * smoothstep(.56, .658, radius);
float wet = max(max(bottom, max(bowl, crown)), max(bowlDrip, crownDrip));
float mineral = wall * smoothstep(fountainStoneOrigin.w - .15, fountainStoneOrigin.w - .087, radius)
  * (1.0 - smoothstep(.003, .018, abs(height - (${level.basin} + .052))));
diffuseColor.rgb *= mix(vec3(1.0), vec3(.55, .64, .59), wet) + mineral * vec3(.16, .14, .09);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= (1.0 - .61 * wet);');
  };
  material.customProgramCacheKey = () => 'piedra-mojada-fuente-candelaria';
  return chainSunField(material);
}

export function addFountainNozzles(batch, material, x, y, z) {
  const { height, radius, yaw, count } = FOUNTAIN_NOZZLES;
  // La garganta vuelve hacia el interior del remate. El primer anillo de agua nace dentro de ella.
  const profile = [[.158, .043], [.188, .045], [.222, .035], [radius + .004, .038], [radius + .004, .024], [.171, .024]];
  const sides = 12;
  for (let i = 0; i < count; i++) {
    const heading = yaw + i * 2 * Math.PI / count;
    const sx = Math.sin(heading), sz = Math.cos(heading);
    const point = ([distance, size], step) => {
      const angle = step * 2 * Math.PI / sides, side = Math.sin(angle) * size;
      return [x + distance * sx + side * sz, y + height + Math.cos(angle) * size, z + distance * sz - side * sx];
    };
    for (let row = 0; row < profile.length - 1; row++) for (let face = 0; face < sides; face++) {
      batch.quad(material, point(profile[row], face), point(profile[row + 1], face),
        point(profile[row + 1], face + 1), point(profile[row], face + 1), row === 3 ? 'stoneGray' : 'iron');
    }
  }
}
