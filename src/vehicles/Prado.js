import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildCarGeometry as donorGeometry,carLayout} from './donor/cars.js';
import {part} from './donor/vehicles.js';
export function buildPrado(spec,wheels=true,mirrors=false){
 const pieces=[donorGeometry(spec,wheels,mirrors)];
 const add=(g,id,x,y,z)=>{g.translate(x,y,z);pieces.push(part(g,id));};
 const box=(id,w,h,d,x,y,z,r=.02)=>add(new RoundedBoxGeometry(w,h,d,2,r),id,x,y,z);
 // Parrilla vertical, con fondo cerrado y nervaduras cromadas.
 box(14,.91,.37,.06,0,.91,2.30,.045);
 for(let i=-4;i<=4;i++)box(15,.024,.34,.025,i*.096,.91,2.34,.008);
 add(new THREE.TorusGeometry(.074,.012,6,24),15,0,.93,2.37);
 for(const side of [-1,1]){
  box(4,.13,.08,2.35,side*.95,.34,0);
  box(15,.13,.035,2.27,side*.95,.39,0);
  box(14,.46,.14,.045,side*.66,1.01,2.24);
  for(const x of [.54,.72]){const g=new THREE.CylinderGeometry(.052,.052,.035,16);g.rotateX(Math.PI/2);add(g,16,side*x,1.01,2.28);add(new THREE.TorusGeometry(.056,.009,5,16),15,side*x,1.01,2.30);}
  box(14,.20,.37,.05,side*.72,.99,-2.34);
  for(const y of [.88,1.00,1.12])box(17,.17,.085,.045,side*.72,y,-2.34);
 }
 for(let i=1;i<pieces.length;i++)pieces[i].scale(1,1,1.18);
 // Seat fascia details on the loft instead of assuming its curved end is a plane.
 const probeMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),shell=new THREE.Mesh(pieces[0],probeMaterial),ray=new THREE.Raycaster(),center=new THREE.Vector3();
 for(const g of pieces.slice(1)){
  g.computeBoundingBox();g.boundingBox.getCenter(center);
  if(Math.abs(center.z)<2.3)continue;
  const sign=Math.sign(center.z);ray.set(new THREE.Vector3(center.x,center.y,sign*10),new THREE.Vector3(0,0,-sign));
  const hit=ray.intersectObject(shell,false)[0];
  const id=g.attributes.partId.getX(0),depth=id===14?.015:id===15?.085:id===16?.09:id===17?.06:.028;
  if(hit)g.translate(0,0,hit.point.z+sign*depth-center.z);
 }
 probeMaterial.dispose();
 // Explicit roof and window surrounds survive export to Blender. Sample the
 // donor glasshouse rather than placing floating boxes over its curved sides.
 const layout=carLayout(spec),cab=spec.cabin;
 const patch=(id,point,nu=12,nv=4)=>{
  const p=[],uv=[],idx=[];
  for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){p.push(...point(i/nu,j/nv));uv.push(i/nu,j/nv);}
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;idx.push(a,c,b,b,c,d);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();pieces.push(part(g,id));
 };
 patch(18,(u,v)=>{const z=THREE.MathUtils.lerp(cab.roofRear,cab.roofFront,v),c=layout.cabin(z),x=(u*2-1)*c.railX;return [x,layout.cabinTop(c,x)+.009,z];},20,24);
 for(const side of [-1,1]){
  const panel=(id,z0,z1,t0,t1)=>patch(id,(u,v)=>{
   // Reverse U on one side so both outward normals remain front-facing.
   const z=THREE.MathUtils.lerp(z0,z1,side>0?u:1-u),c=layout.cabin(z),t=THREE.MathUtils.lerp(t0,t1,v);
   return [side*(THREE.MathUtils.lerp(c.beltX,c.railX,t)+c.bulge*4*t*(1-t)+.009),THREE.MathUtils.lerp(c.beltY,c.railY,t),z];
  });
  panel(18,cab.deck+.01,cab.cowl-.01,0,.055);
  panel(18,cab.deck+.01,cab.cowl-.01,.90,1);
  patch(18,(u,v)=>{
   const z=THREE.MathUtils.lerp(cab.cowl-.03,cab.roofFront+.025,v)+(side>0?u:1-u)*.055,c=layout.cabin(z);
   return [side*(THREE.MathUtils.lerp(c.beltX,c.railX,v)+c.bulge*4*v*(1-v)+.012),THREE.MathUtils.lerp(c.beltY,c.railY,v),z];
  },3,16);
  panel(18,cab.deck+.01,cab.glassEnd,0,1);
  for(const z of cab.pillars)panel(14,z-.04,z+.04,0,1);
  for(const z of spec.handles){const b=layout.body(z);box(18,.045,.035,.16,side*(b.W+.008),b.yE-.11,z,.014);}
 }
 // Rear roof lip, plate recess and bumper inserts are geometric in both views.
 box(18,1.48,.065,.18,0,1.84,cab.roofRear,.025);
 box(14,.43,.17,.035,0,.82,spec.zRear-.008,.018);
 box(15,.48,.04,.04,0,1.02,spec.zRear-.018,.012);
 for(const side of [-1,1]){
  box(14,.24,.18,.045,side*.68,.59,spec.zFront-.04,.05);
  const fog=new THREE.CylinderGeometry(.055,.055,.025,16);fog.rotateX(Math.PI/2);add(fog,16,side*.68,.59,spec.zFront-.005);
 }
 const merged=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());return merged;
}

