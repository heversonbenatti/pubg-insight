import { test, assert } from './helpers.js';
import { buildFallbackHotspots, estimatePhaseFromRadius, getSafeZoneAdvice, scoreHotspot } from '../public/safeZoneAdvisor.js';

test('safeZoneAdvisor: projects model hotspot into current safe zone coordinates', () => {
  const model = {
    maps: {
      Erangel_Main: {
        phases: {
          2: {
            samples: 12,
            hotspots: [{ xNorm: 0.5, yNorm: -0.25, radiusNorm: 0.1, score: 1, support: 8 }],
          },
        },
      },
    },
  };

  const advice = getSafeZoneAdvice({
    model,
    mapName: 'Erangel_Main',
    phase: 2,
    safeZone: { x: 1000, y: 2000, radius: 400 },
    mapSize: { width: 816000, height: 816000 },
  });

  assert.equal(advice.source, 'model');
  assert.equal(advice.best.x, 1200);
  assert.equal(advice.best.y, 1900);
  assert.equal(advice.samples, 12);
});

test('safeZoneAdvisor: falls back when the map has no trained data', () => {
  const advice = getSafeZoneAdvice({
    model: { maps: {} },
    mapName: 'Desert_Main',
    phase: 4,
    safeZone: { x: 5000, y: 5000, radius: 1000 },
    mapSize: { width: 816000, height: 816000 },
  });

  assert.equal(advice.source, 'fallback');
  assert.ok(advice.candidates.length > 0);
  assert.ok(advice.best.x >= 0);
});

test('safeZoneAdvisor: uses nearest trained phase when exact phase is missing', () => {
  const model = {
    maps: {
      Tiger_Main: {
        phases: {
          1: { samples: 3, hotspots: [{ xNorm: 0, yNorm: 0, score: 0.5 }] },
          5: { samples: 7, hotspots: [{ xNorm: 0.2, yNorm: 0, score: 1 }] },
        },
      },
    },
  };

  const advice = getSafeZoneAdvice({
    model,
    mapName: 'Tiger_Main',
    phase: 4,
    safeZone: { x: 100, y: 100, radius: 100 },
    mapSize: { width: 816000, height: 816000 },
  });

  assert.equal(advice.phase, '5');
  assert.equal(advice.best.x, 120);
});

test('safeZoneAdvisor: nearby enemies lower a candidate score', () => {
  const context = {
    safeZone: { x: 0, y: 0, radius: 100000 },
    currentTeamId: 1,
    alivePlayers: [{ x: 1000, y: 0, teamId: 2 }],
  };
  const near = scoreHotspot({ x: 1000, y: 0, baseScore: 1 }, context);
  const far = scoreHotspot({ x: 70000, y: 0, baseScore: 1 }, context);
  assert.ok(near < far, `near=${near} far=${far}`);
});

test('safeZoneAdvisor: phase estimation shrinks as the circle gets smaller', () => {
  const mapSize = { width: 816000, height: 816000 };
  assert.ok(estimatePhaseFromRadius(300000, mapSize) < estimatePhaseFromRadius(30000, mapSize));
});

test('safeZoneAdvisor: fallback hotspots include center and ring options', () => {
  const hotspots = buildFallbackHotspots(3);
  assert.ok(hotspots.length >= 7);
  assert.equal(hotspots[0].xNorm, 0);
  assert.equal(hotspots[0].yNorm, 0);
});
