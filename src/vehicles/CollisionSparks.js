// Particle pool adapted from Slop New York 1b54e165/js/traffic.js (MIT).
import * as THREE from 'three/webgpu';
export class CollisionSparks {
 constructor(scene,random=Math.random){
  this.random=random;this.cursor=0;this.items=Array.from({length:120},()=>({life:0}));
  this.mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.038,.038,.26),new THREE.MeshBasicNodeMaterial({color:0xffc438}),120);
  this.mesh.name='Chispas de choques';this.mesh.frustumCulled=false;this.mesh.instanceMatrix=new THREE.StorageInstancedBufferAttribute(this.mesh.instanceMatrix.array,16);this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.dummy=new THREE.Object3D();
  for(let i=0;i<120;i++)this.mesh.setMatrixAt(i,new THREE.Matrix4().makeScale(0,0,0));scene.add(this.mesh);
 }
 spawn(x,y,z,nx,nz,speed){
  this.active=true;
  const count=Math.min(24,Math.max(8,Math.floor(speed*1.4))),tx=-nz,tz=nx,r=this.random;
  for(let i=0;i<count;i++){
   const p=this.items[this.cursor];this.cursor=(this.cursor+1)%120;
   const spread=(r()-.5)*2.2,out=(.3+r()*.9)*Math.min(14,speed*.65),tan=spread*Math.min(12,speed*.55);
   Object.assign(p,{x:x+(r()-.5)*.35,y:y+(r()-.5)*.18,z:z+(r()-.5)*.35,vx:nx*out+tx*tan,vy:2.4+r()*5.4,vz:nz*out+tz*tan,maxLife:.28+r()*.24});p.life=p.maxLife;
  }
 }
 update(dt){
  if(!this.active)return;let active=0;
  for(let i=0;i<120;i++){
   const p=this.items[i],o=this.dummy;p.life=Math.max(0,p.life-dt);
   if(p.life){active++;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=18*dt;o.position.set(p.x,p.y,p.z);o.rotation.set(0,Math.atan2(p.vx,p.vz),0);o.scale.setScalar(p.life/p.maxLife);}
   else{o.scale.setScalar(0);}o.updateMatrix();this.mesh.setMatrixAt(i,o.matrix);
  }this.active=active>0;this.mesh.instanceMatrix.needsUpdate=true;
 }
 dispose(){this.mesh.removeFromParent();this.mesh.dispose();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
