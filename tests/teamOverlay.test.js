/**
 * tests/teamOverlay.test.js
 * Tests for robust squad clustering used by the replay team overlay.
 */

import { clusterTeamPlayers, geometricMedian } from '../public/teamOverlay.js';
import { test, assert } from './helpers.js';

test('team overlay: keeps a 3-player core separate from a far scout', () => {
  const clusters = clusterTeamPlayers([
    { accountId: 'a', x: 0, y: 0 },
    { accountId: 'b', x: 1200, y: 0 },
    { accountId: 'c', x: 0, y: 900 },
    { accountId: 'd', x: 90000, y: 0 },
  ], { splitDistance: 30000 });

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.map(c => c.memberCount), [3, 1]);
  assert.ok(clusters[0].center.x < 2500, `Core center was pulled too far: ${clusters[0].center.x}`);
});

test('team overlay: detects a balanced 2x2 split', () => {
  const clusters = clusterTeamPlayers([
    { accountId: 'a', x: 0, y: 0 },
    { accountId: 'b', x: 1400, y: 0 },
    { accountId: 'c', x: 70000, y: 0 },
    { accountId: 'd', x: 71400, y: 0 },
  ], { splitDistance: 30000 });

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.map(c => c.memberCount), [2, 2]);
});

test('team overlay: does not split a tight squad', () => {
  const clusters = clusterTeamPlayers([
    { accountId: 'a', x: 10000, y: 10000 },
    { accountId: 'b', x: 11800, y: 9800 },
    { accountId: 'c', x: 10600, y: 11600 },
    { accountId: 'd', x: 12400, y: 11200 },
  ], { splitDistance: 30000 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].memberCount, 4);
});

test('team overlay: geometric median reduces moderate outlier pull', () => {
  const players = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 0, y: 1000 },
    { x: 28000, y: 0 },
  ];
  const meanX = players.reduce((sum, p) => sum + p.x, 0) / players.length;
  const median = geometricMedian(players);
  const clusters = clusterTeamPlayers(players, { splitDistance: 40000 });

  assert.equal(clusters.length, 1);
  assert.ok(median.x < meanX * 0.65, `Median x ${median.x} was too close to mean ${meanX}`);
});
