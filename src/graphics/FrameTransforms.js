/** A frame's main pass and both cascades use identical world transforms.
 * Update once, then let all passes reuse them. Dynamic children still update
 * every frame; restore ownership even if a render/device error interrupts it.
 */
export function withFrameTransforms(scene, render) {
  const automatic = scene.matrixWorldAutoUpdate;
  if (automatic) scene.updateMatrixWorld();
  scene.matrixWorldAutoUpdate = false;
  try { return render(); }
  finally { scene.matrixWorldAutoUpdate = automatic; }
}
