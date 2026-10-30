import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {VEHICLE_TYPES,trafficVariant} from '../src/vehicles/VehicleTypes.js';
import {createSlopVehicle} from '../src/vehicles/SlopVehicle.js';
import {vehicleBatches,disposeVehicleBatches} from '../src/vehicles/VehicleBatches.js';
import {TrafficSignals,intersectionPhase} from '../src/world/bogota/TrafficSignals.js';
import {CAR_DRIVE,driveSpeed} from '../src/vehicles/SlopDynamics.js';
import {createSynthResources,createMotorVoice} from '../src/vehicles/SlopMotorSynthesis.js';

test('todas las clases del donante mantienen dimensiones, orientacion, estados y liberacion del banco',()=>{
 const scene=new THREE.Scene();
 for(const [variant,size] of Object.entries(VEHICLE_TYPES)){
  const v=createSlopVehicle({variant,...size,scene});scene.add(v.group);v.setNight(true);v.updateMotion(3,true);v.setSteering(.2,1);
  assert.equal(v.material.userData.vehicleState.night.value,1);assert.equal(v.material.userData.vehicleState.braking.value,1);
  const actual=new THREE.Box3().setFromObject(v.group).getSize(new THREE.Vector3());
  assert.ok(Math.abs(actual.x-size.length)<.001,variant);assert.ok(Math.abs(actual.z-size.width)<.001,variant);
  assert.ok(Math.abs(actual.y-size.height)<.001,variant);assert.ok(v.headlightFrame.localToWorld(new THREE.Vector3(0,0,2)).x>0);
  v.dispose();
 }
 assert.equal(vehicleBatches(scene).entries.size,0);disposeVehicleBatches(scene);
 assert.deepEqual([0,.31,.6,.8,.85,.9,.95,.97,.99].map(x=>trafficVariant(()=>x)),['taxi','sedan','suv','van','minivan','pickup','police_pickup','police_suv','bus']);
});

test('solo un cuarto redondeado de cruces conserva postes; prioridad ignora fases invisibles',()=>{
 const a=new TrafficSignals(),b=new TrafficSignals();
 const selected=a.nodes.filter(n=>n.control==='signal');
 assert.equal(selected.length,Math.ceil(a.nodes.length/4));assert.equal(a.poles.length,selected.length*4);
 assert.deepEqual(a.nodes.map(n=>n.control),b.nodes.map(n=>n.control));
 for(const node of a.nodes.filter(n=>n.control==='priority'))for(const time of [0,16,25,35]){a.update(time);assert.equal(intersectionPhase(a,node,0),0);assert.equal(intersectionPhase(a,node,1),0);}
 a.dispose();b.dispose();
});

test('limites del jugador a la mitad, con potencia limitada y sin cortar inercia',()=>{
 assert.deepEqual([CAR_DRIVE.speed,CAR_DRIVE.boostSpeed,CAR_DRIVE.reverseSpeed],[11.75,18,5.25]);
 let speed=0;for(let i=0;i<3000;i++)speed=driveSpeed(speed,1,false,.01);assert.ok(speed<=11.75&&speed>11);
 speed=0;for(let i=0;i<3000;i++)speed=driveSpeed(speed,-1,false,.01);assert.ok(speed>=-5.25&&speed<-5);
 assert.ok(driveSpeed(20,1,false,.1)<20);assert.ok(driveSpeed(20,1,false,.1)>18);
});

test('buffers de motores finitos y voces de combustion liberables sin modalidades ajenas',()=>{
 const sources=[],nodes=[];const parameter=()=>({value:0,automationRate:'a-rate',cancelScheduledValues(){},setValueAtTime(){},setTargetAtTime(){}});
 const node=()=>{const n={connect(){return this;},disconnect(){this.freed=true;}};for(const key of ['gain','frequency','detune','Q','playbackRate'])n[key]=parameter();nodes.push(n);return n;};
 const ctx={state:'running',sampleRate:8000,currentTime:0,createBuffer:(channels,length,rate)=>{const data=new Float32Array(length);return {duration:length/rate,getChannelData:()=>data};},createGain:node,createBiquadFilter:node,createBufferSource:()=>{const n=node();n.start=()=>{};n.stop=()=>n.stopped=true;sources.push(n);return n;}};
 const resources=createSynthResources(ctx);assert.deepEqual(Object.keys(resources.combustion),['sedan','suv','bus']);
 for(const sound of Object.values(resources.combustion))for(const value of Object.values(sound))if(value?.getChannelData)assert.ok(value.getChannelData(0).every(Number.isFinite));
 for(const kind of ['sedan','suv','bus']){const voice=createMotorVoice(ctx,resources,kind,node());voice.update({speed:12,load:1});voice.dispose();voice.dispose();}
 assert.ok(sources.every(n=>n.stopped));assert.throws(()=>createMotorVoice(ctx,resources,'helicopter',node()),RangeError);
});

