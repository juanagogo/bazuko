import * as THREE from 'three';

/** Una pasada PBR con ondas analíticas: reutiliza el entorno de la escena. */
export function createLakeWaterMaterial() {
  const uniforms = {
    lakeTime: { value: 0 },
    lakeShallow: { value: new THREE.Color('#79aaa2') },
    lakeDeep: { value: new THREE.Color('#174851') }
  };
  const material = new THREE.MeshStandardMaterial({
    name: 'Agua del lago · profundidad y ondas', color: 0xffffff,
    roughness: .19, metalness: .12, transparent: true, opacity: 1,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.1
  });
  material.forceSinglePass = true;
  material.userData.uniforms = uniforms;
  material.userData.update = dt => {
    if (Number.isFinite(dt) && dt > 0) uniforms.lakeTime.value += dt;
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float lakeDepth;
uniform float lakeTime;
varying float vLakeDepth;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
#include <beginnormal_vertex>
float lakeEdge = smoothstep(0.0, 0.65, lakeDepth);
float lakePhaseA = position.x * 0.85 + position.z * 0.32 + lakeTime * 0.8;
float lakePhaseB = position.x * -0.41 + position.z * 0.76 - lakeTime * 0.57;
float lakeSlopeX = (cos(lakePhaseA) * 0.018 * 0.85 + cos(lakePhaseB) * 0.012 * -0.41) * lakeEdge;
float lakeSlopeZ = (cos(lakePhaseA) * 0.018 * 0.32 + cos(lakePhaseB) * 0.012 * 0.76) * lakeEdge;
objectNormal = normalize(vec3(-lakeSlopeX, 1.0, -lakeSlopeZ));
`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
vLakeDepth = lakeDepth;
transformed.y += (sin(lakePhaseA) * 0.018 + sin(lakePhaseB) * 0.012) * lakeEdge;
`);
    shader.fragmentShader = `uniform vec3 lakeShallow;
uniform vec3 lakeDeep;
varying float vLakeDepth;
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
#include <color_fragment>
float lakeDepthBlend = 1.0 - exp(-max(vLakeDepth, 0.0) * 0.48);
diffuseColor.rgb *= mix(lakeShallow, lakeDeep, lakeDepthBlend);
diffuseColor.a *= smoothstep(0.0, 0.12, vLakeDepth) * mix(0.22, 0.78, lakeDepthBlend);
`);
  };
  material.customProgramCacheKey = () => 'lake-water-depth-v1';
  return material;
}
