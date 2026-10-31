/** Three 0.186 compileAsync uses render depth 0, but RenderPipeline draws the
 * scene pass inside its output quad at depth 1. The depth is part of the node
 * cache key. Preparing depth 0 rebuilt the entire city on the first real draw.
 * Keep this compatibility adapter local; never alias the two runtime contexts.
 */
export function compileScenePass(renderer, root, camera, scene) {
  // The blank post-processing frame has no scene lights. compileAsync does not
  // advance info.calls, so NodeManager can keep that blank frame's light hash.
  // Also create the cluster grid BEFORE calculating any material cache keys.
  const lights = renderer.lighting?.getNode(scene);
  lights?.updateProgram?.(renderer);
  renderer._nodes?.callHashCache?.delete([scene, lights]);
  const contexts = renderer._renderContexts;
  const get = contexts.get;
  contexts.get = function (target, mrt, depth) {
    return get.call(this, target, mrt, depth ?? 1);
  };
  try {
    // The renderer is already initialized. Context selection happens synchronously
    // before compileAsync's first await; restore before any other frame can run.
    return renderer.compileAsync(root, camera, scene);
  } finally {
    contexts.get = get;
  }
}
