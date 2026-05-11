import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const API_KEY = process.env.API_KEY;
const VALID_PLATFORMS = new Set(['steam', 'psn', 'xbox', 'kakao', 'stadia']);

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


app.use(express.static('public'));
app.use('/pubg-api-assets', express.static('pubg-api-assets'));

const cacheDir = path.join(__dirname, 'public', 'jsons');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
const matchCacheDir = path.join(cacheDir, 'matches');
if (!fs.existsSync(matchCacheDir)) fs.mkdirSync(matchCacheDir, { recursive: true });

const SEASONS_TTL      = 24 * 60 * 60 * 1000;   // 24h
const PLAYERID_TTL     = 24 * 60 * 60 * 1000;   // 24h — playerId is stable
const PLAYER_TTL       = 10 * 60 * 1000;        // 10min (current season only)
const MATCHES_LIST_TTL = 5  * 60 * 1000;        // 5min
const MATCH_TTL        = Number.MAX_SAFE_INTEGER;   // forever — matches are immutable and API drops them after 14d
const FOREVER          = Number.MAX_SAFE_INTEGER; // past seasons are immutable

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

app.get('/api/player/:playerName', async (req, res) => {
    const { playerName } = req.params;
    const { season, platform = 'steam' } = req.query;
    if (!season) return res.status(400).json({ error: 'Season parameter is required' });
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });

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

const matchInflight = new Map();
async function getMatch(platform, matchId) {
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

const matchesIndexCache = new Map();
function loadMatchesIndex(platform) {
    if (matchesIndexCache.has(platform)) return matchesIndexCache.get(platform);
    const file = matchesIndexFile(platform);
    let data = { version: 1, players: {} };
    if (fs.existsSync(file)) {
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { /* keep empty */ }
    }
    if (!data.players) data.players = {};
    matchesIndexCache.set(platform, data);
    return data;
}

function saveMatchesIndex(platform) {
    const data = matchesIndexCache.get(platform);
    if (!data) return;
    try { fs.writeFileSync(matchesIndexFile(platform), JSON.stringify(data), 'utf8'); }
    catch (e) { console.error('matches index write failed:', e.message); }
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
        const localIds = localMatchIdsFor(platform, playerId);
        const seen = new Set();
        const mergedIds = [];
        for (const id of [...matchIds, ...localIds]) {
            if (!id || seen.has(id)) continue;
            seen.add(id);
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

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
