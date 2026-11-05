import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VIADUCT, paintViaductGardens, viaductHeight, viaductSurface, buildColpatriaViaduct } from '../src/world/bogota/ColpatriaViaduct.js';
import { busPathX, bridgeCenter, bridgeNormal } from '../src/world/bogota/Colpatria.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { BusService } from '../src/world/bogota/BusService.js';
import { bridgeHeight } from '../src/world/bogota/LakePark.js';

test('el viaducto comienza en la ubicación indicada, sube suavemente y conecta elevado con el lago', () => {
  assert.equal(VIADUCT.start, 15.43);
  assert.equal(viaductHeight(15.43), .02);
  const route = new Bogota().getBusRoute();
  const bus = new BusService(route);
  assert.equal(route.stationZ, -30);
  bus.position.z = 51; bus._alignToGround();   // el bus (22,1 m) queda entero sobre el tablero plano (la rampa llega a la cota en Z 39)
  assert.ok(Math.abs(bus.position.y - 7.82) < 1e-8);
  assert.equal(bus.group.rotation.x, 0);
  assert.ok(Math.abs(viaductHeight(220) - 7.82) < 1e-8);
  assert.ok(viaductHeight(168) > 7.8);
  for (let z = VIADUCT.start; z < 218; z += .1) assert.ok(Math.abs(viaductHeight(z + .1) - viaductHeight(z)) < .037);
  assert.ok(viaductHeight(25) - VIADUCT.thickness > 2.3);
  const city = new Bogota(); city.map = city._layout();
  const asphalt = new THREE.MeshStandardMaterial({ color: '#b4b4b4', map: new THREE.Texture(), roughness: .82 });
  const bridge = buildColpatriaViaduct(city.map, { pavement: asphalt });
  assert.ok(bridge.children.some(o => o.name === 'Pilar'));
  assert.ok(bridge.children.some(o => o.name === 'Baranda amarilla'));
  assert.ok(bridge.userData.colliders.some(b => b.min.y > 7));
  const sections = bridge.children.filter(o => o.name === 'Superficie del puente');
  assert.equal(sections.length, Math.ceil(VIADUCT.end) - Math.floor(VIADUCT.start));
  assert.ok(sections.every(o => o.material === sections[0].material));
  assert.equal(sections[0].material, asphalt);
  const landing = sections[0].geometry.attributes.position;
  assert.equal(landing.getX(0), 68);
  assert.equal(landing.getX(1), 82);
  assert.ok(Math.abs(landing.getY(0) - .02) < 1e-8);
  const lake = sections.find(o => o.userData.stationStart === 250).geometry.attributes.position;
  assert.ok(Math.abs(Math.hypot(lake.getX(1)-lake.getX(0),lake.getZ(1)-lake.getZ(0))-VIADUCT.width)<.00002);
  assert.equal(sections[0].geometry.attributes.uv.count, 4);
  for (const section of sections.filter(o => o.userData.stationStart < VIADUCT.crestStart)) {
    const p = section.geometry.attributes.position;
    assert.equal(p.getX(0), 68); assert.equal(p.getX(1), 82);
    const slab = bridge.children.find(o => o.name === 'Tablero de concreto' && o.userData.stationStart === section.userData.stationStart);
    const q = slab.geometry.attributes.position;
    for (let i = 0; i < 4; i++) {
      assert.equal(q.getX(i), p.getX(i)); assert.equal(q.getZ(i), p.getZ(i));
      assert.ok(Math.abs(p.getY(i) - q.getY(i) - .06) < 1e-6);
    }
  }
  const before = sections.find(o => o.userData.stationStart === 219);
  const after = sections.find(o => o.userData.stationStart === 220);
  const p = before.geometry.attributes.position, q = after.geometry.attributes.position;
  for (let i = 0; i < 2; i++) {
    assert.deepEqual([p.getX(i + 2),p.getY(i + 2),p.getZ(i + 2)], [q.getX(i),q.getY(i),q.getZ(i)]);
  }
  // Debajo se permanece a nivel de calle; sobre el tablero se conserva su cota.
  assert.ok(city.getMovementGroundHeight(busPathX(168), 168, .02) < .2);
  assert.ok(city.getMovementGroundHeight(busPathX(168), 168, 7.82) > 7.8);
});

test('la conexión entre los puentes conserva altura y continuidad sin una bajada a la calle', () => {
  assert.ok(Math.abs(viaductHeight(VIADUCT.end) - bridgeHeight(VIADUCT.end)) < 1e-8);
  const route = new Bogota().getBusRoute(), bus = new BusService(route);
  let previous = null;
  for (let z = 205; z <= 240; z += .05) {
    bus.position.z = z; bus._alignToGround();
    assert.ok(Math.abs(bus.position.y - 7.82) < 1e-8);
    if (previous !== null) assert.ok(Math.abs(bus.position.y - previous) < .02);
    previous = bus.position.y;
  }
  assert.ok(Math.abs(viaductSurface(busPathX(219.99), 219.99) - bridgeHeight(220)) < .01);
  for (let z = 95; z <= 280; z += .5) {
    const height = z <= VIADUCT.end ? viaductHeight(z) : bridgeHeight(z);
    assert.ok(Math.abs(height - 7.82) < 1e-8, `desnivel en Z ${z}`);
  }
});

test('el bus usa el tablero y no frena por peatones que pasan debajo', () => {
  const bus = new BusService(new Bogota().getBusRoute());
  bus.position.z = 175; bus._alignToGround(); bus.speed = 3;
  const below = new THREE.Vector3(bus.position.x, 0, 161);
  assert.equal(bus._clearance(below), Infinity);
  const onDeck = below.clone(); onDeck.y = 7.82;
  assert.ok(Number.isFinite(bus._clearance(onDeck)));
  for (let z = 105; z < 208; z += .5) {
    bus.position.z = z; bus._alignToGround();
    const h = bus.heading;
    for (const along of [-bus.length / 2, 0, bus.length / 2]) for (const side of [-bus.width / 2, bus.width / 2]) {
      const x = bus.position.x + h.x * along - h.z * side;
      const wz = z + h.z * along + h.x * side;
      assert.notEqual(viaductSurface(x, wz), null, `fuera del tablero: ${x},${wz}`);
    }
  }
});

test('los bordes del rodeo cambian de dirección gradualmente sin quiebres locales', () => {
  const sections = buildColpatriaViaduct().children.filter(o => o.name === 'Superficie del puente' && o.userData.stationStart >= 80 && o.userData.stationStart <= 244);
  for (let i = 1; i < sections.length - 1; i++) for (const side of [0, 1]) {
    const x = offset => sections[i + offset].geometry.attributes.position.getX(side);
    const change = Math.abs(x(1) - 2 * x(0) + x(-1));
    assert.ok(change < .4, `quiebre del borde ${side} en Z ${sections[i].userData.stationStart}: ${change}`);
  }
});

test('el puente conserva su ancho real perpendicular al eje, incluso en las curvas', () => {
  const sections=buildColpatriaViaduct().children.filter(o=>o.name==='Superficie del puente');
  for(const section of sections) {
    const p=section.geometry.attributes.position,z=section.userData.stationStart,n=bridgeNormal(z);
    const dx=p.getX(1)-p.getX(0),dz=p.getZ(1)-p.getZ(0);
    assert.ok(Math.abs(Math.hypot(dx,dz)-VIADUCT.width)<.00003);
    assert.ok(Math.abs(dx*n.z-dz*n.x)<.00003);
    assert.ok(Math.abs((p.getX(1)+p.getX(0))/2-bridgeCenter(z))<.00002);
    assert.ok(Math.abs((p.getZ(1)+p.getZ(0))/2-z)<.00002);
  }
});

test('las franjas rojas bajo el viaducto se convierten en pasto sin alterar calles, rampas ni agua',()=>{
  const map=Array.from({length:161},()=>Array(120).fill('road'));
  for(const z of [10,50,120])map[z][37]='busway';
  map[50][38]='water';map[50][39]='smallBuilding';
  paintViaductGardens(map);
  assert.equal(map[50][37],'grass');
  assert.equal(map[10][37],'busway');assert.equal(map[120][37],'busway');
  assert.equal(map[50][36],'road');assert.equal(map[50][38],'water');assert.equal(map[50][39],'smallBuilding');
  const city=new Bogota();city.map=city._layout();
  assert.equal(city.map[50][37],'grass');
  assert.equal(city.getMovementGroundHeight(74,100,.06),.06);
});
