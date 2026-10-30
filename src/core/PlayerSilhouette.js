import * as THREE from 'three';

/** Segunda pasada del mismo personaje animado, solo en píxeles ocultos por profundidad. */
export class PlayerSilhouette {
  constructor() {
    this._lightLayers = [];
    this._overlayObjects = [];
    // WebGPU guarda un LightsNode por escena. Si la silueta reutilizara la escena principal,
    // su lista reducida de luces cambiaría la clave de los RenderObject del jugador en cada
    // pasada y obligaría a recompilar sus shaders (cada build crea otro buffer de huesos).
    this._scene = new THREE.Scene();
    this._scene.matrixWorldAutoUpdate = false;
    this._scene.children = this._overlayObjects;
    this.material = new THREE.MeshBasicMaterial({
      color: 0x73e5ef, transparent: true, opacity: 0.65,
      depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      toneMapped: false
    });
  }

  render(renderer, scene, camera, playerRoot, lights = scene.children) {
    // También recoge modelos que terminan de cargarse o se cambian durante la partida.
    playerRoot.traverse(o => { if (o.isMesh) o.layers.enable(1); });
    const mask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    const overlay = this._scene;
    const overlayObjects = this._overlayObjects;
    overlayObjects.length = 0;
    overlayObjects.push(playerRoot);
    const lightLayers = this._lightLayers;
    lightLayers.length = 0;
    for (const o of lights) {
      if (o.isLight && o.visible && o.layers.test(camera.layers)) {
        lightLayers.push(o, o.layers.mask);
        overlayObjects.push(o);
        o.layers.enable(1);
      }
    }
    // Mismo entorno y niebla para que el repintado coincida con la pasada principal.
    overlay.environment = scene.environment;
    overlay.environmentIntensity = scene.environmentIntensity;
    overlay.environmentRotation.copy(scene.environmentRotation);
    overlay.fog = scene.fog;
    overlay.background = null;
    try {
      camera.layers.set(1);
      overlay.overrideMaterial = this.material;
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      // Conserva padre y matrices mundiales. Solo visita jugador y luces en estas pasadas;
      // recorrer otra vez toda la ciudad no aporta ningún píxel a la silueta.
      renderer.render(overlay, camera);
      // La ropa y el cuerpo pueden ocultarse entre sí. Repintar las superficies visibles
      // elimina esa falsa silueta, conservándola solo donde las tapa el entorno.
      overlay.overrideMaterial = scene.overrideMaterial;
      renderer.render(overlay, camera);
    } finally {
      camera.layers.mask = mask;
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadowUpdate;
      for (let i = 0; i < lightLayers.length; i += 2) lightLayers[i].layers.mask = lightLayers[i + 1];
    }
  }
}
