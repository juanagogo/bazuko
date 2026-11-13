// tools/peatones/tandas.mjs
// Lanza tanda-trafico.mjs para muchas semillas, cada una en un proceso nuevo, y resume la tanda. Los números por
// semilla no se comparan entre árboles (una geometría nueva desplaza el azar sembrado); se comparan las tandas.
//
//   node tools/peatones/tandas.mjs --root <árbol> --seeds 1-24 [--minutes 5] [--chases] [--sustos] [--jobs 3] [--out tanda.jsonl]
import { spawn } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const root = path.resolve(opt('root', process.cwd()));
const [from, to] = opt('seeds', '1-12').split('-').map(Number);
const minutes = opt('minutes', '5');
const jobs = Number(opt('jobs', 3));
const out = opt('out', null);
const extra = [];
if (args.includes('--chases')) extra.push('--chases');
if (args.includes('--sustos')) extra.push('--sustos');
if (opt('density', null)) extra.push('--density', opt('density'));
if (opt('hour', null)) extra.push('--hour', opt('hour'));
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tanda-trafico.mjs');
const seeds = Array.from({ length: to - from + 1 }, (_, i) => from + i);
if (out) await writeFile(out, '');

const results = [];
const runOne = seed => new Promise(resolve => {
  const child = spawn(process.execPath, ['--experimental-test-module-mocks', script, '--root', root, '--seed', String(seed), '--minutes', minutes, ...extra],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', () => {});
  // Una semilla no debería tardar más de 15 minutos: si se cuelga, se corta y se anota.
  const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60_000);
  child.on('close', async code => {
    clearTimeout(timer);
    const line = stdout.trim().split('\n').filter(l => l.startsWith('{')).at(-1);
    const result = line ? JSON.parse(line) : { seed, error: `salida ${code}` };
    results.push(result);
    if (out) await appendFile(out, `${JSON.stringify(result)}\n`);
    console.error(`[tandas] semilla ${seed}: ${line ? `peor ${result.worst.seconds} s, >90 s ${result.over90}, >180 s ${result.over180}, trabados ${result.stuckAtEnd}` : result.error} (${results.length}/${seeds.length})`);
    resolve();
  });
});

const queue = [...seeds];
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runOne(queue.shift()); }));
const ok = results.filter(r => !r.error);
const worst = Math.max(...ok.map(r => r.worst.seconds));
const summary = {
  root, seeds: `${from}-${to}`, minutes: Number(minutes), chases: args.includes('--chases'), sustos: args.includes('--sustos'), runs: ok.length, errors: results.length - ok.length,
  worstStopped: worst,
  medianWorst: ok.map(r => r.worst.seconds).sort((a, b) => a - b)[Math.floor(ok.length / 2)],
  seedsOver90: ok.filter(r => r.over90 > 0).length, vehiclesOver90: ok.reduce((a, r) => a + r.over90, 0),
  seedsOver180: ok.filter(r => r.over180 > 0).length, vehiclesOver180: ok.reduce((a, r) => a + r.over180, 0),
  stuckAtEnd: ok.reduce((a, r) => a + r.stuckAtEnd, 0),
  farWorst: Math.max(...ok.map(r => r.farWorst?.seconds ?? 0)),
  seedsFarOver60: ok.filter(r => (r.farWorst?.seconds ?? 0) >= 60).map(r => `${r.seed}:${r.farWorst.kind}@${r.farWorst.x},${r.farWorst.z}`),
  busWorst: Math.max(...ok.map(r => r.busWorst?.seconds ?? 0)),
  patrolFarWorst: Math.max(...ok.map(r => r.patrolFar?.seconds ?? 0)),
  seedsPatrolFarOver60: ok.filter(r => (r.patrolFar?.seconds ?? 0) >= 60).map(r => `${r.seed}:${r.patrolFar.seconds}@${r.patrolFar.x},${r.patrolFar.z}`),
  pedestrianCrossingSeconds: +(ok.reduce((a, r) => a + r.pedestrianCrossingSeconds, 0) / Math.max(1, ok.length)).toFixed(1),
  worstPedWait: Math.max(...ok.map(r => r.worstPedWait))
};
console.log(JSON.stringify(summary));
if (out) await appendFile(out, `${JSON.stringify({ summary })}\n`);
