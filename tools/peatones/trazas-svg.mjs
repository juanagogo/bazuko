// tools/peatones/trazas-svg.mjs
// Dibuja desde arriba las trazas de tools/peatones/trazas.mjs: por escena, un SVG con la base arriba y el árbol
// medido abajo, sobre el mismo mapa. Andén gris claro, calzada gris oscuro, cebra a rayas. Cada peatón es una línea
// con un punto cada 2 s, un círculo donde empieza y un cuadrado donde termina; en «robo» el color es su nivel de
// alerta (gris tranquilo, amarillo atento, naranja con recelo, rojo con miedo) y la línea se engruesa mientras huye;
// en las demás, cada peatón tiene su color. Los carros, rectángulos cada 1 s; el jugador, una estrella negra.
//
//   node tools/peatones/trazas-svg.mjs <base.json> <arbol.json> <carpeta> [escala-de-lado]
//
// `escala-de-lado` estira lo de lado en «frente» y «anden» (por defecto 3) para que se vea cuánto se corren.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [baseFile, treeFile, outDir, stretchArg = '3'] = process.argv.slice(2);
const runs = [JSON.parse(await readFile(baseFile, 'utf8')), JSON.parse(await readFile(treeFile, 'utf8'))];
const STRETCH = { frente: Number(stretchArg), anden: Number(stretchArg), poste: Number(stretchArg), trabados: Number(stretchArg), paraguas: Number(stretchArg) };
const PX = { frente: 22, anden: 12, cruce: 16, robo: 14, poste: 22, trabados: 22, paraguas: 22, calzada: 16, corrillo: 12 };
const LEVEL = ['#8a94a6', '#e3b505', '#f07c1b', '#d7263d'];
const HUES = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#ff7f0e', '#7f7f7f',
  '#393b79', '#637939', '#8c6d31', '#843c39', '#7b4173', '#3182bd'];
const TILE = { sidewalk: '#e9e6df', road: '#4a4d52', crossing: '#4a4d52', building: '#b9b2a6' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Las columnas de baldosas que se dibujan: las que pisó alguien, con dos de margen a cada lado (iguales en los dos
 * paneles). Con carros, todo el mapa: se ve de dónde vienen.
 */
function columns(name) {
  const { w, size } = runs[1].scenes[name].map;
  if (runs.some(run => run.scenes[name]?.samples.some(sample => sample.cars.length))) return [0, w - 1];
  let min = Infinity, max = -Infinity;
  for (const run of runs) for (const sample of run.scenes[name]?.samples ?? []) for (const [x] of sample.people) { min = Math.min(min, x); max = Math.max(max, x); }
  return [Math.max(0, Math.floor(min / size) - 2), Math.min(w - 1, Math.ceil(max / size) + 2)];
}

function panel(run, name, y0, width) {
  const scene = run.scenes[name];
  if (!scene) return { svg: '', height: 0 };
  const { w, h, size, tiles } = scene.map, px = PX[name] ?? 14, sy = STRETCH[name] ?? 1;
  const [c0, c1] = columns(name);
  const X = x => (x + size / 2 - c0 * size) * px, Z = z => y0 + 40 + (z + size / 2) * px * sy;
  const parts = [];
  const title = `${run.minds ? 'con mente' : 'sin mente'} · ${run.root}`;
  parts.push(`<text x="8" y="${y0 + 18}" font-size="15" font-weight="bold">${esc(title)}</text>`);
  parts.push(`<text x="8" y="${y0 + 34}" font-size="11" fill="#333">${esc(JSON.stringify(scene.metrics).slice(0, 260))}</text>`);
  for (let z = 0; z < h; z++) for (let x = c0; x <= c1; x++) {
    const type = tiles[z * w + x];
    const rx = (x - c0) * size * px, ry = y0 + 40 + z * size * px * sy, rw = size * px, rh = size * px * sy;
    parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${TILE[type] ?? '#ccc'}"/>`);
    if (type === 'crossing') for (let k = 0; k < 4; k++) parts.push(`<rect x="${rx + k * rw / 4 + 1}" y="${ry}" width="${rw / 8}" height="${rh}" fill="#f4f4f4"/>`);
  }
  // Lo sólido (postes), en negro; lo que pasa (una pelea), una cruz roja.
  for (const [x0, z0, x1, z1] of scene.map.boxes ?? []) {
    parts.push(`<rect x="${X(x0).toFixed(1)}" y="${Z(z0).toFixed(1)}" width="${((x1 - x0) * px).toFixed(1)}" height="${((z1 - z0) * px * sy).toFixed(1)}" fill="#111"/>`);
  }
  for (const [mx, mz] of scene.map.marks ?? []) {
    parts.push(`<path d="M${X(mx) - 6} ${Z(mz) - 6}L${X(mx) + 6} ${Z(mz) + 6}M${X(mx) + 6} ${Z(mz) - 6}L${X(mx) - 6} ${Z(mz) + 6}" stroke="#d7263d" stroke-width="2.5"/>`);
  }
  const samples = scene.samples, people = samples[0].people.length, robo = name === 'robo' || name === 'calzada';
  // Carros: cada 1 s.
  for (let k = 0; k < samples.length; k += 10) for (const [cx, cz] of samples[k].cars) {
    parts.push(`<rect x="${X(cx) - 2.2 * px}" y="${Z(cz) - .95 * px * sy}" width="${4.4 * px}" height="${1.9 * px * sy}" fill="none" stroke="#1a1a1a" stroke-opacity=".35"/>`);
  }
  for (let i = 0; i < people; i++) {
    const color = HUES[i % HUES.length];
    for (let k = 1; k < samples.length; k++) {
      const a = samples[k - 1].people[i], b = samples[k].people[i];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1.5) continue; // lo pusieron ahí (la víctima, junto al jugador): no anduvo
      const stroke = robo ? LEVEL[Math.min(3, b[2])] : color, width = robo && b[3] ? 3.2 : 1.6;
      parts.push(`<line x1="${X(a[0]).toFixed(1)}" y1="${Z(a[1]).toFixed(1)}" x2="${X(b[0]).toFixed(1)}" y2="${Z(b[1]).toFixed(1)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`);
      if (k % 20 === 0) parts.push(`<circle cx="${X(b[0]).toFixed(1)}" cy="${Z(b[1]).toFixed(1)}" r="1.8" fill="#111"/>`);
    }
    const first = samples[0].people[i], last = samples.at(-1).people[i];
    const victim = robo && scene.victim === i;
    parts.push(`<circle cx="${X(first[0]).toFixed(1)}" cy="${Z(first[1]).toFixed(1)}" r="4" fill="none" stroke="${robo ? '#333' : color}" stroke-width="1.5"/>`);
    parts.push(`<rect x="${(X(last[0]) - 3.5).toFixed(1)}" y="${(Z(last[1]) - 3.5).toFixed(1)}" width="7" height="7" fill="${robo ? LEVEL[Math.min(3, last[2])] : color}" stroke="#111"/>`);
    if (victim) parts.push(`<text x="${(X(first[0]) + 6).toFixed(1)}" y="${(Z(first[1]) - 6).toFixed(1)}" font-size="11">víctima</text>`);
  }
  const p = samples.at(-1).player;
  if (p && p[0] >= c0 * size - size && p[0] <= (c1 + 1) * size && p[1] >= -size && p[1] <= h * size) {
    const cx = X(p[0]), cy = Z(p[1]);
    const star = Array.from({ length: 10 }, (_, k) => { const r = k % 2 ? 3.5 : 8, a = k * Math.PI / 5 - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
    parts.push(`<polygon points="${star}" fill="#000"/>`);
  }
  return { svg: parts.join('\n'), height: 40 + h * size * px * sy + 20 };
}

for (const name of Object.keys(runs[1].scenes)) {
  const scene = runs[1].scenes[name], px = PX[name] ?? 14, [c0, c1] = columns(name);
  const width = Math.max(720, (c1 - c0 + 1) * scene.map.size * px);
  const top = panel(runs[0], name, 0, width), bottom = panel(runs[1], name, top.height, width);
  const legendY = top.height + bottom.height;
  const legend = name === 'robo' || name === 'calzada'
    ? LEVEL.map((c, k) => `<rect x="${8 + k * 130}" y="${legendY + 6}" width="14" height="10" fill="${c}"/><text x="${26 + k * 130}" y="${legendY + 15}" font-size="11">${['tranquilo', 'atento', 'con recelo', 'con miedo'][k]}</text>`).join('') +
      `<text x="540" y="${legendY + 15}" font-size="11">línea gruesa: huyendo · punto: cada 2 s · ○ empieza · □ termina · ★ jugador${name === 'calzada' ? ' · ✕ pelea' : ''}</text>`
    : `<text x="8" y="${legendY + 15}" font-size="11">punto: cada 2 s · ○ empieza · □ termina · ★ jugador${STRETCH[name] > 1 ? ` · lo de lado va estirado ×${STRETCH[name]}` : ''}${name === 'cruce' ? ' · rectángulos: carros cada 1 s' : ''}${name === 'poste' ? ' · ■ poste' : ''}${name === 'corrillo' ? ' · ✕ la pelea' : ''}</text>`;
  const height = legendY + 26;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
${top.svg}
${bottom.svg}
${legend}
</svg>`;
  const file = path.join(outDir, `traza-${name}.svg`);
  await writeFile(file, svg);
  console.log(file);
}
