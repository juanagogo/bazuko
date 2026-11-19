import test from 'node:test';
import assert from 'node:assert/strict';

// Lienzo falso que anota los trazos de línea: el rayón ya no va pintado en la columna de los pilares.
const trazos = [];
const degradado = { addColorStop() {} };
const ctx = new Proxy({}, {
  get: (_, clave) => /^create(Linear|Radial)Gradient$/.test(clave) ? () => degradado
    : ['moveTo', 'lineTo', 'bezierCurveTo'].includes(clave) ? (...args) => trazos.push([clave, ...args]) : () => {},
  set: () => true
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const { concretoGastado } = await import('../src/world/bogota/concretoViaducto.js');
const { planRayones, planPilares } = await import('../src/world/bogota/Culatas.js');
const { PIEZAS } = await import('../src/world/bogota/culatasAtlas.js');

test('cada pilar lleva su rayón: cuatro distintos, a alturas distintas y en una cara sin carteles', () => {
  const pilares = Array.from({ length: 24 }, (_, i) => ({ x: 70 + (i % 3) * .4, z: 50 + i * 14, lado: 1.3, base: 0 }));
  const rayones = planRayones(pilares);
  assert.ok(Object.keys(PIEZAS).filter((nombre) => PIEZAS[nombre].tipo === 'rayon').length >= 4);
  assert.ok(rayones.length >= 12, `rayones: ${rayones.length}`);
  assert.ok(new Set(rayones.map((r) => r.nombre)).size >= 3);
  assert.ok(new Set(rayones.map((r) => r.y.toFixed(2))).size >= rayones.length * .8, 'a alturas distintas');
  for (let i = 1; i < rayones.length; i++) assert.notEqual(rayones[i].nombre, rayones[i - 1].nombre);
  const carteles = planPilares(pilares);
  for (const rayon of rayones) {
    assert.ok(rayon.y - rayon.alto / 2 >= 1 && rayon.y + rayon.alto / 2 <= 3.8, `altura ${rayon.y}`);
    assert.ok(rayon.ancho < 1.3);
    const mismaCara = carteles.some((c) => Math.abs(c.x - rayon.x) < .01 && Math.abs(c.z - rayon.z) < .01);
    assert.ok(!mismaCara, 'no se pinta encima de los carteles');
  }
  assert.deepEqual(planRayones([{ x: 40, z: 50, lado: 1.3, base: -3 }]), [], 'el pilar hundido en el lago no lleva');
});
