import { defineConfig } from 'vite';

// BASE_PATH permite publicar en una subcarpeta, por ejemplo /bazuko/ en GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { port: 5173, open: !process.env.CI && !process.env.NO_OPEN },
  build: { target: 'esnext', outDir: 'dist' },
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.ogg']
});
