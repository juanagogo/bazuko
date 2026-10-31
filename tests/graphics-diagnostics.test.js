import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphicsDiagnostics } from '../src/core/GraphicsDiagnostics.js';
import { frameStats } from '../src/core/PerfProbe.js';

test('los diagnósticos cuentan RenderObjects descartados y estados de nodos nuevos', () => {
  const data = new Map(), get = ro => (data.has(ro) || data.set(ro, {}), data.get(ro));
  const renderer = {
    _objects: { createRenderObject() { return { onDispose: () => {} }; } },
    _nodes: { get, getForRender(ro) { return get(ro).nodeBuilderState ??= {}; } }
  };
  const diagnostics = new GraphicsDiagnostics();
  diagnostics.attachRenderer(renderer);
  const a = renderer._objects.createRenderObject(), b = renderer._objects.createRenderObject();
  renderer._nodes.getForRender(a); renderer._nodes.getForRender(a); renderer._nodes.getForRender(b);
  a.onDispose();
  assert.deepEqual({ ...diagnostics.snapshot(), nodeBuildMs: 0 }, { programs: 0, pipelines: 0, renderObjects: 2, discarded: 1, nodeBuilds: 2, nodeBuildMs: 0 });
  diagnostics.dispose();
  renderer._objects.createRenderObject();
  assert.equal(diagnostics.renderObjects, 2);
});

test('las estadísticas de cuadro informan máximo, p95, p99 y cuadros sobre 500 ms', () => {
  const intervals = Array.from({ length: 100 }, (_, i) => i + 1);
  intervals.push(900);
  assert.deepEqual(frameStats(intervals), { frames: 101, max: 900, p95: 96, p99: 100, over500ms: 1 });
  assert.deepEqual(frameStats([]), { frames: 0, max: 0, p95: 0, p99: 0, over500ms: 0 });
});
