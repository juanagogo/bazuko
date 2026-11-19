import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { TRACK_SHADE, buildAsphaltMask, dressAsphalt } from '../src/world/bogota/AsphaltDressing.js';

const T = 2;

/** Una calle de cuatro tiles que corre en z, entre dos andenes, cruzada a media altura por otra igual. */
function streets(size = 40) {
  return Array.from({ length: size }, (_, z) => Array.from({ length: size }, (_, x) =>
    (x >= 18 && x <= 21) || (z >= 18 && z <= 21) ? 'road' : 'sidewalk'));
}

const fakeShader = () => ({
  uniforms: {},
  vertexShader: '#include <project_vertex>',
  fragmentShader: '#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <lights_fragment_begin>\n#include <aomap_fragment>',
});

test('la máscara de la calzada mide un texel por metro y lleva cuatro canales', () => {
  const mask = buildAsphaltMask(streets());
  assert.equal(mask.image.width, 80);
  assert.equal(mask.image.height, 80);
  assert.equal(mask.image.data.length, 80 * 80 * 4);
  assert.equal(mask.format, THREE.RGBAFormat);
  assert.equal(mask.generateMipmaps, false);
  assert.deepEqual([mask.userData.width, mask.userData.depth], [80, 80]);
});

test('cada carril lleva sus huellas, la cuneta queda contra el sardinel y el cruce apaga las huellas', () => {
  const mask = buildAsphaltMask(streets()), { data, width } = mask.image;
  const at = (x, z, channel) => data[((z + T / 2) * width + x + T / 2) * 4 + channel];
  // La calle va de x = 35 a x = 43: centro en 39 y carriles centrados en 37 y 41.
  assert.ok(at(37, 8, 0) < 40, 'en el centro del carril la distancia es casi cero');
  assert.ok(at(39, 8, 0) > 80, 'en el eje de la calle se aleja de los dos carriles');
  assert.equal(at(37, 8, 0), at(40, 8, 0), 'los dos carriles son simétricos');
  assert.ok(at(35, 8, 2) < 40, 'junto al sardinel');
  assert.ok(at(39, 8, 2) > 200, 'y lejos de él en el eje');
  assert.ok(at(37, 8, 3) > 90, 'a media cuadra el cruce queda lejos');
  assert.ok(at(37, 30, 3) > 0 && at(37, 30, 3) < at(37, 8, 3), 'y se acerca al llegar a él');
  assert.equal(at(37, 38, 3), 0, 'y en el cruce no hay');
  assert.equal(at(10, 8, 3), 0, 'ni sobre el andén');
  assert.equal(at(10, 8, 1), 128, 'que queda con la edad neutra');
});

test('cada tramo de cuadra tiene su edad y la máscara no depende del azar', () => {
  const mask = buildAsphaltMask(streets()), { data, width } = mask.image;
  const age = (x, z) => data[((z + T / 2) * width + x + T / 2) * 4 + 1];
  assert.equal(age(36, 6), age(42, 30), 'un tramo, una edad');
  const ages = new Set([age(38, 8), age(38, 60), age(8, 38), age(60, 38), age(38, 38)]);
  assert.ok(ages.size >= 4, 'los cuatro tramos y el cruce no salen del mismo tono');
  assert.deepEqual(buildAsphaltMask(streets()).image.data, data);
});

test('vestir la calzada no gasta el azar del juego', () => {
  const games = Math.random;
  let asked = 0;
  Math.random = () => { asked++; return games(); };
  try {
    const map = streets();
    const road = new THREE.MeshStandardMaterial(), busway = new THREE.MeshStandardMaterial();
    const before = asked;
    dressAsphalt(road, map);
    dressAsphalt(busway, map, { slabs: true });
    assert.equal(asked, before);
  } finally { Math.random = games; }
});

test('calzada y troncal comparten un programa, leen la máscara y conservan el campo de sol', () => {
  const map = streets(), road = new THREE.MeshStandardMaterial(), busway = new THREE.MeshStandardMaterial();
  assert.equal(dressAsphalt(road, map), road);
  dressAsphalt(busway, map, { slabs: true });
  assert.equal(road.customProgramCacheKey(), busway.customProgramCacheKey());
  assert.equal(road.roughness, 1, 'la rugosidad del material no se toca: el mojado la sigue mandando');
  const shader = fakeShader(), slabs = fakeShader();
  road.onBeforeCompile(shader);
  busway.onBeforeCompile(slabs);
  for (const name of ['uAsphaltMask', 'uAsphaltMaskScale', 'uAsphaltSlab', 'uSunCloud']) assert.ok(shader.uniforms[name], name);
  assert.equal(shader.uniforms.uAsphaltSlab.value.x, 0);
  assert.equal(slabs.uniforms.uAsphaltSlab.value.x, 1);
  assert.equal(shader.uniforms.uAsphaltMask.value, slabs.uniforms.uAsphaltMask.value, 'una sola máscara por mapa');
  assert.deepEqual(Object.keys(road.userData), ['sunFieldChained'], 'nada pesado en userData: clonar el material lo copiaría');
  assert.match(shader.fragmentShader, /asphaltTrack/);
  assert.match(shader.fragmentShader, /roughnessFactor \*= /);
  assert.match(shader.fragmentShader, /vSunFieldPos/);
  assert.match(shader.fragmentShader, /sunFieldLit/, 'el campo de sol sigue encadenado');
  // La cuenta de pedidos no cambia: el viaducto y la terminal usan este mismo material y arriba no se viste.
  assert.match(shader.fragmentShader, /asphaltLow/);
});

test('de día la huella se lee como desgaste y no como pintura: oscurece poco y nunca se acumula', () => {
  const road = dressAsphalt(new THREE.MeshStandardMaterial(), streets());
  const busway = dressAsphalt(new THREE.MeshStandardMaterial(), streets(), { slabs: true });
  const shader = fakeShader(), slabs = fakeShader();
  road.onBeforeCompile(shader);
  busway.onBeforeCompile(slabs);
  const numero = '(-?[0-9.]+)';
  // Lo más que oscurece: la huella llena (tope 1) sobre el asfalto más viejo y sobre la losa.
  const asfalto = shader.fragmentShader.match(new RegExp(`asphaltTone \\*= 1\\. - min\\( asphaltTrack, 1\\. \\) \\* mix\\( ${numero}, ${numero}, asphaltOld \\);`));
  assert.ok(asfalto, 'la huella del asfalto tiene tope');
  const [nuevo, viejo] = [Number(asfalto[1]), Number(asfalto[2])];
  assert.ok(viejo > 0 && viejo <= .13, `el asfalto viejo oscurece ${viejo}`);
  assert.ok(Math.abs(nuevo) <= .05, `el recién pavimentado cambia ${nuevo}`);
  const losa = slabs.fragmentShader.match(new RegExp(`slabColor \\*= 1\\. - ${numero} \\* min\\( asphaltTrack, 1\\. \\);`));
  assert.ok(losa, 'la huella de la losa tiene tope');
  assert.ok(Number(losa[1]) > 0 && Number(losa[1]) <= .15, `la losa oscurece ${losa[1]}`);
  assert.deepEqual([viejo, nuevo, Number(losa[1])], [TRACK_SHADE.old, TRACK_SHADE.fresh, TRACK_SHADE.slab]);
  // La huella sigue: el brillo pulido es lo que la marca de noche bajo el farol.
  assert.match(shader.fragmentShader, /roughnessFactor \*= 1\. - \.22 \* min\( asphaltPolish, 1\. \);/);
});
