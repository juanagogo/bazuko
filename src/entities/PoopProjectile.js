// src/entities/PoopProjectile.js
import * as THREE from 'three';

export class PoopProjectile {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} startPos
   * @param {THREE.Vector3} direction
   * @param {Array} npcs
   * @param {Function} groundHeightFn
   */
  constructor(scene, startPos, direction, npcs = [], groundHeightFn = null) {
    this.scene = scene;
    this.startPos = startPos.clone();
    this.position = startPos.clone();
    this.npcs = npcs;
    this.groundHeightFn = groundHeightFn ?? (() => 0);
    this.alive = true;
    this.time = 0;
    this.maxLifetime = 5; // segundos antes de autodestruirse si no colisiona

    // Velocidad inicial: impulso frontal + arco parabólico
    const dir = direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
    dir.normalize();

    this.velocity = dir.multiplyScalar(13.5);
    this.velocity.y = 3.6;
    this.gravity = 13.5;

    // Modelo 3D del mojón (esferas concéntricas escaladas)
    this.mesh = this._createMesh();
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
  }

  _createMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a2a12,
      roughness: 0.92,
      metalness: 0.05
    });

    const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 7), mat);
    b1.scale.set(1.2, 0.6, 1.2);
    group.add(b1);

    const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 7), mat);
    b2.scale.set(1.0, 0.6, 1.0);
    b2.position.y = 0.1;
    group.add(b2);

    const b3 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), mat);
    b3.scale.set(0.8, 0.6, 0.8);
    b3.position.y = 0.18;
    group.add(b3);

    return group;
  }

  /**
   * Actualiza el proyectil.
   * @param {number} dt
   * @returns {{ hit: boolean, type?: string, npc?: object, position?: THREE.Vector3 }}
   */
  update(dt) {
    if (!this.alive) return { hit: false };

    this.time += dt;
    if (this.time > this.maxLifetime) {
      this.dispose();
      return { hit: true, type: 'timeout' };
    }

    // Física balística
    this.position.addScaledVector(this.velocity, dt);
    this.velocity.y -= this.gravity * dt;
    this.mesh.position.copy(this.position);

    // Rotación tumbling en el aire
    this.mesh.rotation.x += dt * 7.5;
    this.mesh.rotation.z += dt * 5.0;

    // 1. Colisión con NPCs peatones
    for (const npc of this.npcs) {
      if(npc.debugDisabled)continue;
      if (!npc?.position) continue;
      const dx = npc.position.x - this.position.x;
      const dz = npc.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      const dy = Math.abs((npc.position.y + 0.9) - this.position.y);

      if (dist < 0.85 && dy < 1.1) {
        npc.hitByPoop?.(this.startPos);
        const hitResult = { hit: true, type: 'npc', npc, position: this.position.clone() };
        this.dispose();
        return hitResult;
      }
    }

    // 2. Colisión con el suelo
    const groundY = this.groundHeightFn(this.position.x, this.position.z);
    if (this.position.y <= groundY + 0.08) {
      this.position.y = groundY + 0.04;
      const hitResult = { hit: true, type: 'ground', position: this.position.clone() };
      this.dispose();
      return hitResult;
    }

    return { hit: false };
  }

  dispose() {
    this.alive = false;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      this.mesh = null;
    }
  }
}
