import * as THREE from 'three';

const FAR_PLANE = 4;

/** Descarte por grupos durante el render; nunca modifica la simulación ni la visibilidad de juego. */
export class FrustumCulling {
  constructor() {
    this.entries = [];
    this.hidden = [];
    this.frustum = new THREE.Frustum();
    this.pastFarFrustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
    this.shadowFrustums = [];
    this.stats = { total: 0, visible: 0, shadowOnly: 0, culled: 0 };
  }

  register(object, { dynamic = false, margin = 0 } = {}) {
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object).expandByScalar(margin);
    if (bounds.isEmpty()) return;
    let castsShadow = false, pastFar = false;
    object.traverse(child => {
      if (child.castShadow) castsShadow = true;
      // Su material no se recorta en el plano lejano de la cámara: el descarte tampoco debe hacerlo.
      if (child.material?.userData?.pastFar) pastFar = true;
    });
    // Los vehículos solo cambian su transformación raíz; se conserva una caja local holgada.
    const local = dynamic ? bounds.clone().applyMatrix4(object.matrixWorld.clone().invert()) : null;
    this.entries.push({ object, bounds, local, castsShadow, pastFar });
  }

  apply(camera, shadowLights = []) {
    this.restore();
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.pastFarFrustum.copy(this.frustum);
    this.pastFarFrustum.planes[FAR_PLANE].constant = Infinity;
    this.shadowFrustums.length = 0;
    for (const light of shadowLights) {
      if (!light.visible || !light.castShadow || !light.isDirectionalLight) continue;
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      light.shadow.updateMatrices(light);
      this.shadowFrustums.push(light.shadow.getFrustum());
    }
    const stats = this.stats;
    stats.total = stats.visible = stats.shadowOnly = stats.culled = 0;
    for (const entry of this.entries) {
      const { object, bounds, local, castsShadow, pastFar } = entry;
      let enabled = true;
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) { enabled = false; break; }
      if (!enabled) continue;
      stats.total++;
      if (local) {
        object.updateWorldMatrix(true, false);
        bounds.copy(local).applyMatrix4(object.matrixWorld);
      }
      if ((pastFar ? this.pastFarFrustum : this.frustum).intersectsBox(bounds)) { stats.visible++; continue; }
      if (castsShadow && this.shadowFrustums.some(frustum => frustum.intersectsBox(bounds))) {
        stats.shadowOnly++;
        continue;
      }
      object.visible = false;
      this.hidden.push(object);
      stats.culled++;
    }
  }

  restore() {
    for (const object of this.hidden) object.visible = true;
    this.hidden.length = 0;
  }

  clear() { this.restore(); this.entries.length = 0; }
}
