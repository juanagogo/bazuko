import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { articulatedBus, ARTICULATED_BUS_SIZE } from '../src/world/bogota/ArticulatedBus.js';
import { BusService } from '../src/world/bogota/BusService.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

const service = (reverse = false) => new BusService({ x: 0, startZ: reverse ? -25 : 25, endZ: reverse ? 25 : -25, stationZ: 0, height: 0 });
function checkEnvelope(group) {
  group.updateMatrixWorld(true);
  // A rotated cylinder's AABB overestimates its corners. Inspect the actual
  // rendered vertices, including each instance, rather than that broad phase.
  const box=new THREE.Box3(),point=new THREE.Vector3(),instance=new THREE.Matrix4(),world=new THREE.Matrix4();
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<(mesh.isInstancedMesh?mesh.count:1);i++) {
      if(mesh.isInstancedMesh){mesh.getMatrixAt(i,instance);world.multiplyMatrices(mesh.matrixWorld,instance);}
      else world.copy(mesh.matrixWorld);
      for(let vertex=0;vertex<positions.count;vertex++)box.expandByPoint(point.fromBufferAttribute(positions,vertex).applyMatrix4(world));
    }
  });
  assert.ok(box.min.x >= -1.26 - 1e-6 && box.max.x <= 1.26 + 1e-6, `${box.min.x}…${box.max.x}`);
  assert.ok(box.min.z >= -9.1 - 1e-6 && box.max.z <= 9.1 + 1e-6, `${box.min.z}…${box.max.z}`);
  assert.ok(box.min.y >= -1e-6 && box.max.y <= 3.5 + 1e-6);
}

test('el articulado tiene tres ejes, puertas izquierdas y frente panorámico dentro de su OBB', () => {
  const group = articulatedBus(), visual = group.userData.busVisuals;
  assert.deepEqual(ARTICULATED_BUS_SIZE, { length: 18.2, width: 2.52 });
  assert.equal(visual.wheels.length, 6);
  assert.equal(new Set(visual.wheels.map(w => w.position.z)).size, 3);
  assert.equal(visual.doors.length, 4);
  assert.ok(visual.doors.every(door => door.leaves.length === 2 && door.leaves.every(leaf => leaf.position.x < 0)));
  let meshes = 0, triangles = 0;
  const front = [];
  group.traverse(o => {
    assert.ok(!o.isLight);
    if (!o.isMesh) return;
    meshes++; triangles += o.geometry.index.count / 3 * (o.isInstancedMesh ? o.count : 1);
    assert.equal(o.material.map, null, 'sin imágenes o atlas por bus');
    if (o.material.roughness !== .18) return;
    const p = o.geometry.attributes.position;
    for (let i=0;i<p.count;i++) if (p.getZ(i)<-8.6 && p.getY(i)>1.4 && p.getY(i)<2.9) front.push(p.getZ(i));
  });
  assert.ok(meshes <= 24, `${meshes} llamadas de color`);
  assert.ok(triangles <= 12000, `${triangles} triángulos con instancias`);
  assert.ok(Math.max(...front)-Math.min(...front)>.2, 'parabrisas curvo e inclinado, no una cara plana de caja');
  checkEnvelope(group);
  visual.dispose();
});

test('preload mantiene la misma promesa y todas las piezas animadas', async () => {
  const bus = service(), children = [...bus.group.children], wheels = [...bus.visuals.wheels];
  const promise = bus.preloadModel();
  assert.equal(bus.preloadModel(), promise);
  assert.equal(await promise, bus.group);
  assert.deepEqual(bus.group.children, children);
  assert.deepEqual(bus.group.userData.wheels, wheels);
  bus.dispose();
});

test('el vidrio opaco combina reflejo de cielo y detalles de cabina sin texturas o transparencia', () => {
  const group=articulatedBus();
  const glasses=[];
  group.traverse(mesh=>{if(mesh.isMesh && mesh.material.vertexColors)glasses.push(mesh);});
  assert.ok(glasses.length>=2,'parabrisas y puertas comparten el acabado');
  for(const mesh of glasses) {
    assert.equal(mesh.material.transparent,false);
    assert.equal(mesh.material.opacity,1);
    assert.equal(mesh.material.color.getHex(),0xffffff,'no oscurece dos veces el color de los vértices');
    assert.equal(mesh.material.map,null);
    const colors=mesh.geometry.attributes.color;
    assert.equal(colors.count,mesh.geometry.attributes.position.count);
    let min=Infinity,max=-Infinity;
    for(let i=0;i<colors.count;i++){min=Math.min(min,colors.getX(i));max=Math.max(max,colors.getX(i));}
    assert.ok(max-min>.15,'reflejo claro arriba y profundidad oscura abajo');
  }
  group.userData.busVisuals.dispose();
});

for (const reverse of [false, true]) test(`las puertas abren únicamente durante los cuatro segundos de estación (${reverse ? 'sur' : 'norte'})`, () => {
  const bus = service(reverse);
  let elapsed=0, arrivedAt=null, departedAt=null, maxOpening=0, moved=false;
  for(let frame=0;frame<1500;frame++) {
    const before=bus.position.z;
    bus.update(.02); elapsed+=.02;
    if(bus.dwellRemaining>0 && arrivedAt===null) arrivedAt=elapsed;
    if(bus.visuals.doorOpenFraction>0) {
      assert.equal(bus.position.z,0); assert.equal(bus.speed,0);
      assert.ok(bus.dwellRemaining>0);
      maxOpening=Math.max(maxOpening,bus.visuals.doorOpenFraction);
    }
    if(bus.position.z!==before) {
      moved=true;
      assert.equal(bus.visuals.doorOpenFraction,0,'jamás arranca con puertas abiertas');
      if(arrivedAt!==null && bus.direction*bus.position.z>0) {departedAt=elapsed;break;}
    }
  }
  assert.ok(moved && arrivedAt!==null && departedAt!==null);
  assert.equal(maxOpening,1);
  assert.ok(departedAt-arrivedAt>=3.99 && departedAt-arrivedAt<=4.07, `${departedAt-arrivedAt}s`);
  const collisions = new CollisionSystem(); collisions.setVehicles([],bus);
  assert.equal(collisions.dynamicColliders[0].obb.halfSize.z,9.1);
  assert.equal(collisions.dynamicColliders[0].obb.halfSize.x,1.26);
  bus.dispose();
});

test('rojo o peatón detienen el bus sin abrir las puertas; los frenos encienden las luces traseras', () => {
  for(const obstruction of ['signal','person']) {
    const bus=service();bus.position.z=12;bus.speed=5;
    bus.setNight(true);
    const cruising=bus.visuals.lights.tail.emissiveIntensity;
    const wheel=bus.visuals.wheels[0].quaternion.clone();
    if(obstruction==='signal')bus.signals={busClearance:()=>1};
    const context=obstruction==='person'?{player:new THREE.Vector3(0,0,1.1)}:{};
    bus.update(.05,context);
    assert.ok(bus.speed<5 && bus.speed>0, 'frenado gradual');
    assert.equal(bus.visuals.braking,true);
    assert.ok(bus.visuals.lights.tail.emissiveIntensity>cruising);
    assert.ok(!wheel.equals(bus.visuals.wheels[0].quaternion));
    for(let frame=0;frame<30;frame++)bus.update(.05,context);
    assert.equal(bus.visuals.doorOpenFraction,0);
    bus.dispose();
  }
});

test('puertas, ruedas y limpiaparabrisas conservan su envolvente animada y se congelan con dt cero', () => {
  const group=articulatedBus(),visual=group.userData.busVisuals;
  visual.setWeather({isRaining:true});
  for(let frame=0;frame<36;frame++) {
    visual.update(.05,{distance:.24,doorsOpen:frame<18,braking:true});
    checkEnvelope(group);
  }
  visual.update(.2,{doorsOpen:true});
  const opening=visual.doorOpenFraction,position=visual.doors[0].leaves[0].position.clone(),rotation=visual.wheels[0].quaternion.clone();
  const wiper=visual.wipers[0].quaternion.clone(),phase=visual.wiperPhase;
  visual.update(0,{distance:20,doorsOpen:false});
  assert.equal(visual.doorOpenFraction,opening);
  assert.ok(position.equals(visual.doors[0].leaves[0].position));
  assert.ok(rotation.equals(visual.wheels[0].quaternion));
  assert.ok(wiper.equals(visual.wipers[0].quaternion));assert.equal(visual.wiperPhase,phase);
  visual.dispose();
});

test('la lluvia barre el parabrisas durante la parada y termina el ciclo al volver a seco', () => {
  const bus=service();bus.position.z=0;bus.dwellRemaining=4;bus.servedStation=true;
  const rest=bus.visuals.wipers.map(w=>w.rotation.z);
  bus.update(.2);
  assert.deepEqual(bus.visuals.wipers.map(w=>w.rotation.z),rest);
  bus.setWeather({isRaining:true});bus.update(.3);
  assert.equal(bus.speed,0);assert.equal(bus.position.z,0);
  assert.ok(bus.visuals.wipers.every((w,i)=>w.rotation.z!==rest[i]));
  const phase=bus.visuals.wiperPhase;
  bus.update(0);assert.equal(bus.visuals.wiperPhase,phase);
  bus.setWeather({isRaining:false});
  assert.equal(bus.visuals.wiperPhase,phase,'no salta a reposo al cesar la lluvia');
  for(let i=0;i<30;i++)bus.update(.05);
  assert.equal(bus.visuals.wiperPhase,0);
  assert.deepEqual(bus.visuals.wipers.map(w=>w.rotation.z),rest);
  bus.update(.2);assert.deepEqual(bus.visuals.wipers.map(w=>w.rotation.z),rest);
  bus.dispose();
});

test('el desvanecimiento y la iluminación de un servicio no alteran el contrario', () => {
  const a=service(),b=service();
  const materialA=[...a.materials.keys()][0],materialB=[...b.materials.keys()][0];
  a.position.z=12;a._updateVisibility();
  assert.equal(materialA.opacity,1);assert.equal(materialB.opacity,0);
  a.setNight(true);
  assert.ok(a.visuals.lights.head.emissiveIntensity>b.visuals.lights.head.emissiveIntensity);
  a.position.z=24;a._updateVisibility();assert.ok(materialA.opacity>0 && materialA.opacity<1);
  a.position.z=12;a._updateVisibility();assert.equal(materialA.transparent,false);assert.equal(materialA.depthWrite,true);
  a.dispose();b.dispose();
});

test('dispose libera cada recurso una vez y retira el bus antes de la limpieza del distrito', () => {
  const parent=new THREE.Group(),bus=service(),other=service();parent.add(bus.group,other.group);
  const resources=new Set(),counts=new Map();
  bus.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});
  for(const resource of resources)resource.addEventListener('dispose',()=>counts.set(resource,(counts.get(resource)??0)+1));
  let disposedOther=false;[...other.materials.keys()][0].addEventListener('dispose',()=>{disposedOther=true;});
  bus.dispose();bus.dispose();
  assert.equal(bus.group.parent,null);assert.equal(bus.group.children.length,0);
  assert.ok([...resources].every(r=>counts.get(r)===1));
  parent.traverse(o=>{assert.ok(!resources.has(o.geometry));assert.ok(!resources.has(o.material));});
  assert.equal(disposedOther,false);
  other.dispose();
});
