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

/** Lienzo que solo anota los rectángulos que se pintan, en metros de la carta lateral (1 px = 1 cm, sin voltear). */
function cartaDePrueba(body, variante) {
  const rects = [];
  const ctx = new Proxy({}, { get: (target, key) => key === 'fillRect' ? (x, y, w, h) => rects.push([x / 100, -(y + h) / 100, w / 100, h / 100]) : key in target ? target[key] : () => ({ addColorStop() {} }), set: (target, key, value) => { target[key] = value; return true; } });
  return { ctx, rects, carta: { sx: x => x * 100, sy: y => -y * 100, tx: x => x * 100, ty: z => z * 100, pxX: 100, pxY: 100, W: 1024, H: 512, body, variante, seam() {}, stroke() {} } };
}

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
