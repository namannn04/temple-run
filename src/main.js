import './styles.css';
import { Game } from './Game.js';

const game = new Game(document.getElementById('game'));
game.init().catch((err) => {
  console.error(err);
  const t = document.getElementById('loader-text');
  if (t) t.textContent = 'Failed to start: ' + err.message;
});
