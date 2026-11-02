import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TERMINAL, terminalGroundHeight, buildTransitTerminal, platformDoorZ, setPlatformDoors } from '../src/world/bogota/TransitTerminal.js';
import { BUS_DOOR_Z, BUS_DOOR_WIDTH } from '../src/world/bogota/BusBody.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { BusService, doorOpening } from '../src/world/bogota/BusService.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { southBusPathX } from '../src/world/bogota/Colpatria.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';
import { GPS_ARRIVAL_DISTANCE } from '../src/systems/GpsNavigation.js';

test('la estación propia permite recorrer la plataforma desde la rampa sin paredes invisibles', () => {
  const model = buildTransitTerminal({ createSign: () => new THREE.Texture(), asphalt: new THREE.MeshStandardMaterial() });
  const collisions = new CollisionSystem(); collisions.colliders.push(...model.userData.colliders);
  let position = new THREE.Vector3(75,.02,-1);
  for (let i=0;i<560;i++) {
    const next = collisions.resolveMove(position,new THREE.Vector3(0,0,-.1));
    assert.ok(next.z < position.z - .099);
    next.y = terminalGroundHeight(next.x,next.z); position=next;
  }
  assert.ok(model.children.some(o=>o.name==='Rampa peatonal'));
  assert.equal(terminalGroundHeight(75,-30),.92);
  assert.equal(terminalGroundHeight(78.5,-30),.02);
  assert.ok(Math.abs(terminalGroundHeight(75,-58)-.02)<1e-8);
});

test('dos buses recorren sentidos contrarios, paran cuatro segundos y respetan sus carriles', () => {
  const route = new Bogota().getBusRoute();
  const buses=[new BusService(route),new BusService({...route,x:TERMINAL.southLane,pathX:southBusPathX,startZ:route.endZ,endZ:route.startZ})];
  for(const bus of buses) {
    const sign=bus.direction; let stopped=0, arrived=false, departed=false;
    for(let frame=0;frame<3000;frame++) {
      const before=bus.position.z; bus.update(.05);
      if(bus.direction*(bus.position.z-before)<-1) break;
      if(bus.dwellRemaining>0) { stopped+=.05; arrived=true; assert.equal(bus.position.z,-30); }
      if(arrived && sign*(bus.position.z+30)>1) { departed=true; break; }
    }
    assert.ok(arrived&&departed); assert.ok(stopped>=3.95&&stopped<=4.1);
  }
  assert.equal(buses[0].direction,-1);assert.equal(buses[1].direction,1);
});

test('ambas carrocerías caben en el puente y los dos colliders conservan orientación propia', () => {
  const route=new Bogota().getBusRoute();
  const buses=[new BusService(route),new BusService({...route,x:71.5,pathX:southBusPathX,startZ:route.endZ,endZ:route.startZ})];
  const collisions=new CollisionSystem();
  for(let z=28;z<300;z+=.5) {
    for(const bus of buses) {
      bus.position.z=z;bus._alignToGround();const h=bus.heading;
      for(const along of [-bus.length/2,0,bus.length/2])for(const side of [-bus.width/2,bus.width/2]) {
        const x=bus.position.x+h.x*along-h.z*side,wz=z+h.z*along+h.x*side;
        assert.notEqual(viaductSurface(x,wz),null,`${bus.direction}: ${x}, ${wz}`);
      }
    }
    collisions.setVehicles([],buses);
    assert.equal(collisions.dynamicColliders.length,2);
    assert.ok(collisions.dynamicColliders.every(e=>e.obb.quaternion.equals(e.vehicle.group.quaternion)));
  }
});

test('los buses contrarios pueden cruzarse en las curvas sin superponer sus cajas', () => {
  const route=new Bogota().getBusRoute();
  const buses=[new BusService(route),new BusService({...route,x:71.5,pathX:southBusPathX,startZ:route.endZ,endZ:route.startZ})];
  const collisions=new CollisionSystem();
  for(let z=100;z<230;z+=2)for(let offset=-20;offset<=20;offset+=2) {
    buses[0].position.z=z;buses[1].position.z=z+offset;
    buses.forEach(b=>b._alignToGround());collisions.setVehicles([],buses);
    const [a,b]=collisions.dynamicColliders.map(e=>e.obb),gap=b.center.clone().sub(a.center);
    let separated=false;
    for(const axis of [a.axes[0],a.axes[2],b.axes[0],b.axes[2]]) {
      const r=o=>o.axes.reduce((sum,v,i)=>sum+Math.abs(v.dot(axis))*o.halfSize.getComponent(i),0);
      if(Math.abs(gap.dot(axis))>r(a)+r(b))separated=true;
    }
    assert.ok(separated,`cruce solapado en Z ${z}, ${z+offset}`);
  }
});

test('la estación no agrega luces, cabe en su presupuesto y se enciende de noche', () => {
  const model = buildTransitTerminal({ asphalt: new THREE.MeshStandardMaterial() });
  let triangles = 0;
  const own = [];
  model.traverse(object => {
    assert.equal(object.isLight, undefined);
    if (!object.isMesh || !object.userData.noMerge) return;
    own.push(object);
    triangles += object.geometry.index.count / 3;
  });
  assert.ok(own.length <= 40, `llamadas de dibujo: ${own.length}`);
  assert.ok(triangles < 40000, `triángulos: ${triangles}`);
  const named = name => own.find(mesh => mesh.name === `Estación: ${name}`);
  assert.equal(named('pools').visible, false);
  model.userData.setNight(true);
  assert.equal(named('pools').visible, true);
  assert.ok(named('signs').material.emissiveIntensity > .5);
  model.userData.setNight(false);
  assert.equal(named('pools').visible, false);
  model.userData.setWetness(1);
  assert.ok(named('slab').material.roughness < .6);
  let disposed = 0;
  named('steel').geometry.addEventListener('dispose', () => disposed++);
  named('steel').material.addEventListener('dispose', () => disposed++);
  model.userData.dispose();
  assert.equal(disposed, 2);
});

test('el piso sigue entero: los separadores encajan y las puntas de la isla tienen calle', () => {
  assert.ok(Math.abs(terminalGroundHeight(69.4,-30)-.14)<1e-9);
  assert.equal(terminalGroundHeight(69.4,-2),.02);
  assert.equal(terminalGroundHeight(71.5,-30),.02);
  assert.equal(terminalGroundHeight(80.6,-58),.02);
  const model = buildTransitTerminal({ asphalt: new THREE.MeshStandardMaterial() });
  const road = model.children.find(object => object.name === 'Calle ampliada');
  const position = road.geometry.attributes.position;
  const covers = (x, z) => {
    for (let i = 0; i < position.count; i += 4) {
      const xs = [0,1,2,3].map(k => position.getX(i+k)), zs = [0,1,2,3].map(k => position.getZ(i+k));
      if (x >= Math.min(...xs) && x <= Math.max(...xs) && z >= Math.min(...zs) && z <= Math.max(...zs)) return true;
    }
    return false;
  };
  for (const [x, z] of [[75,-1],[75,-70],[62,-30],[88,-30]]) assert.ok(covers(x,z),`${x},${z}`);
  // Sin color por vértice se fusiona con el asfalto de la ciudad.
  assert.equal(road.geometry.attributes.color,undefined);
  assert.notEqual(road.userData.noMerge,true);
});

test('las puertas del andén quedan frente a las del bus y no chocan al abrirse', () => {
  const half = BUS_DOOR_WIDTH/2;
  for (const [side, doors] of Object.entries(platformDoorZ)) {
    assert.equal(doors.length,BUS_DOOR_Z.length);
    for (const z of doors) assert.ok(z-half>-50&&z+half<-10,`${side} ${z}`);
    // Cada hoja corre casi su propio ancho hacia afuera: las de dos vanos vecinos no se pisan.
    for (let i=0;i+1<doors.length;i++) assert.ok(doors[i+1]-half-(doors[i]+half)>=2*(half-.04)+.02,`${side} ${doors[i]}`);
  }
  // Hacia el norte el frente del bus va hacia Z menor, hacia el sur al revés.
  const route = new Bogota().getBusRoute();
  const north = new BusService(route), south = new BusService({...route,x:TERMINAL.southLane,pathX:southBusPathX,startZ:route.endZ,endZ:route.startZ});
  assert.deepEqual(platformDoorZ.east,BUS_DOOR_Z.map(z=>TERMINAL.z+north.direction*z).sort((a,b)=>a-b));
  assert.deepEqual(platformDoorZ.west,BUS_DOOR_Z.map(z=>TERMINAL.z+south.direction*z).sort((a,b)=>a-b));
  assert.doesNotThrow(()=>{setPlatformDoors(-1,1);setPlatformDoors(1,0);setPlatformDoors(-1,0);});
});

test('las puertas abren solo con el bus detenido y cierran antes de salir', () => {
  assert.equal(doorOpening(0),0);
  assert.equal(doorOpening(4),0);
  assert.equal(doorOpening(2),1);
  assert.ok(doorOpening(.5)>0&&doorOpening(.5)<1);
  const route = new Bogota().getBusRoute();
  const bus = new BusService({...route,startZ:-20,endZ:-60,pathX:null,groundHeight:null,x:TERMINAL.northLane});
  let opened = 0, moving = false;
  for(let frame=0;frame<1200;frame++) {
    const before = bus.position.z;
    bus.update(.05);
    if(bus.doorOpen>.99) opened++;
    if(bus.position.z!==before) { assert.ok(bus.doorOpen<.01,`puerta abierta a z=${bus.position.z}`); if(opened) { moving=true; break; } }
  }
  assert.ok(opened>=20,`cuadros con la puerta abierta: ${opened}`);
  assert.ok(moving);
});

/** La ciudad mínima para planificar rutas y la estación con sus colisiones, sin levantar el distrito. */
function stationOnMap() {
  const city = new Bogota();
  city.map = city._layout();
  city.reserved = { shop: { x: STREET_X.world(34), z: STREET_Z.world(29) }, sell: { x: STREET_X.world(14.5), z: STREET_Z.world(34) } };
  const model = buildTransitTerminal({ asphalt: new THREE.MeshStandardMaterial() });
  const collisions = new CollisionSystem();
  collisions.colliders.push(...model.userData.colliders);
  return { city, gps: city.createGpsNavigation(), collisions, colliders: model.userData.colliders };
}

test('el GPS a pie sube por las rampas y no atraviesa muros, barandas, molinetes ni bancas', () => {
  const { gps, colliders } = stationOnMap();
  const radius = .4;
  const hit = (x, z) => {
    const y = terminalGroundHeight(x, z);
    return colliders.some(({ box }) => !(y > box.max.y || y + 1.6 < box.min.y)
      && x > box.min.x - radius && x < box.max.x + radius && z > box.min.z - radius && z < box.max.z + radius);
  };
  const expectFree = (from, to) => {
    const route = gps.findPath(from, to);
    assert.ok(route, `sin ruta de ${from.x},${from.z} a ${to.x},${to.z}`);
    const line = [from, ...route, to];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .2);
      for (let s = 0; s <= steps; s++) {
        const x = a.x + (b.x - a.x) * s / (steps || 1), z = a.z + (b.z - a.z) * s / (steps || 1);
        assert.equal(hit(x, z), false, `${from.x},${from.z} -> ${to.x},${to.z}: choca en ${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  };
  const around = [[75, -66], [88, -66], [92, -30], [88, 4], [75, 6], [62, 4], [57, -30], [62, -66], [78.5, -30], [71.5, -30], [112.98, 97.84]];
  const platform = [[75, -30], [75, -46], [75, -14], [76.2, -25], [73.8, -25]];
  for (const [ax, az] of around) for (const [bx, bz] of platform) {
    expectFree({ x: ax, z: az }, { x: bx, z: bz });
    expectFree({ x: bx, z: bz }, { x: ax, z: az });
  }
  // Por los dos lados del muro hay camino, pero más largo que la línea recta: se da la vuelta por la rampa.
  assert.ok(gps.routeLengthTo({ x: 78.5, z: -30 }, { x: 75, z: -30 }) > 50);
  // Un destino marcado contra el muro se da por llegado desde el pasillo: nadie se queda empujando el vidrio.
  assert.ok(Math.abs(76.8 - TERMINAL.x) < GPS_ARRIVAL_DISTANCE);
});

test('ningún punto de la isla ni de los carriles deja encerrado al jugador', () => {
  const { collisions } = stationOnMap();
  const step = .25, x0 = 60, nx = 120, z0 = -62, nz = 256;
  const index = (x, z) => {
    const i = Math.round((x - x0) / step), j = Math.round((z - z0) / step);
    return i < 0 || j < 0 || i > nx || j > nz ? -1 : j * (nx + 1) + i;
  };
  // Grafo de pasos reales, con la misma colisión y altura del jugador; la salida se busca hacia atrás.
  const reverse = Array.from({ length: (nx + 1) * (nz + 1) }, () => []);
  const position = new THREE.Vector3(), delta = new THREE.Vector3(), next = new THREE.Vector3();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, from = j * (nx + 1) + i;
    position.set(x, terminalGroundHeight(x, z), z);
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      collisions.resolveMove(position, delta.set(dx, 0, dz), .4, next);
      const to = index(next.x, next.z);
      if (to >= 0 && to !== from) reverse[to].push(from);
    }
  }
  const reached = new Uint8Array(reverse.length), queue = [index(62, -30)];
  reached[queue[0]] = 1;
  while (queue.length) for (const from of reverse[queue.pop()]) if (!reached[from]) { reached[from] = 1; queue.push(from); }
  const trapped = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    if (!reached[j * (nx + 1) + i]) trapped.push(`${x0 + i * step},${z0 + j * step}`);
  }
  assert.deepEqual(trapped, []);
});

test('los peatones no entran a la estación: su red se queda en la ciudad', () => {
  const { city } = stationOnMap();
  const navigation = city._createPedestrianNavigation();
  for (let i = 0; i < navigation.nodes.length; i++) {
    const point = navigation._point(i);
    assert.ok(point.z >= 0, `nodo peatonal dentro de la estación: ${point.x},${point.z}`);
  }
  assert.equal(navigation.isWalkableAt(75, -30), false);
});

test('el bus detenido en su carril no toca el muro ni deja al jugador sin salida', () => {
  const { collisions } = stationOnMap();
  const route = new Bogota().getBusRoute();
  const buses = [new BusService(route), new BusService({ ...route, x: TERMINAL.southLane, pathX: southBusPathX, startZ: route.endZ, endZ: route.startZ })];
  for (const bus of buses) { bus.position.z = TERMINAL.z; bus._alignToGround(); }
  collisions.setVehicles([], buses);
  for (const bus of buses) {
    const side = bus.position.x + (bus.position.x > TERMINAL.x ? -1 : 1) * bus.width / 2;
    assert.ok(side > 77.02 || side < 72.98, `la caja del bus pisa el muro: ${side}`);
  }
  // Atrapado entre el bus y el muro: el empujón lo saca y puede seguir caminando por donde venga.
  const walk = (position, dx, dz, steps) => {
    for (let i = 0; i < steps; i++) {
      position = collisions.resolveMove(position, new THREE.Vector3(dx, 0, dz));
      position.y = terminalGroundHeight(position.x, position.z);
    }
    return position;
  };
  // La peor franja está contra las bancas, donde banca y muro se prohibían la salida la una a la otra.
  for (const startX of [77.45, 72.55]) for (const z of [-33, -30.1, -29.5, -21]) {
    const toAisle = Math.sign(TERMINAL.x - startX) * .1;
    const out = [.1, -.1].some(dz => {
      const pushed = walk(new THREE.Vector3(startX, .02, z), 0, dz, 40);
      return Math.abs(walk(pushed, toAisle, 0, 14).x - TERMINAL.x) < 1;
    });
    assert.ok(out, `sin salida desde ${startX},${z}`);
  }
});
