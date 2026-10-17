// src/entities/EstacionTM.js
// Estaciones TransMilenio (estacion.glb) sobre la zona verde central. Un clon por estación (comparte
// geometría y material). Fallback: caja gris con franja roja si el GLB no carga.
import * as THREE from 'three';
import { loadModel, cloneModel } from '../utils/ModelCache.js';

const HEIGHT = 5.2;          // alto de la estación (techo)
const BASE_Y = 0.1;          // sobre el andén/bordillo de la zona verde
// Giro Y del modelo para que su eje largo quede paralelo a la vía; el GLB trae el largo en X (avenida H);
// en la avenida V (a lo largo de Z) se gira 90°. El modelo es simétrico: ambos lados tienen puertas hacia las vías.
const MODEL_YAW = 0;

export class EstacionesTM {
  /** @param stations [{x, z, len, width}] (ver computeAvenue) */
  constructor(scene, stations, collisions) {
    this.scene = scene;
    this.items = [];
    this._disposed = false;
    for (const st of stations) {
      const group = new THREE.Group();
      group.position.set(st.x, BASE_Y, st.z);
      // Fallback
      const alongZ = st.axis === 'z';
      const fb = new THREE.Mesh(
        new THREE.BoxGeometry(st.len, HEIGHT, st.width),
        new THREE.MeshLambertMaterial({ color: 0x8a8d94, flatShading: true })
      );
      fb.position.y = HEIGHT / 2;
      fb.castShadow = fb.receiveShadow = true;
      group.add(fb);
      group.rotation.y = alongZ ? Math.PI / 2 : 0;
      scene.add(group);
      // Colisión (caja): solo la franja de la estación; el pasto alrededor queda libre
      collisions?.add({ position: new THREE.Vector3(st.x, BASE_Y, st.z) }, alongZ ? new THREE.Vector3(st.width, HEIGHT, st.len) : new THREE.Vector3(st.len, HEIGHT, st.width));
      this.items.push({ group, fb, st });
    }

    loadModel('estacion.glb', stations[0]?.len ?? 12).then((base) => {
      if (!base || this._disposed) return; // sin GLB: queda la caja
      const box = new THREE.Box3().setFromObject(base);
      const size = box.getSize(new THREE.Vector3());
      base.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        m.metalnessMap = null; m.roughnessMap = null; m.normalMap = null;
        m.metalness = 0.1; m.roughness = 0.85; m.needsUpdate = true;
      });
      for (const it of this.items) {
        const body = new THREE.Group();
        body.add(cloneModel(base));
        body.rotation.y = MODEL_YAW;
        // Escala no uniforme: largo = len (ya normalizado), alto y ancho al tamaño de estación
        body.scale.set(1, HEIGHT / size.y, it.st.width / size.z);
        it.group.remove(it.fb);
        it.fb.geometry.dispose(); it.fb.material.dispose();
        it.group.add(body);
      }
    });
  }

  dispose() {
    this._disposed = true;
    for (const it of this.items) this.scene.remove(it.group);
    this.items = [];
  }
}
