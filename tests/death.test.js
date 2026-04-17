/**
 * tests/death.test.js
 *
 * Tests for death/respawn interval logic — isPlayerDead() and
 * playerDeathIntervals construction.
 *
 * Mirrors the logic in replay2d.js exactly. Covers:
 *   - Normal death (no respawn)
 *   - Death + respawn (redeploy)
 *   - Multiple deaths (e.g. die → redeploy → die again)
 *   - Edge cases: death at t=0, check exactly at death/respawn boundary
 */

import { test, assert } from './helpers.js';

// ── Pure re-implementation of isPlayerDead (mirrors replay2d.js) ──────────────

function isPlayerDead(playerDeathIntervals, accountId, elapsed) {
  const intervals = playerDeathIntervals[accountId];
  if (!intervals) return false;
  for (const iv of intervals) {
    if (elapsed >= iv.death && (iv.respawn === null || elapsed < iv.respawn)) return true;
  }
  return false;
}

// ── Normal death (no respawn) ─────────────────────────────────────────────────

test('isPlayerDead: alive before death time', () => {
  const intervals = { 'p1': [{ death: 100, respawn: null }] };
  assert.equal(isPlayerDead(intervals, 'p1', 99),  false);
  assert.equal(isPlayerDead(intervals, 'p1', 0),   false);
});

test('isPlayerDead: dead at exact death time', () => {
  const intervals = { 'p1': [{ death: 100, respawn: null }] };
  assert.equal(isPlayerDead(intervals, 'p1', 100), true);
});

test('isPlayerDead: dead after death time (no respawn)', () => {
  const intervals = { 'p1': [{ death: 100, respawn: null }] };
  assert.equal(isPlayerDead(intervals, 'p1', 200), true);
  assert.equal(isPlayerDead(intervals, 'p1', 9999), true);
});

test('isPlayerDead: player with no death record is always alive', () => {
  const intervals = {};
  assert.equal(isPlayerDead(intervals, 'p1', 500), false);
});

// ── Death + respawn (redeploy) ────────────────────────────────────────────────

test('isPlayerDead: alive before death (with respawn scheduled)', () => {
  const intervals = { 'p1': [{ death: 100, respawn: 150 }] };
  assert.equal(isPlayerDead(intervals, 'p1', 99), false);
});

test('isPlayerDead: dead between death and respawn', () => {
  const intervals = { 'p1': [{ death: 100, respawn: 150 }] };
  assert.equal(isPlayerDead(intervals, 'p1', 100), true);
  assert.equal(isPlayerDead(intervals, 'p1', 125), true);
  assert.equal(isPlayerDead(intervals, 'p1', 149), true);
});

test('isPlayerDead: alive AT respawn time (respawn is exclusive upper bound)', () => {
  const intervals = { 'p1': [{ death: 100, respawn: 150 }] };
  assert.equal(isPlayerDead(intervals, 'p1', 150), false);
});

test('isPlayerDead: alive after respawn', () => {
  const intervals = { 'p1': [{ death: 100, respawn: 150 }] };
  assert.equal(isPlayerDead(intervals, 'p1', 200), false);
});

// ── Multiple deaths (die → redeploy → die again) ──────────────────────────────

test('isPlayerDead: second death after respawn', () => {
  const intervals = {
    'p1': [
      { death: 100, respawn: 150 },  // first death
      { death: 250, respawn: null }, // second (final) death
    ],
  };
  // Before first death
  assert.equal(isPlayerDead(intervals, 'p1', 50),  false);
  // During first death
  assert.equal(isPlayerDead(intervals, 'p1', 120), true);
  // After respawn, before second death
  assert.equal(isPlayerDead(intervals, 'p1', 200), false);
  // At second death
  assert.equal(isPlayerDead(intervals, 'p1', 250), true);
  // Long after second death
  assert.equal(isPlayerDead(intervals, 'p1', 999), true);
});

test('isPlayerDead: three death intervals (extreme redeploy edge case)', () => {
  const intervals = {
    'p1': [
      { death: 50,  respawn: 80  },
      { death: 120, respawn: 160 },
      { death: 200, respawn: null },
    ],
  };
  assert.equal(isPlayerDead(intervals, 'p1', 40),  false);
  assert.equal(isPlayerDead(intervals, 'p1', 50),  true);
  assert.equal(isPlayerDead(intervals, 'p1', 80),  false);
  assert.equal(isPlayerDead(intervals, 'p1', 100), false);
  assert.equal(isPlayerDead(intervals, 'p1', 120), true);
  assert.equal(isPlayerDead(intervals, 'p1', 160), false);
  assert.equal(isPlayerDead(intervals, 'p1', 199), false);
  assert.equal(isPlayerDead(intervals, 'p1', 200), true);
});

// ── Death interval construction (mirrors the data pipeline) ───────────────────

test('buildDeathIntervals: kill event adds a {death, respawn:null} entry', () => {
  const intervals = {};

  // Simulate processing a kill event
  const accountId = 'account.abc';
  const t = 120;
  if (!intervals[accountId]) intervals[accountId] = [];
  intervals[accountId].push({ death: t, respawn: null });

  assert.equal(intervals[accountId].length, 1);
  assert.equal(intervals[accountId][0].death, 120);
  assert.equal(intervals[accountId][0].respawn, null);
});

test('buildDeathIntervals: parachute landing after death sets respawn', () => {
  const intervals = { 'account.abc': [{ death: 120, respawn: null }] };

  // Simulate LogParachuteLanding processing
  const accountId = 'account.abc';
  const landingT = 150;
  const accountIntervals = intervals[accountId];
  for (let i = accountIntervals.length - 1; i >= 0; i--) {
    if (accountIntervals[i].respawn === null && landingT > accountIntervals[i].death) {
      accountIntervals[i].respawn = landingT;
      break;
    }
  }

  assert.equal(intervals['account.abc'][0].respawn, 150);
});

test('buildDeathIntervals: parachute landing BEFORE death does not set respawn', () => {
  const intervals = { 'account.abc': [{ death: 120, respawn: null }] };

  const accountId = 'account.abc';
  const landingT = 90; // before death — should NOT update respawn
  const accountIntervals = intervals[accountId];
  for (let i = accountIntervals.length - 1; i >= 0; i--) {
    if (accountIntervals[i].respawn === null && landingT > accountIntervals[i].death) {
      accountIntervals[i].respawn = landingT;
      break;
    }
  }

  assert.equal(intervals['account.abc'][0].respawn, null,
    'Respawn should remain null if landing time is before death');
});

test('buildDeathIntervals: second parachute landing sets respawn on LAST open interval', () => {
  const intervals = {
    'account.abc': [
      { death: 50,  respawn: 80  }, // already resolved
      { death: 120, respawn: null }, // open
    ],
  };

  const accountId = 'account.abc';
  const landingT = 155;
  const accountIntervals = intervals[accountId];
  for (let i = accountIntervals.length - 1; i >= 0; i--) {
    if (accountIntervals[i].respawn === null && landingT > accountIntervals[i].death) {
      accountIntervals[i].respawn = landingT;
      break;
    }
  }

  // First interval should remain untouched
  assert.equal(intervals['account.abc'][0].respawn, 80);
  // Second interval should now have respawn
  assert.equal(intervals['account.abc'][1].respawn, 155);
});
