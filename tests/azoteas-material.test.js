import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

/** Color de lienzo a [r, g, b, alfa]. */
function color(texto) {
  if (texto[0] === '#') {
    const h = texto.length === 4 ? [...texto.slice(1)].map(c => c + c).join('') : texto.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const n = texto.match(/[\d.]+/g).map(Number);
  return [n[0], n[1], n[2], n[3] ?? 1];
}

/** Lienzo que sí pinta: rectángulos lisos o con degradado, con escala y traslado. Lo demás lo deja pasar. */
function lienzo() {
  const c = { width: 0, height: 0, datos: null };
  let m = [1, 1, 0, 0];
  const pila = [];
  const degradado = (tipo, args) => ({ tipo, args, paradas: [], addColorStop(t, col) { this.paradas.push([t, color(col)]); } });
  const muestra = (g, ux, uy) => {
    let t;
    if (g.tipo === 'radial') { const [x0, y0, r0, , , r1] = g.args; t = (Math.hypot(ux - x0, uy - y0) - r0) / (r1 - r0); }
    else { const [x0, y0, x1, y1] = g.args, dx = x1 - x0, dy = y1 - y0; t = ((ux - x0) * dx + (uy - y0) * dy) / (dx * dx + dy * dy); }
    t = Math.max(0, Math.min(1, t));
    const p = g.paradas;
    let a = p[0], b = p[p.length - 1];
    for (let i = 0; i < p.length - 1; i++) if (t >= p[i][0] && t <= p[i + 1][0]) { a = p[i]; b = p[i + 1]; break; }
    const k = b[0] === a[0] ? 0 : Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
    return a[1].map((v, i) => v + (b[1][i] - v) * k);
  };
  const ctx = new Proxy({
    fillStyle: '#000', globalAlpha: 1,
    save() { pila.push([...m]); }, restore() { m = pila.pop() ?? m; },
    translate(x, y) { m[2] += m[0] * x; m[3] += m[1] * y; }, scale(x, y) { m[0] *= x; m[1] *= y; },
    fillRect(x, y, w, h) {
      if (!c.datos || c.datos.length !== c.width * c.height * 4) c.datos = new Float32Array(c.width * c.height * 4);
      let x0 = m[0] * x + m[2], x1 = m[0] * (x + w) + m[2], y0 = m[1] * y + m[3], y1 = m[1] * (y + h) + m[3];
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (y0 > y1) [y0, y1] = [y1, y0];
      const g = typeof this.fillStyle === 'string' ? null : this.fillStyle, liso = g ? null : color(this.fillStyle);
      for (let py = Math.max(0, Math.floor(y0)); py < Math.min(c.height, Math.ceil(y1)); py++) {
        const cy = Math.min(py + 1, y1) - Math.max(py, y0);
        for (let px = Math.max(0, Math.floor(x0)); px < Math.min(c.width, Math.ceil(x1)); px++) {
          const cx = Math.min(px + 1, x1) - Math.max(px, x0);
          const tinta = g ? muestra(g, (px + .5 - m[2]) / m[0], (py + .5 - m[3]) / m[1]) : liso;
          const a = tinta[3] * cx * cy * this.globalAlpha, i = (py * c.width + px) * 4;
          for (let k = 0; k < 3; k++) c.datos[i + k] += (tinta[k] - c.datos[i + k]) * a;
        }
      }
    },
    measureText: () => ({ width: 0 }),
    createRadialGradient: (...a) => degradado('radial', a), createLinearGradient: (...a) => degradado('lineal', a),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  }, { get: (o, clave) => clave in o ? o[clave] : () => {} });
  c.getContext = () => ctx;
  return c;
}

/** Valor (el mayor de los tres canales, de 0 a 1) y saturación medios de un rectángulo del lienzo. */
function tono(c, [x, y, w, h] = [0, 0, c.width, c.height]) {
  let valor = 0, saturacion = 0;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const i = (py * c.width + px) * 4, canales = [c.datos[i], c.datos[i + 1], c.datos[i + 2]];
    const alto = Math.max(...canales), bajo = Math.min(...canales);
    valor += alto / 255; saturacion += alto ? (alto - bajo) / alto : 0;
  }
  return { valor: valor / (w * h), saturacion: saturacion / (w * h) };
}

function contarAzar(hacer) {
  const real = Math.random;
  let gastado = 0;
  Math.random = () => { gastado++; return real(); };
  try { hacer(); } finally { Math.random = real; }
  return gastado;
}

const TX = await import('../src/world/bogota/textures.js');

// Lo primero, la ciudad entera como la arma el juego, antes de que este proceso guarde atlas o materiales ya hechos.
const { Bogota, CollisionSystem } = await import('./helpers/traffic-world.js');
const sorteosDeLaCiudad = (() => {
  globalThis.window = new EventTarget();
  const delJuego = Math.random;
  let s = 0x2F6B1C3D >>> 0, sorteos = 0;
  Math.random = () => {
    sorteos++; s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { new Bogota().build(new THREE.Scene(), new CollisionSystem()); } finally { Math.random = delJuego; }
  return sorteos;
})();

// Desde aquí hay lienzo, y el atlas se vuelve a pintar con él.
globalThis.document = { createElement: () => lienzo() };

test('el montaje de Bogotá con parques, cruces y locales conserva su presupuesto de sorteos', () => {
  // Las 88 identidades toman aspecto y arquetipo de su propia semilla de partida.
  assert.equal(sorteosDeLaCiudad, 384191);
});

test('la losa de azotea es gris media y sucia, no clara y limpia', () => {
  let losa;
  const gastado = contarAzar(() => { losa = TX.slab(13); });
  assert.equal(gastado, contarAzar(() => { for (let i = 0; i < 3; i++) new THREE.Texture().dispose(); }), 'pintarla gasta lo de sus tres texturas');
  for (const mapa of Object.values(losa)) assert.equal(mapa.image.width, 256);
  const { valor, saturacion } = tono(losa.map.image);
  assert.ok(valor >= .4 && valor <= .55, `valor medio ${valor.toFixed(3)}: ni clara como recién fundida ni negra`);
  assert.ok(saturacion <= .2, `saturación ${saturacion.toFixed(3)}: concreto apagado`);
  // Manchas de verdad: un paño no es parejo de lado a lado.
  const franjas = [0, 64, 128, 192].map(y => tono(losa.map.image, [0, y, 256, 64]).valor);
  assert.ok(Math.max(...franjas) - Math.min(...franjas) > .004, 'agua estancada y remiendos');
  for (const mapa of Object.values(losa)) mapa.dispose();
});

const { detailAtlas, DETAIL_UV } = await import('../src/world/bogota/textures-calle.js');
const { addBuildingDetails } = await import('../src/world/bogota/BuildingDetails.js');
const { BuildingVisibility, CLOSED_CHUNK_SIZE, createBuildingShell } = await import('../src/world/bogota/BuildingVisibility.js');
const { vestirRelleno } = await import('../src/world/bogota/texturasAzotea.js');
detailAtlas().texture.dispose();

/** Rectángulo de una celda del atlas en píxeles del lienzo, sin su texel de margen. */
function pixeles(nombre) {
  const { width, height } = detailAtlas().texture.image, [u0, v0, u1, v1] = DETAIL_UV[nombre];
  return [Math.round(u0 * width), Math.round((1 - v1) * height), Math.round((u1 - u0) * width), Math.round((v1 - v0) * height)];
}
/** Las caras (cuatro vértices seguidos) de una malla de lote, con el centro de sus UV. */
function caras(geometry) {
  const { position, normal, uv } = geometry.attributes, lista = [];
  for (let i = 0; i + 3 < position.count; i += 4) {
    const puntos = [0, 1, 2, 3].map(k => new THREE.Vector3().fromBufferAttribute(position, i + k));
    lista.push({ puntos, normal: new THREE.Vector3().fromBufferAttribute(normal, i),
      u: [0, 1, 2, 3].reduce((s, k) => s + uv.getX(i + k), 0) / 4, v: [0, 1, 2, 3].reduce((s, k) => s + uv.getY(i + k), 0) / 4 });
  }
  return lista;
}
const enCelda = (cara, [u0, v0, u1, v1]) => cara.u > u0 && cara.u < u1 && cara.v > v0 && cara.v < v1;

/** Casas de la cuadra con su azotea armada, de varios tamaños y semillas. */
function casas(cuantas = 60) {
  const lista = [];
  for (let i = 0; i < cuantas; i++) {
    const width = 6 + (i % 4) * 2, depth = 6 + (i % 3) * 2, height = 9 + (i % 2) * 3, material = new THREE.MeshStandardMaterial();
    const shell = createBuildingShell(new THREE.BoxGeometry(width, height, depth), Array(6).fill(material), { x: 10, z: 20, height, interiorMaterial: material });
    addBuildingDetails({ shell, width, depth, height, floors: 3, face: 4, seed: 318 + i * 7919, neighborhood: 'comercio', ruin: i % 13 === 5 });
    lista.push({ shell, width, depth, height, vida: shell.roof.children.find(o => o.name === 'Azotea con vida') });
  }
  return lista;
}

/** Bloques de relleno vestidos junto a una casa, como en la ciudad. */
function rellenos(cuantos = 36) {
  const visibilidad = new BuildingVisibility();
  const ladrillo = new THREE.MeshStandardMaterial(), losa = new THREE.MeshStandardMaterial(), vida = new THREE.MeshStandardMaterial();
  const casa = createBuildingShell(new THREE.BoxGeometry(6, 9, 6), [ladrillo, ladrillo, losa, losa, ladrillo, ladrillo], { x: 6, z: 6, height: 9, interiorMaterial: losa });
  const tanque = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), vida);
  tanque.name = 'Azotea con vida';
  casa.roof.add(tanque);
  visibilidad.register(casa);
  const TAMANOS = [[2, 2], [4, 2], [4, 6], [8, 8], [6, 4], [8, 2]], PASO = (CLOSED_CHUNK_SIZE - 24) / 6, lista = [];
  for (let i = 0; i < cuantos; i++) {
    const [ancho, fondo] = TAMANOS[i % TAMANOS.length], ruina = i % 9 === 0, alto = ruina ? 4.5 : 6.5;
    const shell = createBuildingShell(new THREE.BoxGeometry(ancho, alto, fondo), Array(6).fill(losa),
      { x: 18 + (i % 6) * PASO, z: 18 + Math.floor(i / 6) * PASO, height: alto, interiorMaterial: losa });
    vestirRelleno({ shell, visibilidad, x: 30 + i * 3, z: 40 + (i % 5), ancho, fondo, alto, ruina, ladrillo, uv: { brick: [2.88, 2.88], slab: [4, 4] } });
    lista.push({ shell, ancho, fondo, alto, techo: shell.roof.children[0], conAtlas: shell.roof.children[0].material.userData.staticBatchKey.startsWith(vida.uuid) });
  }
  return lista;
}

test('las bases, los dados y el cuarto de escalera son de concreto viejo, no de la celda casi blanca', () => {
  let piezas = 0;
  for (const { vida } of casas()) if (vida) for (const cara of caras(vida.geometry)) {
    assert.ok(!enCelda(cara, DETAIL_UV.concrete), 'ninguna pieza de la azotea de una casa en la celda blanca');
    piezas += enCelda(cara, DETAIL_UV.canvas);
  }
  assert.ok(piezas > 200, `las casas llevan concreto viejo arriba (${piezas} caras)`);
  for (const { techo, conAtlas } of rellenos()) if (conAtlas) for (const cara of caras(techo.geometry)) {
    assert.ok(!enCelda(cara, DETAIL_UV.concrete), 'ni en los techos de relleno');
  }
  const lienzoAtlas = detailAtlas().texture.image, [x, y, w, h] = pixeles('canvas');
  const celda = tono(lienzoAtlas, [x, y, w, h]), losa = TX.slab(13), suelo = tono(losa.map.image).valor;
  assert.ok(celda.valor >= .42 && celda.valor <= .58, `valor ${celda.valor.toFixed(3)}: gris medio`);
  assert.ok(celda.valor / suelo <= 1.2, `la base no brilla sobre la losa (${(celda.valor / suelo).toFixed(2)} veces su valor)`);
  assert.ok(celda.saturacion <= .2, 'apagado');
  const pie = tono(lienzoAtlas, [x, y + h - 8, w, 8]).valor, medio = tono(lienzoAtlas, [x, y + h / 2 - 8, w, 16]).valor;
  assert.ok(pie < medio - .04, 'abajo lleva la sombra de contacto');
  for (const mapa of Object.values(losa)) mapa.dispose();
});

test('los tanques son redondos, de dieciséis caras, negros mates y con polvo arriba', () => {
  const tanques = (geometry) => {
    const cuerpo = caras(geometry).filter(cara => enCelda(cara, DETAIL_UV.tank) && cara.puntos[2].y - cara.puntos[0].y > .5);
    for (const cara of cuerpo) {
      assert.ok(cara.puntos[1].distanceTo(cara.puntos[0]) < .22, 'cada cara mide menos de un palmo: ya no se cuentan desde la calle');
    }
    return cuerpo.length / 16;
  };
  let enCasas = 0, enRellenos = 0;
  for (const { vida } of casas()) if (vida) {
    const n = tanques(vida.geometry);
    assert.ok(Number.isInteger(n), 'dieciséis caras por tanque');
    enCasas += n;
    // La luz no marca las caras: en el cuerpo, cada esquina lleva su propia normal.
    const { normal, uv } = vida.geometry.attributes, [u0, v0, u1, v1] = DETAIL_UV.tank;
    for (let i = 0; i + 3 < normal.count; i += 4) {
      const u = (uv.getX(i) + uv.getX(i + 1)) / 2, v = (uv.getY(i) + uv.getY(i + 3)) / 2;
      if (u > u0 && u < u1 && v > v0 && v < v1) assert.ok(Math.abs(normal.getX(i) - normal.getX(i + 1)) + Math.abs(normal.getZ(i) - normal.getZ(i + 1)) > .1);
    }
  }
  for (const { techo, conAtlas } of rellenos()) if (conAtlas) {
    const n = tanques(techo.geometry);
    assert.ok(Number.isInteger(n));
    enRellenos += n;
  }
  assert.ok(enCasas >= 20 && enRellenos >= 5, `hay tanques en las casas (${enCasas}) y en el relleno (${enRellenos})`);
  const lienzoAtlas = detailAtlas().texture.image, [x, y, w, h] = pixeles('tank');
  const celda = tono(lienzoAtlas, [x, y, w, h]);
  assert.ok(celda.valor <= .24 && celda.saturacion <= .2, `negro mate (${celda.valor.toFixed(3)})`);
  const filas = Array.from({ length: h }, (_, i) => tono(lienzoAtlas, [x, y + i, w, 1]).valor);
  const cuerpo = filas.slice(Math.round(h * .36), Math.round(h * .84));
  const mediana = [...cuerpo].sort((a, b) => a - b)[cuerpo.length >> 1];
  assert.ok(Math.max(...cuerpo) - mediana < .03, 'ningún anillo claro: las costillas apenas se marcan');
  assert.ok(tono(lienzoAtlas, [x, y, w, Math.round(h * .16)]).valor > mediana + .08, 'la franja de la tapa lleva el polvo que aclara el sol');
});

test('el pretil de las casas lleva pañete sucio por dentro, en sus cuatro caras y dentro de la malla de vida', () => {
  let conPanete = 0;
  for (const { shell, width, depth, height, vida } of casas()) {
    assert.ok(shell.roof.children.filter(o => o.name === 'Azotea con vida').length <= 1, 'sin vida no nace una malla solo para el pañete');
    if (!vida) continue;
    const a = width / 2 - .155, c = depth / 2 - .155, largo = [0, 0, 0, 0];
    for (const cara of caras(vida.geometry)) {
      const [p0, p1, p2] = cara.puntos, n = cara.normal;
      if (Math.abs(n.y) > 1e-6 || !enCelda(cara, DETAIL_UV.canvas) || Math.abs(p2.y - (height - .01)) > 1e-4 || Math.abs(p0.y - (height - .8)) > 1e-4) continue;
      const enX = Math.abs(Math.abs(p0.x) - a) < 1e-4 && Math.abs(p0.x - p1.x) < 1e-6, enZ = Math.abs(Math.abs(p0.z) - c) < 1e-4 && Math.abs(p0.z - p1.z) < 1e-6;
      if (!enX && !enZ) continue;
      // Cada cara mira hacia dentro de la azotea.
      assert.ok(enX ? n.x * p0.x < 0 : n.z * p0.z < 0, 'el pañete mira al centro');
      const medida = p0.distanceTo(p1);
      assert.ok(medida <= 3.4, 'por paños: las manchas no se estiran');
      largo[enX ? (p0.x > 0 ? 0 : 1) : (p0.z > 0 ? 2 : 3)] += medida;
    }
    for (const [i, medida] of largo.entries()) assert.ok(Math.abs(medida - 2 * (i < 2 ? c : a)) < 1e-3, `cara ${i} cubierta de punta a punta`);
    conPanete++;
  }
  assert.ok(conPanete >= 40, `casi todas las casas tienen algo arriba (${conPanete} de 60)`);
});

test('la celda de la lata cabe en el atlas sin pisar a nadie y es zinc apagado con óxido', () => {
  const [u0, v0, u1, v1] = DETAIL_UV.lata;
  assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1, 'dentro del atlas');
  for (const [nombre, [a0, b0, a1, b1]] of Object.entries(DETAIL_UV)) {
    if (nombre !== 'lata') assert.ok(a1 <= u0 || a0 >= u1 || b1 <= v0 || b0 >= v1, `no pisa la celda ${nombre}`);
  }
  assert.ok((u1 - u0) * 2 > (v1 - v0) * 4, 'larga como una lata');
  const lienzoAtlas = detailAtlas().texture.image, [x, y, w, h] = pixeles('lata'), celda = tono(lienzoAtlas, [x, y, w, h]);
  assert.ok(celda.valor >= .35 && celda.valor <= .55, `galvanizado apagado, no brillante (${celda.valor.toFixed(3)})`);
  assert.ok(celda.saturacion <= .2, `sin color vivo (${celda.saturacion.toFixed(3)})`);
  let maxima = 0;
  for (let i = 0; i < w; i += 8) maxima = Math.max(maxima, tono(lienzoAtlas, [x + i, y, 8, h]).saturacion);
  assert.ok(maxima <= .35, `ni el óxido pasa de 35 % de saturación (${maxima.toFixed(3)})`);
  const oxido = tono(lienzoAtlas, [x, y, 24, h]).saturacion, limpio = tono(lienzoAtlas, [x + w - 60, y, 40, h]).saturacion;
  assert.ok(oxido > limpio + .08, 'el óxido nace en un extremo, el del traslapo');
});

test('las latas del relleno caen hacia un mismo borde, se montan en el traslapo y ya no usan la celda de las persianas', () => {
  let techos = 0, hojas = 0, piedras = 0, cubierto = 0, huella = 0;
  for (const { techo, conAtlas, ancho, fondo, alto } of rellenos(72)) {
    if (!conAtlas) continue;
    const todas = caras(techo.geometry);
    for (const cara of todas) assert.ok(!enCelda(cara, DETAIL_UV.trans), 'ninguna pieza del techo en la celda de transformadores y persianas');
    // Las latas: caras casi acostadas e inclinadas, por encima de la tapa.
    const latas = todas.filter(cara => cara.normal.y > .9 && cara.puntos.some(p => Math.abs(p.y - cara.puntos[0].y) > .004)
      && cara.puntos.every(p => p.y > alto + .03 && p.y < alto + .3) && cara.puntos[0].distanceTo(cara.puntos[2]) > .7);
    piedras += todas.filter(cara => enCelda(cara, DETAIL_UV.canvas) && cara.normal.y > .3 && cara.normal.y < .5).length;
    // Solo los techos de latas llevan debajo una tapa entera a ras de la azotea.
    if (!todas.some(cara => cara.puntos.every(p => Math.abs(p.y - alto) < 1e-6) && cara.puntos[0].distanceTo(cara.puntos[2]) > Math.hypot(ancho, fondo) - 1e-3)) continue;
    techos++; hojas += latas.length;
    for (const cara of latas) assert.ok(enCelda(cara, DETAIL_UV.lata) || enCelda(cara, DETAIL_UV.canvas), 'zinc de onda, también el oxidado, o placa lisa');
    // Todas bajan hacia el mismo lado: la normal de cada una se inclina igual.
    const lado = latas.map(cara => Math.sign(Math.abs(cara.normal.x) > Math.abs(cara.normal.z) ? cara.normal.x : cara.normal.z));
    assert.ok(lado.every(s => s === lado[0]), 'ninguna lata cae al revés que sus vecinas');
    cubierto += latas.reduce((suma, { puntos: [a, b, c] }) => suma + a.distanceTo(b) * b.distanceTo(c), 0);
    huella += ancho * fondo;
    const caida = Math.max(...latas.flatMap(cara => cara.puntos.map(p => p.y))) - Math.min(...latas.flatMap(cara => cara.puntos.map(p => p.y)));
    assert.ok(caida >= .08 && caida <= .22, `el techo cae entre 8 y 14 cm, más lo que monta cada lata (${caida.toFixed(3)})`);
  }
  assert.ok(techos >= 12 && hojas >= 80, `hay techos de latas (${techos}) con sus latas (${hojas})`);
  assert.ok(cubierto > huella * 1.03, `las latas se montan unas sobre otras (${(cubierto / huella).toFixed(3)} veces la huella)`);
  assert.ok(piedras >= 20, `las piedras tienen caras inclinadas, no son cubos (${piedras})`);
});

test('el canto del antepecho de ladrillo es una junta de mortero, no una hilada naranja acostada', () => {
  let cantos = 0;
  for (const { shell, alto } of rellenos()) for (const pared of shell.walls.values()) {
    const geometry = pared.children[0].geometry, uv = geometry.attributes.uv, normal = geometry.attributes.normal, position = geometry.attributes.position;
    for (let i = 0; i + 3 < position.count; i += 4) {
      if (normal.getY(i) < .9 || position.getY(i) < alto + .1) continue;
      for (let k = 0; k < 4; k++) {
        // Las hiladas de la textura miden un veinticuatroavo: la junta cae justo entre dos.
        assert.ok(Math.abs(uv.getY(i + k) * 24 - Math.round(uv.getY(i + k) * 24)) < 1e-6, 'sobre una junta');
        assert.equal(uv.getY(i + k), uv.getY(i), 'sin tomar ladrillo de ninguna de las dos hiladas');
      }
      cantos++;
    }
  }
  assert.ok(cantos >= 60, `los antepechos tienen canto (${cantos})`);
});
