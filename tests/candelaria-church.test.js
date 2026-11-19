import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildChurch } from '../src/world/bogota/EastLandmarks.js';
import { CHURCH, CHURCH_STEPS, churchFootSupport, churchStepHeight } from '../src/world/bogota/EastZones.js';
import { BuildingVisibility } from '../src/world/bogota/BuildingVisibility.js';
import { createZoneMaterials } from '../src/world/bogota/ZoneGeometry.js';
import { ActionPose } from '../src/character/ActionPose.js';

const frontX = CHURCH.x0 * 2 - 1;
const centerZ = CHURCH.z0 + CHURCH.z1;
const halfWidth = CHURCH.z1 - CHURCH.z0 + 1;

test('las dos gradas del atrio coinciden con el suelo de la iglesia durante el recorte isométrico', () => {
  const { shell, height } = buildChurch(createZoneMaterials());
  assert.equal(height, 12.6);
  const view = new BuildingVisibility();
  const church = view.register(shell);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(frontX + 14, 16, centerZ + 8);
  camera.userData.cameraMode = 'isometric';
  const player = new THREE.Vector3(frontX - 1.8, .48, centerZ);
  camera.lookAt(player);
  camera.updateMatrixWorld();
  view.update(.4, player, camera);
  assert.equal(church.wallParts.some(part => !part.object.visible), true);
  const steps = shell.base.children.filter(mesh => mesh.name === 'Gradas del atrio');
  assert.ok(steps.length > 0 && steps.every(mesh => mesh.visible));
  const cast = (x, z) => new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0))
    .intersectObjects(steps)[0]?.point.y;
  for (const { depth, inset, top } of CHURCH_STEPS) {
    const x = frontX - depth + .02, z = centerZ + halfWidth - inset - .02;
    assert.equal(churchStepHeight(x, z), top);
    assert.ok(Math.abs(cast(x, z) - top) < .001);
  }
});

test('cada campanario mantiene el paso abierto bajo el arco y el testero tiene volumen', () => {
  const { shell } = buildChurch(createZoneMaterials());
  shell.root.updateMatrixWorld(true);
  const portal = shell.walls.get(1);
  const lookFromPlaza = (y, z) => new THREE.Raycaster(new THREE.Vector3(frontX - 2, y, z), new THREE.Vector3(1, 0, 0), 0, 2)
    .intersectObject(portal, true).length;
  for (const sign of [-1, 1]) {
    const towerCenter = centerZ + sign * (halfWidth - 3.1);
    assert.equal(lookFromPlaza(18.76, towerCenter), 0);
    assert.ok(lookFromPlaza(20.46, towerCenter + .95) > 0);
  }
  assert.ok(shell.walls.get(0).getObjectByName('Testero de iglesia').geometry.boundingBox.max.x > (CHURCH.x1 - CHURCH.x0 + 1));
});

function stepPose(x, y, z, rotation, action = null, attack = null) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  root.rotation.y = rotation;
  const hips = new THREE.Bone(), rig = { hips };
  hips.position.y = .89;
  root.add(hips);
  for (const [side, direction] of [['left', 1], ['right', -1]]) {
    const thigh = new THREE.Bone(), knee = new THREE.Bone(), ankle = new THREE.Bone(), toe = new THREE.Bone();
    thigh.position.x = .11 * direction;
    thigh.rotation.x = direction > 0 ? -.43 : .24;
    knee.position.y = ankle.position.y = -.4;
    knee.rotation.x = direction > 0 ? .48 : .08;
    toe.position.set(0, -.035, .131);
    toe.name = `${side}ToeBase`;
    hips.add(thigh); thigh.add(knee); knee.add(ankle); ankle.add(toe);
    rig[`${side}UpLeg`] = thigh; rig[`${side}Leg`] = knee; rig[`${side}Foot`] = ankle;
  }
  const pose = new ActionPose(rig, { frame: root });
  const toePositions = () => ['leftFoot', 'rightFoot'].map(name => rig[name].children[0].getWorldPosition(new THREE.Vector3()));
  const before = toePositions(), footSupport = churchFootSupport(x, z);
  const active = pose.apply(1 / 60, { speed: 1.65, action, attack, movement: { grounded: true, footSupport } });
  if (active) pose.fitFeetToSteps(footSupport, y);
  return { root, before, after: toePositions(), active };
}

test('la punta se levanta al primer escalón y el otro pie conserva su apoyo en la plaza', () => {
  const edge = frontX - CHURCH_STEPS[0].depth;
  const { root, before, after, active } = stepPose(edge - .13, .12, centerZ, Math.PI / 2);
  assert.ok(active);
  assert.ok(before[0].x > edge && before[0].y < .3);
  assert.ok(after[0].y >= .3);
  assert.ok(after[1].distanceTo(before[1]) < 1e-6);
  const contact = stepPose(edge - .13, .12, centerZ, Math.PI / 2, 'golpear',
    { weapon: 'punos', step: 1, phase: 'active', progress: 0 });
  assert.ok(contact.active && contact.after.every((foot, i) => foot.distanceTo(after[i]) < 1e-6),
    'la mano que golpea no le quita su escalón a ninguno de los zapatos');
  assert.deepEqual(root.position.toArray(), [edge - .13, .12, centerZ]);
});

test('al bajar se extiende el pie adelantado y al caminar por el costado se respeta el borde de piedra', () => {
  const lower = CHURCH_STEPS[0], edge = frontX - lower.depth;
  const down = stepPose(edge + .13, lower.top, centerZ, -Math.PI / 2);
  assert.ok(down.active && down.after[0].y < down.before[0].y - .02);
  assert.ok(down.after[1].distanceTo(down.before[1]) < 1e-6);
  const outside = stepPose(edge + .14, .12, centerZ + halfWidth - lower.inset + .32, Math.PI / 2);
  assert.ok(outside.active);
  assert.ok(outside.after.every((p, i) => p.distanceTo(outside.before[i]) < 1e-6));
  assert.equal(churchFootSupport(frontX - lower.depth - 1, centerZ), null);
});
