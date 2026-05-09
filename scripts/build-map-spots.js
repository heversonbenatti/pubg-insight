import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_DIR = path.join(ROOT, 'AI_training', 'safezone_snapshots');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'map-spots.json');

const DEFAULTS = {
  minDwellSeconds: 48,
  minElapsedSeconds: 180,
  limitPerMap: 140,
};

function parseArgs(argv) {
  const args = {
    limit: 0,
    maps: null,
    minDwellSeconds: DEFAULTS.minDwellSeconds,
    minElapsedSeconds: DEFAULTS.minElapsedSeconds,
    limitPerMap: DEFAULTS.limitPerMap,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--limit') args.limit = parseInt(next, 10) || 0, i++;
    else if (arg === '--maps') args.maps = new Set(String(next || '').split(',').map(s => s.trim()).filter(Boolean)), i++;
    else if (arg === '--min-dwell') args.minDwellSeconds = Math.max(12, parseInt(next, 10) || DEFAULTS.minDwellSeconds), i++;
    else if (arg === '--min-elapsed') args.minElapsedSeconds = Math.max(0, parseInt(next, 10) || DEFAULTS.minElapsedSeconds), i++;
    else if (arg === '--limit-per-map') args.limitPerMap = Math.max(20, parseInt(next, 10) || DEFAULTS.limitPerMap), i++;
  }

  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

function listSnapshotFiles(args) {
  if (!fs.existsSync(SNAPSHOT_DIR)) throw new Error(`Snapshot dir not found: ${SNAPSHOT_DIR}`);
  const files = [];
  for (const mapDir of fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true })) {
    if (!mapDir.isDirectory()) continue;
    if (args.maps && !args.maps.has(mapDir.name)) continue;
    const fullDir = path.join(SNAPSHOT_DIR, mapDir.name);
    for (const file of fs.readdirSync(fullDir)) {
      if (file.endsWith('.json')) files.push(path.join(fullDir, file));
    }
  }
  files.sort();
  return args.limit > 0 ? files.slice(0, args.limit) : files;
}

function bucketSizeForMap(mapSize) {
  return Math.max(6500, Math.min(14500, Math.round(mapSize * 0.017)));
}

function bucketKey(x, y, bucketSize) {
  return `${Math.round(x / bucketSize)}:${Math.round(y / bucketSize)}`;
}

function createMapAgg(mapName, mapSize) {
  return {
    mapName,
    mapSize,
    bucketSize: bucketSizeForMap(mapSize),
    matchCount: 0,
    buckets: new Map(),
  };
}

function createBucket() {
  return {
    weight: 0,
    x: 0,
    y: 0,
    dwellSeconds: 0,
    damageTaken: 0,
    healthSum: 0,
    segmentCount: 0,
    phaseWeight: new Map(),
    matches: new Set(),
    teams: new Set(),
    players: new Set(),
  };
}

function placeWeight(place, teamCount) {
  const p = Math.max(1, Number(place) || teamCount || 16);
  const teams = Math.max(1, Number(teamCount) || 16);
  if (p === 1) return 2.6;
  if (p <= 4) return 2.15;
  if (p <= Math.ceil(teams * 0.5)) return 1.45;
  return 0.95;
}

function phaseWeight(phase) {
  return 1 + Math.min(0.65, Math.max(1, Number(phase) || 1) * 0.07);
}

function damageWeight(damageTaken, dwellSeconds) {
  const perMinute = dwellSeconds > 0 ? damageTaken / (dwellSeconds / 60) : damageTaken;
  if (perMinute <= 1) return 1.28;
  if (perMinute <= 6) return 1.08;
  if (perMinute <= 14) return 0.82;
  if (perMinute <= 25) return 0.55;
  return 0.28;
}

function addSegment(mapAgg, matchId, segment, teamCount) {
  const duration = segment.end - segment.start;
  if (duration < segment.minDwellSeconds || segment.count < 3) return;

  const avgX = segment.x / segment.posWeight;
  const avgY = segment.y / segment.posWeight;
  const key = bucketKey(avgX, avgY, mapAgg.bucketSize);
  const bucket = mapAgg.buckets.get(key) || createBucket();

  const dwellMinutes = Math.max(0.2, duration / 60);
  const noDamage = damageWeight(segment.damageTaken, duration);
  const placement = placeWeight(segment.placement, teamCount);
  const phase = phaseWeight(segment.avgPhase / Math.max(1, segment.count));
  const health = 0.7 + Math.min(1, segment.avgHealth / Math.max(1, segment.count) / 100) * 0.3;
  const longHold = duration >= 96 ? 1.25 : duration >= 72 ? 1.12 : 1;
  const weight = dwellMinutes * noDamage * placement * phase * health * longHold;

  bucket.weight += weight;
  bucket.x += avgX * weight;
  bucket.y += avgY * weight;
  bucket.dwellSeconds += duration;
  bucket.damageTaken += segment.damageTaken;
  bucket.healthSum += segment.avgHealth / Math.max(1, segment.count);
  bucket.segmentCount += 1;
  bucket.matches.add(matchId);
  bucket.teams.add(`${matchId}:${segment.teamId}`);
  bucket.players.add(`${matchId}:${segment.accountId}`);

  const phaseKey = String(Math.max(1, Math.round(segment.avgPhase / Math.max(1, segment.count))));
  bucket.phaseWeight.set(phaseKey, (bucket.phaseWeight.get(phaseKey) || 0) + weight);
  mapAgg.buckets.set(key, bucket);
}

function closeSegment(mapAgg, matchId, current, teamCount) {
  if (!current) return;
  addSegment(mapAgg, matchId, current, teamCount);
}

function createSegment(row, args) {
  return {
    accountId: row.accountId,
    teamId: row.teamId,
    bucket: row.bucket,
    start: row.elapsedTime,
    end: row.elapsedTime,
    count: 1,
    x: row.x,
    y: row.y,
    posWeight: 1,
    previousHealth: row.health,
    damageTaken: 0,
    avgHealth: row.health,
    avgPhase: row.phase,
    placement: row.placement,
    minDwellSeconds: args.minDwellSeconds,
  };
}

function extendSegment(segment, row) {
  segment.end = row.elapsedTime;
  segment.count += 1;
  segment.x += row.x;
  segment.y += row.y;
  segment.posWeight += 1;
  segment.damageTaken += Math.max(0, segment.previousHealth - row.health);
  segment.previousHealth = row.health;
  segment.avgHealth += row.health;
  segment.avgPhase += row.phase;
  segment.placement = Math.min(segment.placement || row.placement, row.placement || segment.placement || 99);
}

function extractRowsByPlayer(doc, bucketSize, args) {
  const rowsByPlayer = new Map();
  for (const snap of doc.snapshots || []) {
    if ((snap.elapsedTime || 0) < args.minElapsedSeconds) continue;
    if ((snap.safeZone?.radius || 0) <= 0) continue;
    for (const p of snap.players || []) {
      if (!p.alive || p.health <= 0 || p.inVehicle || !p.inSafe) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const accountId = p.accountId || p.name;
      if (!accountId) continue;
      const row = {
        accountId,
        teamId: p.teamId ?? 'unknown',
        elapsedTime: snap.elapsedTime,
        phase: Math.max(1, Number(snap.phase) || 1),
        x: p.x,
        y: p.y,
        health: Math.max(0, Math.min(100, Number(p.health) || 0)),
        placement: Number(p.placement) || 99,
        bucket: bucketKey(p.x, p.y, bucketSize),
      };
      if (!rowsByPlayer.has(accountId)) rowsByPlayer.set(accountId, []);
      rowsByPlayer.get(accountId).push(row);
    }
  }
  return rowsByPlayer;
}

function addDocToAggregate(aggregate, doc, args) {
  const mapName = doc.match?.mapName || 'Unknown';
  const mapSize = Number(doc.match?.mapSize) || 816000;
  if (!aggregate.maps.has(mapName)) aggregate.maps.set(mapName, createMapAgg(mapName, mapSize));
  const mapAgg = aggregate.maps.get(mapName);
  mapAgg.matchCount += 1;

  const matchId = doc.match?.id || `${mapName}-${mapAgg.matchCount}`;
  const teamCount = Number(doc.match?.numTeams) || 16;
  const rowsByPlayer = extractRowsByPlayer(doc, mapAgg.bucketSize, args);

  for (const rows of rowsByPlayer.values()) {
    rows.sort((a, b) => a.elapsedTime - b.elapsedTime);
    let current = null;
    for (const row of rows) {
      const gap = current ? row.elapsedTime - current.end : 0;
      if (!current) {
        current = createSegment(row, args);
      } else if (row.bucket === current.bucket && gap > 0 && gap <= 30) {
        extendSegment(current, row);
      } else {
        closeSegment(mapAgg, matchId, current, teamCount);
        current = createSegment(row, args);
      }
    }
    closeSegment(mapAgg, matchId, current, teamCount);
  }
}

function minMatchSupportFor(mapAgg) {
  return Math.max(4, Math.min(45, Math.round(mapAgg.matchCount * 0.004)));
}

function phaseUseObject(bucket) {
  const total = [...bucket.phaseWeight.values()].reduce((sum, v) => sum + v, 0) || 1;
  const out = {};
  for (const [phase, weight] of bucket.phaseWeight.entries()) {
    const value = weight / total;
    if (value >= 0.02) out[phase] = Number(value.toFixed(4));
  }
  return out;
}

function finalizeMap(mapAgg, args) {
  const minMatchSupport = minMatchSupportFor(mapAgg);
  const candidates = [];

  for (const bucket of mapAgg.buckets.values()) {
    const matchSupport = bucket.matches.size;
    if (matchSupport < minMatchSupport) continue;
    if (bucket.segmentCount < minMatchSupport * 1.5) continue;

    const avgDwell = bucket.dwellSeconds / Math.max(1, bucket.segmentCount);
    const damagePerMinute = bucket.damageTaken / Math.max(0.1, bucket.dwellSeconds / 60);
    if (avgDwell < args.minDwellSeconds) continue;
    if (damagePerMinute > 28) continue;

    const x = bucket.x / bucket.weight;
    const y = bucket.y / bucket.weight;
    const supportFactor = Math.log1p(matchSupport) * Math.log1p(bucket.players.size);
    const dwellFactor = Math.min(2.2, avgDwell / 60);
    const damageFactor = damageWeight(bucket.damageTaken, bucket.dwellSeconds);
    const rawScore = bucket.weight * supportFactor * dwellFactor * damageFactor;

    candidates.push({
      x,
      y,
      radius: Math.round(mapAgg.bucketSize * 0.72),
      rawScore,
      support: bucket.segmentCount,
      matchSupport,
      teamSupport: bucket.teams.size,
      playerSupport: bucket.players.size,
      avgDwellSeconds: avgDwell,
      damagePerMinute,
      phaseUse: phaseUseObject(bucket),
    });
  }

  candidates.sort((a, b) => b.rawScore - a.rawScore);

  const selected = [];
  for (const candidate of candidates) {
    const tooClose = selected.some(s => Math.hypot(s.x - candidate.x, s.y - candidate.y) < Math.max(s.radius, candidate.radius) * 1.25);
    if (tooClose) continue;
    selected.push(candidate);
    if (selected.length >= args.limitPerMap) break;
  }

  const maxScore = selected[0]?.rawScore || 1;
  return {
    mapSize: mapAgg.mapSize,
    matchCount: mapAgg.matchCount,
    bucketSize: mapAgg.bucketSize,
    minMatchSupport,
    spots: selected.map((spot, index) => ({
      label: `Spot ${index + 1}`,
      x: Math.round(spot.x),
      y: Math.round(spot.y),
      radius: spot.radius,
      score: Number((spot.rawScore / maxScore).toFixed(4)),
      support: spot.support,
      matchSupport: spot.matchSupport,
      teamSupport: spot.teamSupport,
      playerSupport: spot.playerSupport,
      avgDwellSeconds: Math.round(spot.avgDwellSeconds),
      damagePerMinute: Number(spot.damagePerMinute.toFixed(2)),
      phaseUse: spot.phaseUse,
    })),
  };
}

function finalizeAggregate(aggregate, args) {
  const maps = {};
  for (const [mapName, mapAgg] of aggregate.maps.entries()) {
    maps[mapName] = finalizeMap(mapAgg, args);
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'AI_training/safezone_snapshots dwell-time fixed map spots',
    minDwellSeconds: args.minDwellSeconds,
    minElapsedSeconds: args.minElapsedSeconds,
    maps,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const files = listSnapshotFiles(args);
  const aggregate = { maps: new Map() };
  console.log(`Map spot build`);
  console.log(`snapshots=${files.length} minDwell=${args.minDwellSeconds}s minElapsed=${args.minElapsedSeconds}s`);

  const started = Date.now();
  files.forEach((file, index) => {
    try {
      const doc = readJson(file);
      addDocToAggregate(aggregate, doc, args);
    } catch (err) {
      console.log(`[${index + 1}/${files.length}] skipped ${path.basename(file)} ${err.message}`);
    }
    const done = index + 1;
    if (done % 250 === 0 || done === files.length) {
      const elapsed = Math.max(1, (Date.now() - started) / 1000);
      const rate = done / elapsed;
      console.log(`[${done}/${files.length}] ${rate.toFixed(1)} files/s`);
    }
  });

  const model = finalizeAggregate(aggregate, args);
  writeJson(OUT_FILE, model);

  console.log('');
  console.log(`written ${OUT_FILE}`);
  for (const [mapName, map] of Object.entries(model.maps)) {
    console.log(`${mapName}: matches=${map.matchCount} spots=${map.spots.length} minSupport=${map.minMatchSupport}`);
  }
}

main();
