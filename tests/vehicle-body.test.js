import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle, PUBLIC_PLATES, PRIVATE_PLATES, CAR_MODEL_IDS } from '../src/world/bogota/vehicles.js';
import { CAR_MODELS } from '../src/world/bogota/carModels.js';
import { RECT, ATLAS_SIZE, ATLAS_HEIGHT, getCarAtlas } from '../src/world/bogota/carAtlas.js';
import { OPTICS } from '../src/world/bogota/carLamps.js';
import { Car } from '../src/entities/Car.js';

const meshes = vehicle => { const result=[]; vehicle.group.traverse(o=>{if(o.isMesh)result.push(o);}); return result; };
const physicalBounds = vehicle => {
  const bounds=new THREE.Box3(); vehicle.group.updateMatrixWorld(true);
  vehicle.group.traverse(o=>{
    if(!o.isMesh||o.userData.vehicleGlow)return;
    o.geometry.computeBoundingBox(); bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return bounds;
};
const FLEET = Object.freeze({
  // [largo, ancho, alto, batalla, radio de rueda]: cada modelo conserva las proporciones de lo que imita.
  citadino:[3.64,1.60,1.52,2.38,.29], sedanPopular:[4.35,1.73,1.52,2.63,.30], hatchPopular:[4.06,1.73,1.55,2.59,.31],
  sedanDeportivo:[4.46,1.79,1.44,2.70,.32], suv:[4.34,1.82,1.68,2.67,.34], pickup:[5.30,1.85,1.80,3.08,.39],
  cajaSetentera:[3.67,1.51,1.55,2.44,.29], sedanNoventero:[4.20,1.65,1.40,2.47,.29], furgon:[4.05,1.60,1.90,2.70,.30], buseta:[7.6,2.3,3.0,4.0,.46],
});

test('cada modelo tiene sus medidas, su silueta y el primer Mesh contractual', () => {
  assert.deepEqual([...CAR_MODEL_IDS].sort(),Object.keys(FLEET).sort());
  const shapes=[];
  for(const id of CAR_MODEL_IDS) {
    const v=makeVehicle('carro',1,{beams:false,model:id}), [L,W,H,wb,r]=FLEET[id];
    assert.equal(v.model,id); assert.equal(v.length,L); assert.equal(v.width,W);
    assert.equal(v.wheelbase,wb); assert.equal(v.wheelRadius,r);
    assert.equal(v.group.children[0],v.bodyVisual); assert.ok(v.bodyVisual.isMesh); assert.equal(v.visualManaged,true);
    const bounds=physicalBounds(v);
    assert.ok(bounds.min.x>=-L/2-.08&&bounds.max.x<=L/2+.08,`${id}: largo ${bounds.min.x}…${bounds.max.x}`);
    // Solo estribos, molduras de arco y espejos sobresalen de la chapa.
    assert.ok(bounds.min.z>=-W/2-.09&&bounds.max.z<=W/2+.09,`${id}: ancho ${bounds.max.z}`);
    assert.ok(bounds.min.y>=-.001&&bounds.max.y<H+.35,`${id}: alto ${bounds.max.y}`);
    shapes.push(v.bodyVisual.geometry.attributes.position.array);
    v.dispose();
  }
  for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++)assert.notDeepEqual(shapes[i],shapes[j]);
});

test('los pasos de rueda son vacíos reales de la carrocería, con forro oscuro y no neumáticos incrustados', () => {
  for(const id of CAR_MODEL_IDS) {
    const v=makeVehicle('carro',1,{beams:false,model:id}), spec=CAR_MODELS[id]; v.group.updateMatrixWorld(true);
    for(const axle of [spec.axleF,spec.axleR])for(const y of [spec.r,spec.r+.12,spec.archY+spec.archR-.04]) {
      const ray=new THREE.Raycaster(new THREE.Vector3(axle,y,3),new THREE.Vector3(0,0,-1));
      assert.equal(ray.intersectObject(v.bodyVisual,false).length,0,`${id}: esmalte dentro del paso en ${axle},${y}`);
      // Sin las llantas, lo primero que se encuentra es el forro del fondo, hondo y no en la cara del costado.
      const liner=ray.intersectObject(v.bodyVisual.children.find(c=>c.name==='Molduras e interior'),false)[0];
      assert.ok(liner&&liner.point.z<spec.W/2-.2,`${id}: forro poco hondo en ${axle},${y}: ${liner?.point.z}`);
    }
    const x=(spec.axleF+spec.axleR)/2;
    const bodyRay=new THREE.Raycaster(new THREE.Vector3(x,spec.bottomMid+.25,3),new THREE.Vector3(0,0,-1));
    assert.ok(bodyRay.intersectObject(v.bodyVisual,false).length>0,`${id}: el panel entre ruedas sigue siendo sólido`);
    const roofRay=new THREE.Raycaster(new THREE.Vector3(spec.windshield[0]-.5,5,0),new THREE.Vector3(0,-1,0));
    assert.ok(roofRay.intersectObject(v.bodyVisual,false)[0]?.point.y>spec.H*.92,`${id}: techo visible con normales exteriores`);
    v.dispose();
  }
});

test('el platón de la camioneta está abierto: hay piso por dentro y no una tapa', () => {
  const v=makeVehicle('carro',1,{beams:false,model:'pickup'}), spec=CAR_MODELS.pickup; v.group.updateMatrixWorld(true);
  const hit=new THREE.Raycaster(new THREE.Vector3(-1.7,5,0),new THREE.Vector3(0,-1,0)).intersectObject(v.group,true)[0];
  assert.ok(hit.point.y<spec.top[3][1]-.3,`piso del platón a ${hit.point.y}`);
  v.dispose();
});

test('dirección y rodadura tienen ejes independientes; el vidrio y las sombras respetan su función', () => {
  const v=makeVehicle('taxi',1,{beams:false});
  assert.equal(v.wheels.length,4); assert.equal(v.frontWheelPivots.length,2);
  for(const pivot of v.frontWheelPivots) {
    const wheel=pivot.children[0]; assert.ok(v.wheels.includes(wheel));
    assert.equal(wheel.userData.radius,v.wheelRadius); assert.ok(wheel.castShadow);
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

test('cada vehículo completo, con conductor y espejos, cabe en el presupuesto de geometría y llamadas', () => {
  const fleet=[...CAR_MODEL_IDS.map(id=>['carro',id]),['taxi','citadino'],['taxi','sedanPopular'],['police','sedanPopular'],['police','suv'],['buseta','buseta']];
  for(const [kind,model] of fleet) {
    const car=new Car(new THREE.Scene(),new THREE.Vector3(),0,{kind,model,traffic:true,variant:1}), v=car.vehicle;
    let calls=0,triangles=0;
    car.group.traverse(o=>{
      if(!o.isMesh||o===car.marker)return;
      calls++;
      triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
      for(const attr of Object.values(o.geometry.attributes))assert.ok(attr.array.every(Number.isFinite),`${model}: valor no finito en ${o.name}`);
    });
    assert.ok(calls<=14,`${kind}/${v.model}: ${calls} llamadas`);
    assert.ok(triangles<=7000,`${kind}/${v.model}: ${triangles} triángulos`);
    car.dispose();
  }
});

test('la flota se construye rápido y comparte toda su geometría', () => {
  const t0=performance.now();
  const fleet=CAR_MODEL_IDS.map(model=>makeVehicle('carro',7,{model}));
  const elapsed=performance.now()-t0;
  // El presupuesto es para la flota entera en frío; si otra prueba ya la calentó, solo puede bajar.
  assert.ok(elapsed<150,`flota en ${elapsed.toFixed(0)} ms`);
  const twin=makeVehicle('carro',9,{model:fleet[0].model,beams:false});
  assert.equal(twin.bodyVisual.geometry,fleet[0].bodyVisual.geometry);
  assert.equal(twin.wheels[0].geometry,fleet[0].wheels[0].geometry);
  assert.equal(twin.wipers[0].children[0].geometry,fleet[0].wipers[0].children[0].geometry);
  for(const v of [...fleet,twin])v.dispose();
});

test('la mezcla de particulares y los colores siguen lo que se ve en la calle', () => {
  const count={},colors={};
  for(let seed=0;seed<2000;seed++) {
    const v=makeVehicle('carro',seed,{beams:false});
    count[v.model]=(count[v.model]??0)+1;
    const hex=v.wetMaterials[0].color.getHexString(); colors[hex]=(colors[hex]??0)+1;
    v.dispose();
  }
  assert.equal(count.buseta,undefined,'la buseta no entra en los particulares');
  for(const [id,share] of [['citadino',18],['sedanPopular',18],['hatchPopular',14],['suv',14],['sedanDeportivo',12],['sedanNoventero',8],['pickup',6],['furgon',5],['cajaSetentera',5]])
    assert.ok(Math.abs(count[id]/20-share)<4,`${id}: ${(count[id]/20).toFixed(1)} %`);
  const neutral=['cdd0d0','b6bbc0','7e8388','1b1d20'].reduce((sum,hex)=>sum+(colors[new THREE.Color(`#${hex}`).getHexString()]??0),0);
  assert.ok(neutral/2000>.5,'dominan blanco, plata, gris y negro');
  assert.equal(makeVehicle('taxi',4,{beams:false}).wetMaterials[0].color.getHexString(),new THREE.Color('#e8b321').getHexString());
  assert.ok(['citadino','sedanPopular'].includes(makeVehicle('taxi',4,{beams:false}).model));
  assert.ok(['sedanPopular','suv'].includes(makeVehicle('police',5,{beams:false}).model));
});

test('frenos, direccionales, lluvia y patrulla se animan por instancia; dispose es idempotente y no toca lo compartido', () => {
  const first=makeVehicle('police',0),second=makeVehicle('police',0);
  assert.notEqual(first.tailMat,second.tailMat);
  assert.notEqual(first.signalMaterials.left,second.signalMaterials.left);
  assert.notEqual(first.policeLights.blue,second.policeLights.blue);
  assert.notEqual(first.wetMaterials[0],second.wetMaterials[0]);
  assert.notEqual(first.wetMaterials[1],second.wetMaterials[1]);
  const intensity=second.signalMaterials.left.emissiveIntensity;
  first.signalMaterials.left.emissiveIntensity=3; assert.equal(second.signalMaterials.left.emissiveIntensity,intensity);
  assert.equal(first.wheels[0].geometry,second.wheels[0].geometry);
  const events={body:0,paint:0,sharedWheel:0,atlas:0};
  first.bodyVisual.geometry.addEventListener('dispose',()=>events.body++);
  first.wetMaterials[0].addEventListener('dispose',()=>events.paint++);
  first.wheels[0].geometry.addEventListener('dispose',()=>events.sharedWheel++);
  getCarAtlas().addEventListener('dispose',()=>events.atlas++);
  first.dispose(); first.dispose();
  assert.deepEqual(events,{body:0,paint:1,sharedWheel:0,atlas:0});
  second.dispose();
});

test('un solo atlas acotado para los distintivos y con español legible en placas locales', () => {
  assert.ok(PUBLIC_PLATES.some(plate=>plate.city==='BOGOTÁ D.C.'));
  for(const plate of [...PUBLIC_PLATES,...PRIVATE_PLATES])assert.doesNotMatch(plate.city,/[├┬�]/);
  assert.equal(getCarAtlas().colorSpace,THREE.SRGBColorSpace);
  for(const [name,[x,y,w,h]] of [...Object.entries(RECT),...Object.values(OPTICS).map(o=>[o.name,o.rect])])assert.ok(x>=0&&y>=0&&x+w<=ATLAS_SIZE&&y+h<=ATLAS_HEIGHT,name);
  const taxi=makeVehicle('taxi',1,{beams:false}),other=makeVehicle('carro',3,{beams:false});
  const lamps=meshes(taxi).find(mesh=>mesh.name==='Lámparas y placas');
  assert.equal(lamps.material.map,meshes(other).find(mesh=>mesh.name==='Lámparas y placas').material.map);
  assert.ok(lamps.geometry.attributes.uv.array.every(n=>n>=0&&n<=1));
  taxi.dispose(); other.dispose();
});
