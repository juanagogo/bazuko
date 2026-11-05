import * as THREE from 'three';
import { LightHalos } from './LightHalos.js';

/** Un número fijo de luces evita shaders con cientos de luces y recompilaciones al caminar. */
export class LocalLights {
  constructor(scene, count = 2) {
    this.scene = scene;
    this.sources = new Map();
    this.candidates = [];
    this.halos = new LightHalos(scene);
    this.pool = Array.from({ length: count }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 1);
      light.userData.localLightProxy = true;
      scene.add(light);
      return light;
    });
    this._onAdded = event => this.register(event.child);
    this._onRemoved = event => this.unregister(event.child);
    scene.addEventListener('childadded', this._onAdded);
    scene.addEventListener('childremoved', this._onRemoved);
    this.refreshSources();
  }

  register(root, { static: fixed = false } = {}) {
    root.traverse(light => {
      if (!light.isPointLight || light.userData.localLightProxy) return;
      let entry = this.sources.get(light);
      if (!entry) {
        entry = { light, mask: light.layers.mask, position: new THREE.Vector3(), score: 0 };
        this.sources.set(light, entry);
        light.layers.set(2);
      }
      entry.fixed = fixed;
      light.getWorldPosition(entry.position);
    });
  }

  unregister(root) {
    root.traverse(light => {
      const entry = this.sources.get(light);
      if (!entry) return;
      light.layers.mask = entry.mask;
      this.sources.delete(light);
    });
  }

  /** Llamar tras cambiar luces dentro de una rama ya registrada o sus transformaciones. */
  refreshSources(options) {
    this.register(this.scene, options);
    for (const [light, entry] of this.sources) {
      let parent = light;
      while (parent && parent !== this.scene) parent = parent.parent;
      if (!parent) { light.layers.mask = entry.mask; this.sources.delete(light); }
    }
  }

  update(dt, target, groundHeight, camera = null) {
    this.candidates.length = 0;
    for (const entry of this.sources.values()) {
      const light = entry.light;
      if (light.intensity <= 0) continue;
      let visible = true;
      for (let node = light; node; node = node.parent) if (!node.visible) { visible = false; break; }
      if (!visible) continue;
      if (!entry.fixed) light.getWorldPosition(entry.position);
      const distance = entry.position.distanceToSquared(target);
      if (distance > 80 * 80) continue;
      // La llama parpadea, pero no debe intercambiar las luces elegidas en cada oscilación.
      entry.peakIntensity = Math.max(entry.peakIntensity ?? 0, light.intensity);
      // Usar el mismo alcance y caída que el shader: una fuente fuerte fuera
      // de alcance no debe desplazar al farol que sí ilumina al personaje.
      const rangeRatioSquared = light.distance > 0 ? distance / (light.distance * light.distance) : 0;
      const cutoff = Math.max(0, 1 - rangeRatioSquared * rangeRatioSquared);
      entry.score = entry.peakIntensity * cutoff * cutoff / Math.max(Math.pow(distance, light.decay * .5), .01);
      this.candidates.push(entry);
    }
    this.candidates.sort((a, b) => b.score - a.score);
    this.halos.update(this.candidates, target, groundHeight, camera);
    for (let i = 0; i < this.pool.length; i++) {
      const proxy = this.pool[i], source = this.candidates[i];
      // No ocultar las plazas vacías: mantener el número de luces del shader estable.
      proxy.intensity = source?.light.intensity ?? 0;
      if (!source) continue;
      proxy.position.copy(source.position);
      proxy.color.copy(source.light.color);
      proxy.distance = source.light.distance;
      proxy.decay = source.light.decay;
    }
  }

  dispose() {
    this.scene.removeEventListener('childadded', this._onAdded);
    this.scene.removeEventListener('childremoved', this._onRemoved);
    this.halos.dispose();
    for (const { light, mask } of this.sources.values()) light.layers.mask = mask;
    for (const light of this.pool) this.scene.remove(light);
    this.sources.clear();
  }
}
