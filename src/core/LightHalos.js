import * as THREE from 'three';

/** Luz decorativa sin iluminar cada material del mundo; todos los halos usan un solo dibujo. */
export class LightHalos {
  constructor(scene, capacity = 48) {
    const size = 32, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, 1 - radius) ** 2 * 70);
    }
    this.texture = new THREE.DataTexture(data, size, size);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'Halos de luz decorativa';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // Solo se incluyen fuentes cercanas; límites cambian cada cuadro.
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.capacity = capacity;
    this.transform = new THREE.Object3D();
    this.color = new THREE.Color();
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
    this.bounds = new THREE.Box3();
    scene.add(this.mesh);
  }

  update(candidates, target, groundHeight = () => 0, camera = null) {
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    let count = 0;
    for (const { light, position } of candidates) {
      // Directional headlights illuminate through their cone, never a circular ground decal.
      if (light.isSpotLight) continue;
      const distance = position.distanceTo(target);
      if (distance >= 45 || count === this.capacity) continue;
      const radius = Math.min(4, (light.distance || 8) * .45);
      const height = groundHeight(position.x, position.z) + .025;
      this.bounds.min.set(position.x - radius, height - .01, position.z - radius);
      this.bounds.max.set(position.x + radius, height + .01, position.z + radius);
      if (camera && !this.frustum.intersectsBox(this.bounds)) continue;
      this.transform.position.set(position.x, height, position.z);
      this.transform.scale.set(radius, 1, radius);
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(count, this.transform.matrix);
      this.color.copy(light.color).multiplyScalar(Math.min(1, light.intensity / 3) * Math.min(1, (45 - distance) / 8));
      this.mesh.setColorAt(count++, this.color);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
