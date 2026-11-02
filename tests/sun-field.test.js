import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SunField, chainSunField, patchSunFieldShader, setNightGlow, registerNightGlow, sunFieldUniforms } from '../src/world/bogota/SunField.js';
import { Renderer } from '../src/core/Renderer.js';

const lit = () => ({
  uniforms: {},
  vertexShader: '#include <project_vertex>\nvoid main() {}',
  fragmentShader: '#include <lights_fragment_begin>\n#include <aomap_fragment>\n'
});

test('el parche encuentra sus anclas en los fragmentos de Three y no se aplica dos veces', () => {
  assert.ok(THREE.ShaderChunk.lights_fragment_begin.includes('getDirectionalLightInfo( directionalLight, directLight );'));
  const shader = lit();
  assert.equal(patchSunFieldShader(shader), true);
  assert.ok(shader.fragmentShader.includes('directLight.color *= sunFieldLit'));
  assert.ok(shader.fragmentShader.includes('indirectDiffuse *= sunFieldSky'));
  assert.equal(shader.uniforms.uSunField, sunFieldUniforms.uSunField, 'todos comparten el mismo uniforme');
  assert.equal(patchSunFieldShader(shader), false);
  const basic = { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
  assert.equal(patchSunFieldShader(basic), false, 'lo que no recibe luz queda intacto');
  assert.equal(basic.fragmentShader, 'void main() {}');
});

test('un material con shader propio encadena el campo y cambia su clave de programa', () => {
  const material = new THREE.MeshStandardMaterial();
  let own = 0;
  material.onBeforeCompile = () => { own++; };
  const before = material.customProgramCacheKey();
  chainSunField(material);
  assert.notEqual(material.customProgramCacheKey(), before);
  const shader = lit();
  material.onBeforeCompile(shader, null);
  assert.equal(own, 1);
  assert.ok(shader.fragmentShader.includes('sunFieldLit'));
});

test('una copa consulta el campo más allá de sus hojas y tiene su propio programa', () => {
  const plain = new THREE.MeshStandardMaterial(), canopy = new THREE.MeshStandardMaterial();
  plain.onBeforeCompile = canopy.onBeforeCompile = () => {};
  chainSunField(plain);
  chainSunField(canopy, 5);
  assert.notEqual(plain.customProgramCacheKey(), canopy.customProgramCacheKey());
  const near = lit(), far = lit();
  plain.onBeforeCompile(near, null);
  canopy.onBeforeCompile(far, null);
  assert.ok(far.fragmentShader.includes('#define SUN_FIELD_REACH 5.0'));
  assert.ok(!near.fragmentShader.includes('#define SUN_FIELD_REACH'));
  const key = canopy.customProgramCacheKey();
  chainSunField(canopy, 5);
  assert.equal(canopy.customProgramCacheKey(), key, 'encadenar dos veces no parchea dos veces');
});

test('una reja baja no quita cielo; un muro sí', () => {
  const skyBeside = height => {
    const field = new SunField({ x0: 0, z0: 0, width: 60, depth: 60 });
    field.fill(20, 22, 0, 60, height);
    field.bakeSky();
    const sky = field.skyAt(23, 30);
    field.dispose();
    return sky;
  };
  assert.ok(skyBeside(1.72) > .95, `reja: ${skyBeside(1.72)}`);
  assert.ok(skyBeside(3.9) < skyBeside(1.72), `cierre: ${skyBeside(3.9)}`);
});

/** La sombra exacta: el rayo hacia el sol a lo largo de toda la grilla, para comparar con el barrido O(N). */
function bruteShadow(field, x, z, lx, ly, lz) {
  const slope = ly / Math.hypot(lx, lz), dx = lx / Math.hypot(lx, lz), dz = lz / Math.hypot(lx, lz);
  let shadow = 0;
  for (let d = 0; d < 200; d += .25) {
    const px = Math.floor(x + dx * d - field.x0), pz = Math.floor(z + dz * d - field.z0);
    if (px < 0 || pz < 0 || px >= field.w || pz >= field.d) break;
    shadow = Math.max(shadow, field.heights[pz * field.w + px] - d * slope);
  }
  return shadow;
}

test('el barrido da la misma sombra que seguir cada rayo y cae del lado contrario al sol', () => {
  const field = new SunField({ x0: 0, z0: 0, width: 64, depth: 64 });
  field.fill(20, 30, 20, 30, 12);
  field.fill(40, 44, 10, 50, 6);
  field.bakeSky();
  for (const [lx, ly, lz] of [[1, 1, 0], [-.6, .8, .3], [.2, .5, -.8], [0, 1, 1]]) {
    const n = Math.hypot(lx, ly, lz);
    field.update(lx / n, ly / n, lz / n);
    let total = 0, count = 0;
    for (let z = 2; z < 62; z += 3) for (let x = 2; x < 62; x += 3) {
      total += Math.abs(field.shadowHeightAt(x + .5, z + .5) - bruteShadow(field, x + .5, z + .5, lx / n, ly / n, lz / n));
      count++;
    }
    assert.ok(total / count < .7, `error medio ${(total / count).toFixed(2)} m con el sol en ${lx},${ly},${lz}`);
  }
  field.update(Math.SQRT1_2, Math.SQRT1_2, 0);
  assert.ok(field.shadowHeightAt(15, 25) > 5, 'con el sol en +x la sombra cae hacia −x');
  assert.ok(field.shadowHeightAt(33, 25) < 1, 'y no hacia el lado del sol');
  field.dispose();
});

test('un sol casi quieto no recalcula: se paga un barrido por cada movimiento que se note', () => {
  const field = new SunField({ x0: 0, z0: 0, width: 32, depth: 32 });
  field.fill(10, 14, 10, 14, 8); field.bakeSky();
  field.update(.6, .8, 0);
  const sweeps = field.sweeps;
  field.update(.6, .8002, .0001);
  assert.equal(field.sweeps, sweeps);
  field.update(.5, .85, .1);
  assert.equal(field.sweeps, sweeps + 1);
  field.dispose();
});

test('el rincón entre muros y debajo de un puente ve menos cielo que la plaza abierta', () => {
  const field = new SunField({ x0: 0, z0: 0, width: 80, depth: 80 });
  field.fill(10, 30, 10, 14, 15);
  field.fill(50, 60, 50, 60, 6);
  field.cover(50, 60, 50, 60, 1);
  field.bakeSky();
  assert.ok(field.skyAt(20, 15) < field.skyAt(70, 20));
  assert.ok(field.skyAt(55, 55) < field.skyAt(70, 20));
  assert.ok(field.skyAt(70, 20) > .95);
  field.dispose();
});

test('solo la pasada principal de la ciudad usa el campo, aunque el render falle', () => {
  let during = null;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    culling: { apply() {}, restore() {} },
    silhouette: { render() {} },
    instance: { shadowMap: { enabled: false }, info: { reset() {} }, render() { during = sunFieldUniforms.uSunFieldOn.value; } }
  });
  renderer.render(scene, camera);
  assert.equal(during, 1);
  assert.equal(sunFieldUniforms.uSunFieldOn.value, 0);
  renderer.instance.render = () => { throw new Error('contexto perdido'); };
  assert.throws(() => renderer.render(scene, camera));
  assert.equal(sunFieldUniforms.uSunFieldOn.value, 0);
});

test('el renderer funde el mapa de entorno con la cantidad que le pide la escena y antes de dibujar', () => {
  const order = [], scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.userData.environmentDay = .4;
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    culling: { apply() {}, restore() {} },
    silhouette: { render() {} },
    environmentMix: { update: amount => order.push(amount) },
    instance: { shadowMap: { enabled: false }, info: { reset() {} }, render() { order.push('escena'); } }
  });
  renderer.render(scene, camera);
  assert.deepEqual(order, [.4, 'escena']);
});

test('la luz de los faroles no gasta llamadas de día', () => {
  const material = new THREE.MeshBasicMaterial();
  registerNightGlow(material);
  setNightGlow(0);
  assert.equal(material.visible, false);
  setNightGlow(.7);
  assert.equal(material.visible, true);
  assert.equal(material.opacity, .7);
  setNightGlow(0);
});
