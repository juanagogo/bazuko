import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.window ??= new EventTarget();
const { Car } = await import('../src/entities/Car.js');
const { CAR_MODELS, PRIVATE_MIX } = await import('../src/world/bogota/carModels.js');
const { getCarBody, wheelSeats } = await import('../src/world/bogota/VehicleBody.js');
const { parkCar, parkedCarCurbOverlap, parkedCarOffset, parkedCarShift } = await import('../src/world/bogota/parkedCars.js');
const { CAR_COOLDOWN, INTERACT_RANGE } = await import('../src/utils/constants.js');

const MARK_TO_CURB = .6, CURB_CROWN = .129;
const MODELS = [...new Set([...PRIVATE_MIX.map(([id]) => id), 'citadino', 'sedanPopular'])];
// Un puesto por lado de calle: `toward` es hacia dónde queda su andén, en el mundo.
const SPOTS = [
  { x: 10.4, z: 30, rot: Math.PI / 2, toward: new THREE.Vector3(1, 0, 0) },
  { x: 9.6, z: 30, rot: Math.PI / 2, toward: new THREE.Vector3(-1, 0, 0) },
  { x: 10, z: 30.4, rot: 0, toward: new THREE.Vector3(0, 0, 1) },
  { x: 10, z: 29.6, rot: 0, toward: new THREE.Vector3(0, 0, -1) },
];
const same = (a, b, message) => assert.ok(a === b, message);

function parked(model, spot, kind = 'carro') {
  const car = new Car(new THREE.Scene(), new THREE.Vector3(spot.x, 0, spot.z), spot.rot, { kind, model, variant: 3 });
  parkCar(car, spot);
  car.group.updateMatrixWorld(true);
  return car;
}

/** Punto de apoyo de cada llanta en el mundo, con lo que se aparta del centro del carro hacia el andén. El parqueado lleva sus ruedas en las molduras. */
function contacts(car, spot) {
  const spec = CAR_MODELS[car.vehicle.model], trim = car.vehicle.bodyVisual.children.find(mesh => mesh.name === 'Molduras e interior');
  return wheelSeats(spec, getCarBody(spec.id)).map(([x, z]) => {
    const half = spec.wheel.width / 2, edges = [z - half, z, z + half].map(edge => new THREE.Vector3(x, 0, edge).applyMatrix4(trim.matrixWorld));
    return { across: edges[1].clone().sub(car.position).dot(spot.toward), edges, y: edges[1].y };
  });
}

test('el parqueado ancho sube las llantas del lado del andén al sardinel y deja las otras en la calzada', () => {
  let tilted = 0;
  for (const model of MODELS) for (const spot of SPOTS) {
    const car = parked(model, spot), wheels = contacts(car, spot), label = `${model} hacia ${spot.toward.toArray()}`;
    const curbSide = wheels.filter(w => w.across > 0), roadSide = wheels.filter(w => w.across < 0);
    assert.equal(curbSide.length, 2, label); assert.equal(roadSide.length, 2, label);
    if (parkedCarCurbOverlap(car.width) > 1e-6) {
      tilted++;
      for (const wheel of curbSide) assert.ok(wheel.y > .1 && wheel.y < .125, `${label}: la llanta del andén apoya a ${wheel.y.toFixed(3)} m`);
      for (const wheel of roadSide) assert.ok(wheel.y >= 0 && wheel.y < .02, `${label}: la llanta de la calle apoya a ${wheel.y.toFixed(3)} m`);
    } else {
      // Cabe en la calzada: las cuatro en el piso, sin ladearse.
      for (const wheel of wheels) assert.ok(Math.abs(wheel.y) < .01, `${label}: ${wheel.y.toFixed(3)} m`);
      assert.equal(car.vehicle.group.rotation.x, 0, label);
    }
    // Ninguna orilla de llanta se hunde en la calzada.
    for (const wheel of wheels) for (const edge of wheel.edges) assert.ok(edge.y > -.002, `${label}: orilla a ${edge.y.toFixed(3)} m`);
    car.dispose();
  }
  assert.equal(tilted, 5 * SPOTS.length, 'sedán, hatchback, deportivo, camioneta y pick-up');
});

test('subir al sardinel no toca la raíz: carril y colisión leen el mismo carro', () => {
  for (const spot of SPOTS) {
    const car = parked('pickup', spot), offset = parkedCarOffset(spot, car.width);
    assert.deepEqual([car.position.x, car.position.y, car.position.z], [spot.x + offset.x, 0, spot.z + offset.z]);
    assert.equal(car.group.rotation.x, 0);
    assert.equal(car.group.rotation.z, 0);
    assert.equal(car.group.rotation.y, spot.rot);
    assert.notEqual(car.vehicle.group.rotation.x, 0);
    assert.ok(car.vehicle.group.position.y > 0);
    car.dispose();
  }
});

/** Punto a esa distancia de aviso del carro, sobre una línea que sale de su centro hacia el andén. */
function pointAtReach(car, spot, reach) {
  const point = new THREE.Vector3();
  let low = 0, high = 30;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    point.copy(car.position).addScaledVector(spot.toward, middle);
    if (car.interactDistance(point) < reach) low = middle; else high = middle;
  }
  return point;
}

test('el contorno solo sale con el jugador cerca, antes que el aviso, y se funde sin saltos', () => {
  const spot = SPOTS[0], car = parked('sedanPopular', spot), step = 1 / 60;
  assert.equal(car.marker.visible, false, 'recién puesto no se ve');
  const far = pointAtReach(car, spot, 12);
  for (let i = 0; i < 60; i++) car.update(step, far);
  assert.equal(car.marker.visible, false, 'lejos no se ve');
  car.update(step);
  assert.equal(car.marker.visible, false, 'sin jugador tampoco');

  // Caminando hacia el carro a 3 m/s: el contorno ya está entero cuando sale el aviso.
  const walk = pointAtReach(car, spot, 8), direction = spot.toward.clone().negate();
  let previous = 0, biggest = 0;
  while (car.interactDistance(walk) > INTERACT_RANGE) {
    car.update(step, walk);
    const opacity = car.marker.visible ? car.marker.material.opacity : 0;
    assert.ok(opacity >= previous, 'mientras se acerca no retrocede');
    biggest = Math.max(biggest, opacity - previous);
    previous = opacity;
    walk.addScaledVector(direction, 3 * step);
  }
  assert.ok(previous > .69, `al llegar al aviso va en ${previous}`);
  assert.ok(biggest < .1, `el salto más grande de opacidad es ${biggest}: sale de golpe`);

  // Y se apaga al irse, también de a poco.
  const away = pointAtReach(car, spot, 8);
  previous = car.marker.material.opacity;
  let frames = 0;
  while (car.marker.visible && frames++ < 120) {
    car.update(step, away);
    const opacity = car.marker.visible ? car.marker.material.opacity : 0;
    assert.ok(opacity <= previous && previous - opacity < .1, `${previous} a ${opacity}`);
    previous = opacity;
  }
  assert.equal(car.marker.visible, false);
  assert.ok(frames > 8, `se apagó en ${frames} cuadros`);
  car.dispose();
});

test('el contorno no oscila con el jugador parado o moviéndose en el límite', () => {
  const spot = SPOTS[1], car = parked('citadino', spot), step = 1 / 60;
  // Buscar la distancia a la que entra.
  let reach = 12;
  while (reach > 1) {
    car.update(1, pointAtReach(car, spot, 12));
    car.update(step, pointAtReach(car, spot, reach));
    if (car.marker.visible) break;
    reach -= .05;
  }
  assert.ok(reach > INTERACT_RANGE + 1, `sale a ${reach} m de aviso, muy encima del que da el robo`);
  const inside = pointAtReach(car, spot, reach - .05), outside = pointAtReach(car, spot, reach + .1);
  for (let i = 0; i < 60; i++) car.update(step, inside);
  assert.equal(car.marker.material.opacity, .7);
  // Pasos de ida y vuelta sobre la línea durante diez segundos: la opacidad no cambia ni un cuadro.
  for (let i = 0; i < 600; i++) {
    car.update(step, i % 40 < 20 ? inside : outside);
    assert.equal(car.marker.visible, true, `cuadro ${i}`);
    assert.equal(car.marker.material.opacity, .7, `cuadro ${i}`);
  }
  car.dispose();
});

test('el contorno desaparece al robar y no vuelve hasta que reponen los espejos; un carro en circulación nunca lo muestra', () => {
  const spot = SPOTS[2], car = parked('hatchPopular', spot), step = 1 / 60, near = pointAtReach(car, spot, 2);
  for (let i = 0; i < 40; i++) car.update(step, near);
  assert.equal(car.marker.visible, true);
  assert.ok(car.steal());
  assert.equal(car.marker.visible, false);
  for (let t = 0; t < CAR_COOLDOWN - 1; t += .5) car.update(.5, near);
  assert.equal(car.marker.visible, false, 'sigue robado');
  for (let t = 0; t < 2; t += step) car.update(step, near);
  assert.equal(car.marker.visible, true, 'ya tiene espejos');
  car.dispose();

  const moving = new Car(new THREE.Scene(), new THREE.Vector3(), 0, { traffic: true, model: 'citadino', variant: 3 });
  for (let i = 0; i < 60; i++) moving.update(step, moving.position);
  assert.equal(moving.marker.visible, false);
  moving.dispose();
});

test('el contorno sube el sardinel en vez de atravesarlo, con el andén a cualquier lado del carro', () => {
  const vertex = new THREE.Vector3();
  for (const model of MODELS) for (const spot of SPOTS) {
    const car = parked(model, spot), label = `${model} hacia ${spot.toward.toArray()}`;
    const curb = new THREE.Vector3(spot.x, 0, spot.z).addScaledVector(spot.toward, MARK_TO_CURB);
    car.group.updateMatrixWorld(true);
    const position = car.marker.geometry.attributes.position;
    let onSidewalk = 0, onRoad = 0;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(car.marker.matrixWorld);
      const past = vertex.clone().sub(curb).dot(spot.toward); // positivo: ya sobre el andén
      if (past > -.031) {
        assert.ok(vertex.y > CURB_CROWN, `${label}: a ${past.toFixed(3)} m del borde va a ${vertex.y.toFixed(3)} m, por dentro del sardinel`);
        if (past > .1) onSidewalk++;
      } else {
        assert.ok(vertex.y > 0 && vertex.y < .06, `${label}: a ${past.toFixed(3)} m del borde va a ${vertex.y.toFixed(3)} m`);
        onRoad++;
      }
      // Rodea al carro: ningún punto cae bajo la carrocería.
      const along = vertex.clone().sub(car.position).dot(new THREE.Vector3(Math.cos(spot.rot), 0, -Math.sin(spot.rot)));
      const across = vertex.clone().sub(car.position).dot(spot.toward);
      assert.ok(Math.abs(along) > car.length / 2 + .1 || Math.abs(across) > car.width / 2 + .1, `${label}: (${along.toFixed(2)}, ${across.toFixed(2)}) bajo el carro`);
    }
    assert.ok(onSidewalk > 8 && onRoad > 8, `${label}: ${onSidewalk} puntos en el andén y ${onRoad} en la calle`);
    car.dispose();
  }
});

test('el contorno no gasta un material ni una geometría por carro', () => {
  const step = 1 / 60, spot = SPOTS[0], a = parked('suv', spot), b = parked('suv', { ...spot, z: 60 }), near = car => car.position.clone().addScaledVector(spot.toward, 2);
  same(a.marker.geometry, b.marker.geometry, 'misma geometría');
  same(a.marker.material, b.marker.material, 'mismo material de partida');
  for (let i = 0; i < 40; i++) { a.update(step, near(a)); b.update(step, near(b)); }
  same(a.marker.material, b.marker.material, 'mismo material ya encendido');
  let disposed = 0;
  for (const resource of [b.marker.geometry, b.marker.material]) resource.addEventListener('dispose', () => disposed++);
  a.dispose();
  assert.equal(disposed, 0, 'liberar un carro no le quita el contorno al otro');
  assert.equal(b.marker.visible, true);
  b.dispose();
});

test('el empuje y el sardinel coinciden: el borde del andén queda donde lo calcula el puesto', () => {
  for (const model of MODELS) {
    const { W } = CAR_MODELS[model], overlap = parkedCarCurbOverlap(W);
    assert.ok(Math.abs(overlap - Math.max(0, W / 2 - parkedCarShift(W) - MARK_TO_CURB)) < 1e-9, model);
    assert.ok(overlap <= .2 + 1e-9, `${model} pisa ${overlap}`);
  }
});
