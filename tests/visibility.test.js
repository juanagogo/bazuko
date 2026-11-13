import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BuildingVisibility, createBuildingShell, LOOSE_MARGIN_IN, LOOSE_MARGIN_OUT } from '../src/world/bogota/BuildingVisibility.js';
import { PlayerSilhouette } from '../src/core/PlayerSilhouette.js';

function fixture() {
  const scene = new THREE.Scene();
  const visibility = new BuildingVisibility();
  const shared = new THREE.MeshStandardMaterial({ color: 'red' });
  const make = (x = 0) => {
    const shell = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), Array(6).fill(shared), {
      x, z: 0, height: 8, interiorMaterial: new THREE.MeshStandardMaterial({ color: '#675e50' })
    });
    scene.add(shell.root);
    return visibility.register(shell);
  };
  const building = make();
  const other = make(15);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const player = new THREE.Vector3(0, 0, -5);
  camera.position.set(0, 6, 9);
  camera.lookAt(player.clone().add(new THREE.Vector3(0, 1.1, 0)));
  camera.updateMatrixWorld(true);
  camera.userData.cameraMode = 'isometric';
  const advance = (frames = 60) => { for (let i = 0; i < frames; i++) visibility.update(1 / 60, player, camera); };
  return { scene, visibility, shared, building, other, camera, player, advance };
}

test('oculta las paredes que bloquean al jugador y el techo, conservando muros bajos y casas vecinas', () => {
  const f = fixture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), f.shared);
  ground.rotation.x = -Math.PI / 2;
  f.scene.add(ground);
  f.advance();
  assert.equal(f.building.roof.visible, false);
  assert.equal(f.building.walls.get(4).visible, false);
  assert.equal(f.building.walls.get(5).visible, false);
  assert.equal(f.building.walls.get(0).visible, true);
  assert.equal(f.building.walls.get(1).visible, true);
  assert.equal(f.building.base.visible, true);
  assert.ok(f.other.parts.every(part => part.opacity === 1));
  assert.equal(ground.material.opacity, 1);
  assert.equal(f.shared.opacity, 1);
  assert.equal(f.shared.onBeforeCompile.toString().includes('discard'), false);
});

test('las transiciones son graduales y una esquina no hace reaparecer la pared por un solo cuadro', () => {
  const f = fixture();
  f.advance(1);
  assert.ok(f.building.roofPart.opacity > 0 && f.building.roofPart.opacity < 1);
  f.advance();
  f.camera.position.x = 40;
  f.camera.lookAt(f.player);
  f.camera.updateMatrixWorld(true);
  f.advance(1);
  assert.equal(f.building.roofPart.opacity, 0);
  f.advance(13);
  assert.ok(f.building.roofPart.opacity > 0 && f.building.roofPart.opacity < 1);
  f.advance();
  assert.ok(f.building.parts.every(part => part.opacity === 1 && part.object.visible));
});

test('volver a tercera persona restaura inmediatamente todas las piezas y mantiene sus materiales aislados', () => {
  const f = fixture();
  f.advance();
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.equal(f.visibility.enabled, false);
  assert.ok(f.building.parts.every(part => part.object.visible && part.opacity === 1));
  for (const part of f.building.parts) for (const material of part.materials) {
    assert.notEqual(material, f.shared);
    assert.equal(material.transparent, false);
    assert.equal(material.depthWrite, true);
  }
});

test('la versión agrupada conserva triángulos y alterna sin duplicar edificios ni perder el recorte', () => {
  const f = fixture();
  const count = objects => {
    let total = 0;
    for (const object of objects) object.traverse(o => { if (o.isMesh) total += o.geometry.index.count; });
    return total;
  };
  const parts = f.visibility.buildings.flatMap(building => building.parts.map(p => p.object));
  const indices = count(parts);
  const batch = f.visibility.buildClosedView();
  f.scene.add(batch);
  assert.equal(count([batch]), indices);
  const originalBounds = new THREE.Box3();
  for (const part of parts) originalBounds.union(new THREE.Box3().setFromObject(part));
  assert.ok(new THREE.Box3().setFromObject(batch).equals(originalBounds));
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.equal(batch.visible, true);
  assert.ok(parts.every(p => !p.visible));
  assert.equal(drawnIndices(f.visibility), indices);
  f.camera.userData.cameraMode = 'isometric';
  f.advance();
  assert.equal(batch.visible, true, 'en isométrica los lotes siguen para lo que no tapa al jugador');
  assert.equal(f.building.roofPart.opacity, 0);
  assert.equal(f.building.loose, true);
  assert.equal(f.other.loose, false);
  assert.ok(f.other.parts.every(part => !part.object.visible), 'la casa lejana va en su lote, no suelta');
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.ok(parts.every(p => !p.visible));
  assert.equal(batch.visible, true);
  assert.equal(drawnIndices(f.visibility), indices);
  batch.traverse(o => { if (o.isMesh) assert.equal(o.material.opacity, 1); });
});

/** Índices que se dibujan: tramos de los lotes visibles más las piezas sueltas visibles. */
function drawnIndices(visibility) {
  let total = 0;
  visibility.closedView.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const { groups, index } = o.geometry;
    total += groups.length ? groups.reduce((sum, group) => sum + group.count, 0) : index.count;
  });
  for (const building of visibility.buildings) for (const part of building.parts) {
    if (part.object.visible) part.object.traverse(o => { if (o.isMesh && o.visible) total += o.geometry.index.count; });
  }
  return total;
}

test('isométrica: suelto solo el edificio de la línea de vista; cada triángulo una sola vez', () => {
  const f = fixture();
  const batch = f.visibility.buildClosedView();
  const total = drawnIndices(f.visibility);
  f.advance(1);
  assert.equal(f.building.loose, true);
  assert.equal(f.other.loose, false);
  // Cada lote deja de dibujar el tramo de la casa suelta: se oculta si solo tenía ese, o se parte en grupos.
  let split = 0, hidden = 0;
  for (const { mesh, ranges } of f.visibility._batches) {
    const own = ranges.filter(range => range.building === f.building), rest = ranges.length - own.length;
    if (!own.length) { assert.ok(mesh.visible && !mesh.geometry.groups.length && !Array.isArray(mesh.material)); continue; }
    if (!rest) { assert.equal(mesh.visible, false); hidden++; continue; }
    assert.ok(mesh.visible);
    assert.ok(Array.isArray(mesh.material) && mesh.material[0].opacity === 1);
    assert.equal(mesh.geometry.groups.reduce((sum, group) => sum + group.count, 0), ranges.filter(range => range.building !== f.building).reduce((sum, range) => sum + range.count, 0));
    split++;
  }
  assert.ok(split > 0, 'las dos casas comparten algún lote');
  assert.ok(f.building.parts.every(part => part.object.visible), 'antes de atenuarse, la casa suelta se ve entera');
  assert.equal(drawnIndices(f.visibility), total, 'nada duplicado ni perdido al soltar la casa');
  assert.deepEqual(f.visibility.isoStats, { sueltos: 1, lotesPartidos: split, lotesOcultos: hidden });
  // La atenuación sigue: el techo y las paredes que tapan se van; las otras quedan.
  f.advance();
  assert.equal(f.building.roofPart.opacity, 0);
  assert.equal(f.building.walls.get(4).visible, false);
  assert.equal(f.building.walls.get(0).visible, true);
  assert.ok(f.other.parts.every(part => part.opacity === 1));
});

test('isométrica: el margen de entrada y de salida evita alternar en el borde', () => {
  const f = fixture();
  f.visibility.buildClosedView();
  // Cámara alta mirando hacia abajo: la línea pasa al lado de la casa vecina, a una distancia que se controla.
  const at = gap => {
    // La caja de la otra casa llega hasta x 17 + 0,6; la línea vertical en x = 17,6 + gap no la toca.
    f.player.set(17.6 + gap, 0, 0);
    f.camera.position.set(17.6 + gap, 30, .01);
    f.camera.lookAt(f.player);
    f.camera.updateMatrixWorld(true);
    f.advance(1);
    return f.other.loose;
  };
  assert.equal(at(5), false);
  assert.equal(at(2), false, 'a 2 m todavía no entra');
  assert.equal(at(1), true, 'a menos de 1,5 m se suelta');
  assert.equal(at(2.5), true, 'entre los dos márgenes conserva lo que tenía');
  assert.equal(at(3.5), false, 'a más de 3 m vuelve al lote');
  assert.equal(at(2.5), false);
});

test('isométrica: la caja de las líneas descarta edificios lejanos sin cambiar cuáles se sueltan', () => {
  const visibility = new BuildingVisibility();
  const material = new THREE.MeshStandardMaterial();
  // Manzana de 5 × 5 casas; el jugador salta a sitios al azar con la cámara isométrica del juego.
  for (let i = 0; i < 25; i++) {
    visibility.register(createBuildingShell(new THREE.BoxGeometry(4, 8, 4), Array(6).fill(material), {
      x: (i % 5) * 7 - 14, z: Math.floor(i / 5) * 7 - 14, height: 8, interiorMaterial: material
    }));
  }
  visibility.buildClosedView();
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 200);
  camera.userData.cameraMode = 'isometric';
  const player = new THREE.Vector3(), offset = new THREE.Vector3(12, 16, 12);
  let seed = 7;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  const nearSight = visibility._nearSight.bind(visibility);
  let measured = 0, loose = 0, faded = 0;
  visibility._nearSight = (bounds, margin) => { measured++; return nearSight(bounds, margin); };
  for (let frame = 0; frame < 400; frame++) {
    // Pasos cortos y algún salto: hay casas que entran, que se atenúan y que vuelven al lote.
    if (frame % 40 === 0) player.set(random() * 36 - 18, 0, random() * 36 - 18);
    else player.x += .25;
    camera.position.copy(player).add(offset);
    camera.lookAt(player);
    camera.updateMatrixWorld(true);
    const before = visibility.buildings.map(b => ({ loose: b.loose, fading: b.parts.some(part => part.opacity < 1) }));
    visibility.update(1 / 30, player, camera);
    visibility.buildings.forEach((b, i) => {
      // Sin la caja: lo que decidiría la prueba de cada línea contra cada casa.
      const near = nearSight(b.bounds, before[i].loose ? LOOSE_MARGIN_OUT : LOOSE_MARGIN_IN);
      assert.equal(b.loose, near || (before[i].loose && before[i].fading), `cuadro ${frame}, casa ${i}`);
      if (b.loose) loose++;
      if (b.parts.some(part => part.opacity < 1)) faded++;
    });
  }
  assert.ok(loose > 0 && faded > 0, 'el recorrido suelta y atenúa casas');
  assert.ok(measured < 400 * 25 / 3, `solo se miden las casas cerca de las líneas (${measured})`);
});

test('isométrica: una casa que deja de tapar vuelve a su lote solo después de recuperar la opacidad', () => {
  const f = fixture();
  f.visibility.buildClosedView();
  f.advance();
  assert.equal(f.building.roofPart.opacity, 0);
  // El jugador se aleja: la línea de vista pasa a más de 3 m de la casa.
  f.player.set(0, 0, -10);
  f.camera.position.set(40, 6, -6);
  f.camera.lookAt(f.player);
  f.camera.updateMatrixWorld(true);
  f.advance(1);
  assert.equal(f.building.loose, true, 'el fundido de regreso se ve suelto');
  f.advance(13);
  assert.ok(f.building.roofPart.opacity > 0 && f.building.roofPart.opacity < 1);
  assert.equal(f.building.loose, true);
  f.advance();
  assert.ok(f.building.parts.every(part => part.opacity === 1));
  assert.equal(f.building.loose, false);
  assert.ok(f.building.parts.every(part => !part.object.visible));
  f.visibility.closedView.traverse(o => { if (o.isMesh) assert.equal(o.geometry.groups.length, 0); });
});

test('isométrica: lo transparente de los edificios en lotes sigue suelto, para ordenarse con las paredes atenuadas', () => {
  const f = fixture();
  // Como una mancha de humedad en la casa lejana: transparente, sin escribir profundidad.
  const stain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, opacity: .8 }));
  stain.position.set(17.1, 3, 0);
  stain.rotation.y = Math.PI / 2;
  const wall = f.other.walls.get(0);
  f.other.root.remove(wall);
  wall.add(stain);
  f.other.root.add(wall);
  f.visibility.buildings.length = 0;
  const other = f.visibility.register({ ...f.other, walls: f.other.walls });
  const building = f.visibility.register(f.building);
  const batch = f.visibility.buildClosedView();
  const stainBatch = f.visibility._batches.find(b => b.transparent);
  assert.ok(stainBatch, 'la mancha tiene su propio lote');
  const wallPart = other.wallParts.find(part => part.object === wall);
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.equal(stainBatch.mesh.visible, true);
  assert.equal(wallPart.object.visible, false);
  f.camera.userData.cameraMode = 'isometric';
  f.advance(1);
  const total = (() => { let t = 0; batch.traverse(o => { if (o.isMesh) t += o.geometry.index.count; }); return t; })();
  assert.equal(drawnIndices(f.visibility), total, 'la mancha se dibuja una vez, suelta');
  f.advance();
  assert.equal(building.loose, true);
  assert.equal(other.loose, false);
  assert.equal(stainBatch.mesh.visible, false, 'en isométrica la mancha no va en el lote');
  assert.equal(wallPart.object.visible, true);
  assert.equal(stain.visible, true);
  assert.ok(wall.children.filter(o => o !== stain).every(o => !o.visible), 'la pared opaca sigue en su lote');
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.equal(stainBatch.mesh.visible, true);
  assert.equal(wallPart.object.visible, false);
});

test('isométrica: una malla con varios materiales, que ningún lote incluye, sigue viéndose suelta', () => {
  const f = fixture();
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial()));
  sign.position.set(2.2, 3, 0);
  const wall = f.other.walls.get(0);
  wall.add(sign);
  f.visibility.buildings.length = 0;
  const other = f.visibility.register(f.other);
  f.visibility.register(f.building);
  f.visibility.buildClosedView();
  f.advance();
  assert.equal(other.loose, false);
  assert.ok(wall.visible && sign.visible, 'el aviso se dibuja aunque su casa vaya en lotes');
  assert.ok(wall.children.filter(o => o !== sign).every(o => !o.visible), 'la pared sigue en su lote');
});

test('sin lotes en isométrica (isoBatches = false) todo vuelve a verse suelto, como antes', () => {
  const f = fixture();
  const batch = f.visibility.buildClosedView();
  f.visibility.isoBatches = false;
  f.advance();
  assert.equal(batch.visible, false);
  assert.ok(f.other.parts.every(part => part.object.visible));
  assert.equal(f.building.roofPart.opacity, 0);
  f.visibility.isoBatches = true;
  f.advance(1);
  assert.equal(batch.visible, true);
  assert.equal(f.other.loose, false);
  assert.equal(f.building.loose, true);
});

test('el techo y las paredes separadas conservan altura, normales y un piso interior cerrado', () => {
  const f = fixture();
  const before = new THREE.Box3().setFromObject(f.building.root);
  assert.deepEqual(before.min.toArray(), [-2, 0, -2]);
  assert.deepEqual(before.max.toArray(), [2, 8, 2]);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
  const floor = ray.intersectObject(f.building.base, true);
  assert.ok(floor.length >= 1);
  assert.ok(Math.abs(floor[0].point.y - 0.65) < 1e-6);
  f.advance();
  assert.ok(f.building.base.children.every(mesh => mesh.geometry.attributes.normal && mesh.geometry.attributes.uv));
});

test('los tabiques de casas contiguas no se superponen al mostrar sus caras interiores', () => {
  const f = fixture();
  const neighbour = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), Array(6).fill(f.shared), {
    x: 4, z: 0, height: 8, interiorMaterial: f.shared
  });
  f.scene.add(neighbour.root);
  f.scene.updateMatrixWorld(true);
  const first = new THREE.Box3().setFromObject(f.building.walls.get(0));
  const second = new THREE.Box3().setFromObject(neighbour.walls.get(1));
  assert.ok(second.min.x - first.max.x > 0.02);
});

test('la cara interior de la fachada muestra ladrillo y conserva su escala, sin rótulos invertidos', () => {
  const brick = new THREE.MeshStandardMaterial({ color: 'red' });
  const facade = new THREE.MeshStandardMaterial({ color: 'blue' });
  const materials = Array(6).fill(brick);
  materials[4] = facade;
  const shell = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), materials, {
    x: 0, z: 0, height: 8, interiorMaterial: brick,
    facadeFace: 4, wallInteriorMaterial: brick, wallInteriorUV: [2, 2]
  });
  const visibility = new BuildingVisibility();
  visibility.register(shell);
  const wall = shell.walls.get(4);
  const outside = new THREE.Raycaster(new THREE.Vector3(0, 3, 5), new THREE.Vector3(0, 0, -1));
  const inside = new THREE.Raycaster(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, 1));
  assert.ok(outside.intersectObject(wall, true)[0].object.material.color.equals(facade.color));
  assert.ok(inside.intersectObject(wall, true)[0].object.material.color.equals(brick.color));
  const uv = wall.children[1].geometry.attributes.uv;
  assert.equal(Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i))), 4);
});

test('la silueta utiliza el modelo animado, solo detrás de obstáculos, sin alterar el render normal', () => {
  const overlay = new PlayerSilhouette();
  const scene = new THREE.Scene();
  const background = scene.background = new THREE.Color('#112233');
  const camera = new THREE.PerspectiveCamera();
  const light = new THREE.DirectionalLight();
  scene.add(light);
  const player = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  player.add(mesh);
  scene.add(player);
  const renderer = {
    autoClear: true, shadowMap: { autoUpdate: true }, calls: 0,
    render(s, c) {
      this.calls++;
      assert.equal(s.overrideMaterial, this.calls % 2 === 1 ? overlay.material : null);
      assert.equal(s.background, null);
      assert.equal(c.layers.mask, 2);
      assert.equal(this.autoClear, false);
      assert.equal(this.shadowMap.autoUpdate, false);
      assert.equal(light.layers.mask, 3);
    }
  };
  const material = mesh.material;
  overlay.render(renderer, scene, camera, player);
  assert.equal(renderer.calls, 2);
  assert.equal(overlay.material.depthFunc, THREE.GreaterDepth);
  assert.equal(overlay.material.depthWrite, false);
  assert.equal(mesh.material, material);
  assert.equal(mesh.layers.mask, 3);
  assert.equal(camera.layers.mask, 1);
  assert.equal(scene.overrideMaterial, null);
  assert.equal(scene.background, background);
  assert.equal(renderer.autoClear, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(light.layers.mask, 1);
  const loadedLater = new THREE.Mesh(new THREE.BoxGeometry(), material);
  player.add(loadedLater);
  overlay.render(renderer, scene, camera, player);
  assert.equal(loadedLater.layers.mask, 3);
});
