import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SurfaceMaterials} from '../src/graphics/SurfaceMaterials.js';
import {BuildingVisibility} from '../src/world/bogota/BuildingVisibility.js';
test('los materiales TSL comparten recursos y conservan clima, opacidad y límites',()=>{
 const bank=new SurfaceMaterials(),source=new THREE.MeshStandardMaterial({color:'#895634',roughness:.9});const scene=new THREE.Scene();
 const a=new THREE.Mesh(new THREE.BoxGeometry(3,8,4),source),b=new THREE.Mesh(a.geometry,source);b.position.x=10;scene.add(a,b);const bounds=new THREE.Box3().setFromObject(scene);
 bank.apply(scene,new Map([[source,'road']]));assert.equal(a.material,b.material);assert.equal(a.material.isNodeMaterial,true);assert.ok(a.material.roughnessNode);assert.ok(bounds.equals(new THREE.Box3().setFromObject(scene)));
 source.roughness=.45;source.opacity=.3;source.transparent=true;assert.equal(a.material.roughness,.45);assert.equal(a.material.opacity,.3);assert.equal(a.material.transparent,true);assert.equal(a.material.color,source.color);
 const wall=source.clone();bank.apply(new THREE.Mesh(a.geometry,wall));wall.opacity=.8;assert.equal(a.material.opacity,.3);bank.dispose();assert.equal(bank.resources.size,0);
});

test('ocultar paredes usa opacidad sin cambiar la estructura del pipeline TSL',()=>{
 const bank=new SurfaceMaterials(),source=new THREE.MeshStandardMaterial();source.userData.visibilityFade=true;
 const material=bank.convert(source),version=material.version,visibility=new BuildingVisibility();
 const part={object:new THREE.Group(),materials:[source],opacity:1,clearTime:1};
 visibility._fade(part,true,.1);assert.ok(material.opacity<1);assert.equal(material.transparent,false);assert.equal(material.depthWrite,true);assert.equal(material.alphaHash,true);
 visibility._fade(part,false,1);assert.equal(material.opacity,1);assert.equal(material.version,version);bank.dispose();
});
test('el recorte del cabello conserva alfa y profundidad al migrar a TSL',()=>{
 const bank=new SurfaceMaterials(),map=new THREE.Texture(),source=new THREE.MeshStandardMaterial({map,alphaTest:.08,transparent:false,depthWrite:true,side:THREE.DoubleSide});
 const hair=bank.convert(source);assert.equal(hair.alphaTest,.08);assert.equal(hair.depthWrite,true);assert.equal(hair.transparent,false);assert.equal(hair.side,THREE.DoubleSide);assert.equal(hair.map,map);bank.dispose();map.dispose();
});
