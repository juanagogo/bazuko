import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Group} from 'three';
import {DebugSystems,DEBUG_SYSTEMS} from '../src/core/DebugSystems.js';
function fixture(){
 const parent=new Group(),owner=()=>{const group=new Group();parent.add(group);return {group};};
 const car=owner(),npc=owner(),bus=owner(),dog=owner();
 const game={cars:[car],dog,world:{active:{npcs:[npc],busServices:[bus],signals:{reservations:new Map([['cross',1]])}}},traffic:{vehicles:[],physics:{bodies:new Map()},setParkedCars(c){this.parked=c;},setBus(b){this.buses=b;}},renderer:{},localLights:{},sceneMgr:{atmosphere:{}},audio:{},driving:{},_syncVehicleColliders(){this.syncs=(this.syncs??0)+1;}};
 const debug=game.debugSystems=new DebugSystems(game);return {parent,car,npc,bus,dog,game,debug};
}
test('masks preserve entities, transforms, independent visibility and reservations',async()=>{
 const {parent,car,game,debug}=fixture();car.group.position.set(1,2,3);car.group.visible=false;
 await debug.setEnabled('cars',false);
 assert.equal(car.group.parent.visible,false);assert.equal(car.debugDisabled,true);assert.equal(game.cars[0],car);assert.equal(game.traffic.parked.length,0);assert.equal(game.world.active.signals.reservations.size,0);
 await debug.setEnabled('cars',true);assert.equal(car.group.parent,parent);assert.equal(car.group.visible,false);assert.deepEqual(car.group.position.toArray(),[1,2,3]);assert.equal(game.traffic.parked[0],car);
});
test('late entities remain hidden and removed entities are not resurrected',async()=>{
 const {parent,npc,game,debug}=fixture();await debug.setEnabled('pedestrians',false);
 const late={group:new Group()};parent.add(late.group);game.world.active.npcs.push(late);debug.sync();assert.equal(late.group.parent.visible,false);
 game.world.active.npcs=[];debug.sync();assert.equal(npc.group.parent,null);assert.equal(late.group.parent,null);
});
test('effects commit only after preparation and roll back on error',async()=>{
 const {game,debug}=fixture();let release;game.prepareDebugEffects=()=>new Promise(r=>release=r);
 const change=debug.setEnabled('effects',false);assert.equal(debug.isEnabled('effects'),true);assert.equal(debug.pending.has('effects'),true);release(true);await change;assert.equal(debug.isEnabled('effects'),false);
 game.prepareDebugEffects=async()=>{throw new Error('GPU failure');};await assert.rejects(debug.setEnabled('effects',true),/GPU failure/);assert.equal(debug.isEnabled('effects'),false);assert.equal(debug.pending.size,0);
});
test('driving blocks disabling cars and reset restores independent systems',async()=>{
 const {game,debug,dog}=fixture();game.driving.car={};await assert.rejects(debug.setEnabled('cars',false),/Sal del vehículo/);assert.equal(debug.isEnabled('cars'),true);game.driving.car=null;
 for(const key of ['dog','transit','pedestrians','lights','shadows'])await debug.setEnabled(key,false);
 assert.equal(dog.debugDisabled,true);assert.equal(game.localLights.enabled,false);assert.equal(game.sceneMgr.atmosphere.debugShadowsEnabled,false);
 await debug.reset();for(const key of Object.keys(DEBUG_SYSTEMS))assert.equal(debug.isEnabled(key),true);assert.equal(dog.debugDisabled,false);
});
test('disposal restores wrappers and cancels pending changes',async()=>{
 const {game,parent,car,debug}=fixture();await debug.setEnabled('cars',false);let release;game.prepareDebugEffects=()=>new Promise(r=>release=r);const p=debug.setEnabled('effects',false);debug.dispose();release(true);assert.equal(await p,false);assert.equal(car.group.parent,parent);assert.equal(debug.isEnabled('effects'),true);assert.equal(debug.listeners.size,0);
});
test('interactive merchants remain active when ambient pedestrians are disabled',async()=>{
 const {game,parent,debug}=fixture();const vendor={root:new Group(),isVendor:true};parent.add(vendor.root);game.world.active.npcs.push(vendor);await debug.setEnabled('pedestrians',false);assert.equal(vendor.debugDisabled,undefined);assert.equal(vendor.root.parent,parent);assert.equal(debug.counts().pedestrians.total,1);
});
