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
function cuadras(semilla, conLaCiudad = null) {
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
      const [x, z] = tiles[Math.floor(tiles.length / 2)];
      // Entre la puerta y la primera vía solo puede haber andén, hasta diez metros.
      const frente = Array.from({ length: 5 }, (_, i) => this.map[z + dz * (i + 1)]?.[x + dx * (i + 1)]);
      const exterior = frente.find(tile => tile !== 'sidewalk');
      solares.push({ exterior, face, primero: tiles[0], ultimo: tiles[tiles.length - 1], raiz, local: raiz?.userData.local ?? null });
    };
    ciudad._buildBlocks(ciudad.map);
    conLaCiudad?.(ciudad, solares);
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
  assert.equal(conLocal.length, 110, 'los comercios ocupan las fachadas comerciales del rediseño');
  for (const solar of conLocal) assert.ok(['road', 'busway'].includes(solar.exterior),
    `el local de ${solar.primero} abre a ${solar.exterior}`);
  assert.ok(solares.some(s => !s.local && s.exterior === 'grass'), 'hay viviendas frente al parque');
  const oficios = new Set(conLocal.map(solar => solar.local.id));
  assert.ok(oficios.size >= 20, `${oficios.size} oficios distintos`);
  let parejas = 0;
  for (let i = 1; i < solares.length; i++) {
    const a = solares[i - 1], b = solares[i];
    if (!a.local || !b.local || !seguidos(a, b)) continue;
    parejas++;
    assert.notEqual(a.local.id, b.local.id, `${a.local.id} dos veces seguidas en ${a.ultimo} y ${b.primero}`);
  }
  assert.ok(parejas >= 30, `${parejas} parejas de vecinos revisadas`);
  // La mayoría se arma con muro, persiana y rótulo; el resto conserva la persiana pintada de su fachada.
  const armados = conLocal.filter(solar => solar.local.armado).length;
  assert.ok(armados >= conLocal.length * .8, `${armados} de ${conLocal.length} locales armados`);
});

test('desde el andén de La Última se ven los cuerpos curvos en tres repisas de ambos paños', () => {
  const { solares } = cuadras(89123);
  const local = solares.find(({ raiz }) => raiz?.position.x === 50 && raiz?.position.z === 121);
  assert.equal(local.local.nombre, 'LA ÚLTIMA');
  const { raiz } = local;
  raiz.updateMatrixWorld(true);
  const [u0, v0, u1, v1] = detailAtlas().uv.botellas;
  const rayo = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(-1, 0, 0), 0, 1.3);
  const materiales = new Set();
  for (const [inicio, fin] of [[118.65, 121.3], [122, 124.45]]) for (const y of [.91, 1.35, 1.82]) {
    let vistas = 0;
    const profundidades = new Set();
    for (let z = inicio; z < fin; z += .045) {
      rayo.ray.origin.set(54, y, z);
      const golpe = rayo.intersectObject(raiz, true)[0];
      if (!golpe?.object.userData.streetLife) continue;
      const { uv, point, object } = golpe;
      // Las etiquetas ocupan el espacio que queda debajo de la trasera, la madera y el hierro.
      if (uv.x < u0 || uv.x > u1 || uv.y < v0 || uv.y > v1 - (v1 - v0) * .17) continue;
      materiales.add(object.material);
      vistas++;
      profundidades.add(Math.round(point.x * 1000));
      // La chapa empieza en X 53,030. Todo el vidrio queda por detrás, incluso al bajar la persiana.
      assert.ok(point.x > 52.91 && point.x < 53.03001);
    }
    assert.ok(vistas >= 9, `botellas visibles desde la acera en el paño ${inicio}, a ${y} m`);
    assert.ok(profundidades.size >= 5, 'la superficie que recibe los rayos tiene curvatura');
  }
  assert.equal(materiales.size, 1, 'ambos paños pertenecen al mismo lote de la fachada');
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
  const conMuroYAviso = solares.filter(solar => solar.local?.armado && solar.local.aviso);
  assert.ok(conMuroYAviso.length > 0);
  assert.equal(revisados, conMuroYAviso.length, 'se comprobó el muro de cada local armado con aviso');
});

/** Lo que dice un aviso colgado: lo pintado en su textura y, si es una celda de un atlas, cuál. */
function textoDe(aviso) {
  const uv = aviso.geometry.attributes.uv, pintado = [...new Set(aviso.material.map?.image?.textos ?? [])];
  return `${pintado.join(' · ')} @ ${uv.getX(0).toFixed(4)},${uv.getY(0).toFixed(4)}`;
}

test('los avisos grandes colgados en la ciudad no pasan de 54 textos distintos, dos nombres por oficio', () => {
  const { solares } = cuadras(89123);
  const colgados = solares.flatMap(solar => solar.raiz ? avisosDe(solar.raiz).map(aviso => ({ local: solar.local, texto: textoDe(aviso) })) : []);
  const conLocal = solares.filter(solar => solar.local);
  assert.ok(colgados.length >= conLocal.length * .6, `${colgados.length} avisos entre ${conLocal.length} locales`);
  const textos = new Set(colgados.map(colgado => colgado.texto));
  assert.ok(textos.size <= 54, `${textos.size} textos distintos en los avisos grandes colgados`);
  const porOficio = new Map();
  for (const { local, texto } of colgados) {
    const oficio = local?.id ?? texto.split(' · ')[0];
    porOficio.set(oficio, (porOficio.get(oficio) ?? new Set()).add(texto));
  }
  for (const [oficio, suyos] of porOficio) assert.ok(suyos.size <= 2, `${oficio} cuelga ${suyos.size} textos distintos`);
  for (const { local, texto } of colgados) assert.ok(local?.aviso, `un aviso colgado sin local que lo anuncie: ${texto}`);
  for (const { raiz, local } of solares) if (local?.aviso) assert.equal(avisosDe(raiz).length, 1, `${local.id} dice tener aviso y no lo cuelga`);
});

test('un aviso de bandera que se mete en un sólido de la ciudad no se cuelga', async () => {
  const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');
  cuadras(89123, (ciudad, solares) => {
    const banderas = () => {
      const lista = [];
      ciudad.group.traverse(malla => { if (malla.userData.bandera) lista.push(malla); });
      return lista;
    };
    const punto = new THREE.Vector3();
    const cajaDe = (malla, { desde, hasta }) => {
      const caja = new THREE.Box3(), posicion = malla.geometry.attributes.position;
      malla.updateWorldMatrix(true, false);
      for (let i = desde; i < hasta; i++) caja.expandByPoint(punto.fromBufferAttribute(posicion, i).applyMatrix4(malla.matrixWorld));
      return caja;
    };
    const colgadas = banderas().length;
    const sinAvisoGrande = solares.filter(solar => solar.local?.armado && !solar.local.aviso);
    assert.ok(sinAvisoGrande.length > 0);
    assert.ok(colgadas >= sinAvisoGrande.length / 2, `${colgadas} banderas entre ${sinAvisoGrande.length} locales sin aviso grande`);
    for (const { raiz, local } of solares) {
      let cantidad = 0;
      raiz.traverse(objeto => { if (objeto.userData.bandera) cantidad++; });
      assert.ok(cantidad <= (local?.armado && !local.aviso ? 1 : 0), 'una bandera solo en un local sin aviso grande');
    }
    // Las cajas de las casas, como las arma el juego: casi ninguna bandera las toca.
    const solidos = new CollisionSystem();
    ciudad._buildCollisions(ciudad.map, solidos);
    const contraCasas = ciudad._quitarBanderasContraSolidos(solidos.colliders);
    assert.ok(contraCasas <= colgadas * .1, `${contraCasas} de ${colgadas} banderas tocaban la caja de una casa`);
    // Un sólido puesto encima de una bandera: esa se recoge y las demás siguen.
    const [victima, ...resto] = banderas(), rango = { ...victima.userData.bandera };
    const pilar = { box: cajaDe(victima, rango).expandByVector(new THREE.Vector3(.2, 4, .2)) };
    const vertices = victima.geometry.attributes.position.count, triangulos = victima.geometry.index.count;
    assert.equal(ciudad._quitarBanderasContraSolidos([pilar]), resto.filter(malla => pilar.box.intersectsBox(cajaDe(malla, malla.userData.bandera).expandByScalar(-.03))).length + 1);
    assert.equal(victima.userData.bandera, undefined, 'la bandera recogida ya no cuenta');
    const plegada = cajaDe(victima, rango).getSize(new THREE.Vector3());
    assert.ok(plegada.length() < 1e-6, 'la bandera recogida no ocupa sitio');
    assert.equal(victima.geometry.attributes.position.count, vertices, 'la malla conserva sus vértices');
    assert.equal(victima.geometry.index.count, triangulos, 'la malla conserva su índice');
    // Ninguna de las que quedan está dentro de un sólido.
    const todos = [...solidos.colliders, pilar];
    for (const malla of banderas()) {
      const caja = cajaDe(malla, malla.userData.bandera).expandByScalar(-.03);
      assert.ok(!todos.some(solido => solido.box.intersectsBox(caja)), 'una bandera sigue dentro de un sólido');
    }
    assert.ok(banderas().length >= colgadas - contraCasas - 3, 'las demás banderas siguen colgadas');
  });
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

test('la persiana tapa el surtido en las fachadas con relieve y en las planas', async () => {
  const { OFICIOS } = await import('../src/world/bogota/Locales.js');
  const licorera = OFICIOS.find(oficio => oficio.id === 'licorera');
  const atlas = detailAtlas().uv, tinta = atlas.botellas;
  const dentro = (uv, r) => uv.x >= r[0] - 1e-7 && uv.x <= r[2] + 1e-7 && uv.y >= r[1] - 1e-7 && uv.y <= r[3] + 1e-7;
  const etiqueta = [tinta[0], tinta[1], tinta[2], tinta[3] - (tinta[3] - tinta[1]) * .17];
  for (const [seed, tipo] of [[1, 'completo'], [11, 'plano']]) {
    const cantidades = [];
    for (const estado of ['abierta', 'media', 'cerrada']) {
      const { shell, resultado } = casa({ width: 4, depth: 6, height: 9, floors: 3, face: 4, seed, roof: false },
        { ...licorera, conAviso: true, estado });
      assert.equal(resultado.local, tipo);
      let envases = 0, chapa = Infinity, izquierda = Infinity, derecha = -Infinity;
      const exterior = shell.walls.get(4);
      const coord = new THREE.Vector2();
      exterior.traverse(malla => {
        if (!malla.userData.streetLife) return;
        const { uv, position } = malla.geometry.attributes;
        for (let i = 0; i < uv.count; i++) {
          coord.fromBufferAttribute(uv, i);
          if (dentro(coord, etiqueta)) {
            envases++;
            assert.ok(position.getZ(i) < 3.03);
          }
          if (!dentro(coord, atlas[licorera.persiana])) continue;
          chapa = Math.min(chapa, position.getY(i));
          izquierda = Math.min(izquierda, position.getX(i)); derecha = Math.max(derecha, position.getX(i));
        }
      });
      shell.root.updateMatrixWorld(true);
      const origen = new THREE.Vector3(10 + (izquierda + derecha) / 2, (chapa + 2.37) / 2, 23.45);
      const rayo = new THREE.Raycaster(origen, new THREE.Vector3(0, 0, -1));
      const impacto = rayo.intersectObject(exterior, true)[0];
      assert.ok(dentro(impacto.uv, atlas[licorera.persiana]), 'la chapa recibe primero el rayo');
      cantidades.push(envases);
    }
    const [abierta, media, cerrada] = cantidades;
    assert.ok(abierta > media && media > 0);
    assert.equal(cerrada, 0);
  }
});
