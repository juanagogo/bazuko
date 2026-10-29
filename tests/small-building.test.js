import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildSmallBuilding,SMALL_BUILDING} from '../src/world/bogota/SmallBuilding.js';
import {Bogota} from '../src/world/districts/Bogota.js';
import {CollisionSystem} from '../src/systems/CollisionSystem.js';
import {busPathX,southBusPathX} from '../src/world/bogota/Colpatria.js';

test('el edificio ocupa el lugar indicado, bloquea su interior y deja libre el paso de ambos buses',()=>{
  const wallMap=new THREE.Texture(),wallBump=new THREE.Texture();
  const building=buildSmallBuilding({brickTextures:{map:wallMap,bumpMap:wallBump}}),bounds=new THREE.Box3().setFromObject(building);
  assert.ok(bounds.containsPoint(new THREE.Vector3(72.64,1,125.18)));
  assert.ok(bounds.max.y<=SMALL_BUILDING.height+.001);
  assert.ok(building.getObjectByName('Puerta'));
  const wall=building.getObjectByName('Cuerpo de cinco pisos');
  assert.equal(wall.material.map,wallMap);assert.equal(wall.material.bumpMap,wallBump);
  // Cada repetición contiene 24 hiladas de tolete de 12 cm: el material
  // mantiene su escala real sobre los 16 m de fachada, sin estirar ladrillos.
  const verticalUV=Array.from(wall.geometry.attributes.uv.array).filter((_,i)=>i%2===1);
  assert.ok(Math.abs(Math.max(...verticalUV)*24*.12-16)<.0001);
  assert.equal(SMALL_BUILDING.floors,5);
  assert.ok(bounds.max.y>16);
  assert.ok(bounds.max.x-bounds.min.x>12);
  assert.equal(building.children.some(o=>o.isLight),false);
  const city=new Bogota();city.map=city._layout();
  assert.equal(city.map[63][36],'smallBuilding');
  const collisions=new CollisionSystem();city._buildCollisions(city.map,collisions);
  assert.ok(collisions.colliders.some(({box})=>box.containsPoint(new THREE.Vector3(73,2,125))));
  assert.ok(!collisions.colliders.some(({box})=>box.containsPoint(new THREE.Vector3(73,17,125))));
  for(let z=111;z<=140;z+=.5) for(const path of [busPathX,southBusPathX]) {
    const lane=path===busPathX?78.5:71.5;
    assert.ok(!bounds.containsPoint(new THREE.Vector3(path(z,lane),7.82,z)));
  }
});
