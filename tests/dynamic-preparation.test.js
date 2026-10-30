import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer} from '../src/core/Renderer.js';
test('compilar detalle mantiene el MRT hasta terminar y los cuadros intermedios dibujan en pantalla',async()=>{
 let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b;}),root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));
 let target='screen',mrt=null,calls=0,draws=0;
 const renderer=Object.assign(Object.create(Renderer.prototype),{quality:'alta',resolution:{pressure:0},instance:{_renderContexts:{get(target,mrt,depth=0){return {target,mrt,depth};}},backend:{isWebGPUBackend:true},shadowMap:{enabled:false},info:{reset(){}},initTexture(){},getRenderTarget:()=>target,getMRT:()=>mrt,setRenderTarget:t=>target=t,setMRT:t=>mrt=t,compileAsync(){calls++;assert.equal(root.children[0].frustumCulled,false);return pending;}},pipeline:{scenePass:{renderTarget:'scene',getMRT:()=> 'mrt'},render(){draws++;assert.equal(target,'screen');assert.equal(mrt,null);}},culling:{apply(){},restore(){}},_ensurePipeline(){}});
 const task=renderer.prepareDynamic(root,new THREE.Scene(),new THREE.PerspectiveCamera());
 await new Promise(r=>setImmediate(r));assert.equal(renderer.compilingDynamic,true);
 // compileAsync construye los nodos tras su primer await y lee getMRT() entonces.
 assert.equal(target,'scene');assert.equal(mrt,'mrt');
 renderer.render(new THREE.Scene(),new THREE.PerspectiveCamera());assert.equal(draws,1);assert.equal(target,'scene','el cuadro devuelve el destino de la compilación');assert.equal(mrt,'mrt');
 reject(new Error('device lost'));await assert.rejects(task,/device lost/);assert.equal(target,'screen');assert.equal(mrt,null);assert.equal(renderer.compilingDynamic,false);assert.equal(root.children[0].frustumCulled,true);
 renderer._disposed=true;await renderer.prepareDynamic(root);assert.equal(calls,1);
});
test('detalle desactivado mientras espera la cola no compila ni sube recursos',async()=>{
 let release,compiled=0;const renderer=Object.assign(Object.create(Renderer.prototype),{_dynamicQueue:new Promise(r=>release=r),instance:{compileAsync(){compiled++;}}});let active=true;
 const task=renderer.prepareDynamic(new THREE.Group(),null,null,()=>{},()=>active);active=false;release();assert.equal(await task,false);assert.equal(compiled,0);
});
