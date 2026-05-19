import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
// Reverse proxy em produção (Render/Heroku/Cloudflare): confia em 1 hop pra
// req.ip pegar o IP real do cliente (necessário pro rate limit funcionar).
app.set('trust proxy', 1);

const API_KEY = process.env.API_KEY;
const VALID_PLATFORMS = new Set(['steam', 'psn', 'xbox', 'kakao', 'stadia']);

// Formatos esperados da PUBG API. Validar estritamente evita path traversal
// (matchId/season entram em nomes de arquivo cacheados em disco).
const MATCH_ID_RE = /^[a-f0-9-]{36}$/i;          // UUID
const SEASON_ID_RE = /^[a-z0-9._-]{1,80}$/i;     // ex: division.bro.official.pc-2018-41
const PLAYER_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;  // PUBG name (max 16 na prática, margem)

// Leaderboard usa platform-region (não platform), e modos ranked permitidos.
const VALID_LEADERBOARD_SHARDS = new Set([
    'pc-as', 'pc-eu', 'pc-jp', 'pc-krjp', 'pc-kakao', 'pc-na', 'pc-oc', 'pc-ru', 'pc-sa', 'pc-sea',
    'psn-as', 'psn-eu', 'psn-na', 'psn-oc',
    'xbox-as', 'xbox-eu', 'xbox-na', 'xbox-oc', 'xbox-sa',
]);
const LEADERBOARD_MODE_OPTIONS = [
    { value: 'squad-fpp', label: 'Squad FPP' },
    { value: 'squad',     label: 'Squad TPP' },
    { value: 'duo-fpp',   label: 'Duo FPP'   },
    { value: 'duo',       label: 'Duo TPP'   },
    { value: 'solo-fpp',  label: 'Solo FPP'  },
    { value: 'solo',      label: 'Solo TPP'  },
];
const VALID_RANKED_MODES = new Set(LEADERBOARD_MODE_OPTIONS.map(m => m.value));
// If the API returns the same ranked board for multiple mode URLs, keep one
// canonical request and hide the duplicate mode choices in the UI.
const LEADERBOARD_DUPLICATE_MODE_PRIORITY = ['squad', 'squad-fpp', 'duo', 'duo-fpp', 'solo', 'solo-fpp'];

function shardUrl(platform) {
    const p = VALID_PLATFORMS.has(platform) ? platform : 'steam';
    return `https://api.pubg.com/shards/${p}`;
}

function pubgHeaders() {
    return { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' };
}

// ── External call logger ────────────────────────────────────────────────────
// Every outbound request goes through one of these so the terminal shows
// exactly what hit the network (private = uses our API key, public = no key).
let _apiCallSeq = 0;
function _logApi(kind, url) {
    const n = String(++_apiCallSeq).padStart(4, '0');
    const tag = kind === 'PUBG'
        ? '\x1b[33m[PUBG · authed]\x1b[0m'
        : '\x1b[36m[PUBLIC      ]\x1b[0m';
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`${ts} #${n} ${tag} GET ${url}`);
}

async function pubgGet(url, opts = {}) {
    _logApi('PUBG', url);
    try {
        const r = await axios.get(url, { headers: pubgHeaders(), ...opts });
        const rem = r.headers['x-ratelimit-remaining'];
        const tag = rem !== undefined ? ` (${rem} left)` : '';
        console.log(`       \x1b[32m→ ${r.status}${tag}\x1b[0m`);
        return r;
    } catch (e) {
        const code = e.response?.status ?? 'ERR';
        const rem = e.response?.headers?.['x-ratelimit-remaining'];
        const reset = e.response?.headers?.['x-ratelimit-reset'];
        const tag = rem !== undefined ? ` (${rem} left)` : '';
        console.log(`       \x1b[31m→ ${code}${tag} ${e.message}\x1b[0m`);
        if (code === 429) {
            const waitMs = reset ? Math.max(0, parseInt(reset) * 1000 - Date.now()) + 200 : 61000;
            console.log(`       \x1b[33m↻ rate limited — retrying in ${(waitMs / 1000).toFixed(1)}s\x1b[0m`);
            await new Promise(r => setTimeout(r, waitMs));
            return pubgGet(url, opts);
        }
        throw e;
    }
}


// ── Security headers ────────────────────────────────────────────────────────
// CSP frouxa o suficiente pros recursos legítimos (Google Fonts) e nada além.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
        },
    },
    // Permite que <canvas> faça toDataURL em imagens do mesmo origin (replay 2D).
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// ── Rate limit ──────────────────────────────────────────────────────────────
// Protege o endpoint /api/* contra abuso (cada chamada autenticada conta no
// rate limit da PUBG API, então um spammer queima nossa key inteira).
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,                    // 60 req/min por IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, slow down.' },
});
app.use('/api/', apiLimiter);

app.use(express.static('public'));
app.use('/pubg-api-assets', express.static('pubg-api-assets'));

// Cache em disco fora do static root — não deve vazar publicamente (IDs/match
// histórico de jogadores). Arquivos sob `cache/` nunca são servidos diretamente.
const cacheDir = path.join(__dirname, 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
const matchCacheDir = path.join(cacheDir, 'matches');
if (!fs.existsSync(matchCacheDir)) fs.mkdirSync(matchCacheDir, { recursive: true });

const SEASONS_TTL      = 24 * 60 * 60 * 1000;   // 24h
const PLAYERID_TTL     = 24 * 60 * 60 * 1000;   // 24h — playerId is stable
const PLAYER_TTL       = 10 * 60 * 1000;        // 10min (current season only)
const MATCHES_LIST_TTL = 5  * 60 * 1000;        // 5min
const MATCH_TTL        = Number.MAX_SAFE_INTEGER;   // forever — matches are immutable and API drops them after 14d
const LEADERBOARD_TTL  = 2 * 60 * 60 * 1000;    // 2h — API updates leaderboard every 2h
const FOREVER          = Number.MAX_SAFE_INTEGER; // past seasons are immutable
const LEADERBOARD_CACHE_VERSION = 2;
const LEADERBOARD_MODES_CACHE_VERSION = 1;

function safeName(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

function readCache(file, ttl) {
    if (!fs.existsSync(file)) return null;
    if (Date.now() - fs.statSync(file).mtimeMs > ttl) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeCache(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data), 'utf8'); }
    catch (e) { console.error('Cache write failed:', e.message); }
}

function leaderboardCacheFile(shard, season, gameMode) {
    return path.join(cacheDir, `leaderboard_${shard}_${safeName(season)}_${gameMode}.json`);
}

function leaderboardModesCacheFile(shard, season) {
    return path.join(cacheDir, `leaderboard_modes_${shard}_${safeName(season)}.json`);
}

function parseLeaderboardPlayers(data) {
    return (data.included || [])
        .filter(p => p.type === 'player')
        .map(p => ({
            accountId: p.id,
            name: p.attributes?.name,
            rank: p.attributes?.rank,
            ...(p.attributes?.stats || {}),
        }))
        .sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
}

function leaderboardSignature(players) {
    const source = players.map(p => [
        p.rank,
        p.accountId,
        p.name,
        p.rankPoints,
        p.averageDamage,
        p.averageKill,
        p.winRatio,
        p.wins,
        p.games,
    ].join(':')).join('|');
    return crypto.createHash('sha1').update(source).digest('hex');
}

function leaderboardModePriority(mode) {
    const idx = LEADERBOARD_DUPLICATE_MODE_PRIORITY.indexOf(mode);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function readLeaderboardCache(cacheFile, shard, season, gameMode) {
    const cached = readCache(cacheFile, LEADERBOARD_TTL);
    if (!cached) return null;
    if (cached.cacheVersion !== LEADERBOARD_CACHE_VERSION) return null;
    if (cached.shard !== shard || cached.season !== season || cached.gameMode !== gameMode) return null;
    if (!Array.isArray(cached.players)) return null;
    return cached;
}

async function fetchLeaderboard(shard, season, gameMode) {
    const cacheFile = leaderboardCacheFile(shard, season, gameMode);
    const cached = readLeaderboardCache(cacheFile, shard, season, gameMode);
    if (cached) return cached;

    const r = await pubgGet(`https://api.pubg.com/shards/${shard}/leaderboards/${season}/${gameMode}`);
    const result = {
        cacheVersion: LEADERBOARD_CACHE_VERSION,
        shard,
        season,
        gameMode,
        generatedAt: new Date().toISOString(),
        players: parseLeaderboardPlayers(r.data),
    };
    writeCache(cacheFile, result);
    return result;
}

function readLeaderboardModesCache(cacheFile, shard, season) {
    const cached = readCache(cacheFile, LEADERBOARD_TTL);
    if (!cached) return null;
    if (cached.cacheVersion !== LEADERBOARD_MODES_CACHE_VERSION) return null;
    if (cached.shard !== shard || cached.season !== season) return null;
    if (!Array.isArray(cached.modes)) return null;
    return cached;
}

async function fetchAvailableLeaderboardModes(shard, season) {
    const cacheFile = leaderboardModesCacheFile(shard, season);
    const cached = readLeaderboardModesCache(cacheFile, shard, season);
    if (cached) return cached;

    const groups = new Map();
    const unavailable = [];
    const failures = [];

    for (const mode of LEADERBOARD_MODE_OPTIONS) {
        try {
            const leaderboard = await fetchLeaderboard(shard, season, mode.value);
            if (!leaderboard.players.length) {
                unavailable.push(mode.value);
                continue;
            }

            const signature = leaderboardSignature(leaderboard.players);
            const group = groups.get(signature) || { signature, modes: [], players: leaderboard.players.length };
            group.modes.push({ ...mode, players: leaderboard.players.length });
            groups.set(signature, group);
        } catch (error) {
            const code = error.response?.status;
            if (code === 404 || code === 422) {
                unavailable.push(mode.value);
            } else {
                failures.push({ mode: mode.value, status: code || 'ERR' });
                console.error(`Leaderboard mode discovery failed for ${shard}/${season}/${mode.value}:`, error.message);
            }
        }
    }

    if (!groups.size && failures.length) {
        const e = new Error('Failed to discover leaderboard modes');
        e.failures = failures;
        throw e;
    }

    const allModesDuplicate = groups.size === 1 && [...groups.values()][0].modes.length > 1;
    const modes = [...groups.values()].map(group => {
        const representative = group.modes
            .slice()
            .sort((a, b) => leaderboardModePriority(a.value) - leaderboardModePriority(b.value))[0];
        return {
            value: representative.value,
            label: allModesDuplicate ? 'Ranked' : representative.label,
            players: group.players,
            duplicateModes: group.modes.map(m => m.value).filter(value => value !== representative.value),
        };
    }).sort((a, b) => leaderboardModePriority(a.value) - leaderboardModePriority(b.value));

    const result = {
        cacheVersion: LEADERBOARD_MODES_CACHE_VERSION,
        shard,
        season,
        generatedAt: new Date().toISOString(),
        modes,
        unavailable,
        failures,
    };
    writeCache(cacheFile, result);
    return result;
}

app.get('/api/seasons', async (req, res) => {
    const platform = req.query.platform || 'steam';
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });

    const cacheFile = path.join(cacheDir, `seasons_${platform}.json`);
    const cached = readCache(cacheFile, SEASONS_TTL);
    if (cached) return res.json(cached);

    try {
        const r = await pubgGet(`${shardUrl(platform)}/seasons`);
        writeCache(cacheFile, r.data.data);
        res.json(r.data.data);
    } catch (error) {
        console.error('Error fetching seasons:', error.message);
        res.status(500).json({ error: 'Failed to fetch seasons from API' });
    }
});

// Top 500 jogadores ranked por modo+região. Shard usa platform-region (pc-sa,
// pc-na, etc), diferente do resto da API. Cache 2h (mesma cadência do upstream).
app.get('/api/leaderboard/modes', async (req, res) => {
    const { shard, season } = req.query;
    if (!VALID_LEADERBOARD_SHARDS.has(shard)) return res.status(400).json({ error: 'Invalid shard' });
    if (!SEASON_ID_RE.test(season || '')) return res.status(400).json({ error: 'Invalid season id' });

    try {
        res.json(await fetchAvailableLeaderboardModes(shard, season));
    } catch (error) {
        console.error('Error discovering leaderboard modes:', error.message);
        res.status(500).json({ error: 'Failed to discover leaderboard modes' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    const { shard, season, gameMode } = req.query;
    if (!VALID_LEADERBOARD_SHARDS.has(shard)) return res.status(400).json({ error: 'Invalid shard' });
    if (!SEASON_ID_RE.test(season || '')) return res.status(400).json({ error: 'Invalid season id' });
    if (!VALID_RANKED_MODES.has(gameMode)) return res.status(400).json({ error: 'Invalid game mode' });

    try {
        res.json(await fetchLeaderboard(shard, season, gameMode));
    } catch (error) {
        const code = error.response?.status;
        if (code === 404 || code === 422) {
            return res.status(404).json({ error: 'No leaderboard data for this region & mode' });
        }
        console.error('Error fetching leaderboard:', error.message);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/player/:playerName', async (req, res) => {
    const { playerName } = req.params;
    const { season, platform = 'steam' } = req.query;
    if (!season) return res.status(400).json({ error: 'Season parameter is required' });
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!PLAYER_NAME_RE.test(playerName)) return res.status(400).json({ error: 'Invalid player name' });
    if (!SEASON_ID_RE.test(season)) return res.status(400).json({ error: 'Invalid season id' });

    const cacheFile = path.join(cacheDir, `player_${platform}_${safeName(playerName)}_${safeName(season)}.json`);
    const seasonsMeta = readCache(path.join(cacheDir, `seasons_${platform}.json`), SEASONS_TTL) || [];
    const isCurrent = seasonsMeta.find(s => s.id === season)?.attributes?.isCurrentSeason ?? true;
    const cached = readCache(cacheFile, isCurrent ? PLAYER_TTL : FOREVER);
    if (cached) return res.json(cached);

    try {
        const playerId = await getPlayerId(platform, playerName);
        if (!playerId) return res.json({ error: 'Player not found' });

        const statsResponse = await pubgGet(
            `${shardUrl(platform)}/players/${playerId}/seasons/${season}`
        );
        const s = statsResponse.data.data.attributes.gameModeStats;
        const result = {
            player: { name: playerName, id: playerId, platform },
            stats: {
                fpp: { solo: s['solo-fpp'] || {}, duo: s['duo-fpp'] || {}, squad: s['squad-fpp'] || {} },
                tpp: { solo: s['solo']     || {}, duo: s['duo']     || {}, squad: s['squad']     || {} }
            }
        };
        writeCache(cacheFile, result);
        res.json(result);
    } catch (error) {
        console.error('Error fetching player stats:', error.message);
        res.status(500).json({ error: 'Player not found or API error' });
    }
});

// Ranked é separado do gameModeStats e disponível só da Season 7 em diante.
// 404 da API (player não jogou ranked) é silenciado como objeto vazio — o front
// decide se mostra painel quando há dados, sem ruído pra quem só joga casual.
app.get('/api/player/:playerName/ranked', async (req, res) => {
    const { playerName } = req.params;
    const { season, platform = 'steam' } = req.query;
    if (!season) return res.status(400).json({ error: 'Season parameter is required' });
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!PLAYER_NAME_RE.test(playerName)) return res.status(400).json({ error: 'Invalid player name' });
    if (!SEASON_ID_RE.test(season)) return res.status(400).json({ error: 'Invalid season id' });

    const cacheFile = path.join(cacheDir, `ranked_${platform}_${safeName(playerName)}_${safeName(season)}.json`);
    const seasonsMeta = readCache(path.join(cacheDir, `seasons_${platform}.json`), SEASONS_TTL) || [];
    const isCurrent = seasonsMeta.find(s => s.id === season)?.attributes?.isCurrentSeason ?? true;
    const cached = readCache(cacheFile, isCurrent ? PLAYER_TTL : FOREVER);
    if (cached) return res.json(cached);

    try {
        const playerId = await getPlayerId(platform, playerName);
        if (!playerId) return res.json({ error: 'Player not found' });

        let rankedStats = {};
        try {
            const r = await pubgGet(`${shardUrl(platform)}/players/${playerId}/seasons/${season}/ranked`);
            rankedStats = r.data.data.attributes.rankedGameModeStats || {};
        } catch (e) {
            // 404 = player nunca jogou ranked nessa season; devolve vazio sem 500
            if (e.response?.status !== 404) throw e;
        }
        const result = {
            player: { name: playerName, id: playerId, platform },
            ranked: {
                fpp: { solo: rankedStats['solo-fpp'] || null, duo: rankedStats['duo-fpp'] || null, squad: rankedStats['squad-fpp'] || null },
                tpp: { solo: rankedStats['solo']     || null, duo: rankedStats['duo']     || null, squad: rankedStats['squad']     || null }
            }
        };
        writeCache(cacheFile, result);
        res.json(result);
    } catch (error) {
        console.error('Error fetching ranked stats:', error.message);
        res.status(500).json({ error: 'Failed to fetch ranked stats' });
    }
});

const matchInflight = new Map();
async function getMatch(platform, matchId) {
    // matchId vem de fontes externas (API e cache); rejeita qualquer coisa que
    // não seja UUID antes de virar nome de arquivo.
    if (!VALID_PLATFORMS.has(platform) || !MATCH_ID_RE.test(matchId)) return null;
    const cacheFile = path.join(matchCacheDir, `${platform}_${matchId}.json`);
    const cached = readCache(cacheFile, MATCH_TTL);
    if (cached) return cached;

    const inflightKey = `${platform}_${matchId}`;
    if (matchInflight.has(inflightKey)) return matchInflight.get(inflightKey);

    const promise = (async () => {
        try {
            const r = await pubgGet(`${shardUrl(platform)}/matches/${matchId}`);
            writeCache(cacheFile, r.data);
            indexMatch(platform, r.data);
            return r.data;
        } catch { return null; }
        finally { matchInflight.delete(inflightKey); }
    })();
    matchInflight.set(inflightKey, promise);
    return promise;
}

// ── Matches index ────────────────────────────────────────────────────────────
// Mapeia accountId → [{matchId, createdAt}] a partir dos match files cacheados.
// Permite incluir partidas que já dropparam do server da PUBG (>14d) no histórico
// do player. Atualizado on-the-fly toda vez que getMatch() baixa um match novo,
// e regenerável via scripts/build-matches-index.js.

function matchesIndexFile(platform) {
    return path.join(cacheDir, `matches_index_${platform}.json`);
}

const matchesIndexCache = new Map();   // platform → { mtimeMs, data }
function loadMatchesIndex(platform) {
    const file = matchesIndexFile(platform);
    const mtimeMs = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
    const cached = matchesIndexCache.get(platform);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;
    // Mtime mudou (provável: scripts/crawl-players.js gravou novas entradas) — recarrega.
    let data = { version: 1, players: {} };
    if (mtimeMs > 0) {
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { /* keep empty */ }
    }
    if (!data.players) data.players = {};
    matchesIndexCache.set(platform, { mtimeMs, data });
    return data;
}

function saveMatchesIndex(platform) {
    const entry = matchesIndexCache.get(platform);
    if (!entry) return;
    const file = matchesIndexFile(platform);
    try {
        fs.writeFileSync(file, JSON.stringify(entry.data), 'utf8');
        entry.mtimeMs = fs.statSync(file).mtimeMs;
    } catch (e) { console.error('matches index write failed:', e.message); }
}

// Extrai todos os participants do match data (formato JSON:API da PUBG).
function matchParticipants(matchData) {
    const matchId = matchData?.data?.id;
    const createdAt = matchData?.data?.attributes?.createdAt;
    if (!matchId) return [];
    return (matchData.included || [])
        .filter(it => it.type === 'participant')
        .map(p => ({
            accountId: p.attributes?.stats?.playerId,
            name: p.attributes?.stats?.name,
            matchId,
            createdAt,
        }))
        .filter(p => p.accountId && p.matchId);
}

function indexMatch(platform, matchData) {
    const participants = matchParticipants(matchData);
    if (!participants.length) return;
    const index = loadMatchesIndex(platform);
    let dirty = false;
    for (const p of participants) {
        const entry = index.players[p.accountId] || { name: p.name, matches: [] };
        if (!entry.matches.some(m => m.id === p.matchId)) {
            entry.matches.push({ id: p.matchId, createdAt: p.createdAt });
            dirty = true;
        }
        if (p.name && entry.name !== p.name) { entry.name = p.name; dirty = true; }
        index.players[p.accountId] = entry;
    }
    if (dirty) {
        index.generatedAt = new Date().toISOString();
        saveMatchesIndex(platform);
    }
}

// Retorna matchIds do player no índice local (ordem mais recente primeiro).
function localMatchIdsFor(platform, accountId) {
    if (!accountId) return [];
    const index = loadMatchesIndex(platform);
    const entry = index.players[accountId];
    if (!entry?.matches?.length) return [];
    return entry.matches
        .slice()
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .map(m => m.id);
}

app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    const { platform = 'steam' } = req.query;
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!PLAYER_NAME_RE.test(playerName)) return res.status(400).json({ error: 'Invalid player name' });

    const listCacheFile = path.join(cacheDir, `matches_list_${platform}_${safeName(playerName)}.json`);
    let matchIds = readCache(listCacheFile, MATCHES_LIST_TTL);
    let playerId = null;

    try {
        if (!matchIds) {
            // Share the inflight/cache with /career to avoid a duplicate /players call.
            // getPlayerId() writes matchIds to listCacheFile as a side effect when it fetches.
            playerId = await getPlayerId(platform, playerName);
            if (!playerId) return res.status(404).json({ error: 'Player not found' });
            matchIds = readCache(listCacheFile, MATCHES_LIST_TTL);
            if (!matchIds) {
                // playerid was cached (24h) but matchIds TTL (5min) expired — fetch separately
                const r = await pubgGet(`${shardUrl(platform)}/players/${playerId}`);
                matchIds = r.data.data.relationships.matches.data.map(m => m.id);
                writeCache(listCacheFile, matchIds);
            }
        } else {
            // matchIds está em cache mas precisamos do playerId pro índice local
            playerId = await getPlayerId(platform, playerName);
        }

        // Merge API matchIds + matches cacheados localmente (já dropparam do server PUBG mas
        // continuam no disco). Dedup + preserva ordem da API no topo.
        //
        // Match-only-local sem telemetria cacheada não aparece: a PUBG dropa match
        // E telemetry juntos (~14d), e o JSON do match cacheado só contém uma URL
        // de telemetry que já caiu. Sem telemetry_*.json local, o replay não tem
        // como carregar — então melhor nem mostrar o card.
        const apiIds = new Set(matchIds);
        const localIds = localMatchIdsFor(platform, playerId);
        const hasTelemetry = id => fs.existsSync(path.join(matchCacheDir, `telemetry_${id}.json`));
        const seen = new Set();
        const mergedIds = [];
        for (const id of [...matchIds, ...localIds]) {
            if (!id || seen.has(id)) continue;
            seen.add(id);
            if (!apiIds.has(id) && !hasTelemetry(id)) continue;
            mergedIds.push(id);
        }

        const matchDetails = await Promise.all(mergedIds.map(id => getMatch(platform, id)));
        const validMatches = matchDetails.filter(Boolean);
        if (!validMatches.length) throw new Error('No matches found');
        // Garante ordem por createdAt desc (a API geralmente já vem ordenada, mas locais podem misturar)
        validMatches.sort((a, b) => new Date(b?.data?.attributes?.createdAt || 0) - new Date(a?.data?.attributes?.createdAt || 0));
        res.json({ matches: validMatches });
    } catch (error) {
        console.error('Error fetching matches:', error.message);
        res.status(500).json({ error: 'Error fetching matches' });
    }
});

// ── Career: stats across the last N seasons ──────────────────────────────────
// Reuses the per-season cache file used by /api/player/:name (PLAYER_TTL).
const playerIdInflight = new Map();
async function getPlayerId(platform, playerName) {
    const cacheFile = path.join(cacheDir, `playerid_${platform}_${safeName(playerName)}.json`);
    const cached = readCache(cacheFile, PLAYERID_TTL);
    if (cached) return cached;

    const key = `${platform}_${playerName}`;
    if (playerIdInflight.has(key)) return playerIdInflight.get(key);

    const promise = (async () => {
        try {
            const r = await pubgGet(
                `${shardUrl(platform)}/players?filter[playerNames]=${encodeURIComponent(playerName)}`
            );
            if (!r.data.data.length) return null;
            const player = r.data.data[0];
            const id = player.id;
            // Cache matchIds as a side effect so /matches can reuse this call
            const matchIds = player.relationships.matches.data.map(m => m.id);
            const matchListFile = path.join(cacheDir, `matches_list_${platform}_${safeName(playerName)}.json`);
            writeCache(matchListFile, matchIds);
            writeCache(cacheFile, id);
            return id;
        } catch { return null; }
        finally { playerIdInflight.delete(key); }
    })();
    playerIdInflight.set(key, promise);
    return promise;
}

async function getPlayerSeason(platform, playerName, seasonId, isCurrent = false) {
    const cacheFile = path.join(cacheDir, `player_${platform}_${safeName(playerName)}_${safeName(seasonId)}.json`);
    const cached = readCache(cacheFile, isCurrent ? PLAYER_TTL : FOREVER);
    if (cached) return cached;

    const playerId = await getPlayerId(platform, playerName);
    if (!playerId) return null;

    try {
        const statsResponse = await pubgGet(
            `${shardUrl(platform)}/players/${playerId}/seasons/${seasonId}`
        );
        const s = statsResponse.data.data.attributes.gameModeStats;
        const result = {
            player: { name: playerName, id: playerId, platform },
            stats: {
                fpp: { solo: s['solo-fpp'] || {}, duo: s['duo-fpp'] || {}, squad: s['squad-fpp'] || {} },
                tpp: { solo: s['solo']     || {}, duo: s['duo']     || {}, squad: s['squad']     || {} }
            }
        };
        writeCache(cacheFile, result);
        return result;
    } catch (e) {
        return null;
    }
}

app.get('/api/player/:playerName/career', async (req, res) => {
    const { playerName } = req.params;
    const { platform = 'steam' } = req.query;
    const limit = Math.max(2, Math.min(20, parseInt(req.query.limit, 10) || 8));
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!PLAYER_NAME_RE.test(playerName)) return res.status(400).json({ error: 'Invalid player name' });

    try {
        // Seasons (cached)
        const seasonsCacheFile = path.join(cacheDir, `seasons_${platform}.json`);
        let seasons = readCache(seasonsCacheFile, SEASONS_TTL);
        if (!seasons) {
            const r = await pubgGet(`${shardUrl(platform)}/seasons`);
            seasons = r.data.data;
            writeCache(seasonsCacheFile, seasons);
        }

        const isConsole = platform === 'psn' || platform === 'xbox' || platform === 'stadia';
        const filtered = seasons
            .filter(s => isConsole ? !s.id.includes('pc') || s.id.includes('console') : (s.id.includes('pc') && !s.id.includes('console')))
            .sort((a, b) => parseInt(b.id.split('-').pop(), 10) - parseInt(a.id.split('-').pop(), 10))
            .slice(0, limit);

        const results = await Promise.all(filtered.map(async s => {
            const isCurrent = !!s.attributes?.isCurrentSeason;
            const data = await getPlayerSeason(platform, playerName, s.id, isCurrent);
            return data ? { seasonId: s.id, isCurrent, stats: data.stats } : null;
        }));

        // Return oldest → newest so client can plot left-to-right
        const out = results.filter(Boolean).reverse();
        res.json({ seasons: out });
    } catch (error) {
        console.error('Error fetching career:', error.message);
        res.status(500).json({ error: 'Failed to fetch career' });
    }
});


const PORT = process.env.PORT || 8080;
app.get('/api/telemetry/:matchId', async (req, res) => {
    const { matchId } = req.params;
    const { platform = 'steam' } = req.query;
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    // Sem regex, matchId tipo "../../../etc/passwd" entraria no path do cache.
    if (!MATCH_ID_RE.test(matchId)) return res.status(400).json({ error: 'Invalid match id' });

    const telemetryCacheFile = path.join(matchCacheDir, `telemetry_${matchId}.json`);
    if (fs.existsSync(telemetryCacheFile)) {
        const raw = fs.readFileSync(telemetryCacheFile, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        return res.send(raw);
    }

    // Get telemetry URL from match cache
    const matchCacheFile = path.join(matchCacheDir, `${platform}_${matchId}.json`);
    let telemetryUrl;
    if (fs.existsSync(matchCacheFile)) {
        const match = JSON.parse(fs.readFileSync(matchCacheFile, 'utf8'));
        telemetryUrl = match.included?.find(i => i.type === 'asset')?.attributes?.URL;
    }
    if (!telemetryUrl) return res.status(404).json({ error: 'Match not cached — load match history first' });

    try {
        _logApi('PUBLIC', telemetryUrl);
        const r = await axios.get(telemetryUrl);
        console.log(`       \x1b[32m→ ${r.status}\x1b[0m`);
        fs.writeFileSync(telemetryCacheFile, JSON.stringify(r.data), 'utf8');
        res.json(r.data);
    } catch (err) {
        console.error('Telemetry fetch error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
