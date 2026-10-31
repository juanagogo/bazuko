// Driving equations adapted from Slop New York 1b54e165/controllers.js (MIT).
import * as THREE from 'three';
import {driveSpeed,CAR_DRIVE} from './SlopDynamics.js';
import {vehicleBlocked,resolveVehicleWalls} from './DrivingCollision.js';
import {initializeMotion,MOTION_FIELDS} from './SlopCollisionPhysics.js';
/** Distance to the oriented body, not its center; large parked vehicles remain reachable. */
export function vehicleEntryDistance(position,car){
 const dx=position.x-car.position.x,dz=position.z-car.position.z,yaw=car.group.rotation.y;
 const along=dx*Math.cos(yaw)-dz*Math.sin(yaw),side=dx*Math.sin(yaw)+dz*Math.cos(yaw);
 return Math.hypot(Math.max(0,Math.abs(along)-car.length/2),Math.max(0,Math.abs(side)-car.width/2),position.y-car.position.y);
}
export class PlayerDriving {
 constructor({player,cars,collisions,district,audio,contacts=()=>{},onCollision=()=>{},notify=()=>{}}){Object.assign(this,{player,cars,collisions,district,audio,contacts,onCollision,notify});this.car=null;this.speed=0;this.steer=0;this.pitch=this.roll=this.pitchVel=this.rollVel=0;this.candidate=new THREE.Vector3();this.lastHorn=-Infinity;}
 nearest(){let best=null,d=2.5;for(const car of this.cars()){if(car.controller!=='parked'||car.traffic||car._disposed)continue;const distance=vehicleEntryDistance(this.player.position,car);if(distance<d){d=distance;best=car;}}return best;}
 enter(car=this.nearest()){
  if(this.car||!car||car._disposed||car.traffic||car.controller!=='parked'||vehicleEntryDistance(this.player.position,car)>=2.5||this.player.isStunned)return false;
  if(!car.drivingVisual){this.notify('El carro todavía se está preparando.');return false;}
  this.savedVisible=this.player.root.visible;this.savedPosition=this.player.position.clone();this.car=car;initializeMotion(this);for(const key of MOTION_FIELDS)this[key]=car.parkedPhysics?.[key]??0;car.physics=this;car.controller='player';car.setControlled(true);this.speed=this.steer=0;this.pitch=this.roll=this.pitchVel=this.rollVel=0;
  this.player.velocity?.set(0,0,0);this.player.root.visible=false;this._follow();this.throttle=0;this.audio?.startEngine?.(car);return true;
 }
 _follow(){this.player.position.copy(this.car.position);this.player.root.position.copy(this.player.position);this.player.speed=Math.abs(this.speed);}
 exit(){
  if(!this.car)return false;if(Math.hypot(Math.cos(this.car.group.rotation.y)*this.speed+(this.vx??0),-Math.sin(this.car.group.rotation.y)*this.speed+(this.vz??0))>=.5){this.notify('Detén el carro para salir.');return false;}
  const car=this.car,yaw=car.group.rotation.y;
  for(const [side,front] of [[1,0],[-1,0],[1,-1],[-1,-1]]){
   const lateral=side*(car.width/2+.8),along=front*(car.length/2+.8);
   const p=new THREE.Vector3(car.position.x+Math.cos(yaw)*along+Math.sin(yaw)*lateral,car.position.y,car.position.z-Math.sin(yaw)*along+Math.cos(yaw)*lateral);
   const ground=this.district()?.getMovementGroundHeight?.(p.x,p.z,p.y)??p.y;if(!Number.isFinite(ground)||Math.abs(ground-car.position.y)>1)continue;p.y=ground;
   if(vehicleBlocked({length:.8,width:.8},p,0,this.collisions))continue;
   this.cancel(p);return true;
  }this.notify('No hay espacio libre para salir.');return false;
 }
 cancel(position=this.savedPosition){
  if(!this.car)return;
  this.car.parkedPhysics={speed:0};for(const key of MOTION_FIELDS)this.car.parkedPhysics[key]=this[key]??0;
  this.car.setControlled(false);this.car.controller='parked';this.car.setSteering(0);this.car.animateDrive(0,false);this.car=null;this.speed=0;this.player.speed=0;
  this.player.root.visible=this.savedVisible??true;if(position)this.player.position.copy(position);this.player.root.position.copy(this.player.position);this.player.velocity?.set(0,0,0);
 }
 update(dt,input,pedestrians=[]){
  if(!this.car)return;
  const car=this.car,throttle=input.isDown('KeyW')?1:input.isDown('KeyS')?-1:0;this.throttle=Math.abs(throttle)*(input.isRunning?1:.75);const steering=(input.isDown('KeyA')?1:0)-(input.isDown('KeyD')?1:0),boost=input.isRunning;
  if(input.consumePress('KeyB'))this.audio?.honkPlayer?.(car);
  let remaining=Math.min(Math.max(dt,0),.1);
  while(remaining>1e-8){const step=Math.min(remaining,1/120),before=this.speed;this.speed=driveSpeed(this.speed,throttle,boost,step);
   this.steer+=(steering*.52-this.steer)*Math.min(1,step*10);
   this.angularVel*=Math.exp(-step*7.8);
   const yaw=car.group.rotation.y+this.angularVel*step+(Math.abs(this.speed)>.2?this.steer*2.4*Math.min(1,Math.abs(this.speed)/8)*Math.sign(this.speed)*step:0);
   const previous=car.position.clone();this.candidate.copy(previous).addScaledVector(new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)),this.speed*step).addScaledVector(new THREE.Vector3(this.vx,0,this.vz),step);
   const grip=Math.exp(-step*6.8);this.vx*=grip;this.vz*=grip;
   const district=this.district(),ground=district?.getMovementGroundHeight?.(this.candidate.x,this.candidate.z,previous.y)??previous.y;
   const valid=Number.isFinite(ground)&&Math.abs(ground-previous.y)<.6&&(ground>1||!district?.isWalkableAt||district.isWalkableAt(this.candidate.x,this.candidate.z));
   if(valid)this.candidate.y=ground;
   const personAhead=pedestrians.some(npc=>{
     if(!npc.position||Math.abs(npc.position.y-this.candidate.y)>1.8)return false;
     const dx=npc.position.x-this.candidate.x,dz=npc.position.z-this.candidate.z;
     return Math.abs(dx*Math.cos(yaw)-dz*Math.sin(yaw))<car.length/2+.35&&Math.abs(dx*Math.sin(yaw)+dz*Math.cos(yaw))<car.width/2+.35;
   });
   if(!valid||personAhead){this.speed=0;remaining=step;car.animateDrive(0,true);}
   else {
     car.position.copy(this.candidate);car.group.rotation.y=yaw;
     resolveVehicleWalls(car,this,this.collisions,this.onCollision);this.contacts(car,this);
     car.animateDrive(this.speed*step,before*throttle<0);
   }
   const acceleration=(this.speed-before)/step,targetPitch=-THREE.MathUtils.clamp(acceleration/CAR_DRIVE.acceleration,-1,1)*.026,targetRoll=-this.steer*(this.speed/CAR_DRIVE.speed)*.092;
   this.acceleration=acceleration;
   this.pitchVel+=((targetPitch-this.pitch)*68-this.pitchVel*11.2)*step;this.rollVel+=((targetRoll-this.roll)*68-this.rollVel*11.2)*step;
   this.pitch=THREE.MathUtils.clamp(this.pitch+this.pitchVel*step,-.22,.22);this.roll=THREE.MathUtils.clamp(this.roll+this.rollVel*step,-.26,.26);
   this.heaveVel+=(-this.heaveY*85-this.heaveVel*12)*step;this.heaveY=THREE.MathUtils.clamp(this.heaveY+this.heaveVel*step,-.08,.14);
   car.setSteering(this.steer);car.drivingVisual.update(this.pitch,this.roll,this.steer,this.speed*step,this.heaveY);
   remaining-=step;
  }this._follow();
 }
}
