import {cityUniforms} from '../graphics/GraphicsState.js';
import {attribute,abs,step,mix,vec3} from 'three/tsl';
import {colombianPoliceMaterial} from './ColombianPolice.js';
// Adapted from mrdoob/slop-newyork 09d27e050d1e75b7a0eea29a82e81aa4646f28e9.
// Copyright (c) 2026 Mr.doob. MIT; see THIRD_PARTY_NOTICES.md.
import {createLoftedCarMaterial,carStyleCode} from './donor/cars.js';
import {createLoftedBusMaterial,createBusWheelMaterial} from './donor/bus.js';
export {carStyleCode};
export function vehicleStyle(variant,seed=0){return carStyleCode({livery:variant.startsWith('police')?1:0,metallic:Math.abs(seed)%2,trim:Math.abs(seed)%3,wheel:Math.abs(seed)%4});}
export function createSlopMaterial(spec,paint=null){
 const mat=spec.name==='bus'?createLoftedBusMaterial(paint):createLoftedCarMaterial(spec,paint);
 mat.name=spec.name+' · Slop 09d27e0';mat.userData.shaderFamily='slop-current:'+spec.name+':'+(paint===null?'batch':'fixed');
 if(spec.name==='police_pickup')colombianPoliceMaterial(mat);
 if(spec.name==='prado'){
  const id=attribute('partId','float'),is=n=>step(abs(id.sub(n)),.25);let c=mat.colorNode;
  for(const [n,rgb] of [[14,[.008,.009,.012]],[15,[.32,.35,.38]],[16,[.75,.85,1]],[17,[.5,.005,.01]],[18,[.89,.90,.88]]])c=mix(c,vec3(...rgb),is(n));
  c=mix(c,c.mul(.35),is(3)); // Dark alloy retains the donor's spokes and rotor pattern.
  mat.colorNode=c;mat.emissiveNode=mat.emissiveNode.add(vec3(.8,.9,1).mul(is(16)).mul(cityUniforms.lightsOn));
 }
 if(spec.name==='audio_hatch'){
  const id=attribute('partId','float'),is=n=>step(abs(id.sub(n)),.25);
  let c=mat.colorNode;
  for(const [n,rgb] of [[11,[.005,.6,.57]],[12,[.015,.018,.022]],[13,[.85,.9,1]]])c=mix(c,vec3(...rgb),is(n));
  mat.colorNode=c;

 }
 return mat;
}
export function createVehicleWheelMaterial(spec){return spec.name==='bus'?createBusWheelMaterial().clone():createSlopMaterial(spec,'#bfc5cb');}
