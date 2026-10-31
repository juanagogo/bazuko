import {GRAPHICS_PROFILES} from './GraphicsQuality.js';
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

  setQuality(level){
    const count=GRAPHICS_PROFILES[level]?.localLights??96;
    while(this.pool.length<count){const light=new THREE.PointLight(0xffffff,0,1);light.userData.localLightProxy=true;this.scene.add(light);this.pool.push(light);}
    this.spotPool??=[];
    while(this.spotPool.length<Math.min(8,count)){const light=new THREE.SpotLight(0xffffff,0,30,.2,.85,2);light.userData.localLightProxy=true;this.scene.add(light,light.target);this.spotPool.push(light);}
    this.limit=count;this.physicalScale=24;
  }

  register(root, { static: fixed = false } = {}) {
    root.traverse(light => {
      if ((!light.isPointLight&&!light.isSpotLight) || light.userData.localLightProxy) return;
      let entry = this.sources.get(light);
      if (!entry) {
        entry = { light, mask: light.layers.mask, position: new THREE.Vector3(), score: 0 };
        this.sources.set(light, entry);
        light.layers.set(2);
      }
      // Vehicle lamps must keep following their root even after the static city refresh.
      entry.fixed = fixed && !light.userData.dynamicLight;
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

  update(dt, target, groundHeight, camera = null, isNight = true) {
    this.candidates.length = 0;
    for (const entry of this.sources.values()) {
      const light = entry.light;
      // Gate the rendered proxies, not the source: flickering stalls rewrite intensity every frame.
      if (!isNight || this.enabled === false) continue;
      if (light.intensity <= 0) continue;
      let visible = true;
      for (let node = light; node; node = node.parent) if (!node.visible) { visible = false; break; }
      if (!visible) continue;
      if (!entry.fixed) light.getWorldPosition(entry.position);
      const distance = entry.position.distanceToSquared(target);
      if (distance > 80 * 80) continue;
      // La llama parpadea, pero no debe intercambiar las luces elegidas en cada oscilación.
      entry.peakIntensity = Math.max(entry.peakIntensity ?? 0, light.intensity);
      entry.score = entry.peakIntensity / (1 + distance);
      this.candidates.push(entry);
    }
    this.candidates.sort((a, b) => b.score - a.score);
    this.halos.update(this.candidates, target, groundHeight, camera);
    let selected=0,spots=0;
    for(const source of this.candidates){if(source.light.isSpotLight&&spots>=Math.min(8,this.spotPool?.length??0))continue;if(source.light.isSpotLight)spots++;this.candidates[selected++]=source;}
    this.candidates.length=Math.min(selected,this.limit??this.pool.length);
    for(const spot of this.spotPool??[])spot.intensity=0;
    let spotIndex=0;
    for (let i = 0; i < this.pool.length; i++) {
      const proxy = this.pool[i], source = i<(this.limit??this.pool.length)?this.candidates[i]:null;
      // No ocultar las plazas vacías: mantener el número de luces del shader estable.
      const isSpot=source?.light.isSpotLight,spot=isSpot?this.spotPool?.[spotIndex++]:null;
      if(spot)spot.intensity=isSpot?source.light.intensity:0;
      proxy.intensity = isSpot?0:(source?.light.intensity??0)*(this.physicalScale??1);
      if(isSpot&&spot){spot.position.copy(source.position);spot.color.copy(source.light.color);spot.distance=source.light.distance;spot.angle=source.light.angle;spot.penumbra=source.light.penumbra;spot.decay=source.light.decay;source.light.target.getWorldPosition(spot.target.position);}
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
    for(const light of this.spotPool??[]){this.scene.remove(light,light.target);light.dispose();}
    this.sources.clear();
  }
}
