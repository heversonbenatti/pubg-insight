function asPoint(player) {
  const x = Number(player?.x);
  const y = Number(player?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { ...player, x, y };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function arithmeticCenter(players) {
  return {
    x: players.reduce((sum, p) => sum + p.x, 0) / players.length,
    y: players.reduce((sum, p) => sum + p.y, 0) / players.length,
  };
}

export function geometricMedian(players, iterations = 28) {
  const points = (players || []).map(asPoint).filter(Boolean);
  if (!points.length) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y };

  let center = arithmeticCenter(points);
  for (let i = 0; i < iterations; i++) {
    let weightSum = 0;
    let x = 0;
    let y = 0;

    for (const p of points) {
      const d = Math.max(1e-6, distance(center, p));
      const weight = 1 / d;
      weightSum += weight;
      x += p.x * weight;
      y += p.y * weight;
    }

    const next = { x: x / weightSum, y: y / weightSum };
    if (distance(center, next) < 1) return next;
    center = next;
  }
  return center;
}

function makeCluster(players) {
  const center = geometricMedian(players);
  const distances = players.map(p => distance(center, p));
  const radius = distances.length ? Math.max(...distances) : 0;
  const sse = distances.reduce((sum, d) => sum + d * d, 0);
  const meanDistance = distances.length
    ? distances.reduce((sum, d) => sum + d, 0) / distances.length
    : 0;

  return {
    players,
    center,
    radius,
    meanDistance,
    sse,
  };
}

function bestTwoWaySplit(players) {
  const n = players.length;
  if (n < 2) return null;

  let best = null;
  const allMask = (1 << n) - 1;
  for (let mask = 1; mask < allMask; mask++) {
    if ((mask & 1) === 0) continue;

    const a = [];
    const b = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) a.push(players[i]);
      else b.push(players[i]);
    }
    if (!a.length || !b.length) continue;

    const clusters = [makeCluster(a), makeCluster(b)];
    const totalSse = clusters[0].sse + clusters[1].sse;
    const maxRadius = Math.max(clusters[0].radius, clusters[1].radius);
    const separation = distance(clusters[0].center, clusters[1].center);
    const minSize = Math.min(a.length, b.length);
    const maxSize = Math.max(a.length, b.length);
    const score = totalSse + Math.abs(a.length - b.length) * 0.001;

    if (!best || score < best.score) {
      best = { clusters, totalSse, maxRadius, separation, minSize, maxSize, score };
    }
  }

  return best;
}

function sortedClusters(clusters) {
  return clusters
    .map(cluster => ({ ...cluster, memberCount: cluster.players.length }))
    .sort((a, b) => b.memberCount - a.memberCount || a.radius - b.radius);
}

export function clusterTeamPlayers(players, options = {}) {
  const valid = (players || []).map(asPoint).filter(Boolean);
  if (!valid.length) return [];

  const splitDistance = Math.max(1, Number(options.splitDistance) || 36000);
  const maxClusters = Math.max(1, Number(options.maxClusters) || 2);
  const single = makeCluster(valid);

  if (valid.length === 1 || maxClusters < 2) return sortedClusters([single]);

  if (valid.length === 2) {
    const d = distance(valid[0], valid[1]);
    if (d >= splitDistance * 1.25) {
      return sortedClusters([makeCluster([valid[0]]), makeCluster([valid[1]])])
        .map(cluster => ({ ...cluster, split: true }));
    }
    return sortedClusters([single]);
  }

  const best = bestTwoWaySplit(valid);
  if (!best) return sortedClusters([single]);

  const separated = best.separation >= splitDistance * 0.75;
  const radiusImproved = best.maxRadius <= Math.max(1, single.radius * 0.62);
  const singleLoose = single.radius >= splitDistance * 0.62 || single.meanDistance >= splitDistance * 0.38;
  const balancedSplit = best.minSize >= 2
    && best.separation >= splitDistance * 0.58
    && best.totalSse <= single.sse * 0.58;
  const scoutSplit = best.minSize === 1
    && best.maxSize >= 2
    && best.separation >= splitDistance * 0.85
    && best.totalSse <= single.sse * 0.42;

  if ((separated && singleLoose && radiusImproved) || balancedSplit || scoutSplit) {
    return sortedClusters(best.clusters).map(cluster => ({ ...cluster, split: true }));
  }

  return sortedClusters([single]);
}
