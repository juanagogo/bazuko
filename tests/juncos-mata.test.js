import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { buildLakeReeds, planLakeReeds, reedBlades } from '../src/world/bogota/LakeReeds.js';
import { LAKE_PARK, lakeTerrainHeight, onLakeBridge } from '../src/world/bogota/LakePark.js';

const LAGO = { lakeX: 100, lakeZ: 270, radiusX: 60, radiusZ: 40, surfaceY: -.3 };
const suelo = () => -.2;

test('los juncos crecen en mata: cepa apretada, hojas inclinadas hacia afuera y de largos distintos', () => {
  const matas = planLakeReeds(LAGO, suelo);
  let inclinadas = 0, hojas = 0;
  for (const mata of matas) {
    const lista = reedBlades(mata);
    assert.ok(lista.length >= 8);
    const largos = lista.map((hoja) => hoja.length);
    assert.ok(Math.max(...largos) / Math.min(...largos) >= 1.4, 'largos distintos en la misma mata');
    for (const hoja of lista) {
      hojas++;
      const desdeCepa = Math.hypot(hoja.bx - mata.x, hoja.bz - mata.z);
      const punta = Math.hypot(hoja.bx + hoja.lx - mata.x, hoja.bz + hoja.lz - mata.z);
      assert.ok(desdeCepa <= .11 + 1e-9, 'sale de la cepa');
      if (punta > desdeCepa + .1) inclinadas++;
      assert.ok(hoja.height < hoja.length + 1e-9 && hoja.lean >= .1);
    }
  }
  assert.ok(inclinadas / hojas > .8, `abiertas hacia afuera: ${inclinadas} de ${hojas}`);
});

test('la mata no se pasa de triángulos', () => {
  const juncos = buildLakeReeds(LAGO, suelo);
  // Antes de la mata eran 3509 en este lago de prueba.
  assert.ok(juncos.geometry.index.count / 3 <= 3509 * 1.1, `${juncos.geometry.index.count / 3} triángulos`);
});

test('las hojas y las espigas del lago reciben luz por la cara que mira al exterior', () => {
  const reeds = buildLakeReeds(LAKE_PARK, lakeTerrainHeight, onLakeBridge);
  const { index, attributes: { position, normal } } = reeds.geometry;
  const a = new Vector3(), ab = new Vector3(), ac = new Vector3();
  const lightingNormal = new Vector3(), n = new Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
    a.fromBufferAttribute(position, ia);
    ab.fromBufferAttribute(position, ib).sub(a);
    ac.fromBufferAttribute(position, ic).sub(a);
    lightingNormal.fromBufferAttribute(normal, ia)
      .add(n.fromBufferAttribute(normal, ib)).add(n.fromBufferAttribute(normal, ic));
    assert.ok(ab.cross(ac).dot(lightingNormal) >= 0, `cara invertida en el triángulo ${i / 3}`);
  }
  reeds.geometry.dispose();
  reeds.material.dispose();
});
