import { defineConfig } from 'vite';
import { existsSync, rmSync } from 'node:fs';
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

/**
 * Vite copia public/ entero a la carpeta de salida; después se retira lo que nadie carga. La carpeta sale de la
 * configuración (`root` y `build.outDir`), no de la carpeta desde donde se corre: con `--outDir` o desde otra carpeta
 * se limpiaba otro dist/ o la compilación fallaba sin models/personaje.
 */
export function distLigero() {
  let salida = resolve('dist');
  return {
    name: 'dist-ligero',
    apply: 'build',
    configResolved(config) { salida = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      for (const modelo of MODELOS_SIN_USO) rmSync(resolve(salida, modelo), { recursive: true, force: true });
      // Mallas de los personajes comprimidas sin pérdida: 37 MB de .bin pasan a unos 23 MB.
      const personaje = resolve(salida, 'models/personaje');
      if (!existsSync(personaje)) {
        this.warn?.(`sin ${personaje}: no hay mallas de personajes que comprimir`);
        return;
      }
      const { files, before, after } = await compressPaths([personaje]);
      this.info?.(`personajes: ${files} glTF, ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB`);
    }
  };
}

/**
 * Librerías que el juego solo pide con import(): hls.js para la radio en vivo y el cargador FBX
 * (con lo que solo él usa) cuando falta un GLB. Si entran en un bloque de librerías, ese bloque es
 * import estático del juego y se descargan en cada arranque.
 */
export const SOLO_A_DEMANDA = /node_modules[\\/](?:hls\.js[\\/]|three[\\/]examples[\\/]jsm[\\/](?:loaders[\\/]FBXLoader|libs[\\/]fflate|curves[\\/]NURBS))/;

/** Librerías en bloques propios: cambian poco y el navegador las conserva en caché entre versiones. */
export const BLOQUES_DE_LIBRERIAS = [
  { name: 'three', test: id => /node_modules[\\/]three[\\/]/.test(id) && !SOLO_A_DEMANDA.test(id) },
  { name: 'vendor', test: id => /node_modules[\\/]/.test(id) && !SOLO_A_DEMANDA.test(id) }
];

export default defineConfig({
  server: { port: 5173, open: !process.env.CI && !process.env.NO_OPEN },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rolldownOptions: {
      input: ['index.html', 'bolirana/index.html'],
      output: { codeSplitting: { groups: BLOQUES_DE_LIBRERIAS } }
    }
  },
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.ogg'],
  plugins: [distLigero()]
});
