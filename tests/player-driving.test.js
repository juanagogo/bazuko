import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PlayerDriving} from '../src/vehicles/PlayerDriving.js';
import {vehicleIntersects} from '../src/vehicles/DrivingCollision.js';
import {CollisionSystem} from '../src/systems/CollisionSystem.js';
import {VEHICLE_TYPES} from '../src/vehicles/VehicleTypes.js';
function fixture(){
 const player={position:new THREE.Vector3(0,0,1.9),root:new THREE.Group(),velocity:new THREE.Vector3(),speed:0};
 const car={position:new THREE.Vector3(),group:new THREE.Group(),length:4.3,width:1.76,controller:'parked',traffic:false,drivingVisual:{update(){}},setControlled(v){this.controlled=v;},setSteering(){},animateDrive(){}};
 const walls=[],collisions={queryStatic:()=>walls,dynamicColliders:[]},district={getMovementGroundHeight:(x,z,y)=>y},messages=[];
 const driving=new PlayerDriving({player,cars:()=>[car],collisions,district:()=>district,notify:t=>messages.push(t)});
 const input=(...keys)=>({isDown:k=>keys.includes(k),consumePress:()=>false,isRunning:false});
 return {player,car,walls,collisions,district,driving,input,messages};
}
test('F solo ocupa estacionados cercanos y salir conserva un unico controlador',()=>{
 const f=fixture();f.car.traffic=true;assert.equal(f.driving.enter(f.car),false);f.car.traffic=false;
 f.player.position.set(0,0,f.car.width/2+2.51);assert.equal(f.driving.enter(),false);f.player.position.z=1.9;
 assert.equal(f.driving.enter(),true);assert.equal(f.car.controller,'player');assert.equal(f.player.root.visible,false);assert.equal(f.driving.enter(),false);
 f.driving.speed=1;assert.equal(f.driving.exit(),false);f.driving.speed=0;assert.equal(f.driving.exit(),true);assert.equal(f.car.controller,'parked');assert.equal(f.player.root.visible,true);
});

test('Prado estacionada permite acercarse y entrar con F desde ambos lados y en cualquier giro',()=>{
 for(const yaw of [0,.3,Math.PI/4,Math.PI/2,2.4])for(const side of [-1,1]){
  const f=fixture();Object.assign(f.car,VEHICLE_TYPES.prado);f.car.group.rotation.y=yaw;
  const collisions=new CollisionSystem();collisions.setVehicles([f.car]);f.driving.collisions=collisions;
  const lateral=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)).multiplyScalar(side);
  const start=lateral.clone().multiplyScalar(f.car.width/2+1.5);
  f.player.position.copy(collisions.resolveMove(start,lateral.clone().multiplyScalar(-1)));
  assert.ok(f.player.position.distanceTo(lateral.clone().multiplyScalar(f.car.width/2+.5))<1e-6);
  assert.equal(f.driving.nearest(),f.car);assert.equal(f.driving.enter(),true);
  assert.equal(f.driving.exit(),true);assert.equal(f.car.controller,'parked');
 }
});

test('Prado: la entrada usa el borde y rechaza carros lejanos, en otro nivel o eliminados',()=>{
 const f=fixture();Object.assign(f.car,VEHICLE_TYPES.prado);
 f.player.position.set(f.car.length/2+.5,0,0);assert.equal(f.driving.nearest(),f.car);
 assert.equal(f.driving.enter(),true);f.driving.cancel();
 f.player.position.x=f.car.length/2+2.51;assert.equal(f.driving.enter(f.car),false);
 f.player.position.set(0,7.82,0);assert.equal(f.driving.nearest(),null);
 f.player.position.set(0,0,1.9);f.car._disposed=true;assert.equal(f.driving.enter(f.car),false);
});

test('Prado girada deja libres las esquinas de su AABB y bloquea el volumen real',()=>{
 const f=fixture();Object.assign(f.car,VEHICLE_TYPES.prado);f.car.group.rotation.y=Math.PI/4;
 const collisions=new CollisionSystem();collisions.setVehicles([f.car]);const entry=collisions.dynamicColliders[0];
 assert.deepEqual(entry.obb.halfSize.toArray(),[f.car.length/2,f.car.height/2,f.car.width/2]);
 const corner=new THREE.Vector3(2.5,0,2.5);assert.ok(entry.box.containsPoint(corner));
 assert.deepEqual(collisions.resolveMove(corner,new THREE.Vector3()),corner);
 const side=new THREE.Vector3(Math.SQRT1_2,0,Math.SQRT1_2);
 const stopped=collisions.resolveMove(new THREE.Vector3(5,0,0),new THREE.Vector3(-10,0,0));
 assert.ok(stopped.dot(side)>=f.car.width/2+.4-1e-5);
});
test('la conduccion avanza sobre +X, frena antes de retroceder y gira sin cambiar el collider',()=>{
 const f=fixture();f.driving.enter();for(let i=0;i<10;i++)f.driving.update(.1,f.input('KeyW'));
 assert.ok(f.car.position.x>1&&f.car.position.x<3);assert.ok(f.driving.speed>0);assert.equal(f.player.position.x,f.car.position.x);
 f.driving.update(.1,f.input('KeyS'));assert.ok(f.driving.speed>0);
 const x=f.car.position.x;for(let i=0;i<20;i++)f.driving.update(.1,f.input('KeyW','KeyA'));assert.notEqual(f.car.group.rotation.y,0);assert.ok(f.car.position.x>x);assert.equal(f.car.length,4.3);
});
test('subpasos impiden atravesar muros y respeta la altura del puente',()=>{
 const f=fixture();f.walls.push({box:new THREE.Box3(new THREE.Vector3(5,-1,-10),new THREE.Vector3(6,5,10))});f.driving.enter();f.driving.speed=36;f.driving.update(1,f.input('KeyW'));assert.ok(f.car.position.x<3);assert.ok(f.driving.speed<0);
 f.car.position.set(0,7.82,0);f.driving.speed=10;f.driving.update(.1,f.input('KeyW'));assert.ok(f.car.position.x>0);assert.equal(f.car.position.y,7.82);
});
test('no permite salir entre paredes y cancelar restaura el jugador sin guardar',()=>{
 const f=fixture();f.driving.enter();f.walls.push({box:new THREE.Box3(new THREE.Vector3(-20,-1,-20),new THREE.Vector3(20,5,20))});assert.equal(f.driving.exit(),false);assert.ok(f.driving.car);f.driving.cancel();assert.equal(f.player.root.visible,true);assert.equal(f.car.controller,'parked');assert.equal(f.driving.car,null);
});
test('OBB conserva dimensiones durante el giro y separa niveles y el propio vehiculo',()=>{
 const car={length:4,width:1.8},p=new THREE.Vector3(),entry={box:new THREE.Box3(new THREE.Vector3(1,-1,1),new THREE.Vector3(2,3,2))};
 assert.equal(vehicleIntersects(car,p,0,entry),false);assert.equal(vehicleIntersects(car,p,-Math.PI/4,entry),true);p.y=7.82;assert.equal(vehicleIntersects(car,p,0,entry),false);p.y=0;entry.vehicle=car;assert.equal(vehicleIntersects(car,p,0,entry),false);
});
