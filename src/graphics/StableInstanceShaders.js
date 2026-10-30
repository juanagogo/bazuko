/** In Three 0.186 a fresh instance storage node otherwise emits NodeBuffer_<id>.
 * Identical banks then compile different WGSL programs. Each draw has exactly
 * one current instance matrix buffer; a stable name shares programs, while the
 * renderer still owns a separate binding and buffer for every InstancedMesh.
 */
export function installStableInstanceShaders(renderer) {
  const previous = renderer.debug.onNodeBuilderCreated;
  renderer.debug.onNodeBuilderCreated = (builder, renderObject) => {
    previous?.(builder, renderObject);
    const matrices = renderObject.object?.instanceMatrix;
    if (!matrices?.isStorageInstancedBufferAttribute) return;
    const get = builder.getUniformFromNode;
    builder.getUniformFromNode = function (node, type, stage, name) {
      return get.call(this, node, type, stage,
        type === 'storageBuffer' && node.value === matrices ? 'instanceMatrices' : name);
    };
  };
}
