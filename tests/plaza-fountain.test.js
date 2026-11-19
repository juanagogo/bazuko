import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildFountain } from '../src/world/bogota/EastLandmarks.js';
import { FOUNTAIN } from '../src/world/bogota/EastZones.js';
import { FOUNTAIN_LEVELS, FOUNTAIN_LIPS } from '../src/world/bogota/PlazaFountainWater.js';

function mount(t) {
  const detail = new THREE.MeshStandardMaterial(), ashlar = new THREE.MeshStandardMaterial();
  const fountain = buildFountain({ detail, ashlar });
  fountain.updateMatrixWorld(true);
  t.after(() => fountain.traverse(object => {
    object.geometry?.dispose();
    object.material?.dispose();
  }));
  return { fountain, detail, water: fountain.userData.water };
}

function sourceOf(material) {
  const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader, fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
}

test('los pasos labrados quedan bajo la lámina y los labios la contienen entre los reboses', t => {
  const { fountain, water } = mount(t);
  const stone = fountain.children.find(child => child.material.name === 'Piedra mojada de la fuente');
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const heightAt = (r, angle, name) => {
    ray.ray.origin.set(FOUNTAIN.x + Math.sin(angle) * r, water.position.y + FOUNTAIN_LEVELS[name] + .23,
      FOUNTAIN.z + Math.cos(angle) * r);
    const hit = ray.intersectObject(stone)[0];
    assert.ok(hit, `piedra de ${name}`);
    return hit.point.y - water.position.y;
  };
  for (const [name, radius] of [['bowl', 1.477], ['crown', .622]]) {
    const { yaw, count } = FOUNTAIN_LIPS[name], level = FOUNTAIN_LEVELS[name];
    for (let i = 0; i < count; i++) {
      const heading = yaw + i * 2 * Math.PI / count;
      assert.ok(heightAt(radius, heading, name) < level);
      assert.ok(heightAt(radius, heading + Math.PI / count, name) > level);
    }
  }
});

test('cada chorro cruza su lámina donde nacen las ondas de impacto', t => {
  const { water } = mount(t);
  const { fountainImpacts: { value: impacts } } = sourceOf(water.material).uniforms;
  const { position, fountainFlow } = water.geometry.attributes;
  const tiers = Object.values(FOUNTAIN_LEVELS);
  let arrivals = 0;
  for (let i = 0; i < position.count; i++) {
    const layer = fountainFlow.getY(i);
    if (layer < 3 || layer >= 16 || fountainFlow.getZ(i) !== 1 || fountainFlow.getW(i) !== 0) continue;
    const opposite = i + 4;
    const center = vertex => (vertex(i) + vertex(opposite)) / 2;
    const tier = Math.floor((layer - 3) / 4);
    const x = center(j => position.getX(j)), y = center(j => position.getY(j)), z = center(j => position.getZ(j));
    const impact = impacts[layer - 3];
    assert.ok(Math.abs(y - tiers[tier]) < .00001);
    assert.ok(Math.hypot(x - impact.x, z - impact.y) < .00001);
    arrivals++;
  }
  assert.equal(arrivals, 10);
});

test('las gotas animadas caben en los límites de dibujo y regresan dentro del cuenco', t => {
  const { water } = mount(t);
  const { fountainShore: { value: shore } } = sourceOf(water.material).uniforms;
  const { boundingBox, attributes: { position, fountainFlow, fountainParticle } } = water.geometry;
  const tiers = Object.values(FOUNTAIN_LEVELS);
  const bounds = boundingBox.clone().expandByScalar(.00001);
  let count = 0;
  for (let i = 0; i < position.count; i++) {
    if (fountainFlow.getY(i) !== 16) continue;
    const vx = fountainParticle.getX(i), vy = fountainParticle.getY(i), vz = fountainParticle.getZ(i);
    const end = fountainFlow.getX(i);
    const at = time => new THREE.Vector3(position.getX(i) + vx * time,
      position.getY(i) + (vy - 4.905 * time) * time, position.getZ(i) + vz * time);
    for (const time of [0, Math.max(0, vy / 9.81), end]) assert.ok(bounds.containsPoint(at(time)));
    const landing = at(end);
    const tier = tiers.findIndex(level => Math.abs(landing.y - level) < .034);
    assert.ok(tier >= 0);
    assert.ok(Math.hypot(landing.x, landing.z) < shore.getComponent(tier));
    count++;
  }
  assert.ok(count > 0);
});

test('el agua sigue el reloj, la lluvia y la niebla del distrito, y la piedra propia recibe sombra', t => {
  const { fountain, detail, water } = mount(t);
  const wetStone = fountain.children.find(child => child.material.name === 'Piedra mojada de la fuente');
  const waterShader = sourceOf(water.material), stoneShader = sourceOf(wetStone.material);
  assert.ok(water.userData.visualOnly && wetStone.userData.visualOnly);
  assert.ok(fountain.children.some(child => child.material === detail && !child.userData.visualOnly));
  assert.equal(wetStone.material.map, detail.map);
  assert.ok(waterShader.uniforms.uSunField && stoneShader.uniforms.uSunField);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#726f69', 12, 120);
  water.userData.update(.125);
  water.userData.update(.25);
  water.userData.setRain(.68);
  water.onBeforeRender(null, scene);
  assert.equal(waterShader.uniforms.fountainTime.value, .375);
  assert.equal(waterShader.uniforms.fountainRain.value, .68);
  assert.ok(waterShader.uniforms.fountainHorizon.value.equals(scene.fog.color));
});
