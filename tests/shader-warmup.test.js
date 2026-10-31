import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SurfaceMaterials} from '../src/graphics/SurfaceMaterials.js';
import {collectShaderWarmupJobs,compileShaderJobs,materialShaderKey,withoutFrustumCulling} from '../src/core/ShaderWarmup.js';
test('seis mil paredes con colores y opacidad propios preparan una familia, no seis mil shaders',()=>{
 const scene=new THREE.Group(),bank=new SurfaceMaterials(),geometry=new THREE.BoxGeometry();
 let first;
 for(let i=0;i<6000;i++){const source=new THREE.MeshStandardMaterial({color:i%2?'#8e583f':'#c1b9a4',roughness:.8});source.opacity=.4+i%4*.1;const mesh=new THREE.Mesh(geometry,source);scene.add(mesh);}
 bank.apply(scene);first=scene.children[0].material;
 assert.equal(scene.children[5999].material.colorNode,first.colorNode);
 assert.notEqual(scene.children[5999].material,first);
 const result=collectShaderWarmupJobs([scene]);assert.equal(result.objects,6000);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].length,6000);assert.equal(bank.graphs.size,1);
 scene.children[0].material.opacity=.2;assert.notEqual(scene.children[5999].material.opacity,.2);bank.dispose();
});
test('la preparación distingue texturas activas, transparencia, geometría y esqueletos',()=>{
 const root=new THREE.Group(),g=new THREE.BoxGeometry(),plain=new THREE.MeshStandardMaterial(),mapped=new THREE.MeshStandardMaterial({map:new THREE.Texture()});
 const a=new THREE.Mesh(g,plain),b=new THREE.Mesh(g,plain.clone()),c=new THREE.Mesh(g,mapped),d=new THREE.Mesh(g,plain.clone());d.material.transparent=true;root.add(a,b,c,d);
 assert.equal(collectShaderWarmupJobs([root]).jobs.length,3);
 const otherMap=mapped.clone();otherMap.map=new THREE.Texture();assert.equal(materialShaderKey(mapped),materialShaderKey(otherMap));otherMap.map.wrapS=THREE.RepeatWrapping;assert.notEqual(materialShaderKey(mapped),materialShaderKey(otherMap));
 const skinned=new THREE.SkinnedMesh(g,plain);skinned.skeleton={bones:[{},{}]};root.add(skinned);assert.equal(collectShaderWarmupJobs([root]).jobs.length,4);
});
test('un fallo detiene nuevas preparaciones y espera las que ya estaban en vuelo',async()=>{
 let running=0,max=0,started=0,ended=0;
 await assert.rejects(compileShaderJobs(Array.from({length:100},(_,i)=>i),async i=>{started++;running++;max=Math.max(max,running);await new Promise(r=>setTimeout(r,2));running--;ended++;if(i===0)throw new Error('GPU failure');},{concurrency:4,yieldTask:async()=>{}}),/GPU failure/);
 assert.ok(max<=4);assert.equal(running,0);assert.equal(started,ended);assert.ok(started<=4);
});

test('el calentamiento cubre objetos fuera de camara y restaura incluso ante fallo',async()=>{
 const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());root.add(mesh);mesh.visible=false;
 await assert.rejects(withoutFrustumCulling([root],async()=>{assert.equal(mesh.frustumCulled,false);assert.equal(mesh.visible,false);throw new Error('lost');}),/lost/);
 assert.equal(mesh.frustumCulled,true);assert.equal(mesh.visible,false);
});
