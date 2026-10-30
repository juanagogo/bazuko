import {createSynthResources,createMotorVoice} from './SlopMotorSynthesis.js';
import {synthHorn,synthStarter} from './SlopCrashAudio.js';

// El donante sintetiza tres motores; las clases nuevas usan el más cercano por tamaño y peso.
// El carro que conduce el jugador suena un 30 % más que el tráfico a la misma distancia.
const PLAYER_GAIN=1.3;
const MOTOR_KIND={bus:'bus',suv:'suv',police_suv:'suv',pickup:'suv',van:'suv',minivan:'suv'};

/** Mono voices from the donor, mixed through the existing master volume and city acoustics. */
export class SlopMotorAudio {
 constructor(howler){this.howler=howler;this.voices=new Map();this.horns=new Set();this.paused=false;}
 get available(){return !!this.howler?.ctx?.createBuffer&&!!this.howler.masterGain;}
 _context(){const ctx=this.howler.ctx;if(!this.available||ctx.state!=='running')return null;if(!this.resources)this.resources=createSynthResources(ctx);return ctx;}
 update(dt,listener,vehicles,buses,gain){
  if(this.paused)return;
  const ctx=this._context();if(!ctx)return;
  const entries=[...vehicles,...[buses].flat().filter(Boolean).map(car=>({car,speed:car.speed??0,variant:'bus'}))];
  const near=entries.filter(v=>v.car.position.distanceTo(listener)<55).sort((a,b)=>a.car.position.distanceToSquared(listener)-b.car.position.distanceToSquared(listener)).slice(0,8);
  const occupied=near.find(v=>v.car.controller==='player');
  if(occupied){
   if(!this.wind){const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),output=ctx.createGain();source.buffer=this.resources.noise;source.loop=true;filter.type='lowpass';source.connect(filter).connect(output).connect(this.howler.masterGain);output.gain.value=0;source.start();this.wind={source,filter,output};}
   // Speed/exposure levels adapted from 09361be1 audio-events.js, without flying or stereo panners.
   const motion=Math.min(1,Math.abs(occupied.speed)/55),quiet=occupied.car._night ? .7 : 1;
   this.wind.output.gain.setTargetAtTime((.010*.35+motion*.012)*quiet,ctx.currentTime,.6);this.wind.filter.frequency.setTargetAtTime(1550+motion*700,ctx.currentTime,.8);
  }else this._stopWind();
  const keep=new Set(near.map(v=>v.car));for(const [car,state] of this.voices)if(!keep.has(car)){state.voice.dispose();state.output.disconnect();this.voices.delete(car);}
  for(const entry of near){const car=entry.car;let state=this.voices.get(car);
   if(!state){const output=ctx.createGain();output.gain.value=0;output.connect(this.howler.masterGain);const kind=entry.variant==='bus'?'bus':MOTOR_KIND[car.variant]??'sedan';state={output,voice:createMotorVoice(ctx,this.resources,kind,output)};this.voices.set(car,state);}
   const distance=car.position.distanceTo(listener);state.output.gain.setTargetAtTime(.28*(car.controller==='player'?PLAYER_GAIN:1)*Math.max(0,1-distance/55)*gain(car),ctx.currentTime,.08);
   state.voice.update({speed:entry.speed??0,load:entry.load??Math.max(0,Math.min(1,(entry.acceleration??0)/2)),seed:car.visualSeed??0});
  }
 }
 /** Motor de arranque al subir: el ralentí sigue con la voz normal del carro. */
 starter(car,volume=.5*PLAYER_GAIN){const ctx=this._context();if(!ctx||this.paused)return;const output=ctx.createGain(),source=ctx.createBufferSource();source.buffer=this.starterBuffer??=synthStarter(ctx,(car?.visualSeed??3)+11);output.gain.value=volume;source.connect(output);output.connect(this.howler.masterGain);source.vehicle=car;this.horns.add(source);source.onended=()=>{this.horns.delete(source);source.disconnect();output.disconnect();};source.start();}
 honk(car,volume=.45){const ctx=this._context();if(!ctx||this.paused)return;const output=ctx.createGain(),source=ctx.createBufferSource();source.buffer=this.horn??=synthHorn(ctx,.55,17);output.gain.value=volume;source.connect(output);output.connect(this.howler.masterGain);source.vehicle=car;this.horns.add(source);source.onended=()=>{source.disconnect();output.disconnect();this.horns.delete(source);};source.start();
 }
 suppress(cars){const removed=new Set(cars);for(const car of removed){const state=this.voices.get(car);if(state){state.voice.dispose();state.output.disconnect();this.voices.delete(car);}}for(const source of [...this.horns])if(removed.has(source.vehicle)){source.stop();source.onended?.();}}
 setPaused(value){this.paused=value;if(value)this.clear();}
 _stopWind(){if(this.wind){this.wind.source.stop();this.wind.source.disconnect();this.wind.filter.disconnect();this.wind.output.disconnect();this.wind=null;}}
 clear(){this._stopWind();for(const state of this.voices.values()){state.voice.dispose();state.output.disconnect();}this.voices.clear();for(const source of [...this.horns]){source.stop();source.onended?.();}this.horns.clear();}
}
