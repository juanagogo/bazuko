import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const STRIDE = 8, SCORE = 7;
const vertexShader = `
  attribute float contactAlpha;
  varying vec2 vPoint;
  varying float vAlpha;
  void main() {
    vPoint = uv * 2.0 - 1.0;
    vAlpha = contactAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  uniform float rectangular;
  varying vec2 vPoint;
  varying float vAlpha;
  void main() {
    vec2 squared = vPoint * vPoint;
    float radius = mix(dot(vPoint, vPoint), dot(squared, squared), rectangular);
    float alpha = vAlpha * (1.0 - smoothstep(0.08, 1.0, radius)) * exp(-radius * 1.5);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(0.015, 0.022, 0.03, alpha);
  }
`;

function batch(capacity, rectangular) {
  const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  geometry.setAttribute('contactAlpha', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms: { rectangular: { value: rectangular } },
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.boundingBox = new THREE.Box3();
  mesh.boundingSphere = new THREE.Sphere();
  mesh.frustumCulled = true;
  mesh.renderOrder = 1;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const heightOf = result => typeof result === 'number' ? result : result?.height;
const inactive = actor => !actor || actor.active === false || actor.visible === false || actor._disposed || actor._destroyed;
// Car.vehicle es su modelo local, no un actor. Un wrapper contiene un actor con posición.
const actorOf = source => source?.vehicle?.position ? source.vehicle : source;

/**
 * Dos dibujos transparentes, sin shadow maps, texturas, luces ni pasos de render extra.
 * Actores: {position, root|group, isSwimming?, groundSurface?, isGrounded?}.
 * Vehículos: Car/{position,group,length,width} o {vehicle, position?,group?,length?,width?,forwardAxis?}.
 * El largo va por X local por defecto; envolver BusService con forwardAxis:'z'.
 * groundHeight(x,z,currentY) debe distinguir calle y tablero. Durante un salto se
 * conserva el apoyo conocido del actor para consultar la misma planta del viaducto.
 * getWaterInfo(x,z) devuelve {surfaceY,depth}; el agua bajo el puente no tapa su sombra.
 * update no avanza relojes: también sirve para fijar una vista mientras está pausada.
 */
export class ContactShadows {
  constructor(scene, { capacity = 128 } = {}) {
    this.capacity = Math.max(1, Math.min(128, Math.floor(finite(capacity, 128))));
    this.group = new THREE.Group();
    this.group.name = 'Sombras de contacto';
    this.group.visible = false;
    scene.add(this.group); // Raíz dinámica directa, fuera de los lotes estáticos.
    this.actors = batch(this.capacity, 0);
    this.actors.name = 'Contacto de personas y perro';
    this.vehicles = batch(this.capacity, 1);
    this.vehicles.name = 'Contacto de vehículos';
    this.group.add(this.actors, this.vehicles);
    this._refs = new Array(this.capacity).fill(null);
    this._types = new Uint8Array(this.capacity);
    this._data = new Float64Array(this.capacity * STRIDE);
    this._queued = 0;
    this._position = new THREE.Vector3();
    this._cameraPosition = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._yaw = new THREE.Quaternion();
    this._matrix = new THREE.Matrix4();
    this._projection = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._sphere = new THREE.Sphere();
  }

  get count() { return this.actors.count + this.vehicles.count; }

  _offer(source, type, priority = 0) {
    const actor = actorOf(source);
    if (inactive(source) || inactive(actor)) return;
    if (source.isSwimming || actor.isSwimming || source.movement?.swimming || actor.movement?.swimming || actor.waterFrame?.swimming) return;
    const object = source.root ?? source.group ?? actor.root ?? actor.group;
    for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
    const position = source.position ?? actor.position;
    if (position) this._position.copy(position);
    else if (object) object.getWorldPosition(this._position);
    else return;
    const { x, y, z } = this._position;
    if (!Number.isFinite(x + y + z)) return;
    const distance = this._position.distanceTo(this._cameraPosition);
    if (distance >= this._range) return;
    let rx, rz;
    if (type === 2) {
      rx = THREE.MathUtils.clamp(finite(source.length ?? actor.length, 4.4), 1, 26) * .5;
      rz = THREE.MathUtils.clamp(finite(source.width ?? actor.width, 1.8), .5, 4.5) * .5;
    } else {
      const size = THREE.MathUtils.clamp(finite(source.look?.tamano ?? source.modelScale ?? object?.scale.x, 1), .5, 1.8);
      rx = (type === 1 ? .38 : .48) * size;
      rz = (type === 1 ? .68 : .42) * size;
      if (source.koState) rz *= 2;
    }
    this._sphere.center.copy(this._position);
    this._sphere.radius = Math.hypot(rx, rz) + .15;
    if (this._hasFrustum && !this._frustum.intersectsSphere(this._sphere)) return;
    let yaw = 0;
    if (object) {
      object.getWorldQuaternion(this._quaternion);
      this._direction.set(1, 0, 0).applyQuaternion(this._quaternion);
      yaw = Math.atan2(-this._direction.z, this._direction.x);
    }
    if (type === 2 && (source.forwardAxis ?? actor.forwardAxis) === 'z') yaw -= Math.PI / 2;
    const score = distance + priority;
    if (this._queued === this.capacity && score >= this._data[(this.capacity - 1) * STRIDE + SCORE]) return;
    let index = Math.min(this._queued, this.capacity - 1);
    while (index > 0 && score < this._data[(index - 1) * STRIDE + SCORE]) {
      this._refs[index] = this._refs[index - 1];
      this._types[index] = this._types[index - 1];
      this._data.copyWithin(index * STRIDE, (index - 1) * STRIDE, index * STRIDE);
      index--;
    }
    const at = index * STRIDE;
    this._refs[index] = source; this._types[index] = type;
    this._data[at] = x; this._data[at + 1] = y; this._data[at + 2] = z;
    this._data[at + 3] = rx; this._data[at + 4] = rz;
    this._data[at + 5] = yaw; this._data[at + 6] = distance; this._data[at + SCORE] = score;
    this._queued = Math.min(this.capacity, this._queued + 1);
  }

  _draw(index, groundHeight, getWaterInfo) {
    const source = this._refs[index], actor = actorOf(source);
    const at = index * STRIDE, type = this._types[index];
    const x = this._data[at], y = this._data[at + 1], z = this._data[at + 2];
    const support = source.groundSurface ?? actor.groundSurface;
    const airborne = source.isGrounded === false || actor.isGrounded === false || source.movement?.grounded === false;
    const sampleY = airborne && Number.isFinite(support?.height) ? support.height : y;
    const floor = groundHeight ? heightOf(groundHeight(x, z, sampleY)) : 0;
    if (!Number.isFinite(floor)) return;
    const above = y - floor;
    // Una consulta a otra planta nunca debe dejar una mancha flotante o en el techo.
    const maxHeight = type === 2 ? 1 : 1.8;
    if (above < -.18 || above >= maxHeight) return;
    const water = getWaterInfo?.(x, z);
    const submerged = water ? Number.isFinite(water.surfaceY) ? Math.max(0, water.surfaceY - floor) : Math.max(0, finite(water.depth, 0)) : 0;
    if (submerged > .3) return;
    const distance = this._data[at + 6];
    const fade = 1 - THREE.MathUtils.smoothstep(distance, this._range * .65, this._range);
    const heightFade = (1 - THREE.MathUtils.smoothstep(Math.max(0, above), .06, maxHeight)) ** 2;
    const alpha = this._opacity * (type === 2 ? 1.15 : 1) * fade * heightFade * (1 - submerged / .3);
    if (alpha < .008) return;

    // Ajuste local a rampas: tres consultas acotadas por sombra, sin rayos a triángulos.
    let slopeX = 0, slopeZ = 0;
    if (groundHeight) {
      const hx = heightOf(groundHeight(x + .4, z, floor));
      const hz = heightOf(groundHeight(x, z + .4, floor));
      if (Number.isFinite(hx) && Math.abs(hx - floor) < .24) slopeX = (hx - floor) / .4;
      if (Number.isFinite(hz) && Math.abs(hz - floor) < .24) slopeZ = (hz - floor) / .4;
    }
    this._normal.set(-slopeX, 1, -slopeZ).normalize();
    this._quaternion.setFromUnitVectors(UP, this._normal);
    this._yaw.setFromAxisAngle(UP, this._data[at + 5]);
    this._quaternion.multiply(this._yaw);
    const spread = 1 + Math.min(.35, Math.max(0, above) * .2);
    const rx = this._data[at + 3] * spread, rz = this._data[at + 4] * spread;
    this._position.set(x, floor + .02, z);
    this._scale.set(rx, 1, rz);
    this._matrix.compose(this._position, this._quaternion, this._scale);
    const mesh = type === 2 ? this.vehicles : this.actors;
    mesh.setMatrixAt(mesh.count, this._matrix);
    mesh.geometry.attributes.contactAlpha.setX(mesh.count++, alpha);
    // Bounds conservadores, actualizados con cada lote móvil, sin recorrer las matrices.
    const radius = Math.hypot(rx, rz);
    this._position.set(x - radius, floor - radius, z - radius);
    mesh.boundingBox.expandByPoint(this._position);
    this._position.set(x + radius, floor + radius + .04, z + radius);
    mesh.boundingBox.expandByPoint(this._position);
  }

  update({ player, npcs = [], dog = null, vehicles = [], groundHeight, getWaterInfo, quality = 'baja', camera } = {}) {
    if (this._disposed) return;
    this._range = quality === 'alta' ? 45 : quality === 'media' ? 50 : 55;
    this._opacity = quality === 'alta' ? .13 : quality === 'media' ? .18 : .28;
    const view = camera?.camera ?? camera;
    if (view?.getWorldPosition) view.getWorldPosition(this._cameraPosition);
    else this._cameraPosition.copy(view?.position ?? player?.position ?? this.group.position);
    this._hasFrustum = !!(view?.projectionMatrix && view.matrixWorldInverse);
    if (this._hasFrustum) {
      view.updateWorldMatrix(true, false);
      view.matrixWorldInverse.copy(view.matrixWorld).invert();
      this._projection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._projection);
    }
    this._queued = 0; this._refs.fill(null);
    this.actors.count = this.vehicles.count = 0;
    this.actors.boundingBox.makeEmpty(); this.vehicles.boundingBox.makeEmpty();
    this._offer(player, 0, -2000);
    this._offer(dog, 1, -1000);
    for (const npc of npcs) if (npc !== player && npc !== dog) this._offer(npc, 0);
    for (const vehicle of vehicles) this._offer(vehicle, 2);
    for (let index = 0; index < this._queued; index++) this._draw(index, groundHeight, getWaterInfo);
    this._finish(this.actors); this._finish(this.vehicles);
    this.group.visible = this.count > 0;
  }

  _finish(mesh) {
    mesh.visible = mesh.count > 0;
    if (mesh.count) mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
    else { mesh.boundingSphere.center.set(0, 0, 0); mesh.boundingSphere.radius = 0; }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.attributes.contactAlpha.needsUpdate = true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.group.removeFromParent(); this.group.visible = false;
    this._refs.fill(null);
    this.actors.dispose(); this.actors.geometry.dispose(); this.actors.material.dispose();
    this.vehicles.dispose(); this.vehicles.geometry.dispose(); this.vehicles.material.dispose();
  }
}
