import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.window ??= new EventTarget();
const { Car } = await import('../src/entities/Car.js');
const { Game } = await import('../src/core/game.js');
const { makeVehicle, CAR_MODEL_IDS } = await import('../src/world/bogota/vehicles.js');
const { CAR_MODELS, LAMP } = await import('../src/world/bogota/carModels.js');
const { getCarBody } = await import('../src/world/bogota/VehicleBody.js');
const { makeSuv } = await import('../src/world/bogota/suv.js');
const { makeParkedMotos } = await import('../src/world/bogota/motos.js');
const { InteractionSystem } = await import('../src/systems/InteractionSystem.js');
const { PRUEBAS } = await import('../src/sala/pruebas.js');

const part = (vehicle, name) => vehicle.bodyVisual.children.find(mesh => mesh.name === name);
const kindOf = id => id === 'buseta' ? 'buseta' : 'carro';
const newCar = (options, rotation = 0, position = new THREE.Vector3()) => new Car(new THREE.Scene(), position, rotation, { variant: 3, ...options });
// Comparar carros o geometrías con assert.equal cuelga el informe si falla: imprimir uno recorre medio juego.
const same = (a, b, message) => assert.ok(a === b, message);

test('la calcomanía del taxi va bajo la franja de damero, sin que la tape', () => {
  const ray = new THREE.Raycaster(), point = new THREE.Vector3();
  for (const model of ['citadino', 'sedanPopular']) {
    const v = makeVehicle('taxi', 3, { beams: false, model }), lamp = part(v, 'Lámparas y placas');
    const { position, lamp: channel } = lamp.geometry.attributes, box = new THREE.Box3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      if (channel.getX(i) === LAMP.PLATE && point.z > .4 && Math.abs(point.x) < 1.2 && point.y < 1.2) box.expandByPoint(point);
    }
    assert.ok(!box.isEmpty(), `${model}: tiene calcomanía en la puerta`);
    let covered = 0;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 6; j++) {
      ray.set(new THREE.Vector3(box.min.x + (box.max.x - box.min.x) * (i + .5) / 12, box.min.y + (box.max.y - box.min.y) * (j + .5) / 6, 3), new THREE.Vector3(0, 0, -1));
      const hits = [];
      lamp.raycast(ray, hits);
      hits.sort((a, b) => a.distance - b.distance);
      if (hits[0] && channel.getX(hits[0].face.a) !== LAMP.PLATE) covered++;
    }
    assert.equal(covered, 0, `${model}: el damero tapa la calcomanía en ${covered} de 72 puntos`);
    v.dispose();
  }
});

test('la punta de la plumilla no asoma sobre el marco del vidrio, que baja hacia los lados', () => {
  for (const [id, spec] of Object.entries(CAR_MODELS)) {
    const v = makeVehicle(kindOf(id), 3, { beams: false, model: id }), body = getCarBody(id);
    v.group.updateMatrixWorld(true);
    for (const wiper of v.wipers) {
      const arm = wiper.children[0], { restAngle, sweepAngle } = wiper.userData;
      arm.geometry.computeBoundingBox();
      const { max } = arm.geometry.boundingBox;
      for (const phase of [0, .25, .5, .75, 1]) {
        wiper.rotation.z = restAngle + sweepAngle * phase;
        wiper.updateWorldMatrix(true, true);
        const tip = new THREE.Vector3(0, max.y, max.z).applyMatrix4(arm.matrixWorld);
        const frame = body.topY(spec.windshield[0], tip.z);
        assert.ok(tip.y <= frame, `${id} fase ${phase}: la punta queda ${((tip.y - frame) * 100).toFixed(1)} cm sobre el marco, en z ${tip.z.toFixed(2)}`);
      }
      wiper.rotation.z = restAngle;
    }
    v.dispose();
  }
});

test('las plumillas nacen al pie del vidrio y no se salen de él, ni en reposo ni barriendo', () => {
  const ray = new THREE.Raycaster();
  for (const [id, spec] of Object.entries(CAR_MODELS)) {
    const v = makeVehicle(kindOf(id), 3, { beams: false, model: id }), body = getCarBody(id);
    v.group.updateMatrixWorld(true);
    const [x0, x1] = spec.windshield, glassTop = body.topY(x0, 0), glassFoot = body.topY(x1, 0), halfWidth = body.edgeZ(x1);
    const surfaces = [part(v, 'Vidrios'), part(v, 'Molduras e interior'), v.bodyVisual];
    for (const wiper of v.wipers) {
      const arm = wiper.children[0], { restAngle, sweepAngle } = wiper.userData;
      arm.geometry.computeBoundingBox();
      const length = arm.geometry.boundingBox.max.y, normal = new THREE.Vector3(0, 0, 1).transformDirection(wiper.parent.matrixWorld);
      const base = new THREE.Vector3().setFromMatrixPosition(wiper.matrixWorld);
      assert.ok(base.y - glassFoot < .22, `${id}: la base queda ${(base.y - glassFoot).toFixed(2)} m sobre el pie del vidrio`);
      for (const phase of [0, .5, 1]) {
        wiper.rotation.z = restAngle + sweepAngle * phase;
        wiper.updateWorldMatrix(true, true);
        const tip = new THREE.Vector3(0, length, .016).applyMatrix4(arm.matrixWorld);
        assert.ok(tip.y <= glassTop + .015, `${id} fase ${phase}: la punta sube ${((tip.y - glassTop) * 100).toFixed(0)} cm sobre el vidrio`);
        assert.ok(Math.abs(tip.z) <= halfWidth + .01, `${id} fase ${phase}: la punta se sale del ancho del vidrio (z ${tip.z.toFixed(2)}, borde ${halfWidth.toFixed(2)})`);
        for (let i = 0; i <= 8; i++) {
          const sample = new THREE.Vector3(0, length * (.22 + .78 * i / 8), .016).applyMatrix4(arm.matrixWorld);
          ray.set(sample.clone().addScaledVector(normal, .6), normal.clone().negate());
          ray.far = 1.4;
          const hits = [];
          for (const surface of surfaces) surface.raycast(ray, hits);
          if (!hits.length) continue;
          const gap = Math.min(...hits.map(hit => hit.distance)) - .6;
          assert.ok(gap < .065 && gap > -.05, `${id} fase ${phase}: la plumilla queda a ${(gap * 100).toFixed(1)} cm de la superficie (+ flota, − enterrada)`);
        }
      }
      wiper.rotation.z = restAngle;
    }
    v.dispose();
  }
});

test('un parqueado está vacío: de noche sigue apagado y con lluvia no barre; quien circula sí', () => {
  const parked = newCar({ kind: 'taxi' }), moving = newCar({ kind: 'taxi', traffic: true }), patrol = newCar({ kind: 'police', traffic: true });
  const flaresOn = car => car.vehicle.flares.every(flare => flare.visible);
  for (const car of [parked, moving, patrol]) car.setNight(true, true);

  assert.equal(parked.vehicle.headlightMaterial.emissiveIntensity, .02);
  assert.ok(parked.vehicle.tailMat.color.r < .2, 'los pilotos del parqueado siguen en su tono de día');
  assert.equal(flaresOn(parked), false);
  const resting = parked.vehicle.wipers.map(wiper => wiper.rotation.z);
  parked.update(.5);
  assert.deepEqual(parked.vehicle.wipers.map(wiper => wiper.rotation.z), resting);

  for (const car of [moving, patrol]) {
    assert.equal(car.vehicle.headlightMaterial.emissiveIntensity, 1.35, car.kind);
    assert.ok(car.vehicle.tailMat.color.r > .9, car.kind);
    assert.ok(flaresOn(car) && car.vehicle.beam.visible, car.kind);
    const before = car.vehicle.wipers[0].rotation.z;
    car.animateDrive(0, false, { dt: .5, speed: 0 });
    assert.notEqual(car.vehicle.wipers[0].rotation.z, before, `${car.kind}: barre con lluvia`);
  }
  const blue = patrol.vehicle.policeLights.blue.color.getHex();
  patrol.animateDrive(0, false, { dt: .16, speed: 0 });
  assert.notEqual(patrol.vehicle.policeLights.blue.color.getHex(), blue, 'la patrulla sigue con su baliza');

  // Aguacero de día: el mismo reparto, con el faro más bajo en quien circula.
  parked.setNight(false, true); moving.setNight(false, true);
  assert.equal(parked.vehicle.headlightMaterial.emissiveIntensity, .02);
  assert.equal(moving.vehicle.headlightMaterial.emissiveIntensity, .8);
  for (const car of [parked, moving, patrol]) car.dispose();
});

test('el haz solo existe en quien circula: un parqueado no gasta un material en algo que no enciende', () => {
  const parked = newCar({}), moving = newCar({ traffic: true });
  same(parked.vehicle.beam, null, 'el parqueado no crea haz');
  assert.ok(moving.vehicle.beam?.isMesh);
  parked.setNight(true, false);
  parked.dispose(); moving.dispose();
});

test('el retrovisor enseña la luna a quien lo mira desde atrás y la carcasa desde adelante', () => {
  const ray = new THREE.Raycaster();
  for (const id of Object.keys(CAR_MODELS)) {
    const v = makeVehicle(kindOf(id), 3, { beams: false, model: id }), anchor = v.mirrorAnchors[1];
    const mirror = new THREE.Mesh(v.mirrorGeometry, v.trimMaterial), red = v.mirrorGeometry.attributes.color;
    mirror.updateMatrixWorld(true);
    const count = from => {
      const seen = { glass: 0, shell: 0 };
      for (let dy = -.1; dy <= .1; dy += .02) for (let dz = -.14; dz <= .14; dz += .02) {
        ray.set(new THREE.Vector3(anchor.x + from * 2, anchor.y + dy, anchor.z + dz), new THREE.Vector3(-from, 0, 0));
        ray.far = 4;
        const hits = [];
        mirror.raycast(ray, hits);
        if (!hits.length) continue;
        hits.sort((a, b) => a.distance - b.distance);
        seen[red.getX(hits[0].face.a) > .3 ? 'glass' : 'shell']++;
      }
      return seen;
    };
    const behind = count(-1), ahead = count(1);
    assert.ok(behind.glass > behind.shell, `${id}: desde atrás ${behind.glass} de luna y ${behind.shell} de carcasa`);
    assert.equal(ahead.glass, 0, `${id}: la luna no atraviesa la carcasa`);
    v.dispose();
  }
});

test('la camioneta negra lleva sus espejos, aunque no pase por Car', () => {
  const suv = makeSuv(), found = [];
  suv.group.traverse(object => { if (/retrovisores/.test(object.name)) found.push(object); });
  assert.equal(found.length, 1);
  found[0].geometry.computeBoundingBox();
  const { min, max } = found[0].geometry.boundingBox;
  assert.ok(min.z < -CAR_MODELS.camionetaNegra.W / 2 && max.z > CAR_MODELS.camionetaNegra.W / 2, 'uno a cada lado, por fuera de la carrocería');
  suv.dispose();
});

test('todos los modelos del tráfico muestran direccional por delante, cada una en su lado', () => {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const id of CAR_MODEL_IDS) {
    const v = makeVehicle(kindOf(id), 3, { beams: false, model: id }), geometry = part(v, 'Lámparas y placas').geometry;
    const { position, lamp } = geometry.attributes, index = geometry.index, area = { left: 0, right: 0, crossed: 0 };
    for (let i = 0; i < index.count; i += 3) {
      const channel = lamp.getX(index.getX(i));
      if (channel !== LAMP.LEFT && channel !== LAMP.RIGHT) continue;
      a.fromBufferAttribute(position, index.getX(i)); b.fromBufferAttribute(position, index.getX(i + 1)); c.fromBufferAttribute(position, index.getX(i + 2));
      if (a.x + b.x + c.x < 0) continue;
      const size = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2, z = a.z + b.z + c.z;
      if (channel === LAMP.LEFT && z < 0) area.left += size;
      else if (channel === LAMP.RIGHT && z > 0) area.right += size;
      else area.crossed += size;
    }
    assert.ok(area.left > .006 && area.right > .006, `${id}: ${Math.round(area.left * 1e4)} y ${Math.round(area.right * 1e4)} cm² de direccional delantera`);
    assert.equal(area.crossed, 0, `${id}: una direccional en el lado contrario`);
    v.dispose();
  }
});

test('las busetas del tráfico no llevan todas la misma ruta', () => {
  // TrafficSystem: una buseta cada 12 unidades, con semilla unidad × 37.
  const routes = [12, 24, 36, 48, 60, 72].map(unit => {
    const v = makeVehicle('buseta', unit * 37, { beams: false }), { routeIndex } = v;
    v.dispose();
    return routeIndex;
  });
  assert.notEqual(routes[0], routes[1], 'las dos de la partida difieren');
  assert.ok(new Set(routes).size >= 3, `salen las rutas ${routes}`);
  assert.ok(routes.every(route => Number.isInteger(route) && route >= 0 && route < 4));
});

test('el aviso de robar sale parado junto al espejo, también en los carros largos', () => {
  const input = { isDown: () => false, consumePress: () => false };
  for (const [model, kind] of [['buseta', 'buseta'], ['furgon', 'carro'], ['citadino', 'carro']]) {
    const car = newCar({ model, kind, traffic: true }, .7, new THREE.Vector3(12, 0, 20));
    car.group.updateMatrixWorld(true);
    // Pegado al espejo por fuera, del lado de la calle.
    const outward = new THREE.Vector3(0, 0, -.4).applyQuaternion(car.group.quaternion);
    const position = car.mirrors[0].position.clone().applyMatrix4(car.group.matrixWorld).add(outward).setY(0);
    const interaction = new InteractionSystem({ position }, {}, {}, { play() {} }, null, { getEffect: (_key, base) => base }, null);
    interaction.register(car);
    interaction.update(.016, input, { isNight: false });
    same(interaction.currentTarget, car, `${model}: el aviso sale junto al espejo`);
    assert.equal(interaction.currentTargetType, 'car', model);
    if (model === 'buseta') {
      // Con los espejos ya robados no hay nada que alcanzar allá: vuelve a contar el centro.
      car.used = true;
      interaction.update(.016, input, { isNight: false });
      same(interaction.currentTarget, null, 'sin espejos solo cuenta el centro');
      car.used = false;
    }
    // La basura a un metro sigue teniendo el turno, aunque el espejo esté más cerca.
    const trash = { position: position.clone().add(new THREE.Vector3(1, 0, 0)), harvest() {} };
    interaction.register(trash);
    interaction.update(.016, input, { isNight: false });
    same(interaction.currentTarget, trash, `${model}: el espejo no le quita el turno a lo que está más cerca`);
    // Y de un carro normal, el aviso no sale mucho más lejos que antes.
    interaction.targets.splice(interaction.targets.indexOf(trash), 1);
    const reach = car.mirrors[0].position.clone().applyMatrix4(car.group.matrixWorld).add(outward.clone().setLength(1.2)).setY(0);
    interaction.player = { position: reach };
    interaction.update(.016, input, { isNight: false });
    same(interaction.currentTarget, null, `${model}: a 1,2 m del espejo y lejos del centro no hay aviso`);
    car.dispose();
  }
});

test('el conductor se baja a la altura de su asiento; en la buseta, por la única puerta, la de la acera', () => {
  for (const id of CAR_MODEL_IDS) {
    const car = newCar({ model: id, kind: kindOf(id), traffic: true }), spec = CAR_MODELS[id], door = car.driverDoor();
    if (id === 'buseta') assert.ok(door.x > 3.09 && door.x < 3.59 && door.z > car.width / 2, `${id}: x ${door.x}, z ${door.z}`);
    else assert.ok(Math.abs(door.x - spec.driver.x) < .01 && door.z < -car.width / 2, `${id}: x ${door.x}, z ${door.z}`);
    car.dispose();
  }
  const local = newCar({ model: 'buseta', kind: 'buseta', traffic: true }), turned = newCar({ model: 'buseta', kind: 'buseta', traffic: true }, Math.PI / 2, new THREE.Vector3(5, 2, 7));
  const a = local.driverDoor(), b = turned.driverDoor();
  assert.ok(Math.abs(b.x - (5 + a.z)) < 1e-6 && Math.abs(b.z - (7 - a.x)) < 1e-6 && b.y === 2, 'el punto gira con el carro');
  local.dispose(); turned.dispose();
});

test('cada grupo de motos es un lote propio: el que no se ve no se dibuja', () => {
  const root = makeParkedMotos([
    { x: 0, z: 0, rot: 0, seed: 1, group: 1 }, { x: .95, z: 0, rot: 0, seed: 4, group: 1 },
    { x: 80, z: 40, rot: 1, seed: 7, group: 2 },
  ]);
  const [near, far] = root.children;
  assert.equal(root.children.length, 2);
  assert.deepEqual([near.count, far.count], [2, 1]);
  same(near.geometry, far.geometry, 'geometría compartida');
  same(near.material, far.material, 'material compartido');
  for (const lot of root.children) {
    assert.equal(lot.frustumCulled, true);
    assert.ok(lot.boundingSphere.radius < 3, `radio ${lot.boundingSphere.radius}`);
  }
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 50);
  camera.position.set(0, 2, 8); camera.lookAt(0, .5, 0); camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  assert.ok(frustum.intersectsObject(near));
  assert.ok(!frustum.intersectsObject(far));
  // Sin grupos, un lote: lo que usa la sala.
  assert.equal(makeParkedMotos([{ x: 0, z: 0, rot: 0 }, { x: 1, z: 0, rot: 0 }]).children.length, 1);

  // El juego los pone todos bajo el descarte por sectores.
  const registered = [];
  Game.prototype._registerRenderGroups.call({
    localLights: { refreshSources() {} }, renderer: { culling: { clear() {}, register: object => registered.push(object) } },
    world: { active: null }, cars: [], pickups: [], parkedMotos: root,
  });
  assert.ok(registered.length === 2 && registered[0] === near && registered[1] === far, 'cada lote registrado en el descarte');

  // Solo lo instanciado es de cada lote: geometría y material siguen en uso.
  const freed = { geometry: 0, material: 0, lots: 0 };
  near.geometry.addEventListener('dispose', () => freed.geometry++);
  near.material.addEventListener('dispose', () => freed.material++);
  for (const lot of root.children) lot.addEventListener('dispose', () => freed.lots++);
  root.dispose();
  assert.deepEqual(freed, { geometry: 0, material: 0, lots: 2 });
});

function salaDePrueba() {
  return {
    scene: new THREE.Scene(), updaters: new Set(), beforeRender: new Set(), setHour() {},
    ground: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()),
  };
}

test('en la sala se elige el modelo y se ve el mismo carro por sus tres lados', async () => {
  const sala = salaDePrueba(), { acciones, estado } = await PRUEBAS.find(p => p.id === 'vehiculos').montar(sala);
  const pulsar = texto => acciones.find(a => a.texto.includes(texto)).hacer(), { cars, filas, camara } = window.__flota;
  pulsar('Modelo siguiente');
  for (const vista of ['frente', 'cola', 'lado']) {
    pulsar(vista);
    assert.equal(camara.mira.x, cars[1].car.group.position.x, vista);
    assert.ok(estado().includes(filas[1].id) && estado().includes(vista), estado());
  }
  pulsar('Modelo anterior');
  assert.equal(camara.mira.x, cars[0].car.group.position.x);
  pulsar('Modelo anterior');
  assert.equal(camara.mira.x, cars.at(-1).car.group.position.x, 'da la vuelta a la fila');

  // Con el botón de lluvia las plumillas barren aunque el carro no se mueva.
  const wiper = cars[0].car.vehicle.wipers[0], rest = wiper.rotation.z;
  pulsar('Lluvia');
  for (const update of sala.updaters) update(.3);
  assert.notEqual(wiper.rotation.z, rest);
});

test('en la sala, el botón de luces de la prueba de carros sigue encendiendo', async () => {
  const sala = salaDePrueba(), { acciones } = await PRUEBAS.find(p => p.id === 'carros').montar(sala), flares = [];
  sala.scene.traverse(object => { if (object.name === 'Resplandor de faro') flares.push(object); });
  assert.equal(flares.length, 2);
  acciones[0].hacer();
  assert.ok(flares.every(flare => flare.visible));
  acciones[0].hacer();
  assert.ok(flares.every(flare => !flare.visible));
});
