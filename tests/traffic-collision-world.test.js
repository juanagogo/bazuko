import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
mock.module('../src/world/bogota/textures.js',{namedExports:{...textures,radialSprite:()=>new THREE.Texture()}});
const {TrafficSystem}=await import('../src/systems/TrafficSystem.js');
const {TrafficRoute}=await import('../src/world/bogota/TrafficRoute.js');
const {Car}=await import('../src/entities/Car.js');
const {PlayerDriving}=await import('../src/vehicles/PlayerDriving.js');
const {BusService}=await import('../src/world/bogota/BusService.js');
const {LocalLights}=await import('../src/core/LocalLights.js');
test('golpear un conductor desplaza su cuerpo y recupera el carril de forma continua',()=>{
 const scene=new THREE.Scene(),route=new TrafficRoute(0,240,0,240,3.2),traffic=new TrafficSystem(scene,[route],{carsPerRoute:1,random:()=>.5}),v=traffic.vehicles[0];
 v.distance=11.8;v.speed=0;const d=new THREE.Vector3();route.sample(v.distance,v.car.position,d);v.car.group.rotation.y=0;traffic.update(.01);
 const car=new Car(scene,new THREE.Vector3(16,0,3.5),Math.PI/2);car.prepareDrivingVisual();traffic.setParkedCars([car]);
 const player={position:new THREE.Vector3(16,0,5.4),root:new THREE.Group(),velocity:new THREE.Vector3()},collisions={queryStatic:()=>[],dynamicColliders:[]};
 const driver=new PlayerDriving({player,cars:()=>[car],collisions,district:()=>({getMovementGroundHeight:(x,z,y)=>y}),contacts:(car,owner)=>traffic.collideDrivenCar(car,owner)});
 assert.equal(driver.enter(car),true);driver.speed=12;driver.update(.1,{isDown:()=>false,consumePress:()=>false,isRunning:false});
 assert.ok(Math.hypot(v.vx,v.vz)>0);assert.ok(Math.abs(v.yawVel)>0||Math.abs(v.rollVel)>0);assert.ok(traffic.physics.sparks.items.some(p=>p.life>0));
 driver.cancel();car.position.set(16,0,40);for(let i=0;i<600;i++)traffic.update(.02);
 assert.ok(Math.abs(v.dl)<.1);assert.ok(Math.abs(v.yawOffset)<.01);assert.ok(Number.isFinite(v.car.position.x));
 traffic.dispose();car.dispose();
});
test('choques en el viaducto no transmiten impulsos a los carros de abajo',()=>{
 const scene=new THREE.Scene(),traffic=new TrafficSystem(scene,[new TrafficRoute(0,240,0,240,3.2)],{carsPerRoute:1,random:()=>.5}),v=traffic.vehicles[0];traffic.update(.01);
 const car=new Car(scene,v.car.position.clone().setY(7.82));traffic.setParkedCars([car]);const body=traffic.physics.body(car,{speed:0,vx:8});traffic.physics.step(traffic.vehicles,traffic.parkedCars,[],null,.01,null);
 assert.equal(v.vx,0);assert.equal(v.vz,0);assert.ok(body.vx>0);traffic.dispose();car.dispose();
});

test('el impulso del bus se amortigua sin acumular deriva fuera del carril',()=>{
 const scene=new THREE.Scene(),traffic=new TrafficSystem(scene,[],{carsPerRoute:0});
 const bus=new BusService({x:8,startZ:0,endZ:200});scene.add(bus.group);traffic.setBus(bus);
 traffic.physics.body(bus,bus,{bus:true});bus.vx=3;
 for(let i=0;i<200;i++){traffic.physics.step([],[],traffic.busVehicles,null,.02,null);bus.update(.02);assert.ok(Math.abs(bus.position.x-bus.laneX)<=.451);}
 assert.ok(Math.abs(bus.vx)<.001);assert.ok(Math.abs(bus.position.x-bus.laneX)<.01);
 traffic.dispose();bus.dispose();
});

test('los faros siguen al carro al trasladarse y girar tras registrar la ciudad como estatica',()=>{
 const scene=new THREE.Scene(),car=new Car(scene,new THREE.Vector3(2,0,3)),lights=new LocalLights(scene);
 lights.setQuality('baja');car.setNight(true);lights.refreshSources({static:true});
 const verify=()=>{
  lights.update(.016,car.position);
  for(const source of car.headlights){
   assert.equal(lights.sources.get(source).fixed,false);
   const p=source.getWorldPosition(new THREE.Vector3()),target=source.target.getWorldPosition(new THREE.Vector3());
   const proxy=lights.spotPool.find(light=>light.intensity>0&&light.position.distanceTo(p)<1e-8);
   assert.ok(proxy,'el haz nace en el faro del carro');assert.ok(proxy.target.position.distanceTo(target)<1e-8,'el haz apunta con el carro');
  }
 };
 verify();car.position.set(18,7.82,22);car.group.rotation.y=1.4;verify();
 lights.refreshSources({static:true});car.position.set(24,0,9);car.group.rotation.y=-.8;verify();
 car.setNight(false);lights.update(.016,car.position);assert.ok(lights.spotPool.every(light=>light.intensity===0));
 lights.dispose();car.dispose();
});

test('el haz sale de las lentes del sedan y taxi, tambien con suspension y al conducir',async()=>{
 for(const kind of ['car1','car2']){
  // Con variante explícita: sin ella un carro estacionado puede salir criollo, que conserva su carrocería propia.
  const scene=new THREE.Scene(),car=new Car(scene,new THREE.Vector3(18,7.82,22),0,{variant:kind==='car2'?'taxi':'sedan'});
  await car.preloadModel();car.group.rotation.y=1.2;
  const verify=visual=>{
   const frame=visual.headlightFrame,spec=visual.headlightSpec;frame.updateWorldMatrix(true,false);
   for(const [i,light] of car.headlights.entries()){
    const side=i===0?-1:1;
    const lens=frame.localToWorld(new THREE.Vector3(side*spec.headlight[0],spec.headlight[1],spec.zFront+.02));
    const aim=frame.localToWorld(new THREE.Vector3(side*spec.headlight[0],spec.headlight[1]-.8,spec.zFront+12));
    assert.ok(light.getWorldPosition(new THREE.Vector3()).distanceTo(lens)<1e-8);
    assert.ok(light.target.getWorldPosition(new THREE.Vector3()).distanceTo(aim)<1e-8);
   }
  };
  car.setPose(.12,-.09,.03);verify(car.vehicle);
  car.controller='player';car.setControlled(true);car.drivingVisual.update(-.1,.08,.3,1,.06);verify(car.drivingVisual);
  const lights=new LocalLights(scene);lights.setQuality('baja');car.setNight(true);lights.update(.016,car.position);assert.equal(lights.halos.mesh.count,0);
  const lamp=new THREE.PointLight('white',5,8);lamp.position.copy(car.position);scene.add(lamp);lights.update(.016,car.position);assert.equal(lights.halos.mesh.count,1);
  lights.dispose();car.dispose();
 }
});
