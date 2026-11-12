// src/entities/PoopStink.js
// El olor de las popós: líneas verdes onduladas que suben y se desvanecen con la altura, todas en una
// sola malla instanciada. Cada línea gira hacia la cámara y su fuerza va por instancia.
import * as THREE from 'three';

export const STINK_PER_POOP = 3;
export const STINK_HEIGHT = .55;
/** Hz de la subida: lento, muy por debajo del medio hercio que permite el proyecto para brillos. */
export const STINK_RATE = .32;
export const STINK_COLOR = 0xa8cf3c;
export const STINK_RISE = 1.5;
const STRENGTH = .85;
// Sitio de cada línea sobre el montón y su desfase, como en la maqueta aprobada.
const LINES = [[-.08, .12, .01, 0], [.01, .17, .03, 2.1], [.09, .1, -.02, 4.2]];

const VERTEX = /* glsl */`
  uniform float uTime;
  attribute float aPhase;
  attribute float aStrength;
  varying vec2 vUv;
  varying float vPhase;
  varying float vStrength;
  void main() {
    vUv = uv;
    vPhase = aPhase;
    vStrength = aStrength;
    vec3 p = position;
    p.x += sin(uv.y * 9.0 - uTime * 2.6 + aPhase) * 0.045 * (0.3 + uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }`;
const FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uRate;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vPhase;
  varying float vStrength;
  void main() {
    float y = vUv.y;
    float edge = smoothstep(0.0, 0.7, 1.0 - abs(vUv.x - 0.5) * 2.0);
    float cyc = fract(uTime * uRate + vPhase * 0.159);
    float band = smoothstep(cyc - 0.5, cyc - 0.12, y) * (1.0 - smoothstep(cyc - 0.04, cyc + 0.16, y));
    float a = edge * band * smoothstep(0.0, 0.12, y) * (1.0 - y) * vStrength;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

const clamp01 = x => Math.max(0, Math.min(1, x));

export class PoopStink {
  constructor(scene, { maxPiles = 8 } = {}) {
    this.capacity = maxPiles * STINK_PER_POOP;
    const geometry = new THREE.PlaneGeometry(.045, STINK_HEIGHT, 1, 24);
    geometry.translate(0, STINK_HEIGHT / 2, 0);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.strength = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.phase.setUsage(THREE.DynamicDrawUsage);
    this.strength.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPhase', this.phase);
    geometry.setAttribute('aStrength', this.strength);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uRate: { value: STINK_RATE }, uColor: { value: new THREE.Color(STINK_COLOR) } }
    }), this.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 2;
    this._count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._hide();
    scene.add(this.mesh);
  }

  get count() { return this._count; }
  strengthAt(i) { return this.strength.getX(i); }

  /** Sin olor queda una línea de fuerza 0: el programa se compila igual durante la carga. */
  _hide() {
    this.strength.setX(0, 0);
    this.mesh.setMatrixAt(0, this._m.makeScale(0, 0, 0));
    this.mesh.count = 1;
    this.strength.needsUpdate = this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, piles, { time = 0, camera = null } = {}) {
    let n = 0;
    for (const pile of piles) {
      if (!pile.visible || pile.settledAge == null) continue;
      const strength = STRENGTH * clamp01(pile.settledAge / STINK_RISE) * (1 - (pile.fade ?? 0));
      for (const [x, y, z, phase] of LINES) {
        if (n >= this.capacity) break;
        this._p.set(pile.position.x + x, pile.position.y + y * (1 - (pile.fade ?? 0)), pile.position.z + z);
        const yaw = camera ? Math.atan2(camera.position.x - this._p.x, camera.position.z - this._p.z) : 0;
        this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        this.mesh.setMatrixAt(n, this._m.compose(this._p, this._q, this._one));
        this.phase.setX(n, phase + (pile.seed ?? 0));
        this.strength.setX(n, strength);
        n++;
      }
    }
    this._count = n;
    this.mesh.material.uniforms.uTime.value = time;
    if (!n) { this._hide(); return; }
    this.mesh.count = n;
    this.phase.needsUpdate = this.strength.needsUpdate = this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
