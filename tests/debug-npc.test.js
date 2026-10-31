import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import * as real from '../src/character/RealisticCharacter.js';
let release,disposed=0;
mock.module('../src/character/RealisticCharacter.js',{namedExports:{...real,createRealisticCharacter:()=>new Promise(r=>release=r)}});
const {Npc}=await import('../src/entities/Npc.js');
test('un detalle que termina tarde no revive un peatón desactivado y puede reintentarse',async()=>{
 const npc={look:{}};const p=Npc.prototype._loadFull.call(npc);npc.debugDisabled=true;release({dispose(){disposed++;}});await p;assert.equal(disposed,1);assert.equal(npc.fullChar,undefined);assert.equal(npc._fullLoading,null);
 npc.debugDisabled=false;const next=Npc.prototype._loadFull.call(npc),character={};release(character);await next;assert.equal(npc.fullChar,character);
});
