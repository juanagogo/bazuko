import '@fontsource/overpass/600.css';
import '@fontsource/overpass/800.css';
import '@fontsource/overpass/900.css';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { startControlsHelp } from './ui/ControlsHelp.js';
import { openDeveloperNote } from './ui/DeveloperNote.js';

// Desactivada temporalmente; cambiar a true para volver a mostrarla al iniciar.
const SHOW_DEVELOPER_NOTE = false;

const loading = new LoadingScreen();
try {
  await loading.stage('Preparando el juego…', 0);
  const { Game } = await import('./core/game.js');
  const game = new Game(document.getElementById('game-canvas'));
  if (new URLSearchParams(location.search).has('perf')) (await import('./core/PerfProbe.js')).installPerfProbe(game);
  await game.start(loading);
  startControlsHelp();
  if (SHOW_DEVELOPER_NOTE) openDeveloperNote(game);
} catch (error) { loading.error(error); }
