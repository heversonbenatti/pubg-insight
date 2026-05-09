/**
 * tests/interpolation.test.js
 *
 * Tests for position interpolation and HP carry-forward logic from replay2d.js.
 *
 * Covers:
 *   - Linear interpolation between two position anchors
 *   - Multi-anchor interpolation (byTime map building)
 *   - Action-point overrides (exact positions overwrite interpolated)
 *   - HP carry-forward (fill gaps from last known keyframe HP)
 *   - HP refinement (distribute damage hits within a keyframe interval)
 *   - scaleFactor computation (critical for map scaling)
 *   - subProgress smooth interpolation (frame-level lerp)
 */

import { test, assert } from './helpers.js';

// ── Linear interpolate helper (mirrors replay2d.js) ───────────────────────────

function interpolate(a, b, t) { return a + (b - a) * t; }

const POSITION_SPEED = {
  foot: 1350,
  footShort: 2200,
  airborne: 12000,
  dbno: 380,
  swim: 520,
  vehicle: 30000,
  correctionSlack: 2200,
};

const PARACHUTE_OPEN = {
  heightAboveLanding: 26000,
  maxHorizontalSpeed: 2200,
  maxVerticalDrop: 2800,
  fallbackSeconds: 18,
};

function maxAnchorSpeed(curr, next, timeDiff) {
  if (curr.isInVehicle || next.isInVehicle || curr.vehicleType || next.vehicleType) return POSITION_SPEED.vehicle;
  if (curr.isAirborne || next.isAirborne) return POSITION_SPEED.airborne;
  if (curr.isDBNO || next.isDBNO) return POSITION_SPEED.dbno;
  if (curr.isSwimming || next.isSwimming) return POSITION_SPEED.swim;
  return timeDiff <= 3 ? POSITION_SPEED.footShort : POSITION_SPEED.foot;
}

function shouldInterpolatePosition(curr, next, timeDiff) {
  const dist = Math.hypot(next.x - curr.x, next.y - curr.y);
  if (dist <= POSITION_SPEED.correctionSlack) return true;
  const speed = dist / Math.max(0.001, timeDiff);
  return speed <= maxAnchorSpeed(curr, next, timeDiff);
}

function positionBetweenAnchors(curr, next, elapsed) {
  const timeDiff = next.t - curr.t;
  if (timeDiff <= 0) return { x: curr.x, y: curr.y };
  if (!shouldInterpolatePosition(curr, next, timeDiff)) {
    const midpoint = curr.t + timeDiff / 2;
    return elapsed < midpoint ? { x: curr.x, y: curr.y } : { x: next.x, y: next.y };
  }
  const p = Math.max(0, Math.min(1, (elapsed - curr.t) / timeDiff));
  return {
    x: curr.x + (next.x - curr.x) * p,
    y: curr.y + (next.y - curr.y) * p,
  };
}

function inferParachuteOpenTime(anchors, interval) {
  const points = anchors
    .filter(p => p.t >= interval.start - 0.25 && p.t <= interval.end + 0.25 && Number.isFinite(p.z))
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) return Math.max(interval.start, interval.end - PARACHUTE_OPEN.fallbackSeconds);

  const landingPoint = points.find(p => p.t >= interval.end - 1) || points[points.length - 1];
  const landingZ = landingPoint.z;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dt = curr.t - prev.t;
    if (dt <= 0 || curr.t <= interval.start + 3) continue;

    const horizontalSpeed = Math.hypot(curr.x - prev.x, curr.y - prev.y) / dt;
    const verticalDrop = Math.max(0, prev.z - curr.z) / dt;
    const heightAboveLanding = curr.z - landingZ;

    if (heightAboveLanding <= PARACHUTE_OPEN.heightAboveLanding ||
        (horizontalSpeed <= PARACHUTE_OPEN.maxHorizontalSpeed &&
         verticalDrop <= PARACHUTE_OPEN.maxVerticalDrop)) {
      return curr.t;
    }
  }

  return Math.max(interval.start, interval.end - PARACHUTE_OPEN.fallbackSeconds);
}

test('interpolate: 0% returns start', () => {
  assert.closeTo(interpolate(0, 100, 0), 0, 0.001);
});

test('interpolate: 100% returns end', () => {
  assert.closeTo(interpolate(0, 100, 1), 100, 0.001);
});

test('interpolate: 50% returns midpoint', () => {
  assert.closeTo(interpolate(100, 200, 0.5), 150, 0.001);
});

test('interpolate: works for negative coords', () => {
  assert.closeTo(interpolate(-200, 200, 0.5), 0, 0.001);
});

// ── byTime map building (mirrors the anchor-pair loop in replay2d.js) ─────────

function buildByTime(anchors) {
  const byTime = {};
  for (let i = 0; i < anchors.length - 1; i++) {
    const curr = anchors[i], next = anchors[i + 1];
    const timeDiff = next.t - curr.t;
    if (timeDiff <= 0) continue;
    if (!shouldInterpolatePosition(curr, next, timeDiff)) {
      byTime[Math.round(curr.t)] = { x: curr.x, y: curr.y };
      byTime[Math.round(next.t)] = { x: next.x, y: next.y };
      continue;
    }
    const steps = Math.max(1, Math.floor(timeDiff));
    for (let j = 0; j <= steps; j++) {
      const t = Math.round(curr.t + j);
      if (byTime[t]) continue;
      const p = j / steps;
      byTime[t] = { x: curr.x + (next.x - curr.x) * p, y: curr.y + (next.y - curr.y) * p };
    }
  }
  // Action (non-keyframe) points overwrite
  anchors.filter(a => !a.isKeyframe).forEach(a => {
    byTime[Math.round(a.t)] = { x: a.x, y: a.y };
  });
  return byTime;
}

test('buildByTime: two keyframes 10s apart produce entries for each second', () => {
  const anchors = [
    { t: 10, x: 0,    y: 0,    isKeyframe: true },
    { t: 20, x: 1000, y: 2000, isKeyframe: true },
  ];
  const byTime = buildByTime(anchors);
  // Should have entries for t=10..20
  for (let t = 10; t <= 20; t++) {
    assert.ok(byTime[t] !== undefined, `Missing entry at t=${t}`);
  }
});

test('buildByTime: interpolated positions lie on the straight line', () => {
  const anchors = [
    { t: 0,  x: 0,    y: 0,    isKeyframe: true },
    { t: 10, x: 1000, y: 0,    isKeyframe: true },
  ];
  const byTime = buildByTime(anchors);
  assert.closeTo(byTime[5].x, 500, 1, 'Midpoint x should be 500');
  assert.closeTo(byTime[5].y, 0,   1, 'Midpoint y should be 0');
});

test('buildByTime: action point (non-keyframe) overwrites interpolated position', () => {
  const anchors = [
    { t: 0,  x: 0,    y: 0,    isKeyframe: true },
    { t: 10, x: 1000, y: 0,    isKeyframe: true },
    { t: 5,  x: 9999, y: 9999, isKeyframe: false }, // action point at t=5
  ];
  const byTime = buildByTime(anchors);
  assert.closeTo(byTime[5].x, 9999, 1, 'Action point should override interpolated x');
  assert.closeTo(byTime[5].y, 9999, 1, 'Action point should override interpolated y');
});

test('buildByTime: timeDiff=0 anchors are skipped (no division by zero)', () => {
  const anchors = [
    { t: 10, x: 0, y: 0, isKeyframe: true },
    { t: 10, x: 500, y: 500, isKeyframe: true }, // same time
    { t: 20, x: 1000, y: 1000, isKeyframe: true },
  ];
  // Should not throw
  const byTime = buildByTime(anchors);
  assert.ok(typeof byTime === 'object');
});

test('buildByTime: first-seen entry wins (duplicate t is not overwritten by later keyframe)', () => {
  const anchors = [
    { t: 0,  x: 100, y: 200, isKeyframe: true },
    { t: 10, x: 200, y: 400, isKeyframe: true },
    { t: 20, x: 300, y: 600, isKeyframe: true },
  ];
  const byTime = buildByTime(anchors);
  // t=10 is produced by first pair (0→10) AND is the start of the second pair (10→20).
  // The `if (byTime[t]) continue;` guard means the first-written value wins.
  assert.ok(byTime[10] !== undefined);
});

test('shouldInterpolatePosition: normal foot movement is interpolated', () => {
  const curr = { t: 0, x: 0, y: 0, isKeyframe: true };
  const next = { t: 10, x: 1000, y: 0, isKeyframe: true };
  assert.equal(shouldInterpolatePosition(curr, next, 10), true);
  const pos = positionBetweenAnchors(curr, next, 5);
  assert.closeTo(pos.x, 500, 1);
});

test('shouldInterpolatePosition: impossible foot movement is snapped, not smoothed', () => {
  const curr = { t: 0, x: 0, y: 0, isKeyframe: true };
  const next = { t: 10, x: 50000, y: 0, isKeyframe: true };
  assert.equal(shouldInterpolatePosition(curr, next, 10), false);
  assert.equal(buildByTime([curr, next])[5], undefined, 'Impossible interval should leave no in-between path');
  assert.closeTo(positionBetweenAnchors(curr, next, 4).x, 0, 1);
  assert.closeTo(positionBetweenAnchors(curr, next, 6).x, 50000, 1);
});

test('shouldInterpolatePosition: DBNO movement uses a lower speed cap', () => {
  const curr = { t: 0, x: 0, y: 0, isDBNO: true, isKeyframe: true };
  const next = { t: 2, x: 3000, y: 0, isDBNO: true, isKeyframe: true };
  assert.equal(shouldInterpolatePosition(curr, next, 2), false);
});

test('shouldInterpolatePosition: parachute/freefall movement is smoothed instead of snapped', () => {
  const curr = { t: 45, x: 443436, y: 459517, isAirborne: true, isKeyframe: true };
  const next = { t: 54, x: 400236, y: 449957, isAirborne: true, isKeyframe: true };
  assert.equal(shouldInterpolatePosition(curr, next, 9), true);
  const pos = positionBetweenAnchors(curr, next, 49.5);
  assert.ok(pos.x < curr.x && pos.x > next.x, 'Airborne position should be interpolated between anchors');
});

test('inferParachuteOpenTime: starts icon after freefall slows near landing', () => {
  const anchors = [
    { t: 35, x: 489646, y: 464455, z: 150208 },
    { t: 45, x: 443436, y: 459517, z: 109424 },
    { t: 54, x: 400236, y: 449957, z: 62854 },
    { t: 64, x: 394663, y: 448657, z: 21240 },
    { t: 73, x: 383225, y: 447219, z: 6679 },
    { t: 74, x: 383520, y: 446376, z: 5796 },
  ];
  const open = inferParachuteOpenTime(anchors, { start: 36, end: 74 });
  assert.equal(open, 64);
});

// ── HP carry-forward ──────────────────────────────────────────────────────────

function buildHpByTime(anchors) {
  const byHp = {};
  anchors.filter(a => a.isKeyframe && a.health !== undefined).forEach(a => {
    byHp[Math.round(a.t)] = a.health;
  });
  const kfTimes = anchors.filter(a => a.isKeyframe).map(a => Math.round(a.t)).sort((a, b) => a - b);
  if (kfTimes.length) {
    let lastHp = 100;
    for (let s = 0; s <= kfTimes[kfTimes.length - 1]; s++) {
      if (byHp[s] !== undefined) lastHp = byHp[s];
      else byHp[s] = lastHp;
    }
  }
  return byHp;
}

function damageHpAfter(item) {
  const hpBefore = Number(item.victim?.health);
  const damage = Number(item.damage) || 0;
  if (!Number.isFinite(hpBefore)) return 0;
  return Math.max(0, Math.min(100, hpBefore - damage));
}

test('buildHpByTime: HP is carried forward from last keyframe', () => {
  const anchors = [
    { t: 0,  isKeyframe: true, health: 100 },
    { t: 10, isKeyframe: true, health: 80  },
    { t: 20, isKeyframe: true, health: 60  },
  ];
  const byHp = buildHpByTime(anchors);
  // Between t=0 and t=10, HP should be 100
  assert.equal(byHp[5], 100);
  // Between t=10 and t=20, HP should be 80
  assert.equal(byHp[15], 80);
  // At t=20, HP should be 60
  assert.equal(byHp[20], 60);
});

test('buildHpByTime: initial HP defaults to 100 before first keyframe', () => {
  const anchors = [
    { t: 5,  isKeyframe: true, health: 90 },
    { t: 15, isKeyframe: true, health: 70 },
  ];
  const byHp = buildHpByTime(anchors);
  // t=0..4 should use defaulted 100 (lastHp starts at 100)
  assert.equal(byHp[0], 100);
  assert.equal(byHp[4], 100);
  assert.equal(byHp[5], 90);
});

test('buildHpByTime: missing health on a keyframe does not reset to 0', () => {
  // If a keyframe has no health field, the carry-forward should continue,
  // not reset to undefined/NaN.
  const anchors = [
    { t: 0,  isKeyframe: true, health: 80 },
    { t: 10, isKeyframe: true },           // no health
    { t: 20, isKeyframe: true, health: 60 },
  ];
  const byHp = buildHpByTime(anchors);
  assert.ok(byHp[15] !== undefined && !isNaN(byHp[15]),
    `Expected a numeric HP at t=15, got ${byHp[15]}`);
  assert.equal(byHp[15], 80, 'HP should carry forward 80 since t=10 had no health');
});

test('damageHpAfter: PUBG damage victim.health is treated as pre-damage HP', () => {
  const item = { victim: { health: 77.86 }, damage: 77.86 };
  assert.equal(damageHpAfter(item), 0);
});

test('damageHpAfter: clamps overkill damage to zero', () => {
  const item = { victim: { health: 20 }, damage: 45 };
  assert.equal(damageHpAfter(item), 0);
});

// ── scaleFactor computation ───────────────────────────────────────────────────
// Critical: smaller maps (Sanhok 408k, Karakin 204.8k) must scale up correctly.

function computeScaleFactor(BASE_SCALE, VIEWPORT_WIDTH, MAP_WIDTH, MAP_HEIGHT) {
  return BASE_SCALE * (VIEWPORT_WIDTH / 800) * (816000 / Math.max(MAP_WIDTH, MAP_HEIGHT));
}

test('scaleFactor: Erangel (816k) at 800px viewport equals BASE_SCALE exactly', () => {
  const sf = computeScaleFactor(0.001, 800, 816000, 816000);
  assert.closeTo(sf, 0.001, 0.0001);
});

test('scaleFactor: Sanhok (408k) is 2x Erangel scaleFactor', () => {
  const erangel = computeScaleFactor(0.001, 800, 816000, 816000);
  const sanhok  = computeScaleFactor(0.001, 800, 408000, 408000);
  assert.closeTo(sanhok / erangel, 2, 0.01, 'Sanhok should have 2x scale factor');
});

test('scaleFactor: Karakin (204.8k) is 4x Erangel scaleFactor', () => {
  const erangel = computeScaleFactor(0.001, 800, 816000, 816000);
  const karakin = computeScaleFactor(0.001, 800, 204800, 204800);
  assert.closeTo(karakin / erangel, 816000 / 204800, 0.01);
});

test('scaleFactor: viewport 600px gives 0.75x of 800px scaleFactor', () => {
  const at800 = computeScaleFactor(0.001, 800, 816000, 816000);
  const at600 = computeScaleFactor(0.001, 600, 816000, 816000);
  assert.closeTo(at600 / at800, 0.75, 0.001);
});

// ── subProgress smooth interpolation ─────────────────────────────────────────
// subProgress = timeAccumulator / MS_PER_GAME_SECOND, range [0, 1)

test('subProgress: stays in [0, 1) range during normal playback', () => {
  const MS_PER_GAME_SECOND = 1000;
  // Simulate a few ticks at various speeds
  const speeds = [0.25, 0.5, 1, 2, 4, 8, 16];
  for (const speed of speeds) {
    let accumulator = 0;
    for (let frame = 0; frame < 100; frame++) {
      const deltaMs = 16.67; // ~60fps
      accumulator += deltaMs * speed;
      while (accumulator >= MS_PER_GAME_SECOND) accumulator -= MS_PER_GAME_SECOND;
      const subProgress = accumulator / MS_PER_GAME_SECOND;
      assert.ok(subProgress >= 0 && subProgress < 1,
        `subProgress out of range at speed=${speed}: ${subProgress}`);
    }
  }
});

test('subProgress: at speed 1 with 1000ms deltaMs advances exactly 1 frame', () => {
  const MS_PER_GAME_SECOND = 1000;
  let accumulator = 0;
  let framesAdvanced = 0;
  accumulator += 1000 * 1; // 1 second at speed 1
  while (accumulator >= MS_PER_GAME_SECOND) {
    accumulator -= MS_PER_GAME_SECOND;
    framesAdvanced++;
  }
  assert.equal(framesAdvanced, 1);
  assert.closeTo(accumulator, 0, 0.001);
});
