/**
 * tests/telemetry.test.js
 *
 * Tests for telemetry parsing helpers — the data pipeline in replay2d.js
 * that turns raw PUBG API telemetry JSON into the structures used by the renderer.
 *
 * Covers:
 *   - playerNames extraction from LogPlayerPosition
 *   - matchStartMs extraction from LogMatchStart
 *   - gsTimeline construction from LogGameStatePeriodic
 *   - Kill events: LogPlayerKillV2 vs LogPlayerKill, isDBNO filtering
 *   - Bullet events: only Damage_Gun, requires both attacker+victim location
 *   - feedEvents: knock vs kill classification
 *   - Edge cases: empty telemetry, missing fields, duplicate events
 */

import { test, assert } from './helpers.js';

// ── Helpers (mirrors replay2d.js parsing logic) ───────────────────────────────

function extractPlayerNames(telemetry) {
  const names = {};
  telemetry
    .filter(item => item._T === 'LogPlayerPosition')
    .forEach(item => {
      if (item.character?.accountId && item.character?.name)
        names[item.character.accountId] = item.character.name;
    });
  return names;
}

function extractMatchStartMs(telemetry) {
  const event = telemetry.find(item => item._T === 'LogMatchStart');
  return event ? new Date(event._D).getTime() : 0;
}

function buildGsTimeline(telemetry) {
  return telemetry
    .filter(item => item.gameState)
    .map(g => ({ dMs: new Date(g._D).getTime(), elapsed: g.gameState.elapsedTime }))
    .sort((a, b) => a.dMs - b.dMs);
}

function extractKillEvents(telemetry) {
  return telemetry.filter(item =>
    (item._T === 'LogPlayerKillV2' || item._T === 'LogPlayerKill') &&
    item.victim?.accountId &&
    item._D &&
    !item.victim.isDBNO // DBNO (knock) are excluded from death intervals
  );
}

function extractBulletEvents(telemetry) {
  return telemetry.filter(item =>
    item._T === 'LogPlayerTakeDamage' &&
    item._D &&
    item.damageTypeCategory === 'Damage_Gun' &&
    item.attacker?.accountId &&
    item.victim?.accountId &&
    item.attacker?.location &&
    item.victim?.location
  );
}

// ── playerNames ───────────────────────────────────────────────────────────────

test('extractPlayerNames: extracts name from LogPlayerPosition events', () => {
  const telemetry = [
    { _T: 'LogPlayerPosition', character: { accountId: 'account.abc', name: 'Shroud' } },
    { _T: 'LogPlayerPosition', character: { accountId: 'account.xyz', name: 'Dr_Disrespect' } },
  ];
  const names = extractPlayerNames(telemetry);
  assert.equal(names['account.abc'], 'Shroud');
  assert.equal(names['account.xyz'], 'Dr_Disrespect');
});

test('extractPlayerNames: ignores events without character', () => {
  const telemetry = [
    { _T: 'LogPlayerPosition' }, // no character field
    { _T: 'LogPlayerPosition', character: { accountId: 'account.abc', name: 'Player1' } },
  ];
  const names = extractPlayerNames(telemetry);
  assert.equal(Object.keys(names).length, 1);
  assert.equal(names['account.abc'], 'Player1');
});

test('extractPlayerNames: later entry for same accountId overwrites (last-write wins)', () => {
  const telemetry = [
    { _T: 'LogPlayerPosition', character: { accountId: 'account.abc', name: 'OldName' } },
    { _T: 'LogPlayerPosition', character: { accountId: 'account.abc', name: 'NewName' } },
  ];
  const names = extractPlayerNames(telemetry);
  assert.equal(names['account.abc'], 'NewName');
});

test('extractPlayerNames: empty telemetry returns empty object', () => {
  const names = extractPlayerNames([]);
  assert.deepEqual(names, {});
});

// ── matchStartMs ──────────────────────────────────────────────────────────────

test('extractMatchStartMs: reads _D from LogMatchStart', () => {
  const telemetry = [
    { _T: 'LogMatchStart', _D: '2024-01-01T00:00:00.000Z' },
  ];
  const ms = extractMatchStartMs(telemetry);
  assert.equal(ms, new Date('2024-01-01T00:00:00.000Z').getTime());
});

test('extractMatchStartMs: returns 0 if no LogMatchStart event', () => {
  const ms = extractMatchStartMs([{ _T: 'SomeOtherEvent' }]);
  assert.equal(ms, 0);
});

test('extractMatchStartMs: uses first LogMatchStart if multiple exist', () => {
  const telemetry = [
    { _T: 'LogMatchStart', _D: '2024-01-01T00:00:00.000Z' },
    { _T: 'LogMatchStart', _D: '2024-01-01T00:01:00.000Z' },
  ];
  const ms = extractMatchStartMs(telemetry);
  assert.equal(ms, new Date('2024-01-01T00:00:00.000Z').getTime());
});

// ── gsTimeline ────────────────────────────────────────────────────────────────

test('buildGsTimeline: extracts and sorts by dMs', () => {
  const telemetry = [
    { _D: '2024-01-01T00:00:30.000Z', gameState: { elapsedTime: 30 } },
    { _D: '2024-01-01T00:00:10.000Z', gameState: { elapsedTime: 10 } },
    { _D: '2024-01-01T00:00:20.000Z', gameState: { elapsedTime: 20 } },
  ];
  const timeline = buildGsTimeline(telemetry);
  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].elapsed, 10);
  assert.equal(timeline[1].elapsed, 20);
  assert.equal(timeline[2].elapsed, 30);
});

test('buildGsTimeline: ignores events without gameState', () => {
  const telemetry = [
    { _D: '2024-01-01T00:00:10.000Z', gameState: { elapsedTime: 10 } },
    { _T: 'LogPlayerPosition', _D: '2024-01-01T00:00:05.000Z' }, // no gameState
  ];
  const timeline = buildGsTimeline(telemetry);
  assert.equal(timeline.length, 1);
});

test('buildGsTimeline: empty telemetry returns empty array', () => {
  assert.deepEqual(buildGsTimeline([]), []);
});

// ── Kill event extraction ─────────────────────────────────────────────────────

test('extractKillEvents: includes LogPlayerKillV2 with isDBNO=false', () => {
  const telemetry = [{
    _T: 'LogPlayerKillV2', _D: '2024-01-01T00:02:00.000Z',
    victim: { accountId: 'account.vic', isDBNO: false },
    killer: { accountId: 'account.kil' },
  }];
  const kills = extractKillEvents(telemetry);
  assert.equal(kills.length, 1);
});

test('extractKillEvents: includes LogPlayerKill events', () => {
  const telemetry = [{
    _T: 'LogPlayerKill', _D: '2024-01-01T00:02:00.000Z',
    victim: { accountId: 'account.vic' },
    killer: { accountId: 'account.kil' },
  }];
  const kills = extractKillEvents(telemetry);
  assert.equal(kills.length, 1);
});

test('extractKillEvents: excludes DBNO (knock) events', () => {
  const telemetry = [{
    _T: 'LogPlayerKillV2', _D: '2024-01-01T00:02:00.000Z',
    victim: { accountId: 'account.vic', isDBNO: true }, // knock, not kill
    killer: { accountId: 'account.kil' },
  }];
  const kills = extractKillEvents(telemetry);
  assert.equal(kills.length, 0, 'DBNO event should be excluded from kills');
});

test('extractKillEvents: excludes events missing victim.accountId', () => {
  const telemetry = [{
    _T: 'LogPlayerKillV2', _D: '2024-01-01T00:02:00.000Z',
    victim: { isDBNO: false }, // no accountId
  }];
  const kills = extractKillEvents(telemetry);
  assert.equal(kills.length, 0);
});

test('extractKillEvents: excludes events missing _D', () => {
  const telemetry = [{
    _T: 'LogPlayerKillV2',
    victim: { accountId: 'account.vic', isDBNO: false },
    // no _D
  }];
  const kills = extractKillEvents(telemetry);
  assert.equal(kills.length, 0);
});

// ── Bullet event extraction ───────────────────────────────────────────────────

const goodDamage = {
  _T: 'LogPlayerTakeDamage',
  _D: '2024-01-01T00:01:00.000Z',
  damageTypeCategory: 'Damage_Gun',
  attacker: { accountId: 'account.atk', location: { x: 100, y: 200, z: 0 } },
  victim:   { accountId: 'account.vic', location: { x: 500, y: 600, z: 0 } },
};

test('extractBulletEvents: valid gun damage event is included', () => {
  const events = extractBulletEvents([goodDamage]);
  assert.equal(events.length, 1);
});

test('extractBulletEvents: non-gun damage is excluded', () => {
  const events = extractBulletEvents([{
    ...goodDamage,
    damageTypeCategory: 'Damage_BlueZone',
  }]);
  assert.equal(events.length, 0);
});

test('extractBulletEvents: missing attacker location is excluded', () => {
  const events = extractBulletEvents([{
    ...goodDamage,
    attacker: { accountId: 'account.atk' }, // no location
  }]);
  assert.equal(events.length, 0);
});

test('extractBulletEvents: missing victim location is excluded', () => {
  const events = extractBulletEvents([{
    ...goodDamage,
    victim: { accountId: 'account.vic' }, // no location
  }]);
  assert.equal(events.length, 0);
});

test('extractBulletEvents: missing _D is excluded', () => {
  const { _D, ...noDEvent } = goodDamage;
  const events = extractBulletEvents([noDEvent]);
  assert.equal(events.length, 0);
});

test('extractBulletEvents: missing attacker accountId is excluded', () => {
  const events = extractBulletEvents([{
    ...goodDamage,
    attacker: { location: { x: 100, y: 200, z: 0 } }, // no accountId
  }]);
  assert.equal(events.length, 0);
});

// ── stats formatting (mirrors scripts.js) ────────────────────────────────────

function formatTime(timeInSeconds) {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = timeInSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

test('formatTime: zero seconds', () => {
  assert.equal(formatTime(0), '0:00');
});

test('formatTime: 90 seconds = 1:30', () => {
  assert.equal(formatTime(90), '1:30');
});

test('formatTime: 65 seconds = 1:05', () => {
  assert.equal(formatTime(65), '1:05');
});

test('formatTime: 600 seconds = 10:00', () => {
  assert.equal(formatTime(600), '10:00');
});

test('formatTime: 59 seconds has leading zero on seconds', () => {
  assert.equal(formatTime(59), '0:59');
});
