import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BALDOSA, LUZ, repartoDeTorres, fachadasDeTorres, vestirTorres, uvDeTorre } from '../src/world/bogota/fachadaTorres.js';
import { planUrbanBuildings, buildUrbanBuilding, URBAN_DESIGNS } from '../src/world/bogota/UrbanBuildings.js';
import { buildSmallBuilding, celdaDeVentana } from '../src/world/bogota/SmallBuilding.js';
import { atlasDeVentanas, celdaDelVano, celdaVentana, COLUMNAS, FILAS, FILA, MARCO_OSCURO } from '../src/world/bogota/WindowAtlas.js';
import { addBuildingDetails } from '../src/world/bogota/BuildingDetails.js';
import { createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { facade, brick } from '../src/world/bogota/textures.js';

/** Lienzo de mentira que anota lo pintado, y un `Math.random` que cuenta los sorteos del juego. */
async function conLienzo(probar) {
  const pintado = [], degradado = { addColorStop: (...a) => pintado.push(['parada', ...a]) };
  const ctx = new Proxy({}, {
    get: (_, clave) => /^create.*Gradient$/.test(String(clave)) ? (...a) => { pintado.push([clave, ...a]); return degradado; }
      : (...a) => { pintado.push([clave, ...a]); },
    set: (_, clave, valor) => { pintado.push([clave, valor]); return true; }
  });
  const delJuego = Math.random, antes = globalThis.document;
  const cuenta = { gastados: 0, pintado, lienzos: [] };
  Math.random = () => { cuenta.gastados++; return delJuego(); };
  globalThis.document = { createElement: () => { const c = { width: 0, height: 0, getContext: () => ctx }; cuenta.lienzos.push(c); return c; } };
  try { return await probar(cuenta); } finally { Math.random = delJuego; globalThis.document = antes; }
}

// Va primero: el atlas de ventanas se pinta una sola vez por proceso y aquí necesita lienzo.
test('el edificio de cinco pisos toma sus ventanas del atlas, prende cerca de una de cada tres y deja la puerta oscura', async () => {
  await conLienzo(async cuenta => {
    const edificio = buildSmallBuilding({ brickTextures: {} }), conAtlas = cuenta.gastados;
    const atlas = atlasDeVentanas();
    assert.ok(atlas?.color.isTexture);
    const otro = buildSmallBuilding({ brickTextures: {} });
    assert.equal(cuenta.gastados - conAtlas, conAtlas, 'pintar el atlas no gasta azar del juego');
    const vidrio = edificio.userData.ventanas, materiales = new Set();
    edificio.traverse(o => { if (o.isMesh) materiales.add(o.material); });
    assert.equal(materiales.size, 5, 'los mismos cinco materiales');
    assert.equal(vidrio.map, atlas.color); assert.equal(vidrio.emissiveMap, atlas.luz);
    assert.equal(vidrio.userData.windowGlow, .9); assert.equal(vidrio.emissiveIntensity, 0);
    assert.equal(otro.getObjectByName('Puerta').material.map, atlas.color);
    const celdaDe = mesh => {
      const uv = mesh.geometry.attributes.uv, columnas = new Set(), filas = new Set();
      for (let i = 0; i < uv.count; i++) {
        columnas.add(Math.min(COLUMNAS - 1, Math.floor(uv.getX(i) * COLUMNAS - 1e-6 * (uv.getX(i) > .5 ? 1 : -1))));
        filas.add(Math.min(FILAS - 1, Math.floor((1 - uv.getY(i)) * FILAS - 1e-6 * (uv.getY(i) < .5 ? 1 : -1))));
      }
      assert.equal(columnas.size, 1); assert.equal(filas.size, 1);
      return [[...columnas][0], [...filas][0]];
    };
    const ventanas = edificio.children.filter(o => o.name === 'Ventana' || o.name === 'Ventana lateral');
    assert.equal(ventanas.length, 59);
    let luz = 0;
    for (const mesh of ventanas) {
      assert.equal(mesh.material, vidrio);
      const [columna, fila] = celdaDe(mesh), aRas = mesh.position.y < 3.2;
      assert.ok(aRas ? columna % 4 === 0 : columna % 4 === 3, `${mesh.name} a ${mesh.position.y} m: columna ${columna}`);
      luz += fila === FILA.luz;
    }
    assert.ok(luz / ventanas.length >= .25 && luz / ventanas.length <= .35, `${luz} de ${ventanas.length} en la fila de luz`);
    // La puerta cae entera en el marco oscuro de una celda sin reja: 6 px de 128, sin tocar el vidrio.
    const puerta = edificio.getObjectByName('Puerta').geometry.attributes.uv, [u0, v0, u1, v1] = MARCO_OSCURO;
    for (let i = 0; i < puerta.count; i++) {
      assert.ok(puerta.getX(i) >= u0 - 1e-9 && puerta.getX(i) <= u1 + 1e-9 && puerta.getY(i) >= v0 - 1e-9 && puerta.getY(i) <= v1 + 1e-9);
    }
    const [c0, , c1, tope] = celdaVentana(7, FILA.vidrio), px = 1 / (FILAS * 128);
    assert.ok(u0 > c0 && u1 < c1 && v1 <= tope && v0 >= tope - 4.5 * px, 'dentro de la franja alta del marco');
    for (let piso = 0; piso < 5; piso++) assert.deepEqual(celdaDeVentana(piso, 1, 3.8), celdaDeVentana(piso, 1, 3.8));
  });
  const ciudad = await readFile(new URL('../src/world/districts/Bogota.js', import.meta.url), 'utf8');
  assert.match(ciudad, /this\.facadeMats\.push\(cincoPisos\.userData\.ventanas\)/, 'la ciudad las prende de noche');
});

test('sin lienzo las torres quedan como estaban', () => {
  assert.equal(fachadasDeTorres(), null);
  const material = new THREE.MeshStandardMaterial({ roughness: .95 });
  assert.equal(vestirTorres([material]), false);
  assert.equal(material.map, null);
  assert.equal(material.roughness, .95);
});

test('pintar las fachadas de las torres no gasta el azar sembrado y deja siete texturas chicas', async () => {
  await conLienzo(async cuenta => {
    const fresco = await import('../src/world/bogota/fachadaTorres.js?con-lienzo');
    const mapas = fresco.fachadasDeTorres();
    assert.equal(cuenta.gastados, 0);
    assert.equal(fresco.fachadasDeTorres(), mapas, 'se pinta una sola vez');
    assert.equal(mapas.color.length, URBAN_DESIGNS.length);
    assert.equal(new Set(mapas.color).size, URBAN_DESIGNS.length);
    for (const t of mapas.color) assert.deepEqual([t.image.width, t.image.height], [320, 640]);
    assert.deepEqual([mapas.brillo.image.width, mapas.brillo.image.height], [128, 256]);
    assert.deepEqual([mapas.luz.image.width, mapas.luz.image.height], [256, 512]);
    assert.deepEqual(mapas.luz.repeat.toArray(), [BALDOSA.vanos / LUZ.vanos, BALDOSA.pisos / LUZ.pisos]);
    for (const t of [...mapas.color, mapas.brillo, mapas.luz]) {
      assert.equal(t.wrapS, THREE.RepeatWrapping); assert.equal(t.wrapT, THREE.RepeatWrapping); assert.equal(t.anisotropy, 4);
    }
    const materiales = URBAN_DESIGNS.map(() => new THREE.MeshStandardMaterial({ bumpMap: new THREE.Texture(), roughness: .95 }));
    const sorteos = cuenta.gastados;
    assert.equal(fresco.vestirTorres(materiales), true);
    assert.equal(cuenta.gastados, sorteos, 'vestir no crea nada');
    materiales.forEach((material, i) => {
      assert.equal(material.map, mapas.color[i]);
      assert.equal(material.metalnessMap, mapas.brillo);
      assert.equal(material.roughnessMap, material.metalnessMap);
      assert.equal(material.emissiveMap, mapas.luz);
      assert.equal(material.bumpMap, null);
      assert.equal(material.userData.windowGlow, LUZ.brillo);
      assert.equal(material.emissiveIntensity, 0, 'de día, apagadas');
      assert.equal(material.clone().userData.windowGlow, LUZ.brillo, 'las copias por barrio también se prenden');
    });
  });
});

test('de noche se prende cerca de una de cada cuatro ventanas, por apartamentos y en tres tonos', () => {
  const { vestido, luces } = repartoDeTorres();
  assert.equal(repartoDeTorres().luces, luces, 'el reparto es uno solo');
  assert.equal(vestido.length, BALDOSA.vanos * BALDOSA.pisos);
  const total = LUZ.vanos * LUZ.pisos, parte = luces.length / total;
  assert.ok(parte >= .2 && parte <= .32, `${(parte * 100).toFixed(1)} % encendidas`);
  assert.equal(new Set(luces.map(l => l.p * LUZ.vanos + l.v)).size, luces.length, 'ninguna ventana se prende dos veces');
  assert.equal(new Set(luces.map(l => l.color.join())).size, 3);
  for (const l of luces) assert.ok(l.fuerza >= .3 && l.fuerza <= 1 && l.p < LUZ.pisos && l.v < LUZ.vanos);
  // Ningún piso queda todo encendido ni la mitad de la baldosa a oscuras.
  const porPiso = Array.from({ length: LUZ.pisos }, (_, p) => luces.filter(l => l.p === p).length);
  assert.ok(Math.max(...porPiso) < LUZ.vanos);
  const cortinas = vestido.filter(w => w.cortina).length, persianas = vestido.filter(w => w.persiana).length;
  assert.ok(cortinas >= 3 && cortinas <= 11, `${cortinas} cortinas`);
  assert.ok(persianas >= 1 && persianas <= 8, `${persianas} persianas`);
  assert.ok(vestido.every(w => !(w.cortina && w.persiana)));
});

test('las caras de una torre miden su fachada en vanos de 3 m y pisos de 3,2 m; el techo no cambia', () => {
  const plan = planUrbanBuildings(new Bogota()._layout()).find(p => p.floors === 30);
  const palette = { facades: URBAN_DESIGNS.map(() => new THREE.MeshStandardMaterial()),
    ...Object.fromEntries(['roof', 'interior', 'concrete', 'trim', 'rail', 'glass'].map(k => [k, new THREE.MeshStandardMaterial()])) };
  const viejo = new THREE.BoxGeometry(plan.width, plan.height, plan.depth).attributes.uv;
  const nuevo = uvDeTorre(new THREE.BoxGeometry(plan.width, plan.height, plan.depth), plan.width, plan.height, plan.depth, plan.seed).attributes.uv;
  for (const cara of [0, 1, 4, 5]) {
    const us = [0, 1, 2, 3].map(k => nuevo.getX(cara * 4 + k)), vs = [0, 1, 2, 3].map(k => nuevo.getY(cara * 4 + k));
    assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - plan.width / BALDOSA.ancho) < 1e-9);
    assert.ok(Math.abs(Math.max(...vs) - Math.min(...vs) - plan.height / BALDOSA.alto) < 1e-9);
    // Corrida vanos y pisos enteros: la ventana pintada cae detrás de la de bulto.
    assert.ok(Math.abs(Math.min(...us) * BALDOSA.vanos - Math.round(Math.min(...us) * BALDOSA.vanos)) < 1e-9);
    assert.ok(Math.abs(Math.min(...vs) * BALDOSA.pisos - Math.round(Math.min(...vs) * BALDOSA.pisos)) < 1e-9);
  }
  for (const cara of [2, 3]) for (let k = 0; k < 4; k++) {
    assert.equal(nuevo.getX(cara * 4 + k), viejo.getX(cara * 4 + k)); assert.equal(nuevo.getY(cara * 4 + k), viejo.getY(cara * 4 + k));
  }
  // En la torre armada, las cuatro paredes llevan esas medidas y la tapa sigue en su baldosa de 6 × 9,6 m.
  const shell = buildUrbanBuilding({ ...plan, design: 'concreto-bandas' }, palette);
  for (const cara of [0, 1, 4, 5]) {
    const pared = shell.walls.get(cara).children.find(m => m.isMesh && m.geometry.attributes.position.count === 4);
    const { uv, position } = pared.geometry.attributes, us = [0, 1, 2, 3].map(k => uv.getX(k)), vs = [0, 1, 2, 3].map(k => uv.getY(k));
    const ys = [0, 1, 2, 3].map(k => position.getY(k));
    assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - plan.width / BALDOSA.ancho) < 1e-6, `cara ${cara}`);
    assert.ok(Math.abs(Math.max(...vs) - Math.min(...vs) - (Math.max(...ys) - Math.min(...ys)) / BALDOSA.alto) < 1e-6, `cara ${cara}`);
  }
  let techo = 0;
  shell.roof.traverse(m => {
    if (!m.isMesh || m.material !== palette.roof || m.geometry.attributes.position.count !== 4) return;
    const uv = m.geometry.attributes.uv, us = [0, 1, 2, 3].map(k => uv.getX(k));
    assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - plan.width / 6) < 1e-6); techo++;
  });
  assert.ok(techo > 0, 'la tapa de la azotea');
});

test('el vidrio de la entrada y de los vanos lisos de las torres es claro y refleja', async () => {
  const plan = planUrbanBuildings(new Bogota()._layout()).find(p => p.floors === 30);
  const glass = new THREE.MeshStandardMaterial({ color: '#8d9ea3', roughness: .18, metalness: .45 });
  const palette = { facades: URBAN_DESIGNS.map(() => new THREE.MeshStandardMaterial()), glass,
    ...Object.fromEntries(['roof', 'interior', 'concrete', 'trim', 'rail'].map(k => [k, new THREE.MeshStandardMaterial()])) };
  const shell = buildUrbanBuilding(plan, palette);
  let entrada;
  shell.root.traverse(o => { if (o.name === 'Entrada') entrada = o.material; });
  assert.ok(entrada && entrada !== glass, 'una copia por barrio');
  assert.equal(entrada.metalness, .45); assert.equal(entrada.roughness, .18);
  const hsl = entrada.color.getHSL({}, THREE.SRGBColorSpace);
  assert.ok(hsl.l > .45 && hsl.l < .65, `claridad ${hsl.l.toFixed(2)}`);
  const ciudad = await readFile(new URL('../src/world/districts/Bogota.js', import.meta.url), 'utf8');
  assert.match(ciudad, /glass:new THREE\.MeshStandardMaterial\(\{color:'#8d9ea3',roughness:\.18,metalness:\.45\}\)/);
  assert.match(ciudad, /vestirTorres\(urbanPalette\.facades\);\n\s+for\(const plan of this\.urbanBuildings\)/, 'se visten antes de armar las torres');
});

test('el tinte del ladrillo de los costados tiene un solo dueño y no tira a naranja', async () => {
  const { TINTE_COSTADO } = await import('../src/world/bogota/textures.js');
  const ciudad = await readFile(new URL('../src/world/districts/Bogota.js', import.meta.url), 'utf8');
  assert.match(ciudad, /const sideMat = new THREE\.MeshStandardMaterial\(\{[^\n]*color: TX\.TINTE_COSTADO \}\);/);
  assert.doesNotMatch(ciudad, /#ebb99f/i);
  const hsl = new THREE.Color(TINTE_COSTADO).getHSL({}, THREE.SRGBColorSpace);
  assert.ok(hsl.s <= .42 && hsl.l >= .78, `saturación ${hsl.s.toFixed(2)}, claridad ${hsl.l.toFixed(2)}`);
});

test('cada casa lleva una sola reja y las vecinas cambian', () => {
  const rejas = new Set(), columnas = new Set();
  for (let casa = 1; casa <= 20; casa++) {
    const propias = new Set();
    for (let vano = 1; vano < 400; vano += 3) {
      const s = Math.imul(vano, 2246822519) >>> 0;
      for (const tipo of ['vidrio', 'cortina', 'luz']) propias.add(celdaDelVano(tipo, s, casa)[0]);
      assert.equal(celdaDelVano('vidrio', s, casa)[1], celdaDelVano('vidrio', s)[1], 'lo que hay detrás del vidrio sigue saliendo del vano');
      assert.equal(celdaDelVano('vidrio', s)[0], (s >>> 16) % COLUMNAS, 'sin casa, la columna de siempre');
    }
    assert.equal(propias.size, 1, `casa ${casa}`);
    columnas.add([...propias][0]); rejas.add([...propias][0] % 4);
  }
  assert.ok(rejas.size >= 3, `${rejas.size} rejas en veinte casas`);
  assert.ok(columnas.size >= 5, `${columnas.size} columnas en veinte casas`);
  // En una fachada armada, todos los vanos de bulto caen en la misma columna del atlas.
  const porCasa = seed => {
    const material = new THREE.MeshStandardMaterial();
    const shell = createBuildingShell(new THREE.BoxGeometry(12, 16, 8), Array(6).fill(material), { x: 0, z: 0, height: 16, interiorMaterial: material });
    addBuildingDetails({ shell, width: 12, depth: 8, height: 16, floors: 5, face: 4, seed, neighborhood: 'centro' });
    const vistas = new Set();
    for (const mesh of shell.walls.get(4).children) {
      const tono = mesh.material?.color?.getHexString();
      if (!mesh.userData.buildingDetails || !(mesh.material.userData.windowGlow || tono === 'a8a59a' || tono === '33494b')) continue;
      const uv = mesh.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i += 4) {
        const us = [0, 1, 2, 3].map(k => uv.getX(i + k));
        // La cortina corrida es un trozo de celda y sobre un vidrio liso va sin reja: no cuenta como vano.
        if (Math.max(...us) - Math.min(...us) > .11) vistas.add(Math.floor((Math.min(...us) + Math.max(...us)) / 2 * COLUMNAS));
      }
    }
    return vistas;
  };
  const fachadas = [11, 12, 13, 14, 15, 16, 17, 18].map(porCasa);
  for (const vistas of fachadas) assert.equal(vistas.size, 1);
  assert.ok(new Set(fachadas.map(v => [...v][0])).size >= 3);
});

/** Pinta con lienzos que anotan cada orden; devuelve los lienzos y los sorteos del juego que se gastaron. */
function grabando(pintar) {
  const lienzos = [], delJuego = Math.random, antes = globalThis.document;
  let gastados = 0;
  Math.random = () => { gastados++; return delJuego(); };
  globalThis.document = { createElement() {
    const log = [];
    const ctx = new Proxy({}, {
      get(_, k) {
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { log.push([k, ...a]); return { addColorStop: (...b) => log.push(['parada', ...b]) }; };
        if (k === 'measureText') return t => ({ width: String(t).length * 7 });
        if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
        return (...a) => { log.push([k, ...a]); };
      },
      set(_, k, v) { log.push(['=', k, typeof v === 'object' ? 'degradado' : v]); return true; }
    });
    const c = { width: 0, height: 0, getContext: () => ctx, log }; lienzos.push(c); return c;
  } };
  try { pintar(); } finally { Math.random = delJuego; globalThis.document = antes; }
  return { lienzos, gastados, huellas: lienzos.map(c => createHash('sha256').update(JSON.stringify(c.log)).digest('hex').slice(0, 16)) };
}

/** Registra el tono y el rectángulo de cada pasada que alcanza los pisos altos. */
function huellaSobrePlantaBaja(lienzo, limite) {
  const rectangulos = [];
  let tinta;
  for (const [orden, ...args] of lienzo.log) {
    if (orden === '=' && args[0] === 'fillStyle') tinta = args[1];
    if (orden === 'fillRect' && args[1] < limite) rectangulos.push([tinta, ...args]);
  }
  return createHash('sha256').update(JSON.stringify(rectangulos)).digest('hex').slice(0, 16);
}

test('pintar una fachada o un ladrillo no gasta más azar del juego que el de sus texturas y repite el dibujo', () => {
  const porTextura = grabando(() => new THREE.CanvasTexture({ width: 1, height: 1 })).gastados;
  assert.ok(porTextura > 0);
  const casos = {
    pintada: () => facade({ seed: 4242, width: 8, floors: 3 }),
    ladrillo: () => facade({ seed: 171, width: 6, floors: 3, pxPerM: 32, shopFront: false, style: 'ladrillo', wallColor: '#975c40' }),
    ruina: () => facade({ seed: 77, width: 6, floors: 2, style: 'ruina' }),
    muro: () => brick(3)
  };
  // Luz, aspereza y relieve de toda la fachada. En la planta baja el cajón de la persiana y
  // las vitrinas tienen relieve y rugosidad propios. En la torre y el ladrillo siguen las huellas de v16.
  const completas = {
    pintada: ['cff80e8a52e792bc', '67652a8be24629e0', '6dded91ffc4d8e4d'],
    ladrillo: ['a273c82270755025', '810e4043f9d55f9e', '82c32c8dc56b304d'],
    ruina: ['86e5a3b3d04bdeb5', '5a8142e8a1b05bb9', '1b66c8d6d4c89271'],
    muro: ['24b766cd3c24c1c6', '24e8df9fce1857a7', '1c2bb257aa9bdfc8']
  };
  // De v16 se conserva el dibujo completo de torre y ladrillo. En las dos fachadas con comercio,
  // estas huellas aíslan las plantas altas por encima de la cota del primer piso (3 m a 28 px/m).
  const pisosAltosV16 = {
    pintada: ['fb6a4b4034349107', 'e19371dd4a699eeb', 'a6dccc93d922a83a'],
    ruina: ['9778f6606ff6764a', 'ca91d7cdf35526c0', '09f80b14e56d31a6']
  };
  for (const [nombre, pintar] of Object.entries(casos)) {
    const a = grabando(pintar), b = grabando(pintar);
    const texturas = nombre === 'muro' ? 3 : 4;
    assert.equal(a.lienzos.length, texturas, nombre);
    assert.equal(a.gastados, texturas * porTextura, `${nombre}: solo los identificadores de sus texturas`);
    assert.deepEqual(a.huellas, b.huellas, `${nombre}: la misma semilla dibuja lo mismo`);
    assert.deepEqual(a.huellas.slice(-3), completas[nombre], `${nombre}: se conserva el dibujo completo`);
    if (pisosAltosV16[nombre]) {
      const huellas = a.lienzos.slice(-3).map(c => huellaSobrePlantaBaja(c, c.height - 3 * 28));
      assert.deepEqual(huellas, pisosAltosV16[nombre], `${nombre}: las plantas altas conservan el dibujo de v16`);
    }
  }
  assert.notDeepEqual(grabando(() => facade({ seed: 4243, width: 8, floors: 3 })).huellas, grabando(casos.pintada).huellas);
  // Con el azar del juego en otro punto, el dibujo es el mismo.
  const delJuego = Math.random;
  Math.random = () => .123;
  let fijo;
  try { fijo = grabando(casos.pintada).huellas; } finally { Math.random = delJuego; }
  assert.deepEqual(fijo, grabando(casos.pintada).huellas);
});

test('el vidrio pintado de las fachadas va en degradado y con brillo, no en un rectángulo negro', () => {
  const { lienzos } = grabando(() => facade({ seed: 171, width: 6, floors: 3, pxPerM: 32, shopFront: false, style: 'ladrillo', wallColor: '#975c40' }));
  const color = lienzos[0].log;
  assert.ok(!color.some(op => op[0] === '=' && op[1] === 'fillStyle' && op[2] === '#34434a'), 'sin el vidrio negro de antes');
  const paradas = color.filter(op => op[0] === 'parada' && (op[2] === '#4f6168' || op[2] === '#2d3a3f'));
  assert.ok(paradas.length >= 4 && paradas.length % 2 === 0, `${paradas.length / 2} vidrios apagados`);
  const brillos = color.filter(op => op[0] === '=' && op[1] === 'fillStyle' && op[2] === 'rgba(255,255,255,.08)').length;
  assert.ok(brillos >= 1 && brillos <= paradas.length / 2, `${brillos} brillos`);
  const fuente = facade.toString();
  assert.match(fuente, /const v = rng\(\(seed \^ 0x6c1a55\) >>> 0\)/);
});
