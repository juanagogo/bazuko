import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { LAKE_PARK } from '../src/world/bogota/LakePark.js';
import { ZONA_NOMBRES, ZonaAviso, zonaDe } from '../src/ui/ZonaAviso.js';

function fakeDoc() {
  const body = { children: [], append(node) { this.children.push(node); } };
  const radar = { children: [], append(node) { this.children.push(node); } };
  return {
    body, radar,
    createElement(tag) {
      const clases = new Set();
      const classList = { toggle: (c, si) => (si ? clases.add(c) : clases.delete(c)), contains: (c) => clases.has(c) };
      return { tag, className: '', textContent: '', hidden: false, classList };
    },
    getElementById: (id) => (id === 'minimap-container' ? radar : null)
  };
}

test('la zona sale de _zoneAt y todo el parque del sur es lago', () => {
  const district = { _zoneAt: () => 'barrio' };
  for (const x of [19, 75, 131, 180]) assert.equal(zonaDe(district, x, LAKE_PARK.z0 + 30), 'lago', `x ${x}`);
  assert.equal(zonaDe(district, 240, LAKE_PARK.z0 + 30), 'barrio', 'al oriente manda Chapinero');
  assert.equal(zonaDe(district, 10, 10), 'barrio');
  assert.equal(zonaDe(null, 10, 10), 'andenes');
  for (const zona of ['cartucho', 'parque', 'candelaria', 'chapinero', 'andenes', 'barrio', 'lago']) {
    assert.ok(ZONA_NOMBRES[zona], zona);
  }
});

test('el cartel sale al entrar a una zona y se va solo', () => {
  const doc = fakeDoc();
  const aviso = new ZonaAviso({ doc });
  assert.equal(aviso.cartelEl.hidden, true);
  const district = { _zoneAt: (x) => (x > 50 ? 'cartucho' : 'andenes') };
  aviso.update(1 / 60, district, 10, 10);
  assert.equal(aviso.cartelEl.hidden, false);
  assert.equal(aviso.cartelEl.textContent, 'El centro');
  aviso.update(1, district, 10, 10);
  assert.equal(aviso.cartelEl.hidden, false, 'sigue mientras dura');
  aviso.update(3, district, 10, 10);
  assert.equal(aviso.cartelEl.hidden, true);
  aviso.update(1 / 60, district, 60, 10);
  assert.equal(aviso.cartelEl.hidden, false);
  assert.equal(aviso.cartelEl.textContent, 'El Cartucho');
  aviso.update(1, district, 60, 10);
  assert.equal(aviso.cartelEl.textContent, 'El Cartucho', 'no se repite en la misma zona');
});

test('bajo el radar se escribe la vía actual, sin reescribirla cada cuadro', () => {
  const doc = fakeDoc();
  const aviso = new ZonaAviso({ doc });
  const district = { _zoneAt: () => 'andenes' };
  aviso.update(1 / 60, district, 20, 40);
  assert.equal(aviso.calleEl.textContent, 'la Carrera 15');
  assert.equal(doc.radar.children[0], aviso.calleEl);
  aviso.update(.1, district, 112, 97);
  assert.equal(aviso.calleEl.textContent, 'la Carrera 15', 'dentro del intervalo no cambia');
  aviso.update(.4, district, 112, 97);
  assert.equal(aviso.calleEl.textContent, 'la Carrera 10');
});

test('los nombres de más de 14 caracteres llevan la letra chica y los cortos la de siempre', () => {
  const aviso = new ZonaAviso({ doc: fakeDoc() });
  let zona = 'metro';
  const district = { _zoneAt: () => zona };
  const largos = [];
  for (const z of Object.keys(ZONA_NOMBRES)) {
    zona = z;
    aviso.update(1 / 60, district, 10, 10);
    assert.equal(aviso.cartelEl.textContent, ZONA_NOMBRES[z]);
    const largo = aviso.cartelEl.classList.contains('zona-cartel--largo');
    assert.equal(largo, ZONA_NOMBRES[z].length > 14, `${ZONA_NOMBRES[z]} (${ZONA_NOMBRES[z].length} caracteres, con espacios)`);
    if (largo) largos.push(z);
  }
  for (const z of ['metro', 'parque', 'lago']) assert.ok(largos.includes(z), `${z} va con la letra chica`);
  zona = 'metro';
  aviso.update(1 / 60, district, 10, 10);
  zona = 'andenes';
  aviso.update(1 / 60, district, 10, 10);
  assert.equal(aviso.cartelEl.classList.contains('zona-cartel--largo'), false, 'tras un nombre largo, el corto vuelve a la letra de siempre');
});

// Resuelve las medidas de las hojas y, si se conocen, sus propiedades personalizadas.
function medida(expr, vw, propiedad) {
  const fichas = expr.match(/--[\w-]+|\d*\.?\d+(?:px|vw)?|[a-z]+|[()+\-*/,]/g);
  let i = 0;
  const ver = () => fichas[i], tomar = () => fichas[i++];
  const suma = () => {
    let v = producto();
    while (ver() === '+' || ver() === '-') v = tomar() === '+' ? v + producto() : v - producto();
    return v;
  };
  const producto = () => {
    let v = factor();
    while (ver() === '*' || ver() === '/') v = tomar() === '*' ? v * factor() : v / factor();
    return v;
  };
  const argumentos = () => {
    const lista = [suma()];
    while (ver() === ',') { tomar(); lista.push(suma()); }
    assert.equal(tomar(), ')');
    return lista;
  };
  const factor = () => {
    const f = tomar();
    if (f === '(') { const v = suma(); assert.equal(tomar(), ')'); return v; }
    if (/^\d|^\./.test(f)) return parseFloat(f) * (f.endsWith('vw') ? vw / 100 : 1);
    assert.equal(tomar(), '(', `después de ${f}`);
    if (f === 'var') {
      const nombre = tomar();
      let respaldo = 0;
      if (ver() === ',') { tomar(); respaldo = argumentos()[0]; }
      else assert.equal(tomar(), ')');
      const valor = propiedad?.(nombre);
      return valor === undefined ? respaldo : medida(valor, vw, propiedad);
    }
    const a = argumentos();
    if (f === 'calc') return a[0];
    if (f === 'min') return Math.min(...a);
    if (f === 'max') return Math.max(...a);
    if (f === 'clamp') return Math.max(a[0], Math.min(a[1], a[2]));
    throw new Error(`no sé calcular ${f}`);
  };
  return suma();
}

/** Las declaraciones de `selector` dentro de `@media media` (o fuera de toda @media si media es null). */
function reglas(archivo, media, selector) {
  let css = fs.readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  if (media) {
    const bloques = [];
    for (let inicio = css.indexOf(`@media ${media} {`); inicio >= 0; inicio = css.indexOf(`@media ${media} {`, inicio + 1)) {
      let fin = css.indexOf('{', inicio) + 1;
      for (let hondo = 1; hondo; fin++) hondo += css[fin] === '{' ? 1 : css[fin] === '}' ? -1 : 0;
      bloques.push(css.slice(css.indexOf('{', inicio) + 1, fin - 1));
    }
    assert.ok(bloques.length, `${archivo}: falta @media ${media}`);
    css = bloques.join('\n');
  } else {
    css = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  }
  const decl = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector).map((m) => m[2]).join(';');
  return (prop) => decl.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();
}

test('en escritorio, el cartel del lugar no pasa de la columna de avisos ni de la plata a ningún ancho', () => {
  const cartel = reglas('src/ui/css/momentos.css', '(min-width: 900px) and (min-height: 610px), (min-width: 1127px) and (min-height: 501px)', '#zona-cartel');
  const largo = reglas('src/ui/css/momentos.css', '(min-width: 900px) and (min-height: 610px), (min-width: 1127px) and (min-height: 501px)', '#zona-cartel.zona-cartel--largo');
  const base = reglas('src/ui/css/momentos.css', null, '#zona-cartel');
  const aviso = reglas('src/ui/css/avisos.css', null, '.loot-toast');
  const plata = reglas('src/ui/css/hud.css', null, '#topbar');
  assert.ok(cartel('max-width'), 'el cartel tiene un ancho máximo en escritorio');
  assert.ok(largo('font-size'), 'los nombres largos tienen su letra');
  for (let vw = 900; vw <= 2560; vw += 10) {
    const ancho = medida(cartel('max-width'), vw);
    const izquierda = (vw - ancho) / 2, derecha = (vw + ancho) / 2;
    const columna = medida(aviso('left'), vw) + medida(aviso('max-width'), vw);
    const plataEmpieza = vw - medida(plata('right'), vw) - medida(plata('width'), vw);
    assert.ok(izquierda >= columna, `a ${vw}px el cartel empieza en ${izquierda} y la columna de avisos llega a ${columna}`);
    assert.ok(derecha <= plataEmpieza, `a ${vw}px el cartel llega a ${derecha} y la plata empieza en ${plataEmpieza}`);
    assert.ok(ancho >= 240, `a ${vw}px caben al menos 240px de cartel (${ancho})`);
    assert.ok(medida(largo('font-size'), vw) < medida(base('font-size'), vw), `a ${vw}px el nombre largo va con letra más chica`);
  }
  // Con ventanas bajas, la regla vale solo desde el ancho en que el cartel ya empieza a la derecha del radar.
  const radar = reglas('src/ui/css/hud.css', null, '#hud-dock');
  const propiedadHud = reglas('src/ui/css/hud.css', null, ':root');
  const bajo = Number(fs.readFileSync('src/ui/css/momentos.css', 'utf8').match(/\(min-width: (\d+)px\) and \(min-height: 501px\)/)?.[1]);
  const radarTermina = medida(radar('left'), bajo) + medida(radar('width'), bajo, propiedadHud);
  assert.ok((bajo - medida(cartel('max-width'), bajo)) / 2 >= radarTermina, `a ${bajo}px y poco alto, el cartel empieza a la derecha del radar (${radarTermina}px)`);
  assert.ok((bajo - 1 - medida(cartel('max-width'), bajo - 1)) / 2 < radarTermina, `${bajo}px es el primer ancho en que el cartel no llega sobre el radar`);
});

test('en el celular, mientras se ve la misión del día, el cartel baja debajo de ella', () => {
  const MISION_ALTO = 33; // la caja de la misión a 20px de letra, medida en el navegador a 820 × 800 y a 390 × 844
  const conMision = reglas('src/ui/css/momentos.css', '(max-width: 899px)', 'body:has(#mision:not([hidden])) #zona-cartel')('top');
  assert.ok(conMision, 'hay regla para el cartel con la misión a la vista');
  const bajo = (top) => Number(top.match(/var\(--dock-bottom[^)]*\)\s*\+\s*(\d+)px/)?.[1]);
  const cartel = bajo(conMision);
  const hoja = fs.readFileSync('src/ui/css/hud.css', 'utf8');
  const misiones = [...hoja.matchAll(/#mision\s*\{[^}]*top:\s*(calc\(var\(--dock-bottom[^;]*)/g)].map((m) => bajo(m[1]));
  assert.ok(misiones.length >= 2, 'la misión va bajo el radar en el celular de pie y acostado');
  for (const mision of misiones) assert.ok(cartel >= mision + MISION_ALTO, `el cartel a radar + ${cartel}px y la misión de radar + ${mision} a ${mision + MISION_ALTO}px`);
});
