import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CITY_WIDTH, CITY_HEIGHT, ORIGINAL_CITY_WIDTH, ORIGINAL_CITY_HEIGHT,
  CITY_AREA_MULTIPLIER, CITY_CARRERAS, CITY_CALLES, EXTENSION_PARKS, expandCity } from '../src/world/bogota/CityLayout.js';
import { migrateStreetPosition } from '../src/world/bogota/StreetLayout.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { FrustumCulling } from '../src/core/FrustumCulling.js';

// La construcción completa usa geometría real; solo Canvas y GLB se sustituyen.
const textureSet=()=>({map:new THREE.Texture(),bumpMap:new THREE.Texture(),emissiveMap:new THREE.Texture()});
const replacements={...textures};
for(const name of ['asphalt','sidewalk','brick','facade','roofTiles','slab','cardboard','trashBag','dirt','concrete']) replacements[name]=textureSet;
for(const name of ['radialSprite','lightbox','neon']) replacements[name]=()=>new THREE.Texture();
mock.module('../src/world/bogota/textures.js',{namedExports:replacements});
mock.module('../src/utils/signs.js',{namedExports:{signTexture:()=>new THREE.Texture()}});
mock.module('../src/character/RealisticCharacter.js',{namedExports:{
  REALISTIC_SCALE:1.08,createRealisticCharacter:async()=>({group:new THREE.Group(),update(){}}),
  loadCatalog:async()=>({}),normalizeReal:(_,look)=>look,optionsFor:()=>[{id:'test'}]
}});
const { Bogota }=await import('../src/world/districts/Bogota.js');

test('la ciudad añade el parque del lago a la ampliación de tres veces la superficie y conserva el interior original sin desplazarlo',()=>{
  const center=Array.from({length:ORIGINAL_CITY_HEIGHT},(_,z)=>Array.from({length:ORIGINAL_CITY_WIDTH},(_,x)=>
    x===0||z===0||x===ORIGINAL_CITY_WIDTH-1||z===ORIGINAL_CITY_HEIGHT-1?'wall':`original-${x}-${z}`));
  const map=expandCity(center);
  assert.equal(map.length*map[0].length,CITY_WIDTH*CITY_HEIGHT);
  assert.equal(CITY_AREA_MULTIPLIER, CITY_WIDTH * CITY_HEIGHT / (ORIGINAL_CITY_WIDTH * ORIGINAL_CITY_HEIGHT));
  assert.ok(CITY_AREA_MULTIPLIER > 3);
  for(let z=1;z<ORIGINAL_CITY_HEIGHT-1;z++) for(let x=1;x<ORIGINAL_CITY_WIDTH-1;x++) {
    // La nueva curva del viaducto puede reservar suelo junto al extremo sur de la troncal.
    if ((z >= 35 && x >= 33 && x <= 66) || (z <= 7 && x >= 27 && x <= 48)) continue;
    assert.equal(map[z][x],center[z][x]);
  }
  for(const version of [2,3]) {
    const saved=[141,.04,104];
    assert.deepEqual(migrateStreetPosition(saved,version),saved);
  }
});

test('los barrios nuevos son accesibles a pie y los cruces conectan toda la red peatonal',()=>{
  const city=new Bogota();
  city.map=city._layout();
  city.reserved={shop:{x:104,z:69}};
  const nav=city._createPedestrianNavigation();
  const start=nav.nearestPoint(54,23);
  const visited=new Set([nav.nodeAt(start.x,start.z)]),queue=[...visited];
  for(let head=0;head<queue.length;head++) for(const next of nav.nodes[queue[head]].neighbors) {
    if(!visited.has(next)){visited.add(next);queue.push(next);}
  }
  let reached=0;
  for(let i=0;i<nav.nodes.length;i++) {
    const node=nav.nodes[i];
    if(node.x<ORIGINAL_CITY_WIDTH-1 && node.z<ORIGINAL_CITY_HEIGHT-1) continue;
    assert.ok(visited.has(i),`zona aislada: ${node.x},${node.z}`);
    reached++;
  }
  assert.ok(reached>1500);
  for(const park of EXTENSION_PARKS) assert.equal(city.map[park.z0+2][park.x0+2],'grass');
  for(const [a,b] of CITY_CARRERAS) assert.equal(b-a+1,6);
  for(const [a,b] of CITY_CALLES) assert.equal(b-a+1,6);
  for(let x=0;x<CITY_WIDTH;x++) {
    assert.equal(city.map[CITY_HEIGHT-1][x],'wall');
    assert.equal(city.map[0][x] === 'wall', x < 27 || x > 48);
  }
  for(let z=0;z<CITY_HEIGHT;z++) assert.equal(city.map[z][0]+city.map[z][CITY_WIDTH-1],'wallwall');
});

test('el distrito completo construye y actualiza barrios, vendedores, peatones y bus sin perder colisiones',async()=>{
  const scene=new THREE.Scene(),city=new Bogota(),collisions=new CollisionSystem();
  city.build(scene,collisions);
  assert.equal(city.stationGroup.name, 'Estación Portal del Centro');
  assert.equal(city.busServices.length, 2);
  try {
    await Promise.all(city.npcs.map(npc=>npc.ready));
    assert.equal(city.npcs.length,76); // 66 peatones, 6 vendedores, el bailarín y sus 3 acompañantes.
    assert.equal(city.vendors.length,6);
    assert.equal(city.pigeonFlocks.length, 3);
    for (const flock of city.pigeonFlocks) {
      assert.equal(flock.birds.length, 10);
      for (const bird of flock.birds) {
        const type = city.map[Math.round(bird.position.z / 2)][Math.round(bird.position.x / 2)];
        assert.ok(['grass', 'plaza'].includes(type));
      }
    }
    assert.equal(city.getTrafficRoutes().length,6);
    let separateMeshes = 0;
    for (const building of city.buildingVisibility.buildings) for (const part of building.parts) {
      part.object.traverse(o => { if (o.isMesh) separateMeshes++; });
    }
    let batchedMeshes = 0;
    city.buildingVisibility.closedView.traverse(o => { if (o.isMesh) batchedMeshes++; });
    assert.ok(batchedMeshes < separateMeshes * .75);
    assert.ok(city.getSpawnGrid().some(point=>point.x>ORIGINAL_CITY_WIDTH*2));
    assert.ok(city.getSpawnGrid().some(point=>point.z>ORIGINAL_CITY_HEIGHT*2));
    assert.ok(collisions.colliders.some(({box})=>box.min.x>ORIGINAL_CITY_WIDTH*2));
    assert.ok(collisions.colliders.some(({box})=>box.min.z>ORIGINAL_CITY_HEIGHT*2));
    assert.ok(city.busService.startZ>ORIGINAL_CITY_HEIGHT*2);
    for(const point of Object.values(city.reserved)) assert.ok(city.isWalkableAt(point.x,point.z));
    assert.deepEqual(city.reserved.bed, { x: 112.98, z: 94.64 });
    assert.deepEqual(city.reserved.respawn, { x: 112.98, z: 97.84 });
    assert.deepEqual(city.reserved.spawn, city.reserved.respawn);
    const camera=new THREE.PerspectiveCamera(55,1,.1,500);
    camera.userData.cameraMode='isometric';
    camera.position.set(185,20,120);
    camera.lookAt(170,0,100);
    const before=city.busService.position.z;
    city.update(.1,new THREE.Vector3(170,0,100),camera);
    assert.ok(city.busService.position.z < before); // Sale desde el parque, antes de llegar a los cruces urbanos.
    city.t = 25;
    city.update(.1,new THREE.Vector3(170,0,100),camera);
    assert.ok(city.busService.position.z<before);
    const culling = new FrustumCulling();
    for (const sector of city.renderSectors) culling.register(sector);
    for (const mode of ['third-person', 'isometric']) {
      camera.userData.cameraMode = mode;
      city.update(.1, new THREE.Vector3(170,0,100), camera);
      culling.apply(camera);
      assert.ok(culling.stats.culled > 0);
      assert.ok(culling.stats.visible > 0);
      assert.equal(city.buildingVisibility.closedView.visible, mode === 'third-person');
      culling.restore();
      assert.ok(city.renderSectors.every(sector => sector.visible));
    }
    city.setNightMode(true);
    // Todas las casas comparten un único material de fachada; su variación va en los vértices.
    const houseFacades = new Set(), facadeMeshes = [];
    city.buildingVisibility.closedView.traverse(mesh=>{ if (mesh.material?.userData.cityFacade) { facadeMeshes.push(mesh); houseFacades.add(mesh.material); } });
    assert.ok(facadeMeshes.length > 0);
    assert.equal(houseFacades.size, 1);
    assert.ok(facadeMeshes.every(mesh=>mesh.geometry.attributes.facadeParams && mesh.geometry.attributes.facadeTone));
    city.setNightMode(false);
  } finally { city.dispose(scene); }
  assert.ok(!scene.children.includes(city.group));
});
