import {buildPrado} from './Prado.js';
import {buildAudioHatch} from './AudioHatch.js';
// Adapted from mrdoob/slop-newyork 09d27e050d1e75b7a0eea29a82e81aa4646f28e9.
// Copyright (c) 2026 Mr.doob. MIT; see THIRD_PARTY_NOTICES.md.
// Compatibility surface for Bogotá's simulation; all geometry comes from the current donor.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BODY_SPECS,buildCarGeometry as carGeometry,buildCarProxyGeometry as carProxy,buildSteerableWheelGeo} from './donor/cars.js';
import {BUS_SPEC,buildLoftedBusBodyGeometry,buildBusWheelGeo} from './donor/bus.js';
import {part} from './donor/vehicles.js';
export {CAR_PARTS,carLayout} from './donor/cars.js';
export {BUS_SPEC,BODY_SPECS};
BODY_SPECS.police={...BODY_SPECS.sedan,name:'police'};
BODY_SPECS.police_suv={...BODY_SPECS.suv,name:'police_suv'};
BODY_SPECS.police_pickup={...BODY_SPECS.pickup,name:'police_pickup'};
BODY_SPECS.audio_hatch={...BODY_SPECS.minivan,name:'audio_hatch'};
BODY_SPECS.prado={...BODY_SPECS.suv,name:'prado',wheelRadius:.41,cabin:{...BODY_SPECS.suv.cabin,cowl:1.05,roofFront:.22,roofRear:-1.96,deck:-2.24,glassEnd:-2.06,pillars:[-.35,-1.25],rail:[.72,.70],roofY:[[.22,1.85],[-.85,1.88],[-1.96,1.84]]},headlight:[.63,1.08,.245,.07],lamps:[1.08,1.16]};
// Proporciones largas: perfiles, cabina y ejes se alargan juntos, sin estirar las ruedas.
{
 const s=BODY_SPECS.prado,k=1.18;
 // A taller hood keeps the projector clusters enclosed by the front fenders.
 s.edge=s.edge.map(([z,y])=>[z,z>1.5?Math.max(y,1.13):y]);
 s.nose={...s.nose,edge:[.14,1.10,2.6]};
 for(const key of ['zFront','zRear','wheelZ'])s[key]*=k;
 for(const key of ['halfWidth','sill','shoulder','edge','crown','tumble'])s[key]=s[key].map(([z,v])=>[z*k,v]);
 for(const key of ['nose','tail'])s[key]=Object.fromEntries(Object.entries(s[key]).map(([key,a])=>[key,[a[0]*k,...a.slice(1)]]));
 for(const key of ['noseRake','tailRake'])s[key]={...s[key],length:s[key].length*k};
 s.cabin={...s.cabin};for(const key of ['cowl','roofFront','roofRear','deck','glassEnd'])s.cabin[key]*=k;
 s.cabin.roofY=s.cabin.roofY.map(([z,y])=>[z*k,y]);s.cabin.pillars=s.cabin.pillars.map(z=>z*k);
 for(const key of ['doors','handles'])s[key]=s[key].map(z=>z*k);
}

BODY_SPECS.bus=BUS_SPEC;
export function buildCarGeometry(spec,wheels=true,mirrors=false){
 if(spec.name==='prado')return buildPrado(spec,wheels,mirrors);
 if(spec.name==='audio_hatch')return buildAudioHatch(spec,wheels);
 if(spec.name!=='bus')return carGeometry(spec,wheels,mirrors);
 const pieces=[buildLoftedBusBodyGeometry()];
 if(wheels)for(const side of [-1,1])for(const z of [-spec.wheelZ,spec.wheelZ])pieces.push(buildBusWheelGeo(side).translate(side*spec.wheelX,spec.wheelRadius,z));
 const merged=mergeGeometries(pieces);pieces.forEach(p=>p.dispose());return merged;
}
export function buildCarProxyGeometry(spec){return spec.name==='audio_hatch'?buildAudioHatch(spec,false):spec.name==='bus'?part(new THREE.BoxGeometry(2.6,2.7,12.12).translate(0,1.65,-.16),0):carProxy(spec);}
export function buildWheelParts(spec,side){return [spec.name==='bus'?buildBusWheelGeo(side):buildSteerableWheelGeo(spec,side)];}
