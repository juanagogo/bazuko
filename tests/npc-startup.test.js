import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Npc,NPC_LOD,npcShaderCoverage,npcShaderVariants} from '../src/entities/Npc.js';
test('la carga inicial puede preparar solo el LOD y mantiene el detalle completo por defecto',async()=>{
 let full=0;const npc={ready:Promise.resolve(),_loadFull:async()=>full++};await Npc.prototype.preload.call(npc,{full:false});assert.equal(full,0);await Npc.prototype.preload.call(npc);assert.equal(full,1);
});
test('el detalle completo se solicita una vez antes del primer plano y conserva la histéresis',()=>{
 let requested=0,shown;const lod={},full={};const npc={lodChar:lod,fullChar:null,_fullLoading:null,_loadFull(){requested++;return this._fullLoading=Promise.resolve();},_show(c){shown=c;}};
 Npc.prototype._updateDetail.call(npc,100);assert.equal(requested,0);assert.equal(shown,lod);Npc.prototype._updateDetail.call(npc,NPC_LOD.prefetch-1);Npc.prototype._updateDetail.call(npc,6);assert.equal(requested,1);assert.equal(shown,lod);
 npc.fullChar=full;Npc.prototype._updateDetail.call(npc,6);assert.equal(shown,full);Npc.prototype._updateDetail.call(npc,8);assert.equal(shown,full);Npc.prototype._updateDetail.call(npc,11);assert.equal(shown,lod);
});
test('un NPC cercano fuera de cámara precarga sin animarse',()=>{
 let requested=0,animated=0;const npc={position:new THREE.Vector3(5,0,0),root:new THREE.Group(),character:{update(){animated++;}},lodChar:{},fullChar:null,_fullLoading:null,_loadFull(){requested++;return this._fullLoading=Promise.resolve();},_updateDetail:Npc.prototype._updateDetail,_show(){},_walk(){},animAcc:0,splatTimer:0};
 // Reacciones, frases y paraguas llegaron con la integración; aquí no intervienen.
 Object.assign(npc,{_updateReaction(){},_updateSpeech(){},_updateUmbrella(){},_applyPose(){}});
 Npc.prototype.update.call(npc,1/60,{player:new THREE.Vector3(),frustum:{intersectsSphere:()=>false}});
 assert.equal(requested,1);assert.equal(animated,0);assert.equal(npc.root.visible,false);
});
test('la carga elige pocos NPC que cubren todas las variantes de shader pendientes',()=>{
 const npc=(sexo,edad,pelo,ropa,calzado,barba='ninguna')=>({look:{real:{sexo,edad,pelo,ropa,calzado,barba}}});
 const near=npc('hombre','adulto','corto','saco','tenis');
 const a=npc('hombre','adulto','corto','saco','tenis'),b=npc('mujer','joven','cola','short','botas'),c=npc('mujer','joven','cola','short','tenis'),d=npc('hombre','mayor','corto','saco','tenis','larga'),e={look:null};
 const chosen=npcShaderCoverage([a,b,c,d,e],[near]);
 assert.deepEqual(chosen,[b,d,c]);
 assert.deepEqual(npcShaderVariants(d.look),['cuerpo:hombre:mayor','pelo:hombre:corto','barba:hombre:larga','ropa:hombre:saco','calzado:hombre:tenis']);
 assert.deepEqual(npcShaderCoverage([a],[near]),[]);
});
