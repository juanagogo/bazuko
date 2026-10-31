import * as THREE from 'three/webgpu';
import {uniform,texture,uv,color,attribute,step,max,min,float,mix} from 'three/tsl';
import { createImportedModel } from '../../utils/ImportedModels.js';
import { CARACAS } from './StreetLayout.js';
import { CITY_CARRERAS as CARRERAS, CITY_CALLES as CALLES } from './CityLayout.js';
import { signTexture } from '../../utils/signs.js';
import { BUS_DETOUR } from './Colpatria.js';
import { STATIC_CHUNK_SIZE } from './StaticGeometry.js';

const SEM_HEIGHT = 4.3;

/** Ilumina las zonas de lente pintadas en el GLB, sobre su geometría real. */
export function createSignalMaterial(source, states) {
  const material=new THREE.MeshStandardNodeMaterial({map:source.map,color:source.color,roughness:.8,metalness:.1});
  const c=source.map?texture(source.map,uv()).rgb.mul(color(source.color)):color(source.color);
  const red=step(.12,c.r).mul(step(c.g.mul(1.8),c.r)).mul(step(c.b.mul(1.8),c.r));
  const green=step(.12,c.g).mul(step(c.r.mul(1.8),c.g)).mul(step(c.b.mul(1.8),c.g));
  const amber=step(.12,c.r).mul(step(.12,c.g)).mul(step(c.b.mul(2),c.g)).mul(step(c.r.mul(.4),c.g)).mul(step(c.g.mul(.65),c.r)).mul(float(1).sub(red)).mul(float(1).sub(green));
  const state=uniform(states.value),axis=attribute('trafficAxis','float');
  const selected=mix(state.x,state.y,step(.5,axis));
  const on=mix(mix(green,amber,step(.5,selected)),red,step(1.5,selected));
  material.colorNode=c.mul(float(1).sub(min(1,red.add(green).add(amber)).mul(float(1).sub(on)).mul(.94)));
  material.emissiveNode=c.mul(on).mul(1.2);material.userData.trafficStates=state;
  return material;
}

// Verde 14 s, amarillo 3 s y despeje 1 s antes de abrir el otro eje.
export function signalState(time, axis) {
  const phase = ((time - axis * 18) % 36 + 36) % 36;
  return phase < 14 ? 0 : phase < 17 ? 1 : 2;
}

export function intersectionPhase(signals,node,axis){return node.control==='priority'?0:signalState(signals.time,axis);}


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
      const node = { x0: xa * 2 - 1, x1: xb * 2 + 1, z0: za * 2 - 1, z1: zb * 2 + 1 };
      // El desvío comparte la fase de la troncal y reserva el cruce completo.
      // El rodeo ahora va sobre el viaducto: no reservar cruces vecinos de la calle inferior.
      this.nodes.push(node);
      this.poles.push(
        { x: node.x0 - .5, z: node.z1 + .5, hx: 1, hz: 0, axis: 0 },
        { x: node.x1 + .5, z: node.z0 - .5, hx: -1, hz: 0, axis: 0 },
        { x: node.x0 - .5, z: node.z0 - .5, hx: 0, hz: 1, axis: 1 },
        { x: node.x1 + .5, z: node.z1 + .5, hx: 0, hz: -1, axis: 1 }
      );
    }
    const count=Math.ceil(this.nodes.length/4);
    const ranked=[...this.nodes].sort((a,b)=>Number(b.x0<=CARACAS.lanes[1][1]*2&&b.x1>=CARACAS.lanes[0][0]*2)-Number(a.x0<=CARACAS.lanes[1][1]*2&&a.x1>=CARACAS.lanes[0][0]*2)|| (b.x1-b.x0+b.z1-b.z0)-(a.x1-a.x0+a.z1-a.z0)||a.z0-b.z0||a.x0-b.x0);
    const selected=new Set(ranked.slice(0,count));
    for(const node of this.nodes){node.control=selected.has(node)?'signal':'priority';node.mainAxis=node.x1-node.x0>=node.z1-node.z0?1:0;}
    this.poles=this.poles.filter((pole,i)=>this.nodes[Math.floor(i/4)].control==='signal');
  }

  async preloadModel() {
    const base = await createImportedModel('semaforo');
    this._buildPoles(base);
    this.update(this.time);
    const priority=this.nodes.filter(n=>n.control==='priority'),count=priority.length*2;
    const map=signTexture({title:'PARE',bg:'#ad201e',fg:'#ffffff',w:256,h:256});
    const signs=new THREE.InstancedMesh(new THREE.CircleGeometry(.45,8).rotateZ(Math.PI/8),new THREE.MeshStandardMaterial({map,side:THREE.DoubleSide,roughness:.8}),count);
    const posts=new THREE.InstancedMesh(new THREE.CylinderGeometry(.035,.035,2,6),new THREE.MeshStandardMaterial({color:'#686b6d',roughness:.8}),count);
    const dummy=new THREE.Object3D();let index=0;
    for(const node of priority)for(const side of [-1,1]){
      dummy.position.set(side<0?node.x0-.6:node.x1+.6,2,side<0?node.z0-.6:node.z1+.6);
      dummy.rotation.set(0,node.mainAxis===1?side*Math.PI/2:side<0?0:Math.PI,0);dummy.updateMatrix();signs.setMatrixAt(index,dummy.matrix);
      dummy.position.y=1;dummy.rotation.set(0,0,0);dummy.updateMatrix();posts.setMatrixAt(index++,dummy.matrix);
    }
    signs.name='Señales PARE agrupadas';posts.name='Postes PARE agrupados';signs.instanceMatrix.needsUpdate=posts.instanceMatrix.needsUpdate=true;
    this.group.add(signs,posts);this.stopSigns=[signs,posts];
  }

  update(time) {
    this.time = time;
    const states = [signalState(time, 0), signalState(time, 1)];
    if (this._states?.every((state, axis) => state === states[axis])) return;
    this._states = states;
    this.lensStates.value.set(states[0], states[1]);
  }

  blocks(point, direction, current, length = 0, vehicle = null, nodes = this.nodes) {
    const axis = Math.abs(direction.x) >= Math.abs(direction.z) ? 0 : 1;
    for (const node of nodes) {
      const red=intersectionPhase(this,node,axis)!==0;
      const claim = this.reservations.get(node);
      if (vehicle && (claim?.owners.get(vehicle)?.entered||claim?.owners.get(vehicle)?.committed)) continue;
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
    let clearance = Infinity;
    for (const node of this.nodes) {
      const red=intersectionPhase(this,node,1)!==0;
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

    const material = createSignalMaterial(mesh.material, this.lensStates);
    // Copia propia compartida por los lotes: dividir el frustum no multiplica
    // los buffers de vértices ni libera la geometría del banco GLB al retirar la ciudad.
    const sharedGeometry = mesh.geometry.clone();
    const buckets = new Map();
    const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4();
    this.poles.forEach(p => {
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
      const key = `${Math.floor(p.x / STATIC_CHUNK_SIZE)},${Math.floor(p.z / STATIC_CHUNK_SIZE)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ pole: p, matrix: M.clone() });
    });
    this.poleMeshes = [];
    for (const entries of buckets.values()) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(sharedGeometry.attributes)) geometry.setAttribute(name, attribute);
      geometry.setIndex(sharedGeometry.index);
      for (const group of sharedGeometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
      geometry.setDrawRange(sharedGeometry.drawRange.start, sharedGeometry.drawRange.count);
      geometry.setAttribute('trafficAxis', new THREE.InstancedBufferAttribute(new Float32Array(entries.map(entry => entry.pole.axis)), 1));
      const im = new THREE.InstancedMesh(geometry, material, entries.length);
      entries.forEach(({ pole, matrix }, i) => {
        im.setMatrixAt(i, matrix);
        pole.batchIndex = this.poleMeshes.length;
        pole.instanceIndex = i;
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingBox(); im.computeBoundingSphere();
      this.group.add(im);
      this.poleMeshes.push(im);
    }
    // Alias para quien solo consulta el material compartido de las lentes.
    this.poleMesh = this.poleMeshes[0];
  }



  dispose() {
    this.group.removeFromParent();
    for (const mesh of this.poleMeshes ?? []) { mesh.dispose(); mesh.geometry.dispose(); }
    this.poleMesh?.material.dispose();
    for(const mesh of this.stopSigns??[]){mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();mesh.dispose();}
  }
}
