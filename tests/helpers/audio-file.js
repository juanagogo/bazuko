import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const LFS_POINTER = 'version https://git-lfs.github.com/spec/';

/** Archivos de public/audio que siguen siendo punteros de Git LFS (no se descargó el audio). */
export function audioLfsPendiente() {
  const dir = new URL('../../public/audio/', import.meta.url);
  // Solo los archivos sueltos: las voces de public/audio/voces son mp3 normales, fuera de LFS.
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).filter((file) => {
    const head = readFileSync(new URL(encodeURIComponent(file), dir)).subarray(0, LFS_POINTER.length).toString('ascii');
    return head === LFS_POINTER;
  });
}

/**
 * Sin los WAV de Git LFS estas pruebas leerían punteros de texto en lugar de audio. Fuera de CI se saltan con
 * la instrucción para descargarlos; en CI fallan, porque allí el flujo siempre debe descargarlos.
 */
export function saltarSinAudioLfs(t) {
  const pendientes = audioLfsPendiente();
  if (!pendientes.length) return false;
  const aviso = `Faltan ${pendientes.length} audios de Git LFS (${pendientes.join(', ')}): ejecute git lfs pull --include="public/audio/*"`;
  if (process.env.CI) assert.fail(aviso);
  t.skip(aviso);
  return true;
}

/** Lee metadatos del contenedor real; no sustituye probar la decodificación en el navegador. */
export function audioMetadata(buffer) {
  if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer.readUInt16BE(0) & 0xffe0) === 0xffe0) {
    let offset = 0, duration = 0, frames = 0;
    if (buffer.toString('ascii', 0, 3) === 'ID3') {
      offset = 10 + ((buffer[6] & 127) << 21) + ((buffer[7] & 127) << 14) + ((buffer[8] & 127) << 7) + (buffer[9] & 127);
      if (buffer[5] & 16) offset += 10;
    }
    while (offset + 4 <= buffer.length) {
      const header = buffer.readUInt32BE(offset), version = (header >>> 19) & 3;
      const layer = (header >>> 17) & 3, rate = (header >>> 10) & 3, bitrate = (header >>> 12) & 15;
      if ((header >>> 21) !== 0x7ff || version === 1 || layer !== 1 || rate === 3 || bitrate === 0 || bitrate === 15) { offset++; continue; }
      const sampleRate = [44100, 48000, 32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
      const kbps = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrate];
      const length = Math.floor((version === 3 ? 144 : 72) * kbps * 1000 / sampleRate) + ((header >>> 9) & 1);
      assert.ok(offset + length <= buffer.length, 'Trama MP3 completa');
      duration += (version === 3 ? 1152 : 576) / sampleRate;
      frames++; offset += length;
    }
    assert.ok(frames > 0 && duration > 0, 'MP3 contiene tramas de audio');
    return { format: 'mp3', duration };
  }
  if (buffer.toString('ascii', 0, 4) === 'OggS') {
    let offset = 0, samples = 0n, preSkip, end = false;
    while (offset < buffer.length) {
      assert.equal(buffer.toString('ascii', offset, offset + 4), 'OggS');
      const segments = buffer[offset + 26];
      const body = offset + 27 + segments;
      let size = 0;
      for (let i = 0; i < segments; i++) size += buffer[offset + 27 + i];
      assert.ok(body + size <= buffer.length, 'Página Ogg completa');
      if (offset === 0) {
        assert.equal(buffer.toString('ascii', body, body + 8), 'OpusHead');
        preSkip = buffer.readUInt16LE(body + 10);
      }
      const granule = buffer.readBigUInt64LE(offset + 6);
      if (granule !== 0xffffffffffffffffn && granule > samples) samples = granule;
      end ||= !!(buffer[offset + 5] & 4);
      offset = body + size;
    }
    assert.ok(end, 'El archivo Opus tiene una página de cierre');
    const duration = (Number(samples) - preSkip) / 48000;
    assert.ok(duration > 0 && Number.isFinite(duration));
    return { format: 'opus', duration };
  }
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');
  let offset = 12, byteRate, dataSize;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4), name = buffer.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (name === 'data') dataSize = size;
    offset += 8 + size + size % 2;
  }
  const duration = dataSize / byteRate;
  assert.ok(duration > 0 && Number.isFinite(duration));
  return { format: 'wav', duration };
}
