import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareSceneTextures,resizeTexture,textureAssetKey,tagAssetTextures} from '../src/core/TextureBudget.js';
const canvas=(w,h)=>({width:w,height:h,getContext:()=>({drawImage(){}})});

test('WebP glTF comparte texturas entre cuerpos y LOD sin confundir espacios de color',async()=>{
 const scene=new THREE.Group();
 for(const path of ['/models/personaje/hombre-adulto/','/models/personaje/mujer-adulta/lod/']){
  const texture=new THREE.Texture({width:1024,height:1024}),material=new THREE.MeshStandardMaterial({map:texture}),root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
  const uri=path.includes('/lod/')?'../../texturas/brown_eye.webp':'../texturas/brown_eye.webp';
  tagAssetTextures({scene:root,parser:{associations:new Map([[texture,{textures:0}]]),json:{textures:[{extensions:{EXT_texture_webp:{source:0}}}],images:[{uri}]},options:{path}}});
  assert.equal(texture.userData.assetUrl,'/models/personaje/texturas/brown_eye.webp');scene.add(root);
 }
 const report=await prepareSceneTextures([scene],{assets:new Map(),makeCanvas:canvas,yieldTask:async()=>{}});
 assert.equal(report.textures.size,1);assert.equal(report.reused,1);
 assert.equal(scene.children[0].children[0].material.map,scene.children[1].children[0].material.map);
});
test('las imágenes grandes se reducen conservando proporción, orientación y espacio de color',()=>{
 const t=new THREE.Texture({width:4096,height:2048});t.flipY=false;t.colorSpace=THREE.SRGBColorSpace;assert.equal(resizeTexture(t,1024,canvas),true);assert.equal(t.image.width,1024);assert.equal(t.image.height,512);assert.equal(t.flipY,false);assert.equal(t.colorSpace,THREE.SRGBColorSpace);assert.equal(resizeTexture(t,1024,canvas),false);
 const data=new THREE.DataTexture(new Uint8Array(16),2,2);assert.equal(resizeTexture(data,1,canvas),false);
});
test('el mismo recurso de ropa comparte textura, pero no mezcla color, UV o imágenes diferentes',async()=>{
 const scene=new THREE.Group(),a=new THREE.Texture({width:4096,height:4096}),b=new THREE.Texture({width:4096,height:4096}),c=b.clone();
 a.userData.assetUrl=b.userData.assetUrl=c.userData.assetUrl='/models/personaje/texturas/normal.webp';c.colorSpace=THREE.SRGBColorSpace;
 const materials=[a,b,c].map(map=>new THREE.MeshStandardMaterial({normalMap:map}));materials.forEach(m=>scene.add(new THREE.Mesh(new THREE.BoxGeometry(),m)));
 const result=await prepareSceneTextures([scene],{assets:new Map(),makeCanvas:canvas,yieldTask:async()=>{}});assert.equal(result.textures.size,2);assert.equal(result.reused,1);assert.equal(result.resized,2);assert.equal(materials[0].normalMap,materials[1].normalMap);assert.notEqual(materials[0].normalMap,materials[2].normalMap);
 const different=a.clone();different.repeat.x=2;assert.notEqual(textureAssetKey(a),textureAssetKey(different));different.userData.assetUrl='/models/other.webp';assert.notEqual(textureAssetKey(a),textureAssetKey(different));
});
