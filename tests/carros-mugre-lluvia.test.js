import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle, CAR_MODEL_IDS } from '../src/world/bogota/vehicles.js';
import { CAR_MODELS } from '../src/world/bogota/carModels.js';
import { getCarBody } from '../src/world/bogota/VehicleBody.js';
import { pintarUso, mugreDe } from '../src/world/bogota/carUso.js';
import { streetWetness } from '../src/character/streetMaterials.js';

const firma = texto => { let h = 2166136261; for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619); return h >>> 0; };
const azarGastado = fn => {
  const real = Math.random; let cuenta = 0;
  Math.random = () => { cuenta++; return real(); };
  try { fn(); } finally { Math.random = real; }
  return cuenta;
};

const FLOTA = [];
for (let seed = 0; seed < 48; seed++) FLOTA.push(['carro', seed]);
for (let seed = 0; seed < 12; seed++) FLOTA.push(['taxi', seed], ['police', seed], ['buseta', seed]);
for (const model of CAR_MODEL_IDS) FLOTA.push(['carro', 3, model]);

const compilar = material => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
};

test('con aguacero la chapa se oscurece, se alisa, refleja el cielo y chorrea por los costados', () => {
  for (const [kind, model] of [['carro', 'sedanPopular'], ['taxi', 'citadino'], ['buseta', 'buseta'], ['carro', 'cajaSetentera']]) {
    const v = makeVehicle(kind, 5, { model, beams: false }), [esmalte, vidrio] = v.wetMaterials;
    const chapa = compilar(esmalte).fragmentShader, luna = compilar(vidrio).fragmentShader;
    assert.equal(compilar(esmalte).uniforms.uMojado, streetWetness);
    assert.ok(chapa.includes('diffuseColor.rgb *= 1. - ( .3 + .15 * usoVivo ) * uMojado'), `${model}: esmalte de un 30 a un 45 % más oscuro, más el de color`);
    assert.ok(chapa.includes('roughnessFactor *= 1. - .6 * uMojado'), `${model}: más lisa`);
    assert.ok(chapa.includes('usoCanto *= 1. + 1.2 * uMojado'), `${model}: la laca mojada devuelve más cielo de canto`);
    assert.ok(luna.includes('( 1. + 1.2 * uMojado )'), `${model}: el vidrio mojado refleja más`);
    // Los chorreones son polvo al 40 % que solo sale con el piso mojado, y solo en la carta lateral, bajo las ventanas.
    assert.ok(chapa.includes('.4 * uMojado * usoChorro ), .92 )'), `${model}: chorreones al 40 %`);
    const desde = Number(chapa.match(/float usoDesde = ([\d.]+)/)[1]);
    assert.ok(desde > .3 && desde < .7, `${model}: los chorreones nacen en la carta lateral (${desde})`);
    assert.ok(chapa.includes('fwidth( usoHilo )'), `${model}: de lejos los hilos se apagan en vez de titilar`);
    v.dispose();
  }
});

// La buseta elegida por modelo comparte el mapa de la ruta con las que circulan.
const HUELLA = { gastado: 7800, medidas: 2270706608, mallas: 806, programas: 'reflejo-calle-polvo-matiz|campo-sol,vidrio-con-sombra-reflejo-panoramico|campo-sol', mapas: 16 };
