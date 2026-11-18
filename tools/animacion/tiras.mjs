// Tiras de fotogramas y medidas de animación del jugador (herramienta de pruebas, no del juego).
//
//   BROWSER=none npx vite --host 127.0.0.1 --port <puerto> --strictPort &      # el servidor del repo
//   node tools/animacion/tiras.mjs --url http://127.0.0.1:<puerto>/ --salida <carpeta> [--modelo realista|procedural] [--casos a,b] [--azar]
//
// Abre sala.html?prueba=personaje con la GPU (Metal en Mac), corre cada caso cuadro a cuadro con
// tools/animacion/banco.js y escribe por caso <nombre>.png (hoja de contactos de perfil, más <nombre>-<vista>.png
// si el caso tiene otras cámaras) y un resumen.json/resumen.md con tirones (rad/s entre cuadros), patinaje del pie
// plantado (m/s), salto y brazos.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analizarBrazos, analizarPatinaje, analizarSalto, analizarTirones } from './medidas.js';

const { chromium } = createRequire(path.join(process.cwd(), 'package.json'))('@playwright/test');

const argumentos = Object.fromEntries(process.argv.slice(2).reduce((pares, valor, i, todos) => {
  if (valor.startsWith('--')) pares.push([valor.slice(2), todos[i + 1]?.startsWith('--') ? true : todos[i + 1] ?? true]);
  return pares;
}, []));
// Por defecto, el servidor de `npm run dev` (vite.config.js), como tools/benchmark-performance.mjs.
const url = (argumentos.url ?? 'http://127.0.0.1:5173/').replace(/\/?$/, '/');
const salida = path.resolve(argumentos.salida ?? 'work/animacion');
const modelo = argumentos.modelo === 'procedural' ? 'procedural' : 'realista';
export const UMBRAL_TIRON = Number(argumentos.umbral ?? 8);

const correr = ['KeyD', 'ShiftLeft'];
// La cámara del juego (`Camera.js`): detrás del jugador, a 5,5 m, 0,22 rad por encima, mirando a 1,5 m del piso y con 55° de campo.
const DETRAS = { angulo: -90, distancia: 5.5, inclinacion: 12.6, alto: 1.5, fov: 55 };
// La misma cámara, de cerca: tronco y brazos siguiendo el salto, para ver qué asoma al costado del cuerpo.
const DETRAS_CERCA = { ...DETRAS, alto: 1.3, seguirY: true, ventana: [1.3, 1.1], escala: 180 };
export const CASOS = [
  // Los dos saltos que más se ven también desde atrás con la cámara del juego (`-atras.png`, y de cerca en
  // `-atras-cerca.png`); el de carrera, también de tres cuartos. Son la misma corrida que la hoja de perfil.
  { nombre: 'salto-parado', cuadros: 72, guion: [{ desde: 6, hasta: 34, teclas: ['Space'], pulsar: ['Space'] }], captura: { desde: 0, hasta: 70, cada: 2 }, vistas: { atras: DETRAS, 'atras-cerca': DETRAS_CERCA } },
  { nombre: 'salto-parado-toque', cuadros: 64, guion: [{ desde: 6, pulsar: ['Space'] }], captura: { desde: 0, hasta: 62, cada: 2 } },
  { nombre: 'salto-carrera', inicio: [-14, 0], cuadros: 150, guion: [{ desde: 0, hasta: 149, teclas: correr }, { desde: 80, hasta: 106, teclas: ['Space'], pulsar: ['Space'] }], captura: { desde: 74, hasta: 144, cada: 2 }, vistas: { 'tres-cuartos': { angulo: 45 }, atras: DETRAS, 'atras-cerca': DETRAS_CERCA } },
  { nombre: 'caida-bordillo', suelo: { borde: 0, alto: .9 }, inicio: [-3.2, 0], cuadros: 120, guion: [{ desde: 0, hasta: 119, teclas: ['KeyD'] }], captura: { desde: 50, hasta: 118, cada: 2 }, camara: { distancia: 8.5, alto: .5 } },
  { nombre: 'bordillo-bajo', suelo: { borde: 0, alto: .45 }, inicio: [-3.2, 0], cuadros: 100, guion: [{ desde: 0, hasta: 99, teclas: ['KeyD'] }], captura: { desde: 52, hasta: 98, cada: 2 }, camara: { distancia: 8, alto: .9 } },
  { nombre: 'caida-alta', suelo: { borde: 0, alto: 2.2 }, inicio: [-6.5, 0], cuadros: 130, guion: [{ desde: 0, hasta: 129, teclas: correr }], captura: { desde: 56, hasta: 126, cada: 2 }, camara: { distancia: 9, seguirY: true } },
  { nombre: 'arrancar', cuadros: 64, guion: [{ desde: 6, hasta: 63, teclas: correr }], captura: { desde: 0, hasta: 62, cada: 2 } },
  { nombre: 'frenar', inicio: [-10, 0], cuadros: 140, guion: [{ desde: 0, hasta: 74, teclas: correr }], captura: { desde: 66, hasta: 136, cada: 2 } },
  { nombre: 'giro-brusco', inicio: [-10, 0], cuadros: 140, guion: [{ desde: 0, hasta: 74, teclas: correr }, { desde: 75, hasta: 139, teclas: ['KeyA', 'ShiftLeft'] }], captura: { desde: 66, hasta: 136, cada: 2 } },
  { nombre: 'punetazo', cuadros: 52, guion: [{ desde: 6, pulsar: ['KeyG'] }], captura: { desde: 0, hasta: 51, cada: 1 } },
  // Al final, para que los casos de antes corran en el mismo orden y con el mismo estado que antes de añadir estos casos.
  { nombre: 'salto-parado-tres-cuartos', cuadros: 72, guion: [{ desde: 6, hasta: 34, teclas: ['Space'], pulsar: ['Space'] }], captura: { desde: 0, hasta: 70, cada: 2 }, camara: { angulo: 45 } },
  { nombre: 'caida-5m', suelo: { borde: 0, alto: 5 }, inicio: [-6.5, 0], cuadros: 170, guion: [{ desde: 0, hasta: 169, teclas: correr }], captura: { desde: 72, hasta: 166, cada: 2 }, camara: { distancia: 9, seguirY: true } },
  { nombre: 'caida-5m-tres-cuartos', suelo: { borde: 0, alto: 5 }, inicio: [-6.5, 0], cuadros: 170, guion: [{ desde: 0, hasta: 169, teclas: correr }], captura: { desde: 72, hasta: 166, cada: 2 }, camara: { distancia: 9, seguirY: true, angulo: 45 } },
  // Saltar desde el fondo del golpe fuerte (toca en el cuadro ~106 y el fondo dura de ~113 a ~120).
  { nombre: 'salto-sentadilla', suelo: { borde: 0, alto: 5 }, inicio: [-6.5, 0], cuadros: 190, guion: [{ desde: 0, hasta: 104, teclas: correr }, { desde: 116, hasta: 140, teclas: ['Space'], pulsar: ['Space'] }], captura: { desde: 100, hasta: 188, cada: 2 }, camara: { distancia: 9, seguirY: true } },
  // Saltar corriendo justo antes de un borde de 7,8 m (la altura del puente): el suelo de debajo cambia en el aire.
  { nombre: 'salto-borde-alto', suelo: { borde: 0, alto: 7.8 }, inicio: [-8, 0], cuadros: 210, guion: [{ desde: 0, hasta: 209, teclas: correr }, { desde: 74, hasta: 100, teclas: ['Space'], pulsar: ['Space'] }], captura: { desde: 66, hasta: 208, cada: 2 }, camara: { distancia: 10, seguirY: true } }
];

export function resumirCaso(r, umbral = UMBRAL_TIRON) {
  const salto = analizarSalto(r.cuadros);
  return {
    caso: r.nombre, modelo: r.modelo, cuadros: r.cuadros.length,
    salto,
    tirones: analizarTirones(r.cuadros, { umbral }),
    patinaje: analizarPatinaje(r.cuadros),
    brazos: analizarBrazos(r.cuadros, { cabeza: r.cabeza }),
    // Del despegue a 10 cuadros después de tocar: brazos quietos (menos de 1° por cuadro) en el salto.
    brazosSalto: salto.despega ? analizarBrazos(r.cuadros, { cabeza: r.cabeza, desde: salto.cuadroDespegue, hasta: salto.cuadroAterrizaje + 10, quieto: 1 }) : null
  };
}

function tabla(resumenes) {
  const filas = ['| caso | tirones > umbral | peor (rad/s, hueso, cuadro) | p95 | p99 | patinaje media / p95 / máx (m/s) | ápice (m) | aire (s) | mano sobre el mentón, máx (cm) | brazos quietos en el salto (cuadros) |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of resumenes) {
    const t = r.tirones, p = r.patinaje, s = r.salto, b = r.brazos, bs = r.brazosSalto;
    const mano = b.cuadros && Number.isFinite(b.mano.valor) ? `${b.mano.valor} @${b.mano.cuadro}` : '-';
    filas.push(`| ${r.caso} | ${t.encima} | ${t.peor.valor} ${t.peor.hueso} @${t.peor.cuadro} | ${t.p95} | ${t.p99} | ${p.media} / ${p.p95} / ${p.max} (${p.muestras}) | ${s.despega ? s.apice : '-'} | ${s.despega ? s.aire : '-'} | ${mano} | ${bs?.cuadros ? bs.congelados : '-'} |`);
  }
  return filas.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const elegidos = argumentos.casos && argumentos.casos !== true ? new Set(String(argumentos.casos).split(',')) : null;
  const casos = CASOS.filter(c => !elegidos || elegidos.has(c.nombre));
  await mkdir(salida, { recursive: true });
  const log = (...a) => console.log(`[tiras ${new Date().toTimeString().slice(0, 8)}]`, ...a);
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  const resumenes = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await page.addInitScript(m => localStorage.setItem('bazuko.sala.modelo', m), modelo);
    // Azar con semilla fija: los peatones de la sala se mueven igual en cada corrida y las medidas se
    // pueden comparar entre versiones (sin esto el salto en carrera variaba de una corrida a otra).
    if (argumentos.azar !== true) await page.addInitScript(() => {
      let s = 0x9e3779b9;
      Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    });
    log('cargando', url, modelo);
    await page.goto(`${url}sala.html?prueba=personaje`);
    await page.waitForFunction(m => window.__sala?.player?.modelKind === m && (m === 'procedural' || window.__sala.player.character.animationStatus), modelo, { timeout: 120_000 });
    await page.waitForTimeout(500);
    for (const caso of casos) {
      const r = await page.evaluate(async c => {
        const { correrCaso } = await import('/tools/animacion/banco.js');
        return correrCaso(window.__sala, c);
      }, caso);
      await writeFile(path.join(salida, `${caso.nombre}.png`), Buffer.from(r.hoja.split(',')[1], 'base64'));
      for (const [sufijo, hoja] of Object.entries(r.hojas ?? {})) {
        await writeFile(path.join(salida, `${caso.nombre}-${sufijo}.png`), Buffer.from(hoja.split(',')[1], 'base64'));
      }
      delete r.hoja; delete r.hojas;
      await writeFile(path.join(salida, `${caso.nombre}.json`), JSON.stringify(r));
      const resumen = resumirCaso(r);
      resumenes.push(resumen);
      log(caso.nombre, `tirones>${UMBRAL_TIRON}: ${resumen.tirones.encima}`, `peor ${resumen.tirones.peor.valor} ${resumen.tirones.peor.hueso}`,
        `patinaje p95 ${resumen.patinaje.p95}`, resumen.salto.despega ? `ápice ${resumen.salto.apice} aire ${resumen.salto.aire}` : '');
    }
    if (errores.length) log('errores de la página:', errores);
  } finally {
    await browser.close();
  }
  await writeFile(path.join(salida, 'resumen.json'), JSON.stringify(resumenes, null, 2));
  await writeFile(path.join(salida, 'resumen.md'), `# Tiras (${modelo}), umbral de tirón ${UMBRAL_TIRON} rad/s\n\n${tabla(resumenes)}\n`);
  console.log(tabla(resumenes));
}
