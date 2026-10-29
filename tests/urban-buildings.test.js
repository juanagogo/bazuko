import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {planUrbanBuildings,buildUrbanBuilding,URBAN_DESIGNS} from '../src/world/bogota/UrbanBuildings.js';
import {BuildingVisibility} from '../src/world/bogota/BuildingVisibility.js';
import {Bogota} from '../src/world/districts/Bogota.js';
import {CollisionSystem} from '../src/systems/CollisionSystem.js';

const palette=()=>({facades:URBAN_DESIGNS.map(()=>new THREE.MeshStandardMaterial({map:new THREE.Texture(),emissiveMap:new THREE.Texture()})),...Object.fromEntries(['roof','interior','concrete','trim','rail','glass'].map(k=>[k,new THREE.MeshStandardMaterial()]))});

test('los nuevos edificios se distribuyen por la ciudad, de 3 a 30 pisos y sin ocupar calles o hitos',()=>{
  const map=new Bogota()._layout(),before=JSON.stringify(map),lots=planUrbanBuildings(map),occupied=new Set();
  assert.deepEqual(lots,planUrbanBuildings(map));
  assert.equal(JSON.stringify(map),before);
  assert.ok(lots.length>=18);
  assert.equal(Math.min(...lots.map(p=>p.floors)),3);assert.equal(Math.max(...lots.map(p=>p.floors)),30);
  assert.equal(new Set(lots.map(p=>p.design)).size,5);
  assert.ok(new Set(lots.map(p=>Math.floor(p.x/80)+','+Math.floor(p.z/80))).size>=7);
  for(const p of lots) {
    assert.ok(p.width>=8);if(p.floors>12)assert.ok(p.width>=12);
    for(let dz=0;dz<p.tiles;dz++)for(let dx=0;dx<p.tiles;dx++) {
      const x=p.tileX+dx,z=p.tileZ+dz,key=x+','+z;
      assert.equal(map[z][x],'building');assert.ok(!occupied.has(key));occupied.add(key);
    }
  }
});

test('los cinco diseños respetan su solar y su altura, comparten texturas y usan el sistema de ocultación',()=>{
  const base=planUrbanBuildings(new Bogota()._layout()).find(p=>p.floors===30),materials=palette();
  const counts=new Set();
  for(const design of URBAN_DESIGNS) {
    const p={...base,design},shell=buildUrbanBuilding(p,materials),bounds=new THREE.Box3().setFromObject(shell.root);
    assert.ok(Math.abs(bounds.max.y-p.height)<.001);
    assert.ok(bounds.min.x>=p.x-p.width/2-.2&&bounds.max.x<=p.x+p.width/2+.2);
    assert.ok(bounds.min.z>=p.z-p.depth/2-.2&&bounds.max.z<=p.z+p.depth/2+.2);
    let triangles=0,meshes=0;
    shell.root.traverse(o=>{assert.ok(!o.isLight);if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
    assert.ok(triangles<9000, `${design}: ${triangles} triángulos`);counts.add(meshes);
    const visibility=new BuildingVisibility(),building=visibility.register(shell);
    assert.ok(building.bounds.max.y>=p.height);
    assert.equal(building.parts.length,5);
    assert.ok(visibility.buildClosedView().children.length>0);
  }
  assert.ok(counts.size>=3,'los diseños deben variar su geometría');
});

test('las colisiones de los edificios nuevos alcanzan todos sus pisos sin extenderse a las calles',()=>{
  const city=new Bogota();city.map=city._layout();const collisions=new CollisionSystem();city._buildCollisions(city.map,collisions);
  for(const p of planUrbanBuildings(city.map)) {
    const box=collisions.colliders.find(({box})=>box.containsPoint(new THREE.Vector3(p.x,p.height-.1,p.z)))?.box;
    assert.ok(box,`falta colisión de ${p.floors} pisos`);
    assert.equal(box.min.x,p.x-p.width/2);assert.equal(box.max.x,p.x+p.width/2);
    assert.equal(box.max.y,p.height);
  }
});
