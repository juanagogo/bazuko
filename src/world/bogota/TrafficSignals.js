import * as THREE from 'three';
import { createImportedModel } from '../../utils/ImportedModels.js';
import { CARACAS } from './StreetLayout.js';
import { CITY_CARRERAS as CARRERAS, CITY_CALLES as CALLES } from './CityLayout.js';
import { BUS_DETOUR } from './Colpatria.js';

const SEM_HEIGHT = 2.85;

/** Ilumina las zonas de lente pintadas en el GLB, sobre su geometría real. */
export function createSignalMaterial(source, states) {
  const material = source.clone();
  material.metalnessMap = null; material.roughnessMap = null; material.normalMap = null;
  material.metalness = .1; material.roughness = .8;
  material.customProgramCacheKey = () => 'traffic-lenses-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.trafficStates = states;
    shader.vertexShader = 'attribute float trafficAxis;\nvarying float vTrafficAxis;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vTrafficAxis = trafficAxis;\n#include <begin_vertex>');
    shader.fragmentShader = 'uniform vec2 trafficStates;\nvarying float vTrafficAxis;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      vec3 trafficLensColor = diffuseColor.rgb;
      float tr = trafficLensColor.r, tg = trafficLensColor.g, tb = trafficLensColor.b;
      float redLens = step(0.12, tr) * step(tg * 1.8, tr) * step(tb * 1.8, tr);
      float greenLens = step(0.12, tg) * step(tr * 1.8, tg) * step(tb * 1.8, tg);
      float amberLens = step(0.12, tr) * step(0.12, tg) * step(tb * 2.0, tg)
        * step(tr * 0.4, tg) * step(tg * 0.65, tr) * (1.0 - redLens) * (1.0 - greenLens);
      float trafficState = vTrafficAxis < 0.5 ? trafficStates.x : trafficStates.y;
      float trafficLensOn = trafficState < 0.5 ? greenLens : trafficState < 1.5 ? amberLens : redLens;
      float trafficLensMask = min(1.0, redLens + amberLens + greenLens);
      diffuseColor.rgb *= 1.0 - 0.94 * trafficLensMask * (1.0 - trafficLensOn);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      totalEmissiveRadiance += trafficLensColor * trafficLensOn * 1.2;
    `);
  };
  return material;
}

// Verde 14 s, amarillo 3 s y despeje 1 s antes de abrir el otro eje.
export function signalState(time, axis) {
  const phase = ((time - axis * 18) % 36 + 36) % 36;
  return phase < 14 ? 0 : phase < 17 ? 1 : 2;
}

export class TrafficSignals {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Semáforos de la ciudad';
    this.nodes = [];
    this.poles = [];
    this.time = 0;
    this.reservations = new Map();
    this.lensStates = { value: new THREE.Vector2(signalState(0, 0), signalState(0, 1)) };
    const vertical = [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
    for (const [za, zb] of CALLES) for (const [xa, xb] of vertical) {
      const roadX0 = xa * 2 - 1, roadX1 = xb * 2 + 1;
      const node = { x0: roadX0, x1: roadX1, roadX0, roadX1, z0: za * 2 - 1, z1: zb * 2 + 1 };
      // El desvío comparte la fase de la troncal y reserva el cruce completo,
      // pero los postes y las líneas de pare de carros usan los bordes reales de la calzada (roadX0/roadX1).
      if (node.x0 < 78.5 && node.x1 > 78.5 && node.z0 > BUS_DETOUR.z0 && node.z1 < BUS_DETOUR.z1) node.x1 = Math.min(node.x1 + BUS_DETOUR.offset, 125);
      this.nodes.push(node);
      this.poles.push(
        { x: roadX0 - .5, z: node.z1 + .5, hx: 1, hz: 0, axis: 0 },
        { x: roadX1 + .5, z: node.z0 - .5, hx: -1, hz: 0, axis: 0 },
        { x: roadX0 - .5, z: node.z0 - .5, hx: 0, hz: 1, axis: 1 },
        { x: roadX1 + .5, z: node.z1 + .5, hx: 0, hz: -1, axis: 1 }
      );
    }
  }

  async preloadModel() {
    const base = await createImportedModel('semaforo');
    this._buildPoles(base);
    this.update(this.time);
  }

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
      const x0 = node.roadX0 ?? node.x0;
      const x1 = node.roadX1 ?? node.x1;
      const claim = this.reservations.get(node);
      if (vehicle && claim?.owners.get(vehicle)?.entered) continue;
      // Quien ya está en el cruce lo despeja aunque cambie la luz.
      if (current.x >= x0 && current.x <= x1 && current.z >= node.z0 && current.z <= node.z1) continue;
      // Solo obedece quien se acerca a ese acceso. Al salir, la cola del
      // vehículo puede seguir dentro del margen de frenado del mismo cruce.
      const approaching = axis === 0
        ? (direction.x > 0 ? current.x < x0 : current.x > x1)
        : (direction.z > 0 ? current.z < node.z0 : current.z > node.z1);
      if (!approaching) continue;
      const padX = axis === 0 ? length / 2 + .8 : 0;
      const padZ = axis === 1 ? length / 2 + .8 : 0;
      if (point.x >= x0 - padX && point.x <= x1 + padX && point.z >= node.z0 - padZ && point.z <= node.z1 + padZ) {
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
      if (direction < 0 && position.z > node.z1) clearance = Math.min(clearance, Math.max(0, position.z - node.z1 - length / 2 - .8));
      if (direction > 0 && position.z < node.z0) clearance = Math.min(clearance, Math.max(0, node.z0 - position.z - length / 2 - .8));
    }
    return clearance;
  }

  _buildPoles(base) {
    base.updateMatrixWorld(true);
    let mesh = null;
    base.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    const rel = mesh.matrixWorld.clone();
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    let sx = 0, sz = 0, cnt = 0;
    const lowY = SEM_HEIGHT * 0.04;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      if (v.y < lowY) { sx += v.x; sz += v.z; cnt++; }
    }
    // Poste = centro de la base; la cara de las luces mira a -X local
    this.model = { poleX: cnt ? sx / cnt : 0, poleZ: cnt ? sz / cnt : 0 };

    const geometry = mesh.geometry.clone();
    geometry.setAttribute('trafficAxis', new THREE.InstancedBufferAttribute(new Float32Array(this.poles.map(pole => pole.axis)), 1));
    const material = createSignalMaterial(mesh.material, this.lensStates);
    const im = new THREE.InstancedMesh(geometry, material, this.poles.length);
    const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4();
    this.poles.forEach((p, i) => {
      const th = Math.atan2(-p.hz, p.hx); // la cara (-X local) mira al conductor (-rumbo)
      p.th = th;
      const c = Math.cos(th), s = Math.sin(th);
      // origen del modelo = poste en la esquina: P - R * (poleX, poleZ)
      const ox = p.x - (this.model.poleX * c + this.model.poleZ * s);
      const oz = p.z - (-this.model.poleX * s + this.model.poleZ * c);
      p.ox = ox; p.oz = oz;
      R.makeRotationY(th);
      T.makeTranslation(ox, 0, oz);
      M.copy(T).multiply(R).multiply(rel);
      im.setMatrixAt(i, M);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
    this.poleMesh = im;
  }

  dispose() {
    this.group.removeFromParent();
    this.poleMesh?.geometry.dispose(); this.poleMesh?.material.dispose();
  }
}
