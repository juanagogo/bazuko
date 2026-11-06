#!/usr/bin/env node
// tools/voces/procesar.mjs
// Deja las voces listas para el juego: todas al mismo volumen y, si se pide, con la calle detrás para que una
// voz de ElevenLabs no llegue sobre el silencio de estudio que la delata junto a las grabaciones reales.
//
//   node tools/voces/procesar.mjs public/audio/roberto_n1.mp3 ...          igualar en su sitio (-16 LUFS)
//   node tools/voces/procesar.mjs --calle --recortar --mono --salida public/audio/voces bruto/*.mp3
//   node tools/voces/procesar.mjs --radio --recortar --mono --salida public/audio/voces bruto/operadora_radio_*.mp3
//   node tools/voces/procesar.mjs --megafono --calle --recortar --mono --salida public/audio/voces bruto/policia_a_megafono_*.mp3
//
// Las frases de public/audio/voces salen de src/data/vocesCalle.js: el nombre de cada archivo es el id de su frase.
// La calle entra en un punto distinto para cada archivo y con fundido, así no suenan todas sobre el mismo pito.
// Si loudnorm se queda corto (frases cortas, susurros), lo que falta se sube con un limitador.
//
// --calle     fondo de city_atmosphere_soun.opus a unos -42 LUFS, como el ruido de las grabaciones reales
// --recortar  quita el silencio del principio y del final
// --radio     banda de radio de patrulla (300–3400 Hz) con algo de saturación
// --megafono  banda de megáfono con un eco corto
// --salida d  escribe en d con el mismo nombre (sin ella, reemplaza el archivo)
// --mono      escribe mp3 mono (VBR -q 5): una voz no necesita estéreo y pesa la mitad
// --opus      escribe .opus mono a 48 kb/s en lugar de conservar el formato
// Necesita ffmpeg en el PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_LUFS = -16, TRUE_PEAK = -1.5, LRA = 11;
const BED_DB = -20; // city_atmosphere_soun.opus mide -22 LUFS: queda cerca de -42
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BED = join(ROOT, 'public', 'audio', 'city_atmosphere_soun.opus');
const FADE_IN = 0.06, FADE_OUT = 0.15; // la calle entra y sale suave, sin golpe al cortar

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--') && a !== '--salida'));
const outIndex = args.indexOf('--salida');
const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : null;
const inputs = args.filter((a, i) => !a.startsWith('--') && (outIndex < 0 || i !== outIndex + 1));
if (!inputs.length) {
  console.error('Uso: node tools/voces/procesar.mjs [--calle] [--recortar] [--radio|--megafono] [--mono|--opus] [--salida carpeta] archivos...');
  process.exit(1);
}

const ffmpeg = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
// loudnorm escribe su medición en stderr, incluso cuando todo sale bien.
const ffmpegErr = (...a) => spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...a], { encoding: 'utf8' }).stderr ?? '';
const duration = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
const BED_LENGTH = flags.has('--calle') ? duration(BED) : 0;

/** Sonoridad integrada de un archivo ya listo (LUFS). */
function loudness(file) {
  const log = ffmpegErr('-i', file, '-af', 'ebur128', '-f', 'null', '-');
  const m = [...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return m ? Number(m[1]) : NaN;
}

/** Punto de la calle donde empieza cada voz: fijo por nombre, para que no suenen todas sobre el mismo pito. */
function bedOffset(name) {
  const h = createHash('sha1').update(name).digest().readUInt32BE(0);
  return ((h / 0xffffffff) * BED_LENGTH).toFixed(3);
}

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
  const tmpVoice = join(tmp, 'voz.wav');
  const tmpOut = join(tmp, 'salida' + ext);
  try {
    const filters = shapeFilters();
    const m = measure(src, filters);
    const norm = `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}`
      + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    const mono = flags.has('--mono') || ext === '.opus';
    ffmpeg('-i', src, '-af', [...filters, norm, 'aresample=48000'].join(','), ...(mono ? ['-ac', '1'] : []), '-c:a', 'pcm_s16le', tmpVoice);
    // En una frase corta o un susurro, loudnorm lineal se queda corto para no pasarse del pico: se sube lo que falte
    // con un limitador en vez de dejar esa voz más baja que las demás.
    const missing = TARGET_LUFS - loudness(tmpVoice);
    if (Math.abs(missing) > 0.7) {
      const fixed = join(tmp, 'voz2.wav');
      ffmpeg('-i', tmpVoice, '-af', `volume=${missing.toFixed(2)}dB,alimiter=limit=${(10 ** (TRUE_PEAK / 20)).toFixed(3)}:attack=2:release=40:level=false`,
        '-c:a', 'pcm_s16le', fixed);
      copyFileSync(fixed, tmpVoice);
    }
    const codec = ext === '.opus' ? ['-ac', '1', '-c:a', 'libopus', '-b:a', '48k']
      : ['-c:a', 'libmp3lame', ...(mono ? ['-ac', '1', '-q:a', '5'] : ['-q:a', '2']), '-ar', '44100'];
    if (flags.has('--calle')) {
      const d = duration(tmpVoice);
      const bed = `volume=${BED_DB}dB,aresample=48000,atrim=start=${bedOffset(basename(src))}:duration=${d},asetpts=PTS-STARTPTS`
        + `,afade=t=in:d=${FADE_IN},afade=t=out:st=${Math.max(0, d - FADE_OUT).toFixed(3)}:d=${FADE_OUT}`;
      ffmpeg('-i', tmpVoice, '-stream_loop', '-1', '-i', BED, '-filter_complex',
        `[1:a]${bed}${mono ? ',pan=mono|c0=0.5*c0+0.5*c1' : ''}[b];[0:a][b]amix=inputs=2:duration=first:normalize=0`,
        ...codec, tmpOut);
    } else {
      ffmpeg('-i', tmpVoice, ...codec, tmpOut);
    }
    copyFileSync(tmpOut, dest);
    console.log(`${basename(dest)}: ${Number(m.input_i).toFixed(1)} → ${TARGET_LUFS} LUFS${flags.has('--calle') ? ' con calle' : ''}${mono ? ' mono' : ''}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

for (const file of inputs) process1(file);
