// Random walker que descobre players da PUBG e enche o cache local (playerid +
// matches list + match JSONs). Telemetria é deliberadamente ignorada pra não
// inchar o disco — pode rodar `npm run telemetries` depois pra encher só dos
// matches relevantes.
//
// Algoritmo:
//   1. Bootstrap: lê todos `cache/playerid_<plat>_*.json` (= já visitados)
//      e enfileira nomes não-visitados extraídos dos match files em disco.
//   2. Cada tick: pega até 10 nomes da fila → 1 chamada batch /players (essa
//      conta no rate limit 10/min) → grava playerid + matches_list pra cada
//      jogador retornado → baixa os matches recentes (endpoint /matches é
//      FREE, não conta) → cada match novo adiciona ~60 novos nomes na fila.
//   3. Pausa entre ticks pra respeitar CRAWLER_RPM (default 7 req/min, deixando
//      ~3 req/min de margem pros usuários reais da UI).
//
// Filtros:
//   - bots: playerId começa com `ai.` (em vez de `account.<hex32>`)
//   - nomes com unicode/caracteres não-PUBG: API rejeitaria de qualquer jeito
//   - já visitados: presença de cache/playerid_<plat>_<safe>.json
//
// Uso:
//   node scripts/crawl-players.js                       # steam, 7 rpm
//   node scripts/crawl-players.js --rpm 5               # mais conservador
//   node scripts/crawl-players.js --platform xbox
//   node scripts/crawl-players.js --max-batches 50      # para após 50 batches
//
// Ctrl+C pra parar com graceful shutdown. Estado vive todo em arquivos no
// cache/ — pode parar e voltar a hora que quiser.

import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'cache');
const MATCHES_DIR = path.join(CACHE_DIR, 'matches');

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('API_KEY ausente — copia em .env');
  process.exit(1);
}

const PLAYER_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const ACCOUNT_ID_RE = /^account\.[a-f0-9]{32}$/;
const MATCH_ID_RE = /^[a-f0-9-]{36}$/i;
const VALID_PLATFORMS = new Set(['steam', 'psn', 'xbox', 'kakao', 'stadia']);

function parseArgs(argv) {
  const args = { platform: 'steam', rpm: 7, batch: 10, maxBatches: 0, matchSpacingMs: 200 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === '--platform') { args.platform = String(n); i++; }
    else if (a === '--rpm') { args.rpm = parseInt(n, 10); i++; }
    else if (a === '--batch') { args.batch = parseInt(n, 10); i++; }
    else if (a === '--max-batches') { args.maxBatches = parseInt(n, 10); i++; }
    else if (a === '--match-spacing') { args.matchSpacingMs = parseInt(n, 10); i++; }
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/crawl-players.js [options]

  --platform <p>        steam | psn | xbox | kakao | stadia (default: steam)
  --rpm <n>             chamadas rate-limited por minuto (default: 7, máx 9)
  --batch <n>           nomes por chamada /players (default: 10, máx PUBG: 10)
  --max-batches <n>     para após N batches (default: 0 = sem limite)
  --match-spacing <ms>  delay entre downloads de match (default: 200ms; matches são free)
`);
      process.exit(0);
    }
  }
  if (!VALID_PLATFORMS.has(args.platform)) { console.error('platform inválida'); process.exit(1); }
  if (!Number.isFinite(args.rpm) || args.rpm < 1) args.rpm = 7;
  if (args.rpm > 9) { console.warn('--rpm > 9 não deixa margem pros usuários, capando em 9'); args.rpm = 9; }
  if (!Number.isFinite(args.batch) || args.batch < 1) args.batch = 10;
  if (args.batch > 10) args.batch = 10;
  return args;
}

const args = parseArgs(process.argv);
const PLATFORM = args.platform;
const BATCH_SIZE = args.batch;
const MIN_INTERVAL_MS = Math.ceil(60_000 / args.rpm);

function safeName(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }
const shardUrl = `https://api.pubg.com/shards/${PLATFORM}`;
const playerIdFile = (name) => path.join(CACHE_DIR, `playerid_${PLATFORM}_${safeName(name)}.json`);
const matchesListFile = (name) => path.join(CACHE_DIR, `matches_list_${PLATFORM}_${safeName(name)}.json`);
const matchFile = (id) => path.join(MATCHES_DIR, `${PLATFORM}_${id}.json`);
const matchesIndexFile = path.join(CACHE_DIR, `matches_index_${PLATFORM}.json`);

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(MATCHES_DIR)) fs.mkdirSync(MATCHES_DIR, { recursive: true });

// ── Logging (mesmo formato do server.js) ────────────────────────────────────
let seq = 0;
function log(kind, url) {
  const n = String(++seq).padStart(4, '0');
  const tag = kind === 'PUBG' ? '\x1b[33m[PUBG · authed]\x1b[0m' : '\x1b[36m[PUBLIC      ]\x1b[0m';
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${ts} #${n} ${tag} GET ${url}`);
}

async function pubgGet(url) {
  log('PUBG', url);
  try {
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/vnd.api+json' },
      timeout: 30_000,
    });
    const rem = r.headers['x-ratelimit-remaining'];
    console.log(`       \x1b[32m→ ${r.status}${rem !== undefined ? ` (${rem} left)` : ''}\x1b[0m`);
    return r;
  } catch (e) {
    const code = e.response?.status ?? 'ERR';
    const reset = e.response?.headers?.['x-ratelimit-reset'];
    console.log(`       \x1b[31m→ ${code} ${e.message}\x1b[0m`);
    if (code === 429) {
      const wait = reset ? Math.max(0, parseInt(reset, 10) * 1000 - Date.now()) + 500 : 61_000;
      console.log(`       \x1b[33m↻ rate limited — retrying in ${(wait/1000).toFixed(1)}s\x1b[0m`);
      await sleep(wait);
      return pubgGet(url);
    }
    throw e;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Estado em memória ───────────────────────────────────────────────────────
const visited = new Set();   // safeName(name) → já tem playerid_<plat>_<safe>.json
const queued = new Set();    // safeName(name) → na fila pendente
const queue = [];            // FIFO de nomes brutos a buscar

const stats = { batches: 0, namesQueried: 0, playersFound: 0, matchesDownloaded: 0, ticks: 0 };

let matchesIndex = loadMatchesIndex();
function loadMatchesIndex() {
  if (!fs.existsSync(matchesIndexFile)) return { version: 1, players: {} };
  try { const d = JSON.parse(fs.readFileSync(matchesIndexFile, 'utf8')); if (!d.players) d.players = {}; return d; }
  catch { return { version: 1, players: {} }; }
}
let indexDirty = false;
let indexFlushTimer = null;
function scheduleIndexFlush() {
  if (indexFlushTimer) return;
  indexFlushTimer = setTimeout(() => {
    indexFlushTimer = null;
    if (!indexDirty) return;
    matchesIndex.generatedAt = new Date().toISOString();
    try { fs.writeFileSync(matchesIndexFile, JSON.stringify(matchesIndex), 'utf8'); indexDirty = false; }
    catch (e) { console.error('matches index write failed:', e.message); }
  }, 5000);
}

function enqueueIfNew(name) {
  if (!name || !PLAYER_NAME_RE.test(name)) return false;
  const safe = safeName(name);
  if (visited.has(safe) || queued.has(safe)) return false;
  queue.push(name);
  queued.add(safe);
  return true;
}

function indexParticipants(matchData) {
  const matchId = matchData?.data?.id;
  const createdAt = matchData?.data?.attributes?.createdAt;
  if (!matchId) return 0;
  let added = 0;
  for (const it of (matchData.included || [])) {
    if (it.type !== 'participant') continue;
    const accountId = it.attributes?.stats?.playerId;
    const name = it.attributes?.stats?.name;
    if (!accountId) continue;
    const entry = matchesIndex.players[accountId] || { name, matches: [] };
    if (!entry.matches.some(m => m.id === matchId)) {
      entry.matches.push({ id: matchId, createdAt });
      indexDirty = true;
    }
    if (name && entry.name !== name) { entry.name = name; indexDirty = true; }
    matchesIndex.players[accountId] = entry;
    if (ACCOUNT_ID_RE.test(accountId) && enqueueIfNew(name)) added++;
  }
  if (indexDirty) scheduleIndexFlush();
  return added;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
function bootstrap() {
  const visitedRe = new RegExp(`^playerid_${PLATFORM}_(.+)\\.json$`);
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const m = f.match(visitedRe);
    if (m) visited.add(m[1]);
  }

  let scannedMatches = 0;
  const matchPrefix = `${PLATFORM}_`;
  for (const f of fs.readdirSync(MATCHES_DIR)) {
    if (!f.startsWith(matchPrefix) || f.startsWith('telemetry_') || !f.endsWith('.json')) continue;
    scannedMatches++;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MATCHES_DIR, f), 'utf8'));
      for (const it of (data.included || [])) {
        if (it.type !== 'participant') continue;
        const accountId = it.attributes?.stats?.playerId;
        const name = it.attributes?.stats?.name;
        if (!accountId || !ACCOUNT_ID_RE.test(accountId)) continue;
        enqueueIfNew(name);
      }
    } catch { /* skip arquivos corrompidos */ }
  }
  console.log(`bootstrap: ${scannedMatches} matches escaneados · ${visited.size} já cacheados · ${queue.length} nomes na fila`);
}

// ── Download de match (endpoint /matches é FREE) ────────────────────────────
async function ensureMatch(matchId) {
  if (!MATCH_ID_RE.test(matchId)) return null;
  const f = matchFile(matchId);
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* re-fetch */ }
  }
  try {
    const r = await pubgGet(`${shardUrl}/matches/${matchId}`);
    fs.writeFileSync(f, JSON.stringify(r.data), 'utf8');
    stats.matchesDownloaded++;
    indexParticipants(r.data);
    return r.data;
  } catch {
    return null;
  }
}

// ── Tick: 1 chamada rate-limited + downloads free dos matches descobertos ──
let lastRateLimitedCallAt = 0;
async function paceRateLimited() {
  const since = Date.now() - lastRateLimitedCallAt;
  if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
  lastRateLimitedCallAt = Date.now();
}

async function tick() {
  stats.ticks++;
  if (!queue.length) {
    console.log('fila vazia — encerrando (sem mais nomes pra descobrir)');
    return false;
  }

  const batch = queue.splice(0, BATCH_SIZE);
  for (const n of batch) queued.delete(safeName(n));

  console.log(`\n── batch #${stats.batches + 1} (${batch.length} nomes) · fila=${queue.length} · visitados=${visited.size} ──`);
  console.log(`  ${batch.join(', ')}`);

  await paceRateLimited();
  const url = `${shardUrl}/players?filter[playerNames]=${batch.map(encodeURIComponent).join(',')}`;
  let players = [];
  try {
    const r = await pubgGet(url);
    players = r.data?.data || [];
  } catch (e) {
    if (e.response?.status === 404) {
      // nenhum dos nomes existe — marca todos como visitados pra não retentar
    } else {
      console.error('batch falhou:', e.message);
      for (const n of batch) enqueueIfNew(n); // re-queue pra retry depois
      return true;
    }
  }

  stats.batches++;
  stats.namesQueried += batch.length;
  stats.playersFound += players.length;

  // Marca todos os batched como visitados (encontrados ou não — tombstone em memória)
  for (const n of batch) visited.add(safeName(n));

  // Pra cada player encontrado: persiste id + matches list + baixa matches novos
  for (const p of players) {
    const id = p.id;
    const name = p.attributes?.name;
    if (!id || !name) continue;
    const matchIds = (p.relationships?.matches?.data || [])
      .map(m => m.id)
      .filter(id => MATCH_ID_RE.test(id));

    try { fs.writeFileSync(playerIdFile(name), JSON.stringify(id), 'utf8'); } catch {}
    try { fs.writeFileSync(matchesListFile(name), JSON.stringify(matchIds), 'utf8'); } catch {}

    for (const mid of matchIds) {
      if (fs.existsSync(matchFile(mid))) continue;
      await ensureMatch(mid);
      if (args.matchSpacingMs > 0) await sleep(args.matchSpacingMs);
    }
  }

  console.log(`  → ${players.length}/${batch.length} encontrados · downloads acumulados: ${stats.matchesDownloaded} matches · index: ${Object.keys(matchesIndex.players).length} players`);

  if (args.maxBatches > 0 && stats.batches >= args.maxBatches) {
    console.log(`atingido --max-batches=${args.maxBatches}, encerrando`);
    return false;
  }
  return true;
}

// ── Main loop ───────────────────────────────────────────────────────────────
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) { console.log('forçando saída'); process.exit(1); }
  console.log('\nencerrando após o tick atual... (ctrl+c de novo pra forçar)');
  stopping = true;
});

console.log(`crawler · platform=${PLATFORM} · rpm=${args.rpm} (~1 batch a cada ${(MIN_INTERVAL_MS/1000).toFixed(1)}s) · batch=${BATCH_SIZE}`);
bootstrap();

(async () => {
  try {
    while (!stopping) {
      let cont = false;
      try { cont = await tick(); }
      catch (e) { console.error('tick error:', e.message); await sleep(5000); cont = true; }
      if (!cont) break;
    }
  } finally {
    // Flush final do índice
    if (indexFlushTimer) clearTimeout(indexFlushTimer);
    if (indexDirty) {
      matchesIndex.generatedAt = new Date().toISOString();
      try { fs.writeFileSync(matchesIndexFile, JSON.stringify(matchesIndex), 'utf8'); } catch {}
    }
    console.log('\n── resumo ──');
    console.log(`  ticks:             ${stats.ticks}`);
    console.log(`  batches /players:  ${stats.batches}`);
    console.log(`  nomes consultados: ${stats.namesQueried}`);
    console.log(`  players achados:   ${stats.playersFound}`);
    console.log(`  matches baixados:  ${stats.matchesDownloaded}`);
    console.log(`  visitados (total): ${visited.size}`);
    console.log(`  fila restante:     ${queue.length}`);
  }
})();
