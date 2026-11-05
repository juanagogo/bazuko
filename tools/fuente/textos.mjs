// Saca los caracteres de los textos del juego: las cadenas de los .js, el texto de index.html y el content de las hojas.
// Lo usa la prueba de cobertura de la letra. Los comentarios y las expresiones regulares no cuentan.
import fs from 'node:fs';
import path from 'node:path';

const anotar = (mapa, texto, donde) => {
  mapa.cadenas?.push({ texto, donde });
  for (const ch of texto) if (!mapa.has(ch)) mapa.set(ch, donde);
};

// Un lector de JS que solo sabe de comentarios, cadenas, plantillas y expresiones regulares.
function leerJs(src, archivo, mapa) {
  let i = 0, linea = 1, previo = '';
  const n = src.length;
  const avanza = (k = 1) => { for (; k > 0 && i < n; k--) { if (src[i] === '\n') linea++; i++; } };

  // Devuelve el carácter de una secuencia de escape y la deja consumida.
  const escape = () => {
    const m = /^\\u\{([0-9a-fA-F]+)\}|^\\u([0-9a-fA-F]{4})|^\\x([0-9a-fA-F]{2})/.exec(src.slice(i, i + 12));
    if (m) { avanza(m[0].length); return String.fromCodePoint(parseInt(m[1] ?? m[2] ?? m[3], 16)); }
    const e = src[i + 1];
    avanza(2);
    return 'ntrbfv0\n'.includes(e) ? '' : e ?? '';
  };

  const cadena = (comilla) => {
    let texto = '';
    const inicio = linea;
    avanza();
    while (i < n && src[i] !== comilla && src[i] !== '\n') {
      if (src[i] === '\\') texto += escape();
      else { texto += src[i]; avanza(); }
    }
    avanza();
    anotar(mapa, texto, `${archivo}:${inicio}`);
  };

  const plantilla = () => {
    let texto = '';
    const inicio = linea;
    avanza();
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') texto += escape();
      else if (src[i] === '$' && src[i + 1] === '{') {
        avanza(2);
        let llaves = 1;
        codigo(() => {
          if (src[i] === '{') llaves++;
          if (src[i] === '}' && --llaves === 0) return true;
          return false;
        });
        avanza();
      } else { texto += src[i]; avanza(); }
    }
    avanza();
    anotar(mapa, texto, `${archivo}:${inicio}`);
  };

  const regex = () => {
    let clase = false;
    avanza();
    while (i < n && src[i] !== '\n') {
      if (src[i] === '\\') { avanza(2); continue; }
      if (src[i] === '[') clase = true;
      if (src[i] === ']') clase = false;
      if (src[i] === '/' && !clase) { avanza(); return; }
      avanza();
    }
  };

  function codigo(parar) {
    while (i < n) {
      if (parar?.()) return;
      const ch = src[i], sig = src[i + 1];
      if (ch === '/' && sig === '/') { while (i < n && src[i] !== '\n') avanza(); continue; }
      if (ch === '/' && sig === '*') {
        avanza(2);
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) avanza();
        avanza(2);
        continue;
      }
      if (ch === '"' || ch === "'") { cadena(ch); previo = 'x'; continue; }
      if (ch === '`') { plantilla(); previo = 'x'; continue; }
      if (ch === '/' && /[(,=:[!&|?{};]|^$/.test(previo)) { regex(); previo = 'x'; continue; }
      if (!/\s/.test(ch)) previo = ch;
      avanza();
    }
  }
  codigo();
}

function leerHtml(html, archivo, mapa) {
  const limpio = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  anotar(mapa, limpio.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' '), archivo);
  for (const [, valor] of limpio.matchAll(/(?:aria-label|title|alt|placeholder)="([^"]*)"/g)) anotar(mapa, valor, archivo);
}

function leerCss(css, archivo, mapa) {
  for (const [, , valor] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/content:\s*(['"])(.*?)\1/g)) {
    anotar(mapa, valor.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))), archivo);
  }
}

/** Cada carácter de los textos del juego, con el primer sitio donde aparece. `excluir`: prefijos de ruta. */
export function caracteresDelJuego(raiz, opciones = {}) {
  return recorrerElJuego(raiz, new Map(), opciones);
}

/** Cada texto del juego entero, con su sitio. Lo usa la prueba de la voz. */
export function cadenasDelJuego(raiz, opciones = {}) {
  const mapa = new Map();
  mapa.cadenas = [];
  return recorrerElJuego(raiz, mapa, opciones).cadenas;
}

function recorrerElJuego(raiz, mapa, { excluir = [] }) {
  const fuera = (rel) => excluir.some((e) => rel.startsWith(e));
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name), rel = path.relative(raiz, ruta);
      if (fuera(rel)) continue;
      if (e.isDirectory()) recorrer(ruta);
      else if (e.name.endsWith('.js')) leerJs(fs.readFileSync(ruta, 'utf8'), rel, mapa);
      else if (e.name.endsWith('.css')) leerCss(fs.readFileSync(ruta, 'utf8'), rel, mapa);
    }
  };
  recorrer(path.join(raiz, 'src'));
  leerHtml(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), 'index.html', mapa);
  return mapa;
}
