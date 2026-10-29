import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { BusService } from '../src/world/bogota/BusService.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { CARACAS } from '../src/world/bogota/StreetLayout.js';

test('el bus completo recorre la troncal sin invadir estación, separadores, andenes ni muros', () => {
  const city = new Bogota(), map = city._layout(), route = city.getBusRoute();
  const stationX = (CARACAS.busway[0] + CARACAS.busway[1]);
  const bus = new BusService(route);
  assert.ok(route.x - bus.width / 2 > stationX + 1.6);
  assert.ok(route.x + bus.width / 2 < CARACAS.busway[1] * 2 + 1 - 0.15);
  for(let z=route.endZ;z<=route.startZ;z+=0.1) {
    bus.position.z = z; bus._alignToGround();
    const heading = bus.heading;
    for(let along=-bus.length/2;along<=bus.length/2;along+=0.5) for(const side of [-bus.width/2,0,bus.width/2]) {
      const x = bus.position.x + heading.x * along - heading.z * side;
      const wz = z + heading.z * along + heading.x * side;
      const tile=wz < 0 && x >= 60 && x <= 90 && wz >= -74 ? 'busway' : map[Math.round(wz/2)]?.[Math.round(x/2)];
      assert.ok(['road','busway'].includes(tile) || (tile==='grass' && viaductSurface(x,wz)!==null), `${x},${wz}: ${tile}`);
    }
  }
  city.group.add(bus.group);
  city._mergeStatic();
  assert.equal(bus.group.parent,city.group);
  assert.equal(bus.group.userData.wheels.length,6);
});

test('el servicio avanza, para cuatro segundos en la estación y repite el recorrido sin giro brusco visible', () => {
  const city=new Bogota(), bus=new BusService({ ...city.getBusRoute(), stationZ: 49 });
  const orientation=bus.group.quaternion.clone(), wheel=bus.group.userData.wheels[0].quaternion.clone();
  let dwellSeconds=0, arrived=false, departed=false, relayed=false;
  for(let i=0;i<2400;i++) {
    const before=bus.position.z;
    bus.update(0.05);
    if(bus.dwellRemaining>0) {
      arrived=true;
      dwellSeconds+=0.05;
      assert.equal(bus.position.z,bus.stationZ);
      assert.equal(bus.speed,0);
    }
    if(arrived && bus.position.z<bus.stationZ-1) departed=true;
    assert.ok(Math.abs(bus.group.rotation.y) < 1.1);
    assert.equal(bus.group.rotation.z, 0);
    assert.ok(Math.abs(bus.group.rotation.x) < .35);
    if(bus.position.z>before) {
      assert.equal(bus.group.visible,false);
      assert.equal(bus.materials.keys().next().value.opacity,0);
      relayed=true;
      break;
    }
    assert.ok(before-bus.position.z<=5*0.05+1e-8);
  }
  assert.ok(arrived && departed && relayed);
  assert.ok(dwellSeconds>=3.95 && dwellSeconds<=4.1);
  assert.ok(!bus.group.userData.wheels[0].quaternion.equals(wheel));
});

test('sin estación el bus cruza la antigua parada sin frenar ni esperar', () => {
  const bus = new BusService({ ...new Bogota().getBusRoute(), stationZ: null });
  assert.equal(bus.stationZ, null);
  bus.position.z = 65; bus._alignToGround(); bus.speed = 5;
  for (let i = 0; i < 150; i++) {
    bus.update(.05);
    assert.equal(bus.dwellRemaining, 0);
    assert.ok(bus.speed > 4.99);
  }
  assert.ok(bus.position.z < 35);
});

test('el bus frena ante el jugador y los peatones, y vuelve a avanzar cuando despejan el carril', () => {
  for(const actor of ['player','pedestrian']) {
    const bus=new BusService(new Bogota().getBusRoute());
    for(let i=0;i<60;i++) bus.update(0.05);
    const person=new THREE.Vector3(bus.position.x,0,bus.position.z-bus.length/2-10);
    person.y = bus.groundHeight(person.x, person.z);
    const context=actor==='player'?{player:person}:{pedestrians:[{position:person}]};
    for(let i=0;i<200;i++) bus.update(0.05,context);
    assert.ok(bus.speed<1e-8);
    assert.ok(bus.position.z-bus.length/2>=person.z+0.79);
    const stopped=bus.position.z;
    for(let i=0;i<40;i++) bus.update(0.05);
    assert.ok(bus.position.z<stopped-1);
  }
});

test('el bus frena ante un carro que cruza la troncal y continúa al despejarse', () => {
  const bus = new BusService({ x: 10, startZ: 100, endZ: 0, stationZ: 20 });
  bus.position.z = 80;
  bus.speed = 5;
  const car = { position: new THREE.Vector3(10, 0, 55), group: new THREE.Group(), length: 4.3, width: 1.76 };
  for (let frame = 0; frame < 300; frame++) bus.update(.1, { vehicles: [{ car }] });
  assert.ok(bus.speed < 1e-8);
  assert.ok(bus.position.z >= 55 + bus.length / 2 + car.width / 2 + .79);
  const stopped = bus.position.z;
  car.position.x = 20;
  for (let frame = 0; frame < 30; frame++) bus.update(.1, { vehicles: [{ car }] });
  assert.ok(bus.position.z < stopped - 3);
});
