import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const RAIZ = new URL('..', import.meta.url);
const leer = (rel) => readFileSync(new URL(rel, RAIZ), 'utf8');

const tamanoPng = (bytes) => bytes.toString('ascii', 1, 4) === 'PNG' && bytes.toString('ascii', 12, 16) === 'IHDR'
  ? { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) } : null;

test('el manifiesto se puede instalar y sus iconos cuadrados existen', () => {
  const man = JSON.parse(leer('public/manifest.webmanifest'));
  assert.equal(man.name, 'Bazuko, Bogotá');
  assert.equal(man.short_name, 'Bazuko');
  assert.equal(man.start_url, '.');
  assert.equal(man.display, 'fullscreen');
  assert.match(man.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(man.background_color, /^#[0-9a-f]{6}$/i);
  const declarados = new Set(man.icons.map((icon) => icon.sizes));
  assert.ok(declarados.has('192x192') && declarados.has('512x512'), 'el navegador pide los dos cuadrados');
  for (const icon of man.icons) {
    assert.equal(icon.type, 'image/png');
    const [w, h] = icon.sizes.split('x').map(Number);
    const bytes = readFileSync(new URL(`public/${icon.src}`, RAIZ));
    assert.deepEqual(tamanoPng(bytes), { w, h }, icon.src);
  }
});

test('la página enlaza manifiesto, tema, favicon e icono de iOS', () => {
  const html = leer('index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="icon" href="\/favicon\.ico"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/iconos\/icono-180\.png"/);
  assert.match(html, /<meta name="theme-color"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title"/);
  assert.ok(existsSync(new URL('public/favicon.ico', RAIZ)));
  assert.ok(existsSync(new URL('public/iconos/icono-180.png', RAIZ)));
});
