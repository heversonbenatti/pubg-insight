// Crawler snowball de partidas + telemetrias (só playable).
//
// Estratégia: começa de jogadores conhecidos (matches_index) ou de uma seed
// (--seed-player / --seed-match), descobre as partidas recentes deles, baixa
// cada partida (/matches, sem rate limit) + a telemetria (CDN, sem rate limit,
// salva .gz), e dos participantes dessas partidas pega novos jogadores pra
// expandir — e assim por diante. Continua até o cache/matches atingir o limite
// (--limit-gb, default 50) ou você dar Ctrl+C.
//
// Filtros (iguais ao server): só mapas/modos playable. Não-playable vira skip
// marker (não salva). Só persiste partida que tem telemetria baixável.
//
// O gargalo é /players (rate limit 10 req/min no free tier) — batcha 10 ids por
// chamada. /matches e telemetria são livres e rodam em paralelo.
//
// Uso:
//   node scripts/crawl-matches.js [--limit-gb 50] [--platform steam]
//                                 [--seed-player NOME] [--seed-match ID]
//   (sem seed → usa todos os jogadores do matches_index como ponto de partida)
//
// IMPORTANTE: rode com o server (npm start) PARADO — os dois compartilham o
// rate limit da API e escrevem no mesmo matches_index (poderia dar corrida).

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MATCHES_DIR = path.join(ROOT, 'cache', 'matches');
const API_KEY = process.env.API_KEY;

const PLAYABLE_MAPS = new Set([
  'Baltic_Main', 'Erangel_Main', 'Desert_Main', 'Savage_Main',
  'DihorOtok_Main', 'Summerland_Main', 'Tiger_Main', 'Kiki_Main', 'Neon_Main',
]);
const PLAYABLE_TYPES = new Set(['official', 'competitive']);
const isPlayable = a => !!a && PLAYABLE_MAPS.has(a.mapName) && PLAYABLE_TYPES.has(a.matchType);

const MATCH_ID_RE = /^[a-f0-9-]{36}$/i;

function parseArgs(argv) {
  const args = { limitGb: 50, platform: 'steam', seedPlayer: null, seedMatch: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === '--limit-gb') { args.limitGb = parseFloat(n) || 50; i++; }
    else if (a === '--platform') { args.platform = n; i++; }
    else if (a === '--seed-player') { args.seedPlayer = n; i++; }
    else if (a === '--seed-match') { args.seedMatch = n; i++; }
  }
  return args;
}

const args = parseArgs(process.argv);
const PLATFORM = args.platform;
const LIMIT_BYTES = args.limitGb * 1024 ** 3;
const SHARD = `https://api.pubg.com/shards/${PLATFORM}`;
const HEADERS = { Authorization: `Bearer ${API_KEY}`, Accept: 'application/vnd.api+json' };

// ── paths ────────────────────────────────────────────────────────────────────
const matchFile = id => path.join(MATCHES_DIR, `${PLATFORM}_${id}.json`);
const telGzFile = id => path.join(MATCHES_DIR, `telemetry_${id}.json.gz`);
const telRawFile = id => path.join(MATCHES_DIR, `telemetry_${id}.json`);
const skipFile = id => path.join(MATCHES_DIR, `skip_${PLATFORM}_${id}`);
const hasTelemetry = id => fs.existsSync(telGzFile(id)) || fs.existsSync(telRawFile(id));
const hasSkip = id => fs.existsSync(skipFile(id));

// ── matches index (mesmo formato do server) ──────────────────────────────────
const INDEX_FILE = path.join(ROOT, 'cache', `matches_index_${PLATFORM}.json`);
let index = { version: 1, players: {} };
try { index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); index.players = index.players || {}; } catch {}
let indexDirty = false;
function indexMatch(matchData) {
  const matchId = matchData?.data?.id;
  const createdAt = matchData?.data?.attributes?.createdAt;
  if (!matchId) return;
  for (const p of (matchData.included || [])) {
    if (p.type !== 'participant') continue;
    const acc = p.attributes?.stats?.playerId;
    const nm = p.attributes?.stats?.name;
    if (!acc) continue;
    const entry = index.players[acc] || { name: nm || '', matches: [] };
    if (!entry.matches.some(m => m.id === matchId)) { entry.matches.push({ id: matchId, createdAt }); indexDirty = true; }
    if (nm && entry.name !== nm) { entry.name = nm; indexDirty = true; }
    index.players[acc] = entry;
  }
}
function saveIndex() {
  if (!indexDirty) return;
  index.generatedAt = new Date().toISOString();
  try { fs.writeFileSync(INDEX_FILE, JSON.stringify(index), 'utf8'); indexDirty = false; } catch (e) { console.error('index save failed:', e.message); }
}

// ── HTTP com tratamento de 429 ────────────────────────────────────────────────
let apiCalls = 0;
async function authedGet(url, { rateLimited = false } = {}) {
  for (;;) {
    try {
      if (rateLimited) apiCalls++;
      const r = await axios.get(url, { headers: HEADERS });
      return r;
    } catch (e) {
      const code = e.response?.status;
      if (code === 429) {
        const reset = e.response?.headers?.['x-ratelimit-reset'];
        const waitMs = reset ? Math.max(1000, parseInt(reset) * 1000 - Date.now() + 300) : 61000;
        process.stdout.write(`\n[rate limit] aguardando ${(waitMs / 1000).toFixed(0)}s…\n`);
        await sleep(waitMs);
        continue;
      }
      throw e;
    }
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── tamanho do cache (throttled) ──────────────────────────────────────────────
let _lastSizeCheck = 0, _lastSize = 0;
function cacheSizeBytes() {
  if (Date.now() - _lastSizeCheck < 15000) return _lastSize;
  let total = 0;
  try {
    for (const f of fs.readdirSync(MATCHES_DIR)) {
      try { total += fs.statSync(path.join(MATCHES_DIR, f)).size; } catch {}
    }
  } catch {}
  _lastSize = total; _lastSizeCheck = Date.now();
  return total;
}

// ── telemetria ────────────────────────────────────────────────────────────────
// 'cached' | 'downloaded' | 'gone' | 'no-url' | 'error'
async function downloadTelemetry(matchData, matchId) {
  if (hasTelemetry(matchId)) return 'cached';
  const url = matchData.included?.find(i => i.type === 'asset')?.attributes?.URL;
  if (!url) return 'no-url';
  try {
    const r = await axios.get(url, { responseType: 'json', maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 });
    fs.writeFileSync(telGzFile(matchId), zlib.gzipSync(JSON.stringify(r.data)));
    return 'downloaded';
  } catch (e) {
    if (e.response?.status === 404) return 'gone';
    return 'error';
  }
}

// ── estado do crawl ────────────────────────────────────────────────────────────
const seenMatches = new Set();   // matchIds já processados nesta sessão
const seenPlayers = new Set();   // accountIds já expandidos
const matchQueue = [];           // matchIds a processar
const playerQueue = [];          // accountIds a expandir
let stopped = false;
let savedMatches = 0, savedTelemetries = 0, skipped = 0, goneNoTel = 0;

process.on('SIGINT', () => {
  console.log('\n\n[crawl] Ctrl+C — finalizando e salvando índice…');
  stopped = true;
});

// Processa um matchId: fetch /matches → playable? → telemetria → salva + coleta players.
async function processMatch(matchId) {
  if (!MATCH_ID_RE.test(matchId) || seenMatches.has(matchId)) return;
  seenMatches.add(matchId);
  if (hasSkip(matchId)) return;                 // não-playable conhecido

  let matchData;
  const cf = matchFile(matchId);
  if (fs.existsSync(cf) && hasTelemetry(matchId)) {
    // já temos tudo — só usa os participantes pra expandir
    try { matchData = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch { return; }
  } else {
    try {
      const r = await authedGet(`${SHARD}/matches/${matchId}`); // /matches não é rate limited
      matchData = r.data;
    } catch { return; } // 404 (>14d) etc → ignora
  }

  const attrs = matchData?.data?.attributes;
  if (!isPlayable(attrs)) {
    try { fs.writeFileSync(skipFile(matchId), ''); } catch {}
    skipped++;
    collectPlayers(matchData); // ainda aproveita os jogadores pra expandir
    return;
  }

  // playable → precisa de telemetria pra valer a pena guardar
  const st = await downloadTelemetry(matchData, matchId);
  if (st === 'downloaded' || st === 'cached') {
    if (!fs.existsSync(cf)) { try { fs.writeFileSync(cf, JSON.stringify(matchData), 'utf8'); } catch {} }
    if (st === 'downloaded') savedTelemetries++;
    savedMatches++;
    indexMatch(matchData);
  } else {
    goneNoTel++; // telemetria indisponível → não salva (server apagaria mesmo)
  }
  collectPlayers(matchData);
}

function collectPlayers(matchData) {
  for (const p of (matchData?.included || [])) {
    if (p.type !== 'participant') continue;
    const acc = p.attributes?.stats?.playerId;
    if (acc && !seenPlayers.has(acc)) playerQueue.push(acc);
  }
}

// Expande um lote de até 10 jogadores: pega os matchIds recentes deles.
async function expandPlayers(accountIds) {
  const ids = accountIds.filter(a => !seenPlayers.has(a)).slice(0, 10);
  for (const a of ids) seenPlayers.add(a);
  if (!ids.length) return;
  try {
    const r = await authedGet(`${SHARD}/players?filter[playerIds]=${ids.join(',')}`, { rateLimited: true });
    for (const pl of (r.data?.data || [])) {
      for (const m of (pl.relationships?.matches?.data || [])) {
        if (m.id && !seenMatches.has(m.id)) matchQueue.push(m.id);
      }
    }
  } catch (e) {
    console.error('\n[expand] erro:', e.response?.status || e.message);
  }
}

async function processMatchBatch(ids, concurrency = 8) {
  let cursor = 0;
  const worker = async () => { while (cursor < ids.length && !stopped) await processMatch(ids[cursor++]); };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

function progress() {
  const gb = (cacheSizeBytes() / 1024 ** 3).toFixed(2);
  process.stdout.write(`\r[crawl] cache ${gb}/${args.limitGb}GB | salvos ${savedMatches} (+${savedTelemetries} tel) | skip ${skipped} | s/tel ${goneNoTel} | fila: ${matchQueue.length}m/${playerQueue.length}p | apiCalls ${apiCalls}   `);
}

async function main() {
  if (!API_KEY) { console.error('API_KEY ausente no .env'); process.exit(1); }
  console.log(`[crawl] limite ${args.limitGb}GB | platform ${PLATFORM}`);

  // Seeds
  if (args.seedMatch) {
    matchQueue.push(args.seedMatch);
  } else if (args.seedPlayer) {
    try {
      const r = await authedGet(`${SHARD}/players?filter[playerNames]=${encodeURIComponent(args.seedPlayer)}`, { rateLimited: true });
      const pl = r.data?.data?.[0];
      if (pl) for (const m of (pl.relationships?.matches?.data || [])) matchQueue.push(m.id);
    } catch (e) { console.error('seed player erro:', e.message); }
  } else {
    // usa todos os jogadores conhecidos do índice como frontier inicial
    for (const acc of Object.keys(index.players)) playerQueue.push(acc);
    console.log(`[crawl] seed: ${playerQueue.length} jogadores do índice`);
  }

  const startSize = cacheSizeBytes();
  console.log(`[crawl] cache inicial: ${(startSize / 1024 ** 3).toFixed(2)}GB`);

  let sinceSave = 0;
  while (!stopped) {
    if (cacheSizeBytes() >= LIMIT_BYTES) { console.log(`\n[crawl] limite de ${args.limitGb}GB atingido.`); break; }

    if (matchQueue.length) {
      const batch = matchQueue.splice(0, 100);
      await processMatchBatch(batch);
      sinceSave += batch.length;
      if (sinceSave >= 200) { saveIndex(); sinceSave = 0; }
      progress();
      continue;
    }
    if (playerQueue.length) {
      await expandPlayers(playerQueue.splice(0, 10));
      progress();
      continue;
    }
    console.log('\n[crawl] frontier esgotada (sem mais jogadores/partidas pra explorar).');
    break;
  }

  saveIndex();
  console.log(`\n[crawl] fim. salvos ${savedMatches} matches (+${savedTelemetries} telemetrias novas) | skip ${skipped} | sem telemetria ${goneNoTel} | apiCalls(rate-limited) ${apiCalls}`);
  console.log(`[crawl] cache final: ${(cacheSizeBytes() / 1024 ** 3).toFixed(2)}GB`);
  process.exit(0);
}

main();
