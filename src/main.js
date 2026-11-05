import '@fontsource/overpass/600.css';
import '@fontsource/overpass/800.css';
import '@fontsource/overpass/900.css';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { startControlsHelp } from './ui/ControlsHelp.js';
import { openDeveloperNote } from './ui/DeveloperNote.js';
import { installErrorScreen } from './ui/ErrorScreen.js';

const loading = new LoadingScreen();
try {
  await loading.stage('Preparando el juego…', 0);
  const { Game } = await import('./core/game.js');
  const canvas = document.getElementById('game-canvas');
  const game = new Game(canvas);
  installErrorScreen({ canvas, game });
  await game.start(loading);
  startControlsHelp();
  openDeveloperNote(game);
} catch (error) { loading.error(error); }
