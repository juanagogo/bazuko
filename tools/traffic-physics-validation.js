// Reproducible, bounded visual QA; no saved-game or graphics-preference writes.
import * as THREE from 'three/webgpu';
import {createWebGPURenderer,initializeWebGPU} from '/src/core/WebGPU.js';
import {TrafficSystem} from '/src/systems/TrafficSystem.js';
import {TrafficRoute} from '/src/world/bogota/TrafficRoute.js';
import {Car} from '/src/entities/Car.js';
import {PlayerDriving} from '/src/vehicles/PlayerDriving.js';
import {initializeMotion,MOTION_FIELDS} from '/src/vehicles/SlopCollisionPhysics.js';
import {syncVehicleBatches} from '/src/vehicles/VehicleBatches.js';
const status=document.querySelector('#status'),buttons=document.querySelector('#buttons');
try{
 const renderer=createWebGPURenderer({canvas:document.querySelector('canvas'),antialias:true});await initializeWebGPU(renderer);renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#829bb1');scene.add(new THREE.HemisphereLight('#c8e6ff','#756151',2));const sun=new THREE.DirectionalLight('#fff0d9',3);sun.position.set(10,25,20);scene.add(sun);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(400,400),new THREE.MeshStandardNodeMaterial({color:'#343c43',roughness:.9}));ground.rotation.x=-Math.PI/2;ground.position.y=-.02;scene.add(ground);
 const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,400);camera.position.set(27,20,25);camera.lookAt(17,0,0);
 const traffic=new TrafficSystem(scene,[new TrafficRoute(0,100,0,80,8)],{carsPerRoute:2,random:()=>.5});
 const manual=new Car(scene,new THREE.Vector3(16,0,4),Math.PI/2);traffic.setParkedCars([manual]);await Promise.all([manual,...traffic.vehicles.map(v=>v.car)].map(c=>c.preloadModel()));
 const player={position:manual.position.clone().add(new THREE.Vector3(0,0,1.5)),root:new THREE.Group(),velocity:new THREE.Vector3()},collisions={queryStatic:()=>[],dynamicColliders:[]};
 const driver=new PlayerDriving({player,cars:()=>[manual],collisions,district:()=>({getMovementGroundHeight:()=>0}),contacts:(car,owner)=>traffic.collideDrivenCar(car,owner)});driver.enter(manual);
 const input={isDown:()=>false,consumePress:()=>false,isRunning:false};let running=false,elapsed=0,events=[],peak=0,maxYaw=0,result=null;
 function reset(kind){
  running=false;events=[];peak=maxYaw=elapsed=0;result=null;
  for(const v of traffic.vehicles){for(const f of MOTION_FIELDS)v[f]=0;v.speed=0;v.stopped=false;v.impactStop=false;v.waitAge=0;v.distance=kind==='carambola'?8+traffic.vehicles.indexOf(v)*6:8+traffic.vehicles.indexOf(v)*40;v.route.sample(v.distance,v.car.position,new THREE.Vector3());v.car.group.rotation.set(0,0,0);}
  for(const f of MOTION_FIELDS)driver[f]=0;
  const v=traffic.vehicles[0];
  if(kind==='lateral'){manual.position.copy(v.car.position).add(new THREE.Vector3(.7,0,6));manual.group.rotation.y=Math.PI/2;}
  else if(kind==='carambola'){manual.position.copy(v.car.position).add(new THREE.Vector3(-7,0,.5));manual.group.rotation.y=0;}
  else{manual.position.copy(v.car.position).add(new THREE.Vector3(7,0,.5));manual.group.rotation.y=Math.PI;}
  driver.speed=12;traffic.update(.001,{driving:driver});running=true;
 }
 function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=fn;buttons.append(b);}
 button('Choque frontal',()=>reset('frontal'));button('Choque lateral',()=>reset('lateral'));button('Carambola',()=>reset('carambola'));button('Pausa',()=>running=!running);
 syncVehicleBatches(scene,camera);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
 let last=performance.now();
 renderer.setAnimationLoop(now=>{
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(running){driver.update(dt,input);traffic.update(dt,{driving:driver,collisions,onCollision:e=>{events.push({speed:+e.speed.toFixed(2),kind:e.kind});}});elapsed+=dt;
   for(const v of traffic.vehicles){peak=Math.max(peak,Math.hypot(v.vx,v.vz));maxYaw=Math.max(maxYaw,Math.abs(v.yawOffset));}
   if(elapsed>4){running=false;result={impactos:events.length,velocidadImpacto:events[0]?.speed,impulsoMaximo:+peak.toFixed(3),giroMaximo:+maxYaw.toFixed(3),finito:traffic.vehicles.every(v=>Number.isFinite(v.car.position.x))};}
  }
  syncVehicleBatches(scene,camera);renderer.render(scene,camera);status.textContent=JSON.stringify({backend:'WebGPU',tiempo:+elapsed.toFixed(2),impactos:events.length,resultado:result,trafico:traffic.vehicles.map(v=>({x:+v.car.position.x.toFixed(2),z:+v.car.position.z.toFixed(2),velocidad:+v.speed.toFixed(2),deriva:+(v.dl??0).toFixed(2)}))},null,2);
 });
}catch(error){status.textContent=error.stack;console.error(error);}
