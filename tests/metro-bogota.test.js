// tests/metro-bogota.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, PerspectiveCamera, Raycaster, Triangle, Vector3 } from 'three';

import { buildMetroBogota, METRO, METRO_SPANS } from '../src/world/bogota/MetroBogota.js';
import { METRO_PERIOD, METRO_RUN } from '../src/world/bogota/MetroOperation.js';
import { FrustumCulling } from '../src/core/FrustumCulling.js';
import { COLPATRIA } from '../src/world/bogota/Colpatria.js';
import { SMALL_BUILDING } from '../src/world/bogota/SmallBuilding.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { trainRect } from '../src/world/bogota/MetroTrainTextures.js';
import { ZONA_NOMBRES } from '../src/ui/ZonaAviso.js';
import { cityLandmarks, cityMapPlan } from '../src/world/bogota/CityMapRaster.js';

test('MetroBogota: constantes y geometría del viaducto elevado', () => {
  assert.equal(METRO.x, 75, 'Eje central sobre la Avenida Caracas');
  assert.equal(METRO.trackHeight, 13.25, 'El tablero se eleva sobre el gálibo del bus');
  assert.ok(METRO.zEnd > METRO.zStart, 'Viaducto con longitud válida');
  assert.ok(METRO.deckWidth > 8, 'Ancho para doble vía');
});

test('MetroBogota: buildMetroBogota genera viaducto, tren, estaciones y colisiones', () => {
  const metroGroup = buildMetroBogota();

  assert.equal(metroGroup.name, 'MetroBogota');
  assert.ok(metroGroup.children.length > 0, 'Contiene elementos 3D');

  // Estaciones elevadas
  const st72 = metroGroup.getObjectByName('EstacionMetroCalle72');
  const st26 = metroGroup.getObjectByName('EstacionMetroCalle26');
  assert.ok(st72, 'Estación Calle 72 debe existir');
  assert.ok(st26, 'Estación Calle 26 debe existir');

  // Colisionadores para pilas
  const colliders = metroGroup.userData.colliders;
  assert.ok(Array.isArray(colliders) && colliders.length > 0, 'Debe registrar colisionadores para las pilas');
  for (const c of colliders) {
    assert.ok(c.box, 'Cada colisionador debe tener una Box3');
    assert.equal(c.box.min.x < c.box.max.x, true);
    assert.equal(c.box.min.z < c.box.max.z, true);
  }
});

test('MetroBogota: aviso de zona registrado y puntos en el mapa', () => {
  assert.ok(ZONA_NOMBRES.metro, 'La zona "metro" debe tener nombre asignado');
  assert.match(ZONA_NOMBRES.metro, /Metro de Bogotá/);

  const landmarks = cityLandmarks();
  const metroLandmarks = landmarks.filter(l => l.name.includes('Metro de Bogotá'));
  assert.ok(metroLandmarks.length >= 2, 'Deben registrarse al menos dos hitos del Metro en el mapa');
});

test('los tres vagones del tren de pruebas conservan la vía y cuatro puertas dobles por lado', () => {
  const metro = buildMetroBogota();
  const train = metro.userData.train.children;
  assert.equal(train.length, 3);
  const positions = [95, 76.4, 57.8].map(z => [76.9, METRO.trackHeight + 2, z]);
  const [u0, v0, u1, v1] = trainRect('amarillo');
  const trainBounds = new Box3();
  let meshes = 0;
  for (const [i, car] of train.entries()) {
    car.position.toArray().forEach((value, axis) => assert.ok(Math.abs(value - positions[i][axis]) < .001));
    const { position, uv } = car.getObjectByName('Puertas, ventanas y parabrisas').geometry.attributes;
    for (const side of [-1, 1]) {
      const edges = new Set();
      for (let j = 0; j < uv.count; j++) {
        if (position.getX(j) * side < 1.56) continue;
        if (uv.getX(j) < u0 - 1e-6 || uv.getX(j) > u1 + 1e-6 || uv.getY(j) < v0 - 1e-6 || uv.getY(j) > v1 + 1e-6) continue;
        edges.add(position.getZ(j).toFixed(4));
      }
      assert.equal(edges.size, 16, 'dos bordes amarillos por hoja en las cuatro puertas dobles');
    }
    car.traverse(object => { if (object.isMesh) meshes++; });
    trainBounds.expandByObject(car);
  }
  assert.equal(meshes, 19);
  assert.ok(Math.abs(trainBounds.min.z - 48.8) < .02 && Math.abs(trainBounds.max.z - 105.6) < .02);
  assert.ok(trainBounds.min.y >= METRO.trackHeight + .3 && trainBounds.max.y <= METRO.trackHeight + 4.05);
});

test('el tren recorre 125 metros por sentido, cambia las luces al arrancar y no salta ni reinicia', () => {
  const { train } = buildMetroBogota().userData;
  const cabSouth = train.getObjectByName('Faro cabina sur').material;
  const cabNorth = train.getObjectByName('Faro cabina norte').material;
  const center = () => train.position.z + METRO_RUN.initialCenter;
  const dt = .02, passes = Math.ceil(METRO_PERIOD / dt);
  let peak = 0, southPause = 0, northPause = 0, previous = center();
  let northbound = false, southbound = false;
  for (let i = 0; i < passes; i++) {
    train.userData.update(dt);
    const now = center(), speed = (now - previous) / dt;
    peak = Math.max(peak, Math.abs(speed));
    assert.ok(now >= METRO_RUN.northStop - 1e-7 && now <= METRO_RUN.stationStop + 1e-7);
    if (speed > 1e-5) { assert.equal(cabSouth.color.getHex(), 0xffefd4); assert.equal(cabNorth.color.getHex(), 0xea2a32); southbound = true; }
    if (speed < -1e-5) { assert.equal(cabNorth.color.getHex(), 0xffefd4); assert.equal(cabSouth.color.getHex(), 0xea2a32); northbound = true; }
    if (now === previous && Math.abs(now - METRO_RUN.stationStop) < 1e-7) southPause += dt;
    if (now === previous && Math.abs(now - METRO_RUN.northStop) < 1e-7) northPause += dt;
    previous = now;
  }
  assert.ok(southbound && northbound);
  assert.ok(Math.abs(peak - METRO_RUN.topSpeed) < 1e-6, 'la posición nunca salta más que un cuadro a velocidad máxima');
  assert.ok(Math.abs(southPause - METRO_RUN.stationPause) < .05);
  assert.ok(Math.abs(northPause - METRO_RUN.northPause) < .05);
  assert.ok(METRO_RUN.stationStop - METRO_RUN.northStop >= 2 * 56.8);

  const singleStep = buildMetroBogota().userData.train;
  singleStep.userData.update(passes * dt);
  assert.ok(Math.abs(singleStep.position.z - train.position.z) < 1e-8, 'independiente de la cadencia de cuadros');
});

test('las ruedas tocan su par de rieles y el volumen barrido queda libre entre los dos topes', () => {
  const metro = buildMetroBogota();
  metro.updateMatrixWorld(true);
  const { train } = metro.userData;
  const [north, south] = METRO_SPANS;
  const rails = metro.children.filter(mesh => mesh.material?.name === 'RielAcero');
  const railY = METRO.trackHeight + .31;
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 1);
  for (const rail of rails) {
    for (const [from, to] of METRO_SPANS) for (let z = from + .02; z < to; z += .52) {
      ray.ray.origin.set(rail.position.x, railY + .12, z);
      assert.ok(Math.abs(ray.intersectObject(rail, false)[0]?.point.y - railY) < 1e-5);
    }
    ray.ray.origin.set(rail.position.x, railY + .12, (north[1] + south[0]) / 2);
    assert.equal(ray.intersectObject(rail, false).length, 0);
  }
  for (const car of train.children) for (const side of [-1, 1]) {
    // El perfil inferior de cada rueda debe tocar el acero también en el centro de la cabeza del riel.
    const frame = car.getObjectByName('Franja y bastidor');
    ray.ray.direction.set(0, 1, 0);
    for (const bogie of [-5.86, 5.86]) for (const axle of [-.57, .57]) {
      ray.ray.origin.set(car.position.x + side * .7, railY - .015, car.position.z + bogie + axle);
      assert.ok(Math.abs(ray.intersectObject(frame, false)[0]?.point.y - railY) < .004);
    }
  }

  const sweep = new Box3().setFromObject(train, true).expandByScalar(.015);
  sweep.min.z += METRO_RUN.northStop - METRO_RUN.initialCenter;
  sweep.max.z += METRO_RUN.stationStop - METRO_RUN.initialCenter;
  assert.ok(sweep.min.z > north[0] + 2 && sweep.max.z < north[1] - 2, 'margen antes de los topes');
  const triangle = new Triangle(), bounds = new Box3();
  metro.traverse(mesh => {
    if (!mesh.isMesh || train.getObjectById(mesh.id) || rails.includes(mesh)) return;
    if (!sweep.intersectsBox(bounds.setFromObject(mesh))) return;
    const { index, attributes: { position } } = mesh.geometry;
    const vertex = (out, i) => out.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    for (let k = 0; k < (index?.count ?? position.count); k += 3) {
      vertex(triangle.a, k); vertex(triangle.b, k + 1); vertex(triangle.c, k + 2);
      assert.ok(!sweep.intersectsTriangle(triangle), mesh.name || mesh.material.name);
    }
  });
  for (const { z, depth } of [SMALL_BUILDING, COLPATRIA]) {
    assert.ok(north[1] < z - depth / 2 && south[0] > z + depth / 2);
  }
});

test('el acceso oriental de Calle 72 queda dentro de su huella anterior y separado del puente del bus', () => {
  const metro = buildMetroBogota();
  metro.updateMatrixWorld(true);
  const access = metro.getObjectByName('EstacionMetroCalle72').getObjectByName('Acceso oriental del Metro');
  const { min, max } = new Box3().setFromObject(access, true);
  assert.ok(min.x >= 82.049 && max.x <= 85.551 && min.z >= 112.749 && max.z <= 117.251);
  for (let z = min.z; z <= max.z; z += .12) for (let x = min.x; x <= max.x + .3; x += .12) {
    assert.equal(viaductSurface(x, z), null, 'la caja y el margen quedan fuera del tablero real');
  }
});

test('el descarte sigue al tren desde la estación hasta el Portal', () => {
  const { train } = buildMetroBogota().userData;
  const culling = new FrustumCulling();
  culling.register(train, { dynamic: train.userData.dynamicBounds === true, margin: 1 });
  const camera = new PerspectiveCamera(55, 1.6, .08, 45);
  camera.position.set(95, 4, METRO_RUN.northStop);
  camera.lookAt(76.9, METRO.trackHeight + 2, METRO_RUN.northStop);
  culling.apply(camera);
  assert.equal(train.visible, false, 'al empezar está junto a Calle 72');
  train.userData.update(38);
  culling.apply(camera);
  assert.equal(train.visible, true, 'la caja del convoy acompaña el movimiento hasta el Portal');
});
