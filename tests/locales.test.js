import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { addBuildingDetails } from '../src/world/bogota/BuildingDetails.js';
import { createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { rng } from '../src/world/bogota/textures.js';

// Solo se sustituye el dibujo: los textos que se pintan quedan anotados para revisarlos.
function lienzo(textos) {
  const contexto = new Proxy({
    measureText: () => ({ width: 0 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillText(texto) { textos.push(String(texto)); }
  }, { get: (objeto, clave) => objeto[clave] ?? (() => {}), set: () => true });
  return { createElement: () => ({ width: 0, height: 0, getContext: () => contexto }) };
}

/** Arma las cuadras como el juego y devuelve, en el orden en que se construyen, el local de cada solar. */
function cuadras(semilla) {
  const azar = Math.random, documento = globalThis.document, textos = [], solares = [];
  let ciudad;
  try {
    Math.random = rng(semilla);
    globalThis.document = lienzo(textos);
    ciudad = new Bogota();
    ciudad.map = ciudad._layout();
    const casa = ciudad._house;
    ciudad._house = function (tiles, dx, dz, face, ...resto) {
      const antes = this.group.children.length;
      casa.call(this, tiles, dx, dz, face, ...resto);
      const raiz = this.group.children[antes];
      solares.push({ face, primero: tiles[0], ultimo: tiles[tiles.length - 1], local: raiz?.userData.local ?? null });
    };
    ciudad._buildBlocks(ciudad.map);
    return { solares, textos };
  } finally {
    ciudad?.dispose(new THREE.Scene());
    Math.random = azar;
    if (documento === undefined) delete globalThis.document; else globalThis.document = documento;
  }
}

const seguidos = (a, b) => a.face === b.face && Math.abs(b.primero[0] - a.ultimo[0]) + Math.abs(b.primero[1] - a.ultimo[1]) === 1;

test('la ciudad reparte muchos oficios y nunca pone el mismo en dos solares seguidos', () => {
  const { solares } = cuadras(89123);
  const conLocal = solares.filter(solar => solar.local);
  assert.ok(conLocal.length >= 200, `${conLocal.length} solares con local`);
  const oficios = new Set(conLocal.map(solar => solar.local.id));
  assert.ok(oficios.size >= 20, `${oficios.size} oficios distintos`);
  let parejas = 0;
  for (let i = 1; i < solares.length; i++) {
    const a = solares[i - 1], b = solares[i];
    if (!a.local || !b.local || !seguidos(a, b)) continue;
    parejas++;
    assert.notEqual(a.local.id, b.local.id, `${a.local.id} dos veces seguidas en ${a.ultimo} y ${b.primero}`);
  }
  assert.ok(parejas >= 100, `${parejas} parejas de vecinos revisadas`);
  // La mayoría se arma con muro, persiana y rótulo; el resto conserva la persiana pintada de su fachada.
  const armados = conLocal.filter(solar => solar.local.armado).length;
  assert.ok(armados >= conLocal.length * .8, `${armados} de ${conLocal.length} locales armados`);
});

test('cada solar conserva su local aunque cambie el azar del juego', () => {
  const resumen = semilla => cuadras(semilla).solares.map(solar => [solar.primero, solar.face, solar.local?.id, solar.local?.nombre, solar.local?.armado]);
  const primera = resumen(89123);
  assert.ok(primera.some(fila => fila[2]), 'hay locales que comparar');
  assert.deepEqual(resumen(17), primera);
});

test('ningún local lleva el nombre de una marca real', async () => {
  const { OFICIOS, localDelSolar } = await import('../src/world/bogota/Locales.js');
  const vetadas = ['COCA', 'COLA', 'POSTOBON', 'PEPSI', 'BAVARIA', 'AGUILA', 'POKER', 'PILSEN', 'COSTENA', 'CLARO', 'MOVISTAR', 'TIGO',
    'EXITO', 'CARULLA', 'JUMBO', 'OLIMPICA', 'D1', 'ARA', 'SURTIMAX', 'MAKRO', 'ALKOSTO', 'HOMECENTER', 'EFECTY', 'BALOTO', 'SERVIENTREGA',
    'GANA', 'PAGATODO', 'SURED', 'KOKORIKO', 'FRISBY', 'SURTIFRUVER', 'REBAJA', 'COLSUBSIDIO', 'CAFAM', 'FARMATODO', 'LOCATEL', 'TOSTAO',
    'OMA', 'VALDEZ', 'CORRAL', 'CREPES', 'DOLLARCITY', 'BANCOLOMBIA', 'DAVIVIENDA', 'RAPPI', 'RAMO', 'ALPINA', 'COLANTA', 'BIMBO', 'CRISTAL',
    'MANANTIAL', 'BRISA', 'NECTAR', 'ANTIOQUENO', 'CUNIT', 'PRESTO', 'MIMOS', 'TERPEL', 'ROJA'];
  const palabras = texto => texto.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const { textos } = cuadras(89123);
  const nombres = OFICIOS.flatMap(oficio => [oficio.titulo, ...oficio.nombres]);
  assert.ok(OFICIOS.length >= 20 && nombres.length >= 80, 'el catálogo trae oficios y nombres');
  // Lo pintado en fachadas y atlas, más cada nombre que el sorteo puede dar.
  for (const texto of [...nombres, ...textos]) {
    for (const palabra of palabras(texto)) assert.ok(!vetadas.includes(palabra), `«${texto}» nombra una marca real`);
  }
  for (const oficio of OFICIOS) assert.equal(new Set(oficio.nombres).size, oficio.nombres.length, `nombres repetidos en ${oficio.id}`);
  const local = localDelSolar({ seed: 318, paso: 7, x: 108, z: 66 });
  assert.deepEqual(localDelSolar({ seed: 318, paso: 7, x: 108, z: 66 }), local);
  assert.ok(OFICIOS.some(oficio => oficio.id === local.id && oficio.nombres.includes(local.nombre)));
});

test('armar el local no añade mallas, materiales ni sorteos a la casa, y lo del andén queda pegado al muro', async () => {
  const { localDelSolar } = await import('../src/world/bogota/Locales.js');
  const casa = (opciones, local) => {
    const material = new THREE.MeshStandardMaterial();
    const shell = createBuildingShell(new THREE.BoxGeometry(opciones.width, opciones.height, opciones.depth), Array(6).fill(material),
      { x: 10, z: 20, height: opciones.height, interiorMaterial: material });
    const azar = Math.random;
    let sorteos = 0;
    Math.random = () => { sorteos++; return azar(); };
    let resultado;
    try { resultado = addBuildingDetails({ shell, ...opciones, ...(local ? { local } : {}) }); } finally { Math.random = azar; }
    const mallas = [], materiales = new Set();
    shell.root.traverse(objeto => { if (objeto.isMesh) { mallas.push(objeto); materiales.add(objeto.material); } });
    return { shell, resultado, sorteos, mallas, materiales };
  };
  let armados = 0, completos = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const width = 4 + (seed % 3) * 2, opciones = { width, depth: 6, height: 9, floors: 3, face: 4, seed: seed * 7919, neighborhood: 'comercio' };
    const local = { ...localDelSolar({ seed: opciones.seed, paso: seed, x: 110, z: 150 }), conAviso: seed % 2 === 0 };
    // La primera pasada crea los materiales compartidos; se compara la segunda.
    casa(opciones, null); casa(opciones, local);
    const sin = casa(opciones, null), con = casa(opciones, local);
    assert.equal(con.mallas.length, sin.mallas.length, `mallas con la semilla ${opciones.seed}`);
    assert.equal(con.materiales.size, sin.materiales.size, `materiales con la semilla ${opciones.seed}`);
    assert.equal(con.sorteos, sin.sorteos, `sorteos globales con la semilla ${opciones.seed}`);
    assert.deepEqual(con.mallas.map(malla => malla.name), sin.mallas.map(malla => malla.name));
    if (!con.resultado.local) continue;
    armados++;
    if (con.resultado.local !== 'completo') continue;
    completos++;
    // Por debajo del toldo (1,9 m) nada sale más de 40 cm de la fachada (z = 23 en esta casa): se ve pegado al muro.
    for (const malla of con.mallas.filter(malla => malla.userData.streetLife)) {
      const posicion = malla.geometry.attributes.position;
      for (let i = 0; i < posicion.count; i++) {
        if (posicion.getY(i) < 1.9) assert.ok(posicion.getZ(i) <= 3 + .4 + 1e-6, `una pieza sale ${(posicion.getZ(i) - 3).toFixed(2)} m con la semilla ${opciones.seed}`);
      }
    }
  }
  assert.ok(armados >= 45 && completos >= 30, `${armados} locales armados, ${completos} completos`);
});
