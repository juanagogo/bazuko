import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import {createSlopVehicle} from '../src/vehicles/SlopVehicle.js';
import {BODY_SPECS,buildCarGeometry} from '../src/vehicles/SlopGeometry.js';
import {vehicleBatches,disposeVehicleBatches} from '../src/vehicles/VehicleBatches.js';
import {switchVehicleVisuals} from '../src/vehicles/switchVehicleVisuals.js';
mock.module('../src/world/bogota/textures.js',{namedExports:{...textures,radialSprite:()=>new THREE.Texture()}});
const {Car}=await import('../src/entities/Car.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const fakeVisual=()=>({group:new THREE.Group(),wheels:[],dispose(){this.disposed=(this.disposed??0)+1;this.group.removeFromParent();},setNight(){},updateMotion(){}});
const makeCar=options=>new Car(new THREE.Scene(),new THREE.Vector3(30,.02,25),.7,options);

test('sedán y taxi conservan dimensiones, frente +X, apoyo y retrovisores separados',()=>{
  for(const variant of ['sedan','taxi']) {
    const v=createSlopVehicle({variant}),size=new THREE.Box3().setFromObject(v.group).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x-4.3)<1e-5);assert.ok(Math.abs(size.z-1.76)<1e-5);
    assert.ok(Math.abs(size.y-(variant==='taxi'?1.45:1.75))<1e-5);
    assert.ok(v.group.children[0].localToWorld(new THREE.Vector3(0,0,2)).x>0);
    assert.ok(new THREE.Box3().setFromObject(v.group).min.y<1e-6);
    const parts=v.group.children[0].geometry.attributes.partId.array;
    assert.ok(!parts.includes(5));assert.equal(parts.includes(6),variant==='taxi');
    v.dispose();
  }
});

test('los recursos geométricos se comparten sin liberar el banco al retirar un carro',()=>{
  const a=createSlopVehicle(),b=createSlopVehicle();
  assert.equal(a.group.children[0].geometry,b.group.children[0].geometry);
  assert.notEqual(a.material,b.material);
  assert.equal(a.material.userData.vehicleState.labels.value,b.material.userData.vehicleState.labels.value);
  let geometryDisposes=0,materialDisposes=0;
  b.group.children[0].geometry.addEventListener('dispose',()=>geometryDisposes++);
  a.material.addEventListener('dispose',()=>materialDisposes++);
  a.dispose();a.dispose();assert.equal(materialDisposes,1);assert.equal(geometryDisposes,0);
  assert.equal(b.group.children.length,1);b.dispose();
});

test('las ruedas, luces nocturnas y frenado tienen estado independiente sin luces adicionales',()=>{
  const a=createSlopVehicle(),b=createSlopVehicle();a.updateMotion(4,true);a.setNight(true);
  const state=a.material.userData.vehicleState,other=b.material.userData.vehicleState;
  assert.notEqual(state.wheelAngle.value,0);assert.equal(state.braking.value,1);assert.equal(state.night.value,1);
  assert.equal(other.wheelAngle.value,0);assert.equal(other.braking.value,0);assert.equal(other.night.value,0);
  let lights=0;a.group.traverse(o=>{if(o.isLight)lights++;});assert.equal(lights,0);
  // El material actual del donante no deforma posiciones: las ruedas son mallas propias.
  assert.equal(a.material.isMeshStandardNodeMaterial,true);assert.ok(a.material.colorNode);assert.ok(a.material.emissiveNode);
  assert.equal(a.material.userData.carState.value.x,1);
  a.dispose();b.dispose();
});

test('cambiar representación no recrea la entidad ni reinicia robo, posición o enfriamiento',async()=>{
  const car=makeCar({visualFactory:async()=>fakeVisual()});const group=car.group,position=car.position.clone();
  await car.preloadModel();assert.equal(car.visualMode,'slop');
  car.steal(0);const cooldown=car.cooldown;car.animateDrive(5,true);assert.equal(car._braking,true);
  await car.setVisualMode('actual');assert.equal(car.group,group);assert.ok(car.position.equals(position));assert.equal(car.group.rotation.y,.7);
  assert.equal(car.cooldown,cooldown);assert.equal(car.used,true);assert.ok(car.mirrors.every(m=>!m.visible));
  await car.setVisualMode('slop');car.update(cooldown+1);assert.ok(car.mirrors.every(m=>m.visible));car.dispose();
});

test('si falla un modelo se conserva toda la representación anterior del grupo',async()=>{
  const prepared=fakeVisual();
  const a=makeCar({visualFactory:async()=>prepared}),b=makeCar({visualFactory:async()=>{throw new Error('fallo controlado');}});
  const before=[a.vehicle,b.vehicle];
  await assert.rejects(switchVehicleVisuals([a,b],'slop'),/fallo controlado/);
  assert.equal(a.vehicle,before[0]);assert.equal(b.vehicle,before[1]);assert.equal(prepared.disposed,1);
  a.dispose();b.dispose();
});

test('una carga atrasada no reemplaza otra elección y se libera si el carro se destruye',async()=>{
  const slow=deferred(),late=fakeVisual(),fast=fakeVisual();
  const car=makeCar({visualFactory:mode=>mode==='slop'?slow.promise:Promise.resolve(fast)});
  const pending=car.setVisualMode('slop');await car.setVisualMode('actual');slow.resolve(late);await pending;
  assert.equal(car.vehicle,fast);assert.equal(late.disposed,1);car.dispose();
  const loading=deferred(),orphan=fakeVisual(),removed=makeCar({visualFactory:()=>loading.promise});
  const next=removed.setVisualMode('slop');removed.dispose();loading.resolve(orphan);await next;
  assert.equal(orphan.disposed,1);assert.equal(removed.group.parent,null);
});

test('el tráfico mantiene ruta, velocidad y colisiones al cargar las carrocerías nuevas',async()=>{
  const {TrafficSystem}=await import('../src/systems/TrafficSystem.js');
  const {TrafficRoute}=await import('../src/world/bogota/TrafficRoute.js');
  const traffic=new TrafficSystem(new THREE.Scene(),[new TrafficRoute(0,30,0,30)],{carsPerRoute:2,random:()=>.4});
  const states=traffic.vehicles.map(v=>({v,car:v.car,route:v.route,speed:v.speed,distance:v.distance,position:v.car.position.clone(),length:v.car.length,width:v.car.width}));
  await switchVehicleVisuals(states.map(s=>s.car),'slop');
  for(const s of states){assert.equal(s.v.car,s.car);assert.equal(s.v.route,s.route);assert.equal(s.v.speed,s.speed);assert.equal(s.v.distance,s.distance);assert.ok(s.car.position.equals(s.position));assert.equal(s.car.length,s.length);assert.equal(s.car.width,s.width);}
  for(let i=0;i<120;i++)traffic.update(1/60);
  assert.ok(states.some(s=>!s.car.position.equals(s.position)));
  assert.ok(states.some(s=>s.car.vehicle.material.userData.vehicleState.wheelAngle.value!==0));
  traffic.dispose();
});

test('los aros de robo de los estacionados se dibujan en un lote que sigue robo, enfriamiento y conducción',()=>{
 const scene=new THREE.Scene(),cars=[new Car(scene,new THREE.Vector3(5,0,5)),new Car(scene,new THREE.Vector3(12,0,5))],traffic=new Car(scene,new THREE.Vector3(20,0,5),0,{traffic:true});
 const bank=vehicleBatches(scene),camera=new THREE.PerspectiveCamera();
 assert.ok(cars.every(car=>car.marker.visible&&car.marker.layers.mask===0),'el aro sigue visible como estado, pero ninguna cámara lo dibuja suelto');
 assert.equal(traffic.marker.layers.mask,1,'el tráfico no registra aro');
 bank.sync(camera);assert.equal(bank.markerMesh.count,2);
 const matrix=new THREE.Matrix4();bank.markerMesh.getMatrixAt(1,matrix);assert.equal(matrix.elements[12],12);
 cars[0].steal(0);bank.sync(camera);assert.equal(bank.markerMesh.count,1,'robado: sin aro');
 cars[0].update(1e3);bank.sync(camera);assert.equal(bank.markerMesh.count,2,'tras el enfriamiento vuelve');
 cars[1].setControlled?.(true);bank.sync(camera);assert.equal(bank.markerMesh.count,1,'conduciendo: sin aro');
 const marker=cars[0].marker;cars[0].dispose();assert.equal(marker.layers.mask,1);assert.equal(bank.markers.size,1);
 for(const car of [cars[1],traffic])car.dispose();disposeVehicleBatches(scene);
});
