import * as THREE from 'three';
import {wallResponse} from './SlopCollisionPhysics.js';
/** Oriented footprint against static boxes and oriented buses, with vertical separation. */
export function vehicleContact(car,position,yaw,entry){
 if(entry.vehicle===car)return null;
 const box=entry.box;if(position.y>=box.max.y-.08||position.y+1.5<=box.min.y+.02)return null;
 const u=new THREE.Vector2(Math.cos(yaw),-Math.sin(yaw)),v=new THREE.Vector2(-u.y,u.x);
 const center=entry.obb?new THREE.Vector2(entry.obb.center.x,entry.obb.center.z):new THREE.Vector2((box.min.x+box.max.x)/2,(box.min.z+box.max.z)/2);
 const a=entry.obb?new THREE.Vector2(entry.obb.axes[0].x,entry.obb.axes[0].z).normalize():new THREE.Vector2(1,0);
 const b=entry.obb?new THREE.Vector2(entry.obb.axes[2].x,entry.obb.axes[2].z).normalize():new THREE.Vector2(0,1);
 const hx=entry.obb?entry.obb.halfSize.x:(box.max.x-box.min.x)/2,hz=entry.obb?entry.obb.halfSize.z:(box.max.z-box.min.z)/2;
 const d=new THREE.Vector2(position.x-center.x,position.z-center.y);
 let depth=Infinity,nx=0,nz=0;
 for(const axis of [u,v,a,b]){
  const r=car.length/2*Math.abs(u.dot(axis))+car.width/2*Math.abs(v.dot(axis));
  const other=hx*Math.abs(a.dot(axis))+hz*Math.abs(b.dot(axis));
  const projected=d.dot(axis),overlap=r+other-Math.abs(projected);
  if(overlap<=.02)return null;
  if(overlap<depth){depth=overlap;const sign=projected>=0?1:-1;nx=axis.x*sign;nz=axis.y*sign;}
 }return {nx,nz,depth};
}
export function vehicleIntersects(car,position,yaw,entry){return !!vehicleContact(car,position,yaw,entry);}
export function vehicleBlocked(car,position,yaw,collisions){
 const r=Math.hypot(car.length,car.width)/2;
 const entries=collisions.queryStatic(position.x-r,position.z-r,position.x+r,position.z+r,[]);
 return entries.some(e=>vehicleIntersects(car,position,yaw,e))||(collisions.dynamicColliders??[]).some(e=>vehicleIntersects(car,position,yaw,e));
}

/** Slop wall response: slide, rebound head-on, yaw and suspension kick. */
export function resolveVehicleWalls(car,owner,collisions,onCollision=()=>{}){
 if(!collisions)return;
 const r=Math.hypot(car.length,car.width)/2;
 const entries=collisions.queryStatic(car.position.x-r,car.position.z-r,car.position.x+r,car.position.z+r,[]);
 owner.position=car.position;owner.heading=car.group.rotation.y+Math.PI/2;
 for(let pass=0;pass<3;pass++){
  let touched=false;
  for(const entry of entries){const hit=vehicleContact(car,car.position,car.group.rotation.y,entry);if(!hit)continue;touched=true;wallResponse(owner,hit.nx,hit.nz,hit.depth+.001,event=>onCollision({...event,a:car,b:entry}));}
  if(!touched)break;
 }
}
