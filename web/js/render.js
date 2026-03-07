import { PLAYER_COLOR_VALUES } from './config.js';

export function renderTiles(games) {
  const presetsHtml = Object.entries(games).map(([id, game]) => {
    const vars = [
      `--tile-bg:${game.tile.bg}`,
      `--tile-border:${game.tile.border}`,
      `--tile-stripe:${game.tile.stripe}`,
      `--tile-name-color:${game.tile.nameColor}`,
      `--tile-hover-shadow:${game.tile.hoverShadow}`,
      `--tile-font:${game.tile.font}`,
    ].join(';');
    return `<button class="preset-btn" data-id="${id}" style="${vars}" onclick="selectPreset('${id}')">
      <div class="preset-stripe"></div>
      <span class="preset-emoji">${game.emoji}</span>
      <span class="preset-name">${game.name}</span>
    </button>`;
  }).join('');

  document.querySelector('.game-tiles').innerHTML = `
    <div class="presets-row">${presetsHtml}</div>
    <div id="game-config"></div>
    <button class="start-btn" onclick="startGame()">Start</button>
  `;
}

export function renderConfig(game, playerCount) {
  const el = document.getElementById('game-config');
  if (!el || !game) return;

  const playersField = game.minPlayers === game.maxPlayers
    ? `<span class="config-fixed">${game.minPlayers} (fixed)</span>`
    : `<div class="tile-stepper">
         <button class="stepper-btn" id="players-dec" onclick="stepPlayers(-1)"${playerCount <= game.minPlayers ? ' disabled' : ''}>−</button>
         <span class="stepper-val" id="players-val">${playerCount}</span>
         <button class="stepper-btn" id="players-inc" onclick="stepPlayers(1)"${playerCount >= game.maxPlayers ? ' disabled' : ''}>+</button>
       </div>`;

  const hpField = game.startField ? `
    <div class="config-row">
      <span class="tile-label">${game.startField}</span>
      <input class="tile-input" id="start-hp" type="number" min="1" max="999" value="${game.defaultStart}">
    </div>` : '';

  el.innerHTML = `
    <div class="config-row">
      <span class="tile-label">Players</span>
      ${playersField}
    </div>${hpField}
  `;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getLeaderId(players) {
  if (players.length === 0) return null;
  const max = Math.max(...players.map(p => p.score));
  const leaders = players.filter(p => p.score === max);
  return leaders.length === 1 ? leaders[0].id : null;
}

export function updateLeaderHighlight(players) {
  const leaderId = getLeaderId(players);
  document.querySelectorAll('.card-slot').forEach(slot => {
    const card = slot.querySelector('.player-card');
    if (card) card.classList.toggle('leading', parseFloat(slot.dataset.id) === leaderId);
  });
}

export function applyRotation(slot, card, deg) {
  const W = slot.clientWidth;
  const H = slot.clientHeight;
  if (deg === 90 || deg === 270) {
    card.style.width  = H + 'px';
    card.style.height = W + 'px';
    card.style.left   = ((W - H) / 2) + 'px';
    card.style.top    = ((H - W) / 2) + 'px';
  } else {
    card.style.width  = W + 'px';
    card.style.height = H + 'px';
    card.style.left   = '0';
    card.style.top    = '0';
  }
  card.style.transform = 'rotate(' + deg + 'deg)';
}

export function reapplyAllRotations(players) {
  players.forEach(p => {
    const slot = document.querySelector('.card-slot[data-id="' + p.id + '"]');
    const card = slot ? slot.querySelector('.player-card') : null;
    if (slot && card) applyRotation(slot, card, p.rotation);
  });
}

export function render(players, currentGame) {
  const leaderId = getLeaderId(players);
  const isDown = currentGame && currentGame.direction === 'down';

  const hasColors = !!(currentGame && currentGame.playerColors);

  const playersEl = document.getElementById('players');
  playersEl.dataset.count = players.length;

  playersEl.innerHTML = players.map(p => {
    const eliminated = isDown && p.score === 0;

    const colorIndicator = hasColors && p.color
      ? `<div class="color-indicator"><span class="color-dot" style="background:${escHtml(PLAYER_COLOR_VALUES[p.color] || '#888')}"></span><span class="color-name">${escHtml(p.color)}</span></div>`
      : '';

    const colorSwatches = hasColors
      ? `<div class="overlay-divider"></div>
          <div class="color-swatches">${currentGame.playerColors.map(c =>
            `<button class="color-swatch${p.color === c ? ' active' : ''}" data-color="${c}" style="background:${escHtml(PLAYER_COLOR_VALUES[c])}" onclick="setPlayerColor(${p.id},'${c}')"></button>`
          ).join('')}</div>
          <div class="overlay-hint">tap to change color</div>`
      : '';

    return `
      <div class="card-slot" data-id="${p.id}">
        <div class="player-card${p.id === leaderId ? ' leading' : ''}${eliminated ? ' eliminated' : ''}">
          <div class="elim-badge">ELIMINATED</div>
          <div class="card-overlay" onpointerdown="if(event.target===this)closeAllSettings()">
            <button class="overlay-rotate-btn" onclick="rotateFromOverlay(${p.id})">↻</button>
            <div class="overlay-hint">tap to rotate</div>
            ${colorSwatches}
          </div>
          <button class="settings-btn" onclick="openSettings(${p.id})">···</button>
          <div class="tap-zone tap-add"
            onpointerdown="startHold(event.pointerId,${p.id},1,this)"
            onpointerup="stopHold(event.pointerId)" onpointerleave="stopHold(event.pointerId)" onpointercancel="stopHold(event.pointerId)">
            <span class="delta-side delta-pos"></span>
            <div class="arrow-icon arrow-up"></div>
          </div>
          <div class="tap-zone tap-sub${eliminated ? ' disabled' : ''}"
            onpointerdown="if(!this.classList.contains('disabled'))startHold(event.pointerId,${p.id},-1,this)"
            onpointerup="stopHold(event.pointerId)" onpointerleave="stopHold(event.pointerId)" onpointercancel="stopHold(event.pointerId)">
            <div class="arrow-icon arrow-down"></div>
            <span class="delta-side delta-neg"></span>
          </div>
          <div class="score-wrap">
            <span class="score">${p.score}</span>
          </div>
          ${colorIndicator}
        </div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => reapplyAllRotations(players));
}
