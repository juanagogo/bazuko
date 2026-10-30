import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {driveSpeed,idmAcceleration,weightedMove} from '../src/vehicles/SlopDynamics.js';
import {BogotaRoadNetwork} from '../src/vehicles/BogotaRoadNetwork.js';
import {TrafficRoute} from '../src/world/bogota/TrafficRoute.js';
test('IDM distingue carretera libre, seguimiento y obstaculo detenido',()=>{
 const free=idmAcceleration(8,14),leader=idmAcceleration(8,14,20,8),stopped=idmAcceleration(8,14,20,0);
 assert.ok(free>leader);assert.ok(leader>stopped);assert.ok(idmAcceleration(8,14,2,0)<0);assert.ok(Number.isFinite(idmAcceleration(0,0,0,0)));
 assert.equal(weightedMove(['recto','giro'],x=>x==='recto'?3:1,()=>.5),'recto');
});
test('la resistencia y freno de Slop no invierten la marcha, el impulso no recorta inercia',()=>{
 assert.ok(driveSpeed(5,1,false,.1)>5);assert.ok(driveSpeed(10,1,true,.1)>driveSpeed(10,1,false,.1));assert.ok(driveSpeed(20,1,false,.1)<20);assert.ok(driveSpeed(30,1,false,.1)>18);
 assert.equal(driveSpeed(.1,-1,false,1),0);assert.ok(driveSpeed(0,-1,false,.1)<0);assert.equal(driveSpeed(.1,0,false,10),0);
});
test('red bogotana solo conecta rutas coincidentes y carriles contiguos declarados',()=>{
 const a=new TrafficRoute(0,100,0,100,3.2),b=new TrafficRoute(0,100,3.2,103.2,3.2),opposite=new TrafficRoute(0,100,40,140,3.2);
 const network=new BogotaRoadNetwork([a,b,opposite]),vehicle={route:a,distance:20,car:{length:4.3}};
 assert.equal(network.laneChanges(vehicle).length,0);a.adjacentLanes=[b];assert.equal(network.laneChanges(vehicle).length,1);
 a.adjacentLanes=[opposite];assert.equal(network.laneChanges(vehicle).length,0);
 a.sample(vehicle.distance,new THREE.Vector3(),new THREE.Vector3());assert.ok(network.locate(a,20));
});
