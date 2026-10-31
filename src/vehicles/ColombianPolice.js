import * as THREE from 'three';
import {attribute,abs,step,mix,vec2,vec3,texture,clamp,floor} from 'three/tsl';
let label;
function policeLabel(){
 if(label)return label;
 if(typeof document==='undefined')return label=new THREE.DataTexture(new Uint8Array([255,255,255,0]),1,1);
 const c=document.createElement('canvas');c.width=1024;c.height=256;const x=c.getContext('2d');
 x.clearRect(0,0,1024,256);x.fillStyle='#082b55';x.font='bold 150px Arial';x.textAlign='center';x.fillText('POLICÍA',540,180);
 x.fillStyle='#ffdf00';x.fillRect(5,70,110,55);x.fillStyle='#003b9b';x.fillRect(5,125,110,28);x.fillStyle='#d32226';x.fillRect(5,153,110,28);
 x.strokeStyle='#12613d';x.lineWidth=12;x.beginPath();x.arc(945,128,48,0,Math.PI*2);x.stroke();
 label=new THREE.CanvasTexture(c);label.colorSpace=THREE.SRGBColorSpace;return label;
}
export function colombianPoliceMaterial(mat){
 const p=attribute('position','vec3'),body=step(abs(attribute('partId','float')),0.25),side=step(.75,abs(p.x));
 const white=vec3(.88,.91,.92),blue=vec3(.008,.035,.12),lime=vec3(.55,.85,.015);
 const upper=step(1.12,p.y),checker= floor(p.z.mul(4)).add(floor(p.y.mul(7))).mod(2);
 const stripe=step(1.06,p.y).mul(step(p.y,1.34)).mul(side);
 let paint=mix(white,blue,upper);paint=mix(paint,mix(blue,lime,checker),stripe);
 const front=step(2.2,p.z).mul(step(p.y,.92));paint=mix(paint,lime,front);
 const rear=step(p.z,-2.45).mul(step(.6,p.y)).mul(step(p.y,1.1));
 const chevron=floor(p.x.abs().add(p.y).mul(8)).mod(2);paint=mix(paint,mix(vec3(.85,.02,.015),lime,chevron),rear);
 const uv=vec2(clamp(p.z.negate().add(.8).div(2),0,1),clamp(p.y.sub(.58).div(.45),0,1));
 const decal=texture(policeLabel(),uv);const area=side.mul(step(-1.2,p.z)).mul(step(p.z,.8)).mul(step(.58,p.y)).mul(step(p.y,1.03));
 paint=mix(paint,decal.rgb,decal.a.mul(area));mat.colorNode=mix(mat.colorNode,paint,body);return mat;
}
