import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildCityBackdrop } from '../src/world/bogota/CityBackdrop.js';
import { dressBackdropFrontages } from '../src/world/bogota/BackdropFacades.js';

const armar = () => buildCityBackdrop({ width: 400, height: 322, corridors: [], blocks: [], excluded: [] });

function sombreadores(material) {
  const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  return shader;
}

test('el suelo de fondo se pinta justo después del cielo, antes que la ciudad, y sin escribir profundidad', () => {
  const fondo = armar();
  const terreno = fondo.children.find(hijo => hijo.name === 'Suelo y cerros');
  assert.ok(Array.isArray(terreno.material) && terreno.material.length === 2);
  const [suelo, cerros] = terreno.geometry.groups;
  assert.equal(terreno.material[suelo.materialIndex].depthWrite, false);
  assert.equal(terreno.material[cerros.materialIndex].depthWrite, true);
  // El cielo va en -1000 y lo primero de la ciudad en -1: el suelo cabe en medio.
  assert.ok(terreno.renderOrder > -1000 && terreno.renderOrder < -1, `orden ${terreno.renderOrder}`);
  const altura = terreno.geometry.attributes.position, indice = terreno.geometry.index;
  for (let i = suelo.start; i < suelo.start + suelo.count; i++) assert.ok(altura.getY(indice.getX(i)) <= 0);
  assert.equal(suelo.start + suelo.count, cerros.start);
  assert.equal(cerros.start + cerros.count, indice.count);
});

test('la compresión de profundidad no toca lo que queda detrás de la cámara', () => {
  const fondo = armar();
  const bloques = fondo.children.find(hijo => hijo.name === 'Bloques de fondo');
  const terreno = fondo.children.find(hijo => hijo.name === 'Suelo y cerros');
  for (const material of [bloques.material, ...terreno.material]) {
    assert.match(sombreadores(material).vertexShader, /zn > 0\.9998 && gl_Position\.w > 0\./);
  }
});

test('los bloques de fondo llevan remate, cornisa y un tono por piso, y de lo alto sus luces no pasan del horizonte', () => {
  const bloques = armar().children.find(hijo => hijo.name === 'Bloques de fondo');
  const { fragmentShader } = sombreadores(bloques.material);
  assert.match(fragmentShader, /float floorTone/);
  assert.match(fragmentShader, /float coping/);
  assert.match(fragmentShader, /float cornice/);
  assert.match(fragmentShader, /highView \* smoothstep\(-\.05, -\.015, normalize\(vSkyFogRay\)\.y\)/);
});

test('armar el fondo gasta el mismo azar de la ciudad que antes', () => {
  const real = Math.random;
  let tiradas = 0;
  Math.random = () => { tiradas++; return real(); };
  try { armar(); } finally { Math.random = real; }
  assert.equal(tiradas, 56);
});

test('todo el fondo se pinta antes que la ciudad y al terminar deja la profundidad limpia', () => {
  const fondo = armar();
  const terreno = fondo.children.find(hijo => hijo.name === 'Suelo y cerros');
  const bloques = fondo.children.filter(hijo => hijo.name === 'Bloques de fondo');
  assert.ok(bloques.length > 0);
  // El cielo va en -1000 y lo primero de la ciudad en -1; el terreno es lo último del fondo.
  for (const malla of bloques) assert.ok(malla.renderOrder > -1000 && malla.renderOrder < terreno.renderOrder, `orden ${malla.renderOrder}`);
  assert.ok(terreno.renderOrder < -1);
  let limpiezas = 0;
  const renderer = { clearDepth: () => limpiezas++ };
  const [suelo, cerros] = terreno.geometry.groups;
  for (let cuadro = 0; cuadro < 3; cuadro++) {
    const [primero, segundo] = cuadro % 2 ? [suelo, cerros] : [cerros, suelo];
    terreno.onAfterRender(renderer, null, null, terreno.geometry, terreno.material[primero.materialIndex], primero);
    assert.equal(limpiezas, cuadro);
    terreno.onAfterRender(renderer, null, null, terreno.geometry, terreno.material[segundo.materialIndex], segundo);
    assert.equal(limpiezas, cuadro + 1);
  }
});

test('el suelo de fondo queda al fondo de todo: nunca pinta encima de un bloque ni de un cerro', () => {
  const terreno = armar().children.find(hijo => hijo.name === 'Suelo y cerros');
  const [suelo, cerros] = terreno.geometry.groups.map(grupo => terreno.material[grupo.materialIndex]);
  assert.match(sombreadores(suelo).vertexShader, /#include <fog_vertex>\s*gl_Position\.z = gl_Position\.w \* \.99999;/);
  assert.doesNotMatch(sombreadores(cerros).vertexShader, /gl_Position\.w \* \.99999/);
  assert.notEqual(suelo.customProgramCacheKey(), cerros.customProgramCacheKey());
});

test('las azoteas de fondo llevan pretil, sombra por dentro, manchas de agua y parches de manto', () => {
  const bloques = armar().children.find(hijo => hijo.name === 'Bloques de fondo');
  const { vertexShader, fragmentShader } = sombreadores(bloques.material);
  assert.match(vertexShader, /vBlockSize = sc\.xz;/);
  for (const parte of [/float parapet/, /float lee/, /float damp/, /float tar/, /float roofLod/]) assert.match(fragmentShader, parte);
});

test('las fachadas cercanas se subdividen sin invadir un lote vecino ni cambiar los hitos', () => {
  const color = [.52, .54, .54];
  const border = { x: 403, z: 92, w: 12, d: 12, h: 10.2, color };
  const corridor = { x: 416, z: 93, w: 28, d: 27, h: 9.2, color, streetSide: 0 };
  const park = { x: 94, z: 340, w: 21, d: 27, h: 8.7, color, streetSide: Math.PI / 2 };
  const sanctuary = { x: 1050, y: 144, z: 42, w: 25, d: 12, h: 9, color };
  const silhouette = { x: 404, z: 95, w: 25, d: 12, h: 42, color, closedOnly: true };
  const originals = [border, corridor, park, sanctuary, silhouette];
  const blocks = dressBackdropFrontages(originals, 400, 322, () => .42);
  assert.ok(blocks.includes(sanctuary) && blocks.includes(silhouette));
  assert.ok(blocks.some(b => b.frontage?.[0] === 3 && b.frontage[3] >= 1));
  assert.ok(blocks.some(b => b.frontage?.[0] === 1 && b.frontage[3] < 1));
  assert.ok(blocks.some(b => b.frontage?.[0] === 4 && b.frontage[2] !== 0));
  const openFlanks = blocks.filter(b => b.frontage?.[0] < 4 && b.frontage[2] > 0);
  assert.ok(openFlanks.length >= 2 && new Set(openFlanks.map(b => b.h)).size > 1);
  const bounds = b => {
    const turned = Math.abs(Math.sin(b.rotation ?? 0)) > .5;
    const w = turned ? b.d : b.w, d = turned ? b.w : b.d;
    return { left: b.x - w / 2, right: b.x + w / 2, front: b.z - d / 2, back: b.z + d / 2 };
  };
  const lots = blocks.filter(b => b.frontage);
  for (const p of lots) {
    const box = bounds(p);
    assert.ok([border, corridor, park].some(old => {
      const outer = bounds(old);
      return box.left >= outer.left - .001 && box.right <= outer.right + .001
        && box.front >= outer.front - .001 && box.back <= outer.back + .001 && (p.y ?? 0) + p.h <= old.h;
    }));
  }
  const bodies = lots.filter(b => b.frontage[0] < 4).map(bounds);
  for (let i = 0; i < bodies.length; i++) for (const b of bodies.slice(i + 1)) {
    const a = bodies[i];
    assert.ok(a.right <= b.left || a.left >= b.right || a.back <= b.front || a.front >= b.back);
  }
});
