import * as THREE from 'three';
import {MOTION_FIELDS,initializeMotion,collideVehicles,knockOn,pose} from './SlopCollisionPhysics.js';
import {resolveVehicleWalls} from './DrivingCollision.js';
import {CollisionSparks} from './CollisionSparks.js';
const clamp=THREE.MathUtils.clamp;
/** Adapts Slop's path-relative motion to Car entities and Bogotá's existing routes/heights. */
export class TrafficCollisionWorld {
 constructor(scene){this.bodies=new Map();this.sparks=new CollisionSparks(scene);this.p=new THREE.Vector3();this.d=new THREE.Vector3();}
 body(car,owner,{route=false,bus=false}={}){
  let body=this.bodies.get(car);if(body?.owner===owner)return body;
  initializeMotion(owner);const world=this;
  body={car,owner,bus:bus||car.variant==='bus',isSUV:car.variant==='suv',type:'traffic',edge:true,half:car.length/2,halfWidth:car.width/2,halfW:car.width/2,halfL:car.length/2,axle:car.length*.3,move:{turn:'S'},edgeInfo:{len:1000},nose:0,tx:Math.cos(car.group.rotation.y),tz:-Math.sin(car.group.rotation.y)};
  Object.defineProperties(body,{position:{get:()=>car.position},x:{get:()=>car.position.x},z:{get:()=>car.position.z},heading:{get:()=>bus?Math.atan2(car.heading?.x??0,car.heading?.z??-1):car.group.rotation.y+Math.PI/2},speed:{get:()=>owner.speed??0,set:v=>owner.speed=v},acc:{get:()=>owner.acceleration??0},yaw:{get:()=>owner.pathYaw??body.heading,set:v=>owner.pathYaw=v}});
  for(const field of [...MOTION_FIELDS,'blink'])Object.defineProperty(body,field,{get:()=>owner[field]??0,set:v=>owner[field]=v});
  body.shove=(dx,dz)=>{
   if(route){owner.distance=((owner.distance+dx*body.tx+dz*body.tz)%owner.route.length+owner.route.length)%owner.route.length;owner.dl=clamp(owner.dl+dz*body.tx-dx*body.tz,-2.5,2.5);}
   if(bus){const across=dz*body.tx-dx*body.tz;car.collisionLateral=clamp((car.collisionLateral??0)+across,-.45,.45);}
   car.position.x+=dx;car.position.z+=dz;
  };
  body.report=e=>world.report(e);this.bodies.set(car,body);car.physics=owner;return body;
 }
 report(event){
  event={...event,a:event.a?.car??event.a,b:event.b?.car??event.b};
  this.onCollision?.(event);
  if(event.speed>2.2)this.sparks.spawn(event.x,event.y,event.z,event.nx,event.nz,event.speed);
 }
 collideDriver(car,driver){
  const pe={type:'car',car,position:car.position,halfW:car.width/2,halfL:car.length/2};initializeMotion(driver);
  Object.defineProperty(pe,'heading',{get:()=>car.group.rotation.y+Math.PI/2});
  for(const key of ['speed',...MOTION_FIELDS])Object.defineProperty(pe,key,{get:()=>driver[key]??0,set:v=>driver[key]=v});
  for(const body of this.bodies.values()){
   if(body.car===car||body.car._disposed||body.car.group.visible===false)continue;
   collideVehicles(body,pe,{onCollision:e=>this.report(e),sparks:()=>{}});
  }
 }
 routePose(vehicle,dt){
  const {car}=vehicle,b=this.body(car,vehicle,{route:true}),v=vehicle;
  // Slop's lateral acceleration/recovery and exponentially damped impact velocity.
  const maxLat=Math.min(1.7,.3+.22*v.speed),rate=Math.min(1.8,Math.max(v.speed,1.5)/(b.axle+b.half)),target=clamp(-rate*v.dl,-maxLat,maxLat);
  v.dlv+=clamp(target-v.dlv,-2.5*dt,2.5*dt);v.dl=clamp(v.dl+v.dlv*dt,-2.5,2.5);
  if(v.vx||v.vz){b.shove(v.vx*dt,v.vz*dt);const damp=Math.exp(-5.5*dt);v.vx*=damp;v.vz*=damp;if(v.vx*v.vx+v.vz*v.vz<1e-4)v.vx=v.vz=0;}
  v.route.sample(v.distance,car.position,this.d);
  // Keep the axle-defined heading continuous through an intersection.
  const front=new THREE.Vector3(),rear=new THREE.Vector3(),direction=new THREE.Vector3();v.route.sample(v.distance+b.axle,front,direction);v.route.sample(v.distance-b.axle,rear,direction);
  direction.copy(front).sub(rear).setY(0).normalize();b.tx=direction.x;b.tz=direction.z;b.nose=Math.atan2(v.dlv,Math.max(v.speed,1.5));
  car.position.x-=b.tz*(v.dl+b.axle*Math.sin(b.nose));car.position.z+=b.tx*(v.dl+b.axle*Math.sin(b.nose));
  const edge=this.network?.locate(v.route,v.distance);b.conn=!!edge?.segment.radius;b.edge={len:edge?.end??v.route.length};b.s=v.distance;b.move.turn=(b.conn||this.network?.byRoute.get(v.route)?.some(e=>e.start>v.distance&&e.start-v.distance<35&&e.segment.radius))?'R':'S';
  pose(b,dt);car.group.rotation.y=b.yaw+b.yawOffset-Math.PI/2;
  car.setSteering?.(b.steer,b.blink);car.setPose?.(b.pitch,b.roll,0);
 }
 step(vehicles,parked,buses,driver,dt,collisions){
  const present=new Set(vehicles.map(v=>v.car));
  for(const entry of parked??[]){const car=entry.car;present.add(car);if(car===driver?.car){this.bodies.delete(car);continue;}
   const owner=car.parkedPhysics??={speed:0},b=this.body(car,owner);owner.baseHeading??=b.heading;b.tx=Math.sin(owner.baseHeading);b.tz=Math.cos(owner.baseHeading);
   b.shove(b.vx*dt,b.vz*dt);b.vx*=Math.exp(-5.5*dt);b.vz*=Math.exp(-5.5*dt);
   owner.angularVel*=Math.exp(-7.8*dt);car.group.rotation.y+=owner.angularVel*dt;
   pose(b,dt);car.group.rotation.y=b.yaw+b.yawOffset-Math.PI/2;car.setPose?.(b.pitch,b.roll,0);resolveVehicleWalls(car,owner,collisions,e=>this.report(e));
  }
  for(const entry of buses??[]){const bus=entry.car;present.add(bus);const b=this.body(bus,bus,{bus:true});b.tx=bus.heading.x;b.tz=bus.heading.z;
   // Keep the service on its bridge route; absorb the donor's heavier-body impulse.
   b.shove(b.vx*dt,b.vz*dt);const damp=Math.exp(-5.5*dt);b.vx*=damp;b.vz*=damp;bus._alignRoute?.();bus._alignToGround?.();
  }
  for(const car of this.bodies.keys())if(!present.has(car)||car._disposed)this.bodies.delete(car);
  const bodies=[...this.bodies.values()];
  for(const b of bodies)if(!b.bus&&b.vx*b.vx+b.vz*b.vz>.36)knockOn(b,bodies.filter(o=>Math.abs(o.position.y-b.position.y)<(b.bus||o.bus?2.8:1.6)),(_a,_b,x,y,z,nx,nz,speed)=>this.onCollision?.({a:_a.car,b:_b.car,x,y:b.position.y+y,z,nx,nz,speed,kind:'vehicle'}),(x,y,z,nx,nz,speed)=>this.sparks.spawn(x,b.position.y+y,z,nx,nz,speed));
  if(driver?.car)this.collideDriver(driver.car,driver);
  for(const v of vehicles){
    const x=v.car.position.x,z=v.car.position.z,b=this.body(v.car,v,{route:true});resolveVehicleWalls(v.car,v,collisions,e=>this.report(e));
    const dx=v.car.position.x-x,dz=v.car.position.z-z;
    v.distance=((v.distance+dx*b.tx+dz*b.tz)%v.route.length+v.route.length)%v.route.length;v.dl=clamp(v.dl+dz*b.tx-dx*b.tz,-2.5,2.5);
  }
  this.sparks.update(dt);
 }
 dispose(){this.bodies.clear();this.sparks.dispose();}
}
