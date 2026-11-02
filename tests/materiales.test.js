// Los materiales de la interfaz: seis colores, una sola letra, un solo foco.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mojarCarton } from '../src/ui/mojado.js';
import { letraLista, olvidarLetra } from '../src/ui/letra.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const CSS = path.join(RAIZ, 'src/ui/css');
const leer = (...r) => fs.readFileSync(path.join(RAIZ, ...r), 'utf8');
const base = leer('src/ui/css/base.css');
const marcas = leer('src/ui/css/marcas.css');
const hojas = fs.readdirSync(CSS).filter((f) => f.endsWith('.css'));
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const TOKENS = { carton: '#CBA26C', 'carton-mojado': '#BA8D56', canto: '#3B2913', marcador: '#14110C', cinta: '#E9DBB4', rojo: '#AB1D17' };

const lineal = (c) => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
const luz = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).map(lineal);
  return .2126 * r + .7152 * g + .0722 * b;
};
const contraste = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

test('los seis colores son los del diseño, y nadie más los redefine', () => {
  for (const [nombre, valor] of Object.entries(TOKENS)) {
    const definiciones = hojas.flatMap((f) => [...sinComentarios(leer('src/ui/css', f)).matchAll(new RegExp(`--${nombre}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim()));
    assert.deepEqual(definiciones, [valor], nombre);
  }
});

test('el generador de marcas usa los mismos colores que la hoja', () => {
  const src = leer('tools/fuente/marcas.mjs');
  for (const [constante, token] of [['TINTA', 'marcador'], ['ROJO', 'rojo'], ['CINTA', 'cinta'], ['CANTO', 'canto']]) {
    assert.ok(src.includes(`${constante} = '${TOKENS[token]}'`), constante);
  }
});

test('el marcador se lee: 6:1 o más sobre cartón mojado', () => {
  assert.ok(contraste(TOKENS.marcador, TOKENS['carton-mojado']) >= 6, 'sobre mojado');
  assert.ok(contraste(TOKENS.marcador, TOKENS.carton) >= 6, 'sobre seco');
  assert.ok(contraste(TOKENS.marcador, TOKENS.cinta) >= 6, 'sobre cinta');
  assert.ok(contraste(TOKENS.cinta, TOKENS.rojo) >= 4.5, 'cinta sobre rojo');
});

test('cada marca que nombra la base existe en la hoja de marcas', () => {
  for (const [, nombre] of base.matchAll(/var\(--((?:m|corte)-[a-z-]+)/g)) {
    assert.ok(marcas.includes(`--${nombre}:`), nombre);
  }
});

test('el corte y el filo salen de una imagen por partes, sin clip-path ni seudoelementos', () => {
  const pieza = sinComentarios(base).match(/\.carton, \.placa, \.retazo \{([^}]*)\}/)?.[1] ?? '';
  assert.match(pieza, /border-image:/);
  assert.doesNotMatch(pieza, /clip-path|box-shadow|filter/);
  assert.doesNotMatch(sinComentarios(base), /\.(carton|placa|retazo|cinta)[^{,]*::(before|after)/);
});

test('hay un solo foco: ninguna otra hoja lo escribe ni lo apaga', () => {
  assert.equal(sinComentarios(base).match(/:focus-visible/g)?.length, 1);
  for (const f of hojas.filter((h) => h !== 'base.css')) {
    const css = sinComentarios(leer('src/ui/css', f));
    assert.doesNotMatch(css, /:focus-visible/, f);
    assert.doesNotMatch(css, /outline:\s*(none|0)\b/, f);
  }
});

test('nada se oprime con menos de 44 px bajo 900 de ancho', () => {
  assert.match(sinComentarios(base), /@media \(max-width: 899px\), \(pointer: coarse\) \{\s*:where\([^)]*button[\s\S]*?min-height: 44px !important; min-width: 44px !important;/);
});

test('el movimiento reducido apaga toda animación', () => {
  assert.match(sinComentarios(base), /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ animation: none !important; transition: none !important; \}/);
});

test('las hojas se cargan en orden y las viejas ya no existen', () => {
  const enlaces = [...leer('index.html').matchAll(/href="\/src\/ui\/css\/([a-z]+)\.css"/g)].map((m) => m[1]);
  assert.deepEqual(enlaces.slice(0, 2), ['marcas', 'base']);
  assert.deepEqual(enlaces.toSorted(), hojas.map((h) => h.replace('.css', '')).toSorted());
  for (const vieja of ['styles', 'menus', 'visual-identity', 'urban-hud', 'urban-panels', 'urban-entry', 'inventory', 'crafting', 'item-ui', 'photo-mode']) {
    assert.ok(!fs.existsSync(path.join(RAIZ, 'src/ui', `${vieja}.css`)), vieja);
  }
});

test('las letras de antes y lucide no quedan en ninguna parte', () => {
  const paquete = leer('package.json') + leer('package-lock.json');
  assert.doesNotMatch(paquete, /fontsource|lucide/);
  assert.doesNotMatch(leer('src/main.js'), /fontsource|Overpass|Barlow/);
  for (const f of hojas) assert.doesNotMatch(leer('src/ui/css', f), /Overpass|Barlow|monospace/, f);
  const recorrer = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    return e.isDirectory() ? recorrer(ruta) : e.name.endsWith('.js') ? [ruta] : [];
  });
  for (const ruta of recorrer(path.join(RAIZ, 'src'))) {
    const src = fs.readFileSync(ruta, 'utf8');
    // «Overpass» también es el puente de la avenida; aquí se busca la letra.
    assert.doesNotMatch(src, /px[^'"`\n]*\b(Overpass|"?Barlow)|from 'lucide'/, path.relative(RAIZ, ruta));
  }
});

// ---------- nada parpadea ----------
const TONO = /(?:^|[;{\s])(?:opacity|color|background(?:-color)?|box-shadow|text-shadow|filter|fill|stroke|border-color|outline-color)\s*:/;

// Lo que da una vuelta entera no va y viene: girar no es oscilar. Moverse y volver, sí.
const VUELTA_ENTERA = /^\s*(?:from\s*\{[^{}]*\}\s*)?to\s*\{\s*transform:\s*rotate\(1turn\);?\s*\}\s*$/;
const MOVIMIENTO = /\b(?:transform|translate|rotate|scale)\b/;

/** Cada animación infinita que cambia un color, un brillo o una posición, con lo que dura un ciclo completo. */
function oscilaciones(css) {
  const limpio = sinComentarios(css), tonos = new Set(), out = [];
  for (const k of limpio.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) if (TONO.test(k[2]) || (MOVIMIENTO.test(k[2]) && !VUELTA_ENTERA.test(k[2]))) tonos.add(k[1]);
  const sinFotogramas = limpio.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const r of sinFotogramas.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = Object.fromEntries([...r[2].matchAll(/(animation[\w-]*)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
    const todo = Object.values(decl).join(' ');
    if (!/\binfinite\b/.test(todo)) continue;
    const nombre = [...tonos].find((n) => new RegExp(`(^|\\s)${n}(\\s|$)`).test(todo));
    if (!nombre) continue;
    const t = /(?:^|\s)(\d*\.?\d+)(ms|s)\b/.exec(todo);
    const pasada = t ? Number(t[1]) * (t[2] === 'ms' ? .001 : 1) : 0;
    out.push({ selector: r[1].trim(), nombre, ciclo: /\balternate\b/.test(todo) ? pasada * 2 : pasada });
  }
  return out;
}

test('ningún color, brillo ni posición oscila a más de 0,5 Hz', () => {
  const vistas = hojas.flatMap((f) => oscilaciones(leer('src/ui/css', f)).map((o) => ({ ...o, f })));
  for (const o of vistas) assert.ok(o.ciclo >= 2, `${o.f}: ${o.selector} (${o.nombre}) da un ciclo en ${o.ciclo} s`);
});

test('el lector de oscilaciones ve lo que debe', () => {
  const css = '@keyframes luz { to { opacity: .2 } } @keyframes giro { to { transform: rotate(1turn) } }';
  assert.deepEqual(oscilaciones(`${css} .a { animation: luz .9s infinite alternate; }`), [{ selector: '.a', nombre: 'luz', ciclo: 1.8 }]);
  assert.deepEqual(oscilaciones(`${css} .a { animation: luz 2s linear infinite; }`), [{ selector: '.a', nombre: 'luz', ciclo: 2 }]);
  assert.deepEqual(oscilaciones(`${css} .a { animation-name: luz; animation-duration: 500ms; animation-iteration-count: infinite; }`), [{ selector: '.a', nombre: 'luz', ciclo: .5 }]);
  assert.deepEqual(oscilaciones(`${css} .a { animation: giro .5s infinite; }`), [], 'girar no es parpadear');
  const temblor = '@keyframes temblor { 0%, 100% { transform: none } 50% { transform: translateX(2px) } }';
  assert.deepEqual(oscilaciones(`${temblor} .a { animation: temblor .2s infinite; }`), [{ selector: '.a', nombre: 'temblor', ciclo: .2 }], 'temblar sí cuenta');
  assert.deepEqual(oscilaciones(`${css} .a { animation: luz .5s 3; }`), [], 'lo que acaba no oscila');
});

// ---------- la lluvia ----------
const cuerpo = () => {
  const clases = new Set();
  return { clases, classList: { toggle(c, on) { if (on) clases.add(c); else clases.delete(c); } } };
};

afterEach(() => { delete globalThis.document; mojarCarton(0); olvidarLetra(); });

test('el cartón se moja con la lluvia y no va y viene cuando la humedad ronda el corte', () => {
  const body = cuerpo();
  globalThis.document = { body };
  mojarCarton(0);
  assert.equal(mojarCarton(.39), false);
  assert.equal(mojarCarton(.4), true);
  assert.ok(body.clases.has('mojado'));
  assert.equal(mojarCarton(.3), true, 'dentro de la holgura sigue mojado');
  assert.equal(mojarCarton(.24), false);
  assert.ok(!body.clases.has('mojado'));
});

test('el cartón solo toca la página cuando cambia', () => {
  let toques = 0;
  globalThis.document = { body: { classList: { toggle() { toques++; } } } };
  mojarCarton(0);
  for (let i = 0; i < 50; i++) mojarCarton(.1);
  assert.equal(toques, 0);
  for (let i = 0; i < 50; i++) mojarCarton(.9);
  assert.equal(toques, 1);
});

test('la lluvia cambia la cara de las piezas, y el juego le avisa al cartón', () => {
  assert.match(sinComentarios(base), /body\.mojado\s*\{\s*--cara:\s*var\(--carton-mojado\)/);
  assert.match(leer('src/core/game.js'), /mojarCarton\(streetWetness\.value\)/);
});

test('mojarCarton aguanta correr sin página', () => {
  assert.equal(mojarCarton(.9), true);
});

// ---------- la carga espera la letra ----------
test('la carga pide los dos cortes con letra y dibujo, y una sola vez', async () => {
  const pedidos = [];
  globalThis.document = { fonts: { load: async (f, t) => { pedidos.push([f, t]); return []; } } };
  assert.equal(await letraLista(), true);
  await letraLista();
  assert.equal(pedidos.length, 2);
  assert.match(pedidos[0][0], /^400 16px "Dios Le Pague"/);
  assert.match(pedidos[1][0], /^800 16px "Dios Le Pague"/);
  for (const [, texto] of pedidos) assert.match(texto, /[-]/);
});

test('si la letra falla el juego sigue, y sin página no se cuelga', async () => {
  globalThis.document = { fonts: { load: async () => { throw new Error('sin red'); } } };
  assert.equal(await letraLista(), false);
  olvidarLetra();
  delete globalThis.document;
  assert.equal(await letraLista(), false);
});
