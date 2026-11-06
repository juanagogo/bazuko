// src/character/pantsDownRealistic.js
// Bajarse el pantalón en el personaje realista, todo por shader y sin geometría nueva:
// - La ropa de abajo (las islas de `streetZone`, o toda la malla si es un pantalón aparte como el
//   `cargo_pants`) se dobla bajo un borde que baja de la pretina a la rodilla. Lo doblado se comprime
//   contra el borde, se esponja un poco hacia afuera y pasa a seguir solo el muslo de su lado: con la
//   cadera también, en cuclillas quedaría flotando detrás del cuerpo.
// - La piel que `hideCovered` quitó en la cadera y los muslos vuelve con otro índice mientras el
//   pantalón esté abajo; la que el pantalón todavía cubre se descarta en el fragmento.
// - La cadera va censurada con el mosaico de censor.js.
// Todo vive en el reposo normalizado de streetMaterials (altura 0 en los pies y 1 en la coronilla).
import * as THREE from 'three';
import { censorByRestBox, createCensorUniforms, setCensor } from './censor.js';

export const KNEE_MARGIN = .02;  // el rollo queda justo encima de la rodilla
export const BUNCH = .06;        // cuánto ocupa lo doblado: 6 % de lo que había encima del borde
export const BUNCH_PUFF = .012;  // lo que se esponja la tela arrugada hacia afuera
const UNDER = /pants/i;
const RESTORE_BELOW = .03, RESTORE_ABOVE = .02;
const CENSOR_BELOW_HIP = .10, CENSOR_ABOVE_HIP = .12, CENSOR_WIDTH = .09;

const swapSkin = chunk => THREE.ShaderChunk[chunk].replaceAll('skinIndex', 'pdIndex').replaceAll('skinWeight', 'pdWeight');

const VERTEX_DECL = `
uniform float uPantsDrop;
uniform float uPantsTop;
uniform float uPantsKnee;
uniform mat4 uPantsRest;
uniform mat4 uPantsRestInv;
uniform vec2 uPantsThigh;
uniform float uPantsLegX;
`;
// Antes de `skinbase_vertex`, que en el vértice estándar va antes de `begin_vertex`.
const FOLD = lower => `
vec3 pdRest = (uPantsRest * vec4(position, 1.0)).xyz;
float pdEdge = mix(uPantsTop, uPantsKnee, uPantsDrop);
float pdFold = (uPantsDrop > 0.0 && ${lower} > 0.5 && pdRest.y > pdEdge) ? 1.0 : 0.0;
#ifdef USE_SKINNING
  vec4 pdIndex = pdFold > 0.5 ? vec4(pdRest.x > 0.0 ? uPantsThigh.x : uPantsThigh.y, 0.0, 0.0, 0.0) : skinIndex;
  vec4 pdWeight = pdFold > 0.5 ? vec4(1.0, 0.0, 0.0, 0.0) : skinWeight;
#endif
`;
const UNFOLD = `
if (pdFold > 0.5) {
  float pdSide = pdRest.x > 0.0 ? 1.0 : -1.0;
  vec3 pdTo = vec3(pdRest.x, pdEdge + (pdRest.y - pdEdge) * ${BUNCH.toFixed(3)}, pdRest.z);
  vec2 pdOut = vec2(pdRest.x - pdSide * uPantsLegX, pdRest.z);
  float pdLen = length(pdOut);
  if (pdLen > 1e-4) pdTo.xz += pdOut / pdLen * ${BUNCH_PUFF.toFixed(4)};
  transformed = (uPantsRestInv * vec4(pdTo, 1.0)).xyz;
}
`;

function chain(material, key, edit) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.() ?? '';
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    edit(shader);
  };
  material.customProgramCacheKey = () => `${previousKey}|${key}`;
  material.needsUpdate = true;
}

function landmark(bones, suffix, frame) {
  const bone = [...bones.values()].find(item => item.name.endsWith(suffix));
  return bone ? bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(frame.worldToNormalized) : null;
}

/**
 * Prepara la ropa y la piel del jugador para bajarse el pantalón. `hidden` y `baseIndex` son los de
 * `hideCovered`; `garmentMeshes` las mallas de la prenda con `under` si son un pantalón aparte.
 * Devuelve null si el cuerpo no sabe qué piel tapó (cuerpo liviano) o no hay ropa de abajo.
 */
export function createRealisticPantsDown({ bones, bodyMesh, baseIndex, hidden, frame, garmentMeshes }) {
  const vid = bodyMesh?.geometry?.attributes._vid;
  if (!vid || !hidden?.size || !baseIndex) return null;
  const left = landmark(bones, 'LeftUpLeg', frame), right = landmark(bones, 'RightUpLeg', frame);
  if (!left || !right) return null;
  const hipY = (left.y + right.y) / 2, legX = Math.abs(left.x - right.x) / 2;
  const kneeY = (frame.leftKnee.y + frame.rightKnee.y) / 2 + KNEE_MARGIN;

  // Hasta dónde llega lo de abajo: la pretina, o el peto del overol.
  const point = new THREE.Vector3();
  let lowerTop = -Infinity;
  const lower = [];
  for (const { mesh, under } of garmentMeshes) {
    const zone = mesh.geometry.attributes.streetZone, pos = mesh.geometry.attributes.position;
    if (!under && !zone) continue;
    mesh.updateWorldMatrix(true, false);
    const rest = frame.worldToNormalized.clone().multiply(mesh.matrixWorld);
    let any = false;
    for (let i = 0; i < pos.count; i++) {
      if (!under && zone.getX(i) < .5) continue;
      lowerTop = Math.max(lowerTop, point.fromBufferAttribute(pos, i).applyMatrix4(rest).y);
      any = true;
    }
    if (any) lower.push({ mesh, under, rest });
  }
  if (!lower.length || !(lowerTop > kneeY)) return null;

  const shared = { uPantsDrop: { value: 0 }, uPantsTop: { value: lowerTop }, uPantsKnee: { value: kneeY } };
  for (const { mesh, under, rest } of lower) {
    const boneIndex = suffix => mesh.skeleton.bones.findIndex(bone => bone.name.endsWith(suffix));
    const [l, r] = [boneIndex('LeftUpLeg'), boneIndex('RightUpLeg')];
    const thigh = left.x > 0 ? new THREE.Vector2(l, r) : new THREE.Vector2(r, l);
    const own = {
      uPantsRest: { value: rest }, uPantsRestInv: { value: rest.clone().invert() },
      uPantsThigh: { value: thigh }, uPantsLegX: { value: legX }
    };
    chain(mesh.material, 'pantalon:v1', shader => {
      Object.assign(shader.uniforms, shared, own);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
        .replace('#include <skinbase_vertex>', `${FOLD(under ? '1.0' : 'streetZone')}\n${swapSkin('skinbase_vertex')}`)
        .replace('#include <skinnormal_vertex>', swapSkin('skinnormal_vertex'))
        .replace('#include <skinning_vertex>', `${UNFOLD}\n${swapSkin('skinning_vertex')}`);
    });
  }

  // La piel: qué vértices estaban tapados y qué triángulos vuelven con el pantalón abajo.
  bodyMesh.updateWorldMatrix(true, false);
  const restBody = frame.worldToNormalized.clone().multiply(bodyMesh.matrixWorld);
  const pos = bodyMesh.geometry.attributes.position, uv = bodyMesh.geometry.attributes.uv;
  const restored = new Float32Array(pos.count), restY = new Float32Array(pos.count);
  // El tono del mosaico sale de la piel tapada al frente del muslo, justo bajo la cadera.
  const sampleY = hipY - .06;
  let sample = -1, sampleZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    restored[i] = hidden.has(Math.round(vid.getX(i))) ? 1 : 0;
    point.fromBufferAttribute(pos, i).applyMatrix4(restBody);
    restY[i] = point.y;
    if (restored[i] && Math.abs(Math.abs(point.x) - legX) < .03 && Math.abs(point.y - sampleY) < .03 && point.z > sampleZ) {
      sample = i;
      sampleZ = point.z;
    }
  }
  const coveredIndex = bodyMesh.geometry.index;
  const low = kneeY - RESTORE_BELOW, high = lowerTop + RESTORE_ABOVE;
  const inside = v => restY[v] >= low && restY[v] <= high;
  const open = Array.from(coveredIndex.array);
  const base = baseIndex.array;
  for (let i = 0; i < base.length; i += 3) {
    const a = base[i], b = base[i + 1], c = base[i + 2];
    if ((restored[a] || restored[b] || restored[c]) && inside(a) && inside(b) && inside(c)) open.push(a, b, c);
  }
  const openIndex = new THREE.BufferAttribute(new Uint32Array(open), 1);
  bodyMesh.geometry.setAttribute('pdRestored', new THREE.BufferAttribute(restored, 1));
  chain(bodyMesh.material, 'pantalon-piel:v1', shader => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float pdRestored;\nvarying float vPdRestored;\n')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPdRestored = pdRestored;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uPantsDrop;\nuniform float uPantsTop;\nuniform float uPantsKnee;\nvarying float vPdRestored;\n')
      // La piel devuelta que el pantalón todavía cubre no se dibuja: no atraviesa la tela al bajar.
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uPantsDrop > 0.0 && vPdRestored > 0.001 && vStreetRest.y < mix(uPantsTop, uPantsKnee, uPantsDrop) - 0.005) discard;');
  });

  const censor = createCensorUniforms({ uv: uv && sample >= 0 ? [uv.getX(sample), uv.getY(sample)] : null });
  censorByRestBox(bodyMesh.material, censor, new THREE.Vector3(legX + CENSOR_WIDTH, hipY - CENSOR_BELOW_HIP, Math.min(lowerTop, hipY + CENSOR_ABOVE_HIP) + .01));

  let drop = 0;
  const api = {
    uniforms: { ...shared, ...censor },
    lowerTop, kneeY, hipY, legX, coveredIndex, openIndex,
    garmentMeshes: lower.map(({ mesh, under }) => ({ mesh, under })),
    get drop() { return drop; },
    setDrop(value) {
      drop = Math.max(0, Math.min(1, value || 0));
      shared.uPantsDrop.value = drop;
      const index = drop > 0 ? openIndex : coveredIndex;
      if (bodyMesh.geometry.index !== index) bodyMesh.geometry.setIndex(index);
    },
    setCensor(state) { setCensor(censor, state); },
    reset() { api.setDrop(0); setCensor(censor, { on: false }); },
    dispose() { api.reset(); }
  };
  return api;
}
