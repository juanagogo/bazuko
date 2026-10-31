import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { GraphicsDiagnostics } from '../src/core/GraphicsDiagnostics.js';

globalThis.requestAnimationFrame ??= cb => setTimeout(cb, 0);

function fakeRenderer() {
  const drawn = [];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    quality: 'media', resolution: { pressure: 0 }, startupStats: {}, culling: { restore() {}, apply() {} },
    diagnostics: new GraphicsDiagnostics(), instance: { info: { reset() {} }, backend: { isWebGPUBackend: true }, shadowMap: { enabled: true } },
    _ensurePipeline(scene, camera, quality = this.effectiveQuality) { this.pipeline = { render: () => drawn.push(quality) }; },
    waitForGPU: async () => {}
  });
  return { renderer, drawn };
}

test('el calentamiento aplica cada calidad, dibuja cada vista y restaura la calidad elegida', async () => {
  const { renderer, drawn } = fakeRenderer(), applied = [], views = [];
  await renderer.warmup(new THREE.Scene(), new THREE.PerspectiveCamera(), new THREE.Group(), {
    applyQuality: q => applied.push(q), views: [() => views.push('iso') && 'iso', () => views.push('tercera') && 'tercera']
  });
  assert.deepEqual(applied, ['baja', 'media', 'alta', 'media']);
  assert.deepEqual(drawn, ['baja', 'baja', 'media', 'media', 'alta', 'alta']);
  assert.equal(views.length, 6);
  assert.ok(renderer.startupStats.fullWarmupMs >= 0);
});

test('si el calentamiento falla, vuelve a la calidad elegida', async () => {
  const { renderer } = fakeRenderer(), applied = [];
  renderer.waitForGPU = async () => { throw new Error('device lost'); };
  await assert.rejects(renderer.warmup(new THREE.Scene(), new THREE.PerspectiveCamera(), new THREE.Group(), { applyQuality: q => applied.push(q) }), /device lost/);
  assert.equal(applied.at(-1), 'media');
});

test('prepara solo las calidades solicitadas y la adaptacion no activa una sin preparar',async()=>{
 const {renderer,drawn}=fakeRenderer();renderer.quality='alta';
 await renderer.warmup(new THREE.Scene(),new THREE.PerspectiveCamera(),new THREE.Group(),{qualities:['alta','baja','alta']});
 assert.deepEqual(drawn,['alta','baja']);assert.deepEqual([...renderer.readyQualities],['alta','baja']);
 renderer.resolution.pressure=1;assert.equal(renderer.effectiveQuality,'baja');
 renderer.readyQualities.add('media');assert.equal(renderer.effectiveQuality,'media');
});

test('la verificación informa el trabajo que quedó pendiente después del calentamiento', async () => {
  const { renderer } = fakeRenderer();
  renderer.render = () => { renderer.diagnostics.programs += 2; renderer.diagnostics.discarded += 1; };
  const leftover = await renderer.verifyPrepared(new THREE.Scene(), new THREE.PerspectiveCamera(), null, [], [() => 'a', () => 'b']);
  assert.equal(leftover.programs, 4);assert.equal(leftover.discarded, 2);assert.equal(leftover.pipelines, 0);
  assert.deepEqual(renderer.startupStats.verification, leftover);
});
test('la variante temporal de efectos restaura su estado incluso si falla la GPU',async()=>{
 const {renderer}=fakeRenderer();renderer.effectsEnabled=true;let prepared;
 renderer.waitForGPU=async()=>{prepared=renderer.effectsEnabled;throw new Error('device lost');};
 await assert.rejects(renderer.warmup(new THREE.Scene(),new THREE.PerspectiveCamera(),new THREE.Group(),{effectsEnabled:false}),/device lost/);assert.equal(prepared,false);assert.equal(renderer.effectsEnabled,true);
});
