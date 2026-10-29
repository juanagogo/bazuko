import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle, PUBLIC_PLATES, PRIVATE_PLATES } from '../src/world/bogota/vehicles.js';

const meshes = vehicle => { const result=[]; vehicle.group.traverse(o=>{if(o.isMesh)result.push(o);}); return result; };
const physicalBounds = vehicle => {
  const bounds=new THREE.Box3(); vehicle.group.updateMatrixWorld(true);
  vehicle.group.traverse(o=>{
    if(!o.isMesh||o.userData.vehicleGlow)return;
    o.geometry.computeBoundingBox(); bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return bounds;
};

test('cuatro perfiles distintos conservan la huella del tráfico y el primer Mesh contractual', () => {
  const shapes=[];
  for(const [seed,model] of ['zapatico','huevito','amigofiel','sedan'].entries()) {
    const v=makeVehicle('carro',seed,{beams:false});
    assert.equal(v.model,model); assert.equal(v.length,4.3); assert.equal(v.width,1.76);
    assert.equal(v.group.children[0],v.bodyVisual); assert.ok(v.bodyVisual.isMesh);
    assert.equal(v.visualManaged,true); assert.equal(v.wheelbase,2.66);
    const bounds=physicalBounds(v);
    assert.ok(bounds.min.x>=-2.151&&bounds.max.x<=2.151);
    assert.ok(bounds.min.z>=-.90&&bounds.max.z<=.90,'solo manijas sobresalen levemente de la chapa');
    assert.ok(bounds.min.y>=-.001&&bounds.max.y<1.8);
    shapes.push(v.bodyVisual.geometry.attributes.position.array);
    v.dispose();
  }
  for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++)assert.notDeepEqual(shapes[i],shapes[j]);
});

test('los pasos de rueda son vacíos reales de la carrocería, no neumáticos incrustados', () => {
  for(let seed=0;seed<4;seed++) {
    const v=makeVehicle('carro',seed,{beams:false}); v.group.updateMatrixWorld(true);
    for(const axle of [-1.33,1.33])for(const y of [.33,.52,.64]) {
      const ray=new THREE.Raycaster(new THREE.Vector3(axle,y,2),new THREE.Vector3(0,0,-1));
      assert.equal(ray.intersectObject(v.bodyVisual,false).length,0,`${v.model}: hueco cerrado en ${axle},${y}`);
    }
    const bodyRay=new THREE.Raycaster(new THREE.Vector3(0,.70,2),new THREE.Vector3(0,0,-1));
    assert.ok(bodyRay.intersectObject(v.bodyVisual,false).length>0,'el panel entre ruedas sigue siendo sólido');
    const roofRay=new THREE.Raycaster(new THREE.Vector3(-.45,3,0),new THREE.Vector3(0,-1,0));
    assert.ok(roofRay.intersectObject(v.bodyVisual,false)[0]?.point.y>1.4,'techo visible con normales exteriores');
    v.dispose();
  }
});

test('dirección y rodadura tienen ejes independientes; el vidrio y las sombras respetan su función', () => {
  const v=makeVehicle('taxi',1,{beams:false});
  assert.equal(v.wheels.length,4); assert.equal(v.frontWheelPivots.length,2);
  for(const pivot of v.frontWheelPivots) {
    const wheel=pivot.children[0]; assert.ok(v.wheels.includes(wheel));
    assert.equal(wheel.userData.radius,.33); assert.ok(wheel.castShadow);
    pivot.rotation.y=.3; wheel.rotation.z=-2;
    assert.equal(pivot.rotation.z,0); assert.equal(wheel.rotation.y,0);
  }
  for(const wheel of v.wheels.slice(2))assert.equal(wheel.parent.rotation.y,0);
  const glass=meshes(v).find(mesh=>mesh.material===v.wetMaterials[1]);
  assert.equal(glass.castShadow,false); assert.ok(glass.material.transparent&&glass.material.opacity>.5);
  assert.equal(glass.material.depthWrite,false);
  let lights=0;v.group.traverse(o=>{if(o.isLight)lights++;});assert.equal(lights,0);
  assert.equal(v.wipers.length,2);
  for(const wiper of v.wipers) {
    assert.equal(wiper.parent.parent,v.bodyVisual); assert.ok(wiper.userData.sweepAngle>0);
    assert.equal(wiper.rotation.z,wiper.userData.restAngle);
  }
  v.dispose();
});

test('el agrupado mantiene cada vehículo dentro del presupuesto de geometría y llamadas', () => {
  for(const [kind,seed] of [['carro',0],['carro',1],['carro',2],['carro',3],['taxi',0],['taxi',1],['police',0],['buseta',0]]) {
    const v=makeVehicle(kind,seed); let calls=0,triangles=0;
    v.group.traverse(o=>{
      if(o.isSprite)calls++;
      if(!o.isMesh)return;
      calls+=Array.isArray(o.material)?o.material.length:1;
      triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
      for(const attr of Object.values(o.geometry.attributes))assert.ok(attr.array.every(Number.isFinite));
    });
    assert.ok(calls<=22,`${kind}/${v.model}: ${calls} llamadas`);
    assert.ok(triangles<4000,`${kind}/${v.model}: ${triangles} triángulos`);
    if(kind==='buseta'){assert.equal(v.length,7.6);assert.equal(v.width,2.3);}
    v.dispose();
  }
});

test('frenos, direccionales, lluvia y patrulla se animan por instancia; dispose es idempotente', () => {
  const first=makeVehicle('police',0),second=makeVehicle('police',0);
  assert.notEqual(first.tailMat,second.tailMat);
  assert.notEqual(first.signalMaterials.left,second.signalMaterials.left);
  assert.notEqual(first.policeLights.blue,second.policeLights.blue);
  assert.notEqual(first.wetMaterials[0],second.wetMaterials[0]);
  assert.notEqual(first.wetMaterials[1],second.wetMaterials[1]);
  const intensity=second.signalMaterials.left.emissiveIntensity;
  first.signalMaterials.left.emissiveIntensity=3; assert.equal(second.signalMaterials.left.emissiveIntensity,intensity);
  assert.equal(first.wheels[0].geometry,second.wheels[0].geometry);
  const events={body:0,paint:0,sharedWheel:0,labels:0};
  first.bodyVisual.geometry.addEventListener('dispose',()=>events.body++);
  first.wetMaterials[0].addEventListener('dispose',()=>events.paint++);
  first.wheels[0].geometry.addEventListener('dispose',()=>events.sharedWheel++);
  const map=meshes(first).find(mesh=>mesh.material.map?.userData.labelRects)?.material.map;
  map.addEventListener('dispose',()=>events.labels++);
  first.dispose(); first.dispose();
  assert.deepEqual(events,{body:1,paint:1,sharedWheel:0,labels:0});
  second.dispose();
});

test('los distintivos comparten atlas acotados y conservan español legible en placas locales', () => {
  assert.ok(PUBLIC_PLATES.some(plate=>plate.city==='BOGOTÁ D.C.'));
  for(const plate of [...PUBLIC_PLATES,...PRIVATE_PLATES])assert.doesNotMatch(plate.city,/[├┬�]/);
  const taxi=makeVehicle('taxi',1,{beams:false});
  const labels=meshes(taxi).find(mesh=>mesh.material.map?.userData.labelRects);
  const atlas=labels.material.map;
  assert.equal(atlas.colorSpace,THREE.SRGBColorSpace);
  assert.deepEqual(Object.keys(atlas.userData.labelRects),['plate','grille','door','roof','sign']);
  for(const [x,y,w,h] of Object.values(atlas.userData.labelRects))assert.ok(x>=0&&y>=0&&x+w<=512&&y+h<=512);
  assert.ok(labels.geometry.attributes.uv.array.every(n=>n>=0&&n<=1));
  taxi.dispose();
});
