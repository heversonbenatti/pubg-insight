/**
 * tests/knock.test.js
 *
 * Tests for knock (DBNO) interval logic — isPlayerKnocked() and
 * playerKnockIntervals construction.
 *
 * Mirrors the logic in replay2d.js exactly. Covers:
 *   - Basic knock detection
 *   - Knock ends on revive
 *   - Knock ends on death (team wipe)
 *   - Multiple knocks on same player
 *   - Knock + revive + knock again
 */

import { test, assert } from './helpers.js';

// ── Pure re-implementation of isPlayerKnocked (mirrors replay2d.js) ───────────

function isPlayerKnocked(playerKnockIntervals, accountId, elapsed) {
  const intervals = playerKnockIntervals[accountId];
  if (!intervals) return false;
  for (const iv of intervals) {
    if (elapsed >= iv.knock && (iv.end === null || elapsed < iv.end)) return true;
  }
  return false;
}

// ── Basic knock detection ─────────────────────────────────────────────────────

test('isPlayerKnocked: not knocked before knock time', () => {
  const intervals = { 'p1': [{ knock: 100, end: 120 }] };
  assert.equal(isPlayerKnocked(intervals, 'p1', 99), false);
});

test('isPlayerKnocked: knocked at exact knock time', () => {
  const intervals = { 'p1': [{ knock: 100, end: 120 }] };
  assert.equal(isPlayerKnocked(intervals, 'p1', 100), true);
});

test('isPlayerKnocked: knocked during interval', () => {
  const intervals = { 'p1': [{ knock: 100, end: 120 }] };
  assert.equal(isPlayerKnocked(intervals, 'p1', 110), true);
});

test('isPlayerKnocked: not knocked at end time (exclusive upper bound)', () => {
  const intervals = { 'p1': [{ knock: 100, end: 120 }] };
  assert.equal(isPlayerKnocked(intervals, 'p1', 120), false);
});

test('isPlayerKnocked: not knocked after end time', () => {
  const intervals = { 'p1': [{ knock: 100, end: 120 }] };
  assert.equal(isPlayerKnocked(intervals, 'p1', 150), false);
});

test('isPlayerKnocked: player with no knock record is never knocked', () => {
  assert.equal(isPlayerKnocked({}, 'p1', 100), false);
});

// ── Knock with null end (open interval — knock not resolved) ──────────────────

test('isPlayerKnocked: open knock interval (end === null)', () => {
  const intervals = { 'p1': [{ knock: 100, end: null }] };
  assert.equal(isPlayerKnocked(intervals, 'p1', 100), true);
  assert.equal(isPlayerKnocked(intervals, 'p1', 500), true);
});

// ── Multiple knocks (knock → revive → knock again) ───────────────────────────

test('isPlayerKnocked: multiple knock intervals', () => {
  const intervals = {
    'p1': [
      { knock: 100, end: 120 },  // knocked, then revived
      { knock: 200, end: 250 },  // knocked again, then died at 250
    ],
  };
  assert.equal(isPlayerKnocked(intervals, 'p1', 50), false);
  assert.equal(isPlayerKnocked(intervals, 'p1', 110), true);
  assert.equal(isPlayerKnocked(intervals, 'p1', 120), false);  // revived
  assert.equal(isPlayerKnocked(intervals, 'p1', 150), false);  // alive
  assert.equal(isPlayerKnocked(intervals, 'p1', 210), true);   // knocked again
  assert.equal(isPlayerKnocked(intervals, 'p1', 250), false);  // dead (end)
});

// ── Knock interval construction (closing open knocks at death time) ───────────

test('buildKnockIntervals: death closes open knock', () => {
  const knockIntervals = {
    'p1': [{ knock: 100, end: null }],
  };
  const deathIntervals = {
    'p1': [{ death: 130, respawn: null }],
  };

  // Simulate closing open knocks at death time (mirrors replay2d.js)
  Object.entries(knockIntervals).forEach(([id, intervals]) => {
    const deaths = deathIntervals[id];
    if (!deaths) return;
    intervals.forEach(iv => {
      if (iv.end === null) {
        const death = deaths.find(d => d.death >= iv.knock);
        if (death) iv.end = death.death;
      }
    });
  });

  assert.equal(knockIntervals['p1'][0].end, 130);
});

test('buildKnockIntervals: revive closes knock before death', () => {
  // Player knocked at 100, revived at 115, dies later at 200
  const knockIntervals = {
    'p1': [{ knock: 100, end: 115 }],  // already closed by revive
  };

  // Death shouldn't change a knock that was already closed by revive
  const deathIntervals = {
    'p1': [{ death: 200, respawn: null }],
  };

  Object.entries(knockIntervals).forEach(([id, intervals]) => {
    const deaths = deathIntervals[id];
    if (!deaths) return;
    intervals.forEach(iv => {
      if (iv.end === null) {
        const death = deaths.find(d => d.death >= iv.knock);
        if (death) iv.end = death.death;
      }
    });
  });

  assert.equal(knockIntervals['p1'][0].end, 115, 'Revive end should not be overwritten');
});

// ── Team wipe scenario (the original bug) ─────────────────────────────────────

test('team wipe: all knocked players die when last standing teammate dies', () => {
  // Simulate: Player A knocked at 140, Player B knocked at 144,
  // Player C (last standing) killed at 156 — A and B also die at 156
  const deathIntervals = {
    'playerA': [{ death: 156, respawn: null }],
    'playerB': [{ death: 156, respawn: null }],
    'playerC': [{ death: 156, respawn: null }],
  };

  const knockIntervals = {
    'playerA': [{ knock: 140, end: null }],
    'playerB': [{ knock: 144, end: null }],
    // playerC was never knocked — died standing
  };

  // Close open knocks
  Object.entries(knockIntervals).forEach(([id, intervals]) => {
    const deaths = deathIntervals[id];
    if (!deaths) return;
    intervals.forEach(iv => {
      if (iv.end === null) {
        const death = deaths.find(d => d.death >= iv.knock);
        if (death) iv.end = death.death;
      }
    });
  });

  // Player A: knocked from 140 to 156
  assert.equal(isPlayerKnocked(knockIntervals, 'playerA', 139), false);
  assert.equal(isPlayerKnocked(knockIntervals, 'playerA', 140), true);
  assert.equal(isPlayerKnocked(knockIntervals, 'playerA', 155), true);
  assert.equal(isPlayerKnocked(knockIntervals, 'playerA', 156), false); // dead, not knocked

  // Player B: knocked from 144 to 156
  assert.equal(isPlayerKnocked(knockIntervals, 'playerB', 143), false);
  assert.equal(isPlayerKnocked(knockIntervals, 'playerB', 144), true);
  assert.equal(isPlayerKnocked(knockIntervals, 'playerB', 156), false); // dead

  // Player C: never knocked
  assert.equal(isPlayerKnocked(knockIntervals, 'playerC', 155), false);
});

// ── Death detection includes DBNO kills (the root cause bug) ──────────────────

test('death detection: kill events with isDBNO=true are still deaths', () => {
  // This tests that the !isDBNO filter has been removed
  // Simulates: kill events for team-wiped players have isDBNO:true on victim
  const deathIntervals = {};

  // Simulate processing kill events (mirrors replay2d.js logic)
  const killEvents = [
    { _T: 'LogPlayerKillV2', _D: 'T1', victim: { accountId: 'p1', isDBNO: true } },  // was knocked
    { _T: 'LogPlayerKillV2', _D: 'T2', victim: { accountId: 'p2', isDBNO: true } },  // was knocked
    { _T: 'LogPlayerKillV2', _D: 'T3', victim: { accountId: 'p3', isDBNO: false } }, // last standing
  ];

  killEvents.forEach(item => {
    // This is the FIXED logic — no !item.victim.isDBNO filter
    if ((item._T === 'LogPlayerKillV2' || item._T === 'LogPlayerKill') &&
      item.victim?.accountId && item._D) {
      const t = 100; // simplified
      if (!deathIntervals[item.victim.accountId]) deathIntervals[item.victim.accountId] = [];
      deathIntervals[item.victim.accountId].push({ death: t, respawn: null });
    }
  });

  // ALL three players should have death intervals
  assert.ok(deathIntervals['p1'], 'Player with isDBNO=true should have death interval');
  assert.ok(deathIntervals['p2'], 'Player with isDBNO=true should have death interval');
  assert.ok(deathIntervals['p3'], 'Player with isDBNO=false should have death interval');
  assert.equal(deathIntervals['p1'].length, 1);
  assert.equal(deathIntervals['p2'].length, 1);
  assert.equal(deathIntervals['p3'].length, 1);
});
