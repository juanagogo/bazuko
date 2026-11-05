import { defineConfig } from 'vite';

// BASE_PATH permite publicar en una subcarpeta, por ejemplo /bazuko/ en GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { port: 5173, open: !process.env.CI && !process.env.NO_OPEN },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rolldownOptions: {
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
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.ogg']
});
