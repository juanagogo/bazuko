import {getDrivingAssets} from './DrivingVisual.js';
import * as THREE from 'three/webgpu';
import {BODY_SPECS,buildCarProxyGeometry} from './SlopGeometry.js';
import {createSlopMaterial,createVehicleWheelMaterial,vehicleStyle} from './SlopMaterial.js';
const banks=new WeakMap(),zero=new THREE.Matrix4().makeScale(0,0,0);
const CAPACITY=256;
export class VehicleBatches {
  constructor(scene){this.scene=scene;this.entries=new Set();this.types=new Map();this.root=new THREE.Group();this.root.name='Vehículos agrupados WebGPU';this.root.userData.noMerge=true;scene.add(this.root);this.position=new THREE.Vector3();this._disposed=false;}
  type(variant,geometry){
    if(this.types.has(variant))return this.types.get(variant);
    const material=createSlopMaterial(BODY_SPECS[variant],null);
    const make=geo=>{
      const mesh=new THREE.InstancedMesh(geo,material,CAPACITY);mesh.name=`${variant} · instancias`;mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;mesh.instanceMatrix=new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array,16);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for(const [name,size] of [['paintColor',3],['carState',4],['wheelAngle',1],['carNight',1]])geo.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY*size),size).setUsage(THREE.DynamicDrawUsage));
      this.root.add(mesh);return mesh;
    };
    const assets=getDrivingAssets(variant),wheelMaterials=[createVehicleWheelMaterial(BODY_SPECS[variant])];
    const wheels=[];
    for(const [sideIndex,side] of [-1,1].entries())for(let part=0;part<1;part++){
      const mesh=new THREE.InstancedMesh(assets.wheels[sideIndex][part].clone(),wheelMaterials[part],CAPACITY*2);mesh.count=0;mesh.name='Ruedas orientables de tráfico';mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
      mesh.instanceMatrix=new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array,16);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.root.add(mesh);wheels.push({side,mesh});
    }
    const type={near:make(assets.body.clone()),far:make(buildCarProxyGeometry(BODY_SPECS[variant])),material,wheels,wheelMaterials,spec:BODY_SPECS[variant]};this.types.set(variant,type);return type;
  }
  add(visual,mesh,variant){
    if(this.entries.size>=CAPACITY)throw new Error('Se alcanzó el banco de vehículos');
    const type=this.type(variant,mesh.geometry),entry={visual,mesh,type};this.entries.add(entry);mesh.visible=false;
    return ()=>{this.entries.delete(entry);};
  }
  // Aro de robo de cada estacionado: su `visible` sigue siendo el estado del juego (robo,
  // enfriamiento, conducción); ninguna cámara lo dibuja suelto, el banco lo dibuja en un lote.
  addMarker(marker){
    (this.markers??=new Set()).add(marker);marker.layers.disableAll();
    return ()=>{this.markers?.delete(marker);marker.layers.enable(0);};
  }
  ensureMarkers(source){
    if(this.markerMesh)return this.markerMesh;
    const mesh=new THREE.InstancedMesh(source.geometry.clone(),source.material.clone(),CAPACITY);mesh.count=0;mesh.name='Marcas de robo agrupadas';mesh.frustumCulled=false;mesh.renderOrder=source.renderOrder;
    mesh.instanceMatrix=new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array,16);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.root.add(mesh);return this.markerMesh=mesh;
  }
  ensureMirrors(visual){
    const source=visual.mirrorGroups?.[0];if(!source||this.mirrors)return;
    this.mirrors=source.children.filter(m=>m.isMesh).map(source=>{
      const mesh=new THREE.InstancedMesh(source.geometry.clone(),source.material.clone(),CAPACITY*2);mesh.count=0;mesh.name='Retrovisores robables agrupados';mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;mesh.instanceMatrix=new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array,16);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.root.add(mesh);return mesh;
    });
  }
  sync(camera){
    const skip=this.scene.userData.skipEmptyBatches===true;
    for(const type of this.types.values()){type.near.count=0;type.far.count=0;for(const wheel of type.wheels)wheel.mesh.count=0;}
    camera?.getWorldPosition(this.position);this._p??=new THREE.Vector3();
    for(const mesh of this.mirrors??[])mesh.count=0;
    for(const {visual,mesh,type} of this.entries){
      if(!visual.group.parent||visual.suspended)continue;let visible=true;for(let p=visual.group;p;p=p.parent)if(!p.visible){visible=false;break;}if(!visible)continue;
      mesh.updateWorldMatrix(true,false);const distance=this.position.distanceToSquared(mesh.getWorldPosition(this._p??=new THREE.Vector3()));if(camera&&distance>280*280)continue;
      const target=camera&&distance>85*85?type.far:type.near,i=target.count++,state=visual.material.userData.vehicleState;
      this.ensureMirrors(visual);
      if(distance<70*70)for(const mirror of visual.mirrorGroups??[])if(mirror.visible){mirror.children.filter(m=>m.isMesh).forEach((source,j)=>{const batch=this.mirrors[j];source.updateWorldMatrix(true,false);batch.setMatrixAt(batch.count++,source.matrixWorld);});}
      target.setMatrixAt(i,mesh.matrixWorld);
      if(target===type.near){
        this._wheelRoot??=new THREE.Matrix4();this._wheelMatrix??=new THREE.Matrix4();this._wheelDummy??=new THREE.Object3D();this._spin??=new THREE.Quaternion();this._spinAxis??=new THREE.Vector3(1,0,0);
        visual.group.updateWorldMatrix(true,false);this._wheelRotation??=new THREE.Matrix4().makeRotationY(Math.PI/2);this._wheelRoot.copy(visual.group.matrixWorld).multiply(this._wheelRotation);
        for(const wheel of type.wheels)for(const z of [-type.spec.wheelZ,type.spec.wheelZ]){
          const dummy=this._wheelDummy;dummy.position.set(wheel.side*type.spec.wheelX,type.spec.wheelRadius,z);dummy.rotation.set(0,z>0?(visual.steerAngle??0):0,0);dummy.quaternion.multiply(this._spin.setFromAxisAngle(this._spinAxis,state.wheelAngle.value));dummy.updateMatrix();
          this._wheelMatrix.multiplyMatrices(this._wheelRoot,dummy.matrix);wheel.mesh.setMatrixAt(wheel.mesh.count++,this._wheelMatrix);
        }
      }
      const g=target.geometry.attributes,c=state.paint.value;
      g.paintColor.setXYZ(i,c.r,c.g,c.b);g.carState.setXYZW(i,state.braking.value,visual.turnSignal>0?1:0,visual.turnSignal<0?1:0,vehicleStyle(visual.variant,visual.seed));g.wheelAngle.setX(i,state.wheelAngle.value);g.carNight.setX(i,state.night.value);
    }
    if(this.markers?.size){
      const batch=this.ensureMarkers(this.markers.values().next().value);batch.count=0;
      for(const marker of this.markers){
        let visible=!!marker.parent;for(let p=marker;p&&visible;p=p.parent)visible=p.visible;if(!visible)continue;
        marker.updateWorldMatrix(true,false);if(camera&&this.position.distanceToSquared(this._p.setFromMatrixPosition(marker.matrixWorld))>280*280)continue;
        batch.setMatrixAt(batch.count++,marker.matrixWorld);
      }
      batch.instanceMatrix.needsUpdate=true;batch.visible=!skip||batch.count>0;
    }
    for(const mesh of this.mirrors??[]){mesh.visible=!skip||mesh.count>0;mesh.instanceMatrix.needsUpdate=true;}
    // Un lote sin instancias no se dibuja: antes costaba un dibujo vacío por vista y cascada de sombra.
    for(const type of this.types.values())for(const mesh of [type.near,type.far]){for(const wheel of type.wheels){wheel.mesh.visible=!skip||wheel.mesh.count>0;wheel.mesh.instanceMatrix.needsUpdate=true;}mesh.visible=!skip||mesh.count>0;mesh.instanceMatrix.needsUpdate=true;for(const key of ['paintColor','carState','wheelAngle','carNight'])mesh.geometry.attributes[key].needsUpdate=true;}
  }
  dispose(){if(this._disposed)return;this._disposed=true;this.root.removeFromParent();for(const type of this.types.values()){type.near.dispose();type.far.dispose();type.near.geometry.dispose();type.far.geometry.dispose();type.material.dispose();for(const wheel of type.wheels){wheel.mesh.dispose();wheel.mesh.geometry.dispose();}for(const m of type.wheelMaterials)m.dispose();}for(const mesh of [...(this.mirrors??[]),this.markerMesh].filter(Boolean)){mesh.dispose();mesh.geometry.dispose();mesh.material.dispose();}for(const marker of this.markers??[])marker.layers.enable(0);this.markers?.clear();this.types.clear();this.entries.clear();banks.delete(this.scene);}
}
export function vehicleBatches(scene){let bank=banks.get(scene);if(!bank){bank=new VehicleBatches(scene);banks.set(scene,bank);}return bank;}
export function syncVehicleBatches(scene,camera){banks.get(scene)?.sync(camera);}
export function disposeVehicleBatches(scene){banks.get(scene)?.dispose();}
