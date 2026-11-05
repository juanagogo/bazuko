import * as THREE from 'three';

const RINGS = 16, DROPS = 48;
const ringVertex = `
  attribute float effectAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = effectAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const ringFragment = `
  varying float vAlpha;
  void main() { gl_FragColor = vec4(0.68, 0.86, 0.83, vAlpha); }
`;
const dropVertex = `
  attribute float effectAlpha;
  attribute float effectSize;
  varying float vAlpha;
  void main() {
    vAlpha = effectAlpha;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(effectSize * 240.0 / max(0.1, -viewPosition.z), 1.0, 7.0);
  }
`;
const dropFragment = `
  varying float vAlpha;
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float edge = 1.0 - smoothstep(0.30, 0.5, radius);
    if (edge <= 0.0) discard;
    gl_FragColor = vec4(0.77, 0.94, 0.92, vAlpha * edge);
  }
`;

/** Dos dibujos, sin luces/texturas: ondas instanciadas y gotas con un pool fijo. */
export class WaterEffects {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'Ondas y salpicaduras del jugador';
    this.group.visible = false;
    // Raíz dinámica directa: no participa de la geometría estática de la ciudad.
    scene.add(this.group);
    this.ringPool = Array.from({ length: RINGS }, () => ({ active: false, age: 0, life: 0, x: 0, y: 0, z: 0, size: 0, strength: 0 }));
    this.dropPool = Array.from({ length: DROPS }, () => ({ active: false, age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, floor: 0, size: 0 }));
    this._ringIndex = 0; this._dropIndex = 0; this._distance = 0; this._wasInWater = false;
    this._transform = new THREE.Object3D();
    const ringGeometry = new THREE.RingGeometry(.86, 1, 32).rotateX(-Math.PI / 2);
    this.ringAlpha = new THREE.InstancedBufferAttribute(new Float32Array(RINGS), 1).setUsage(THREE.DynamicDrawUsage);
    ringGeometry.setAttribute('effectAlpha', this.ringAlpha);
    const material = (vertexShader, fragmentShader) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthTest: true, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide
    });
    this.rings = new THREE.InstancedMesh(ringGeometry, material(ringVertex, ringFragment), RINGS);
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 4;
    this.group.add(this.rings);
    const dropGeometry = new THREE.BufferGeometry();
    this.dropPositions = new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dropAlpha = new THREE.BufferAttribute(new Float32Array(DROPS), 1).setUsage(THREE.DynamicDrawUsage);
    this.dropSize = new THREE.BufferAttribute(new Float32Array(DROPS), 1).setUsage(THREE.DynamicDrawUsage);
    dropGeometry.setAttribute('position', this.dropPositions);
    dropGeometry.setAttribute('effectAlpha', this.dropAlpha);
    dropGeometry.setAttribute('effectSize', this.dropSize);
    dropGeometry.setDrawRange(0, 0);
    this.drops = new THREE.Points(dropGeometry, material(dropVertex, dropFragment));
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 5;
    this.group.add(this.drops);
  }

  _ring(x, y, z, strength, size = .25) {
    const ring = this.ringPool[this._ringIndex++ % RINGS];
    ring.active = true; ring.age = 0; ring.life = .75 + strength * .7;
    ring.x = x; ring.y = y + .026; ring.z = z;
    ring.strength = strength; ring.size = size;
  }

  _splash(position, surfaceY, intensity) {
    this._ring(position.x, surfaceY, position.z, intensity, .25);
    this._ring(position.x, surfaceY + .003, position.z, intensity * .65, .5);
    const count = Math.round(8 + intensity * 24);
    for (let i = 0; i < count; i++) {
      const drop = this.dropPool[this._dropIndex++ % DROPS];
      const angle = i * 2.39996323, spread = .35 + (i % 7) / 7;
      drop.active = true; drop.age = 0; drop.life = .35 + intensity * .35;
      drop.x = position.x + Math.cos(angle) * .18; drop.y = surfaceY + .04;
      drop.z = position.z + Math.sin(angle) * .18;
      drop.vx = Math.cos(angle) * spread * (1 + intensity);
      drop.vz = Math.sin(angle) * spread * (1 + intensity);
      drop.vy = .7 + intensity * 2 + spread * .4;
      drop.floor = surfaceY; drop.size = .045 + intensity * .045;
    }
  }

  update(dt, player, water = player?.waterFrame) {
    if (this._disposed) return;
    dt = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    if (dt === 0) return;
    const inWater = !!water?.inWater && Number.isFinite(water.surfaceY) && !!player?.position;
    if (inWater && !this._wasInWater) {
      this._splash(player.position, water.surfaceY, THREE.MathUtils.clamp(water.entryIntensity ?? .2, .1, 1));
    }
    if (inWater && player.speed > .15) {
      this._distance += player.speed * dt;
      if (this._distance >= (water.swimming ? .42 : .52)) {
        this._distance %= water.swimming ? .42 : .52;
        const facing = player.root?.rotation.y ?? 0;
        const trail = water.swimming ? .25 : 0;
        this._ring(player.position.x - Math.sin(facing) * trail, water.surfaceY,
          player.position.z - Math.cos(facing) * trail, .25 + (water.intensity ?? .2) * .4, water.swimming ? .28 : .18);
      }
    } else this._distance = 0;
    this._wasInWater = inWater;

    let count = 0;
    for (const ring of this.ringPool) {
      if (!ring.active) continue;
      ring.age += dt;
      if (ring.age >= ring.life) { ring.active = false; continue; }
      const progress = ring.age / ring.life;
      const radius = ring.size + progress * (1 + ring.strength * 1.1);
      this._transform.position.set(ring.x, ring.y, ring.z);
      this._transform.scale.set(radius, 1, radius);
      this._transform.updateMatrix();
      this.rings.setMatrixAt(count, this._transform.matrix);
      this.ringAlpha.setX(count++, (1 - progress) ** 2 * (.22 + ring.strength * .35));
    }
    this.rings.count = count;
    this.rings.instanceMatrix.needsUpdate = true;
    this.ringAlpha.needsUpdate = true;
    let drops = 0;
    for (const drop of this.dropPool) {
      if (!drop.active) continue;
      drop.age += dt; drop.vy -= 6.5 * dt;
      drop.x += drop.vx * dt; drop.y += drop.vy * dt; drop.z += drop.vz * dt;
      if (drop.age >= drop.life || drop.y <= drop.floor) { drop.active = false; continue; }
      this.dropPositions.setXYZ(drops, drop.x, drop.y, drop.z);
      this.dropAlpha.setX(drops, (1 - drop.age / drop.life) * .75);
      this.dropSize.setX(drops++, drop.size);
    }
    this.drops.geometry.setDrawRange(0, drops);
    this.dropPositions.needsUpdate = this.dropAlpha.needsUpdate = this.dropSize.needsUpdate = true;
    this.group.visible = count > 0 || drops > 0;
  }

  reset() {
    for (const effect of this.ringPool) effect.active = false;
    for (const effect of this.dropPool) effect.active = false;
    this.rings.count = 0; this.drops.geometry.setDrawRange(0, 0);
    this.group.visible = false; this._distance = 0; this._wasInWater = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.group.removeFromParent();
    this.rings.dispose(); this.rings.geometry.dispose(); this.rings.material.dispose();
    this.drops.geometry.dispose(); this.drops.material.dispose();
  }
}
