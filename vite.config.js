import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { compressPaths } from './tools/personaje/comprimir-mallas.mjs';

/** Recursos de public/ que el juego web no carga; el port C++ usa sus propias copias en cpp/public. */
export const MODELOS_SIN_USO = [
  'models/Edificio 1', 'models/Edificio 2', 'models/Edificio 3',
  'models/Arbol 1', 'models/Ave 1', 'models/Ave 2',
  'models/Rata', 'models/comida rapida', 'models/Silla plastica',
  'models/luminaria', 'models/mascota.fbx', 'models/pasto.fbx',
  // Originales sin optimizar que solo usa el port C++ (sus .opt.glb viven en cpp/public).
  'models/ambulancia.glb', 'models/vehiculo_policia.glb', 'models/moto_policia.glb',
  'models/vehiculo1_new.glb', 'models/vehiculo2_new.glb',
  // Animaciones de combate: el juego carga sus .glb; los FBX quedan como fuente de tools/animaciones.
  ...['center-block', 'fallingdown', 'combat-jab-cross', 'combat-hit-head', 'combat-hit-body', 'combat-taunt',
    'assault-hook', 'assault-kick', 'assault-hit-react', 'assault-knockdown', 'assault-get-up'].map(name => `models/${name}.fbx`)
];

/** Vite copia public/ entero a dist/; después se retira lo que nadie carga. */
const distLigero = {
  name: 'dist-ligero',
  apply: 'build',
  async closeBundle() {
    for (const modelo of MODELOS_SIN_USO) rmSync(resolve('dist', modelo), { recursive: true, force: true });
    // Mallas de los personajes comprimidas sin pérdida: 37 MB de .bin pasan a unos 23 MB.
    const { files, before, after } = await compressPaths([resolve('dist/models/personaje')]);
    this.info?.(`personajes: ${files} glTF, ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB`);
  }
};

export default defineConfig({
  server: { port: 5173, open: !process.env.CI && !process.env.NO_OPEN },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: ['index.html', 'bolirana/index.html'],
      output: {
        // Librerías en bloques propios: cambian poco y el navegador las conserva en caché entre versiones.
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ }
          ]
        }
      }
    }
  },
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.ogg'],
  plugins: [distLigero]
});
