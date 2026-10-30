import {createWebGPURenderer,initializeWebGPU} from '/src/core/WebGPU.js';
import * as THREE from 'three/webgpu';
import {Car} from '/src/entities/Car.js';
import {switchVehicleVisuals} from '/src/vehicles/switchVehicleVisuals.js';
import {VEHICLE_TYPES} from '/src/vehicles/VehicleTypes.js';
import {syncVehicleBatches} from '/src/vehicles/VehicleBatches.js';
const renderer=createWebGPURenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);await initializeWebGPU(renderer);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.1,150);
const ambient=new THREE.HemisphereLight('#c9e6ff','#5b5144',2.4);scene.add(ambient);const sun=new THREE.DirectionalLight('#fff0d5',3.2);sun.position.set(8,15,4);sun.castShadow=true;scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#303338',roughness:.9}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
for(let x=-20;x<24;x+=4){const line=new THREE.Mesh(new THREE.PlaneGeometry(2,.08),new THREE.MeshBasicMaterial({color:'#dfc570'}));line.rotation.x=-Math.PI/2;line.position.set(x,.005,0);scene.add(line);}
const variants=new URLSearchParams(location.search).has('fleet')?Object.keys(VEHICLE_TYPES):['sedan','taxi'];
if(variants.length>2)document.querySelector('h1').textContent='BAZUKO · parque automotor';
const cars=variants.map((variant,i)=>new Car(scene,new THREE.Vector3(0,0,(i-(variants.length-1)/2)*5),0,{traffic:true,variant}));cars[0].visualSeed=3;
let mode='slop',night=false,moving=false,view='third',frames=[],measuring=false,previous=performance.now();const stats=document.getElementById('stats');
function cam(){camera.position.set(...(variants.length>2?(view==='iso'?[22,28,26]:[23,10,25]):(view==='iso'?[10,14,12]:[9,3.6,10])));camera.lookAt(0,.7,0);}cam();
async function choose(next){for(const b of document.querySelectorAll('button'))b.disabled=true;try{await switchVehicleVisuals(cars,next);mode=next;frames=[];}catch(e){stats.textContent=e.message;console.error(e);}finally{for(const b of document.querySelectorAll('button'))b.disabled=false;}}
for(const m of ['actual','slop'])document.getElementById(m).onclick=()=>choose(m);
function light(value){night=value;ambient.intensity=value?.35:2.4;sun.intensity=value?.5:3.2;scene.background=new THREE.Color(value?'#09101b':'#a9bfcd');for(const c of cars)c.setNight(value);}light(false);
document.getElementById('day').onclick=()=>light(false);document.getElementById('night').onclick=()=>light(true);
for(const v of ['iso','third'])document.getElementById(v).onclick=()=>{view=v;cam();};document.getElementById('move').onclick=()=>{moving=!moving;};document.getElementById('bench').onclick=()=>{frames=[];measuring=true;};
await choose('slop');
function frame(now){const dt=Math.min(.05,(now-previous)/1000),ms=now-previous;previous=now;for(const c of cars){c.animateDrive(moving?dt*3:0,false);}syncVehicleBatches(scene,camera);renderer.info.reset();renderer.render(scene,camera);if(measuring){frames.push(ms);if(frames.length>=240){measuring=false;const sorted=[...frames].sort((a,b)=>a-b);stats.textContent=`${mode} · ${night?'noche':'día'} · ${view} · ${innerWidth}×${innerHeight} DPR 1\n240 cuadros: media ${(frames.reduce((a,b)=>a+b)/frames.length).toFixed(2)} ms · p95 ${sorted[228].toFixed(2)} ms\nDibujos ${renderer.info.render.calls} · triángulos ${renderer.info.render.triangles}`;}}else if(!frames.length)stats.textContent=`${mode} · ${night?'noche':'día'} · ${view}\nDibujos ${renderer.info.render.calls} · triángulos ${renderer.info.render.triangles}`;requestAnimationFrame(frame);}requestAnimationFrame(frame);
