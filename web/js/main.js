import { GAMES, PLAYER_COLOR_VALUES } from './config.js';
import { render, renderTiles, renderConfig, reapplyAllRotations, updateLeaderHighlight, applyRotation, updateVpPool } from './render.js';
import { saveState, restoreState, saveRotations, loadRotations } from './persist.js';

// ── State ──

let players = [];
let currentGame = null;
let gameStartScore = 0;
let vpPool = null;
let selectedGameId = Object.keys(GAMES)[0];
let selectedPlayerCount = GAMES[selectedGameId].defaultPlayers;

const holds = new Map(); // pointerId → { timeout, el }
const deltaState = {};

// ── Wake lock ──

let wakeLock = null;

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not supported or denied — fail silently */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (currentGame && document.visibilityState === 'visible') requestWakeLock();
});

// ── Theme ──

function applyTheme(theme) {
  const s = document.documentElement.style;
  for (const [prop, val] of Object.entries(theme)) s.setProperty(prop, val);
}

function resetTheme() {
  ['--bg', '--card-bg', '--border', '--accent', '--text', '--game-font'].forEach(p =>
    document.documentElement.style.removeProperty(p)
  );
}

// ── Views ──

function selectPreset(id) {
  const game = GAMES[id];
  if (!game) return;
  if (id !== selectedGameId) {
    selectedGameId = id;
    selectedPlayerCount = game.defaultPlayers;
  }
  document.querySelectorAll('.preset-btn').forEach(btn =>
    btn.classList.toggle('selected', btn.dataset.id === id)
  );
  renderConfig(game, selectedPlayerCount);
}

function startGame() {
  const id = selectedGameId;
  const game = GAMES[id];
  if (!game) return;
  currentGame = game;

  const count = selectedPlayerCount;

  gameStartScore = game.defaultStart;
  const hpInput = document.getElementById('start-hp');
  if (hpInput) gameStartScore = Math.max(1, parseInt(hpInput.value) || game.defaultStart);

  applyTheme(game.theme);
  document.getElementById('game-title').textContent = `${game.name} ${game.emoji}`;

  const savedRotations = loadRotations();
  const shuffledColors = game.playerColors ? shuffleArray([...game.playerColors]) : [];
  players = [];
  for (let i = 0; i < count; i++) {
    const rotation = savedRotations[i] ?? (i === 0 ? 180 : 0);
    const color = shuffledColors[i] ?? null;
    players.push(createPlayer('Player ' + (i + 1), rotation, color));
  }
  vpPool = game.vpTokens ? 12 * count : null;

  document.getElementById('game-select').style.display = 'none';
  document.getElementById('game-play').style.display = 'flex';
  requestWakeLock();
  render(players, currentGame);
  if (vpPool !== null) updateVpPool(vpPool, 12 * players.length);
  if (currentGame.randomizeStart) showStartPicker();
  saveState(currentGame, gameStartScore, vpPool, players);
}

function backToSelect() {
  releaseWakeLock();
  resetTheme();
  removeStartPicker();
  players = [];
  currentGame = null;
  gameStartScore = 0;
  vpPool = null;
  document.getElementById('game-play').style.display = 'none';
  document.getElementById('game-select').style.display = '';
  saveState(currentGame, gameStartScore, vpPool, players);
}

// ── Player count steppers ──

function stepPlayers(delta) {
  const game = GAMES[selectedGameId];
  const next = Math.max(game.minPlayers, Math.min(game.maxPlayers, selectedPlayerCount + delta));
  selectedPlayerCount = next;
  document.getElementById('players-val').textContent = next;
  document.getElementById('players-dec').disabled = next <= game.minPlayers;
  document.getElementById('players-inc').disabled = next >= game.maxPlayers;
}

// ── Rotation ──

function toggleRotate(id) {
  const p = players.find(p => p.id === id);
  if (!p) return;
  p.rotation = (p.rotation + 90) % 360;
  const slot = document.querySelector('.card-slot[data-id="' + id + '"]');
  const card = slot ? slot.querySelector('.player-card') : null;
  if (slot && card) applyRotation(slot, card, p.rotation);
  saveRotations(players);
  saveState(currentGame, gameStartScore, vpPool, players);
}

window.addEventListener('resize', () => reapplyAllRotations(players));

// ── Settings overlay ──

function openSettings(id) {
  document.querySelectorAll('.player-card.settings-open').forEach(c => c.classList.remove('settings-open'));
  const slot = document.querySelector('.card-slot[data-id="' + id + '"]');
  const card = slot ? slot.querySelector('.player-card') : null;
  if (card) card.classList.add('settings-open');
}

function closeAllSettings() {
  document.querySelectorAll('.player-card.settings-open').forEach(c => c.classList.remove('settings-open'));
}

function rotateFromOverlay(id) {
  toggleRotate(id);
}

function setPlayerColor(id, color) {
  const p = players.find(p => p.id === id);
  if (!p || !currentGame || !currentGame.playerColors) return;
  p.color = color;
  const slot = document.querySelector('.card-slot[data-id="' + id + '"]');
  const card = slot ? slot.querySelector('.player-card') : null;
  if (card) {
    const dot = card.querySelector('.color-dot');
    if (dot) dot.style.background = PLAYER_COLOR_VALUES[color] || '#888';
    const nameEl = card.querySelector('.color-name');
    if (nameEl) nameEl.textContent = color;
    card.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === color);
    });
  }
  saveState(currentGame, gameStartScore, vpPool, players);
}

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.card-overlay') && !e.target.closest('.settings-btn')) closeAllSettings();
});

// ── Players ──

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createPlayer(name, rotation = 0, color = null) {
  return { id: Date.now() + Math.random(), name, score: gameStartScore, rotation, color };
}

// ── Score ──

function changeScore(id, delta) {
  const p = players.find(p => p.id === id);
  if (!p) return;

  const isDown = currentGame && currentGame.direction === 'down';
  if (isDown && delta < 0 && p.score === 0) { vibrate(80); return; }

  p.score += delta;
  if (isDown && p.score < 0) p.score = 0;

  vibrate(isDown && p.score === 0 ? [30, 40, 60] : 18);

  const slot = document.querySelector('.card-slot[data-id="' + id + '"]');
  const card = slot ? slot.querySelector('.player-card') : null;
  if (card) {
    const scoreEl = card.querySelector('.score');
    if (scoreEl) {
      scoreEl.textContent = p.score;
      scoreEl.classList.remove('score-bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('score-bump');
    }
    const eliminated = isDown && p.score === 0;
    card.classList.toggle('eliminated', eliminated);
    const tapSub = card.querySelector('.tap-sub');
    if (tapSub) tapSub.classList.toggle('disabled', eliminated);
  }

  if (currentGame && currentGame.vpTokens && vpPool !== null) {
    vpPool -= delta;
    updateVpPool(vpPool, 12 * players.length);
  }

  updateLeaderHighlight(players);
  showDelta(id, delta);
  saveState(currentGame, gameStartScore, vpPool, players);
}

// ── Delta display ──

function getFarSideOffset(event, card) {
  const rect = card.getBoundingClientRect();
  const cardW = card.offsetWidth;
  const cardH = card.offsetHeight;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;

  // Rotate far-side direction from screen space into card local space.
  // CSS rotate(R) maps local→screen as: sx = lx·cos(R) - ly·sin(R), sy = lx·sin(R) + ly·cos(R)
  // Inverse: lx = sx·cos(R) + sy·sin(R), ly = -sx·sin(R) + sy·cos(R)
  const R = (parseFloat(card.dataset.rotation) || 0) * Math.PI / 180;
  const fdx = -dx, fdy = -dy;
  const localX = fdx * Math.cos(R) + fdy * Math.sin(R);
  const localY = -fdx * Math.sin(R) + fdy * Math.cos(R);

  const mag = Math.sqrt(localX * localX + localY * localY);
  if (mag < 1) return { x: 0, y: -(cardH * 0.38) };

  const nx = localX / mag, ny = localY / mag;

  // Scale to 75% of the way to the card edge in the local direction.
  const hw = cardW / 2, hh = cardH / 2;
  const tx = Math.abs(nx) > 0.001 ? hw / Math.abs(nx) : Infinity;
  const ty = Math.abs(ny) > 0.001 ? hh / Math.abs(ny) : Infinity;
  const t = Math.min(tx, ty) * 0.65;

  return { x: nx * t, y: ny * t };
}

// SmoothDamp — matches Unity's Mathf.SmoothDamp behaviour.
function smoothDamp(current, target, velocity, smoothTime, dt) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  let newVel = (velocity - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  // Prevent overshoot
  if ((target - current > 0) === (out > target)) { out = target; newVel = 0; }
  return { value: out, velocity: newVel };
}

function animateDelta(id) {
  const s = deltaState[id];
  if (!s) return;
  const slot = document.querySelector('.card-slot[data-id="' + id + '"]');
  const card = slot ? slot.querySelector('.player-card') : null;
  const anchor = card ? card.querySelector('.delta-anchor') : null;
  if (!anchor) { s.rafId = null; return; }

  const now = performance.now();
  const dt = Math.min((now - s.lastTime) / 1000, 0.05);
  s.lastTime = now;

  const rx = smoothDamp(s.cur.x, s.offset.x, s.vel.x, 0.18, dt);
  const ry = smoothDamp(s.cur.y, s.offset.y, s.vel.y, 0.18, dt);
  s.cur.x = rx.value; s.vel.x = rx.velocity;
  s.cur.y = ry.value; s.vel.y = ry.velocity;

  anchor.style.transform = `translate(calc(-50% + ${s.cur.x}px), calc(-50% + ${s.cur.y}px))`;

  if (Math.abs(s.offset.x - s.cur.x) > 0.5 || Math.abs(s.offset.y - s.cur.y) > 0.5) {
    s.rafId = requestAnimationFrame(() => animateDelta(id));
  } else {
    s.cur.x = s.offset.x; s.cur.y = s.offset.y;
    anchor.style.transform = `translate(calc(-50% + ${s.offset.x}px), calc(-50% + ${s.offset.y}px))`;
    s.rafId = null;
  }
}

function showDelta(id, delta) {
  if (!deltaState[id]) deltaState[id] = { value: 0, timer: null, offset: { x: 0, y: 0 }, cur: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, rafId: null, lastTime: 0 };
  const s = deltaState[id];
  s.value += delta;
  clearTimeout(s.timer);

  const slot = document.querySelector('.card-slot[data-id="' + id + '"]');
  const card = slot ? slot.querySelector('.player-card') : null;
  if (!card) return;

  const anchor = card.querySelector('.delta-anchor');
  if (!anchor) return;
  const v = s.value;

  if (v === 0) {
    if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = null; }
    anchor.style.transition = 'none'; anchor.style.opacity = '0'; s.value = 0; return;
  }

  const wasVisible = parseFloat(anchor.style.opacity || '0') > 0;
  if (!wasVisible) {
    // First appearance — snap to position immediately.
    s.cur.x = s.offset.x; s.cur.y = s.offset.y;
    s.vel.x = 0; s.vel.y = 0;
    if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = null; }
    anchor.style.transform = `translate(calc(-50% + ${s.offset.x}px), calc(-50% + ${s.offset.y}px))`;
  } else if (!s.rafId) {
    // Already visible and target changed — smoothly slide to new position.
    s.lastTime = performance.now();
    s.rafId = requestAnimationFrame(() => animateDelta(id));
  }
  // If rafId is already running it will pick up the updated s.offset automatically.

  anchor.style.transition = 'none';
  anchor.style.opacity = '1';
  anchor.textContent = v > 0 ? '+' + v : '' + v;
  anchor.classList.toggle('delta-pos', v > 0);
  anchor.classList.toggle('delta-neg', v < 0);

  s.timer = setTimeout(() => {
    if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = null; }
    anchor.style.transition = 'opacity 0.4s ease';
    anchor.style.opacity = '0';
    s.value = 0;
  }, 2000);
}

// ── Hold-to-repeat (per-pointer so multiple touches work independently) ──

function startHold(event, id, delta, el) {
  const pointerId = event.pointerId;
  stopHold(pointerId);
  if (el) el.classList.add('pressing');
  const card = el.closest('.player-card');
  const offset = getFarSideOffset(event, card);
  if (!deltaState[id]) deltaState[id] = { value: 0, timer: null, offset, cur: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, rafId: null, lastTime: 0 };
  else deltaState[id].offset = offset;
  changeScore(id, delta);
  let interval = 300;
  const minInterval = 60;
  const state = { el };
  holds.set(pointerId, state);
  state.timeout = setTimeout(function repeat() {
    if (!holds.has(pointerId)) return;
    changeScore(id, delta);
    interval = Math.max(minInterval, interval * 0.8);
    state.timeout = setTimeout(repeat, interval);
  }, 400);
}

function stopHold(pointerId) {
  const state = holds.get(pointerId);
  if (state) {
    clearTimeout(state.timeout);
    if (state.el) state.el.classList.remove('pressing');
    holds.delete(pointerId);
  }
}

// ── Fullscreen ──

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('fullscreen-btn');
  if (btn) btn.textContent = document.fullscreenElement ? '⤡' : '⤢';
});

// ── Haptics ──

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ── Start picker (first player randomizer) ──

function spHighlightCard(id, cls) {
  document.querySelectorAll('.player-card.sp-highlight, .player-card.sp-highlight-win')
    .forEach(c => c.classList.remove('sp-highlight', 'sp-highlight-win'));
  document.querySelectorAll('.sp-star').forEach(s => s.remove());
  if (id == null) return;
  const slot = document.querySelector('.card-slot[data-id="' + id + '"]');
  const card = slot ? slot.querySelector('.player-card') : null;
  if (!card) return;
  card.classList.add(cls);
  if (cls === 'sp-highlight-win') {
    const star = document.createElement('span');
    star.className = 'sp-star';
    star.textContent = '★';
    const scoreWrap = card.querySelector('.score-wrap');
    if (scoreWrap) scoreWrap.insertBefore(star, scoreWrap.firstChild);
    setTimeout(() => {
      star.classList.add('sp-star-out');
      setTimeout(() => star.remove(), 700);
    }, 5000);
  }
}

function showStartPicker() {
  spHighlightCard(null);
  removeStartPicker();
  const picker = document.createElement('div');
  picker.id = 'start-picker';
  picker.className = 'start-picker sp-idle';
  picker.innerHTML = `
    <div class="sp-ring"></div>
    <div class="sp-content">
      <span class="sp-icon">?</span>
    </div>`;
  picker.addEventListener('pointerdown', onStartPickerClick);
  document.getElementById('players').appendChild(picker);
  document.getElementById('randomize-btn').style.display = 'none';
}

function removeStartPicker() {
  const el = document.getElementById('start-picker');
  if (el) el.remove();
  spHighlightCard(null);
  document.getElementById('randomize-btn').style.display = 'none';
}

function reopenStartPicker() {
  showStartPicker();
}

function onStartPickerClick() {
  const picker = document.getElementById('start-picker');
  if (!picker || picker.classList.contains('sp-spinning')) return;
  vibrate(30);

  const winnerIdx = Math.floor(Math.random() * players.length);
  const winnerId = players[winnerIdx].id;

  picker.className = 'start-picker sp-spinning';

  const delays = [45, 45, 45, 55, 55, 70, 90, 115, 150, 200, 265, 340, 430];
  let i = 0, idx = 0;

  spHighlightCard(players[0].id, 'sp-highlight');

  function tick() {
    if (i >= delays.length) {
      // Settle: light up winner, burst the picker, then hide it
      spHighlightCard(winnerId, 'sp-highlight-win');
      picker.className = 'start-picker sp-settled';
      vibrate([30, 60, 80]);
      setTimeout(() => {
        const p = document.getElementById('start-picker');
        if (p) p.remove();
        document.getElementById('randomize-btn').style.display = 'block';
      }, 800);
      return;
    }
    idx = (idx + 1) % players.length;
    spHighlightCard(players[idx].id, 'sp-highlight');
    setTimeout(tick, delays[i++]);
  }
  tick();
}

// ── Expose to inline HTML event handlers ──

Object.assign(window, {
  startGame, backToSelect, selectPreset, stepPlayers, toggleFullscreen,
  startHold, stopHold, openSettings, closeAllSettings, rotateFromOverlay, setPlayerColor,
  reopenStartPicker,
});

// ── Init ──

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

renderTiles(GAMES);
selectPreset(selectedGameId);

const saved = restoreState();
if (saved) {
  currentGame = saved.game;
  gameStartScore = saved.gameStartScore;
  players = saved.players;
  applyTheme(saved.game.theme);
  document.getElementById('game-title').textContent = `${saved.game.name} ${saved.game.emoji}`;
  document.getElementById('game-select').style.display = 'none';
  document.getElementById('game-play').style.display = 'flex';
  requestWakeLock();
  render(players, currentGame);
  if (saved.game.vpTokens) {
    vpPool = saved.vpPool ?? (12 * players.length - players.reduce((s, p) => s + (p.score - gameStartScore), 0));
    updateVpPool(vpPool, 12 * players.length);
  }
  if (saved.game.randomizeStart) showStartPicker();
}
