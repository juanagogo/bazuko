// Las herramientas de tools/ se corren con `node archivo.mjs` desde la carpeta del proyecto, que en el equipo de
// trabajo tiene un espacio («juan agogo»). Comparar `import.meta.url` con `file://${process.argv[1]}` nunca daba
// igual ahí y salían sin hacer nada. Y el build limpia la carpeta de salida que dice la configuración.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { distLigero } from '../vite.config.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const conEspacio = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dir con espacio-'));

test('esPrincipal reconoce el archivo corrido aunque la ruta tenga espacios o pase por un enlace', () => {
  const dir = conEspacio();
  try {
    const helper = pathToFileURL(path.join(raiz, 'tools/esPrincipal.mjs')).href;
    fs.writeFileSync(path.join(dir, 'corre.mjs'), `import { esPrincipal } from '${helper}';\nconsole.log(esPrincipal(import.meta.url));\n`);
    fs.writeFileSync(path.join(dir, 'importa.mjs'), `import './corre.mjs';\n`);
    const correr = (archivo) => spawnSync(process.execPath, [archivo], { encoding: 'utf8' }).stdout.trim();
    assert.equal(correr(path.join(dir, 'corre.mjs')), 'true');
    assert.equal(correr(path.join(dir, 'importa.mjs')), 'false', 'importado por otro no es el principal');
    const enlace = path.join(os.tmpdir(), `enlace con espacio-${process.pid}`);
    fs.symlinkSync(dir, enlace);
    try { assert.equal(correr(path.join(enlace, 'corre.mjs')), 'true', 'a través de un enlace simbólico'); }
    finally { fs.unlinkSync(enlace); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('comprimir-mallas y fbx-a-glb sí corren desde una carpeta con espacio', () => {
  const dir = conEspacio();
  try {
    for (const archivo of ['tools/esPrincipal.mjs', 'tools/personaje/comprimir-mallas.mjs', 'tools/animaciones/fbx-a-glb.mjs']) {
      fs.mkdirSync(path.dirname(path.join(dir, archivo)), { recursive: true });
      fs.copyFileSync(path.join(raiz, archivo), path.join(dir, archivo));
    }
    fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(dir, 'node_modules'));
    const mallas = spawnSync(process.execPath, [path.join(dir, 'tools/personaje/comprimir-mallas.mjs')], { encoding: 'utf8' });
    assert.notEqual(mallas.status, 0, 'sin carpetas tiene que quejarse, no salir callado');
    assert.match(mallas.stderr, /Indicar carpetas/);
    const fbx = spawnSync(process.execPath, [path.join(dir, 'tools/animaciones/fbx-a-glb.mjs'), path.join(dir, 'no-existe.fbx')], { encoding: 'utf8' });
    assert.notEqual(fbx.status, 0);
    assert.match(fbx.stderr, /ENOENT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ninguna prueba ni herramienta usa la ruta de una URL de archivo como ruta del disco', () => {
  const archivos = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : archivos(ruta);
    return /\.(m?js)$/.test(e.name) ? [ruta] : [];
  });
  const malos = [];
  const esta = fileURLToPath(import.meta.url);
  for (const archivo of [...archivos(path.join(raiz, 'tests')), ...archivos(path.join(raiz, 'tools'))]) {
    if (archivo === esta) continue;
    // Los comentarios pueden nombrar el error; lo que cuenta es el código.
    const texto = fs.readFileSync(archivo, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    if (/file:\/\/\$\{process\.argv/.test(texto)) malos.push(`${archivo}: file://\${process.argv[1]}`);
    const urls = [...texto.matchAll(/(?:const|let)\s+(\w+)\s*=\s*new URL\([^;]*import\.meta\.url\)/g)].map((m) => m[1]);
    for (const nombre of urls) if (new RegExp(`\\b${nombre}\\.pathname\\b`).test(texto)) malos.push(`${archivo}: ${nombre}.pathname`);
    if (/new URL\([^)]*import\.meta\.url\)\.pathname/.test(texto)) malos.push(`${archivo}: new URL(…).pathname`);
  }
  assert.deepEqual(malos, [], 'usar fileURLToPath: la ruta de una URL lleva los espacios como %20');
});

test('el build limpia y comprime la carpeta de salida de la configuración, y sin personajes no falla', async () => {
  const dir = conEspacio();
  const antes = process.cwd();
  try {
    fs.mkdirSync(path.join(dir, 'otro/models/Rata'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'ajena/dist/models/Rata'), { recursive: true });
    process.chdir(path.join(dir, 'ajena'));
    const plugin = distLigero();
    plugin.configResolved({ root: dir, build: { outDir: 'otro' } });
    const avisos = [];
    await plugin.closeBundle.call({ warn: (m) => avisos.push(m), info() {} });
    assert.equal(fs.existsSync(path.join(dir, 'otro/models/Rata')), false, 'se limpia la salida configurada');
    assert.equal(fs.existsSync(path.join(dir, 'ajena/dist/models/Rata')), true, 'no el dist/ de la carpeta actual');
    assert.equal(avisos.length, 1, 'sin models/personaje avisa y sigue');
    fs.mkdirSync(path.join(dir, 'otro/models/personaje'), { recursive: true });
    const info = [];
    await plugin.closeBundle.call({ warn: (m) => avisos.push(m), info: (m) => info.push(m) });
    assert.match(info[0], /personajes: 0 glTF/);
  } finally {
    process.chdir(antes);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
