import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { CAR_MODELS, LAMP, MODEL_PAINTS, TAXI_COLOR, dameroDe } from '../src/world/bogota/carModels.js';
import { getCarBody } from '../src/world/bogota/VehicleBody.js';
import { ATLAS_HEIGHT, ATLAS_SIZE, PUBLIC_PLATES, RECT, drawAtlas, plateCell } from '../src/world/bogota/carAtlas.js';
import { BUS_FRASES, BUS_LIBREAS, BUS_PAINTS, DAMERO_ALTO, TAXI_EMPRESAS, TAXI_INTERNOS, TAXI_YELLOWS, esTaxi, libreaDe, rutaDe } from '../src/world/bogota/carLibreas.js';
import { edadDe } from '../src/world/bogota/carUso.js';

const lamps = vehicle => vehicle.bodyVisual.children.find(mesh => mesh.name === 'Lámparas y placas').geometry;

/** Vértices del lote de lámparas cuya UV cae dentro de una celda del atlas. */
function inCell(geometry, [x, y, w, h]) {
  const { position, uv } = geometry.attributes, found = [];
  for (let i = 0; i < uv.count; i++) {
    const px = uv.getX(i) * ATLAS_SIZE, py = (1 - uv.getY(i)) * ATLAS_HEIGHT;
    if (px >= x && px <= x + w && py >= y && py <= y + h) found.push([position.getX(i), position.getY(i), position.getZ(i)]);
  }
  return found;
}

/** Lienzo de mentira: no pinta, pero revienta con un nombre mal escrito, un número no finito o un argumento indefinido. */
function fakeCanvas() {
  const texts = [], gradient = { addColorStop(offset, color) { assert.ok(Number.isFinite(offset) && typeof color === 'string'); } };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => { assert.ok(args.every(Number.isFinite), `${key}(${args})`); return gradient; };
      return (...args) => {
        if (key === 'fillText') texts.push(args[0]);
        for (const arg of args) assert.ok(arg !== undefined && (typeof arg !== 'number' || Number.isFinite(arg)), `${String(key)}(${args})`);
      };
    },
    set(target, key, value) { assert.ok(value !== undefined, `asigna indefinido a ${String(key)}`); target[key] = value; return true; },
  });
  return { ctx, texts };
}

test('el atlas de la flota se pinta entero, con los rótulos del transporte público y sin gastar azar del juego', () => {
  const { ctx, texts } = fakeCanvas(), random = Math.random;
  let rolls = 0;
  Math.random = () => { rolls++; return random(); };
  try { drawAtlas(ctx); } finally { Math.random = random; }
  assert.equal(rolls, 0, 'pintar el atlas no tira del azar global');
  for (const empresa of TAXI_EMPRESAS) assert.ok(texts.includes(empresa.nombre), empresa.nombre);
  for (const numero of TAXI_INTERNOS) assert.ok(texts.includes(numero), `número interno ${numero}`);
  for (const librea of BUS_LIBREAS) assert.ok(texts.includes(librea.empresa), librea.empresa);
  for (const { tablero } of BUS_LIBREAS) for (const texto of [tablero.num, tablero.dest, tablero.via]) assert.ok(texts.includes(texto), texto);
  for (const frase of BUS_FRASES) for (const renglon of frase) assert.ok(texts.includes(renglon), renglon);
  assert.ok(!/Math\.random\s*\(/.test(readFileSync(new URL('../src/world/bogota/carLibreas.js', import.meta.url), 'utf8')), 'carLibreas.js usa su propio azar sembrado');
});

test('cada taxi tiene su número interno y los teléfonos pintados no existen', () => {
  assert.equal(TAXI_INTERNOS.length, PUBLIC_PLATES.length, 'un número por placa pública');
  assert.equal(new Set(TAXI_INTERNOS).size, TAXI_INTERNOS.length, 'sin números repetidos');
  for (const empresa of TAXI_EMPRESAS) assert.match(empresa.telefono, /^555 /, `${empresa.nombre}: prefijo que no existe`);
  assert.equal(new Set([...TAXI_EMPRESAS.map(e => e.nombre), ...BUS_LIBREAS.map(l => l.empresa)]).size, TAXI_EMPRESAS.length + BUS_LIBREAS.length, 'cada empresa con su nombre');
  // El esmalte de hoy sigue siendo el primero de la lista: la carrocería no cambia hasta que la fábrica elija amarillo por carro.
  assert.equal(TAXI_YELLOWS[0], TAXI_COLOR);
  assert.equal(TAXI_YELLOWS.length, 3);
});

/** Lienzo que solo anota los rectángulos que se pintan, en metros de la carta lateral (1 px = 1 cm, sin voltear). */
function cartaDePrueba(body, variante) {
  const rects = [];
  const ctx = new Proxy({}, { get: (target, key) => key === 'fillRect' ? (x, y, w, h) => rects.push([x / 100, -(y + h) / 100, w / 100, h / 100]) : key in target ? target[key] : () => ({ addColorStop() {} }), set: (target, key, value) => { target[key] = value; return true; } });
  return { ctx, rects, carta: { sx: x => x * 100, sy: y => -y * 100, tx: x => x * 100, ty: z => z * 100, pxX: 100, pxY: 100, W: 1024, H: 512, body, variante, seam() {}, stroke() {} } };
}

test('el damero del taxi va pintado en la chapa: cuadros de 5 cm en dos filas, de arco a arco, y solo con la librea de taxi', () => {
  for (const model of ['citadino', 'sedanPopular']) {
    const spec = CAR_MODELS[model], body = getCarBody(model), { stripeY, x0, x1 } = dameroDe(spec, body);
    const sin = cartaDePrueba(body, ''); spec.detail(sin.ctx, sin.carta);
    const con = cartaDePrueba(body, 'taxi'); spec.detail(con.ctx, con.carta);
    const cuadros = con.rects.slice(sin.rects.length);
    assert.deepEqual(con.rects.slice(0, sin.rects.length), sin.rects, `${model}: la librea no cambia lo que el modelo ya pintaba`);
    assert.ok(cuadros.length >= 30, `${model}: ${cuadros.length} cuadros`);
    for (const [x, y, w, h] of cuadros) {
      assert.ok(Math.abs(w - .05) < .012 && Math.abs(h - .05) < .012, `${model}: cuadro de ${w.toFixed(3)} × ${h.toFixed(3)} m`);
      assert.ok(x >= x0 - .011 && x + w <= x1 + .011, `${model}: el damero se sale de los arcos en x ${x.toFixed(2)}`);
      const base = stripeY(x + w / 2);
      assert.ok(y >= base - .011 && y + h <= base + DAMERO_ALTO + .011, `${model}: cuadro fuera de la franja de 10 cm en x ${x.toFixed(2)}`);
    }
    // Ajedrezado: cada columna alterna la fila.
    for (let i = 1; i < cuadros.length; i++) assert.ok(Math.abs(Math.abs(cuadros[i][1] - cuadros[i - 1][1]) - .05) < .03, `${model}: columnas ${i - 1} y ${i} en la misma fila`);
  }
});

test('el taxi lleva, bajo el damero, número en la puerta trasera y empresa en la delantera, y su mapa de detalle es el de la librea', () => {
  for (const [model, empresa] of [['citadino', RECT.taxiEmpresa0], ['sedanPopular', RECT.taxiEmpresa1]]) {
    const v = makeVehicle('taxi', 3, { beams: false, model }), geometry = lamps(v);
    // El mapa del taxi es el de su librea con el polvo de su edad de taxi (carUso.js).
    assert.equal(v.wetMaterials[0].map.name, `Detalle ${model}:taxi@${edadDe(model, 'taxi')}`);
    const particular = makeVehicle('carro', 3, { beams: false, model });
    assert.equal(particular.wetMaterials[0].map.name, `Detalle ${model}`, 'el particular del mismo modelo no lleva damero');
    particular.dispose();
    const { stripeY } = dameroDe(CAR_MODELS[model], getCarBody(model));
    const sign = inCell(geometry, empresa).filter(p => p[2] > 0), door = [], roof = [];
    const { position, lamp } = geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      if (lamp.getX(i) !== LAMP.PLATE) continue;
      if (position.getZ(i) > .4 && position.getY(i) < 1.2 && Math.abs(position.getX(i)) < 1.2) door.push([position.getX(i), position.getY(i)]);
      if (position.getY(i) > 1.2) roof.push(position.getZ(i));
    }
    assert.ok(sign.length >= 4 && door.length >= 4, `${model}: rótulos en las dos puertas`);
    for (const [x, y] of [...sign, ...door]) assert.ok(y < stripeY(x) + .001, `${model}: un rótulo sube hasta el damero en x ${x.toFixed(2)}`);
    assert.ok(Math.max(...door.map(p => p[0])) < Math.min(...sign.map(p => p[0])), `${model}: el número va en la puerta de atrás y la empresa en la de adelante`);
    assert.ok(Math.max(...roof) - Math.min(...roof) > .7, `${model}: la placa del techo cruza el techo de lado a lado`);
    v.dispose();
  }
});

test('de noche encienden con el aviso el capacete entero del taxi y los dos ruteros de la buseta, sin luces nuevas', () => {
  const taxi = makeVehicle('taxi', 3, { beams: false, model: 'citadino' }), particular = makeVehicle('carro', 3, { beams: false, model: 'citadino' });
  const enAviso = vehicle => { const { lamp } = lamps(vehicle).attributes; let n = 0; for (let i = 0; i < lamp.count; i++) if (lamp.getX(i) % 10 === LAMP.SIGN) n++; return n; };
  // Dos caras con letrero, la tapa y los dos costados: todo el acrílico va en el canal del aviso.
  assert.ok(enAviso(taxi) - enAviso(particular) >= 8 + 4 + 12, `capacete en el canal del aviso (${enAviso(taxi) - enAviso(particular)} vértices)`);
  const hijos = vehicle => { let luces = 0; vehicle.group.traverse(o => { if (o.isLight) luces++; }); return luces; };
  const buseta = makeVehicle('buseta', 12 * 37, { beams: false }), { lamp, position } = lamps(buseta).attributes;
  let adelante = 0, atras = 0;
  for (let i = 0; i < lamp.count; i++) if (lamp.getX(i) === LAMP.ROUTE) { if (position.getX(i) > 3) adelante++; else if (position.getX(i) < -3) atras++; }
  assert.ok(adelante >= 4 && atras >= 4, `tablero adelante (${adelante}) y rutero atrás (${atras})`);
  assert.equal(hijos(taxi) + hijos(buseta), 0, 'ninguna luz de Three: todo es emisivo de la textura');
  for (const v of [taxi, particular, buseta]) v.dispose();
});

test('la librea de la buseta cambia con la ruta sin salirse del atlas, y su esmalte de fondo con el carro', () => {
  assert.deepEqual(MODEL_PAINTS.buseta, BUS_PAINTS);
  assert.equal(BUS_LIBREAS.length, 4, 'una librea por tablero de ruta');
  const v = makeVehicle('buseta', 12 * 37, { beams: false }), geometry = lamps(v), { uv, lamp, position } = geometry.attributes;
  let livery = 0, light = 0;
  for (let i = 0; i < lamp.count; i++) {
    if (lamp.getX(i) === LAMP.SIGN && position.getY(i) > 1.4 && position.getY(i) < 2.9 && Math.abs(position.getX(i)) < 3.6) light++;
    if (lamp.getX(i) !== LAMP.LIVERY) continue;
    livery++;
    // La fila de la ruta 0 mide 64 px; las otras tres quedan 64, 128 y 192 px más abajo y también deben caber.
    const py = (1 - uv.getY(i)) * ATLAS_HEIGHT;
    assert.ok(py >= RECT.busLibrea[1] - .01 && py <= RECT.busLibrea[1] + 64 + .01, `celda de librea fuera de su fila: ${py.toFixed(1)}`);
    assert.ok(py + 3 * 64 <= ATLAS_HEIGHT + .01, 'la última ruta cabe en el atlas');
  }
  assert.ok(livery >= 16, `nombre de la empresa en los dos costados y ruteros en el panorámico (${livery} vértices)`);
  // Las franjas van pintadas en la chapa: el mapa de detalle es el de la ruta del tablero y hay uno por ruta.
  assert.equal(v.wetMaterials[0].map.name, `Detalle buseta:ruta${v.routeIndex}`);
  const maps = new Set();
  for (let unit = 0; unit < 40; unit++) {
    const bus = makeVehicle('buseta', unit * 37, { beams: false });
    const elMismoModelo = makeVehicle('carro', unit * 37, { model: 'buseta', beams: false, parked: true });
    assert.equal(bus.wetMaterials[0].map.name, `Detalle buseta:ruta${bus.routeIndex}`);
    assert.equal(elMismoModelo.wetMaterials[0].map, bus.wetMaterials[0].map, 'la librea corresponde al tablero aunque se elija el modelo directamente');
    elMismoModelo.dispose();
    maps.add(bus.wetMaterials[0].map); bus.dispose();
  }
  assert.equal(maps.size, 4, 'un mapa de detalle por ruta, compartido entre las busetas de esa ruta');
  assert.equal(libreaDe('carro', 12345), '');
  // Otra variante de la fábrica se suma a la librea sin taparla.
  assert.equal(libreaDe('carro', 12345, 'otra'), 'otra');
  assert.equal(libreaDe('taxi', 12345, 'otra'), 'taxi+otra');
  assert.ok(esTaxi('taxi+otra') && !esTaxi('otra') && !esTaxi(''));
  assert.equal(rutaDe(libreaDe('buseta', 3 << 3, 'otra')), 3);
  const sumada = makeVehicle('buseta', 12 * 37, { beams: false, variante: 'otra' });
  assert.equal(sumada.wetMaterials[0].map.name, `Detalle buseta:ruta${sumada.routeIndex}+otra`);
  sumada.dispose();
  for (let ruta = 0; ruta < 4; ruta++) {
    const carta = cartaDePrueba(getCarBody('buseta'), `ruta${ruta}`); CAR_MODELS.buseta.detail(carta.ctx, carta.carta);
    assert.ok(carta.rects.some(([, y, w, h]) => w > 10 && y <= 1.061 && y + h >= 1.339), `ruta ${ruta}: la franja da la vuelta completa y deja oscuro el tramo del nombre`);
  }
  assert.equal(new Set(BUS_LIBREAS.map(librea => JSON.stringify(librea.bandas))).size, 4, 'cada empresa pinta sus franjas a su manera');
  // El número interno es el de la placa del carro: va en el recuadro del voladizo trasero y en la cola.
  let numeros = 0;
  for (let i = 0; i < lamp.count; i++) if (lamp.getX(i) === LAMP.PLATE && position.getX(i) < -2.8 && position.getY(i) > 1.0) numeros++;
  assert.ok(numeros >= 12, `número interno en los dos costados y en la cola (${numeros} vértices)`);
  assert.ok(light >= 8, 'tiene luz interior en el canal del letrero, que solo enciende de noche');
  const colors = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(unit => { const bus = makeVehicle('buseta', unit * 37, { beams: false }), hex = bus.wetMaterials[0].color.getHexString(); bus.dispose(); return hex; }));
  assert.ok(colors.size >= 2, 'no todas las busetas salen del mismo color de fondo');
  v.dispose();
});

test('la buseta lleva placa de servicio público también fuera del tráfico: su número interno cae en su propia celda', () => {
  const celda = (kind, seed, model) => {
    const material = makeVehicle(kind, seed, { beams: false, model }).bodyVisual.children.find(mesh => mesh.name === 'Lámparas y placas').material;
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    material.onBeforeCompile(shader);
    const { x, y } = shader.uniforms.uPlateOffset.value;
    const punto = `${Math.round(x * ATLAS_SIZE)},${Math.round(-y * ATLAS_HEIGHT)}`;
    const publica = PUBLIC_PLATES.findIndex((_, i) => plateCell('publico', i).join() === punto);
    return publica < 0 ? PUBLIC_PLATES.length : publica;
  };
  for (const kind of ['carro', 'buseta']) for (const seed of [1, 5, 12, 40]) assert.ok(celda(kind, seed, 'buseta') < PUBLIC_PLATES.length, `${kind} ${seed}`);
  for (const seed of [1, 5, 12, 40]) assert.ok(celda('carro', seed, 'furgon') >= PUBLIC_PLATES.length, `furgón ${seed}`);
});
