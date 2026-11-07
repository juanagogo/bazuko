// La mano del conductor que paga, recibe o rechaza sale por la ventana: el vidrio de ese puesto baja antes y sube después.
// Sin esto el antebrazo atravesaba el vidrio cerrado. El vidrio sigue siendo una sola malla compartida por modelo: la
// ventana se aparta con otro índice sobre los mismos búferes, y el carro no estrena materiales.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.window ??= new EventTarget();
const { Car } = await import('../src/entities/Car.js');
const { CAR_MODELS } = await import('../src/world/bogota/carModels.js');
const { getCarGeometry, getDriverWindowGlass } = await import('../src/world/bogota/VehicleBody.js');
const { RebusqueVisual } = await import('../src/systems/rebusque/RebusqueVisual.js');

const MODELOS = Object.keys(CAR_MODELS);
const tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();

/** Recorre los triángulos de una geometría indexada: centro y normal de cara, en coordenadas del modelo. */
function triangulos(geometria, fn) {
  const p = geometria.attributes.position, idx = geometria.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    tri.set(a.fromBufferAttribute(p, idx[i]), b.fromBufferAttribute(p, idx[i + 1]), c.fromBufferAttribute(p, idx[i + 2]));
    tri.getNormal(n);
    fn(tri.getMidpoint(new THREE.Vector3()), n, idx[i]);
  }
}

/** ¿Es un triángulo de la ventana del puesto (lado del conductor, en su tramo, de canto al costado)? */
function enLaVentana(id, centro, normal) {
  const spec = CAR_MODELS[id], lado = Math.sign(spec.driver.z) || -1;
  const [x0, x1] = spec.windows.find(([p, q]) => spec.driver.x >= p && spec.driver.x <= q);
  return centro.z * lado > 0 && centro.x > x0 && centro.x < x1 && Math.abs(normal.z) > .5;
}

test('cada modelo aparta la ventana del conductor: completa, solo ella y sobre los mismos búferes del vidrio', () => {
  for (const id of MODELOS) {
    const vidrio = getCarGeometry(id).glass, partido = getDriverWindowGlass(id);
    assert.ok(partido, `${id}: tiene ventana del conductor`);
    assert.strictEqual(getDriverWindowGlass(id), partido, `${id}: se arma una sola vez`);
    assert.equal(partido.rest.index.count + partido.pane.index.count, vidrio.index.count, `${id}: no se pierde ni se repite ningún triángulo`);
    for (const g of [partido.rest, partido.pane]) {
      for (const [clave, atributo] of Object.entries(vidrio.attributes)) assert.strictEqual(g.attributes[clave], atributo, `${id}: comparte ${clave}`);
    }
    let ventana = 0, sobra = 0, otroLado = 0;
    triangulos(partido.pane, (centro, normal) => { if (enLaVentana(id, centro, normal)) ventana++; });
    assert.equal(ventana, partido.pane.index.count / 3, `${id}: la ventana es solo la del puesto`);
    assert.ok(ventana >= 4, `${id}: ${ventana} triángulos de ventana`);
    triangulos(partido.rest, (centro, normal) => {
      if (enLaVentana(id, centro, normal)) sobra++;
      // La del copiloto, su espejo, se queda.
      if (enLaVentana(id, centro.clone().setZ(-centro.z), normal.clone().setZ(-normal.z))) otroLado++;
    });
    assert.equal(sobra, 0, `${id}: no queda vidrio en la ventana del conductor`);
    assert.equal(otroLado, ventana, `${id}: la ventana del otro lado sigue entera`);
    const spec = CAR_MODELS[id];
    assert.ok(partido.drop > .25 && partido.drop < 1.4, `${id}: baja ${partido.drop} m`);
    assert.ok(partido.drop < spec.H, `${id}: baja dentro de la puerta`);
  }
});

const carro = (model, posicion = new THREE.Vector3(0, 0, 3)) => {
  const scene = new THREE.Scene();
  const car = new Car(scene, posicion, 0, { traffic: true, kind: 'carro', model, variant: 11 });
  car.group.updateMatrixWorld(true);
  return car;
};
// La malla de los vidrios, por su nombre: la misma que `vehicle.glassMesh`.
const vidrioDe = car => car.vehicle.bodyVisual.children.find(o => o.name === 'Vidrios');
const ventanaDe = car => vidrioDe(car).children.find(o => o.name === 'Ventana del conductor');

test('el carro baja y sube su ventana sin materiales nuevos y la deja como estaba', () => {
  const car = carro('sedanPopular'), otro = carro('sedanPopular'), vidrio = vidrioDe(car);
  assert.strictEqual(car.vehicle.glassMesh, vidrio);
  const entero = vidrio.geometry, material = vidrio.material, partido = getDriverWindowGlass('sedanPopular');
  assert.equal(ventanaDe(car), undefined, 'cerrada no existe la malla aparte');
  assert.ok(car.setDriverWindow(.5));
  assert.strictEqual(vidrio.geometry, partido.rest);
  const ventana = ventanaDe(car);
  assert.ok(ventana.visible && !ventana.castShadow);
  assert.strictEqual(ventana.geometry, partido.pane);
  assert.strictEqual(ventana.material, material, 'el mismo vidrio de la flota');
  assert.ok(Math.abs(ventana.position.y + partido.drop * .5) < 1e-9, 'a medio bajar');
  car.setDriverWindow(1);
  assert.ok(!ventana.visible, 'abajo del todo no se dibuja');
  car.setDriverWindow(0);
  assert.strictEqual(vidrio.geometry, entero);
  assert.ok(!ventana.visible);
  car.setDriverWindow(.3);
  assert.strictEqual(ventanaDe(car), ventana, 'la malla se reutiliza');
  car.setDriverWindow(0);
  // El vecino del mismo modelo no se enteró.
  assert.strictEqual(vidrioDe(otro).geometry, entero);
  assert.equal(ventanaDe(otro), undefined);
  // Sin vidrios que bajar (moto, carro de mentira) no pasa nada.
  assert.equal(Car.prototype.setDriverWindow.call({ vehicle: {} }, 1), false);
});

/** ¿El tramo del codo a la mano cruza algún triángulo del vidrio que se dibuja ahora? En coordenadas de la carrocería. */
function cruzaVidrio(car, desde, hasta) {
  const vidrio = vidrioDe(car), carroceria = car.vehicle.bodyVisual;
  carroceria.updateWorldMatrix(true, true);
  const p = carroceria.worldToLocal(desde.clone()), q = carroceria.worldToLocal(hasta.clone());
  const rayo = new THREE.Ray(p, q.clone().sub(p).normalize()), largo = p.distanceTo(q), punto = new THREE.Vector3();
  const mallas = [vidrio, ...vidrio.children.filter(o => o.isMesh && o.visible)];
  for (const malla of mallas) {
    const pos = malla.geometry.attributes.position, idx = malla.geometry.index.array, dy = malla === vidrio ? 0 : malla.position.y;
    for (let i = 0; i < idx.length; i += 3) {
      a.fromBufferAttribute(pos, idx[i]).y += dy; b.fromBufferAttribute(pos, idx[i + 1]).y += dy; c.fromBufferAttribute(pos, idx[i + 2]).y += dy;
      if (rayo.intersectTriangle(a, b, c, false, punto) && punto.distanceTo(p) <= largo) return true;
    }
  }
  return false;
}

function montar(cars) {
  const scene = new THREE.Scene(), root = new THREE.Group();
  root.position.set(0, 0, 0); scene.add(root); root.updateMatrixWorld(true);
  const game = { player: { position: new THREE.Vector3(), root, character: null, modelScale: 1 }, rebusque: { escena: null },
    traffic: { vehicles: cars.map(car => ({ car })) } };
  return { game, visual: new RebusqueVisual(scene, game) };
}

test('cobro: el antebrazo del conductor nunca atraviesa el vidrio, que baja antes y sube después', () => {
  for (const model of ['sedanPopular', 'citadino', 'suv', 'buseta']) {
    const car = carro(model), testigo = carro(model, new THREE.Vector3(8, 0, 3));
    const { game, visual } = montar([car, testigo]);
    const vehicle = game.traffic.vehicles[0], entero = vidrioDe(car).geometry;
    const escena = { tipo: 'cobro', trabajo: 'dulces', tiempo: 0, dur: 2.6, reacciones: [{ car, vehicle, tipo: 'paga', t0: 0, pesos: 500 }] };
    game.rebusque.escena = escena;
    let fuera = 0, abajoAntes = false;
    for (let t = 0; t < 2.6; t += 1 / 60) {
      escena.tiempo = t;
      visual.update(1 / 60);
      const slot = visual._manosConductor[0];
      if (!slot.mano.visible) continue;
      fuera++;
      if (fuera === 1) abajoAntes = car._driverWindowOpen === 1;
      assert.ok(!cruzaVidrio(car, slot.brazo.position, slot.mano.position), `${model}: el brazo cruza el vidrio a los ${t.toFixed(2)} s`);
    }
    assert.ok(fuera > 60, `${model}: la mano salió (${fuera} cuadros)`);
    assert.ok(abajoAntes, `${model}: el vidrio ya estaba abajo cuando salió la mano`);
    // Se acaba el cobro con el vidrio a medio subir: termina de subir solo y queda como estaba.
    game.rebusque.escena = null;
    for (let i = 0; i < 60; i++) visual.update(1 / 60);
    assert.strictEqual(vidrioDe(car).geometry, entero, `${model}: el vidrio volvió a su sitio`);
    assert.ok(!ventanaDe(car)?.visible);
    assert.equal(visual._ventanas.size, 0, 'sin ventanas abiertas no queda nada que mover por cuadro');
    // El que no reaccionó no se tocó.
    assert.strictEqual(vidrioDe(testigo).geometry, entero);
    assert.equal(ventanaDe(testigo), undefined);
    visual.dispose();
  }
});

test('con tres conductores las manos siguen saliendo una tras otra, cada una con su vidrio ya abajo', () => {
  const cars = ['sedanPopular', 'citadino', 'suv'].map((model, i) => carro(model, new THREE.Vector3(i * 6, 0, 3)));
  const { game, visual } = montar(cars);
  const escena = { tipo: 'cobro', trabajo: 'dulces', tiempo: 0, dur: 2.6,
    reacciones: cars.map((car, i) => ({ car, vehicle: game.traffic.vehicles[i], tipo: 'paga', t0: i * .35, pesos: 500 })) };
  game.rebusque.escena = escena;
  const sale = [null, null, null];
  for (let k = 0; k * (1 / 60) < 2.6; k++) {
    escena.tiempo = k / 60;
    visual.update(1 / 60);
    for (let i = 0; i < 3; i++) {
      if (sale[i] !== null || !visual._manosConductor[i]?.mano.visible) continue;
      sale[i] = escena.tiempo;
      assert.equal(cars[i]._driverWindowOpen, 1, `mano ${i + 1}: su vidrio ya estaba abajo`);
    }
  }
  assert.ok(sale.every(t => t !== null), `salieron las tres: ${sale}`);
  // Antes de esperar el vidrio salían con .35 s entre una y otra; la primera espera, pero ninguna sale a la vez que otra.
  assert.ok(sale[1] - sale[0] > .15, `la segunda sale después de la primera: ${sale}`);
  assert.ok(sale[2] - sale[1] > .15, `la tercera sale después de la segunda: ${sale}`);
  assert.ok(sale[2] <= .7 + 1e-9, `la tercera no se atrasa: ${sale[2]}`);
  visual.dispose();
});

test('sin el vidrio abajo, el mismo brazo sí lo atravesaría (la prueba de arriba mide algo)', () => {
  const car = carro('sedanPopular');
  const { game, visual } = montar([car]);
  const escena = { tipo: 'cobro', trabajo: 'dulces', tiempo: 1, dur: 2.6, reacciones: [{ car, vehicle: game.traffic.vehicles[0], tipo: 'paga', t0: 0, pesos: 500 }] };
  game.rebusque.escena = escena;
  visual.update(1 / 60);
  const slot = visual._manosConductor[0];
  assert.ok(slot.mano.visible);
  assert.ok(!cruzaVidrio(car, slot.brazo.position, slot.mano.position));
  car.setDriverWindow(0);
  assert.ok(cruzaVidrio(car, slot.brazo.position, slot.mano.position), 'con la ventana cerrada el antebrazo la cruza');
  visual.dispose();
});

test('si el cobro se corta con la ventana abajo, sube sola; y dispose la cierra de una', () => {
  const car = carro('hatchPopular');
  const { game, visual } = montar([car]);
  const entero = vidrioDe(car).geometry;
  game.rebusque.escena = { tipo: 'cobro', trabajo: 'malabares', tiempo: 1, dur: 2.6, reacciones: [{ car, vehicle: game.traffic.vehicles[0], tipo: 'excusa', t0: 0, pesos: 0 }] };
  visual.update(1 / 60);
  assert.equal(car._driverWindowOpen, 1);
  // Arranca otro trabajo: el cobro ya no la lleva.
  game.rebusque.escena = { tipo: 'malabares', tiempo: 0, dur: 5, ritmo: null, reacciones: [] };
  visual.update(.3);
  assert.ok(car._driverWindowOpen > 0 && car._driverWindowOpen < 1, `subiendo: ${car._driverWindowOpen}`);
  visual.dispose();
  assert.strictEqual(vidrioDe(car).geometry, entero, 'dispose la deja cerrada');
  assert.equal(visual._ventanas.size, 0);
});
