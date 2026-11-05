#!/usr/bin/env node
// tools/voces/procesar.mjs
// Deja las voces listas para el juego: todas al mismo volumen y, si se pide, con la calle detrás para que una
// voz de ElevenLabs no llegue sobre el silencio de estudio que la delata junto a las grabaciones reales.
//
//   node tools/voces/procesar.mjs public/audio/roberto_n1.mp3 ...          igualar en su sitio (-16 LUFS)
//   node tools/voces/procesar.mjs --calle --recortar --salida public/audio bruto/*.mp3
//   node tools/voces/procesar.mjs --radio  --calle --salida public/audio bruto/policia_radio_*.mp3
//
// --calle     fondo de city_atmosphere_soun.opus a unos -42 LUFS, como el ruido de las grabaciones reales
// --recortar  quita el silencio del principio y del final
// --radio     banda de radio de patrulla (300–3400 Hz) con algo de saturación
// --megafono  banda de megáfono con un eco corto
// --salida d  escribe en d con el mismo nombre (sin ella, reemplaza el archivo)
// --opus      escribe .opus mono a 48 kb/s en lugar de conservar el formato
// Necesita ffmpeg en el PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_LUFS = -16, TRUE_PEAK = -1.5, LRA = 11;
const BED_DB = -20; // city_atmosphere_soun.opus mide -22 LUFS: queda cerca de -42
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BED = join(ROOT, 'public', 'audio', 'city_atmosphere_soun.opus');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--') && a !== '--salida'));
const outIndex = args.indexOf('--salida');
const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : null;
const inputs = args.filter((a, i) => !a.startsWith('--') && (outIndex < 0 || i !== outIndex + 1));
if (!inputs.length) {
  console.error('Uso: node tools/voces/procesar.mjs [--calle] [--recortar] [--radio|--megafono] [--opus] [--salida carpeta] archivos...');
  process.exit(1);
}

const ffmpeg = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
// loudnorm escribe su medición en stderr, incluso cuando todo sale bien.
const ffmpegErr = (...a) => spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...a], { encoding: 'utf8' }).stderr ?? '';

function shapeFilters() {
  const f = [];
  if (flags.has('--recortar')) f.push('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05',
    'areverse', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08', 'areverse');
  if (flags.has('--radio')) f.push('highpass=f=300', 'lowpass=f=3400', 'acompressor=threshold=-20dB:ratio=6:attack=5:release=80', 'asoftclip=type=tanh');
  else if (flags.has('--megafono')) f.push('highpass=f=500', 'lowpass=f=4000', 'aecho=0.8:0.5:35:0.25', 'asoftclip=type=tanh');
  else if (flags.has('--calle')) f.push('highpass=f=90', 'acompressor=threshold=-18dB:ratio=3:attack=10:release=120');
  return f;
}

/** Primera pasada de loudnorm: lo que mide la voz ya moldeada. */
function measure(file, filters) {
  const chain = [...filters, `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json`].join(',');
  const log = ffmpegErr('-i', file, '-af', chain, '-f', 'null', '-');
  const json = log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

function process1(file) {
  const src = resolve(file);
  const ext = flags.has('--opus') ? '.opus' : extname(src);
  const dest = join(outDir ?? dirname(src), basename(src, extname(src)) + ext);
  const tmp = mkdtempSync(join(tmpdir(), 'voces-'));
  const tmpOut = join(tmp, 'salida' + ext);
  try {
    const filters = shapeFilters();
    const m = measure(src, filters);
    const norm = `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}`
      + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    const voice = [...filters, norm, 'aresample=48000'].join(',');
    const codec = ext === '.opus' ? ['-ac', '1', '-c:a', 'libopus', '-b:a', '48k'] : ['-c:a', 'libmp3lame', '-q:a', '2', '-ar', '44100'];
    if (flags.has('--calle')) {
      ffmpeg('-i', src, '-stream_loop', '-1', '-i', BED, '-filter_complex',
        `[0:a]${voice}[v];[1:a]volume=${BED_DB}dB,aresample=48000[b];[v][b]amix=inputs=2:duration=first:normalize=0`,
        ...codec, tmpOut);
    } else {
      ffmpeg('-i', src, '-af', voice, ...codec, tmpOut);
    }
    copyFileSync(tmpOut, dest);
    console.log(`${basename(dest)}: ${Number(m.input_i).toFixed(1)} → ${TARGET_LUFS} LUFS${flags.has('--calle') ? ' con calle' : ''}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

for (const file of inputs) process1(file);
