import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeMotion,collideVehicles,overlapWithPlayer,knockOn,pose,wallResponse} from '../src/vehicles/SlopCollisionPhysics.js';
import {CAR_DRIVER,freeAcc,brake,acceleration,laneSafe} from '../src/vehicles/SlopTrafficAI.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function traffic(bus=false){
 const v=initializeMotion({position:{x:0,y:0,z:0},speed:0,tx:0,tz:1,heading:0,half:2.15,halfWidth:.9,bus,edge:{len:50},s:5,move:{turn:'S'},yaw:0,axle:1.3,nose:0,acc:0});
 Object.defineProperties(v,{x:{get:()=>v.position.x},z:{get:()=>v.position.z}});v.shove=(x,z)=>{v.position.x+=x;v.position.z+=z;};return v;
}
function driver(x=0,z=3.8,heading=Math.PI,speed=12){return initializeMotion({type:'car',position:{x,y:0,z},heading,halfW:.9,halfL:2.15,speed});}
test('choque frontal conserva los coeficientes de Slop: impulso, velocidad y suspension',()=>{
 const v=traffic(),p=driver();const event=collideVehicles(v,p);assert.ok(event);close(v.position.z,-.25);close(p.position.z,4.05);close(v.vz,-7.0656);close(p.speed,6);close(p.vz,3.6864);close(p.heaveVel,1.32);close(v.pitchVel,-2.16);
});
test('impacto lateral genera giro y balanceo; el bus tiene respuesta de mayor masa',()=>{
 const v=traffic(),p=driver(1.5,1,-Math.PI/2,10);collideVehicles(v,p);assert.notEqual(v.yawVel,0);assert.notEqual(v.rollVel,0);assert.equal(p.angularVel,0);
 const bus=traffic(true),attacker=driver();collideVehicles(bus,attacker);close(bus.vz,-2.64);close(attacker.speed,3.84);close(attacker.vz,7.8);
});
test('SAT distingue orientacion, contacto saliente y niveles del viaducto',()=>{
 assert.equal(overlapWithPlayer(4,4,0,.9,2.15,Math.PI/4,.9,2.15),null);
 assert.ok(overlapWithPlayer(1,1,0,.9,2.15,Math.PI/4,.9,2.15));
 const v=traffic(),p=driver();p.position.y=7.82;assert.equal(collideVehicles(v,p),null);assert.equal(v.vz,0);
 const away=driver(0,3.8,0,12);assert.equal(collideVehicles(v,away),null);assert.equal(v.vz,0);
});
test('los golpes se transmiten a otro carro y el giro se amortigua al recuperar la ruta',()=>{
 const v=traffic(),o=traffic();o.position.z=3;v.vz=8;knockOn(v,[v,o]);close(o.vz,5.44);close(v.vz,5.552);
 v.yawOffset=.6;v.yawVel=2;for(let i=0;i<600;i++)pose(v,1/120);assert.ok(Math.abs(v.yawOffset)<.001);assert.ok(Math.abs(v.yawVel)<.001);
});
test('choque con pared rebota de frente y desliza con giro de costado',()=>{
 const p=driver(0,0,Math.PI/2,10);wallResponse(p,-1,0,.2);close(p.speed,-2.5);close(p.vx,-4.2);assert.ok(p.heaveVel>0);
 const side=driver(0,0,.4,10);wallResponse(side,-1,0,.1);assert.ok(side.speed>0&&side.speed<10);assert.notEqual(side.angularVel,0);
});
test('IDM y MOBIL usan los valores y limites del conductor de Slop',()=>{
 assert.deepEqual(CAR_DRIVER,{a:2,b:3,T:1.2,s0:2,aLat:3.5});const v={speed:8,v0:14,driver:CAR_DRIVER};
 close(acceleration(v,{gap:20,leaderSpeed:6}),Math.max(-9,Math.min(2,freeAcc(v)+brake(v,20,6))));assert.equal(acceleration(v,{gap:.1}),-9);
 assert.equal(laneSafe(v,{speed:2},1,null,Infinity),false);assert.equal(laneSafe(v,null,Infinity,null,Infinity),true);
});
