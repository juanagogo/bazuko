import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';

const pincel = new Proxy({ measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get: (objeto, clave) => objeto[clave] ?? (() => {}), set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => pincel }) };
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
const { lonaDe } = await import('../src/world/bogota/ventasCalle.js');
const P = await import('../src/world/bogota/props.js');
const { Banca, cajaBiselada } = await import('../src/world/props/Banca.js');
const { buildMarket } = await import('../src/world/bogota/EastLandmarks.js');
const { detailRect } = await import('../src/world/bogota/ZoneTextures.js');
delete globalThis.document;

const mallas = (objeto) => { const lista = []; objeto.traverse((o) => { if (o.isMesh) lista.push(o); }); return lista; };
const caja = (objeto) => { objeto.updateMatrixWorld(true); return new THREE.Box3().setFromObject(objeto); };

/** Corre algo con el azar del juego sembrado y cuenta cuántos números pidió. */
function conAzar(semilla, hacer) {
  const random = Math.random;
  let s = semilla >>> 0, sorteos = 0;
  try {
    Math.random = () => { sorteos++; return (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
    return { resultado: hacer(), sorteos };
  } finally {
    Math.random = random;
  }
}

const PIEZAS = {
  banca: () => new Banca(new THREE.Vector3()).group,
  basura: () => P.trashPile(6),
  ropa: () => P.clothesline({ x: 0, z: -2.4 }, { x: 0, z: 2.4 }, 3.2),
  zorra: () => P.zorra(),
  caneca: () => P.fireBarrel()
};

// Lo que cada pieza gastaba del azar del juego, sus mallas y sus materiales antes de cambiarles la forma.
const ANTES = { banca: [164, 19, 2], basura: [138, 9, 2], ropa: [107, 8, 8], zorra: [196, 15, 5], caneca: [29, 1, 1] };
// Las texturas compartidas se crean en el primer uso: se arman una vez antes de contar.
for (const armar of Object.values(PIEZAS)) armar();

test('las piezas de primer plano gastan el mismo azar y llevan las mismas mallas y materiales que antes', () => {
  for (const [nombre, armar] of Object.entries(PIEZAS)) {
    const { resultado, sorteos } = conAzar(7, armar);
    assert.deepEqual([sorteos, mallas(resultado).length, new Set(mallas(resultado).map((o) => o.material)).size], ANTES[nombre], nombre);
  }
});

test('la zorra y la caneca de fuego ocupan la misma caja de caída que antes', () => {
  const cajas = {
    zorra: {
      7: [-0.9240997831885612, 0.007521617412567128, -1.9887695947387973, 0.6550000007450583, 1.2094425371304287, 0.949999988079071],
      99: [-0.8083178925958909, 0.007521617412567128, -1.9887695947387973, 0.6550000007450583, 1.1317774437046946, 0.949999988079071],
      2026: [-0.7603504614221217, 0.007521617412567128, -1.9887695947387973, 0.6550000007450583, 1.184893931212437, 0.949999988079071]
    },
    caneca: Object.fromEntries([7, 99, 2026].map((semilla) => [semilla, [-0.41, 1.1920928966180355e-8, -0.3199999928474426, 0.41, 1.29, 0.3199999928474426]]))
  };
  for (const [nombre, porSemilla] of Object.entries(cajas)) for (const [semilla, esperada] of Object.entries(porSemilla)) {
    const b = caja(conAzar(+semilla, PIEZAS[nombre]).resultado);
    assert.deepEqual([...b.min.toArray(), ...b.max.toArray()], esperada, `${nombre} con la semilla ${semilla}`);
  }
});

test('la banca tiene los cantos matados y sombreado suave, y cada pieza sigue siendo una caja cerrada', () => {
  const banca = new Banca(new THREE.Vector3()).group;
  for (const malla of mallas(banca)) {
    assert.ok(!malla.material.flatShading, 'la banca vuelve a verse de caras planas');
    const g = malla.geometry;
    assert.deepEqual(Object.keys(g.attributes).sort(), ['normal', 'position', 'uv']);
    assert.equal(g.index.count / 3, 44, 'seis caras, doce chaflanes y ocho esquinas');
  }
  // Cerrada y mirando hacia afuera: cada arista la comparten dos triángulos en sentidos contrarios y el volumen es positivo.
  const g = cajaBiselada(1.66, .038, .108, .008), p = g.attributes.position, aristas = new Map();
  let volumen = 0;
  const v = (i) => new THREE.Vector3().fromBufferAttribute(p, i);
  for (let t = 0; t < g.index.count; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => g.index.getX(t + k));
    volumen += v(a).dot(v(b).cross(v(c))) / 6;
    for (const [desde, hasta] of [[a, b], [b, c], [c, a]]) aristas.set(`${desde}>${hasta}`, (aristas.get(`${desde}>${hasta}`) ?? 0) + 1);
  }
  for (const [arista, veces] of aristas) {
    assert.equal(veces, 1, `la arista ${arista} se repite`);
    assert.equal(aristas.get(arista.split('>').reverse().join('>')), 1, `la arista ${arista} queda abierta`);
  }
  assert.ok(volumen > 1.66 * .038 * .108 * .95 && volumen < 1.66 * .038 * .108, `volumen ${volumen}`);
  g.computeBoundingBox();
  assert.deepEqual(g.boundingBox.max.toArray().map((n) => +n.toFixed(5)), [.83, .019, .054]);
  for (let i = 0; i < g.attributes.uv.count; i++) for (const n of [g.attributes.uv.getX(i), g.attributes.uv.getY(i)]) assert.ok(n === 0 || n === 1);
});

test('las sombrillas llevan tintes de tela asoleada y la lona cae en curva entre varillas', () => {
  const deMuestrario = ['#c0392b', '#f2c600', '#2f6fb0', '#ecf0f1', '#2e7d32', '#d9822b'], vistos = new Set(), hsl = {};
  for (let i = 0; i < 200; i++) for (const color of lonaDe(`Puesto ${i}`)) vistos.add(color);
  assert.equal(vistos.size, 6, 'los mismos seis tintes de siempre');
  for (const color of vistos) {
    assert.ok(!deMuestrario.includes(color), `${color} es un color de muestrario`);
    new THREE.Color(color).getHSL(hsl, THREE.SRGBColorSpace);
    assert.ok(hsl.s <= .56, `${color} sale chillón (${hsl.s.toFixed(2)})`);
  }
  // En el alero cada gajo tiene cinco puntos: entre varilla y varilla la tela baja y se mete, sin hacer pico.
  const alero = new Map();
  for (const malla of mallas(P.umbrella(['#2f7a3c', '#d9d3c4']))) {
    const p = malla.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const radio = Math.hypot(p.getX(i), p.getZ(i));
      const grados = (Math.round(Math.atan2(p.getX(i), p.getZ(i)) / Math.PI * 180) + 360) % 360;
      // Por debajo del borde de la lona cuelga el faldón: de cada rumbo se toma el punto más alto.
      if (radio > 1.05 && p.getY(i) > (alero.get(grados)?.[1] ?? 1.99)) alero.set(grados, [radio, p.getY(i)]);
    }
  }
  assert.equal(alero.size, 32, 'cuatro tramos por gajo en el borde');
  const [enVarilla, alCuarto, alMedio] = [0, 11, 23].map((grados) => alero.get(grados));
  assert.ok(enVarilla[1] > alCuarto[1] && alCuarto[1] > alMedio[1], 'la lona cuelga hacia el medio del gajo');
  assert.ok(enVarilla[1] - alCuarto[1] > (enVarilla[1] - alMedio[1]) * .6, 'cuelga en curva: al cuarto ya bajó más de la mitad');
});

test('el toldo de la plaza de mercado se remienda con tela y hace pliegues hacia el alero', () => {
  const g = mallas(buildMarket({ detail: new THREE.MeshStandardMaterial() }).group)[0].geometry, p = g.attributes.position, uv = g.attributes.uv;
  const duros = ['stoneGray', 'plasterWhite'].map(detailRect);
  const telas = ['redStripe', 'greenTarp', 'blueStripe', 'blueTarp', 'orangeTarp', 'burlap'].map(detailRect);
  const rayas = ['redStripe', 'blueStripe'].map(detailRect), porPuesto = new Map();
  const dentro = ([u0, v0, u1, v1], i) => uv.getX(i) >= u0 - 1e-6 && uv.getX(i) <= u1 + 1e-6 && uv.getY(i) >= v0 - 1e-6 && uv.getY(i) <= v1 + 1e-6;
  // Por encima de los parales y lejos de la cumbrera, de donde cuelgan los racimos, solo hay lona.
  const alturas = new Map();
  let puntos = 0;
  for (let i = 0; i < p.count; i++) {
    const fila = p.getZ(i) < 171 ? 166.32 : 175.68, lejos = Math.abs(p.getZ(i) - fila);
    // El alero: mismo borde, distinta altura según el pliegue. De cada punto se toma lo más alto, que es la lona y no el faldón.
    const clave = `${fila}:${p.getX(i).toFixed(3)}:${Math.sign(p.getZ(i) - fila)}`;
    if (Math.abs(lejos - 1.45) < 1e-4 && p.getY(i) > (alturas.get(clave) ?? 1.9)) alturas.set(clave, p.getY(i));
    if (p.getY(i) < 2.46 || lejos < .2) continue;
    puntos++;
    assert.ok(!duros.some((rect) => dentro(rect, i)), 'un remiendo de piedra o de pañete en la lona');
    assert.ok(telas.some((rect) => dentro(rect, i)), 'un paño del toldo no es de tela');
    const puesto = `${fila}:${Math.floor((p.getX(i) - 322) / 6.1)}`, deRayas = rayas.some((rect) => dentro(rect, i));
    porPuesto.set(puesto, [(porPuesto.get(puesto)?.[0] ?? 0) + (deRayas ? 1 : 0), (porPuesto.get(puesto)?.[1] ?? 0) + 1]);
  }
  // Las rayas son de la lona entera del puesto o no están: un retazo de rayas en una lona lisa parece una bandera.
  for (const [puesto, [deRayas, todos]] of porPuesto) assert.ok(deRayas === 0 || deRayas > todos * .6, `puesto ${puesto}: ${deRayas} de ${todos} puntos de rayas`);
  assert.ok(puntos > 400, `solo ${puntos} puntos de lona`);
  assert.equal(alturas.size, 12 * 9, 'nueve puntos por alero');
  // Nueve puntos por alero y doce aleros; lo que se descuelga una punta suelta es parejo, el pliegue no.
  const porAlero = new Map();
  for (const [clave, y] of alturas) { const [fila, x, lado] = clave.split(':'); porAlero.set(`${fila}:${lado}:${Math.floor((x - 322) / 6.1)}`, [...(porAlero.get(`${fila}:${lado}:${Math.floor((x - 322) / 6.1)}`) ?? []), [+x, y]]); }
  let quebrados = 0;
  for (const alero of porAlero.values()) {
    alero.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i + 1 < alero.length; i++) if (Math.abs(alero[i][1] * 2 - alero[i - 1][1] - alero[i + 1][1]) > .02) quebrados++;
  }
  assert.ok(quebrados > 30, `la lona quedó planchada (${quebrados} quiebres en los aleros)`);
});

test('las bolsas de basura quedan amarradas y apoyadas en el piso, y el cartón acostado en él', () => {
  for (const semilla of [3, 41, 977]) {
    const pila = conAzar(semilla, () => P.trashPile(8)).resultado;
    pila.updateMatrixWorld(true);
    const bolsas = mallas(pila).filter((o) => !o.geometry.index), cartones = mallas(pila).filter((o) => o.geometry.index);
    assert.deepEqual([bolsas.length, cartones.length], [8, 4]);
    for (const bolsa of bolsas) {
      const b = new THREE.Box3().setFromObject(bolsa, true), g = bolsa.geometry, p = g.attributes.position, n = g.attributes.normal;
      assert.ok(Math.abs(b.min.y) < .01, `una bolsa queda a ${b.min.y.toFixed(3)} m del piso`);
      assert.ok(p.count / 3 >= 12 * 2 * 6 && p.count / 3 <= 200, `${p.count / 3} triángulos por bolsa`);
      assert.deepEqual(Object.keys(g.attributes).sort(), ['normal', 'position', 'uv']);
      // Sombreado suave: un mismo punto lleva la misma normal en todos los triángulos que lo tocan.
      const normales = new Map();
      for (let i = 0; i < p.count; i++) {
        const clave = [p.getX(i), p.getY(i), p.getZ(i)].join(), normal = [n.getX(i), n.getY(i), n.getZ(i)].join();
        assert.equal(normales.get(clave) ?? normal, normal, 'la bolsa quedó de caras planas');
        normales.set(clave, normal);
      }
      // El nudo: arriba la bolsa se cierra a menos de un tercio de su panza.
      g.computeBoundingBox();
      let cuello = 0, panza = 0;
      for (let i = 0; i < p.count; i++) {
        const radio = Math.hypot(p.getX(i), p.getZ(i));
        if (p.getY(i) > g.boundingBox.max.y * .8) cuello = Math.max(cuello, radio);
        panza = Math.max(panza, radio);
      }
      assert.ok(cuello < panza * .36, `sin nudo: ${cuello.toFixed(2)} de ${panza.toFixed(2)}`);
    }
    for (const carton of cartones) assert.ok(Math.abs(new THREE.Box3().setFromObject(carton).min.y) < 1e-6, 'un cartón flota o se hunde');
  }
});

test('las bolsas de la carga llenan la misma caja que la bola de antes', () => {
  for (let semilla = 1; semilla <= 40; semilla++) {
    const carga = conAzar(semilla, () => P.trashPile(5, { carga: true })).resultado, radios = [];
    // El radio de cada bolsa es el mismo sorteo de antes: tras el grupo y los dos materiales, uno de cada catorce.
    conAzar(semilla, () => {
      for (let k = 0; k < 12; k++) Math.random();
      for (let i = 0; i < 5; i++) { radios.push(.28 + Math.random() * (.42 - .28)); for (let k = 0; k < 13; k++) Math.random(); }
    });
    mallas(carga).filter((o) => !o.geometry.index).forEach((bolsa, i) => {
      const antes = new THREE.IcosahedronGeometry(radios[i], 1);
      antes.computeBoundingBox(); bolsa.geometry.computeBoundingBox();
      assert.deepEqual([...bolsa.geometry.boundingBox.min.toArray(), ...bolsa.geometry.boundingBox.max.toArray()],
        [...antes.boundingBox.min.toArray(), ...antes.boundingBox.max.toArray()], `semilla ${semilla}, bolsa ${i}`);
      assert.equal(bolsa.position.y, .25);
    });
  }
});

test('la ropa colgada son prendas desteñidas que cuelgan de la cuerda, con pliegue', () => {
  const cuerda = conAzar(11, PIEZAS.ropa).resultado;
  cuerda.updateMatrixWorld(true);
  const prendas = mallas(cuerda).filter((o) => o.geometry.type === 'PlaneGeometry');
  assert.equal(prendas.length, 7);
  const vivos = ['c0392b', '2f6fb0', 'ecf0f1', '3f7a3a', 'e0962b', '7a4fa0', '1f1f1f'], formas = new Set();
  for (const prenda of prendas) {
    const color = prenda.material.color.clone().convertLinearToSRGB(), tope = Math.max(color.r, color.g, color.b), piso = Math.min(color.r, color.g, color.b);
    assert.ok(!vivos.includes(prenda.material.color.getHexString()), 'una prenda conserva el color puro de antes');
    assert.ok((tope - piso) / tope <= .35, `saturación ${((tope - piso) / tope).toFixed(2)}`);
    assert.ok(tope >= .25 && tope <= .7, `valor ${tope.toFixed(2)}`);
    const g = prenda.geometry, p = g.attributes.position;
    g.computeBoundingBox();
    // Cuelga de la cuerda (a 3,2 m), ni encima ni despegada.
    const caja = new THREE.Box3().setFromObject(prenda, true);
    assert.ok(Math.abs(caja.max.y - 3.2) < .012, `la prenda llega a ${caja.max.y}`);
    assert.ok(g.boundingBox.max.z - g.boundingBox.min.z > .02, 'la prenda quedó planchada');
    // La silueta: ancho arriba, a media altura y en el ruedo.
    const ancho = (fila) => p.getX(fila * 7 + 6) - p.getX(fila * 7);
    const hueco = p.getY(6 * 7 + 3) - p.getY(6 * 7 + 2);
    formas.add(hueco > .2 ? 'pantalon' : ancho(1) > ancho(4) * 1.4 ? 'camisa' : ancho(0) > .5 ? 'sabana' : 'toalla');
  }
  assert.deepEqual([...formas].sort(), ['camisa', 'pantalon', 'sabana', 'toalla']);
  assert.equal(new Set(prendas.map((o) => o.material.color.getHex())).size, 7, 'siete tintes, uno por lote como antes');
});

test('la caneca de fuego es redonda y de lámina oxidada, sin brillo de metal nuevo', () => {
  const tambor = mallas(P.fireBarrel())[0];
  assert.equal(tambor.geometry.parameters.radialSegments, 24);
  assert.ok(tambor.material.metalness <= .4 && tambor.material.roughness >= .85);
});

test('las llantas de la zorra tienen rin, flanco y banda, y miden lo mismo que el cilindro de antes', () => {
  const llantas = mallas(P.zorra()).filter((o) => o.material.vertexColors);
  assert.equal(llantas.length, 2);
  const antes = new THREE.CylinderGeometry(.3, .3, .1, 14);
  antes.computeBoundingBox();
  for (const llanta of llantas) {
    const g = llanta.geometry, p = g.attributes.position, c = g.attributes.color;
    g.computeBoundingBox();
    assert.deepEqual([...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray()], [...antes.boundingBox.min.toArray(), ...antes.boundingBox.max.toArray()]);
    assert.ok(g.index, 'con índice, como el cilindro');
    assert.deepEqual(Object.keys(g.attributes).sort(), ['color', 'normal', 'position', 'uv']);
    // El rin queda hundido y es más claro que el caucho; el flanco es más ancho que la banda.
    let rin = 1, flanco = 0, banda = 0, claroRin = 0, claroBanda = 1;
    for (let i = 0; i < p.count; i++) {
      const radio = Math.hypot(p.getX(i), p.getZ(i)), ancho = Math.abs(p.getY(i));
      if (radio < .12) { rin = Math.min(rin, ancho); claroRin = Math.max(claroRin, c.getX(i)); }
      else if (radio > .29) { banda = Math.max(banda, ancho); claroBanda = Math.min(claroBanda, c.getX(i)); }
      else flanco = Math.max(flanco, ancho);
    }
    assert.ok(rin < banda + 1e-6 && banda < flanco, `rin ${rin}, banda ${banda}, flanco ${flanco}`);
    assert.ok(claroRin > claroBanda * 3, 'el rin se confunde con el caucho');
  }
});
