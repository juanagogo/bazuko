import { Game } from './core/game.js';
import { preloadModels } from './utils/ModelCache.js';
import { loadWorldTextures } from './utils/TextureCache.js';
import { Splash } from './ui/Splash.js';

const canvas = document.getElementById('game-canvas');
const splash = new Splash();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Tramos de la barra: modelos 0-60 %, mundo/texturas 60-90 %, arranque/audio 90-100 %
const MODELS_END = 0.6;
const WORLD_END = 0.9;

async function boot() {
  // Precarga los GLB (versiones optimizadas) antes de crear el juego: el parseo ocurre aqui y no
  // durante el juego (evita tirones). Tope de 8 s: si tarda mas, se arranca igual con los fallbacks.
  await Promise.race([
    preloadModels(['vagabundo2.glb', 'bolsa.glb', 'lampara.glb', 'cambuche.glb', 'tm.glb', 'estacion.glb', 'car1.glb', 'car2.glb', 'semaforo.glb', 'contenedor.glb'],
      (f) => splash.set(f * MODELS_END, 'Cargando modelos...')),
    new Promise((r) => setTimeout(r, 8000))
  ]);
  // Texturas del suelo (pasto/calle/andén): tope de 4 s, si fallan se usan las procedurales
  await Promise.race([
    loadWorldTextures((f) => splash.set(MODELS_END + f * (WORLD_END - MODELS_END) * 0.3, 'Cargando texturas...')),
    new Promise((r) => setTimeout(r, 4000))
  ]);
  splash.set(MODELS_END, 'Creando el mundo...');
  await nextFrame(); await nextFrame(); // deja pintar la barra antes del trabajo síncrono pesado

  const game = new Game(canvas); // texturas procedurales, mundo, jugador, HUD
  splash.set(WORLD_END, 'Preparando audio...');
  await nextFrame();

  // Carga del guardado (IndexedDB/localStorage): tolerante a fallos, nunca bloquea el arranque
  let saved = null;
  try {
    saved = await Promise.race([game.save.load(), new Promise((r) => setTimeout(() => r(null), 4000))]);
  } catch (err) { console.warn('[boot] no se pudo cargar el guardado', err); }

  game.start(saved); // detrás del splash opaco: sin parpadeos
  await nextFrame(); await nextFrame(); // primer frame ya renderizado antes de descubrir
  await splash.finish();
}

boot().catch((err) => {
  console.error('[boot]', err);
  splash.error(err?.message || String(err));
});
