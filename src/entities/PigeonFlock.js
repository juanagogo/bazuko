import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function part(geometry, color, position, scale = [1, 1, 1], rotation = [0, 0, 0]) {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
  geometry.applyMatrix4(matrix);
  const rgb = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = rgb.r; colors[i + 1] = rgb.g; colors[i + 2] = rgb.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function bodyGeometry() {
  const parts = [
    part(new THREE.SphereGeometry(1, 8, 6), '#87919e', [0, .21, 0], [.105, .14, .19]),
    part(new THREE.SphereGeometry(1, 8, 5), '#526c70', [0, .31, .08], [.065, .1, .065]),
    part(new THREE.SphereGeometry(1, 8, 5), '#697889', [0, .39, .105], [.07, .065, .075]),
    part(new THREE.ConeGeometry(.023, .075, 5), '#c6b9a2', [0, .39, .195], [1, 1, 1], [Math.PI / 2, 0, 0]),
    part(new THREE.BoxGeometry(.11, .025, .16), '#424b58', [0, .17, -.22], [1, 1, 1], [-.15, 0, 0]),
    ...[-1, 1].map(side => part(new THREE.SphereGeometry(.013, 5, 4), '#17191b', [side * .063, .408, .135]))
  ];
  const geometry = mergeGeometries(parts); parts.forEach(piece => piece.dispose());
  return geometry;
}

// Una paloma es tan simple que pegada a la cámara se ve como una mole: tan cerca, no se dibuja.
const CAMERA_CLEARANCE = 1.2;

/** Diez aves por parque, cinco llamadas de dibujo y ninguna simulación física. */
export class PigeonFlock {
  constructor(scene, bounds, { count = 10, random = Math.random, isGround = () => true, groundHeight = () => 0 } = {}) {
    this.scene = scene; this.bounds = bounds; this.random = random;
    this.isGround = isGround; this.groundHeight = groundHeight;
    this.group = new THREE.Group(); this.group.name = 'Palomas del parque';
    this.group.position.set((bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2);
    this._dummy = new THREE.Object3D(); this._local = new THREE.Object3D(); this._matrix = new THREE.Matrix4();
    this._disposed = false;
    this._people = []; this._scanTimer = 0;
    this.birds = [];
    for (let i = 0; i < count; i++) {
      const position = this._point();
      if (!position) break;
      this.birds.push({ position, from: position.clone(), target: position.clone(), yaw: random() * Math.PI * 2,
        phase: random() * Math.PI * 2, state: 'idle', timer: .5 + random() * 3, scale: .9 + random() * .2,
        threat: new THREE.Vector3() });
    }
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const body = bodyGeometry();
    const leftWing = part(new THREE.BoxGeometry(.23, .028, .27), '#727e8e', [-.105, 0, -.035]);
    const rightWing = part(new THREE.BoxGeometry(.23, .028, .27), '#727e8e', [.105, 0, -.035]);
    const leg = part(new THREE.CylinderGeometry(.011, .009, .1, 5), '#ad7774', [0, -.05, 0]);
    const box = new THREE.Box3(new THREE.Vector3(bounds.x0 - this.group.position.x - 1, -.1, bounds.z0 - this.group.position.z - 1),
      new THREE.Vector3(bounds.x1 - this.group.position.x + 1, 7, bounds.z1 - this.group.position.z + 1));
    this.meshes = [body, leftWing, rightWing, leg, leg].map(geometry => {
      const mesh = new THREE.InstancedMesh(geometry, material, this.birds.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.boundingBox = box.clone(); mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      this.group.add(mesh); return mesh;
    });
    scene.add(this.group);
    this._paint();
  }

  _inside(x, z) {
    const b = this.bounds;
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && this.isGround(x, z);
  }

  _point(away = null) {
    let best = null, score = -Infinity;
    for (let i = 0; i < 32; i++) {
      const x = this.bounds.x0 + this.random() * (this.bounds.x1 - this.bounds.x0);
      const z = this.bounds.z0 + this.random() * (this.bounds.z1 - this.bounds.z0);
      if (!this._inside(x, z)) continue;
      const distance = away ? Math.hypot(x - away.x, z - away.z) : 0;
      if (distance > score) { best = new THREE.Vector3(x, this.groundHeight(x, z), z); score = distance; }
      if (!away || score > 8) break;
    }
    return best;
  }

  _takeOff(bird, player) {
    const destination = this._point(player);
    if (!destination) { bird.state = 'idle'; bird.timer = 1; return; }
    bird.from.copy(bird.position); bird.target.copy(destination);
    bird.state = 'flying'; bird.elapsed = 0;
    bird.duration = Math.max(2.5, bird.from.distanceTo(destination) / (3 + this.random()));
    bird.height = 2 + this.random() * 2;
  }

  update(dt, player, npcs = [], camera = null) {
    if (this._disposed || !player) return;
    this._camera = camera;
    this.group.visible = Math.hypot(player.x - this.group.position.x, player.z - this.group.position.z) < 90;
    if (!this.group.visible) return;
    dt = Math.min(Math.max(0, dt), .1);
    // Filtrar personas del parque siete veces por segundo; las posiciones siguen siendo referencias vivas.
    this._scanTimer -= dt;
    if (this._scanTimer <= 0) {
      this._scanTimer = .15; this._people.length = 0;
      const b = this.bounds;
      for (const npc of npcs) {
        const p = npc.position;
        // Quien está sentado o dormido en su sitio ya no las asusta.
        if (npc.fijo && !npc.fijo.out) continue;
        if (p && p.x >= b.x0 - 3.5 && p.x <= b.x1 + 3.5 && p.z >= b.z0 - 3.5 && p.z <= b.z1 + 3.5) this._people.push(p);
      }
    }
    for (const bird of this.birds) {
      bird.phase += dt * (bird.state === 'flying' ? 32 : 8);
      if (bird.state !== 'flying' && bird.state !== 'startled') {
        let threat = null, nearest = 3.5 * 3.5;
        const check = p => {
          const dx = p.x - bird.position.x, dz = p.z - bird.position.z, squared = dx * dx + dz * dz;
          if (squared < nearest) { threat = p; nearest = squared; }
        };
        check(player);
        for (const person of this._people) check(person);
        if (threat) {
          bird.threat.copy(threat); bird.state = 'startled'; bird.timer = this.random() * .22;
        }
      }
      if (bird.state === 'flying') {
        bird.elapsed += dt;
        const t = Math.min(1, bird.elapsed / bird.duration), ease = t * t * (3 - 2 * t);
        bird.position.lerpVectors(bird.from, bird.target, ease);
        bird.position.y += Math.sin(Math.PI * t) * bird.height;
        bird.yaw = Math.atan2(bird.target.x - bird.from.x, bird.target.z - bird.from.z);
        if (t === 1) { bird.state = 'idle'; bird.timer = 1 + this.random() * 3; }
      } else if (bird.state === 'startled') {
        bird.timer -= dt;
        if (bird.timer <= 0) this._takeOff(bird, bird.threat);
      } else if (bird.state === 'walking') {
        const dx = bird.target.x - bird.position.x, dz = bird.target.z - bird.position.z, distance = Math.hypot(dx, dz);
        const step = Math.min(distance, dt * .45);
        const x = bird.position.x + dx / Math.max(distance, .001) * step;
        const z = bird.position.z + dz / Math.max(distance, .001) * step;
        if (distance < .08 || !this._inside(x, z)) { bird.state = 'idle'; bird.timer = .5 + this.random() * 3; }
        else { bird.position.set(x, this.groundHeight(x, z), z); bird.yaw = Math.atan2(dx, dz); }
      } else {
        bird.timer -= dt;
        if (bird.timer <= 0) {
          const angle = this.random() * Math.PI * 2, distance = 1 + this.random() * 2;
          const x = bird.position.x + Math.sin(angle) * distance, z = bird.position.z + Math.cos(angle) * distance;
          if (this._inside(x, z)) { bird.target.set(x, this.groundHeight(x, z), z); bird.state = 'walking'; }
          else bird.timer = 1;
        }
      }
    }
    this._paint();
  }

  _paint() {
    this.birds.forEach((bird, i) => {
      const flying = bird.state === 'flying', walking = bird.state === 'walking';
      this._dummy.position.copy(bird.position).sub(this.group.position);
      if (walking) this._dummy.position.y += Math.abs(Math.sin(bird.phase)) * .012;
      this._dummy.rotation.set(flying ? -.12 : bird.state === 'idle' ? Math.sin(bird.phase * .4) * .08 : 0, bird.yaw, 0);
      const close = this._camera && this._camera.position.distanceToSquared(bird.position) < CAMERA_CLEARANCE ** 2;
      this._dummy.scale.setScalar(close ? 0 : bird.scale); this._dummy.updateMatrix();
      this.meshes[0].setMatrixAt(i, this._dummy.matrix);
      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1;
        this._local.position.set(sign * .075, .25, 0);
        this._local.rotation.set(0, 0, sign * (flying ? Math.sin(bird.phase) * .85 : -1.15));
        this._local.updateMatrix(); this._matrix.multiplyMatrices(this._dummy.matrix, this._local.matrix);
        this.meshes[side + 1].setMatrixAt(i, this._matrix);
        this._local.position.set(sign * .045, .1, .01);
        this._local.rotation.set(flying ? -.9 : walking ? Math.sin(bird.phase) * sign * .4 : 0, 0, 0);
        this._local.updateMatrix(); this._matrix.multiplyMatrices(this._dummy.matrix, this._local.matrix);
        this.meshes[side + 3].setMatrixAt(i, this._matrix);
      }
    });
    this.meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true; this.group.removeFromParent();
    const geometries = new Set(this.meshes.map(mesh => mesh.geometry));
    for (const geometry of geometries) geometry.dispose();
    this.meshes[0].material.dispose();
    for (const mesh of this.meshes) mesh.dispose();
  }
}
