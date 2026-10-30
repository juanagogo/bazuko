import * as THREE from 'three';
/** Directed lanes/connectors over the existing Bogotá routes; no imported NY geography. */
export class BogotaRoadNetwork {
 constructor(routes){this.routes=routes;this.edges=[];this.byRoute=new Map();this.p=new THREE.Vector3();this.d=new THREE.Vector3();
  for(const route of routes){let start=0;const list=[];for(const segment of route.segments){const edge={route,segment,start,end:start+segment.length};this.edges.push(edge);list.push(edge);start+=segment.length;}this.byRoute.set(route,list);}
 }
 locate(route,distance){const s=((distance%route.length)+route.length)%route.length;return this.byRoute.get(route)?.find(e=>s>=e.start&&s<=e.end);}
 continuations(vehicle){
  const {route,distance,car}=vehicle;route.sample(distance,this.p,this.d);const out=[],margin=car.length/2+1;
  if(Math.min(Math.abs(this.d.x),Math.abs(this.d.z))>1e-6)return out;
  for(const edge of this.edges){const s=edge.segment;if(edge.route===route||s.radius||Math.abs(s.dx-this.d.x)>1e-6||Math.abs(s.dz-this.d.z)>1e-6)continue;
   const dx=this.p.x-s.x,dz=this.p.z-s.z,along=dx*s.dx+dz*s.dz,across=dx*-s.dz+dz*s.dx;
   if(Math.abs(across)<1e-5&&along>margin&&along<s.length-margin)out.push({route:edge.route,distance:edge.start+along,straight:s.length-along>25});
  }return out;
 }
 adjacent(route){return (route.adjacentLanes??[]).filter(r=>this.routes.includes(r));}
 laneChanges(vehicle){
  const source=this.locate(vehicle.route,vehicle.distance);if(!source||source.segment.radius)return [];
  const remaining=source.end-vehicle.distance;if(remaining<45)return [];
  vehicle.route.sample(vehicle.distance,this.p,this.d);const result=[];
  for(const route of this.adjacent(vehicle.route))for(const edge of this.edges){const s=edge.segment;
   if(edge.route!==route||s.radius||s.dx!==this.d.x||s.dz!==this.d.z)continue;
   const dx=this.p.x-s.x,dz=this.p.z-s.z,along=dx*s.dx+dz*s.dz,across=dx*-s.dz+dz*s.dx;
   if(Math.abs(across)>=2.4&&Math.abs(across)<=4.2&&along>8&&along+45<s.length)result.push({route,distance:edge.start+along,side:Math.sign(-across)});
  }return result;
 }
}
