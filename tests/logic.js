import { smoothDamp, shuffleArray, spDecelFactor, findNearestCard } from '../web/js/math.js';

let passed = 0, failed = 0;

function assert(desc, condition) {
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else            { console.error(`  ✗ ${desc}`); failed++; }
}
function near(a, b, tol = 0.001) { return Math.abs(a - b) < tol; }

// ── smoothDamp ──────────────────────────────────────────────────────────────
console.log('smoothDamp');
{
  const r = smoothDamp(0, 100, 0, 0.18, 0.016);
  assert('moves toward target on first step', r.value > 0 && r.value < 100);
  assert('generates positive velocity when behind target', r.velocity > 0);
}
{
  const r = smoothDamp(100, 100, 0, 0.18, 0.016);
  assert('stays put when already at target', near(r.value, 100));
  assert('velocity stays zero when already at target', near(r.velocity, 0));
}
{
  let v = 0, vel = 0;
  for (let i = 0; i < 300; i++) { const r = smoothDamp(v, 100, vel, 0.18, 0.016); v = r.value; vel = r.velocity; }
  assert('converges to target after many steps', near(v, 100));
}
{
  let v = 0, vel = 0, overshot = false;
  for (let i = 0; i < 300; i++) { const r = smoothDamp(v, 100, vel, 0.18, 0.016); v = r.value; vel = r.velocity; if (v > 100.001) overshot = true; }
  assert('never overshoots target', !overshot);
}
{
  // Works in both directions
  let v = 100, vel = 0;
  for (let i = 0; i < 300; i++) { const r = smoothDamp(v, 0, vel, 0.18, 0.016); v = r.value; vel = r.velocity; }
  assert('converges when moving downward', near(v, 0));
}

// ── shuffleArray ────────────────────────────────────────────────────────────
console.log('\nshuffleArray');
{
  const orig = [1, 2, 3, 4, 5];
  const shuffled = shuffleArray([...orig]);
  assert('preserves all elements', [...shuffled].sort((a,b)=>a-b).join() === orig.join());
  assert('returns the same array reference', shuffleArray(orig) === orig);
  // Very unlikely to stay identical across 20 shuffles
  let changed = false;
  for (let i = 0; i < 20; i++) { if (shuffleArray([1,2,3,4,5]).join() !== '1,2,3,4,5') { changed = true; break; } }
  assert('actually shuffles (probabilistic)', changed);
}

// ── spDecelFactor ───────────────────────────────────────────────────────────
console.log('\nspDecelFactor');
{
  assert('factor is 1 at decel start',       near(spDecelFactor(2, 2, 2), 1));
  assert('factor is 0.5 halfway through',    near(spDecelFactor(3, 2, 2), 0.5));
  assert('factor is 0 at decel end',         near(spDecelFactor(4, 2, 2), 0));
  assert('factor is clamped to 0 after end', spDecelFactor(5, 2, 2) === 0);
  assert('factor is 1 before decel starts',  near(spDecelFactor(1, 2, 2), 1));
}

// ── findNearestCard ─────────────────────────────────────────────────────────
console.log('\nfindNearestCard');
{
  const cards = [{ id: 1, x: 100, y: 100 }, { id: 2, x: 300, y: 300 }];
  assert('picks card 1 when ball is close to it', findNearestCard(120, 120, cards).id === 1);
  assert('picks card 2 when ball is close to it', findNearestCard(280, 280, cards).id === 2);
  assert('picks card when ball is exactly on it', findNearestCard(100, 100, cards).id === 1);
  assert('returns null for empty card list',       findNearestCard(0, 0, []) === null);
}
{
  // Equidistant — should return whichever comes first
  const cards = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 200, y: 0 }];
  assert('equidistant picks first card', findNearestCard(100, 0, cards).id === 1);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
