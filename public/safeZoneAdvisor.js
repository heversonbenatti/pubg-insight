const MODEL_URL = '/data/safezone-hotspots.json';

let modelPromise = null;

export function loadSafeZoneModel(fetchImpl = fetch) {
  if (!modelPromise) {
    modelPromise = fetchImpl(MODEL_URL)
      .then(r => {
        if (!r.ok) throw new Error(`safe zone model ${r.status}`);
        return r.json();
      })
      .catch(() => ({ version: 1, maps: {}, loadError: true }));
  }
  return modelPromise;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function phaseKey(phase) {
  const p = Math.max(1, Math.round(asNumber(phase, 1)));
  return String(p);
}

function nearestPhaseData(mapData, phase) {
  const phases = mapData?.phases || {};
  const wanted = Math.max(1, Math.round(asNumber(phase, 1)));
  if (phases[String(wanted)]) return { key: String(wanted), data: phases[String(wanted)] };

  const keys = Object.keys(phases)
    .map(k => parseInt(k, 10))
    .filter(Number.isFinite)
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));

  const key = keys.length ? String(keys[0]) : null;
  return key ? { key, data: phases[key] } : { key: phaseKey(wanted), data: null };
}

export function estimatePhaseFromRadius(radius, mapSize = {}) {
  const extent = Math.max(asNumber(mapSize.width, 816000), asNumber(mapSize.height, 816000));
  const ratio = asNumber(radius, 0) / extent;
  if (ratio <= 0.025) return 8;
  if (ratio <= 0.045) return 7;
  if (ratio <= 0.075) return 6;
  if (ratio <= 0.115) return 5;
  if (ratio <= 0.17) return 4;
  if (ratio <= 0.25) return 3;
  if (ratio <= 0.36) return 2;
  return 1;
}

export function buildFallbackHotspots(phase = 1) {
  const ring = phase >= 6 ? 0.36 : phase >= 4 ? 0.48 : 0.62;
  const radiusNorm = phase >= 5 ? 0.10 : 0.13;
  const angles = [-90, -30, 30, 90, 150, 210];
  const points = [
    { xNorm: 0, yNorm: 0, radiusNorm: radiusNorm * 0.9, score: 0.72, support: 0 },
    ...angles.map((deg, index) => {
      const rad = deg * Math.PI / 180;
      return {
        xNorm: Math.cos(rad) * ring,
        yNorm: Math.sin(rad) * ring,
        radiusNorm,
        score: 0.58 - index * 0.015,
        support: 0,
      };
    }),
  ];
  return points;
}

function distanceToClosestEnemy(candidate, enemies) {
  let min = Infinity;
  for (const enemy of enemies) {
    if (!Number.isFinite(enemy.x) || !Number.isFinite(enemy.y)) continue;
    min = Math.min(min, Math.hypot(enemy.x - candidate.x, enemy.y - candidate.y));
  }
  return min;
}

export function scoreHotspot(candidate, context = {}) {
  const safeRadius = Math.max(1, asNumber(context.safeZone?.radius, 1));
  let score = Math.max(0.0001, asNumber(candidate.baseScore, 1));

  const safeX = asNumber(context.safeZone?.x, 0);
  const safeY = asNumber(context.safeZone?.y, 0);
  const distToCenter = Math.hypot(candidate.x - safeX, candidate.y - safeY);
  if (distToCenter > safeRadius) score *= 0.05;
  else if (distToCenter > safeRadius * 0.94) score *= 0.72;

  const currentTeamId = context.currentTeamId ?? null;
  const enemies = (context.alivePlayers || [])
    .filter(p => currentTeamId === null || p.teamId !== currentTeamId);

  if (enemies.length) {
    const minEnemy = distanceToClosestEnemy(candidate, enemies);
    const dangerRange = Math.max(10000, Math.min(30000, safeRadius * 0.22));
    if (minEnemy < dangerRange) score *= 0.35 + 0.65 * (minEnemy / dangerRange);

    let crowd = 0;
    const crowdRange = Math.max(18000, Math.min(52000, safeRadius * 0.38));
    for (const enemy of enemies) {
      const d = Math.hypot(enemy.x - candidate.x, enemy.y - candidate.y);
      if (d < crowdRange) crowd += 1 - d / crowdRange;
    }
    score /= 1 + crowd * 0.18;
  }

  const centroid = context.teamCentroid;
  if (centroid && Number.isFinite(centroid.x) && Number.isFinite(centroid.y)) {
    const d = Math.hypot(centroid.x - candidate.x, centroid.y - candidate.y);
    const phase = Math.max(1, asNumber(context.phase, 1));
    const moveBudget = Math.max(18000, safeRadius * (phase >= 5 ? 0.85 : 1.35));
    if (d > moveBudget) score *= Math.max(0.48, moveBudget / d);
  }

  return score;
}

export function getSafeZoneAdvice({
  model,
  mapName,
  phase,
  safeZone,
  mapSize,
  alivePlayers = [],
  currentTeamId = null,
  teamCentroid = null,
  limit = 10,
} = {}) {
  if (!safeZone || !Number.isFinite(safeZone.x) || !Number.isFinite(safeZone.y) || !Number.isFinite(safeZone.radius) || safeZone.radius <= 0) {
    return { source: 'none', candidates: [], best: null, phase: phaseKey(phase) };
  }

  const inferredPhase = phase || estimatePhaseFromRadius(safeZone.radius, mapSize);
  const mapData = model?.maps?.[mapName] || null;
  const { key, data } = nearestPhaseData(mapData, inferredPhase);
  const modelHotspots = Array.isArray(data?.hotspots) ? data.hotspots : [];
  const rawHotspots = modelHotspots.length ? modelHotspots : buildFallbackHotspots(asNumber(key, inferredPhase));
  const source = modelHotspots.length ? 'model' : 'fallback';

  const width = asNumber(mapSize?.width, 816000);
  const height = asNumber(mapSize?.height, 816000);
  const context = { safeZone, alivePlayers, currentTeamId, teamCentroid, phase: asNumber(key, inferredPhase) };

  const candidates = rawHotspots.map((h, index) => {
    const xNorm = asNumber(h.xNorm ?? h.nx, 0);
    const yNorm = asNumber(h.yNorm ?? h.ny, 0);
    const x = safeZone.x + xNorm * safeZone.radius;
    const y = safeZone.y + yNorm * safeZone.radius;
    const radius = Math.max(2500, safeZone.radius * Math.max(0.035, asNumber(h.radiusNorm, 0.10)));
    const baseScore = asNumber(h.score ?? h.weight, 1);
    return {
      x,
      y,
      xNorm,
      yNorm,
      radius,
      baseScore,
      support: asNumber(h.support ?? h.count, 0),
      index,
    };
  })
    .filter(c => c.x >= 0 && c.y >= 0 && c.x <= width && c.y <= height)
    .map(c => ({ ...c, score: scoreHotspot(c, context) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    source,
    phase: key,
    requestedPhase: phaseKey(inferredPhase),
    samples: asNumber(data?.samples, 0),
    candidates,
    best: candidates[0] || null,
  };
}
