/**
 * tests/platform.test.js
 * Tests platform validation + shard URL building.
 * Mirrors the logic in server.js (kept here as a pure function for browser-free testing).
 */

import { test, assert } from './helpers.js';

const VALID_PLATFORMS = new Set(['steam', 'psn', 'xbox', 'kakao', 'stadia']);

function shardUrl(platform) {
  const p = VALID_PLATFORMS.has(platform) ? platform : 'steam';
  return `https://api.pubg.com/shards/${p}`;
}

function isConsole(platform) {
  return platform === 'psn' || platform === 'xbox' || platform === 'stadia';
}

// ── shardUrl ───────────────────────────────────────────────────────────────────
test('shardUrl: every valid platform maps to its shard', () => {
  assert.equal(shardUrl('steam'),  'https://api.pubg.com/shards/steam');
  assert.equal(shardUrl('kakao'),  'https://api.pubg.com/shards/kakao');
  assert.equal(shardUrl('psn'),    'https://api.pubg.com/shards/psn');
  assert.equal(shardUrl('xbox'),   'https://api.pubg.com/shards/xbox');
  assert.equal(shardUrl('stadia'), 'https://api.pubg.com/shards/stadia');
});

test('shardUrl: invalid platform falls back to steam', () => {
  assert.equal(shardUrl('windows-phone'), 'https://api.pubg.com/shards/steam');
  assert.equal(shardUrl(''),              'https://api.pubg.com/shards/steam');
  assert.equal(shardUrl(undefined),       'https://api.pubg.com/shards/steam');
  assert.equal(shardUrl(null),            'https://api.pubg.com/shards/steam');
});

test('shardUrl: SQL-injection-style strings still fall back safely', () => {
  assert.equal(shardUrl("steam'; DROP TABLE players; --"), 'https://api.pubg.com/shards/steam');
});

// ── isConsole ─────────────────────────────────────────────────────────────────
test('isConsole: PC platforms return false', () => {
  assert.equal(isConsole('steam'), false);
  assert.equal(isConsole('kakao'), false);
});

test('isConsole: console platforms return true', () => {
  assert.equal(isConsole('psn'),    true);
  assert.equal(isConsole('xbox'),   true);
  assert.equal(isConsole('stadia'), true);
});

// ── season filter (matches loadSeasonsForCurrentPlatform in scripts.js) ───────
function filterSeasons(seasons, platform) {
  const console = isConsole(platform);
  return seasons.filter(s =>
    console ? !s.id.includes('pc') || s.id.includes('console')
            : (s.id.includes('pc') && !s.id.includes('console'))
  );
}

const sampleSeasons = [
  { id: 'division.bro.official.pc-2018-01' },
  { id: 'division.bro.official.pc-2018-09' },
  { id: 'division.bro.official.console-pc-2018-08' },
  { id: 'division.bro.official.console-2018-09' },
  { id: 'division.bro.official.legacy' },
];

test('filterSeasons: PC platform returns only pc-* not console-*', () => {
  const r = filterSeasons(sampleSeasons, 'steam');
  assert.equal(r.length, 2);
  assert.ok(r.every(s => s.id.includes('pc') && !s.id.includes('console')));
});

test('filterSeasons: console platform returns console-* and non-pc', () => {
  const r = filterSeasons(sampleSeasons, 'psn');
  // pc-2018-01 and pc-2018-09 are excluded
  // console-pc-2018-08, console-2018-09, legacy are included
  assert.equal(r.length, 3);
  assert.ok(r.some(s => s.id === 'division.bro.official.legacy'));
  assert.ok(r.some(s => s.id === 'division.bro.official.console-2018-09'));
  assert.ok(r.some(s => s.id === 'division.bro.official.console-pc-2018-08'));
});
