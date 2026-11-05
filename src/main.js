import { LoadingScreen } from './ui/LoadingScreen.js';
import { letraLista } from './ui/letra.js';
import { startControlsHelp } from './ui/ControlsHelp.js';
import { openDeveloperNote } from './ui/DeveloperNote.js';

const loading = new LoadingScreen();
try {
  await loading.stage('Preparando el juego…', 0);
  // Nada que dependa de la letra se crea antes de tenerla: ni el radar ni sus dibujos.
  await letraLista();
  const { Game } = await import('./core/game.js');
  const animaciones = new URLSearchParams(location.search).get('animaciones') === 'mixamo-preview'
    ? 'mixamo-game-preview' : 'default';
  // Los materiales de calle ya son los de todos: ?aspecto=realista queda para no caer en el modelo liviano guardado.
  const modeloRealista = new URLSearchParams(location.search).get('aspecto') === 'realista';
  const game = new Game(document.getElementById('game-canvas'), { animaciones, modeloRealista });
  await game.start(loading);
  startControlsHelp();
  openDeveloperNote(game);
} catch (error) { loading.error(error); }
