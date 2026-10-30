import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeWebGPU} from '../src/core/WebGPU.js';
test('WebGPU requiere soporte y nunca acepta el backend WebGL',async()=>{
  let initialized=0,disposed=0;
  const r={async init(){initialized++;},backend:{isWebGPUBackend:true},dispose(){disposed++;}};
  await assert.rejects(initializeWebGPU(r,null),/WebGPU/);assert.equal(initialized,0);
  assert.equal(await initializeWebGPU(r,{}),r);
  r.backend.isWebGPUBackend=false;await assert.rejects(initializeWebGPU(r,{}),/WebGPU/);assert.equal(disposed,1);
  r.init=async()=>{throw new Error('adapter failed');};await assert.rejects(initializeWebGPU(r,{}),/iniciar WebGPU/);
});
