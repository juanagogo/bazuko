import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { SIGNAL_POLE } from '../src/world/bogota/SignalModel.js';
import { STREET_LAMP, createStreetLampGeometry } from '../src/world/bogota/StreetLampModel.js';
import { VIADUCT, viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { Banca } from '../src/world/props/Banca.js';
import { Farol } from '../src/world/props/Farol.js';

// La construcción completa usa geometría real; solo Canvas y personajes se sustituyen.
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');
const P = await import('../src/world/bogota/props.js');

const meshesOf = root => { const out = []; root.traverse(object => { if (object.isMesh) out.push(object); }); return out; };

test('el poste de alumbrado es más liviano que el GLB y sus partes son válidas sin DOM', () => {
  const geometry = createStreetLampGeometry();
  assert.ok(geometry.index.count / 3 <= 1000, `triángulos: ${geometry.index.count / 3}`);
  for (const name of Object.keys(geometry.attributes)) assert.ok(geometry.attributes[name].array.every(Number.isFinite), name);
  assert.ok(geometry.boundingBox.max.y <= STREET_LAMP.top + .01);
  assert.ok(geometry.boundingBox.max.x > STREET_LAMP.lens.x, 'la lente queda dentro de la luminaria');
  geometry.dispose();
});

test('los faroles sacan el brazo a su calzada, comparten una malla por sector y no agregan luces', async () => {
  const scene = new THREE.Scene(), city = new Bogota();
  city.build(scene, new CollisionSystem());
  await city.preloadDetails();

  const faroles = city.props.map(prop => prop.instance).filter(instance => instance instanceof Farol);
  assert.ok(faroles.length > 150);
  const armLength = STREET_LAMP.lens.x;
  const direction = farol => new THREE.Vector3(1, 0, 0).applyQuaternion(farol.group.quaternion);
  const armAt = (farol, reach) => farol.group.position.clone().addScaledVector(direction(farol), reach);

  for (const farol of faroles) {
    let lights = 0;
    farol.group.traverse(object => { if (object.isLight) lights++; });
    assert.equal(lights, 1, 'una sola luz por farol, la de siempre');
    const end = armAt(farol, 2);
    assert.equal(city.map[Math.round(end.z / 2)]?.[Math.round(end.x / 2)], 'road', `${farol.group.position.x},${farol.group.position.z}`);
    for (let reach = 0; reach <= armLength + .3; reach += .25) {
      const point = armAt(farol, reach), deck = viaductSurface(point.x, point.z);
      if (deck !== null) assert.ok(deck - VIADUCT.thickness > STREET_LAMP.top + .1, 'el poste cabe bajo el viaducto');
    }
  }

  // Sin postes pegados: ni dos faroles juntos ni un farol al lado de un semáforo.
  for (let i = 0; i < faroles.length; i++) {
    const { x, z } = faroles[i].group.position;
    for (let j = i + 1; j < faroles.length; j++) assert.ok(Math.hypot(x - faroles[j].group.position.x, z - faroles[j].group.position.z) > 8, `faroles junto a ${x},${z}`);
    for (const pole of city.signals.poles) assert.ok(Math.hypot(x - pole.x, z - pole.z) > 3.5, `semáforo junto a ${x},${z}`);
  }

  // Ningún brazo atraviesa el poste o el brazo de un semáforo.
  for (const pole of city.signals.poles.filter(entry => !entry.onRoadway)) {
    const ax = pole.hz, az = -pole.hx;
    for (const farol of faroles) {
      if (farol.group.position.distanceTo(new THREE.Vector3(pole.x, farol.group.position.y, pole.z)) > 7) continue;
      for (let reach = 0; reach <= armLength + .3; reach += .1) {
        const point = armAt(farol, reach);
        for (let along = 0; along <= SIGNAL_POLE.armLength; along += .1) {
          assert.ok(Math.hypot(point.x - pole.x - ax * along, point.z - pole.z - az * along) > .25, `${point.x},${point.z} contra ${pole.x},${pole.z}`);
        }
      }
    }
  }

  // Sigue el mismo camino de instancias: poste y resplandor, una malla de cada uno por sector.
  const batches = meshesOf(city._lampInstances).filter(mesh => mesh.isInstancedMesh);
  const poles = batches.filter(batch => !batch.material.isShaderMaterial), halos = batches.filter(batch => batch.material.isShaderMaterial);
  assert.equal(poles.length, halos.length);
  assert.ok(poles.length > 1, 'el descarte sigue siendo por sector');
  assert.equal(new Set(batches.map(batch => batch.geometry)).size, 2);
  assert.equal(new Set(batches.map(batch => batch.material)).size, 2);
  assert.equal(poles.reduce((total, batch) => total + batch.count, 0), faroles.length);
  assert.ok(poles.every(batch => batch.castShadow) && halos.every(batch => !batch.castShadow));

  // De día el resplandor no entra en la lista de dibujo; de noche la luz conserva su fuerza en el piso.
  const [farol] = faroles;
  city.setNightMode(false);
  assert.equal(halos[0].material.visible, false);
  assert.equal(farol.light.intensity, 0);
  city.setNightMode(true);
  assert.equal(halos[0].material.visible, true);
  assert.ok(farol.light.position.y > 5.5, 'la luz sale de la luminaria');
  const cutoff = 1 - (farol.light.position.y / farol.light.distance) ** 4;
  const atFeet = farol.light.intensity / farol.light.position.y ** farol.light.decay * cutoff ** 2;
  assert.ok(atFeet > .5 && atFeet < 2, `piso bajo el poste: ${atFeet}`);
  city.setNightMode(false);
  city.dispose(scene);
});

test('las bancas siguen fusionándose con listones separados y su clave para reservar suelo', () => {
  const banca = new Banca(new THREE.Vector3());
  const wood = banca.group.children.filter(child => child.material?.userData?.staticMergeKey === 'banca:madera');
  assert.ok(wood.length >= 5, 'listones sueltos, no un bloque');
  assert.ok(banca.group.children.every(child => ['banca:madera', 'banca:metal'].includes(child.material?.userData?.staticMergeKey)));
  const seatZ = wood.filter(child => Math.abs(child.position.y - .45) < .02).map(child => child.position.z).sort((a, b) => a - b);
  for (let i = 1; i < seatZ.length; i++) assert.ok(seatZ[i] - seatZ[i - 1] > .108, 'se ve la luz entre listones');
  const group = new THREE.Group();
  for (let i = 0; i < 6; i++) group.add(new Banca(new THREE.Vector3(4 + i * 3, 0, 4)).group); // dentro de un sector
  Bogota.prototype._mergeStatic.call({ group });
  assert.ok(meshesOf(group).length <= 2, 'madera y metal: dos lotes');
});

test('las placas de esquina comparten material, no tapan su texto y funcionan sin DOM', () => {
  const a = P.streetSign(['Calle 10', 'Carrera 15']), b = P.streetSign(['Calle 10', 'Av. Caracas']);
  const plates = root => meshesOf(root).filter(mesh => mesh.geometry.type === 'BoxGeometry' && mesh.geometry.parameters.width > .5);
  assert.equal(plates(a).length, 2);
  assert.equal(plates(a)[0].material, plates(b)[1].material);
  assert.equal(plates(a)[0].material.userData.staticMergeKey, plates(b)[0].material.userData.staticMergeKey);
  // Bandera: la lámina arranca fuera del tubo, así el poste no cruza las letras.
  a.updateMatrixWorld(true);
  for (const plate of plates(a)) {
    const { width } = plate.geometry.parameters, center = plate.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.hypot(center.x, center.z) > width / 2, 'el tubo no pasa por detrás del texto');
  }
  // Mismo nombre, misma celda del lienzo; otro nombre, otra celda.
  const uvRange = mesh => [...mesh.geometry.attributes.uv.array].sort().join();
  assert.equal(uvRange(plates(a)[0]), uvRange(plates(b)[0]));
  assert.notEqual(uvRange(plates(a)[1]), uvRange(plates(b)[1]));
});
