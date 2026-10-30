import {Group} from 'three';

export const DEBUG_SYSTEMS=Object.freeze({cars:'Carros y buses urbanos',transit:'TransMilenio',pedestrians:'Peatones',pigeons:'Palomas',dog:'El Chato',vegetation:'Árboles',rain:'Lluvia',lights:'Luces locales',shadows:'Sombras solares',effects:'Reflejos y bloom'});

/** Session-only masks. An identity parent suppresses drawing without overwriting LOD/culling visibility. */
export class DebugSystems {
 constructor(game){this.game=game;this.state=Object.fromEntries(Object.keys(DEBUG_SYSTEMS).map(k=>[k,true]));this.gates=new Map();this.listeners=new Set();this.pending=new Set();}
 isEnabled(key){return this.state[key]!==false;}
 subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 _notify(){for(const listener of this.listeners)listener(this);}
 async setEnabled(key,enabled){
  if(!(key in DEBUG_SYSTEMS))throw new Error('Sistema desconocido');
  if(this.disposed||this.pending.has(key))return false;
  enabled=!!enabled;if(this.state[key]===enabled)return true;
  if(key==='cars'&&!enabled&&this.game.driving?.car)throw new Error('Sal del vehículo antes de desactivar los carros');
  this.pending.add(key);this._notify();
  try {
   if(key==='effects'&&await this.game.prepareDebugEffects(enabled)===false)return false;
   if(this.disposed)return false;
   this.state[key]=enabled;this.sync();
   if(key==='cars'||key==='transit'){
    this.game.world?.active?.signals?.reservations?.clear();
    this.game.traffic?.physics?.bodies.clear();
    this.game.traffic?.setParkedCars?.(this.isEnabled('cars')?this.game.cars:[]);
    this.game.traffic?.setBus?.(this.isEnabled('transit')?this.game.world?.active?.busServices??[]:[]);
    this.game.audio?.suppressVehicles?.(key==='cars'?[...(this.game.cars??[]),...(this.game.traffic?.vehicles??[]).map(v=>v.car)]:this.game.world?.active?.busServices??[]);
    this.game._syncVehicleColliders?.();
   }
   if(key==='dog'&&!enabled)this.game.audio?.stopDog?.();
   if(key==='rain'){this.game.world?.active?.setWetness?.(enabled?this.game.weather?.wetness??0:0);if(!enabled)this.game.audio?.setRaining?.(false);}
   if(this.game.interaction?.currentTarget?.debugDisabled){this.game.interaction.currentTarget=null;this.game.interaction.currentTargetType=null;}
   return true;
  }finally{this.pending.delete(key);this._notify();}
 }
 async reset(){if(this.pending.size)throw new Error('Espera a que termine el cambio gráfico');for(const key of Object.keys(this.state))await this.setEnabled(key,true);}
 _roots(){
  const g=this.game,d=g.world?.active;
  return {cars:[...(g.cars??[]),...(g.traffic?.vehicles??[]).map(v=>v.car)],transit:d?.busServices??(d?.busService?[d.busService]:[]),pedestrians:(d?.npcs??[]).filter(n=>!n.isVendor),pigeons:d?.pigeonFlocks??[],dog:g.dog?[g.dog]:[],vegetation:d?.treeField?[d.treeField]:[],rain:g.weather?.rainParticles?[{group:g.weather.rainParticles}]:[]};
 }
 sync(){
  if(this.disposed)return;
  const g=this.game,d=g.world?.active;if(d)d.debugFlags=this.state;
  const required=new Set();
  for(const [key,owners] of Object.entries(this._roots()))for(const owner of owners){
   owner.debugDisabled=!this.isEnabled(key);
   const root=owner.group??owner.root;if(!root)continue;
   root.userData.debugDisabled=owner.debugDisabled;
   if(!owner.debugDisabled)continue;
   required.add(root);
   if(!this.gates.has(root)&&root.parent){
    const parent=root.parent,index=parent.children.indexOf(root),gate=new Group();gate.name=`DEV · ${key}`;gate.visible=false;
    parent.add(gate);gate.add(root);parent.children.splice(parent.children.indexOf(gate),1);parent.children.splice(index,0,gate);
    this.gates.set(root,{gate,parent,index});
   }
  }
  for(const [root,entry] of this.gates)if(!required.has(root))this._release(root,entry,!!root.parent&&!root.userData.debugDisposed);
  if(g.localLights)g.localLights.enabled=this.isEnabled('lights');
  if(g.sceneMgr?.atmosphere)g.sceneMgr.atmosphere.debugShadowsEnabled=this.isEnabled('shadows');
  if(g.audio)g.audio.debugDogEnabled=this.isEnabled('dog');
 }
 _release(root,{gate,parent,index},restore){
  // A removed/replaced entity must not be resurrected by restoring an old wrapper.
  const current=Object.values(this._roots()).flat().some(o=>(o.group??o.root)===root);
  if(root.parent===gate){gate.remove(root);if(restore&&current){parent.add(root);parent.children.splice(parent.children.indexOf(root),1);parent.children.splice(Math.min(index,parent.children.length),0,root);}}
  gate.removeFromParent();this.gates.delete(root);
 }
 counts(){return Object.fromEntries(Object.entries(this._roots()).filter(([key])=>key!=='rain').map(([key,owners])=>{const total=key==='pigeons'?owners.reduce((n,o)=>n+(o.birds?.length??0),0):key==='vegetation'?(this.game.world?.active?.treeSites?.length??owners.length):owners.length;return [key,{active:this.isEnabled(key)?total:0,total}];}));}
 dispose(){if(this.disposed)return;for(const key of Object.keys(this.state))this.state[key]=true;this.sync();if(this.game.renderer)this.game.renderer.effectsEnabled=true;this.listeners.clear();this.disposed=true;}
}
