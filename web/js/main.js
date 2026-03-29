import { GAMES, PLAYER_COLOR_VALUES } from './config.js';
import { render, renderTiles, renderConfig, reapplyAllRotations, updateLeaderHighlight, applyRotation, updateVpPool } from './render.js';
import { saveState, restoreState, saveRotations, loadRotations } from './persist.js';
import { getSlot, getCard, getScoreEl } from './dom.js';
import { smoothDamp, shuffleArray, spDecelFactor, findNearestCard, rotateVelocity } from './math.js';

// ── Constants ──

const DELTA = {
  VISIBLE_MS: 2000,   // how long the delta number stays on screen
};

const HOLD = {
  INITIAL_DELAY_MS:  400, // delay before first repeat fires
  START_INTERVAL_MS: 300, // initial repeat interval
  MIN_INTERVAL_MS:   60,  // fastest possible repeat rate
  DECAY:             0.8, // factor by which interval shrinks each repeat
};

const SP = {
  BALL_RADIUS:       78,      // picker circle radius in px (half of 156px diameter)
  DRAG_THRESHOLD:    8,       // px of movement before drag mode activates
  TRAIL_MAX:         20,      // max positions kept in flick trail
  TRAIL_WINDOW_MS:   120,     // how far back to look when computing flick velocity
  FLICK_MIN_DT:      0.01,    // minimum time window (s) for velocity calculation
  LAUNCH_MIN_SPEED:  250,     // minimum ball launch speed in px/s
  DECEL_START_S:     2,       // seconds after launch when deceleration begins
  DECEL_DURATION_S:  2,       // seconds the deceleration phase lasts
  BOUNCE_JITTER_DEG: 25,      // random angle perturbation on each wall bounce (degrees)
  FLASH_MS:          1000,    // flash duration before tap-glide starts
  TAP_GLIDE:         '0.65s', // CSS transition duration for tap-path glide
  SETTLE_REMOVE_MS: 1400,     // delay before removing picker after it settles (burst 0.75s + fade 0.5s + buffer)
  STAR_VISIBLE_MS:   5000,    // how long the winner star is shown
  STAR_FADE_MS:      700,     // winner star fade-out animation duration
};

const HAPTIC = {
  SCORE:   18,           // normal score change
  ZERO:    80,           // hitting zero in down-count mode
  ELIM:    [30, 40, 60], // elimination pattern
  BOUNCE:  12,           // ball hits wall
  WINNER:  [30, 60, 80], // winner selected
};

const MAX_DT = 0.05; // frame time cap in seconds — prevents huge jumps after tab switch

// ── State ──

let players = [];
let currentGame = null;
let gameStartScore = 0;
let vpPool = null;
let selectedGameId = Object.keys(GAMES)[0];
let selectedPlayerCount = GAMES[selectedGameId].defaultPlayers;

const holds = new Map(); // pointerId → { timeout, el }
const deltaTimers = {}; // id → { value, timer }
let spBounceState = null;

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
  const slot = getSlot(id);
  const card = getCard(id);
  if (slot && card) applyRotation(slot, card, p.rotation);
  saveRotations(players);
  saveState(currentGame, gameStartScore, vpPool, players);
}

window.addEventListener('resize', () => reapplyAllRotations(players));

// ── Settings overlay ──

function openSettings(id) {
  document.querySelectorAll('.player-card.settings-open').forEach(c => c.classList.remove('settings-open'));
  const card = getCard(id);
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
  const card = getCard(id);
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


function createPlayer(name, rotation = 0, color = null) {
  return { id: Date.now() + Math.random(), name, score: gameStartScore, rotation, color };
}

// ── Score ──

function changeScore(id, delta) {
  const p = players.find(p => p.id === id);
  if (!p) return;

  const isDown = currentGame && currentGame.direction === 'down';
  if (isDown && delta < 0 && p.score === 0) { vibrate(HAPTIC.ZERO); return; }

  p.score += delta;
  if (isDown && p.score < 0) p.score = 0;

  vibrate(isDown && p.score === 0 ? HAPTIC.ELIM : HAPTIC.SCORE);

  const card = getCard(id);
  if (card) {
    const scoreEl = getScoreEl(id);
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

function showDelta(id, delta) {
  if (!deltaTimers[id]) deltaTimers[id] = { value: 0, timer: null };
  const s = deltaTimers[id];
  s.value += delta;
  clearTimeout(s.timer);

  const el = document.getElementById('delta-' + id);
  if (!el) return;
  const v = s.value;

  if (v === 0) {
    el.style.opacity = '0'; s.value = 0; return;
  }

  el.textContent = v > 0 ? '+' + v : '' + v;
  el.classList.toggle('delta-pos', v > 0);
  el.classList.toggle('delta-neg', v < 0);
  el.style.opacity = '1';

  s.timer = setTimeout(() => {
    el.style.opacity = '0';
    s.value = 0;
  }, DELTA.VISIBLE_MS);
}

// ── Hold-to-repeat (per-pointer so multiple touches work independently) ──

function startHold(event, id, delta, el) {
  const pointerId = event.pointerId;
  stopHold(pointerId);
  if (el) el.classList.add('pressing');
  changeScore(id, delta);
  let interval = HOLD.START_INTERVAL_MS;
  const state = { el };
  holds.set(pointerId, state);
  state.timeout = setTimeout(function repeat() {
    if (!holds.has(pointerId)) return;
    changeScore(id, delta);
    interval = Math.max(HOLD.MIN_INTERVAL_MS, interval * HOLD.DECAY);
    state.timeout = setTimeout(repeat, interval);
  }, HOLD.INITIAL_DELAY_MS);
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
  const card = getCard(id);
  if (!card) return;
  card.classList.add(cls);
  if (cls === 'sp-highlight-win') {
    const star = document.createElement('span');
    star.className = 'sp-star';
    const scoreWrap = card.querySelector('.score-wrap');
    if (scoreWrap) scoreWrap.insertBefore(star, scoreWrap.firstChild);
    setTimeout(() => {
      star.classList.add('sp-star-out');
      setTimeout(() => star.remove(), SP.STAR_FADE_MS);
    }, SP.STAR_VISIBLE_MS);
  }
}

const SP_DICE_DOTS = [
  [[50,50]],                                                                    // 1
  [[72,28],[28,72]],                                                            // 2
  [[72,28],[50,50],[28,72]],                                                    // 3
  [[28,28],[72,28],[28,72],[72,72]],                                            // 4
  [[28,28],[72,28],[50,50],[28,72],[72,72]],                                    // 5
  [[28,28],[72,28],[28,50],[72,50],[28,72],[72,72]],                            // 6
];

function showStartPicker() {
  spHighlightCard(null);
  removeStartPicker();
  const dots = SP_DICE_DOTS[Math.floor(Math.random() * 6)];
  const dotsSvg = dots.map(([cx,cy]) => `<circle cx="${cx}" cy="${cy}" r="9" fill="currentColor"/>`).join('');
  const picker = document.createElement('div');
  picker.id = 'start-picker';
  picker.className = 'start-picker sp-idle';
  picker.innerHTML = `
    <div class="sp-ring"></div>
    <div class="sp-content">
      <svg class="sp-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="92" height="92" rx="18" fill="none" stroke="currentColor" stroke-width="7"/>
        ${dotsSvg}
      </svg>
    </div>`;
  picker.querySelector('.sp-icon').style.animationDelay = `-${Math.random() * 9}s`;
  picker.addEventListener('pointerdown', onSpPickerDown);
  document.getElementById('players').appendChild(picker);
  document.getElementById('randomize-btn').style.display = 'none';
}

function removeStartPicker() {
  if (spBounceState) {
    if (spBounceState.rafId) cancelAnimationFrame(spBounceState.rafId);
    spBounceState = null;
  }
  const el = document.getElementById('start-picker');
  if (el) el.remove();
  spHighlightCard(null);
  document.getElementById('randomize-btn').style.display = 'none';
}

function reopenStartPicker() {
  showStartPicker();
}

function onSpPickerDown(e) {
  const picker = document.getElementById('start-picker');
  if (!picker || spBounceState) return;
  e.preventDefault();
  picker.setPointerCapture(e.pointerId);

  const container = document.getElementById('players');
  const containerRect = container.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  let ballX = pickerRect.left + pickerRect.width / 2 - containerRect.left;
  let ballY = pickerRect.top + pickerRect.height / 2 - containerRect.top;
  const r = SP.BALL_RADIUS;

  let dragging = false;
  const trail = [];

  function onMove(me) {
    trail.push({ x: me.clientX, y: me.clientY, t: performance.now() });
    if (trail.length > SP.TRAIL_MAX) trail.shift();

    if (!dragging && Math.hypot(me.clientX - e.clientX, me.clientY - e.clientY) > SP.DRAG_THRESHOLD) {
      dragging = true;
      picker.style.left = ballX + 'px';
      picker.style.top = ballY + 'px';
      picker.style.transform = 'translate(-50%, -50%)';
      picker.className = 'start-picker sp-bouncing';
    }
    if (dragging) {
      const rect = container.getBoundingClientRect();
      ballX = Math.max(r, Math.min(rect.width  - r, me.clientX - rect.left));
      ballY = Math.max(r, Math.min(rect.height - r, me.clientY - rect.top));
      picker.style.left = ballX + 'px';
      picker.style.top  = ballY + 'px';
    }
  }

  function onUp() {
    picker.removeEventListener('pointermove', onMove);
    picker.removeEventListener('pointerup',    onUp);
    picker.removeEventListener('pointercancel', onUp);

    if (dragging) {
      const now = performance.now();
      const recent = trail.filter(p => now - p.t < SP.TRAIL_WINDOW_MS);
      let vx = 0, vy = 0;
      if (recent.length >= 2) {
        const first = recent[0], last = recent[recent.length - 1];
        const dt = (last.t - first.t) / 1000;
        if (dt > SP.FLICK_MIN_DT) { vx = (last.x - first.x) / dt; vy = (last.y - first.y) / dt; }
      }
      const spd = Math.hypot(vx, vy);
      if (spd < SP.LAUNCH_MIN_SPEED) {
        if (spd > 0.01) { const f = SP.LAUNCH_MIN_SPEED / spd; vx *= f; vy *= f; }
        else { const a = Math.random() * Math.PI * 2; vx = Math.cos(a) * SP.LAUNCH_MIN_SPEED; vy = Math.sin(a) * SP.LAUNCH_MIN_SPEED; }
      }
      launchSpBounce(ballX, ballY, vx, vy);
    } else {
      picker.className = 'start-picker sp-flash';
      vibrate(HAPTIC.SCORE);
      setTimeout(startSpTap, SP.FLASH_MS);
    }
  }

  picker.addEventListener('pointermove', onMove);
  picker.addEventListener('pointerup',    onUp);
  picker.addEventListener('pointercancel', onUp);
}

function startSpTap() {
  const picker = document.getElementById('start-picker');
  const container = document.getElementById('players');
  if (!picker || !container) return;

  const winner = players[Math.floor(Math.random() * players.length)];
  const slot = getSlot(winner.id);
  if (!slot) { spSettleWinner(null, winner.id); return; }

  const containerRect = container.getBoundingClientRect();
  const slotRect = slot.getBoundingClientRect();
  const targetX = slotRect.left + slotRect.width  / 2 - containerRect.left;
  const targetY = slotRect.top  + slotRect.height / 2 - containerRect.top;

  const pickerRect = picker.getBoundingClientRect();
  const startX = pickerRect.left + pickerRect.width  / 2 - containerRect.left;
  const startY = pickerRect.top  + pickerRect.height / 2 - containerRect.top;

  picker.style.left = startX + 'px';
  picker.style.top  = startY + 'px';
  picker.style.transform = 'translate(-50%, -50%)';
  picker.className = 'start-picker sp-bouncing';

  requestAnimationFrame(() => {
    picker.style.transition = `left ${SP.TAP_GLIDE} ease-in-out, top ${SP.TAP_GLIDE} ease-in-out`;
    picker.style.left = targetX + 'px';
    picker.style.top  = targetY + 'px';
  });

  picker.addEventListener('transitionend', () => {
    picker.style.transition = '';
    spSettleWinner(targetX, targetY);
  }, { once: true });
}

function launchSpBounce(x, y, vx, vy) {
  const picker = document.getElementById('start-picker');
  if (!picker) return;
  picker.style.left = x + 'px';
  picker.style.top  = y + 'px';
  picker.style.transform = 'translate(-50%, -50%)';
  picker.className = 'start-picker sp-bouncing';
  spBounceState = { x, y, vx, vy, startTime: performance.now(), lastTime: performance.now(), speedAt2s: null, rafId: null };
  spBounceState.rafId = requestAnimationFrame(animateSpBounce);
}

function animateSpBounce(now) {
  const state = spBounceState;
  if (!state) return;
  const picker = document.getElementById('start-picker');
  const container = document.getElementById('players');
  if (!picker || !container) { spBounceState = null; return; }

  const dt = Math.min((now - state.lastTime) / 1000, MAX_DT);
  state.lastTime = now;
  const elapsed = (now - state.startTime) / 1000;

  if (elapsed >= SP.DECEL_START_S) {
    if (!state.speedAt2s) state.speedAt2s = Math.hypot(state.vx, state.vy);
    const factor = spDecelFactor(elapsed, SP.DECEL_START_S, SP.DECEL_DURATION_S);
    const cur = Math.hypot(state.vx, state.vy);
    if (cur > 0) { const s = state.speedAt2s * factor / cur; state.vx *= s; state.vy *= s; }
  }

  state.x += state.vx * dt;
  state.y += state.vy * dt;

  const r = SP.BALL_RADIUS;
  const W = container.offsetWidth;
  const H = container.offsetHeight;
  let bounced = false;
  if (state.x < r)     { state.x = r;     state.vx =  Math.abs(state.vx); bounced = true; }
  if (state.x > W - r) { state.x = W - r; state.vx = -Math.abs(state.vx); bounced = true; }
  if (state.y < r)     { state.y = r;     state.vy =  Math.abs(state.vy); bounced = true; }
  if (state.y > H - r) { state.y = H - r; state.vy = -Math.abs(state.vy); bounced = true; }
  if (bounced) {
    const jitterDeg = (Math.random() * 2 - 1) * SP.BOUNCE_JITTER_DEG;
    ({ vx: state.vx, vy: state.vy } = rotateVelocity(state.vx, state.vy, jitterDeg));
    vibrate(HAPTIC.BOUNCE);
  }

  picker.style.left = state.x + 'px';
  picker.style.top  = state.y + 'px';

  if (elapsed >= SP.DECEL_START_S + SP.DECEL_DURATION_S) {
    spSettleWinner(state.x, state.y);
    return;
  }
  state.rafId = requestAnimationFrame(animateSpBounce);
}

function spSettleWinner(x, y) {
  spBounceState = null;
  const container = document.getElementById('players');
  const containerRect = container ? container.getBoundingClientRect() : null;
  const cards = players.map(p => {
    const slot = getSlot(p.id);
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    return { id: p.id, x: r.left + r.width / 2 - (containerRect ? containerRect.left : 0), y: r.top + r.height / 2 - (containerRect ? containerRect.top : 0) };
  }).filter(Boolean);
  const nearest = findNearestCard(x, y, cards);
  const closest = nearest ? players.find(p => p.id === nearest.id) : null;

  if (closest) { spHighlightCard(closest.id, 'sp-highlight-win'); vibrate(HAPTIC.WINNER); }

  const picker = document.getElementById('start-picker');
  if (picker) {
    picker.className = 'start-picker sp-settled';
    setTimeout(() => {
      const p = document.getElementById('start-picker');
      if (p) p.remove();
      document.getElementById('randomize-btn').style.display = 'block';
    }, SP.SETTLE_REMOVE_MS);
  }
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
