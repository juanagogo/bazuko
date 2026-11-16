import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { addBuildingDetails } from '../src/world/bogota/BuildingDetails.js';
import { createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { rng } from '../src/world/bogota/textures.js';
import { detailAtlas } from '../src/world/bogota/textures-calle.js';

// Solo se sustituye el dibujo: los textos que se pintan quedan anotados para revisarlos.
function lienzo(textos) {
  return { createElement: () => {
    // Cada lienzo recuerda además lo suyo: así se sabe qué dice la textura de cada aviso.
    const propios = [];
    const contexto = new Proxy({
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillText(texto) { textos.push(String(texto)); propios.push(String(texto)); }
    }, { get: (objeto, clave) => objeto[clave] ?? (() => {}), set: () => true });
    return { width: 0, height: 0, textos: propios, getContext: () => contexto };
  } };
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
      solares.push({ face, primero: tiles[0], ultimo: tiles[tiles.length - 1], raiz, local: raiz?.userData.local ?? null });
    };
    ciudad._buildBlocks(ciudad.map);
    return { solares, textos };
  } finally {
    ciudad?.dispose(new THREE.Scene());
    Math.random = azar;
    if (documento === undefined) delete globalThis.document; else globalThis.document = documento;
  }
}

/** El aviso grande es el plano que la casa cuelga a 3,05 m, lleve textura propia o una celda de un atlas. */
function avisosDe(raiz) {
  const avisos = [];
  raiz.traverse(objeto => {
    if (objeto.isMesh && !objeto.userData.streetLife && Math.abs(objeto.position.y - 3.05) < 1e-6 && objeto.geometry.attributes.position.count === 4) avisos.push(objeto);
  });
  return avisos;
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

test('el muro pintado termina 6 cm por debajo del aviso grande y no lo tapa', () => {
  const { solares } = cuadras(89123);
  const celdas = Object.entries(detailAtlas().uv).filter(([nombre]) => nombre.startsWith('muro')).map(([, celda]) => celda);
  const esMuro = (u, v) => celdas.some(([u0, v0, u1, v1]) => u >= u0 - 1e-6 && u <= u1 + 1e-6 && v >= v0 - 1e-6 && v <= v1 + 1e-6);
  let revisados = 0;
  for (const { raiz, local } of solares) {
    if (!local?.armado) continue;
    const [aviso] = avisosDe(raiz);
    if (!aviso) continue;
    aviso.geometry.computeBoundingBox();
    const abajo = aviso.position.y + aviso.geometry.boundingBox.min.y;
    let tope = -Infinity;
    for (const malla of aviso.parent.children) {
      if (!malla.userData.streetLife) continue;
      const posicion = malla.geometry.attributes.position, uv = malla.geometry.attributes.uv;
      for (let i = 0; i < posicion.count; i++) if (esMuro(uv.getX(i), uv.getY(i))) tope = Math.max(tope, posicion.getY(i));
    }
    if (tope === -Infinity) continue;
    revisados++;
    assert.ok(tope <= abajo - .06 + 1e-6, `el muro de ${local.id} sube a ${tope.toFixed(2)} m y el aviso empieza en ${abajo.toFixed(2)} m`);
  }
  assert.ok(revisados >= 80, `${revisados} locales con aviso grande y muro pintado`);
});

/** Lo que dice un aviso colgado: lo pintado en su textura y, si es una celda de un atlas, cuál. */
function textoDe(aviso) {
  const uv = aviso.geometry.attributes.uv, pintado = [...new Set(aviso.material.map?.image?.textos ?? [])];
  return `${pintado.join(' · ')} @ ${uv.getX(0).toFixed(4)},${uv.getY(0).toFixed(4)}`;
}

test('los avisos grandes colgados en la ciudad no pasan de 54 textos distintos, dos nombres por oficio', () => {
  const { solares } = cuadras(89123);
  const colgados = solares.flatMap(solar => solar.raiz ? avisosDe(solar.raiz).map(aviso => ({ local: solar.local, texto: textoDe(aviso) })) : []);
  assert.ok(colgados.length >= 80, `${colgados.length} avisos grandes colgados`);
  const textos = new Set(colgados.map(colgado => colgado.texto));
  assert.ok(textos.size <= 54, `${textos.size} textos distintos en los avisos grandes colgados`);
  const porOficio = new Map();
  for (const { local, texto } of colgados) {
    assert.ok(local?.aviso, `un aviso colgado sin local que lo anuncie: ${texto}`);
    porOficio.set(local.id, (porOficio.get(local.id) ?? new Set()).add(texto));
  }
  for (const [id, suyos] of porOficio) assert.ok(suyos.size <= 2, `${id} cuelga ${suyos.size} textos distintos`);
  for (const { raiz, local } of solares) if (local?.aviso) assert.equal(avisosDe(raiz).length, 1, `${local.id} dice tener aviso y no lo cuelga`);
});

test('ningún local lleva el nombre de una marca real', async () => {
  const { AVISOS_GRANDES, OFICIOS, localDelSolar } = await import('../src/world/bogota/Locales.js');
  assert.ok(AVISOS_GRANDES.length <= 54, `${AVISOS_GRANDES.length} textos posibles de aviso grande`);
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

/** Una casa suelta con la fachada de la calle en z = 23 (3 m delante de su centro). */
function casa(opciones, local) {
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
}

test('el tejadillo y la lona corta van altos y vuelan poco: no tapan a quien camina pegado a la pared', async () => {
  const { localDelSolar } = await import('../src/world/bogota/Locales.js');
  const celdas = Object.entries(detailAtlas().uv).filter(([nombre]) => /^(toldo|zinc)/.test(nombre)).map(([, celda]) => celda);
  assert.ok(celdas.length >= 3, 'el atlas trae las lonas y la lata de los locales');
  const esToldo = (u, v) => celdas.some(([u0, v0, u1, v1]) => u >= u0 - 1e-6 && u <= u1 + 1e-6 && v >= v0 - 1e-6 && v <= v1 + 1e-6);
  let tejadillos = 0, anchos = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const width = 4 + (seed % 3) * 2, opciones = { width, depth: 6, height: 9, floors: 3, face: 4, seed: seed * 7919, neighborhood: 'comercio' };
    const local = { ...localDelSolar({ seed: opciones.seed, paso: seed, x: 110, z: 150 }), conAviso: seed % 2 === 0 };
    const con = casa(opciones, local);
    if (con.resultado.local !== 'completo') continue;
    let vuelo = 0, bajo = Infinity, alto = -Infinity, izquierda = Infinity, derecha = -Infinity;
    for (const malla of con.mallas.filter(malla => malla.userData.streetLife)) {
      const posicion = malla.geometry.attributes.position, uv = malla.geometry.attributes.uv;
      for (let i = 0; i < posicion.count; i++) {
        if (posicion.getY(i) < 1.9 || !esToldo(uv.getX(i), uv.getY(i))) continue;
        vuelo = Math.max(vuelo, posicion.getZ(i) - 3);
        bajo = Math.min(bajo, posicion.getY(i)); alto = Math.max(alto, posicion.getY(i));
        izquierda = Math.min(izquierda, posicion.getX(i)); derecha = Math.max(derecha, posicion.getX(i));
      }
    }
    // El toldo de lona de siempre vuela 85 cm o más; lo que vuela menos es el tejadillo o la lona corta de un local.
    if (vuelo === 0 || vuelo >= .84) continue;
    tejadillos++;
    assert.ok(vuelo <= .5 + 1e-6, `un tejadillo vuela ${vuelo.toFixed(2)} m con la semilla ${opciones.seed}`);
    assert.ok(bajo >= 2.6 - 1e-6, `un tejadillo baja a ${bajo.toFixed(2)} m con la semilla ${opciones.seed}`);
    assert.ok(alto >= 2.8 - 1e-6, `un tejadillo arranca a ${alto.toFixed(2)} m con la semilla ${opciones.seed}`);
    if (derecha - izquierda >= width * .7) anchos++;
  }
  assert.ok(tejadillos >= 12, `${tejadillos} tejadillos y lonas cortas revisados`);
  assert.ok(anchos * 2 >= tejadillos, `${anchos} de ${tejadillos} ocupan casi todo el frente`);
});

test('armar el local no añade mallas, materiales ni sorteos a la casa, y lo del andén queda pegado al muro', async () => {
  const { localDelSolar } = await import('../src/world/bogota/Locales.js');
  let armados = 0, completos = 0, salen = 0;
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
    // Por encima, toldos, tejadillos y avisos de bandera sí vuelan sobre el andén.
    let vuelo = 0;
    for (const malla of con.mallas.filter(malla => malla.userData.streetLife)) {
      const posicion = malla.geometry.attributes.position;
      for (let i = 0; i < posicion.count; i++) {
        if (posicion.getY(i) < 1.9) assert.ok(posicion.getZ(i) <= 3 + .4 + 1e-6, `una pieza sale ${(posicion.getZ(i) - 3).toFixed(2)} m con la semilla ${opciones.seed}`);
        else vuelo = Math.max(vuelo, posicion.getZ(i) - 3);
      }
    }
    if (vuelo > .4) salen++;
    assert.equal(con.shell.root.userData.local.sale, vuelo > .4, `la marca de vuelo con la semilla ${opciones.seed}`);
  }
  assert.ok(armados >= 45 && completos >= 30, `${armados} locales armados, ${completos} completos`);
  assert.ok(salen * 2 >= armados, `${salen} de ${armados} locales con algo que sale de la pared`);
});
