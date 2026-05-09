import { test, assert } from './helpers.js';
import { getMapSpotAdvice, scoreMapSpot } from '../public/mapSpotAdvisor.js';

const model = {
  maps: {
    Baltic_Main: {
      spots: [
        { x: 1000, y: 1000, radius: 100, score: 1, support: 20, matchSupport: 8, avgDwellSeconds: 72, damagePerMinute: 2, phaseUse: { 2: 1 } },
        { x: 5000, y: 5000, radius: 100, score: 0.7, support: 10, matchSupport: 5, avgDwellSeconds: 60, damagePerMinute: 3, phaseUse: { 5: 1 } },
      ],
    },
  },
};

test('mapSpotAdvisor: returns fixed spots for the current map', () => {
  const advice = getMapSpotAdvice({
    model,
    mapName: 'Baltic_Main',
    safeZone: { x: 1000, y: 1000, radius: 1500 },
    mapSize: { width: 2000, height: 2000 },
    phase: 2,
  });

  assert.equal(advice.source, 'model');
  assert.equal(advice.spots.length, 1);
  assert.equal(advice.best.x, 1000);
});

test('mapSpotAdvisor: no map data returns empty advice', () => {
  const advice = getMapSpotAdvice({
    model,
    mapName: 'Desert_Main',
    safeZone: { x: 0, y: 0, radius: 1000 },
  });

  assert.equal(advice.source, 'none');
  assert.equal(advice.spots.length, 0);
});

test('mapSpotAdvisor: enemy pressure lowers score', () => {
  const spot = { x: 1000, y: 1000, radius: 100, score: 1, phaseUse: { 2: 1 } };
  const safeZone = { x: 1000, y: 1000, radius: 2000 };
  const clear = scoreMapSpot(spot, { safeZone, phase: 2, alivePlayers: [], currentTeamId: 1 });
  const contested = scoreMapSpot(spot, { safeZone, phase: 2, alivePlayers: [{ x: 1020, y: 1010, teamId: 2 }], currentTeamId: 1 });
  assert.ok(contested < clear, `contested=${contested} clear=${clear}`);
});

test('mapSpotAdvisor: current phase nudges matching historical phase', () => {
  const phaseTwo = scoreMapSpot(
    { x: 1000, y: 1000, radius: 100, score: 1, phaseUse: { 2: 1 } },
    { safeZone: { x: 1000, y: 1000, radius: 2000 }, phase: 2 }
  );
  const phaseSix = scoreMapSpot(
    { x: 1000, y: 1000, radius: 100, score: 1, phaseUse: { 2: 1 } },
    { safeZone: { x: 1000, y: 1000, radius: 2000 }, phase: 6 }
  );
  assert.ok(phaseTwo > phaseSix, `phaseTwo=${phaseTwo} phaseSix=${phaseSix}`);
});
