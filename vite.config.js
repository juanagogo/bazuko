import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/** Recursos de public/ que el juego web no carga; el port C++ usa sus propias copias en cpp/public. */
export const MODELOS_SIN_USO = [
  'models/Edificio 1', 'models/Edificio 2', 'models/Edificio 3',
  'models/Arbol 1', 'models/Ave 1', 'models/Ave 2',
  'models/Rata', 'models/comida rapida', 'models/Silla plastica',
  'models/luminaria', 'models/mascota.fbx', 'models/pasto.fbx'
];

/** Vite copia public/ entero a dist/; después se retira lo que nadie carga. */
const distLigero = {
  name: 'dist-ligero',
  apply: 'build',
  closeBundle() {
    for (const modelo of MODELOS_SIN_USO) rmSync(resolve('dist', modelo), { recursive: true, force: true });
  }
};

export default defineConfig({
  server: { port: 5173, open: true },
  build: { target: 'esnext', outDir: 'dist' },
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.ogg'],
  plugins: [distLigero]
});
