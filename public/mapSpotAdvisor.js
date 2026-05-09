const MODEL_URL = '/data/map-spots.json';

let modelPromise = null;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function loadMapSpotModel(fetchImpl = fetch) {
  if (!modelPromise) {
    modelPromise = fetchImpl(MODEL_URL)
      .then(r => {
        if (!r.ok) throw new Error(`map spot model ${r.status}`);
        return r.json();
      })
      .catch(() => ({ version: 1, maps: {}, loadError: true }));
  }
  return modelPromise;
}

function enemyPressure(spot, alivePlayers, currentTeamId) {
  const enemies = (alivePlayers || []).filter(p => currentTeamId === null || p.teamId !== currentTeamId);
  if (!enemies.length) return 0;

  let pressure = 0;
  const range = Math.max(18000, spot.radius * 3.5);
  for (const enemy of enemies) {
    if (!Number.isFinite(enemy.x) || !Number.isFinite(enemy.y)) continue;
    const d = Math.hypot(enemy.x - spot.x, enemy.y - spot.y);
    if (d < range) pressure += 1 - d / range;
  }
  return pressure;
}

function phaseFit(spot, phase) {
  const phaseUse = spot.phaseUse || {};
  const keys = Object.keys(phaseUse);
  if (!keys.length) return 1;

  const wanted = Math.max(1, Math.round(asNumber(phase, 1)));
  const exact = asNumber(phaseUse[String(wanted)], 0);
  if (exact > 0) return 1 + Math.min(0.35, exact * 0.35);

  let nearest = 0;
  for (const key of keys) {
    const p = parseInt(key, 10);
    if (!Number.isFinite(p)) continue;
    const weight = asNumber(phaseUse[key], 0);
    const closeness = Math.max(0, 1 - Math.abs(p - wanted) / 4);
    nearest = Math.max(nearest, weight * closeness);
  }
  return 0.72 + nearest * 0.28;
}

function safeFit(spot, safeZone) {
  if (!safeZone || !Number.isFinite(safeZone.x) || !Number.isFinite(safeZone.y) || !Number.isFinite(safeZone.radius) || safeZone.radius <= 0) {
    return { visible: true, score: 1, distToSafeEdge: 0 };
  }

  const dist = Math.hypot(spot.x - safeZone.x, spot.y - safeZone.y);
  const edge = safeZone.radius - dist;
  if (edge >= -spot.radius * 0.35) {
    const edgePenalty = edge < spot.radius ? 0.75 + 0.25 * Math.max(0, edge / spot.radius) : 1;
    return { visible: true, score: edgePenalty, distToSafeEdge: edge };
  }

  const nearSafe = dist <= safeZone.radius + Math.max(50000, safeZone.radius * 0.22);
  if (!nearSafe) return { visible: false, score: 0.2, distToSafeEdge: edge };
  return { visible: true, score: 0.32, distToSafeEdge: edge };
}

function distanceFit(spot, teamCentroid, safeRadius) {
  if (!teamCentroid || !Number.isFinite(teamCentroid.x) || !Number.isFinite(teamCentroid.y)) return 1;
  const d = Math.hypot(spot.x - teamCentroid.x, spot.y - teamCentroid.y);
  const budget = Math.max(35000, Math.min(180000, safeRadius * 1.15));
  return d <= budget ? 1 : clamp(budget / d, 0.45, 1);
}

export function scoreMapSpot(spot, context = {}) {
  const safe = safeFit(spot, context.safeZone);
  const pressure = enemyPressure(spot, context.alivePlayers || [], context.currentTeamId ?? null);
  const pressureScore = 1 / (1 + pressure * 0.28);
  const moveScore = distanceFit(spot, context.teamCentroid, asNumber(context.safeZone?.radius, 100000));
  return asNumber(spot.baseScore ?? spot.score, 1) * safe.score * pressureScore * moveScore * phaseFit(spot, context.phase);
}

export function getMapSpotAdvice({
  model,
  mapName,
  safeZone,
  mapSize,
  phase = 1,
  alivePlayers = [],
  currentTeamId = null,
  teamCentroid = null,
  limit = 18,
} = {}) {
  const rawSpots = model?.maps?.[mapName]?.spots || [];
  if (!Array.isArray(rawSpots) || !rawSpots.length) {
    return { source: 'none', spots: [], best: null, totalSpots: 0 };
  }

  const width = asNumber(mapSize?.width, 816000);
  const height = asNumber(mapSize?.height, 816000);
  const context = { safeZone, phase, alivePlayers, currentTeamId, teamCentroid };

  const spots = rawSpots.map((raw, index) => {
    const spot = {
      x: asNumber(raw.x, 0),
      y: asNumber(raw.y, 0),
      radius: Math.max(5000, asNumber(raw.radius, 13000)),
      baseScore: asNumber(raw.score, 1),
      support: asNumber(raw.support, 0),
      matchSupport: asNumber(raw.matchSupport, 0),
      avgDwellSeconds: asNumber(raw.avgDwellSeconds, 0),
      damagePerMinute: asNumber(raw.damagePerMinute, 0),
      phaseUse: raw.phaseUse || {},
      label: raw.label || `Spot ${index + 1}`,
      index,
    };
    const safe = safeFit(spot, safeZone);
    return { ...spot, visible: safe.visible, distToSafeEdge: safe.distToSafeEdge, score: scoreMapSpot(spot, context) };
  })
    .filter(s => s.visible && s.x >= 0 && s.y >= 0 && s.x <= width && s.y <= height)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    source: 'model',
    spots,
    best: spots[0] || null,
    totalSpots: rawSpots.length,
  };
}
