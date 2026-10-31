// Separate steerable wheels/chassis adapted from Slop New York controllers.js (MIT).
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BODY_SPECS,buildCarGeometry,buildWheelParts} from './SlopGeometry.js';
import {createSlopMaterial,createVehicleWheelMaterial,vehicleStyle} from './SlopMaterial.js';
const bank=new Map();
export function getDrivingAssets(variant){
 if(!bank.has(variant)){
  const spec=BODY_SPECS[variant],body=buildCarGeometry(spec,false,false),wheels=[-1,1].map(side=>{
   return buildWheelParts(spec,side);
  });const full=buildCarGeometry(spec,true,false);full.computeBoundingBox();const size=full.boundingBox.getSize(new THREE.Vector3());full.dispose();bank.set(variant,{body,wheels,size});
 }return bank.get(variant);
}
export function createDrivingVisual(car){
 const variant=car.variant??(car.modelKind==='car2'?'taxi':'sedan'),spec=BODY_SPECS[variant],a=getDrivingAssets(variant),material=createSlopMaterial(spec,variant==='taxi'?'#edbd18':car.vehicle.material?.userData.vehicleState.paint.value??'#b6bdc4');
 const group=new THREE.Group(),oriented=new THREE.Group(),chassis=new THREE.Group(),wheels=[];
 const size=a.size;group.name='Carro ocupado';group.scale.set(car.length/size.z,(car.height??(variant==='taxi'?1.45:1.75))/size.y,car.width/size.x);oriented.rotation.y=Math.PI/2;group.add(oriented);oriented.add(chassis);chassis.add(new THREE.Mesh(a.body,material));
 material.userData.vehicleState.style.value=vehicleStyle(variant,car.visualSeed);
 const wheelMaterial=createVehicleWheelMaterial(spec);if(wheelMaterial.userData.vehicleState?.style)wheelMaterial.userData.vehicleState.style.value=vehicleStyle(variant,car.visualSeed);
 for(const [i,side] of [-1,1].entries())for(const z of [-spec.wheelZ,spec.wheelZ]){
  const pivot=new THREE.Group(),spin=new THREE.Group();pivot.position.set(side*spec.wheelX,spec.wheelRadius,z);pivot.add(spin);spin.add(new THREE.Mesh(a.wheels[i][0],wheelMaterial));oriented.add(pivot);wheels.push({pivot,spin,front:z>0});
 }
 group.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});group.visible=false;
 let angle=0;
 return {group,material,headlightFrame:chassis,headlightSpec:spec,update(pitch,roll,steer,distance,heave=0){chassis.position.y=heave;chassis.rotation.x=pitch;chassis.rotation.z=roll;angle=(angle+distance/spec.wheelRadius)%(Math.PI*2);for(const wheel of wheels){wheel.pivot.rotation.y=wheel.front?steer:0;wheel.spin.rotation.x=angle;}car.syncHeadlights?.();},dispose(){group.removeFromParent();material.dispose();wheelMaterial.dispose();}};
}
