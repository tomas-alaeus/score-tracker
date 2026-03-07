import { GAMES } from './config.js';

export function saveState(currentGame, gameStartScore, players) {
  if (!currentGame) { localStorage.removeItem('st-state'); return; }
  localStorage.setItem('st-state', JSON.stringify({
    gameId: Object.keys(GAMES).find(k => GAMES[k] === currentGame),
    gameStartScore,
    players: players.map(({ id, name, score, rotation, color }) => ({ id, name, score, rotation, color })),
  }));
}

export function saveRotations(players) {
  localStorage.setItem('st-rotations', JSON.stringify(players.map(p => p.rotation)));
}

export function loadRotations() {
  try {
    const raw = localStorage.getItem('st-rotations');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

// Returns { game, gameStartScore, players } or null
export function restoreState() {
  try {
    const raw = localStorage.getItem('st-state');
    if (!raw) return null;
    const { gameId, gameStartScore, players } = JSON.parse(raw);
    const game = GAMES[gameId];
    if (!game) return null;
    return { game, gameStartScore, players };
  } catch (e) {
    localStorage.removeItem('st-state');
    return null;
  }
}
