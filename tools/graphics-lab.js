import {SurfaceMaterials} from '/src/graphics/SurfaceMaterials.js';
import * as THREE from 'three/webgpu';
import {Renderer} from '/src/core/Renderer.js';
import {SceneManager} from '/src/core/Scene.js';
import {Car} from '/src/entities/Car.js';
const status=document.getElementById('status');
try{
const start=performance.now(),renderer=new Renderer(document.querySelector('canvas'));await renderer.initialize();renderer.setQuality('alta',false);renderer.instance.setPixelRatio(1);renderer.instance.setSize(innerWidth,innerHeight);
const world=new SceneManager();world.scene.environment=renderer.createEnvironment();world.initializeAtmosphere(renderer.instance);world.wetness=.6;
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,250);let hour=18,iso=false,moving=false,quality='alta';
const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#363c40',roughness:.25,metalness:.2}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;world.scene.add(ground);
for(let i=0;i<8;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(8,8+i*2,10),new THREE.MeshStandardMaterial({color:i%2?'#9d6146':'#d2c1a4',roughness:.8}));m.position.set((i%2?1:-1)*13,(8+i*2)/2,Math.floor(i/2)*15-20);m.castShadow=m.receiveShadow=true;world.scene.add(m);}
const cars=[new Car(world.scene,new THREE.Vector3(0,.02,-2.5),0,{traffic:true}),new Car(world.scene,new THREE.Vector3(0,.02,2.5),0,{traffic:true})];cars[0].modelKind='car1';cars[1].modelKind='car2';await Promise.all(cars.map(c=>c.preloadModel()));
let measure=[],measuring=false,prev=performance.now(),first=true;const controls=document.getElementById('controls');
function button(name,fn){const b=document.createElement('button');b.textContent=name;b.onclick=fn;controls.append(b);}
function configure(){camera.position.set(...(iso?[18,25,22]:[10,4,12]));camera.lookAt(0,1,0);world.setTimeOfDay(hour);world.setQuality(quality);renderer.setQuality(quality,false);renderer.instance.setPixelRatio(1);cars.forEach(c=>c.setNight(hour<6||hour>19));}
for(const [n,h] of [['Día',13],['Atardecer',18],['Noche',23]])button(n,()=>{hour=h;configure();});
button('Lluvia',()=>{world.wetness=world.wetness?0:.8;configure();});button('Cámara',()=>{iso=!iso;configure();});button('Movimiento',()=>moving=!moving);
for(const q of ['baja','media','alta'])button(q,()=>{quality=q;configure();});button('Medir 300 cuadros',()=>{measure=[];measuring=true;});
button('Actuales / nuevos',async()=>{const mode=cars[0].visualMode==='slop'?'actual':'slop';await Promise.all(cars.map(c=>c.setVisualMode(mode)));});configure();const surfaces=new SurfaceMaterials();surfaces.apply(world.scene,new Map([[ground.material,'road']]));await renderer.prepare(world.scene,camera);
const load=performance.now()-start;let result='';function frame(now){const ms=now-prev;prev=now;cars.forEach(c=>c.animateDrive(moving?Math.min(ms/1000,.05)*3:0,false));renderer.hour=hour;world.followTarget(camera.position);renderer.render(world.scene,camera,null,[world.sun]);if(first){first=false;status.textContent='WebGPU listo';}
if(measuring){measure.push(ms);if(measure.length===300){measuring=false;const sorted=[...measure].sort((a,b)=>a-b);result=`Media ${(measure.reduce((a,b)=>a+b)/300).toFixed(2)} ms · p95 ${sorted[284].toFixed(2)} · p99 ${sorted[296].toFixed(2)}`;}}
const info=renderer.instance.info.render;status.textContent=`WebGPU · ${quality} · ${hour}:00 · humedad ${world.wetness} · ${innerWidth}×${innerHeight} DPR 1\nCarga hasta shaders: ${load.toFixed(0)} ms\nDibujos ${info.drawCalls} · triángulos ${info.triangles}\n${measuring?'Midiendo… '+measure.length+'/300':result}`;requestAnimationFrame(frame);}requestAnimationFrame(frame);
}catch(e){status.textContent=e.stack;console.error(e);}
