import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { ArticulatedBusRig } from '../src/world/bogota/ArticulatedBusRig.js';
import { busGeometry, busTriangleCount } from '../src/world/bogota/BusBody.js';
import { ARTICULATED_BUS_SIZE } from '../src/world/bogota/props.js';

const spec = JSON.parse(readFileSync(new URL('../public/models/bus-articulado/bus.json', import.meta.url), 'utf8'));

// Lo que medía el articulado antes de ensuciarlo: tiradas de azar al armar el primero y el segundo, mallas y triángulos.
const TIRADAS = [333, 217], MALLAS = 24, TRIANGULOS = 27888;

const armar = () => {
  const delJuego = Math.random;
  let tiradas = 0;
  Math.random = () => { tiradas++; return delJuego(); };
  try { return { rig: new ArticulatedBusRig({ spec }), tiradas: () => tiradas }; } finally { Math.random = delJuego; }
};

const primero = armar(), segundo = armar();

test('el articulado conserva su tamaño, el azar que gasta al armarse y sus pedidos de dibujo', () => {
  assert.deepEqual([primero.tiradas(), segundo.tiradas()], TIRADAS);
  assert.deepEqual({ ...ARTICULATED_BUS_SIZE }, { length: 22.1, width: 2.72 });
  const caja = new THREE.Box3();
  for (const section of busGeometry(spec).sections) { section.paint.computeBoundingBox(); caja.union(section.paint.boundingBox); }
  const medida = caja.getSize(new THREE.Vector3());
  assert.ok(Math.abs(medida.z - 22.094) < .01, `largo ${medida.z}`);
  assert.ok(Math.abs(medida.x - 2.72) < .01, `ancho ${medida.x}`);
  assert.ok(Math.abs(caja.max.y - 3.72) < .01 && Math.abs(caja.min.y - .42) < .01, `alto ${caja.min.y}…${caja.max.y}`);
  let mallas = 0;
  primero.rig.root.traverse(object => { if (object.isMesh) mallas++; });
  assert.equal(mallas, MALLAS, 'ni un pedido de dibujo más por bus');
  const triangulos = busTriangleCount(spec);
  assert.ok(triangulos <= TRIANGULOS * 1.15 && triangulos <= 30000, `triángulos ${triangulos}`);
});

test('el articulado lleva su propio mapa de mugre, sin repetirse a lo largo, con el techo en una zona mate', async () => {
  const { TECHO_UV, ESCAPE } = await import('../src/world/bogota/mugreArticulado.js');
  const { busTextures } = await import('../src/world/bogota/BusBody.js');
  assert.equal(busTextures().grime.wrapS, THREE.ClampToEdgeWrapping, 'el mapa no se repite cada pocos metros');
  let techo = 0;
  for (const section of busGeometry(spec).sections) {
    const uv = section.paint.attributes.uv, position = section.paint.attributes.position, normal = section.paint.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1, `uv ${uv.getX(i)}, ${uv.getY(i)}`);
      if (position.getY(i) > 3.3 && Math.abs(position.getX(i)) < 1 && normal.getY(i) > .9 && Math.abs(position.getZ(i)) < 10) {
        techo++;
        assert.ok(uv.getX(i) > TECHO_UV.u && uv.getY(i) < TECHO_UV.v, 'el techo cae en su zona');
      }
    }
  }
  assert.ok(techo > 100);
  const pintura = primero.rig.root.getObjectByName('paint 0').material;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  pintura.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('roughnessFactor = mix(roughnessFactor, .86, busMate)'), 'lo sucio y el techo quedan mates');
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb *= 1. - .1 * uMojado'), 'con aguacero la pintura sale mojada');
  // El escape asoma bajo la cola, del lado libre.
  const caucho = busGeometry(spec).sections[1].matte.attributes.position;
  let escape = 0;
  for (let i = 0; i < caucho.count; i++) {
    if (Math.hypot(caucho.getX(i) - ESCAPE.x, caucho.getY(i) - ESCAPE.y) < .06 && caucho.getZ(i) < -10.2) escape++;
  }
  assert.ok(escape >= 16, `vértices del escape: ${escape}`);
});

test('el fuelle es caucho gris percudido, con los pliegues más claros que los valles', () => {
  const color = busGeometry(spec).bellows.geometry.attributes.color, position = busGeometry(spec).bellows.geometry.attributes.position;
  const c = new THREE.Color();
  let claros = 0, oscuros = 0, n = 0;
  for (let i = 0; i < color.count; i++) {
    if (position.getY(i) < 1.6 || position.getY(i) > 2.6) continue;
    c.setRGB(color.getX(i), color.getY(i), color.getZ(i), THREE.LinearSRGBColorSpace);
    const hsl = c.getHSL({}, THREE.SRGBColorSpace);
    assert.ok(hsl.s < .2, 'gris, sin color');
    if (hsl.l > .25) claros++; else oscuros++;
    n++;
  }
  assert.ok(claros > n * .3 && oscuros > n * .3, `pliegues ${claros}, valles ${oscuros}`);
});

test('la defensa sale clara de base para que el mapa deje ver los raspones, y el umbral de las puertas va gastado', async () => {
  const { DEFENSA } = await import('../src/world/bogota/mugreArticulado.js');
  const c = new THREE.Color();
  const tono = (color, i) => { c.setRGB(color.getX(i), color.getY(i), color.getZ(i), THREE.LinearSRGBColorSpace); return c.getHSL({}, THREE.SRGBColorSpace); };
  const { color, position } = busGeometry(spec).sections[1].paint.attributes;
  let defensa = 0, umbral = 0;
  for (let i = 0; i < color.count; i++) {
    const y = position.getY(i), z = position.getZ(i);
    if (z < -10.9 && y > .45 && y < DEFENSA - .005 && Math.abs(position.getX(i)) < 1) {
      defensa++;
      assert.ok(tono(color, i).l > .25, `gris claro, el mapa la oscurece: ${tono(color, i).l.toFixed(2)}`);
    }
    if (Math.abs(y - .9) < 1e-3 && position.getX(i) > 1.2) {
      const { h, s } = tono(color, i);
      if (h > .1 && h < .17 && s > .3) { umbral++; assert.ok(s < .6, `amarillo gastado: saturación ${s.toFixed(2)}`); }
    }
  }
  assert.ok(defensa > 4 && umbral > 4, `defensa ${defensa}, umbral ${umbral}`);
});
