import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { GRADO, codigoDelGrado, gradoDeColor, mapeoDeGrado } from '../src/core/gradoColor.js';

const DIA = .8, NUBLADO = 1.05, NOCHE = 1.22;
const luma = ([r, g, b]) => r * .2126 + g * .7152 + b * .0722;
const gris = value => [value, value, value];
const aPantalla = value => (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055);
function matiz(color) {
  const [r, g, b] = color.map(aPantalla);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  return (hue * 60 + 360) % 360;
}
const saturacion = color => {
  const max = Math.max(...color), min = Math.min(...color);
  return max === 0 ? 0 : (max - min) / max;
};

test('el grado se instala en el trozo de three y el juego usa la curva propia', () => {
  const fabrica = THREE.ShaderChunk.tonemapping_pars_fragment;
  const chunks = { tonemapping_pars_fragment: fabrica };
  assert.equal(mapeoDeGrado(chunks), THREE.CustomToneMapping);
  const propio = chunks.tonemapping_pars_fragment;
  assert.ok(!propio.includes('vec3 CustomToneMapping( vec3 color ) { return color; }'));
  assert.equal(propio.split('vec3 CustomToneMapping(').length, 2, 'una sola definición');
  assert.ok(propio.includes('ACESFilmicToneMapping( color )'), 'parte de la curva fílmica');
  assert.ok(propio.indexOf('vec3 ACESFilmicToneMapping(') < propio.indexOf('vec3 CustomToneMapping('));
  // Instalar dos veces no cambia nada.
  assert.equal(mapeoDeGrado(chunks), THREE.CustomToneMapping);
  assert.equal(chunks.tonemapping_pars_fragment, propio);
  // El resto del trozo queda como venía.
  assert.equal(propio.replace(codigoDelGrado(), 'vec3 CustomToneMapping( vec3 color ) { return color; }'), fabrica);
});

test('si three cambia su trozo, el juego sigue con la curva fílmica y no queda sin curva', () => {
  const chunks = { tonemapping_pars_fragment: 'uniform float toneMappingExposure;' };
  assert.equal(mapeoDeGrado(chunks), THREE.ACESFilmicToneMapping);
  assert.equal(chunks.tonemapping_pars_fragment, 'uniform float toneMappingExposure;');
  assert.equal(mapeoDeGrado({}), THREE.ACESFilmicToneMapping);
  assert.equal(mapeoDeGrado(null), THREE.ACESFilmicToneMapping);
});

test('el código del sombreador está bien formado y no pide uniformes nuevos', () => {
  const code = codigoDelGrado();
  for (const [open, close] of [['(', ')'], ['{', '}']]) {
    assert.equal(code.split(open).length, code.split(close).length, `${open}${close} en pares`);
  }
  assert.ok(!/\buniform\b|\bvarying\b|texture/.test(code));
  // GLSL ES no convierte enteros a reales: todo número lleva punto.
  const sinNombres = code.replace(/\/\/.*$/gm, '').replace(/[A-Za-z_][A-Za-z0-9_]*/g, ' ');
  for (const number of sinNombres.match(/[0-9.]+/g)) assert.ok(number.includes('.'), `«${number}» sin punto`);
  assert.ok(code.includes('toneMappingExposure'));
});

test('el pie hunde los negros sin empastar: la curva siempre crece, de día y de noche', () => {
  for (const exposicion of [DIA, NUBLADO, NOCHE]) {
    assert.deepEqual(gradoDeColor(gris(0), exposicion), gris(0));
    let antes = -1;
    for (let i = 1; i <= 400; i++) {
      const ahora = luma(gradoDeColor(gris(i / 400), exposicion));
      assert.ok(ahora > antes, `sube en ${i / 400} con exposición ${exposicion}`);
      antes = ahora;
    }
  }
  // Un gris oscuro (asfalto en sombra) baja al menos una cuarta parte; un gris medio alto queda casi igual.
  assert.ok(luma(gradoDeColor(gris(.03), DIA)) < .03 * .75);
  assert.ok(luma(gradoDeColor(gris(.07), DIA)) < .07 * .8);
  assert.ok(Math.abs(luma(gradoDeColor(gris(.5), DIA)) - .5) < .02);
  // Y no llega a negro: lo oscuro conserva detalle. De noche, donde casi todo es sombra, el pie baja menos.
  assert.ok(luma(gradoDeColor(gris(.03), NOCHE)) > .03 * .7);
  assert.ok(luma(gradoDeColor(gris(.03), NOCHE)) > luma(gradoDeColor(gris(.03), DIA)));
});

test('nada se quema: lo claro no sube y el blanco sigue siendo blanco', () => {
  for (const exposicion of [DIA, NOCHE]) {
    const blanco = gradoDeColor(gris(1), exposicion);
    assert.ok(Math.min(...blanco) >= .94 && Math.max(...blanco) <= 1);
    for (const color of [[.95, .9, .6], [.9, .2, .15], [.2, .5, .95], [.98, .97, .9]]) {
      const out = gradoDeColor(color, exposicion);
      assert.ok(Math.max(...out) <= Math.max(...color) + 1e-9, `${color} no gana brillo`);
    }
  }
});

test('de día la sombra queda apenas fría y la alta apenas cálida', () => {
  const [sr, , sb] = gradoDeColor(gris(.04), DIA);
  assert.ok(sb > sr && sb / sr < 1.2);
  const [ar, , ab] = gradoDeColor(gris(.85), DIA);
  assert.ok(ar > ab && ar / ab < 1.08);
});

test('de noche la penumbra pierde naranja y lo que alumbra el farol sigue cálido', () => {
  const pared = [.223, .127, .08], bajoElFarol = [.58, .4, .19];
  const deDia = gradoDeColor(pared, DIA), deNoche = gradoDeColor(pared, NOCHE);
  assert.ok(deNoche[0] / deNoche[2] < deDia[0] / deDia[2] * .7, 'la pared en penumbra se enfría');
  const asfalto = gradoDeColor([.026, .019, .014], NOCHE);
  assert.ok(asfalto[2] >= asfalto[0], 'lo más oscuro vira al azul');
  const farol = gradoDeColor(bajoElFarol, NOCHE);
  assert.ok(farol[0] > farol[1] && farol[1] > farol[2] && farol[0] / farol[2] > 2.5, 'el pozo de sodio sigue naranja');
  // El piso que ya recibe algo de farol tampoco se enfría: el azul es solo de la penumbra.
  const pisoAlumbrado = gradoDeColor([.32, .24, .14], NOCHE);
  assert.ok(pisoAlumbrado[0] / pisoAlumbrado[2] > 2, 'el borde del pozo conserva el sodio');
  // Un día nublado se revela casi como uno despejado, y al caer la tarde (exposición 1,12, poco sol)
  // la sombra ya va más cerca de la de noche que de la de día: no hay una hora más honda que la noche.
  const sombra = exposicion => luma(gradoDeColor(gris(.05), exposicion));
  assert.ok(Math.abs(sombra(NUBLADO) / sombra(DIA) - 1) < .06);
  assert.ok(sombra(1.12) - sombra(DIA) > sombra(NOCHE) - sombra(1.12));
  // El paso de día a noche es continuo con la exposición.
  let antes = gradoDeColor(pared, GRADO.nocheDesde - .02);
  for (let e = GRADO.nocheDesde - .02; e <= Math.max(GRADO.nocheHasta, GRADO.colorNocheHasta) + .02; e += .005) {
    const ahora = gradoDeColor(pared, e);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(ahora[i] - antes[i]) < .004);
    antes = ahora;
  }
});

test('los colores fuertes ganan cuerpo sin cambiar de matiz, y la piel no vira', () => {
  const taxi = [.72, .5, .04], toldo = [.08, .2, .55], ladrillo = [.42, .16, .09], piel = [.3, .156, .102];
  for (const color of [taxi, toldo, ladrillo]) {
    const out = gradoDeColor(color, DIA);
    assert.ok(saturacion(out) > saturacion(color), `${color} gana saturación`);
    const giro = Math.abs(matiz(out) - matiz(color));
    assert.ok(Math.min(giro, 360 - giro) < 4, `${color} conserva el matiz (${giro.toFixed(1)}°)`);
  }
  for (const exposicion of [DIA, NUBLADO]) {
    const giro = Math.abs(matiz(gradoDeColor(piel, exposicion)) - matiz(piel));
    assert.ok(Math.min(giro, 360 - giro) < 4, `piel ${giro.toFixed(1)}°`);
  }
  // Un gris no se colorea más allá del tinte.
  assert.ok(saturacion(gradoDeColor(gris(.3), DIA)) < .06);
});
