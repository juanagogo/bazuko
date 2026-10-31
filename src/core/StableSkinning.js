import { ReferenceNode } from 'three/webgpu';

export const BONE_MATRICES_NAME = 'boneMatrices';

/**
 * Three 0.186 nombra el buffer de huesos de cada SkinnedMesh con el id del nodo
 * (`NodeBuffer_<id>`), así que dos personajes con el mismo material generan WGSL distinto
 * y cada uno compila sus propios programas y pipelines al aparecer. Un nombre fijo deja
 * el código idéntico y WebGPU reutiliza lo ya compilado. Cada malla tiene un solo
 * esqueleto, por lo que el nombre no choca dentro de un shader.
 */
export function installStableSkinningNames(NodeClass = ReferenceNode) {
  const proto = NodeClass.prototype;
  if (proto.__stableSkinning) return;
  const setNodeType = proto.setNodeType;
  proto.setNodeType = function (uniformType) {
    if (this.name === null && this.properties?.[0] === 'skeleton' && this.properties[1] === 'boneMatrices' && this.properties.length === 2) {
      this.name = BONE_MATRICES_NAME;
    }
    return setNodeType.call(this, uniformType);
  };
  proto.__stableSkinning = true;
}
