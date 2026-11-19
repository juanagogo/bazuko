// La sombra de las copas: va aparte de la de los muros, a media densidad y sin gastar programas ni pedidos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SunField, buildSunField, patchSunFieldShader, sunFieldUniforms } from '../src/world/bogota/SunField.js';
import { createUrbanTree } from '../src/world/bogota/UrbanTrees.js';

const SOL = [Math.SQRT1_2, Math.SQRT1_2, 0];
const campo = () => new SunField({ x0: 0, z0: 0, width: 64, depth: 64 });
const copa = field => {
  for (let z = 28; z < 33; z++) {
    field.crown(28, 33, z, z + 1, 6.5, 2.3);
    field.cover(28, 33, z, z + 1, .55);
  }
};

test('una copa sola no entra a la sombra maciza y deja su media sombra del lado contrario al sol', () => {
  const field = campo();
  copa(field); field.bakeSky();
  field.update(...SOL);
  for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) assert.equal(field.shadowHeightAt(x + .5, z + .5), 0);
  const [base, top] = field.canopyShadowAt(26.5, 30.5);
  assert.ok(top > 3 && top < 6.5, `tope ${top}`);
  assert.equal(base, 0, 'a dos metros del borde la sombra ya llega al piso');
  assert.equal(field.canopyShadowAt(36.5, 30.5), null, 'del lado del sol no hay sombra');
  assert.equal(field.canopyShadowAt(10.5, 30.5), null, 'ni más allá de donde la copa alcanza');
  assert.equal(field.canopyShadowAt(30.5, 40.5), null, 'ni a los lados');
  field.dispose();
});

test('con el sol bajo la luz pasa por debajo de la copa y la sombra cae lejos del pie', () => {
  const field = campo();
  copa(field); field.bakeSky();
  const el = 15 * Math.PI / 180;
  field.update(Math.cos(el), Math.sin(el), 0);
  const [base] = field.canopyShadowAt(31.5, 30.5);
  assert.ok(base > 1.5, `junto al tronco la base de la sombra sigue alta: ${base}`);
  const lejos = field.canopyShadowAt(14.5, 30.5);
  assert.ok(lejos && lejos[0] === 0 && lejos[1] > 1, `a 16 m la sombra toca el piso: ${lejos}`);
  field.update(0, 1, 0);
  assert.deepEqual(field.canopyShadowAt(30.5, 30.5), [0, 6.5], 'con el sol a plomo la sombra queda debajo');
  assert.equal(field.canopyShadowAt(26.5, 30.5), null);
  field.dispose();
});

test('un muro da la misma sombra con una copa al lado que sin ella', () => {
  const solo = campo(), junto = campo();
  for (const field of [solo, junto]) field.fill(40, 44, 10, 50, 9);
  copa(junto);
  for (const [lx, ly, lz] of [SOL, [-.6, .8, .3], [.2, .5, -.8], [0, 1, 0]]) {
    const n = Math.hypot(lx, ly, lz);
    solo.update(lx / n, ly / n, lz / n); junto.update(lx / n, ly / n, lz / n);
    assert.deepEqual(junto.shade, solo.shade);
  }
  assert.ok(junto.heights[30 * 64 + 30] > 2, 'la copa sigue contando como altura para quien la esquiva');
  assert.equal(junto.solid[30 * 64 + 30], 0);
  solo.dispose(); junto.dispose();
});

test('el cielo visible bajo una copa es el mismo que cuando la copa era un bloque', () => {
  const bloque = campo(), suelta = campo();
  for (const field of [bloque, suelta]) field.fill(10, 30, 10, 14, 15);
  for (let z = 28; z < 33; z++) { bloque.fill(28, 33, z, z + 1, 6.5); bloque.cover(28, 33, z, z + 1, .55); }
  copa(suelta);
  bloque.bakeSky(); suelta.bakeSky();
  for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) assert.equal(suelta.skyAt(x + .5, z + .5), bloque.skyAt(x + .5, z + .5));
  assert.ok(suelta.skyAt(30.5, 30.5) < suelta.skyAt(50.5, 50.5));
  bloque.dispose(); suelta.dispose();
});

test('la textura lleva muro, cielo, tope y base de copa en cuatro canales de un byte', () => {
  const field = campo();
  field.fill(4, 8, 10, 50, 9); copa(field); field.bakeSky();
  const el = 15 * Math.PI / 180;
  field.update(Math.cos(el), Math.sin(el), 0);
  assert.equal(field.texture.format, THREE.RGBAFormat);
  assert.equal(field.data.length, 64 * 64 * 4);
  const at = (x, z) => [...field.data.subarray((z * 64 + x) * 4, (z * 64 + x) * 4 + 4)];
  const [muro, cielo, tope, base] = at(31, 30);
  assert.equal(muro, 0);
  assert.equal(cielo, Math.round(field.skyAt(31.5, 30.5) * 255));
  assert.equal(tope, Math.round(6.5 * 255 / 48));
  assert.ok(base > 8 && base < Math.round(2.3 * 255 / 48) + 1, `base ${base}`);
  assert.deepEqual(at(50, 55).filter((_, canal) => canal !== 1), [0, 0, 0], 'a cielo abierto no hay muro ni copa');
  assert.equal(at(5, 30)[0], Math.round(9 * 255 / 48));
  field.dispose();
});

test('la media sombra usa un solo uniforme compartido y no cambia el programa de ningún material', () => {
  const plain = new THREE.MeshStandardMaterial();
  assert.equal(plain.customProgramCacheKey(), THREE.Material.prototype.onBeforeCompile.toString());
  assert.equal(plain.customProgramCacheKey(), 'function sunField(shader) { patchSunFieldShader(shader); }');
  const base = THREE.ShaderLib.standard;
  const one = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader };
  const two = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader };
  assert.ok(patchSunFieldShader(one) && patchSunFieldShader(two, 5));
  for (const shader of [one, two]) {
    assert.equal(shader.uniforms.uSunCanopyShade, sunFieldUniforms.uSunCanopyShade);
    assert.equal(shader.fragmentShader.split('uniform float uSunCanopyShade;').length, 2);
    assert.ok(shader.fragmentShader.includes('uSunCanopyShade * sunFieldCopa'));
    assert.ok(!/#define\s+\w*(COPA|CANOPY)/i.test(shader.fragmentShader), 'la fuerza no va en un #define');
  }
  const fuerza = sunFieldUniforms.uSunCanopyShade.value;
  assert.ok(fuerza > .4 && fuerza < .75, `la copa tapa a medias: ${fuerza}`);
  assert.equal(sunFieldUniforms.uSunField.value.image.data.length, 2, 'sin ciudad, cielo abierto: ningún azul que dé copa');
});

test('la media sombra va moteada con grano del mundo, solo donde hay copa, y de lejos se aplana', () => {
  const base = THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader };
  patchSunFieldShader(shader);
  const source = shader.fragmentShader;
  assert.equal(source.split('float sunFieldGrano(').length, 2, 'el grano se declara una vez');
  const branch = source.slice(source.indexOf('if ( sunFieldCopa > .004 )'), source.indexOf('float sunFieldLit'));
  assert.ok(branch.includes('sunFieldGrano('), 'el grano solo corre en los píxeles con copa');
  assert.ok(/smoothstep\( 30\.0, 70\.0, distance\( vSunFieldPos, cameraPosition \) \)/.test(branch));
  assert.ok(!source.slice(0, source.indexOf('if ( sunFieldCopa > .004 )')).includes('sunFieldGrano( sunFieldMota'));
  assert.ok(!/texture2D\(/.test(branch), 'sin consultas de textura de más');
  assert.equal(Object.keys(shader.uniforms).filter(name => name.startsWith('uSun')).length, Object.keys(sunFieldUniforms).length);
  assert.ok(!source.includes('uTime') && !branch.includes('foliageTime'), 'las manchas no se mueven con el viento');
});

test('en la ciudad cada árbol del plan va al canal de copa y ninguno al macizo', () => {
  const map = Array.from({ length: 60 }, () => Array.from({ length: 60 }, () => 'road'));
  const bare = buildSunField({ map, treePlan: [] });
  const trees = [{ x: 20, z: 96, scale: 1 }, { x: 31.4, z: 80.2, scale: 1.2 }, { x: 8, z: 70 }];
  const libre = trees.every(tree => bare.heights[Math.floor(tree.z - bare.z0) * bare.w + Math.floor(tree.x - bare.x0)] === 0);
  assert.ok(libre, 'los árboles de la prueba van en piso libre');
  const solid = bare.solid.slice();
  const field = buildSunField({ map, treePlan: trees });
  assert.deepEqual(field.solid, solid);
  for (const tree of trees) {
    const at = Math.floor(tree.z - field.z0) * field.w + Math.floor(tree.x - field.x0), scale = tree.scale ?? 1;
    assert.ok(Math.abs(field.canopy[at] - 6.5 * scale) < 1e-4);
    assert.ok(field.canopyBase[at] > 2 * scale && field.canopyBase[at] < 3 * scale);
    assert.equal(field.heights[at], field.canopy[at]);
    assert.ok(field.overhead[at] > .5);
  }
  field.update(...SOL);
  assert.equal(field.shadowHeightAt(20, 96), 0);
  assert.ok(field.canopyShadowAt(17.5, 96.5));
  field.dispose();
});

const hojas = plant => { let found; plant.traverse(o => { if (o.isMesh && o.geometry.attributes.treeWind) found = o.geometry; }); return found; };
const suma = array => { let total = 0; for (let i = 0; i < array.length; i++) total += array[i] * (1 + (i % 7)); return total; };

test('florece más o menos uno de cada nueve urapanes y arrayanes, en morado o amarillo, y ningún eucalipto', () => {
  for (const species of ['urapan', 'arrayan']) {
    const flores = { morada: 0, amarilla: 0 };
    for (let seed = 0; seed < 1000; seed++) {
      const { flower } = createUrbanTree(1, { seed, species }).userData.tree;
      if (flower) flores[flower]++;
    }
    const total = flores.morada + flores.amarilla;
    assert.ok(total >= 60 && total <= 180, `${species}: ${total} de 1000 en flor`);
    assert.ok(flores.morada > total * .3 && flores.amarilla > total * .3, `${species}: ${JSON.stringify(flores)}`);
  }
  for (let seed = 0; seed < 1000; seed++) assert.equal(createUrbanTree(1, { seed, species: 'eucalipto' }).userData.tree.flower, null);
});

test('la flor solo cambia el color de las ramillas de afuera: la forma de cada semilla es la de antes', () => {
  // Sumas tomadas con la semilla 4711 antes de que hubiera flor y verde propio de cada copa.
  const antes = { urapan: [21191.4652, 2203.8329], eucalipto: [13383.0508, 1727.8549], arrayan: [17578.5138, 1738.6573] };
  for (const [species, [position, color]] of Object.entries(antes)) {
    const plant = createUrbanTree(1, { seed: 4711, species }), geometry = hojas(plant);
    assert.equal(plant.userData.tree.flower, null);
    assert.ok(Math.abs(suma(geometry.attributes.position.array) - position) < .001, `${species}: posiciones`);
    assert.ok(Math.abs(suma(geometry.attributes.color.array) / color - 1) < .3, `${species}: el verde se mueve poco`);
  }
  let seed = 0;
  while (!createUrbanTree(1, { seed, species: 'urapan' }).userData.tree.flower) seed++;
  const flor = createUrbanTree(1, { seed, species: 'urapan' }), verde = createUrbanTree(1, { seed, species: 'eucalipto' });
  assert.equal(verde.userData.tree.flower, null);
  const morada = flor.userData.tree.flower === 'morada';
  const colors = hojas(flor).attributes.color;
  let cards = 0, flowered = 0;
  for (let i = 0; i < colors.count; i += 4) {
    cards++;
    const r = colors.getX(i), g = colors.getY(i), b = colors.getZ(i);
    // Una ramilla en flor deja de tener el verde por encima del rojo y del azul a la vez.
    if (morada ? b > g * .92 : r > g * 1.02) flowered++;
  }
  assert.ok(flowered > cards * .08 && flowered < cards * .5, `${flowered} de ${cards} ramillas en flor`);
  assert.equal(flor.userData.tree.leafCards, cards);
  for (const value of colors.array) assert.ok(value >= 0 && value < .6, `color apagado: ${value}`);
  for (const seed of [3, 17, 58, 101, 244, 377]) for (const species of ['urapan', 'arrayan']) {
    const all = hojas(createUrbanTree(1, { seed, species })).attributes.color;
    for (let i = 0; i < all.count; i++) {
      const max = Math.max(all.getX(i), all.getY(i), all.getZ(i)), min = Math.min(all.getX(i), all.getY(i), all.getZ(i));
      assert.ok(max < .6 && min > max * .12, `semilla ${seed}: ni quemado ni chillón (${max.toFixed(2)}, ${min.toFixed(2)})`);
    }
  }
});

test('cada copa tiene su verde: dos semillas vecinas no dan el mismo color medio y ninguna se sale de un verde apagado', () => {
  const medio = seed => {
    const colors = hojas(createUrbanTree(1, { seed, species: 'urapan' })).attributes.color, sum = [0, 0, 0];
    for (let i = 0; i < colors.count; i++) { sum[0] += colors.getX(i); sum[1] += colors.getY(i); sum[2] += colors.getZ(i); }
    return sum.map(value => value / colors.count);
  };
  const brillos = [], tonos = [];
  for (let seed = 100; seed < 160; seed++) {
    if (createUrbanTree(1, { seed, species: 'urapan' }).userData.tree.flower) continue;
    const [r, g, b] = medio(seed);
    assert.ok(g > r && g > b, `semilla ${seed}: sigue siendo verde`);
    assert.ok(g < .36, `semilla ${seed}: apagado (${g.toFixed(3)})`);
    brillos.push(g); tonos.push(r / b);
  }
  const rango = list => Math.max(...list) / Math.min(...list);
  assert.ok(rango(brillos) > 1.25 && rango(brillos) < 1.9, `claro y oscuro: ${rango(brillos).toFixed(2)}`);
  assert.ok(rango(tonos) > 1.3, `amarillo y azulado: ${rango(tonos).toFixed(2)}`);
});
