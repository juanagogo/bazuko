import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';
import { Avisos, avisosALaVista } from '../src/ui/avisos.js';

const LARGO = 'Dormí en el hogar de paso: me bañé, comí caliente y nadie me robó. No me cupo: Machete, Varilla; la dejé ahí.';
const PALABRAS = LARGO.split(' ');

function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const caja = (top, bottom, left = 0, right = 100) => ({ top, bottom, left, right, height: bottom - top, width: right - left });

const anchoMaximo = (ancho) => (ancho > (globalThis.innerHeight ?? 0) ? ancho * .39 : ancho - 12);
const medidas = (texto, ancho) => {
  const max = anchoMaximo(ancho);
  const largo = texto.length * 8.6 + 16;
  const renglones = Math.max(1, Math.ceil(largo / max));
  return { ancho: Math.min(largo, max), alto: renglones * 17.6 + 6 };
};

let pagina;

function pantalla(ancho, alto, cajas) {
  const hijos = [];
  const clases = new Set();
  const observadores = [];
  globalThis.innerWidth = ancho;
  globalThis.innerHeight = alto;
  globalThis.ResizeObserver = class {
    constructor(f) { this.f = f; this.vistos = new Set(); observadores.push(this); }
    observe(el) { this.vistos.add(el); }
    unobserve(el) { this.vistos.delete(el); }
  };
  pagina = { hijos, clases, cajas, observadores };
  const retazoVisible = () => !(globalThis.innerWidth < 360 && hijos.length);
  globalThis.document = {
    getElementById: (id) => {
      const c = pagina.cajas[id];
      if (!c || (id === 'retazo' && !retazoVisible())) return null;
      return { hidden: false, getBoundingClientRect: () => c };
    },
    createElement: () => {
      const el = { oculto: false, className: '', textContent: '', remove() { hijos.splice(hijos.indexOf(this), 1); } };
      el.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
      const m = () => (el.oculto ? { ancho: 0, alto: 0 } : medidas(el.textContent, globalThis.innerWidth));
      Object.defineProperty(el, 'offsetHeight', { get: () => Math.round(m().alto) });
      el.getBoundingClientRect = () => {
        const top = parseFloat(el.style.top) || 0;
        const { ancho: w, alto: h } = m();
        const izq = globalThis.innerWidth > globalThis.innerHeight ? globalThis.innerWidth - 6 - w : 6;
        return caja(top, top + h, izq, izq + w);
      };
      return el;
    },
    body: {
      appendChild: (e) => hijos.push(e),
      classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) },
    },
  };
  return hijos;
}

const enLaFranja = (r, ancho, alto) => r.left < ancho * .6 && r.right > ancho * .4 && r.top < alto * .85 && r.bottom > alto * .4;

function fueraDelPersonaje(hijos, ancho, alto, contexto) {
  const retazo = pagina.clases.has('avisos-sin-retazo') ? null : globalThis.document.getElementById('retazo')?.getBoundingClientRect();
  for (const el of hijos) {
    const r = el.getBoundingClientRect();
    assert.ok(!enLaFranja(r, ancho, alto), `${contexto}: «${el.textContent.slice(0, 30)}» en [${r.left}, ${r.top}, ${r.right}, ${r.bottom}]`);
    if (retazo) assert.ok(r.bottom <= retazo.top || r.top >= retazo.bottom, `${contexto}: «${el.textContent.slice(0, 30)}» se monta en el retazo`);
  }
}

function estadoDePie(rand, ancho) {
  const [topbar, persecucion] = [[46, false], [46, false], [74, false], [82, true], [116, true]][Math.floor(rand() * 5)];
  const dock = topbar + 150 + Math.round(rand() * 70);
  const cajas = { topbar: caja(0, topbar, 0, ancho - 50), 'hud-dock': caja(topbar, dock, 0, ancho) };
  if (!persecucion && rand() < .5) cajas.retazo = caja(dock + 7, dock + 7 + 34 + Math.round(rand() * 26), 6, ancho - 6);
  if (rand() < .3) cajas.mision = caja(dock + 7, dock + 38);
  return cajas;
}

const textoAlAzar = (rand) => {
  const n = 1 + Math.floor(rand() * PALABRAS.length);
  return Array.from({ length: n }, (_, i) => PALABRAS[(i + Math.floor(rand() * 7)) % PALABRAS.length]).join(' ');
};

const relojFalso = (t) => {
  let ahora = 0;
  t.mock.method(globalThis.performance, 'now', () => ahora);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return (ms) => { for (let i = 0; i < ms; i += 50) { ahora += 50; t.mock.timers.tick(50); } };
};

afterEach(() => { for (const k of ['innerWidth', 'innerHeight', 'document', 'ResizeObserver', 'window']) delete globalThis[k]; });

const DE_PIE_320 = () => ({ topbar: caja(0, 46, 0, 270), 'hud-dock': caja(46, 215, 0, 320) });

test('a 320 de pie el aviso más largo no entra en la zona del personaje, aunque bajo el cartón no quepa', (t) => {
  relojFalso(t);
  const hijos = pantalla(320, 568, DE_PIE_320());
  new Avisos().poner(LARGO, 'rare');
  assert.equal(hijos.length, 1);
  fueraDelPersonaje(hijos, 320, 568, '320 × 568');
  assert.ok(hijos[0].getBoundingClientRect().top >= 46, 'no tapa la plata');
});

test('a 320 con varios avisos seguidos, cada uno que sale queda fuera de la zona del personaje', (t) => {
  const avanzar = relojFalso(t);
  const hijos = pantalla(320, 568, { ...DE_PIE_320(), mision: caja(222, 253) });
  const avisos = new Avisos();
  const textos = ['Aviso de prueba 0', LARGO, '¡Me pillaron robando!', 'Una camioneta negra frenó en seco: limpieza social. Córrale y no se deje alcanzar.'];
  for (const [i, texto] of textos.entries()) avisos.poner(texto, i % 2 ? 'warn' : 'info');
  const vistos = new Set();
  for (let paso = 0; paso < 40 && vistos.size < textos.length; paso++) {
    assert.ok(hijos.length <= avisosALaVista(320, 568));
    for (const el of hijos) vistos.add(el.textContent);
    fueraDelPersonaje(hijos, 320, 568, `paso ${paso}`);
    avanzar(500);
  }
  assert.equal(vistos.size, textos.length, 'todos alcanzan a salir');
});

test('de pie entre 320 y 375 ningún aviso entra en la zona del personaje ni se monta en el retazo, con estados y textos al azar', (t) => {
  const avanzar = relojFalso(t);
  const semilla = 20261115;
  const rand = azar(semilla);
  for (let caso = 0; caso < 400; caso++) {
    const ancho = 320 + Math.floor(rand() * 56);
    const alto = 568 + Math.floor(rand() * 245);
    const cajas = estadoDePie(rand, ancho);
    const hijos = pantalla(ancho, alto, cajas);
    const avisos = new Avisos();
    const textos = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => textoAlAzar(rand));
    for (const texto of textos) avisos.poner(texto, rand() < .5 ? 'info' : 'warn');
    const contexto = `semilla ${semilla}, caso ${caso}: ${ancho} × ${alto}, plata hasta ${cajas.topbar.bottom}, cartón hasta ${cajas['hud-dock'].bottom}`;
    for (let paso = 0; paso < 30 && (hijos.length || avisos.cola.length); paso++) {
      fueraDelPersonaje(hijos, ancho, alto, contexto);
      for (const el of hijos) assert.ok(el.getBoundingClientRect().top >= cajas.topbar.bottom, `${contexto}: no tapa la plata`);
      avanzar(700);
    }
    for (const a of [...avisos.visibles]) avisos._quitar(a, false);
  }
});

test('de pie entre 320 y 430, el aviso que no entraría en la zona del personaje sale donde salía, y el retazo se sigue viendo', (t) => {
  relojFalso(t);
  const semilla = 15112026;
  const rand = azar(semilla);
  let iguales = 0;
  for (let caso = 0; caso < 600; caso++) {
    const ancho = 320 + Math.floor(rand() * 111);
    const alto = 568 + Math.floor(rand() * 365);
    const cajas = estadoDePie(rand, ancho);
    const texto = rand() < .3 ? 'Aviso de prueba 0' : textoAlAzar(rand);
    pantalla(ancho, alto, cajas);
    const retazo = ancho < 360 ? null : cajas.retazo;
    const comoAntes = Math.round(Math.max(retazo?.bottom ?? 0, cajas['hud-dock'].bottom, cajas.mision?.bottom ?? 0) + 8);
    const m = medidas(texto, ancho);
    if (enLaFranja(caja(comoAntes, comoAntes + m.alto, 6, 6 + m.ancho), ancho, alto)) continue;
    const avisos = new Avisos();
    avisos.poner(texto);
    const contexto = `semilla ${semilla}, caso ${caso}: ${ancho} × ${alto}, «${texto.slice(0, 20)}»`;
    assert.equal(pagina.hijos[0].style.top, `${comoAntes}px`, contexto);
    assert.equal(pagina.clases.has('avisos-sin-retazo'), false, `${contexto}: el retazo no se esconde`);
    avisos._quitar(avisos.visibles[0], false);
    iguales++;
  }
  assert.ok(iguales > 200, `solo ${iguales} casos comparados`);
});

test('con la patrulla encima a 320, un aviso que no cabe en ningún lado se queda bajo la plata, sin taparla', (t) => {
  relojFalso(t);
  const hijos = pantalla(320, 568, { topbar: caja(0, 116.1, 0, 320), 'hud-dock': caja(116, 160, 0, 320) });
  new Avisos().poner(`${LARGO} ${LARGO}`, 'death');
  assert.equal(hijos[0].style.top, '116px');
});

test('al subir la pila, el desplazamiento que usa la hoja con un menú abierto empieza en cero', (t) => {
  relojFalso(t);
  const hijos = pantalla(320, 568, DE_PIE_320());
  new Avisos().poner('Aviso de prueba 0');
  assert.ok(parseFloat(hijos[0].style.top) < 223, 'subió');
  assert.equal(hijos[0].style.props['--pila'], '0px');
});

test('un aviso que nace escondido se vuelve a colocar al aparecer, fuera de la zona del personaje', (t) => {
  relojFalso(t);
  const hijos = pantalla(320, 568, DE_PIE_320());
  const crear = globalThis.document.createElement;
  globalThis.document.createElement = () => Object.assign(crear(), { oculto: true });
  const avisos = new Avisos();
  const quitarTodos = () => { for (const a of [...avisos.visibles]) avisos._quitar(a); };
  avisos.poner(LARGO);
  const el = hijos[0];
  el.oculto = false;
  assert.equal(pagina.observadores.length, 1);
  assert.ok(pagina.observadores[0].vistos.has(el), 'mira el aviso');
  pagina.observadores[0].f([]);
  fueraDelPersonaje(hijos, 320, 568, 'tras aparecer');
  quitarTodos();
  assert.equal(pagina.observadores[0].vistos.size, 0, 'deja de mirar el aviso que se fue');
});

function conVentana() {
  const oyentes = [];
  globalThis.window = { addEventListener: (tipo, f) => { if (tipo === 'resize') oyentes.push(f); } };
  return (ancho, alto, cajas) => {
    globalThis.innerWidth = ancho;
    globalThis.innerHeight = alto;
    pagina.cajas = cajas;
    for (const f of oyentes) f();
  };
}
const ESCRITORIO = { 'game-settings': caja(18, 62), 'hud-dock': caja(380, 780) };

test('al pasar de 1280 a 320 y volver, quedan a la vista los avisos que tendría si hubiera cargado en ese tamaño', (t) => {
  relojFalso(t);
  const cambiar = conVentana();
  const hijos = pantalla(1280, 800, ESCRITORIO);
  const avisos = new Avisos();
  for (const n of ['uno', 'dos', 'tres', 'cuatro']) avisos.poner(n);
  assert.deepEqual(hijos.map((e) => e.textContent), ['uno', 'dos', 'tres']);
  cambiar(320, 568, DE_PIE_320());
  assert.deepEqual(hijos.map((e) => e.textContent), ['uno'], 'de pie se ve uno');
  assert.deepEqual(avisos.cola.map((a) => a.texto), ['dos', 'tres', 'cuatro'], 'los demás vuelven a la cola en su orden');
  fueraDelPersonaje(hijos, 320, 568, 'tras pasar a 320');
  cambiar(1280, 800, ESCRITORIO);
  assert.deepEqual(hijos.map((e) => e.textContent), ['uno', 'dos', 'tres'], 'de vuelta se ven tres');
});

test('los avisos que vuelven a la cola al cambiar de tamaño no viven más de lo que les quedaba', (t) => {
  const avanzar = relojFalso(t);
  const cambiar = conVentana();
  const hijos = pantalla(1280, 800, ESCRITORIO);
  const avisos = new Avisos();
  for (const n of ['uno', 'dos', 'tres']) avisos.poner(n);
  avanzar(2200);
  cambiar(320, 568, DE_PIE_320());
  avanzar(300);
  assert.deepEqual(hijos.map((e) => e.textContent), [], 'a los 2500 ms ya se fueron los tres, como sin cambiar de tamaño');
  assert.equal(avisos.cola.length, 0);
});

test('al cambiar de tamaño la cola no pasa de su tope', (t) => {
  relojFalso(t);
  const cambiar = conVentana();
  pantalla(1280, 800, ESCRITORIO);
  const avisos = new Avisos();
  for (let i = 0; i < 15; i++) avisos.poner(`aviso ${i}`, 'warn');
  assert.equal(avisos.visibles.length, 3);
  assert.equal(avisos.cola.length, 12);
  cambiar(320, 568, DE_PIE_320());
  assert.equal(avisos.visibles.length, 1);
  assert.ok(avisos.cola.length <= 12, `la cola quedó en ${avisos.cola.length}`);
});

const CRITICO_375 = () => ({ topbar: caja(0, 46, 0, 325), 'hud-dock': caja(46, 262, 0, 375), retazo: caja(266, 325.8, 7, 204) });

test('con cola, el retazo se esconde solo mientras el aviso que lo necesita está a la vista', (t) => {
  const avanzar = relojFalso(t);
  const hijos = pantalla(375, 812, CRITICO_375());
  const avisos = new Avisos();
  avisos.poner('Una camioneta negra frenó en seco: limpieza social. Córrale y no se deje alcanzar.', 'warn');
  avisos.poner('+ Cartón');
  assert.equal(hijos[0].style.top, '270px', 'el ancho ocupa el sitio del retazo');
  assert.equal(pagina.clases.has('avisos-sin-retazo'), true);
  for (let i = 0; i < 40 && hijos[0]?.textContent !== '+ Cartón'; i++) avanzar(100);
  assert.equal(hijos[0].textContent, '+ Cartón');
  assert.equal(pagina.clases.has('avisos-sin-retazo'), false, 'el retazo vuelve a verse');
  assert.equal(hijos[0].style.top, '334px', 'sale donde salía');
});

test('al girar el celular, el retazo vuelve a verse si el aviso no lo necesita', (t) => {
  const avanzar = relojFalso(t);
  const cambiar = conVentana();
  const hijos = pantalla(915, 412, { topbar: caja(6, 68, 663, 909), 'hud-dock': caja(6, 180, 6, 434) });
  const avisos = new Avisos();
  avisos.poner(LARGO, 'warn');
  avisos.poner('¡Me pillaron robando!', 'warn');
  cambiar(412, 915, { topbar: caja(0, 46, 0, 362), 'hud-dock': caja(46, 262, 0, 412), retazo: caja(266, 325.8, 7, 204) });
  assert.equal(hijos.length, 1);
  assert.equal(pagina.clases.has('avisos-sin-retazo'), true, 'el largo de pie necesita el sitio del retazo');
  avisos.poner('+ Cartón');
  for (let i = 0; i < 80 && hijos[0]?.textContent !== '+ Cartón'; i++) avanzar(100);
  assert.equal(hijos[0].textContent, '+ Cartón');
  assert.equal(pagina.clases.has('avisos-sin-retazo'), false, 'el retazo vuelve a verse');
  assert.equal(hijos[0].style.top, '334px');
  avisos.poner(LARGO, 'warn');
  for (let i = 0; i < 80 && hijos[0]?.textContent !== LARGO; i++) avanzar(100);
  assert.equal(hijos[0].textContent, LARGO);
  assert.equal(pagina.clases.has('avisos-sin-retazo'), true, 'de pie, el largo vuelve a necesitar el sitio del retazo');
  cambiar(915, 412, { topbar: caja(6, 68, 663, 909), 'hud-dock': caja(6, 180, 6, 434), retazo: caja(186, 220, 6, 300) });
  assert.equal(pagina.clases.has('avisos-sin-retazo'), false, 'acostado no se esconde');
});

test('a 360 × 640 el aviso sube sobre el cartón y el retazo, que no queda tapado, se sigue viendo', (t) => {
  relojFalso(t);
  const hijos = pantalla(360, 640, { topbar: caja(0, 46, 0, 310), 'hud-dock': caja(46, 262, 0, 360), retazo: caja(269, 303, 7, 204) });
  new Avisos().poner('¡Me pillaron robando!', 'warn');
  fueraDelPersonaje(hijos, 360, 640, '360 × 640');
  assert.ok(hijos[0].getBoundingClientRect().bottom <= 269);
  assert.equal(pagina.clases.has('avisos-sin-retazo'), false);
});

test('el aviso devuelto a la cola y apurado no vive más de lo que le quedaba', (t) => {
  const avanzar = relojFalso(t);
  const cambiar = conVentana();
  const robo = 'Robé un retrovisor y lo vendí en la chatarrería de la esquina';
  const hijos = pantalla(915, 412, { topbar: caja(6, 68, 663, 909), 'hud-dock': caja(6, 180, 6, 434) });
  const avisos = new Avisos();
  avisos.poner(LARGO, 'warn');
  avanzar(200);
  avisos.poner(robo, 'warn');
  avanzar(100);
  cambiar(412, 915, { topbar: caja(0, 46, 0, 362), 'hud-dock': caja(46, 262, 0, 412) });
  avanzar(100);
  avisos.poner('+ Cartón');
  let visto = false, seFue = null;
  for (let ms = 400; ms < 8000 && seFue === null; ms += 50) {
    avanzar(50);
    const ve = hijos.some((e) => e.textContent === robo);
    if (ve) visto = true;
    else if (visto) seFue = ms + 50;
  }
  assert.ok(visto, 'vuelve a salir');
  assert.ok(seFue <= 200 + Math.max(2500, robo.length * 55) + 100, `se fue a los ${seFue} ms`);
});

test('la hoja esconde el retazo sin quitarle la caja, para poder medirlo con la clase puesta', () => {
  const hoja = fs.readFileSync('src/ui/css/avisos.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const regla = hoja.match(/body\.avisos-sin-retazo #retazo\s*\{([^}]*)\}/);
  assert.ok(regla, 'hay regla para el retazo');
  assert.match(regla[1], /visibility:\s*hidden/);
  assert.doesNotMatch(regla[1], /display/);
});
