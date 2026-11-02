import * as THREE from 'three';
import { CARACAS } from './StreetLayout.js';
import { CITY_CARRERAS as CARRERAS, CITY_CALLES as CALLES } from './CityLayout.js';
import { BUS_DETOUR } from './Colpatria.js';
import { STATIC_CHUNK_SIZE } from './StaticGeometry.js';
import { FAR_SIGNAL_DISTANCE, createFarSignalGeometry, createHaloGeometry, createHaloMaterial, createSignalAtlas, createSignalGeometry, createSignalMaterial, nightFromSky } from './SignalModel.js';

// Verde 14 s, amarillo 3 s y despeje 1 s antes de abrir el otro eje.
export function signalState(time, axis) {
  const phase = ((time - axis * 18) % 36 + 36) % 36;
  return phase < 14 ? 0 : phase < 17 ? 1 : 2;
}

// Un cruce por lote: sus postes se ven o se descartan juntos, y dos lotes por esquina no ganan nada.
const SIGNAL_CHUNK_SIZE = STATIC_CHUNK_SIZE * 2;
const FAR_SIGNAL_MARGIN = 4; // un lote en el límite no cambia de modelo con cada paso

export class TrafficSignals {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Semáforos de la ciudad';
    this.nodes = [];
    this.poles = [];
    this.time = 0;
    this.reservations = new Map();
    this.lensStates = { value: new THREE.Vector2(signalState(0, 0), signalState(0, 1)) };
    this.nightLevel = { value: 1 };
    this.wetLevel = { value: 0 };
    const vertical = [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
    const insideBand = (value, bands) => bands.some(([a, b]) => value > a * 2 - 1 && value < b * 2 + 1);
    for (const [za, zb] of CALLES) for (const [xa, xb] of vertical) {
      const node = { x0: xa * 2 - 1, x1: xb * 2 + 1, z0: za * 2 - 1, z1: zb * 2 + 1 };
      // El desvío comparte la fase de la troncal y reserva el cruce completo.
      if (node.x0 < 78.5 && node.x1 > 78.5 && node.z0 > BUS_DETOUR.z0 && node.z1 < BUS_DETOUR.z1) node.x1 = Math.min(node.x1 + BUS_DETOUR.offset, 125);
      this.nodes.push(node);
      this.poles.push(
        { x: node.x0 - .5, z: node.z1 + .5, hx: 1, hz: 0, axis: 0 },
        { x: node.x1 + .5, z: node.z0 - .5, hx: -1, hz: 0, axis: 0 },
        { x: node.x0 - .5, z: node.z0 - .5, hx: 0, hz: 1, axis: 1 },
        { x: node.x1 + .5, z: node.z1 + .5, hx: 0, hz: -1, axis: 1 }
      );
    }
    // El desvío ensancha su cruce hasta la carrera vecina: esos postes caen en plena
    // calzada. Siguen en la lista, porque ninguna regla de tráfico los necesita de otro
    // modo, pero no se dibujan: quien va por la carrera tiene los suyos a menos de ocho metros.
    for (const pole of this.poles) pole.onRoadway = insideBand(pole.x, vertical) || insideBand(pole.z, CALLES);
    // El carril X 66 hacia −Z también obedece ese cruce, y el poste que le tocaba queda a 60 m. En su esquina está
    // la torre Colpatria, así que el suyo va al otro lado del cruce, en el prado del separador.
    this.poles.push({ x: 69.5, z: 142.5, hx: 0, hz: -1, axis: 1, onRoadway: false, laneSignal: true });
  }

  /** Se conserva por contrato con el distrito; el modelo ya no requiere descargas. */
  async preloadModel() {
    if (!this.poleMeshes) this._buildPoles();
    this.update(this.time);
  }

  /** En baja, los lotes lejos de la cámara usan el poste liviano; sin `allowFar` todos van completos. */
  updateDetail(cameraPosition, allowFar = true) {
    for (const mesh of this.poleMeshes ?? []) {
      const { nearGeometry, farGeometry } = mesh.userData;
      const limit = FAR_SIGNAL_DISTANCE + (mesh.geometry === nearGeometry ? FAR_SIGNAL_MARGIN : 0);
      mesh.geometry = allowFar && mesh.boundingBox.distanceToPoint(cameraPosition) > limit ? farGeometry : nearGeometry;
    }
  }

  /** Humedad del piso: solo decide cuánto se refleja la luz en el asfalto. */
  setWetness(amount = 0) { this.wetLevel.value = amount; }

  update(time) {
    this.time = time;
    const states = [signalState(time, 0), signalState(time, 1)];
    if (this._states?.every((state, axis) => state === states[axis])) return;
    this._states = states;
    this.lensStates.value.set(states[0], states[1]);
  }

  blocks(point, direction, current, length = 0, vehicle = null) {
    const axis = Math.abs(direction.x) >= Math.abs(direction.z) ? 0 : 1;
    const red = signalState(this.time, axis) !== 0;
    if (!red && !vehicle) return false;
    for (const node of this.nodes) {
      const claim = this.reservations.get(node);
      if (vehicle && claim?.owners.get(vehicle)?.entered) continue;
      // Quien ya está en el cruce lo despeja aunque cambie la luz.
      if (current.x >= node.x0 && current.x <= node.x1 && current.z >= node.z0 && current.z <= node.z1) continue;
      // Solo obedece quien se acerca a ese acceso. Al salir, la cola del
      // vehículo puede seguir dentro del margen de frenado del mismo cruce.
      const approaching = axis === 0
        ? (direction.x > 0 ? current.x < node.x0 : current.x > node.x1)
        : (direction.z > 0 ? current.z < node.z0 : current.z > node.z1);
      if (!approaching) continue;
      const padX = axis === 0 ? length / 2 + .8 : 0;
      const padZ = axis === 1 ? length / 2 + .8 : 0;
      if (point.x >= node.x0 - padX && point.x <= node.x1 + padX && point.z >= node.z0 - padZ && point.z <= node.z1 + padZ) {
        if (red || (vehicle && claim && !claim.owners.has(vehicle))) return true;
      }
    }
    return false;
  }

  busClearance(position, length, direction = -1) {
    if (position.y > 3) return Infinity;
    const red = signalState(this.time, 1) !== 0;
    let clearance = Infinity;
    for (const node of this.nodes) {
      if (!red && !this.reservations.get(node)?.busBlocked) continue;
      if (position.x < node.x0 || position.x > node.x1) continue;
      const toEdge = direction < 0 ? position.z - node.z1 : node.z0 - position.z;
      if (toEdge <= 0) continue;
      // Con el frente ya dentro lo despeja, como los carros: parado ahí le cierra el paso a quien cruza,
      // y si ese ya tenía el cruce reservado se esperan los dos para siempre.
      const toLine = toEdge - length / 2 - .8;
      if (toLine >= -.8) clearance = Math.min(clearance, Math.max(0, toLine));
    }
    return clearance;
  }

  _buildPoles() {
    const { geometry, lamps } = createSignalGeometry();
    const farGeometry = createFarSignalGeometry();
    this.atlas = createSignalAtlas();
    const material = createSignalMaterial(this.lensStates, this.nightLevel, this.atlas);
    const haloGeometry = createHaloGeometry(lamps);
    const haloMaterial = createHaloMaterial(this.lensStates, this.nightLevel, this.wetLevel);
    const nightLevel = this.nightLevel;
    // Se lee del cielo que ya calculó la escena: no hay que avisarle a cada semáforo.
    const readSky = (renderer, scene) => { if (scene.background?.isColor) nightLevel.value = nightFromSky(scene.background); };
    const buckets = new Map();
    const matrix = new THREE.Matrix4(), rotation = new THREE.Matrix4();
    for (const pole of this.poles) {
      if (pole.onRoadway) continue;
      pole.th = Math.atan2(-pole.hz, pole.hx); // la cara (-X local) mira al conductor (-rumbo)
      rotation.makeRotationY(pole.th);
      matrix.makeTranslation(pole.x, 0, pole.z).multiply(rotation);
      const key = `${Math.floor(pole.x / SIGNAL_CHUNK_SIZE)},${Math.floor(pole.z / SIGNAL_CHUNK_SIZE)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ pole, matrix: matrix.clone() });
    }
    this.poleMeshes = [];
    this.haloMeshes = [];
    for (const entries of buckets.values()) {
      // Atributos compartidos: dividir el frustum no multiplica los buffers de vértices.
      const axis = new THREE.InstancedBufferAttribute(new Float32Array(entries.map(entry => entry.pole.axis)), 1);
      const batch = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) batch.setAttribute(name, attribute);
      batch.setIndex(geometry.index);
      batch.boundingSphere = geometry.boundingSphere;
      batch.boundingBox = geometry.boundingBox;
      batch.setAttribute('trafficAxis', axis);
      const farBatch = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(farGeometry.attributes)) farBatch.setAttribute(name, attribute);
      farBatch.setIndex(farGeometry.index);
      // Los mismos límites del poste completo: cambiar de modelo no cambia lo que se descarta.
      farBatch.boundingSphere = geometry.boundingSphere;
      farBatch.boundingBox = geometry.boundingBox;
      farBatch.setAttribute('trafficAxis', axis);
      const poles = new THREE.InstancedMesh(batch, material, entries.length);
      poles.userData.nearGeometry = batch;
      poles.userData.farGeometry = farBatch;
      entries.forEach(({ pole, matrix }, i) => {
        poles.setMatrixAt(i, matrix);
        pole.batchIndex = this.poleMeshes.length;
        pole.instanceIndex = i;
      });
      poles.instanceMatrix.needsUpdate = true;
      poles.castShadow = true; poles.receiveShadow = true;
      poles.computeBoundingBox(); poles.computeBoundingSphere();
      poles.onBeforeRender = readSky;
      this.group.add(poles);
      this.poleMeshes.push(poles);

      const haloBatch = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(haloGeometry.attributes)) haloBatch.setAttribute(name, attribute);
      haloBatch.setIndex(haloGeometry.index);
      haloBatch.boundingSphere = haloGeometry.boundingSphere;
      haloBatch.boundingBox = haloGeometry.boundingBox;
      haloBatch.setAttribute('trafficAxis', axis);
      const halos = new THREE.InstancedMesh(haloBatch, haloMaterial, entries.length);
      entries.forEach(({ matrix }, i) => halos.setMatrixAt(i, matrix));
      halos.instanceMatrix.needsUpdate = true;
      halos.castShadow = false; halos.receiveShadow = false;
      halos.computeBoundingBox(); halos.computeBoundingSphere();
      this.group.add(halos);
      this.haloMeshes.push(halos);
    }
    // Alias para quien solo consulta el material compartido de las lentes.
    this.poleMesh = this.poleMeshes[0];
  }

  dispose() {
    this.group.removeFromParent();
    for (const mesh of this.poleMeshes ?? []) { mesh.dispose(); mesh.userData.nearGeometry.dispose(); mesh.userData.farGeometry.dispose(); }
    for (const mesh of this.haloMeshes ?? []) { mesh.dispose(); mesh.geometry.dispose(); }
    this.poleMesh?.material.dispose();
    this.haloMeshes?.[0]?.material.dispose();
    this.atlas?.dispose();
  }
}
