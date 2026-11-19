// La buseta por dentro y por fuera: lo que no se mueve al vestirla (tamaño, ruedas, azar, rótulos) y lo que se le pide
// a sus pasajeros, a su cielo raso y a su cola.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.window ??= new EventTarget();
const { Car } = await import('../src/entities/Car.js');
const { makeVehicle } = await import('../src/world/bogota/vehicles.js');
const { CAR_MODELS, LAMP } = await import('../src/world/bogota/carModels.js');
const { getCarBody, getCarGeometry } = await import('../src/world/bogota/VehicleBody.js');
const { Batch } = await import('../src/world/bogota/carParts.js');
const { addBusetaInterior } = await import('../src/world/bogota/BusetaInterior.js');
const { BUS_ESCAPE, BUS_FRASES, BUS_LIBREAS, BUS_NUMERO, pintarMugreBuseta } = await import('../src/world/bogota/carLibreas.js');
const { GENTE, LAMINA, LIENZO, REPARTOS, TECHO, TUBOS, TUBO_LARGO, pintarPasajeros, repartoDe } = await import('../src/world/bogota/pasajerosBuseta.js');

const triangulos = geometry => geometry.index.count / 3;
const buseta = (semilla, traffic = true) => new Car(new THREE.Scene(), new THREE.Vector3(), 0, { traffic, kind: 'buseta', variant: semilla });
const mallas = car => { const lista = []; car.group.traverse(o => { if (o.isMesh) lista.push(o); }); return lista; };
const pasajeros = car => mallas(car).filter(m => m.material.name === 'Pasajeros de buseta');
// Lienzo de mentira: anota a qué se llama y con qué, sin pintar nada.
function lienzoDePrueba() {
  const llamadas = [];
  const ctx = new Proxy({}, { get: (target, key) => key in target ? target[key] : (...args) => { llamadas.push([key, ...args]); return { addColorStop() {} }; }, set: (target, key, value) => { target[key] = value; return true; } });
  return { ctx, llamadas };
}

// Tiradas de Math.random de una fila fija de busetas, las primeras del proceso: tres del tráfico, una parqueada y dos
// recién salidas de la fábrica. Si un número cambia, el tráfico sembrado recibe otras tiradas y la ciudad sale distinta.
const TIRADAS = [382, 162, 72, 158, 92, 92];

test('armar busetas gasta del azar del juego lo mismo que antes de vestirlas', () => {
  // El azar de la prueba va sembrado: la ropa del conductor sale de él y cada combinación nueva arma su malla.
  const random = Math.random, tiradas = [];
  let rolls = 0, a = 0xB05E7A;
  Math.random = () => { rolls++; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try {
    for (const [semilla, traffic] of [[444, true], [888, true], [444, false], [12 * 37, true]]) { rolls = 0; buseta(semilla, traffic); tiradas.push(rolls); }
    for (const semilla of [24 * 37, 5]) { rolls = 0; makeVehicle('buseta', semilla, {}).dispose(); tiradas.push(rolls); }
  } finally { Math.random = random; }
  assert.deepEqual(tiradas, TIRADAS);
});

test('la buseta conserva su caja de choque, sus medidas y sus ruedas', () => {
  const spec = CAR_MODELS.buseta, v = makeVehicle('buseta', 444, {});
  assert.deepEqual([v.length, v.width, v.height, v.wheelRadius, v.wheelbase, v.wheels.length], [7.6, 2.3, 3, .46, 4, 4]);
  assert.deepEqual([spec.L, spec.W, spec.H, spec.wb, spec.r, spec.front], [7.6, 2.3, 3, 4, .46, 1.25]);
  assert.deepEqual(spec.wheel, { rim: 'rimBuseta', width: .25, depth: .03, spokes: 0, rimRatio: .58 });
  // Nada de lo que se le cuelgue sobresale de la carrocería de siempre.
  const geo = getCarGeometry('buseta', 'buseta'), caja = new THREE.Box3();
  for (const pieza of [geo.paint, geo.trim, geo.lamp, geo.glass]) { pieza.computeBoundingBox(); caja.union(pieza.boundingBox); }
  const redondo = v3 => v3.toArray().map(n => Math.round(n * 1000) / 1000);
  assert.deepEqual([redondo(caja.min), redondo(caja.max)], [[-3.825, .04, -1.213], [3.824, 3.102, 1.213]]);
  v.dispose();
});

test('la cabina nueva conserva la chapa, los vidrios y el coste de las otras molduras', () => {
  const geo = getCarGeometry('buseta', 'buseta'), gente = pasajeros(buseta(444))[0];
  assert.equal(triangulos(geo.paint), 2928);
  assert.equal(triangulos(geo.glass), 198);
  const trim = new Batch(), lamp = new Batch({ lamp: true });
  addBusetaInterior({ trim, lamp }, CAR_MODELS.buseta.interior.floor, LAMP.SIGN);
  const oldSeatTriangles = 6 * 12;
  // De la moldura previa se descuentan sólo los seis espaldares de ancho completo.
  assert.equal(triangulos(geo.trim) - trim.triangles, 1840 - 360 + 136 - oldSeatTriangles);
  assert.ok(trim.triangles - oldSeatTriangles <= 520, 'La buseta con conductor sigue dentro de 7000 triángulos');
  // El tablero, la placa y los cartones se vuelven a ubicar dentro del mismo presupuesto de lámparas.
  assert.equal(triangulos(geo.lamp) - lamp.triangles, 186 + 4 * 12 - 8);
  assert.equal(triangulos(gente.geometry), 6);
});

test('las seis filas tienen bancas a ambos lados y dejan un pasillo continuo sobre el piso', () => {
  const { trim, lamp } = getCarGeometry('buseta', 'buseta'), spec = CAR_MODELS.buseta;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const seats = new THREE.Mesh(trim, material), lights = new THREE.Mesh(lamp, material);
  const towardsFront = z => new THREE.Raycaster(new THREE.Vector3(-3.30, 1.75, z), new THREE.Vector3(1, 0, 0), 0, 5.6);
  for (const z of [-.29, 0, .29]) assert.equal(towardsFront(z).intersectObject(seats).length, 0, `pasillo en Z=${z}`);
  for (const side of [-1, 1]) {
    const hits = towardsFront(side * LAMINA.z).intersectObject(seats);
    for (let row = 0; row < 6; row++) {
      const x = -2.95 + .96 * row;
      assert.ok(hits.some(hit => Math.abs(hit.point.x - x) < .12), `espaldar de la fila ${row} al lado ${side}`);
    }
  }
  const down = new THREE.Raycaster(new THREE.Vector3(0, 1.70, 0), new THREE.Vector3(0, -1, 0));
  const [floor] = down.intersectObject(lights);
  assert.ok(Math.abs(floor.point.y - spec.interior.floor) < 1e-6, 'La lámina de luz coincide con el piso del pasillo');
  material.dispose();
});

test('una buseta suma una sola malla, la de sus pasajeros, con un material y un lienzo que comparten todas', () => {
  const una = buseta(444), otra = buseta(888), lista = mallas(una);
  assert.equal(lista.length, 15 + 1);
  assert.equal(new Set(lista.map(m => m.material)).size, 7 + 1);
  assert.equal(mallas(buseta(444, false)).length, 7 + 1, 'parqueada');
  const [a] = pasajeros(una), [b] = pasajeros(otra);
  assert.equal(pasajeros(una).length, 1);
  assert.ok(a.material === b.material && a.material.map === b.material.map, 'un material y una textura para todas');
  assert.deepEqual([LIENZO.W, LIENZO.H], [1024, 512]);
  assert.equal(a.castShadow, false);
  // Se apaga de lejos con las molduras y los vidrios: lejos no cuesta ni su pedido de dibujo.
  una.updateLod(70 * 70);
  assert.equal(a.visible, false);
  una.updateLod(10 * 10);
  assert.equal(a.visible, true);
  // Un particular no lleva pasajeros pintados.
  assert.equal(pasajeros(new Car(new THREE.Scene(), new THREE.Vector3(), 0, { traffic: true, kind: 'carro', variant: 7 })).length, 0);
});

test('las dos busetas de la partida no llevan la misma gente: cuatro repartos, elegidos por la semilla', () => {
  assert.equal(REPARTOS.length, 4);
  assert.notEqual(repartoDe(12 * 37), repartoDe(24 * 37), 'las dos del tráfico');
  assert.equal(new Set(Array.from({ length: 40 }, (_, unidad) => repartoDe(unidad * 37))).size, 4, 'salen los cuatro');
  assert.equal(new Set(REPARTOS.map(r => JSON.stringify(r))).size, 4);
  const [a] = pasajeros(buseta(12 * 37)), [b] = pasajeros(buseta(24 * 37)), [c] = pasajeros(buseta(12 * 37));
  assert.notEqual(a.geometry, b.geometry);
  assert.ok(a.geometry === c.geometry, 'la misma semilla trae el mismo reparto, con la misma geometría');
  assert.notDeepEqual([...a.geometry.attributes.uv.array], [...b.geometry.attributes.uv.array]);
  // Cada costado lleva una fila distinta, corrida un número entero de puestos.
  for (const [[fa, ca], [fb, cb]] of REPARTOS) { assert.notEqual(fa, fb); assert.ok(Number.isInteger(ca) && Number.isInteger(cb) && ca < 6 && cb < 6); }
});

test('las láminas van por dentro de cada costado, a la altura de las ventanas, y miran hacia afuera', () => {
  const spec = CAR_MODELS.buseta, [gente] = pasajeros(buseta(444)), { position, normal, uv } = gente.geometry.attributes;
  assert.ok(LAMINA.z >= spec.W / 2 - .36 && LAMINA.z <= spec.W / 2 - .2, `a ${(spec.W / 2 - LAMINA.z).toFixed(2)} m del costado`);
  assert.ok(LAMINA.x0 > spec.windows[0][0] && LAMINA.x1 < spec.windows[5][1]);
  assert.ok(LAMINA.y0 < 1.62 && LAMINA.y1 > 2.2 && LAMINA.y1 < 2.72);
  for (let i = 0; i < 8; i++) {
    assert.ok(Math.abs(Math.abs(position.getZ(i)) - LAMINA.z) < 1e-6);
    assert.equal(normal.getZ(i), Math.sign(position.getZ(i)), 'el frente de cada lámina da a su ventana');
    assert.ok(uv.getY(i) >= 1 - 2 * LIENZO.fila / LIENZO.H && uv.getY(i) <= 1);
  }
  // La U corre con la X en los dos costados: la gente mira hacia el frente del bus desde cualquier acera.
  for (let i = 0; i < 8; i += 4) {
    const du = uv.getX(i + 1) - uv.getX(i), dx = position.getX(i + 1) - position.getX(i);
    assert.ok(du * dx > 0);
  }
  assert.equal(gente.material.map.wrapS, THREE.RepeatWrapping);
});

test('la gente pintada: puestos libres, una gorra, un celular, un dormido, y ningún color chillón', () => {
  const todos = GENTE.flat().filter(Boolean);
  for (const fila of GENTE) { assert.equal(fila.length, 6); assert.ok(fila.filter(p => !p).length >= 2, 'puestos libres en cada costado'); }
  for (const rasgo of ['gorra', 'celular', 'dormido', 'cuello', 'bufanda', 'largo']) assert.ok(todos.some(p => p[rasgo]), rasgo);
  assert.ok(todos.some(p => p.tipo === 'ruana') && todos.some(p => p.tipo === 'chaqueta'));
  assert.ok(new Set(todos.map(p => p.ropa)).size === todos.length, 'nadie repite ropa');
  const hsl = {};
  for (const p of todos) for (const clave of ['ropa', 'cuello', 'gorra', 'gorro', 'bufanda', 'raya']) {
    if (!p[clave]) continue;
    new THREE.Color(p[clave]).getHSL(hsl, THREE.SRGBColorSpace);
    assert.ok(hsl.s <= .32 && hsl.l <= .5, `${clave} ${p[clave]}: saturación ${hsl.s.toFixed(2)}, luz ${hsl.l.toFixed(2)}`);
  }
  // Pintar no gasta el azar del juego y cada persona cae dentro de su puesto.
  const random = Math.random, { ctx, llamadas } = lienzoDePrueba();
  let rolls = 0;
  Math.random = () => { rolls++; return random(); };
  try { pintarPasajeros(ctx); } finally { Math.random = random; }
  assert.equal(rolls, 0);
  assert.equal(llamadas.filter(([nombre]) => nombre === 'setTransform').length, todos.length);
  const pxY = LIENZO.fila / (LAMINA.y1 - LAMINA.y0);
  for (const [, , , , d, , f] of llamadas.filter(([nombre]) => nombre === 'setTransform')) assert.ok(d === -pxY && [0, 1].some(fila => f === fila * LIENZO.fila + LAMINA.y1 * pxY));
  assert.ok(llamadas.filter(([nombre]) => nombre === 'createRadialGradient').length >= todos.length, 'cada cara lleva su sombreado');
});

test('de noche la luz del techo alumbra a la gente con el aviso de la buseta, y por detrás quedan siluetas', () => {
  const car = buseta(444), [gente] = pasajeros(car), material = gente.material;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  const luz = shader.uniforms.uLuzBuseta.value;
  car.setNight(false); gente.onBeforeRender();
  assert.ok(luz.r + luz.g + luz.b < .05, 'de día no alumbra');
  car.setNight(true); gente.onBeforeRender();
  assert.ok(luz.g > .5 && luz.b >= luz.r, 'de noche, luz fría de tubo');
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance = uLuzBuseta * diffuseColor.rgb;'));
  assert.ok(shader.fragmentShader.includes('if ( ! gl_FrontFacing ) diffuseColor.rgb = diffuseColor.rgb * .1'), 'por detrás, la silueta oscura');
  assert.ok(shader.fragmentShader.includes('sunFieldLit'), 'recibe el campo de sol como el resto del carro');
  assert.equal(material.side, THREE.DoubleSide);
  assert.ok(material.alphaTest >= .4);
  assert.equal(car.vehicle.bodyVisual.children.filter(o => o.isLight).length, 0, 'ninguna luz real');
});

test('el cielo raso va pintado con su mugre bajo el de siempre, y de él cuelgan cuatro tubos más claros que todo lo demás', () => {
  const geo = getCarGeometry('buseta', 'buseta'), { position, lamp, color } = geo.lamp.attributes;
  const [gente] = pasajeros(buseta(444)), p = gente.geometry.attributes.position, n = gente.geometry.attributes.normal, uv = gente.geometry.attributes.uv;
  // La lámina pintada: los cuatro últimos vértices de la malla de la gente, mirando hacia abajo.
  for (let i = 8; i < 12; i++) {
    assert.ok(Math.abs(p.getY(i) - TECHO.y) < 1e-6 && n.getY(i) === -1);
    assert.ok(uv.getY(i) > 0 && uv.getY(i) < LIENZO.techo / LIENZO.H, 'cae en la franja del cielo raso del lienzo');
  }
  // El de siempre queda encima, a más de lo que el material de lámparas se acerca a la cámara (unos 5 cm): no se pisan.
  assert.ok(2.86 - TECHO.y >= .07 && TECHO.y > LAMINA.y1 + .3);
  assert.equal(TUBOS.length, 4);
  let tubos = 0, claro = 0, raso = 9;
  for (let i = 0; i < position.count; i++) {
    if (lamp.getX(i) !== LAMP.SIGN) continue;
    const y = position.getY(i), luz = color.getX(i) + color.getY(i) + color.getZ(i);
    if (y > 2.7 && y < TECHO.y) { tubos++; claro = Math.max(claro, luz); assert.ok(Math.abs(position.getZ(i)) <= .04 && TUBOS.some(x => Math.abs(position.getX(i) - x) <= TUBO_LARGO / 2 + 1e-6)); }
    else if (Math.abs(y - 2.86) < 1e-6) raso = Math.min(raso, luz);
  }
  assert.equal(tubos, 4 * 24, 'cuatro cajas en el canal del aviso: prenden con él');
  assert.ok(claro > raso * 4, 'los tubos son mucho más claros que el cielo raso');
  // El dibujo: fondo, manchas, juntas y una lámpara por tubo, sin gastar azar.
  const random = Math.random, { ctx, llamadas } = lienzoDePrueba();
  let rolls = 0;
  Math.random = () => { rolls++; return random(); };
  try { pintarPasajeros(ctx); } finally { Math.random = random; }
  assert.equal(rolls, 0);
  const y0 = LIENZO.H - LIENZO.techo, enTecho = llamadas.filter(([nombre, , y, , h]) => nombre === 'fillRect' && y >= y0 - 4 && y + h <= LIENZO.H + 4);
  assert.ok(enTecho.some(([, x, y, w, h]) => x === 0 && y === y0 && w === LIENZO.W && h === LIENZO.techo), 'el fondo cubre toda la franja');
  assert.ok(enTecho.length >= 1 + 4 * 3 + 5, `${enTecho.length} rellenos en el cielo raso`);
});

test('el tablero de ruta, la empresa, el número y las frases siguen letra por letra', () => {
  assert.deepEqual(BUS_LIBREAS.map(l => [l.empresa, ...l.cartones.map(([a, b]) => `${a}/${b}`)]), [
    ['COOTRANS EL CAMBUCHE', 'SOACHA/SAN MATEO', 'BOSA/CRA 10'],
    ['RUTAS DE LA CAPITAL', 'ENGATIVÁ/CALLE 80', 'MINUTO/CORINTO'],
    ['FLOTA LA ESQUINITA', 'SUBA/CALLE 100', 'CENTRO/CRA 7MA'],
    ['EXPRESO EL CHATO', 'FONTIBÓN/CALLE 26', 'SALITRE/GERMANIA'],
  ]);
  assert.deepEqual(BUS_FRASES, [['DIOS ES', 'MI GUÍA'], ['EL CONSENTIDO', 'DE MI MAMÁ'], ['NO ME SIGA', 'QUE VOY PERDIDO'], ['GRACIAS', 'MADRE MÍA']]);
  assert.deepEqual(BUS_NUMERO, { x0: -3.47, x1: -2.83, y0: 1.04, y1: 1.36 });
  assert.deepEqual([0, 444, 888, 12 * 37, 24 * 37, 5].map(s => makeVehicle('buseta', s, {}).routeIndex), [0, 1, 2, 1, 2, 0]);
});

test('el tubo de escape asoma abajo a la izquierda de la cola, grueso y con la boca negra, sin alargar la buseta', () => {
  const geo = getCarGeometry('buseta', 'buseta'), p = geo.trim.attributes.position, c = geo.trim.attributes.color, tubo = [];
  for (let i = 0; i < p.count; i++) {
    const radio = Math.hypot(p.getY(i) - BUS_ESCAPE.y, p.getZ(i) + BUS_ESCAPE.z);
    if (p.getX(i) < -3.5 && radio < .06) tubo.push({ x: p.getX(i), radio, brillo: Math.max(c.getX(i), c.getY(i), c.getZ(i)) });
  }
  assert.ok(BUS_ESCAPE.z > .6 && BUS_ESCAPE.y < .58, 'a la izquierda y por debajo de la defensa');
  assert.ok(tubo.length >= 32, `${tubo.length} vértices`);
  const xs = tubo.map(v => v.x), largo = Math.max(...xs) - Math.min(...xs);
  assert.ok(largo >= .25 && largo <= .27, `largo ${largo}`);
  assert.ok(Math.min(...xs) > -3.825 && Math.min(...xs) < -3.8, 'la boca no pasa de donde ya llegaba la buseta');
  assert.ok(tubo.some(v => Math.abs(v.radio - .045) < .001) && tubo.every(v => v.radio < .0455), 'unos 4,5 cm de radio');
  assert.ok(tubo.every(v => v.brillo < .06), 'tubo y boca, tiznados');
});

test('las defensas negras llevan barro y rayones, siempre oscuros', () => {
  const { position: p, normal, color: c } = getCarGeometry('buseta', 'buseta').trim.attributes;
  for (const [lado, alto] of [[1, [.5, .8]], [-1, [.58, .84]]]) {
    const tonos = new Set();
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) * lado < 3.3 || p.getY(i) < alto[0] - .001 || p.getY(i) > alto[1] + .001 || Math.abs(p.getZ(i)) > 1.2) continue;
      if (normal.getX(i) * lado < .4) continue;
      if (Math.hypot(p.getY(i) - BUS_ESCAPE.y, p.getZ(i) + BUS_ESCAPE.z) < .06) continue;
      const color = [c.getX(i), c.getY(i), c.getZ(i)];
      assert.ok(Math.max(...color) <= .2, `defensa clara: ${color}`);
      tonos.add(color.map(n => n.toFixed(2)).join());
    }
    assert.ok(tonos.size >= 8, `${tonos.size} tonos en la defensa ${lado > 0 ? 'delantera' : 'trasera'}`);
  }
});

test('la defensa y la parrilla dejan a la vista toda la placa delantera', () => {
  const material = new THREE.MeshBasicMaterial();
  const { paint, trim, lamp } = getCarGeometry('buseta', 'buseta');
  const placa = new THREE.Mesh(lamp, material);
  const frente = [placa, new THREE.Mesh(trim, material), new THREE.Mesh(paint, material)];
  for (const y of [.83, .885, .94]) for (const z of [-.13, 0, .13]) {
    const rayo = new THREE.Raycaster(new THREE.Vector3(5, y, z), new THREE.Vector3(-1, 0, 0));
    const [golpe] = rayo.intersectObjects(frente);
    assert.equal(golpe.object, placa);
    assert.equal(lamp.attributes.lamp.getX(golpe.face.a), LAMP.PLATE);
  }
  material.dispose();
});

test('la mugre de cola y frente: hollín al 55 % que nace en el tubo y se abre al subir, chorreones finos y polvo con insectos, sin gastar azar', () => {
  const rects = [], hilos = [];
  const degradado = (...donde) => { const d = { donde, paradas: [], addColorStop(t, color) { this.paradas.push([t, color]); } }; hilos.push(d); return d; };
  const ctx = { fillStyle: '', fillRect(x, y, w, h) { rects.push([this.fillStyle, x, y, w, h]); }, createLinearGradient: degradado, createRadialGradient: degradado };
  const body = getCarBody('buseta'), spec = CAR_MODELS.buseta, cola = -spec.L / 2;
  const carta = { sx: x => x * 100, sy: y => -y * 100, body };
  const random = Math.random;
  let rolls = 0;
  Math.random = () => { rolls++; return random(); };
  try { pintarMugreBuseta(ctx, carta, spec.windows.map(([x0]) => x0 - .03), cola, 2.95, BUS_ESCAPE); } finally { Math.random = random; }
  assert.equal(rolls, 0);

  const alfa = color => Number(/,([\d.]+)\)$/.exec(color)[1]);
  const hollin = rects.filter(([estilo, , , w]) => typeof estilo === 'string' && estilo.startsWith('rgba(27,24,20,') && w > 0);
  const franjas = new Map();
  for (const [estilo, x, y, w] of hollin) { const f = franjas.get(y) ?? { resto: 1, ancho: 0 }; f.resto *= 1 - alfa(estilo); f.ancho = Math.max(f.ancho, w); franjas.set(y, f); }
  const alturas = [...franjas.keys()].sort((a, b) => b - a), abajo = franjas.get(alturas[0]), arriba = franjas.get(alturas.at(-1));
  assert.ok(Math.abs(1 - abajo.resto - .55) < .03, `hollín al ${1 - abajo.resto} junto al tubo`);
  assert.ok(1 - arriba.resto < .1 && arriba.ancho > abajo.ancho, 'arriba se abre y se pierde');
  assert.ok(-alturas.at(-1) / 100 >= BUS_ESCAPE.y + .5 && -alturas.at(-1) / 100 <= BUS_ESCAPE.y + .62, 'sube medio metro');

  const chorreones = rects.filter(([estilo, , , w]) => estilo?.paradas?.[0]?.[1].startsWith('rgba(27,24,20,'));
  assert.equal(chorreones.length, 7 + 16);
  for (const [estilo, x, y, w, h] of chorreones) {
    assert.ok(w <= 1.7 && h >= 8 && h <= 44 && [1.7, 1.6].some(borde => Math.abs(y + borde * 100) < 1e-9), `hilos finos que bajan del borde de la ventana: ${[x, y, w, h]}`);
    assert.ok(alfa(estilo.paradas[0][1]) <= .42 && alfa(estilo.paradas[1][1]) === 0);
  }
  assert.ok(chorreones.filter(([, x]) => x < (cola + .1) * 100).length === 7 && chorreones.filter(([, x]) => x > (cola + .4) * 100 && x < (cola + 2.7) * 100).length === 16);

  const polvo = rects.filter(([estilo]) => estilo?.paradas?.some(([, color]) => color.startsWith('rgba(125,110,88,')));
  assert.equal(polvo.length, 7);
  assert.equal(Math.max(...polvo.flatMap(([estilo]) => estilo.paradas.map(([, color]) => alfa(color)))), .3);
  for (const [estilo, x, y, w, h] of polvo) {
    assert.ok(x >= (-cola - 1) * 100 && Math.abs(y + 142) < 1e-9 && Math.abs(y + h + 50) < 1e-9, 'del borde de abajo a 1,42 m, en la punta');
    assert.equal(alfa(estilo.paradas[0][1]), 0);
  }
  const insectos = rects.filter(([estilo]) => typeof estilo === 'string' && estilo.startsWith('rgba(38,32,24,'));
  assert.equal(insectos.length, 46);
  assert.ok(insectos.every(([, x, y, w, h]) => w <= 1.4 && h <= 2.8 && -y / 100 > .8 && -y / 100 < 2));

  rects.length = 0;
  pintarMugreBuseta(ctx, carta, spec.windows.map(([x0]) => x0 - .03), cola, 2.95);
  assert.ok(!rects.some(([estilo]) => typeof estilo === 'string' && estilo.startsWith('rgba(27,24,20,')), 'sin tubo, solo la mugre de antes');
});
