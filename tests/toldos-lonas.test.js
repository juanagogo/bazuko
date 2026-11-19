import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as texturas from '../src/world/bogota/textures.js';

// El azar sembrado de cada hoja, contado por semilla: las lonas no pueden correr lo que se pinta después de ellas.
const sorteos = new Map();
mock.module('../src/world/bogota/textures.js', { namedExports: { ...texturas, rng: semilla => {
  const real = texturas.rng(semilla);
  return () => { sorteos.set(semilla, (sorteos.get(semilla) ?? 0) + 1); return real(); };
} } });

/** Color de lienzo a [r, g, b, alfa]. */
function color(texto) {
  if (texto[0] === '#') {
    const h = texto.length === 4 ? [...texto.slice(1)].map(c => c + c).join('') : texto.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const n = texto.match(/[\d.]+/g).map(Number);
  return [n[0], n[1], n[2], n[3] ?? 1];
}

/**
 * Lienzo que sí pinta rectángulos, lisos o con degradado, con escala y traslado; lo demás lo deja pasar. De cada
 * rectángulo anota dónde empieza y cuántos sorteos llevaba la semilla vigilada al pintarlo.
 */
function lienzo(semilla) {
  const c = { width: 0, height: 0, datos: null, pintado: [] };
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
      c.pintado.push([x0, y0, sorteos.get(semilla) ?? 0]);
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
function tono(c, [x, y, w, h]) {
  let valor = 0, saturacion = 0, n = 0;
  for (let py = Math.round(y); py < Math.round(y + h); py++) for (let px = Math.round(x); px < Math.round(x + w); px++) {
    const i = (py * c.width + px) * 4, canales = [c.datos[i], c.datos[i + 1], c.datos[i + 2]];
    const alto = Math.max(...canales), bajo = Math.min(...canales);
    valor += alto / 255; saturacion += alto ? (alto - bajo) / alto : 0; n++;
  }
  return { valor: valor / n, saturacion: saturacion / n };
}
const dentro = ([px, py], [x, y, w, h]) => px >= x && px < x + w && py >= y && py < y + h;
/** Sorteos de la semilla vigilada justo antes de lo primero que se pinta en un rectángulo. */
function sorteosAntesDe(c, rect) {
  const i = c.pintado.findIndex(p => dentro(p, rect));
  assert.ok(i > 0, 'la celda se pinta, y no es lo primero de la hoja');
  return c.pintado[i - 1][2];
}

globalThis.document = { createElement: () => lienzo(9391) };
const { detailAtlas, DETAIL_UV } = await import('../src/world/bogota/textures-calle.js');
const atlas = detailAtlas().texture.image;
/** Celda entera del atlas de la calle en píxeles del lienzo. */
function celda(nombre) {
  const [u0, v0, u1, v1] = DETAIL_UV[nombre], W = atlas.width, H = atlas.height;
  return [Math.round(u0 * W) - 2, Math.round((1 - v1) * H) - 2, Math.round((u1 - u0) * W) + 4, Math.round((v1 - v0) * H) + 4];
}
const RAYAS = 16;
/** Las rayas de color (impares) y las crema (pares) de una lona de fachada, sin el píxel de cada orilla. */
function rayas(nombre, desde = 0, hasta = 1) {
  const [x, y, w, h] = celda(nombre), paso = w / RAYAS;
  return Array.from({ length: RAYAS }, (_, i) => tono(atlas, [x + i * paso + 1, y + h * desde, paso - 2, h * (hasta - desde)]));
}
const media = lista => lista.reduce((s, v) => s + v, 0) / lista.length;

test('las lonas de fachada gastan el azar de la hoja lo mismo que antes: lo que se pinta después no se corre', () => {
  const antes = sorteosAntesDe(atlas, celda('awning'));
  assert.equal(sorteosAntesDe(atlas, celda('awning2')) - antes, 480, 'la roja sortea sus 120 motas de siempre');
  assert.equal(sorteosAntesDe(atlas, celda('meter')) - antes, 960, 'y la azul las suyas');
});

test('las lonas de fachada llevan dieciséis rayas angostas, no ocho bloques', () => {
  // Cuánto tira cada raya al rojo (positivo) o al azul (negativo): la crema queda en medio.
  const tinte = (nombre, i) => {
    const [x, y, w, h] = celda(nombre), paso = w / RAYAS;
    let rojo = 0, azul = 0;
    for (let py = Math.round(y + h * .2); py < Math.round(y + h * .7); py++) for (let px = Math.round(x + i * paso + 1); px < Math.round(x + (i + 1) * paso - 1); px++) {
      const k = (py * atlas.width + px) * 4; rojo += atlas.datos[k]; azul += atlas.datos[k + 2];
    }
    return (rojo - azul) / Math.max(rojo, azul);
  };
  for (let i = 1; i < RAYAS; i += 2) {
    assert.ok(tinte('awning', i) > tinte('awning', i - 1) + .1, `awning: la raya ${i} es roja y la de antes, clara`);
    assert.ok(tinte('awning2', i) < tinte('awning2', i - 1) - .1, `awning2: la raya ${i} es azul y la de antes, clara`);
  }
});

test('las lonas de fachada son tela vieja: color apagado, más comido por el sol arriba que abajo', () => {
  // Las rayas limpias de antes tenían saturación 0,77 la roja y 0,70 la azul.
  for (const [nombre, tope, piso] of [['awning', .5, .28], ['awning2', .4, .2]]) {
    const color = media(rayas(nombre).filter((_, i) => i & 1).map(t => t.saturacion));
    assert.ok(color <= tope && color >= piso, `${nombre}: saturación ${color.toFixed(3)} en las rayas de color, apagada sin llegar a gris`);
    const arriba = media(rayas(nombre, .12, .4).filter((_, i) => i & 1).map(t => t.saturacion));
    const abajo = media(rayas(nombre, .5, .8).filter((_, i) => i & 1).map(t => t.saturacion));
    assert.ok(arriba < abajo - .015, `${nombre}: el sol destiñe más arriba (${arriba.toFixed(3)}) que abajo (${abajo.toFixed(3)})`);
    const crema = media(rayas(nombre).filter((_, i) => !(i & 1)).map(t => t.valor));
    assert.ok(crema <= .84, `${nombre}: la raya clara ya no es blanca (${crema.toFixed(3)})`);
  }
});

test('las lonas de fachada llevan manchas, dobladillo y borde: ninguna raya igual a la vecina ni una lona a la otra', () => {
  for (const nombre of ['awning', 'awning2']) {
    const [x, y, w, h] = celda(nombre);
    const color = rayas(nombre, .15, .8).filter((_, i) => i & 1).map(t => t.valor), crema = rayas(nombre, .15, .8).filter((_, i) => !(i & 1)).map(t => t.valor);
    assert.ok(Math.max(...color) - Math.min(...color) > .015, `${nombre}: las rayas de color no son parejas`);
    assert.ok(Math.max(...crema) - Math.min(...crema) > .015, `${nombre}: las claras tampoco`);
    // De arriba abajo dentro de una misma raya también cambia: manchas y escurridos, no una tinta plana.
    const tramos = [0, 1, 2, 3, 4, 5].map(k => tono(atlas, [x, y + h * (.15 + k * .1), w / 4, h * .1]).valor);
    assert.ok(Math.max(...tramos) - Math.min(...tramos) > .008, `${nombre}: una raya cambia de arriba abajo`);
    const medio = tono(atlas, [x, y + h * .45, w, h * .25]).valor, dobladillo = tono(atlas, [x, y + h * .88, w, h * .1]).valor;
    assert.ok(dobladillo < medio - .04, `${nombre}: el dobladillo va en sombra (${dobladillo.toFixed(3)} contra ${medio.toFixed(3)})`);
    assert.ok(dobladillo > medio - .25, `${nombre}: sin llegar a ser una cinta oscura`);
    const arranque = tono(atlas, [x, y, w, h * .05]).valor, cuerpo = tono(atlas, [x, y + h * .15, w, h * .2]).valor;
    assert.ok(arranque < cuerpo - .02, `${nombre}: lo que baja de la pared ensucia el arranque (${arranque.toFixed(3)} contra ${cuerpo.toFixed(3)})`);
  }
  // Cada lona tiene su desgaste: las rayas claras, que son del mismo color en las dos, no se manchan en el mismo sitio.
  const [xa, ya, w, h] = celda('awning'), [xb, yb] = celda('awning2');
  const diferencias = [];
  for (let i = 0; i < RAYAS; i += 2) for (let k = 0; k < 8; k++) {
    const tramo = (x0, y0) => tono(atlas, [x0 + i * w / RAYAS + 1, y0 + h * (.1 + k * .09), w / RAYAS - 2, h * .09]).valor;
    diferencias.push(tramo(xa, ya) - tramo(xb, yb));
  }
  const holgura = Math.max(...diferencias) - Math.min(...diferencias);
  assert.ok(holgura > .03, `las dos lonas no comparten manchas (${holgura.toFixed(4)})`);
});

// La hoja de las zonas del oriente: rayas y lonas del mercado, de los locales y de los conos del borde.
globalThis.document = { createElement: () => lienzo(1571) };
const { detailSheet, DETAIL_CELLS } = await import('../src/world/bogota/ZoneTextures.js');
const hoja = detailSheet().map.image;
const celdaZona = nombre => { const { col, row } = DETAIL_CELLS[nombre]; return [col * 128, row * 128, 128, 128]; };
/** Parte de una celda de la hoja de zonas, en fracciones de su ancho y su alto. */
const parte = (nombre, fx, fy, fw, fh) => { const [x, y, w, h] = celdaZona(nombre); return tono(hoja, [x + w * fx, y + h * fy, w * fw, h * fh]); };
// Saturación media de cada celda cuando las lonas eran limpias, medida con este mismo lienzo.
const LIMPIAS = { redStripe: .402, blueStripe: .377, greenTarp: .41, orangeTarp: .741, blueTarp: .702 };

test('las rayas y las lonas del oriente gastan el azar de su hoja lo mismo que antes', () => {
  // Dos rayas con 70 motas y tres lonas con 160, a cinco sorteos la mota.
  assert.equal(sorteosAntesDe(hoja, celdaZona('burlap')) - sorteosAntesDe(hoja, celdaZona('redStripe')), 2 * 70 * 5 + 3 * 160 * 5);
});

test('las rayas y las lonas del oriente pierden cerca de un tercio del color, sin quedar grises', () => {
  for (const [nombre, limpia] of Object.entries(LIMPIAS)) {
    const { saturacion } = tono(hoja, celdaZona(nombre)), baja = 1 - saturacion / limpia;
    assert.ok(baja >= .22 && baja <= .48, `${nombre}: saturación ${saturacion.toFixed(3)}, ${(baja * 100).toFixed(0)} % menos que limpia`);
  }
  // El naranja sigue siendo naranja: también viste los conos del cierre de obra.
  const [x, y, w, h] = celdaZona('orangeTarp');
  let rojo = 0, verde = 0, azul = 0;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) { const i = (py * hoja.width + px) * 4; rojo += hoja.datos[i]; verde += hoja.datos[i + 1]; azul += hoja.datos[i + 2]; }
  assert.ok(rojo > verde * 1.4 && verde > azul * 1.35, `naranja: rojo ${(rojo / w / h).toFixed(0)}, verde ${(verde / w / h).toFixed(0)}, azul ${(azul / w / h).toFixed(0)}`);
});

test('las rayas y las lonas del oriente llevan sol arriba, manchas, dobladillo y un desgaste distinto cada una', () => {
  const nombres = Object.keys(LIMPIAS), cuadricula = nombre => {
    const valores = [];
    for (let i = 0; i < 6; i++) for (let k = 0; k < 5; k++) valores.push(parte(nombre, i / 6, .08 + k * .15, 1 / 6, .15).valor);
    const centro = media(valores);
    return valores.map(v => v - centro);
  };
  for (const nombre of nombres) {
    const arriba = parte(nombre, 0, .05, 1, .3).saturacion, abajo = parte(nombre, 0, .5, 1, .3).saturacion;
    assert.ok(arriba < abajo - .01, `${nombre}: el sol destiñe más arriba (${arriba.toFixed(3)}) que abajo (${abajo.toFixed(3)})`);
    const medio = parte(nombre, 0, .45, 1, .25).valor, dobladillo = parte(nombre, 0, .9, 1, .08).valor;
    assert.ok(dobladillo < medio - .03 && dobladillo > medio - .25, `${nombre}: dobladillo en sombra (${dobladillo.toFixed(3)} contra ${medio.toFixed(3)})`);
  }
  // Las tres lonas lisas no son una lámina pareja ni comparten manchas.
  const lisas = ['greenTarp', 'orangeTarp', 'blueTarp'].map(cuadricula);
  for (const lona of lisas) assert.ok(Math.max(...lona) - Math.min(...lona) > .05, 'una lona lisa tiene manchas y parches');
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const lejos = Math.max(...lisas[a].map((v, i) => Math.abs(v - lisas[b][i])));
    assert.ok(lejos > .04, `dos lonas no llevan el mismo desgaste (${lejos.toFixed(3)})`);
  }
  const rojas = cuadricula('redStripe'), azules = cuadricula('blueStripe');
  assert.ok(Math.max(...rojas.map((v, i) => Math.abs(v - azules[i]))) > .04, 'ni las dos de rayas');
});

// Desde aquí no hace falta lienzo: el atlas ya está pintado y guardado.
delete globalThis.document;
const THREE = await import('three');
const { addBuildingDetails } = await import('../src/world/bogota/BuildingDetails.js');
const { createBuildingShell } = await import('../src/world/bogota/BuildingVisibility.js');
const { localDelSolar } = await import('../src/world/bogota/Locales.js');

test('el faldón del tejadillo de lona cuelga 12 cm, un poco abierto, y lleva la franja del dobladillo en una sola cara', () => {
  const lonas = ['awning', 'awning2', 'toldoLona', 'toldoVerde'].map(nombre => DETAIL_UV[nombre]);
  let vistos = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const width = 4 + (seed % 3) * 2, height = 9, depth = 6, material = new THREE.MeshStandardMaterial();
    const local = { ...localDelSolar({ seed: seed * 7919, paso: seed, x: 110, z: 150 }), conAviso: seed % 2 === 0 };
    const shell = createBuildingShell(new THREE.BoxGeometry(width, height, depth), Array(6).fill(material), { x: 10, z: 20, height, interiorMaterial: material });
    addBuildingDetails({ shell, width, depth, height, floors: 3, face: 4, seed: seed * 7919, neighborhood: 'comercio', local });
    const caras = [];
    shell.root.traverse(malla => {
      if (!malla.isMesh || !malla.userData.streetLife) return;
      const { position, uv } = malla.geometry.attributes;
      for (let i = 0; i + 3 < position.count; i += 4) {
        const puntos = [0, 1, 2, 3].map(k => ({ y: position.getY(i + k), vuelo: position.getZ(i + k) - depth / 2, u: uv.getX(i + k), v: uv.getY(i + k) }));
        const u = media(puntos.map(p => p.u)), v = media(puntos.map(p => p.v));
        const celda = lonas.find(([u0, v0, u1, v1]) => u > u0 && u < u1 && v > v0 && v < v1);
        if (celda && Math.min(...puntos.map(p => p.y)) >= 1.9) caras.push({ puntos, celda });
      }
    });
    // El toldo grande de la tienda vuela 85 cm o más: aquí solo se mira la lona corta.
    if (!caras.length || Math.max(...caras.flatMap(c => c.puntos.map(p => p.vuelo))) >= .84) continue;
    vistos++;
    assert.equal(caras.length, 3, 'dos caídas y el faldón: las mismas tres caras de antes');
    const bajo = cara => Math.min(...cara.puntos.map(p => p.y)), faldon = caras.reduce((a, b) => bajo(a) < bajo(b) ? a : b);
    const ys = faldon.puntos.map(p => p.y), vs = faldon.puntos.map(p => p.v), [, v0, , v1] = faldon.celda;
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - .12) < 1e-5, `cuelga ${(Math.max(...ys) - Math.min(...ys)).toFixed(3)} m`);
    assert.ok(Math.min(...ys) >= 2.6 - 1e-6, `no baja de 2,6 m (${Math.min(...ys).toFixed(2)})`);
    assert.ok(Math.abs(Math.min(...vs) - v0) < 1e-6 && Math.abs(Math.max(...vs) - (v0 + (v1 - v0) * .3)) < 1e-6, 'solo la franja de abajo de la celda: la lona entera no se aplasta en el faldón');
    const arriba = faldon.puntos.filter(p => p.y > Math.min(...ys) + .06), abajo = faldon.puntos.filter(p => p.y <= Math.min(...ys) + .06);
    const abre = media(abajo.map(p => p.vuelo)) - media(arriba.map(p => p.vuelo));
    assert.ok(abre > .005 && abre < .03, `el borde de abajo se abre ${abre.toFixed(3)} m`);
    assert.ok(Math.max(...faldon.puntos.map(p => p.vuelo)) <= .5, 'y sigue volando menos de medio metro');
  }
  assert.ok(vistos >= 10, `${vistos} lonas cortas revisadas`);
});
