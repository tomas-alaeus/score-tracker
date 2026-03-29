// ── Pure math utilities ──
// No DOM or browser dependencies — safe to import in Node tests.

// SmoothDamp — matches Unity's Mathf.SmoothDamp behaviour.
// Returns { value, velocity } after one timestep of dt seconds.
export function smoothDamp(current, target, velocity, smoothTime, dt) {
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

// Fisher-Yates shuffle — mutates and returns the array.
export function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deceleration factor for the start-picker bounce phase.
// Returns 1 at decelStart, 0 at decelStart+decelDuration, clamped to [0,1].
export function spDecelFactor(elapsed, decelStart, decelDuration) {
  return Math.max(0, Math.min(1, 1 - (elapsed - decelStart) / decelDuration));
}

// Nearest-card finder — given a ball position and an array of { id, x, y } card centres,
// returns the card with the smallest Euclidean distance.
export function findNearestCard(ballX, ballY, cards) {
  let closest = null, minDist = Infinity;
  for (const c of cards) {
    const d = Math.hypot(ballX - c.x, ballY - c.y);
    if (d < minDist) { minDist = d; closest = c; }
  }
  return closest;
}
