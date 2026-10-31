// Period-integrated facade filtering adapted from Slop New York 09361be1 tsl-materials.js (MIT).
import {Fn,float,floor,fract,clamp,max,fwidth,positionWorld,normalWorld,abs,step,mix,vec3,materialColor,mx_noise_float} from 'three/tsl';
import {cityUniforms} from './GraphicsState.js';
export const filteredPulse=Fn(([x,a,b,w])=>{
 const p=float(x).toVar(),lo=float(a).toVar(),hi=float(b).toVar(),hw=max(float(w),.0001).mul(.5).toVar();
 const integral=t=>floor(t).mul(hi.sub(lo)).add(clamp(fract(t),lo,hi).sub(lo));
 return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2));
});
const along=mix(positionWorld.x,positionWorld.z,step(.5,abs(normalWorld.x)));
const cell=along.div(3),floorY=positionWorld.y.div(3.2);
const pulse=(v,a,b)=>filteredPulse(fract(v),a,b,fwidth(v));
export const facadeWindow=pulse(cell,.20,.80).mul(pulse(floorY,.22,.83));
const frame=pulse(cell,.17,.83).mul(pulse(floorY,.19,.86));
const brickY=positionWorld.y.div(.12),brickX=along.div(.36).add(floor(brickY).mod(2).mul(.5));
const brick=pulse(brickX,.025,.975).mul(pulse(brickY,.05,.95));
const wall=materialColor.rgb.mul(mix(.65,1,brick));
const glass=mix(vec3(.025,.045,.065),vec3(.08,.12,.15),fract(floorY));
export const facadeColor=mix(mix(wall,vec3(.48,.47,.43),frame),glass,facadeWindow);
const occupied=step(.18,mx_noise_float(vec3(floor(cell),floor(floorY),0)).mul(.5).add(.5));
export const facadeGlow=vec3(1,.65,.30).mul(facadeWindow).mul(occupied).mul(cityUniforms.lightsOn).mul(.8);
