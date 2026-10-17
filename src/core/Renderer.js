import * as THREE from 'three';

export class Renderer {
  constructor(canvas) {
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: false,           // PSX look: sin AA
      stencil: true,              // silueta rayos X (core/XRay.js)
      powerPreference: 'high-performance'
    });
    this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 1)); // pixelado
    this.instance.setSize(window.innerWidth, window.innerHeight);
    this.instance.localClippingEnabled = true; // los buses TM se recortan en los muros de los extremos
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFShadowMap; // suave y barato (sol + SpotLights de faroles)

    // Postproceso barato: sin tone mapping moderno
    this.instance.toneMapping = THREE.NoToneMapping;
    this.instance.outputColorSpace = THREE.SRGBColorSpace;

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    this.instance.setSize(window.innerWidth, window.innerHeight);
  }

  render(scene, camera) {
    this.instance.render(scene, camera);
  }
}