import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'AI_training', 'cache');
const SNAPSHOT_DIR = path.join(ROOT, 'AI_training', 'safezone_snapshots');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'safezone-hotspots.json');

const MAP_SIZES = {
  Erangel_Main: 816000,
  Baltic_Main: 816000,
  Desert_Main: 816000,
  DihorOtok_Main: 816000,
  Tiger_Main: 816000,
  Kiki_Main: 816000,
  Neon_Main: 816000,
  Savage_Main: 408000,
  Summerland_Main: 204800,
  Paramo_Main: 306000,
  Range_Main: 816000,
};

function parseArgs(argv) {
  const args = {
    limit: 0,
    concurrency: 3,
    sampleEvery: 10,
    refresh: false,
    noFetch: false,
    maps: null,
    matchId: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--limit') args.limit = parseInt(next, 10) || 0, i++;
    else if (arg === '--concurrency') args.concurrency = Math.max(1, parseInt(next, 10) || 3), i++;
    else if (arg === '--sample-every') args.sampleEvery = Math.max(1, parseInt(next, 10) || 10), i++;
    else if (arg === '--refresh') args.refresh = true;
    else if (arg === '--no-fetch') args.noFetch = true;
    else if (arg === '--maps') args.maps = new Set(String(next || '').split(',').map(s => s.trim()).filter(Boolean)), i++;
    else if (arg === '--match-id') args.matchId = next, i++;
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

function safePart(value) {
  return String(value || 'Unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function matchIdFromFile(file) {
  return path.basename(file).replace(/^match_/, '').replace(/\.json$/, '');
}

function listMatchFiles(args) {
  if (!fs.existsSync(CACHE_DIR)) throw new Error(`Cache dir not found: ${CACHE_DIR}`);
  let files = fs.readdirSync(CACHE_DIR)
    .filter(f => /^match_.+\.json$/.test(f))
    .map(f => path.join(CACHE_DIR, f));

  if (args.matchId) {
    files = files.filter(f => matchIdFromFile(f) === args.matchId);
  }

  if (args.maps) {
    files = files.filter(f => {
      try {
        const mapName = readJson(f).data?.attributes?.mapName;
        return args.maps.has(mapName);
      } catch {
        return false;
      }
    });
  }

  files.sort();
  if (args.limit > 0) files = files.slice(0, args.limit);
  return files;
}

function buildParticipantIndex(matchData) {
  const participantById = new Map();
  const playerByAccount = new Map();

  for (const item of matchData.included || []) {
    if (item.type !== 'participant') continue;
    participantById.set(item.id, item);
    const stats = item.attributes?.stats || {};
    if (stats.playerId) {
      playerByAccount.set(stats.playerId, {
        accountId: stats.playerId,
        name: stats.name || '',
        winPlace: Number(stats.winPlace) || 0,
        timeSurvived: Number(stats.timeSurvived) || 0,
        kills: Number(stats.kills) || 0,
        damageDealt: Number(stats.damageDealt) || 0,
        participantId: item.id,
        teamId: null,
        rosterRank: null,
      });
    }
  }

  for (const item of matchData.included || []) {
    if (item.type !== 'roster') continue;
    const teamId = item.attributes?.stats?.teamId ?? null;
    const rosterRank = item.attributes?.stats?.rank ?? null;
    for (const ref of item.relationships?.participants?.data || []) {
      const participant = participantById.get(ref.id);
      const accountId = participant?.attributes?.stats?.playerId;
      const row = accountId ? playerByAccount.get(accountId) : null;
      if (row) {
        row.teamId = teamId;
        row.rosterRank = rosterRank;
      }
    }
  }

  return playerByAccount;
}

function buildElapsedMapper(events) {
  const timeline = events
    .filter(ev => ev.gameState && ev._D)
    .map(ev => ({ dMs: new Date(ev._D).getTime(), elapsed: Number(ev.gameState.elapsedTime) || 0 }))
    .filter(row => Number.isFinite(row.dMs))
    .sort((a, b) => a.dMs - b.dMs);

  const startMs = new Date(events.find(ev => ev._T === 'LogMatchStart')?._D || timeline[0]?.dMs || 0).getTime();

  return function toElapsed(ev) {
    if (Number.isFinite(ev.elapsedTime)) return Number(ev.elapsedTime);
    const dMs = new Date(ev._D).getTime();
    if (!Number.isFinite(dMs)) return 0;
    if (!timeline.length) return Math.max(0, (dMs - startMs) / 1000);
    if (dMs <= timeline[0].dMs) return timeline[0].elapsed;
    if (dMs >= timeline[timeline.length - 1].dMs) return timeline[timeline.length - 1].elapsed;

    let lo = 0, hi = timeline.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timeline[mid].dMs < dMs) lo = mid + 1;
      else hi = mid;
    }
    const next = timeline[lo];
    const prev = timeline[lo - 1] || next;
    const span = Math.max(1, next.dMs - prev.dMs);
    const ratio = (dMs - prev.dMs) / span;
    return prev.elapsed + (next.elapsed - prev.elapsed) * ratio;
  };
}

function buildIntervals(events, toElapsed) {
  const deaths = new Map();
  const knocks = new Map();

  for (const ev of events) {
    if (!ev._D) continue;
    if ((ev._T === 'LogPlayerKillV2' || ev._T === 'LogPlayerKill') && ev.victim?.accountId && ev.victim?.isDBNO !== true) {
      const list = deaths.get(ev.victim.accountId) || [];
      list.push(toElapsed(ev));
      deaths.set(ev.victim.accountId, list);
    } else if (ev._T === 'LogPlayerMakeGroggy' && ev.victim?.accountId) {
      const list = knocks.get(ev.victim.accountId) || [];
      list.push({ start: toElapsed(ev), end: null });
      knocks.set(ev.victim.accountId, list);
    } else if (ev._T === 'LogPlayerRevive' && ev.victim?.accountId) {
      const list = knocks.get(ev.victim.accountId);
      if (!list) continue;
      const t = toElapsed(ev);
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].end === null && t >= list[i].start) {
          list[i].end = t;
          break;
        }
      }
    }
  }

  for (const [accountId, list] of knocks) {
    const deathList = deaths.get(accountId) || [];
    for (const iv of list) {
      if (iv.end !== null) continue;
      const death = deathList.find(t => t >= iv.start);
      if (death !== undefined) iv.end = death;
    }
  }

  return {
    isDead(accountId, elapsed) {
      const list = deaths.get(accountId) || [];
      return list.some(t => elapsed >= t);
    },
    isKnocked(accountId, elapsed) {
      const list = knocks.get(accountId) || [];
      return list.some(iv => elapsed >= iv.start && (iv.end === null || elapsed < iv.end));
    },
  };
}

function buildPositionIndex(events, toElapsed) {
  const byAccount = new Map();
  for (const ev of events) {
    if (ev._T !== 'LogPlayerPosition' || !ev.character?.accountId || !ev.character?.location) continue;
    const c = ev.character;
    const row = {
      t: toElapsed(ev),
      x: Number(c.location.x),
      y: Number(c.location.y),
      z: Number(c.location.z) || 0,
      health: Number(c.health ?? 0),
      vehicleType: ev.vehicle?.vehicleType || '',
    };
    if (!Number.isFinite(row.x) || !Number.isFinite(row.y) || row.health <= 0) continue;
    const list = byAccount.get(c.accountId) || [];
    list.push(row);
    byAccount.set(c.accountId, list);
  }

  for (const list of byAccount.values()) list.sort((a, b) => a.t - b.t);
  return byAccount;
}

function positionAt(list, elapsed, tolerance = 12) {
  if (!list?.length) return null;
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < elapsed) lo = mid + 1;
    else hi = mid - 1;
  }

  const after = list[lo] || null;
  const before = list[lo - 1] || null;
  if (before && after && before.t <= elapsed && after.t >= elapsed && after.t - before.t <= tolerance * 2) {
    const ratio = (elapsed - before.t) / Math.max(1, after.t - before.t);
    return {
      t: elapsed,
      x: before.x + (after.x - before.x) * ratio,
      y: before.y + (after.y - before.y) * ratio,
      z: before.z + (after.z - before.z) * ratio,
      health: before.health + (after.health - before.health) * ratio,
      vehicleType: before.vehicleType || after.vehicleType || '',
    };
  }

  const best = [before, after]
    .filter(Boolean)
    .sort((a, b) => Math.abs(a.t - elapsed) - Math.abs(b.t - elapsed))[0];
  return best && Math.abs(best.t - elapsed) <= tolerance ? best : null;
}

function phaseTracker() {
  let phase = 0;
  let lastWarningRadius = null;
  return function phaseFor(gs) {
    const warningRadius = Number(gs.poisonGasWarningRadius ?? gs.safetyZoneRadius ?? 0);
    if (warningRadius > 0) {
      if (lastWarningRadius === null || lastWarningRadius <= 0) phase = Math.max(phase, 1);
      else if (warningRadius < lastWarningRadius * 0.85) phase += 1;
      lastWarningRadius = warningRadius;
    }
    return Math.max(phase, 1);
  };
}

function extractSnapshots(events, matchData, options) {
  const attr = matchData.data?.attributes || {};
  const mapName = attr.mapName || 'Unknown';
  const mapSize = MAP_SIZES[mapName] || 816000;
  const playersByAccount = buildParticipantIndex(matchData);
  const toElapsed = buildElapsedMapper(events);
  const intervals = buildIntervals(events, toElapsed);
  const positions = buildPositionIndex(events, toElapsed);
  const getPhase = phaseTracker();
  const sampleEvery = options.sampleEvery || 10;
  let lastSample = -Infinity;

  const gameStates = events
    .filter(ev => ev.gameState)
    .map(ev => ({ ev, elapsed: Number(ev.gameState.elapsedTime) || toElapsed(ev) }))
    .sort((a, b) => a.elapsed - b.elapsed);

  const snapshots = [];
  let lastPhase = 0;
  for (const { ev, elapsed } of gameStates) {
    const gs = ev.gameState;
    const phase = getPhase(gs);
    const roundedElapsed = Math.round(elapsed);
    const phaseChanged = phase !== lastPhase;
    if (!phaseChanged && roundedElapsed - lastSample < sampleEvery) continue;

    const safeX = Number(gs.safetyZonePosition?.x ?? 0);
    const safeY = Number(gs.safetyZonePosition?.y ?? 0);
    const safeRadius = Number(gs.safetyZoneRadius ?? 0);
    if (safeRadius <= 0 || !Number.isFinite(safeX) || !Number.isFinite(safeY)) continue;

    const alivePlayers = [];
    for (const [accountId, meta] of playersByAccount) {
      if (intervals.isDead(accountId, roundedElapsed) || intervals.isKnocked(accountId, roundedElapsed)) continue;
      const pos = positionAt(positions.get(accountId), roundedElapsed);
      if (!pos) continue;
      const distToSafeCenter = Math.hypot(pos.x - safeX, pos.y - safeY);
      alivePlayers.push({
        accountId,
        name: meta.name,
        teamId: meta.teamId,
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        z: Math.round(pos.z),
        health: Math.round(pos.health),
        inVehicle: !!pos.vehicleType && pos.vehicleType !== 'TransportAircraft',
        placement: meta.rosterRank || meta.winPlace || 0,
        timeSurvived: Math.round(meta.timeSurvived || 0),
        distToSafeCenter: Math.round(distToSafeCenter),
        distToSafeEdge: Math.round(distToSafeCenter - safeRadius),
        inSafe: distToSafeCenter <= safeRadius,
        alive: true,
      });
    }

    snapshots.push({
      elapsedTime: roundedElapsed,
      phase,
      safeZone: {
        x: Math.round(safeX),
        y: Math.round(safeY),
        radius: Math.round(safeRadius),
      },
      poisonGasWarning: {
        x: Math.round(gs.poisonGasWarningPosition?.x ?? 0),
        y: Math.round(gs.poisonGasWarningPosition?.y ?? 0),
        radius: Math.round(gs.poisonGasWarningRadius ?? 0),
      },
      numAlivePlayers: Number(gs.numAlivePlayers ?? alivePlayers.length),
      numAliveTeams: Number(gs.numAliveTeams ?? new Set(alivePlayers.map(p => p.teamId)).size),
      players: alivePlayers,
    });

    lastSample = roundedElapsed;
    lastPhase = phase;
  }

  return {
    match: {
      id: matchData.data?.id || '',
      mapName,
      mapSize,
      createdAt: attr.createdAt || '',
      duration: Number(attr.duration) || 0,
      gameMode: attr.gameMode || '',
      shardId: attr.shardId || 'tournament',
      numPlayers: playersByAccount.size,
      numTeams: new Set([...playersByAccount.values()].map(p => p.teamId).filter(v => v !== null)).size,
    },
    totalSnapshots: snapshots.length,
    snapshots,
  };
}

function createAggregate() {
  return { maps: {}, processedMatches: 0, snapshotCount: 0, playerSamples: 0 };
}

function addSnapshotsToAggregate(aggregate, doc) {
  const mapName = doc.match.mapName;
  if (!aggregate.maps[mapName]) aggregate.maps[mapName] = { phases: {} };
  const mapAgg = aggregate.maps[mapName];
  aggregate.processedMatches += 1;

  for (const snap of doc.snapshots || []) {
    const phaseKey = String(Math.max(1, Math.round(snap.phase || 1)));
    if (!mapAgg.phases[phaseKey]) {
      mapAgg.phases[phaseKey] = { samples: 0, playerSamples: 0, buckets: new Map() };
    }
    const phaseAgg = mapAgg.phases[phaseKey];
    phaseAgg.samples += 1;
    aggregate.snapshotCount += 1;

    const safe = snap.safeZone;
    if (!safe?.radius) continue;
    const teamCount = Math.max(1, doc.match.numTeams || 16);
    for (const p of snap.players || []) {
      if (!p.inSafe || p.health <= 0) continue;
      const xNorm = (p.x - safe.x) / safe.radius;
      const yNorm = (p.y - safe.y) / safe.radius;
      if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm) || xNorm * xNorm + yNorm * yNorm > 1) continue;

      const place = Math.max(1, Number(p.placement) || teamCount);
      const placeWeight = 1 + Math.max(0, teamCount + 1 - place) / teamCount * 3.2;
      const survivalAhead = Math.max(0, (Number(p.timeSurvived) || 0) - snap.elapsedTime);
      const survivalWeight = 1 + Math.min(1.4, survivalAhead / 600);
      const lateWeight = 1 + Math.min(0.55, (Number(snap.phase) || 1) / 12);
      const healthWeight = 0.65 + Math.min(1, p.health / 100) * 0.35;
      const weight = placeWeight * survivalWeight * lateWeight * healthWeight;

      const bucketSize = 0.10;
      const key = `${Math.round(xNorm / bucketSize)}:${Math.round(yNorm / bucketSize)}`;
      const bucket = phaseAgg.buckets.get(key) || { weight: 0, x: 0, y: 0, count: 0 };
      bucket.weight += weight;
      bucket.x += xNorm * weight;
      bucket.y += yNorm * weight;
      bucket.count += 1;
      phaseAgg.buckets.set(key, bucket);
      phaseAgg.playerSamples += 1;
      aggregate.playerSamples += 1;
    }
  }
}

function finalizeAggregate(aggregate, args, failures) {
  const maps = {};
  for (const [mapName, mapAgg] of Object.entries(aggregate.maps)) {
    maps[mapName] = { phases: {} };
    for (const [phase, phaseAgg] of Object.entries(mapAgg.phases)) {
      const raw = [...phaseAgg.buckets.values()]
        .map(bucket => ({
          xNorm: bucket.x / bucket.weight,
          yNorm: bucket.y / bucket.weight,
          rawScore: bucket.weight,
          support: bucket.count,
          radiusNorm: Math.max(0.055, Math.min(0.20, 0.045 + Math.sqrt(bucket.count) * 0.006)),
        }))
        .sort((a, b) => b.rawScore - a.rawScore)
        .slice(0, 28);

      const maxScore = raw[0]?.rawScore || 1;
      maps[mapName].phases[phase] = {
        samples: phaseAgg.samples,
        playerSamples: phaseAgg.playerSamples,
        hotspots: raw.map(h => ({
          xNorm: Number(h.xNorm.toFixed(4)),
          yNorm: Number(h.yNorm.toFixed(4)),
          radiusNorm: Number(h.radiusNorm.toFixed(4)),
          score: Number((h.rawScore / maxScore).toFixed(4)),
          support: h.support,
        })),
      };
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'AI_training/cache tournament matches + PUBG telemetry CDN',
    sampleEverySeconds: args.sampleEvery,
    processedMatches: aggregate.processedMatches,
    snapshotCount: aggregate.snapshotCount,
    playerSamples: aggregate.playerSamples,
    failedMatches: failures,
    maps,
  };
}

async function fetchTelemetry(url) {
  const response = await axios.get(url, {
    timeout: 90_000,
    decompress: true,
    responseType: 'json',
    validateStatus: status => status >= 200 && status < 300,
  });
  return response.data;
}

async function processMatch(file, args) {
  const matchData = readJson(file);
  const attr = matchData.data?.attributes || {};
  const matchId = matchData.data?.id || matchIdFromFile(file);
  const mapName = attr.mapName || 'Unknown';
  const snapshotFile = path.join(SNAPSHOT_DIR, safePart(mapName), `${matchId}.json`);

  if (!args.refresh && fs.existsSync(snapshotFile)) {
    return { ok: true, doc: readJson(snapshotFile), reused: true };
  }

  if (args.noFetch) {
    return { ok: false, matchId, error: 'snapshot missing and --no-fetch was used' };
  }

  const telemetryUrl = (matchData.included || []).find(i => i.type === 'asset')?.attributes?.URL;
  if (!telemetryUrl) return { ok: false, matchId, error: 'telemetry URL not found' };

  const telemetry = await fetchTelemetry(telemetryUrl);
  const doc = extractSnapshots(telemetry, matchData, args);
  writeJson(snapshotFile, doc);
  return { ok: true, doc, reused: false };
}

async function main() {
  const args = parseArgs(process.argv);
  const files = listMatchFiles(args);
  const aggregate = createAggregate();
  const failures = {};
  let index = 0;
  let completed = 0;

  console.log(`Safezone hotspot build`);
  console.log(`matches=${files.length} concurrency=${args.concurrency} sampleEvery=${args.sampleEvery}s`);

  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      const matchId = matchIdFromFile(file);
      try {
        const result = await processMatch(file, args);
        completed += 1;
        if (result.ok) {
          addSnapshotsToAggregate(aggregate, result.doc);
          const tag = result.reused ? 'cached' : 'fetched';
          console.log(`[${completed}/${files.length}] ${matchId.slice(0, 8)} ${tag} ${result.doc.match.mapName} snaps=${result.doc.totalSnapshots}`);
        } else {
          failures[matchId] = result.error;
          console.log(`[${completed}/${files.length}] ${matchId.slice(0, 8)} skipped ${result.error}`);
        }
      } catch (err) {
        completed += 1;
        failures[matchId] = err.message;
        console.log(`[${completed}/${files.length}] ${matchId.slice(0, 8)} error ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, files.length) }, worker));
  const model = finalizeAggregate(aggregate, args, failures);
  writeJson(OUT_FILE, model);

  console.log('');
  console.log(`written ${OUT_FILE}`);
  console.log(`processed=${model.processedMatches} snapshots=${model.snapshotCount} playerSamples=${model.playerSamples} failures=${Object.keys(failures).length}`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
