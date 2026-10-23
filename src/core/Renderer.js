import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PlayerSilhouette } from './PlayerSilhouette.js';
import { AdaptiveResolution } from './AdaptiveResolution.js';
import { FrustumCulling } from './FrustumCulling.js';
import { paintLoadingFrame } from '../ui/LoadingScreen.js';

/** Entorno exterior urbano de Bogotá para reflejos PBR realistas en carros, asfalto y vidrios */
export class OutdoorUrbanEnvironment extends THREE.Scene {
  constructor() {
    super();
    this.name = 'OutdoorUrbanEnvironment';

    // Bóveda celeste con gradiente andino
    const skyGeo = new THREE.SphereGeometry(30, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x5682ad, side: THREE.BackSide });
    this.add(new THREE.Mesh(skyGeo, skyMat));

    // Bruma cálida en el horizonte urbano
    const horizGeo = new THREE.CylinderGeometry(29, 29, 12, 24, 1, true);
    const horizMat = new THREE.MeshBasicMaterial({ color: 0xd4b898, side: THREE.BackSide, transparent: true, opacity: 0.7 });
    const horiz = new THREE.Mesh(horizGeo, horizMat);
    horiz.position.y = 2;
    this.add(horiz);

    // Sol con alta intensidad para brillos especulares PBR en carrocerías y asfalto
    const sunPoint = new THREE.PointLight(0xfff5ea, 1200, 60, 1.8);
    sunPoint.position.set(16, 22, 12);
    this.add(sunPoint);

    // Suelo reflectante oscuro de asfalto bogotano
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.75 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    this.add(ground);

    // Siluetas de edificios para reflejos urbanos realistas en ventanas y vehículos
    const boxGeo = new THREE.BoxGeometry(6, 14, 6);
    const bMat = new THREE.MeshStandardMaterial({ color: 0x3a332d, roughness: 0.8 });
    for (const [bx, bz] of [[-14, 8], [15, -10], [-10, -14], [12, 12]]) {
      const b = new THREE.Mesh(boxGeo, bMat);
      b.position.set(bx, 6.5, bz);
      this.add(b);
    }
  }

  dispose() {
    this.traverse(o => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}

export class Renderer {
  constructor(canvas) {
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.resolution = new AdaptiveResolution(window.devicePixelRatio);
    this.instance.setPixelRatio(this.resolution.ratio);
    this.instance.setSize(window.innerWidth, window.innerHeight);
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFShadowMap;

    // Look realista: tone mapping fílmico
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1.15;
    this.instance.outputColorSpace = THREE.SRGBColorSpace;
    this.silhouette = new PlayerSilhouette();
    this.culling = new FrustumCulling();
    this.composer = null;
    this.bloomPass = null;
    // El contador incluye las tres pasadas, no solo la última del personaje.
    this.instance.info.autoReset = false;

    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => this.resolution.resetWindow());
  }

  setQuality(level = 'alta') {
    this.quality = level;
    try { localStorage.setItem('bazuko.graphics_quality', level); } catch { /* sin almacenamiento */ }
    if (level === 'baja') {
      this.instance.shadowMap.enabled = false;
      this.instance.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
      if (this.bloomPass) this.bloomPass.enabled = false;
    } else if (level === 'media') {
      this.instance.shadowMap.enabled = true;
      this.instance.shadowMap.type = THREE.PCFShadowMap;
      this.instance.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      if (this.bloomPass) this.bloomPass.enabled = true;
    } else {
      this.instance.shadowMap.enabled = true;
      this.instance.shadowMap.type = THREE.PCFShadowMap;
      this.instance.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      if (this.bloomPass) this.bloomPass.enabled = true;
    }
  }

  setupPostprocessing(scene, camera) {
    // Postprocesado seguro sin romper buffer de profundidad de siluetas
  }

  /** Mapa de entorno neutro: da reflejos (charcos, vidrios) y luz rebotada a los materiales PBR */
  createEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.instance);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }

  _onResize() {
    this.instance.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  async prepare(scene, camera, extraModels = []) {
    const textures = new Set();
    for (const root of [scene, ...extraModels]) root.traverse(object => {
      for (const material of [object.material].flat().filter(Boolean)) {
        for (const value of Object.values(material)) {
          if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
        }
      }
    });
    let uploaded = 0;
    for (const texture of textures) {
      this.instance.initTexture(texture);
      if (++uploaded % 8 === 0) await paintLoadingFrame();
    }
    await this.instance.compileAsync(scene, camera);
    // Referencias temporales: no cambia los padres ni el LOD visible de cada NPC.
    const models = new THREE.Group();
    models.children = extraModels;
    try { await this.instance.compileAsync(models, camera, scene); }
    finally { models.children = []; }
  }

  async waitForGPU() {
    const gl = this.instance.getContext();
    if (gl.isContextLost()) throw new Error('Se perdió el contexto gráfico.');
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error('No se pudo comprobar la preparación gráfica.');
    gl.flush();
    const deadline = performance.now() + 30000;
    try {
      while (true) {
        const result = gl.clientWaitSync(fence, 0, 0);
        if (result === gl.ALREADY_SIGNALED || result === gl.CONDITION_SATISFIED) return;
        if (result === gl.WAIT_FAILED || gl.isContextLost() || performance.now() > deadline) {
          throw new Error('No se pudo completar la preparación gráfica.');
        }
        await paintLoadingFrame();
      }
    } finally { gl.deleteSync(fence); }
  }

  render(scene, camera, playerRoot = null, shadowLights = []) {
    this.instance.info.reset();
    this.culling.apply(camera, this.instance.shadowMap.enabled ? shadowLights : []);
    try {
      this.instance.render(scene, camera);
      if (playerRoot) this.silhouette.render(this.instance, scene, camera, playerRoot);
    } finally {
      this.culling.restore();
    }
  }

  adaptResolution(frameMs) {
    if (this.resolution.sample(frameMs)) this.instance.setPixelRatio(this.resolution.ratio);
  }
}
