// Gera scripts/output/insights_global.json — agregado global de:
//
//   - byMap[mapName]: matches, totalKills, totalDamage, killsPerMatch, winRate, etc.
//     Calculado dos 16k+ match files cacheados (cache/matches/<platform>_*.json).
//
//   - byWeapon[WeapXXX_C]: kills/knocks/shots globais + matriz de duelos.
//     Calculado das telemetrias cacheadas em cache/matches/telemetry_*.json
//     (limitado ao que foi baixado — não tenta baixar mais).
//
//   - globalAverages.distributions: mean/median/p25/p75/p90/p99/std das principais
//     métricas POR JOGADOR (kills/match, damage, KDR, etc) — usadas pra calcular
//     percentil quando o usuário pede insights individual. Calculado em memória
//     a partir dos match data agregados por accountId. *Não salva* byPlayer no
//     output (esse é calculado on-demand via /api/insights/player/:name).
//
// Filtra mapas não-playable (sem imagem em public/images/): Camp Jackal, SafeHouse,
// Paramo/Haven removidos, modos como TDM/Heist. Lista canônica em PLAYABLE_MAPS.
//
// Uso:
//   node scripts/build-insights.js [--limit N] [--min-matches K] [--platform steam]

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lê telemetria (.json.gz comprimido ou .json legado) e retorna os eventos.
function readTelemetryFile(file) {
  const buf = fs.readFileSync(file);
  return JSON.parse(file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf.toString('utf8'));
}
const ROOT = path.resolve(__dirname, '..');
const MATCH_DIR = path.join(ROOT, 'cache', 'matches');
const OUT_FILE = path.join(ROOT, 'scripts', 'output', 'insights_global.json');

const DEFAULT_MIN_MATCHES = 3;
const DEFAULT_PLATFORM = 'steam';

// Espelho de public/utils.js → PLAYABLE_MAPS + PLAYABLE_MATCH_TYPES.
// Filtra mapas sem assets (Camp Jackal etc) E modos não-BR (TDM, IBR, Heist,
// Air Royale, eventos, custom, treino) mesmo em mapas válidos.
const PLAYABLE_MAPS = new Set([
  'Baltic_Main', 'Erangel_Main',
  'Desert_Main',
  'Savage_Main',
  'DihorOtok_Main',
  'Summerland_Main',
  'Tiger_Main',
  'Kiki_Main',
  'Neon_Main',
]);
const PLAYABLE_MATCH_TYPES = new Set(['official', 'competitive']);
function isPlayableMatchAttrs(a) {
  return !!a && PLAYABLE_MAPS.has(a.mapName) && PLAYABLE_MATCH_TYPES.has(a.matchType);
}

const DISTANCE_BUCKETS = [
  { key: 'close',    max: 25 },
  { key: 'short',    max: 50 },
  { key: 'med',      max: 100 },
  { key: 'long',     max: 200 },
  { key: 'verylong', max: Infinity },
];
function distanceBucket(meters) {
  if (!Number.isFinite(meters)) return 'unknown';
  for (const b of DISTANCE_BUCKETS) if (meters <= b.max) return b.key;
  return 'verylong';
}

function parseArgs(argv) {
  const args = { limit: 0, minMatches: DEFAULT_MIN_MATCHES, platform: DEFAULT_PLATFORM, out: OUT_FILE };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === '--limit') { args.limit = Math.max(0, parseInt(n, 10) || 0); i++; }
    else if (a === '--min-matches') { args.minMatches = Math.max(1, parseInt(n, 10) || DEFAULT_MIN_MATCHES); i++; }
    else if (a === '--platform') { args.platform = n; i++; }
    else if (a === '--out') { args.out = path.resolve(n); i++; }
  }
  return args;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalizeWeapon(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.replace(/_\d+$/, '');
  if (s.startsWith('Item_Weapon_')) s = 'Weap' + s.slice('Item_Weapon_'.length);
  return s;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(values) {
  const arr = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const sum = arr.reduce((s, v) => s + v, 0);
  const mean = sum / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return {
    n: arr.length,
    mean: round(mean, 4),
    median: round(percentile(arr, 0.5), 4),
    p25: round(percentile(arr, 0.25), 4),
    p75: round(percentile(arr, 0.75), 4),
    p90: round(percentile(arr, 0.9), 4),
    p99: round(percentile(arr, 0.99), 4),
    min: round(arr[0], 4),
    max: round(arr[arr.length - 1], 4),
    std: round(Math.sqrt(variance), 4),
  };
}

// ── Phase A: match data → byMap, distribuições por player (in-memory) ──────
function aggregateMatchData(matchFiles, minMatches) {
  const playerStats = new Map();
  const byMap = {};
  const mapAlias = {
    Baltic_Main: 'Erangel',
    Erangel_Main: 'Erangel',
    Desert_Main: 'Miramar',
    Savage_Main: 'Sanhok',
    DihorOtok_Main: 'Vikendi',
    Summerland_Main: 'Karakin',
    Tiger_Main: 'Taego',
    Kiki_Main: 'Deston',
    Neon_Main: 'Rondo',
  };

  let processed = 0, skipped = 0, skippedMap = 0;
  for (let i = 0; i < matchFiles.length; i++) {
    const f = matchFiles[i];
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const a = d?.data?.attributes;
      if (!a) { skipped++; continue; }
      if (!isPlayableMatchAttrs(a)) { skippedMap++; continue; }
      processed++;

      const mapName = a.mapName;
      if (!byMap[mapName]) {
        byMap[mapName] = {
          mapName,
          displayName: mapAlias[mapName] || mapName,
          matches: 0, totalKills: 0, totalDamage: 0,
          totalSurvival: 0, totalWins: 0, totalDuration: 0,
        };
      }
      const mp = byMap[mapName];
      mp.matches += 1;
      mp.totalDuration += a.duration || 0;

      const participants = (d.included || []).filter(it => it.type === 'participant');
      for (const p of participants) {
        const s = p.attributes?.stats;
        if (!s?.playerId) continue;

        mp.totalKills += s.kills || 0;
        mp.totalDamage += s.damageDealt || 0;
        mp.totalSurvival += s.timeSurvived || 0;
        if (s.winPlace === 1) mp.totalWins += 1;

        const id = s.playerId;
        let ps = playerStats.get(id);
        if (!ps) {
          ps = {
            matches: 0, kills: 0, knocks: 0, deaths: 0,
            damageDealt: 0, headshotKills: 0, longestKill: 0,
            timeSurvived: 0, wins: 0, top10: 0,
            assists: 0, revives: 0, heals: 0, roadKills: 0,
            vehicleDestroys: 0, teamKills: 0, walkDistance: 0, rideDistance: 0,
          };
          playerStats.set(id, ps);
        }
        ps.matches += 1;
        ps.kills += s.kills || 0;
        ps.knocks += s.DBNOs || 0;
        ps.damageDealt += s.damageDealt || 0;
        ps.headshotKills += s.headshotKills || 0;
        ps.assists += s.assists || 0;
        ps.revives += s.revives || 0;
        ps.heals += s.heals || 0;
        ps.roadKills += s.roadKills || 0;
        ps.vehicleDestroys += s.vehicleDestroys || 0;
        ps.teamKills += s.teamKills || 0;
        ps.walkDistance += s.walkDistance || 0;
        ps.rideDistance += s.rideDistance || 0;
        ps.timeSurvived += s.timeSurvived || 0;
        if ((s.longestKill || 0) > ps.longestKill) ps.longestKill = s.longestKill;
        if (s.winPlace === 1) ps.wins += 1;
        if (s.winPlace > 0 && s.winPlace <= 10) ps.top10 += 1;
        // "Deaths" no PUBG match data não é fornecido como contador direto.
        // Aproximação: morreu = (deathType !== 'alive' && winPlace !== 1).
        if (s.deathType && s.deathType !== 'alive' && s.deathType !== 'logout') {
          ps.deaths += 1;
        }
      }
    } catch (e) {
      skipped++;
    }
    if ((i + 1) % 2000 === 0) {
      console.log(`  match data ${i + 1}/${matchFiles.length} (skipped: ${skipped + skippedMap})`);
    }
  }

  // Médias por mapa
  for (const m of Object.values(byMap)) {
    m.killsPerMatch = round(m.totalKills / Math.max(1, m.matches), 2);
    m.damagePerMatch = round(m.totalDamage / Math.max(1, m.matches), 2);
    m.avgSurvivalSec = round(m.totalSurvival / Math.max(1, m.matches), 1);
    m.avgDurationSec = round(m.totalDuration / Math.max(1, m.matches), 1);
    m.winRate = round(m.totalWins / Math.max(1, m.matches), 4);
  }

  // Distribuições calculadas só com jogadores ≥ minMatches
  const eligible = [...playerStats.values()].filter(p => p.matches >= minMatches);
  for (const p of eligible) {
    p.killsPerMatch = p.kills / p.matches;
    p.knocksPerMatch = p.knocks / p.matches;
    p.damagePerMatch = p.damageDealt / p.matches;
    p.avgSurvivalSeconds = p.timeSurvived / p.matches;
    p.headshotRate = p.kills > 0 ? p.headshotKills / p.kills : 0;
    // KDR aproximado: deaths real ou fallback (matches - wins) se deaths==0
    const effDeaths = Math.max(1, p.deaths || (p.matches - p.wins) || 1);
    p.kdr = p.kills / effDeaths;
    p.winRate = p.wins / p.matches;
    p.top10Rate = p.top10 / p.matches;
    p.aggression = (p.kills * 100 + p.damageDealt) / p.matches;
  }

  const distributions = {
    matches: summarize(eligible.map(p => p.matches)),
    killsPerMatch: summarize(eligible.map(p => p.killsPerMatch)),
    knocksPerMatch: summarize(eligible.map(p => p.knocksPerMatch)),
    damagePerMatch: summarize(eligible.map(p => p.damagePerMatch)),
    avgSurvivalSeconds: summarize(eligible.map(p => p.avgSurvivalSeconds)),
    longestKillMeters: summarize(eligible.map(p => p.longestKill)),
    headshotRate: summarize(eligible.map(p => p.headshotRate)),
    kdr: summarize(eligible.map(p => p.kdr)),
    winRate: summarize(eligible.map(p => p.winRate)),
    top10Rate: summarize(eligible.map(p => p.top10Rate)),
    aggression: summarize(eligible.map(p => p.aggression)),
  };

  return {
    byMap,
    distributions,
    matchesProcessed: processed,
    matchesSkipped: skipped,
    matchesSkippedByMap: skippedMap,
    totalPlayers: playerStats.size,
    eligiblePlayers: eligible.length,
  };
}

// ── Phase B: telemetrias → byWeapon + duels ─────────────────────────────────
function findMatchAttrsFor(matchId) {
  // Procura match file que corresponde a esse matchId pra checar map + matchType.
  const candidates = fs.readdirSync(MATCH_DIR)
    .filter(f => f.endsWith(`${matchId}.json`) && !f.startsWith('telemetry_'));
  for (const f of candidates) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(MATCH_DIR, f), 'utf8'));
      const a = d?.data?.attributes;
      if (a?.mapName) return a;
    } catch {}
  }
  return null;
}

function emptyWeaponStats() {
  return {
    kills: 0, knocks: 0, shotsFired: 0,
    damageDealt: 0, headshotKills: 0,
    sumKillDistance: 0, countKillDistance: 0,
    longestKillMeters: 0,
    killsByDistance: { close: 0, short: 0, med: 0, long: 0, verylong: 0, unknown: 0 },
    duels: {},
  };
}

function processTelemetryForWeapons(file, byWeapon) {
  const events = readTelemetryFile(file);
  for (const ev of events) {
    if (!ev || !ev._T) continue;

    if (ev._T === 'LogPlayerKillV2') {
      const dmg = ev.killerDamageInfo || ev.finishDamageInfo || ev.dBNODamageInfo || {};
      if (dmg.damageTypeCategory !== 'Damage_Gun') continue;
      const causer = normalizeWeapon(dmg.damageCauserName);
      if (!causer) continue;
      if (ev.isSuicide || ev.killer?.accountId === ev.victim?.accountId) continue;

      const dist = Number.isFinite(dmg.distance) ? dmg.distance / 100 : null;
      const isHs = dmg.damageReason === 'HeadShot';
      const victimWeapon = normalizeWeapon(ev.victimWeapon);

      if (!byWeapon[causer]) byWeapon[causer] = emptyWeaponStats();
      const w = byWeapon[causer];
      w.kills += 1;
      if (isHs) w.headshotKills += 1;
      if (dist != null) {
        w.sumKillDistance += dist;
        w.countKillDistance += 1;
        if (dist > w.longestKillMeters) w.longestKillMeters = dist;
      }
      w.killsByDistance[distanceBucket(dist)] = (w.killsByDistance[distanceBucket(dist)] || 0) + 1;
      if (victimWeapon && victimWeapon !== causer) {
        w.duels[victimWeapon] = (w.duels[victimWeapon] || 0) + 1;
      }
      continue;
    }

    if (ev._T === 'LogPlayerMakeGroggy') {
      if (ev.damageTypeCategory !== 'Damage_Gun') continue;
      const causer = normalizeWeapon(ev.damageCauserName);
      if (!causer) continue;
      if (!byWeapon[causer]) byWeapon[causer] = emptyWeaponStats();
      byWeapon[causer].knocks += 1;
      continue;
    }

    if (ev._T === 'LogPlayerTakeDamage') {
      if (ev.damageTypeCategory !== 'Damage_Gun') continue;
      const causer = normalizeWeapon(ev.damageCauserName);
      if (!causer) continue;
      if (ev.attacker?.accountId === ev.victim?.accountId) continue;
      const dmg = Math.min(Number(ev.damage || 0), Number(ev.victim?.health || 0));
      if (dmg <= 0) continue;
      if (!byWeapon[causer]) byWeapon[causer] = emptyWeaponStats();
      byWeapon[causer].damageDealt += dmg;
      continue;
    }

    if (ev._T === 'LogPlayerAttack' && ev.weapon?.itemId) {
      const causer = normalizeWeapon(ev.weapon.itemId);
      if (!causer) continue;
      if (!byWeapon[causer]) byWeapon[causer] = emptyWeaponStats();
      byWeapon[causer].shotsFired += 1;
    }
  }
}

function aggregateTelemetries(telFiles) {
  const byWeapon = {};
  let processed = 0, skipped = 0;
  const t0 = Date.now();
  for (let i = 0; i < telFiles.length; i++) {
    const f = telFiles[i];
    const matchId = path.basename(f).replace(/^telemetry_/, '').replace(/\.json(\.gz)?$/, '');
    const attrs = findMatchAttrsFor(matchId);
    // Se conhecemos o match, só processa se for playable. Se não conhecemos
    // (match file não cacheado), processa por inclusão — não dá pra saber.
    if (attrs && !isPlayableMatchAttrs(attrs)) { skipped++; continue; }
    try {
      processTelemetryForWeapons(f, byWeapon);
      processed++;
    } catch {
      skipped++;
    }
    if ((i + 1) % 50 === 0 || i === telFiles.length - 1) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  telemetry ${i + 1}/${telFiles.length} (${el.toFixed(1)}s, skipped: ${skipped})`);
    }
  }
  // Médias
  for (const w of Object.values(byWeapon)) {
    w.avgKillDistance = w.countKillDistance > 0 ? round(w.sumKillDistance / w.countKillDistance, 2) : null;
    w.headshotRate = w.kills > 0 ? round(w.headshotKills / w.kills, 3) : 0;
    w.damagePerShot = w.shotsFired > 0 ? round(w.damageDealt / w.shotsFired, 3) : null;
  }
  return { byWeapon, processed, skipped };
}

function listMatchFiles(args) {
  let files = fs.readdirSync(MATCH_DIR)
    .filter(f => new RegExp(`^${args.platform}_[a-f0-9-]+\\.json$`).test(f))
    .map(f => path.join(MATCH_DIR, f))
    .sort();
  if (args.limit > 0) files = files.slice(0, args.limit);
  return files;
}

function listTelemetryFiles(args) {
  // Aceita .json.gz (novo) e .json (legado). Dedup por matchId, preferindo .gz.
  const byId = new Map();
  for (const f of fs.readdirSync(MATCH_DIR)) {
    const m = f.match(/^telemetry_([a-f0-9-]+)\.json(\.gz)?$/);
    if (!m) continue;
    const id = m[1], isGz = !!m[2];
    if (!byId.has(id) || isGz) byId.set(id, path.join(MATCH_DIR, f));
  }
  let files = [...byId.values()].sort();
  if (args.limit > 0) files = files.slice(0, args.limit);
  return files;
}

function main() {
  const args = parseArgs(process.argv);
  const t0 = Date.now();

  console.log('=== Phase A: match data aggregation ===');
  const matchFiles = listMatchFiles(args);
  console.log(`match files: ${matchFiles.length}`);
  const phaseA = aggregateMatchData(matchFiles, args.minMatches);
  console.log(`processed=${phaseA.matchesProcessed} skippedMap=${phaseA.matchesSkippedByMap} skipped=${phaseA.matchesSkipped}`);
  console.log(`players seen=${phaseA.totalPlayers} eligible (≥${args.minMatches})=${phaseA.eligiblePlayers}`);

  console.log('\n=== Phase B: telemetry-derived byWeapon + duels ===');
  const telFiles = listTelemetryFiles(args);
  console.log(`telemetry files: ${telFiles.length}`);
  const phaseB = aggregateTelemetries(telFiles);
  console.log(`processed=${phaseB.processed} skipped=${phaseB.skipped}`);

  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    platform: args.platform,
    matchesProcessed: phaseA.matchesProcessed,
    matchesSkippedByMap: phaseA.matchesSkippedByMap,
    matchesSkippedOther: phaseA.matchesSkipped,
    telemetriesProcessed: phaseB.processed,
    telemetriesSkipped: phaseB.skipped,
    totalPlayers: phaseA.totalPlayers,
    eligiblePlayers: phaseA.eligiblePlayers,
    minMatchesFilter: args.minMatches,
    byMap: phaseA.byMap,
    byWeapon: phaseB.byWeapon,
    globalAverages: {
      minMatchesFilter: args.minMatches,
      eligiblePlayers: phaseA.eligiblePlayers,
      distributions: phaseA.distributions,
    },
    totals: {
      players: phaseA.totalPlayers,
      eligiblePlayers: phaseA.eligiblePlayers,
      weapons: Object.keys(phaseB.byWeapon).length,
      maps: Object.keys(phaseA.byMap).length,
    },
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(out), 'utf8');
  const sizeKB = (fs.statSync(args.out).size / 1024).toFixed(1);
  console.log(`\nwritten ${args.out} (${sizeKB} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`totals:`, out.totals);
  console.log(`maps:`, Object.fromEntries(Object.entries(phaseA.byMap).map(([k, v]) => [v.displayName, { matches: v.matches, killsPerMatch: v.killsPerMatch }])));
}

main();
