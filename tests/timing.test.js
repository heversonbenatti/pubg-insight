/**
 * tests/timing.test.js
 *
 * Tests for the two timing conversion strategies used in replay2d.js:
 *   1. dMsToElapsed(dMs)  — binary-search interpolation over gsTimeline
 *   2. wallClockDelta     — (killEvent._D - matchStartMs) / 1000  (used for deaths)
 *
 * Both are extracted here as pure functions so they can be unit-tested
 * without a browser or canvas.
 */

import { test, assert } from './helpers.js';

// ── Pure re-implementation of dMsToElapsed (mirrors replay2d.js exactly) ─────

function buildDMsToElapsed(gsTimeline) {
  // gsTimeline: [{dMs, elapsed}] sorted by dMs ascending
  const sorted = [...gsTimeline].sort((a, b) => a.dMs - b.dMs);

  return function dMsToElapsed(dMs) {
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].dMs < dMs) lo = mid + 1; else hi = mid;
    }
    if (lo === 0) return sorted[0].elapsed;
    const prev = sorted[lo - 1], next = sorted[lo];
    const ratio = (dMs - prev.dMs) / (next.dMs - prev.dMs);
    return prev.elapsed + (next.elapsed - prev.elapsed) * ratio;
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// A minimal gsTimeline: 5 entries, each 10 real-time seconds apart,
// elapsed starts at 10 (reflecting the ~10s gsTimeline delay noted in the project).
const BASE_MS = 1_700_000_000_000; // arbitrary epoch
const gsTimeline = [
  { dMs: BASE_MS + 10_000,  elapsed: 10  },
  { dMs: BASE_MS + 20_000,  elapsed: 20  },
  { dMs: BASE_MS + 30_000,  elapsed: 30  },
  { dMs: BASE_MS + 40_000,  elapsed: 40  },
  { dMs: BASE_MS + 50_000,  elapsed: 50  },
];

const dMsToElapsed = buildDMsToElapsed(gsTimeline);

// ── dMsToElapsed tests ────────────────────────────────────────────────────────

test('dMsToElapsed: exact keyframe dMs returns its elapsed value', () => {
  assert.closeTo(dMsToElapsed(BASE_MS + 10_000), 10, 0.001);
  assert.closeTo(dMsToElapsed(BASE_MS + 30_000), 30, 0.001);
  assert.closeTo(dMsToElapsed(BASE_MS + 50_000), 50, 0.001);
});

test('dMsToElapsed: midpoint between two keyframes is interpolated correctly', () => {
  // Midpoint between t=10 (elapsed 10) and t=20 (elapsed 20) → elapsed 15
  assert.closeTo(dMsToElapsed(BASE_MS + 15_000), 15, 0.001);
  assert.closeTo(dMsToElapsed(BASE_MS + 25_000), 25, 0.001);
});

test('dMsToElapsed: 25% between two keyframes', () => {
  // 25% between t=20 and t=30 → elapsed 22.5
  assert.closeTo(dMsToElapsed(BASE_MS + 22_500), 22.5, 0.001);
});

test('dMsToElapsed: before first keyframe returns first elapsed (clamped)', () => {
  // dMs before any entry → should return first elapsed (10), not crash
  const result = dMsToElapsed(BASE_MS + 0);
  assert.closeTo(result, 10, 0.001);
});

test('dMsToElapsed: beyond last keyframe extrapolates (or returns last)', () => {
  // Beyond last entry — the current implementation clamps to last via binary search
  // landing on lo === length-1, then lo-1 and lo are the last two entries.
  // elapsed 50 + ratio*(50-40)/1 is OK; just must not crash and must be >= 50.
  const result = dMsToElapsed(BASE_MS + 60_000);
  assert.ok(result >= 50, `Expected >= 50, got ${result}`);
});

test('dMsToElapsed: single-entry timeline always returns that elapsed', () => {
  const single = buildDMsToElapsed([{ dMs: BASE_MS, elapsed: 42 }]);
  assert.closeTo(single(BASE_MS - 5000), 42, 0.001);
  assert.closeTo(single(BASE_MS),         42, 0.001);
  assert.closeTo(single(BASE_MS + 9999),  42, 0.001);
});

test('dMsToElapsed: timeline with unsorted input still works (sort is applied)', () => {
  const unsorted = [
    { dMs: BASE_MS + 30_000, elapsed: 30 },
    { dMs: BASE_MS + 10_000, elapsed: 10 },
    { dMs: BASE_MS + 20_000, elapsed: 20 },
  ];
  const fn = buildDMsToElapsed(unsorted);
  assert.closeTo(fn(BASE_MS + 15_000), 15, 0.001);
});

// ── wallClockDelta death timing ───────────────────────────────────────────────
// Deaths use (killEvent._D - matchStartMs) / 1000 because kill _D timestamps
// are themselves ~10s delayed, which cancels out the elapsedTime offset.

function deathElapsed(killDMs, matchStartMs) {
  return (killDMs - matchStartMs) / 1000;
}

test('wallClockDelta: simple death elapsed calculation', () => {
  const matchStart = BASE_MS;
  const killEvent  = BASE_MS + 120_000; // 120 real seconds in
  assert.closeTo(deathElapsed(killEvent, matchStart), 120, 0.001);
});

test('wallClockDelta: death at match start returns 0', () => {
  assert.closeTo(deathElapsed(BASE_MS, BASE_MS), 0, 0.001);
});

test('wallClockDelta: negative result if kill before matchStart (edge case guard)', () => {
  // Should never happen in real data; just ensure the formula doesn't crash.
  const result = deathElapsed(BASE_MS - 1000, BASE_MS);
  assert.equal(result, -1);
});

// ── Timing consistency: dMsToElapsed vs wallClockDelta ───────────────────────
// The key invariant: kill events have _D that is ~10s wall-clock AHEAD of the
// equivalent elapsedTime. wallClockDelta corrects for this naturally.
// This test documents the expected ~10s delta between the two approaches.

test('timing invariant: wallClockDelta and dMsToElapsed differ by ~matchStart offset', () => {
  // At wall-clock time BASE_MS + 30s, dMsToElapsed returns elapsed=30.
  // A kill event with _D = BASE_MS + 30s, matchStart = BASE_MS - 10s (typical)
  // gives wallClockDelta = (BASE_MS+30s - (BASE_MS-10s)) / 1000 = 40s.
  // Both are internally consistent within their own referential.
  const matchStart = BASE_MS - 10_000;
  const killDMs    = BASE_MS + 30_000;
  const via_wall   = deathElapsed(killDMs, matchStart);   // 40
  const via_dMs    = dMsToElapsed(killDMs);                // 30
  const delta      = via_wall - via_dMs;
  assert.closeTo(delta, 10, 0.5, `Expected ~10s difference between approaches, got ${delta}s`);
});
