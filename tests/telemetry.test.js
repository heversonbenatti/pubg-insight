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

function isReplayBear(character = {}) {
  return String(character?.accountId || '').startsWith('Monster.Bear');
}

function extractPlayerNames(telemetry) {
  const names = {};
  telemetry
    .filter(item => item._T === 'LogPlayerPosition' && !isReplayBear(item.character))
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

function extractAircraftRouteSamples(telemetry) {
  const INITIAL_AIRCRAFT_SECONDS = 60;
  const LEAVE_SAMPLE_GRACE_SECONDS = 1.5;
  const LEAVE_SAMPLE_GRACE_MS = 1500;
  const gsTimeline = buildGsTimeline(telemetry);
  const eventTimes = telemetry
    .map(item => new Date(item._D).getTime())
    .filter(Number.isFinite);
  const baseMs = eventTimes.length ? Math.min(...eventTimes) : 0;
  const elapsedForEvent = item => {
    const dMs = new Date(item._D).getTime();
    if (!Number.isFinite(dMs)) return null;
    if (Number.isFinite(item.elapsed)) return { dMs, elapsed: item.elapsed };
    if (gsTimeline.length) {
      const first = gsTimeline[0];
      if (dMs <= first.dMs) return { dMs, elapsed: first.elapsed + (dMs - first.dMs) / 1000 };
      for (let i = 0; i < gsTimeline.length - 1; i++) {
        const prev = gsTimeline[i], next = gsTimeline[i + 1];
        if (dMs >= prev.dMs && dMs <= next.dMs) {
          const ratio = (dMs - prev.dMs) / (next.dMs - prev.dMs);
          return { dMs, elapsed: prev.elapsed + (next.elapsed - prev.elapsed) * ratio };
        }
      }
      const last = gsTimeline[gsTimeline.length - 1];
      return { dMs, elapsed: last.elapsed + (dMs - last.dMs) / 1000 };
    }
    return { dMs, elapsed: (dMs - baseMs) / 1000 };
  };
  const dedupeSamples = points => {
    const samples = [];
    const seen = new Set();
    points.slice().sort((a, b) => a.dMs - b.dMs).forEach(point => {
      const key = [
        Math.round(point.dMs / 1000),
        Math.round(point.x / 100),
        Math.round(point.y / 100),
      ].join(':');
      if (seen.has(key)) return;
      seen.add(key);
      samples.push(point);
    });
    return samples;
  };

  const initialLeaves = telemetry
    .filter(item =>
      item._T === 'LogVehicleLeave' &&
      item.vehicle?.vehicleType === 'TransportAircraft' &&
      item.character?.accountId &&
      !isReplayBear(item.character)
    )
    .map(item => {
      const timing = elapsedForEvent(item);
      return timing ? { item, ...timing } : null;
    })
    .filter(leave => leave && leave.elapsed >= 0 && leave.elapsed <= INITIAL_AIRCRAFT_SECONDS)
    .map(leave => ({
      accountId: leave.item.character.accountId,
      t: leave.elapsed,
      dMs: leave.dMs,
    }))
    .sort((a, b) => (b.t - a.t) || (b.dMs - a.dMs));

  const positionPointsByAccount = new Map();
  telemetry.forEach(item => {
    if (item._T !== 'LogPlayerPosition') return;
    if (item.vehicle?.vehicleType !== 'TransportAircraft') return;
    const accountId = item.character?.accountId;
    if (!accountId || isReplayBear(item.character)) return;
    const location = item.vehicle?.location || item.character?.location;
    if (!Number.isFinite(location?.x) || !Number.isFinite(location?.y)) return;
    const timing = elapsedForEvent(item);
    if (!timing || timing.elapsed < 0 || timing.elapsed > INITIAL_AIRCRAFT_SECONDS + LEAVE_SAMPLE_GRACE_SECONDS) return;
    if (!positionPointsByAccount.has(accountId)) positionPointsByAccount.set(accountId, []);
    positionPointsByAccount.get(accountId).push({
      accountId,
      dMs: timing.dMs,
      t: timing.elapsed,
      x: location.x,
      y: location.y,
      eventType: item._T,
    });
  });

  for (const leave of initialLeaves) {
    const samples = dedupeSamples((positionPointsByAccount.get(leave.accountId) || [])
      .filter(point =>
        point.dMs <= leave.dMs + LEAVE_SAMPLE_GRACE_MS &&
        point.t <= leave.t + LEAVE_SAMPLE_GRACE_SECONDS
      ));
    if (samples.length >= 2) return samples;
  }
  return [];
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

test('extractPlayerNames: excludes Vikendi bear monster positions', () => {
  const telemetry = [
    { _T: 'LogPlayerPosition', character: { accountId: 'Monster.Bear-1', name: 'Bear' } },
    { _T: 'LogPlayerPosition', character: { accountId: 'account.bear', name: 'Bear' } },
    { _T: 'LogPlayerPosition', character: { accountId: 'account.abc', name: 'Player1' } },
  ];
  const names = extractPlayerNames(telemetry);
  assert.equal(names['Monster.Bear-1'], undefined);
  assert.equal(names['account.bear'], 'Bear');
  assert.equal(names['account.abc'], 'Player1');
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

test('extractAircraftRouteSamples: uses LogPlayerPosition from a late first-plane leaver', () => {
  const samples = extractAircraftRouteSamples([
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:05.000Z',
      character: { accountId: 'account.early' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 100, y: 200, z: 150000 } },
    },
    {
      _T: 'LogVehicleLeave',
      _D: '2024-01-01T00:00:20.000Z',
      character: { accountId: 'account.early' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 200, y: 300, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:06.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 1000, y: 2000, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:16.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 2000, y: 3000, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:26.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 3000, y: 4000, z: 150000 } },
    },
    {
      _T: 'LogVehicleLeave',
      _D: '2024-01-01T00:00:30.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 3500, y: 4500, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:01:20.000Z',
      character: { accountId: 'account.revive' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 9000, y: 9000, z: 150000 } },
    },
    {
      _T: 'LogVehicleLeave',
      _D: '2024-01-01T00:01:30.000Z',
      character: { accountId: 'account.revive' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 9500, y: 9500, z: 150000 } },
    },
  ]);
  assert.equal(samples.length, 3);
  assert.equal(samples[0].accountId, 'account.late');
  assert.equal(samples[0].x, 1000);
  assert.equal(samples[2].x, 3000);
});

test('extractAircraftRouteSamples: extrapolates aircraft positions before first game state', () => {
  const samples = extractAircraftRouteSamples([
    {
      _T: 'LogGameStatePeriodic',
      _D: '2024-01-01T00:00:10.000Z',
      gameState: { elapsedTime: 10 },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:04.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 1000, y: 2000, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:14.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 2000, y: 3000, z: 150000 } },
    },
    {
      _T: 'LogVehicleLeave',
      _D: '2024-01-01T00:00:16.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 2200, y: 3200, z: 150000 } },
    },
  ]);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].t, 4);
  assert.equal(samples[1].t, 14);
});

test('extractAircraftRouteSamples: ignores other vehicles and duplicate same-second points', () => {
  const samples = extractAircraftRouteSamples([
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:10.100Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 1000, y: 2000, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:10.400Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 1040, y: 2040, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:15.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 2000, y: 3000, z: 150000 } },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:20.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'WheeledVehicle', location: { x: 5000, y: 6000, z: 0 } },
    },
    {
      _T: 'LogVehicleLeave',
      _D: '2024-01-01T00:00:25.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 3000, y: 4000, z: 150000 } },
    },
  ]);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].x, 1000);
  assert.equal(samples[1].x, 2000);
});

test('extractAircraftRouteSamples: falls back to character location', () => {
  const samples = extractAircraftRouteSamples([
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:10.000Z',
      character: { accountId: 'account.late', location: { x: 700, y: 800, z: 150208 } },
      vehicle: { vehicleType: 'TransportAircraft' },
    },
    {
      _T: 'LogPlayerPosition',
      _D: '2024-01-01T00:00:20.000Z',
      character: { accountId: 'account.late', location: { x: 900, y: 1000, z: 150208 } },
      vehicle: { vehicleType: 'TransportAircraft' },
    },
    {
      _T: 'LogVehicleLeave',
      _D: '2024-01-01T00:00:25.000Z',
      character: { accountId: 'account.late' },
      vehicle: { vehicleType: 'TransportAircraft', location: { x: 1000, y: 1100, z: 150000 } },
    },
  ]);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].x, 700);
  assert.equal(samples[0].y, 800);
  assert.equal(samples[1].x, 900);
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
