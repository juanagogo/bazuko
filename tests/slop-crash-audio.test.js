import test from 'node:test';
import assert from 'node:assert/strict';
import {SlopCrashAudio} from '../src/vehicles/SlopCrashAudio.js';

function context(){
 const buffers=[],sources=[];
 const node=()=>({connect(){},disconnect(){this.disconnected=true;},gain:{value:0}});
 return {buffers,sources,state:'running',sampleRate:8000,currentTime:1,
  createBuffer(channels,length,rate){const data=new Float32Array(length),b={duration:length/rate,getChannelData:()=>data};buffers.push(b);return b;},
  createGain:node,
  createBufferSource(){const s={...node(),playbackRate:{value:1},start(){},stop(){this.onended?.();}};sources.push(s);return s;}
 };
}
test('sintetiza y comparte los impactos del donante; limita contactos repetidos y libera voces',()=>{
 const ctx=context(),audio=new SlopCrashAudio({ctx,masterGain:{}},()=>({x:0,y:0,z:0}));
 assert.equal(audio.prepare(),true);assert.equal(ctx.buffers.length,9);audio.prepare();assert.equal(ctx.buffers.length,9);
 for(const b of ctx.buffers){const data=b.getChannelData(0);assert.ok(data.every(Number.isFinite));assert.ok(data.some(x=>Math.abs(x)>.1));assert.ok(data.at(-1)===0);}
 // Deferred onended, matching actual AudioContext rather than ending at scheduling time.
 ctx.createBufferSource=()=>{const s={connect(){},disconnect(){},playbackRate:{value:1},start(){},stop(){}};ctx.sources.push(s);return s;};
 const a={},b={},hit={a,b,x:0,y:0,z:0,speed:15};
 assert.equal(audio.play(hit),true);assert.equal(audio.play({...hit,a:b,b:a}),false);assert.equal(audio.voices.size,1);
 ctx.currentTime+=.4;assert.equal(audio.play(hit),true);assert.equal(audio.voices.size,2);
 audio.stop();assert.equal(audio.voices.size,0);
});
test('los choques respetan silencio, pausa del contexto y distancia',()=>{
 const ctx=context();let muted=true;const audio=new SlopCrashAudio({ctx,masterGain:{}},()=>({x:0,y:0,z:0}),()=>muted),hit={a:{},b:{},x:0,y:0,z:0,speed:12};
 assert.equal(audio.play(hit),false);muted=false;ctx.state='suspended';assert.equal(audio.play(hit),false);
 ctx.state='running';assert.equal(audio.play({...hit,x:200}),false);assert.equal(audio.play({...hit,speed:.2}),false);assert.equal(ctx.sources.length,0);
});
test('el arranque gira el motor y prende con un golpe grave sin valores inválidos',async()=>{
 const {synthStarter}=await import('../src/vehicles/SlopCrashAudio.js');
 const ctx=context(),buffer=synthStarter(ctx,4),data=buffer.getChannelData(0);
 assert.ok(buffer.duration>1&&buffer.duration<1.3);
 assert.ok(data.every(Number.isFinite));assert.ok(data.some(x=>Math.abs(x)>.1));assert.equal(data.at(-1),0);
 const rms=(a,b)=>{let s=0;for(let i=a;i<b;i++)s+=data[i]*data[i];return Math.sqrt(s/(b-a));};
 assert.ok(rms(0,800)>.01,'el motor de arranque suena desde el principio');
});
