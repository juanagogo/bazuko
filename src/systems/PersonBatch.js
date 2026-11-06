// src/systems/PersonBatch.js
// Gente barata para muchos sitios: cajas y cabezas instanciadas, dos llamadas de dibujo en total sin importar cuántas
// personas haya. Quien la usa llama begin(), dibuja personas con person() y cierra con end(); lo que sobre el tope se ignora.
import * as THREE from 'three';
import { chainSunField } from '../world/bogota/SunFieldShader.js';

export const SKIN = ['#f2c9a5', '#e0a67c', '#c98e62', '#a8693f', '#7a4a2a', '#52321d'].map(c => new THREE.Color(c));
export const SHIRTS = ['#d9302c', '#f2c230', '#2f6fc4', '#2e9a55', '#f5f2ea', '#1c1c20', '#e86aa0', '#f08a24', '#7a46b0', '#3cb7c4', '#8a8f96', '#a02034', '#c8d83a', '#5a3a28'].map(c => new THREE.Color(c));
export const PANTS = ['#27395c', '#1c1c20', '#3a5a8c', '#4a4038', '#6a6258', '#2c2c34', '#8a7a62'].map(c => new THREE.Color(c));
export const HAIR = ['#16120f', '#16120f', '#2a1a10', '#4a2e1a', '#7a5a38', '#b8b0a8', '#d8b860'].map(c => new THREE.Color(c));

const UP = new THREE.Vector3(0, 1, 0);

export class PersonBatch {
  constructor(scene, { people, name = 'Gente' }) {
    this.root = new THREE.Group();
    this.root.name = name;
    scene.add(this.root);
    this.capacity = { boxes: people * 7, heads: people };
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, metalness: 0 });
    material.name = `${name} (material)`;
    chainSunField(material);
    this.material = material;
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.headGeometry = new THREE.SphereGeometry(.5, 7, 5);
    this.boxes = this._mesh(this.boxGeometry, this.capacity.boxes, `${name}: cuerpos`);
    this.heads = this._mesh(this.headGeometry, this.capacity.heads, `${name}: cabezas`);
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._yaw = new THREE.Quaternion(); this._local = new THREE.Quaternion();
    this.nBoxes = 0; this.nHeads = 0;
    this.end();
  }

  _mesh(geometry, count, name) {
    const mesh = new THREE.InstancedMesh(geometry, this.material, count);
    mesh.name = name;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, SKIN[0]);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    this.root.add(mesh);
    return mesh;
  }

  begin() { this.nBoxes = 0; this.nHeads = 0; }

  /** Una caja de tamaño (sx, sy, sz) centrada en (x, y, z) del mundo, girada `yaw` y luego `pitch` y `roll` locales. */
  box(x, y, z, yaw, sx, sy, sz, color, qLocal = null) {
    if (this.nBoxes >= this.capacity.boxes) return false;
    this._yaw.setFromAxisAngle(UP, yaw);
    if (qLocal) this._q.copy(this._yaw).multiply(qLocal); else this._q.copy(this._yaw);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz));
    this.boxes.setMatrixAt(this.nBoxes, this._m); this.boxes.setColorAt(this.nBoxes, color);
    this.nBoxes++;
    return true;
  }

  head(x, y, z, r, color) {
    if (this.nHeads >= this.capacity.heads) return false;
    this._m.compose(this._p.set(x, y, z), this._q.identity(), this._s.set(r * 2, r * 2.15, r * 2));
    this.heads.setMatrixAt(this.nHeads, this._m); this.heads.setColorAt(this.nHeads, color);
    this.nHeads++;
    return true;
  }

  end() {
    // Sin gente antes y ahora: ni se suben matrices ni se dibuja.
    if (!this.nBoxes && !this.boxes.count) { this.root.visible = false; return; }
    this.boxes.count = this.nBoxes; this.heads.count = this.nHeads;
    this.boxes.instanceMatrix.needsUpdate = this.heads.instanceMatrix.needsUpdate = true;
    this.boxes.instanceColor.needsUpdate = this.heads.instanceColor.needsUpdate = true;
    this.root.visible = this.nBoxes > 0;
  }

  dispose() {
    this.boxes.dispose(); this.heads.dispose();
    this.boxGeometry.dispose(); this.headGeometry.dispose(); this.material.dispose();
    this.root.removeFromParent();
  }
}
