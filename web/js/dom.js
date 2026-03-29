// ── DOM helpers ──
// Centralised selectors so class-name changes only need to be made here.

export function getSlot(id) {
  return document.querySelector('.card-slot[data-id="' + id + '"]');
}

export function getCard(id) {
  const slot = getSlot(id);
  return slot ? slot.querySelector('.player-card') : null;
}

export function getScoreEl(id) {
  const card = getCard(id);
  return card ? card.querySelector('.score') : null;
}
