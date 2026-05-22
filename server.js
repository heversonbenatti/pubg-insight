import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
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
            // Removido: default do helmet inclui isso e força http→https no browser,
            // quebrando assets quando o server roda em HTTP puro (port forward direto).
            'upgrade-insecure-requests': null,
        },
    },
    // Permite que <canvas> faça toDataURL em imagens do mesmo origin (replay 2D).
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // Desligado porque o server roda em HTTP (port forward direto, sem reverse
    // proxy TLS). HSTS forçaria o browser a tentar HTTPS e todos os assets
    // morrem com ERR_SSL_PROTOCOL_ERROR. Habilitar APENAS quando tiver TLS real
    // (Cloudflare, nginx com cert, etc).
    strictTransportSecurity: false,
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

// gzip de respostas (JSON da API + JS/CSS estáticos). Pula o que já vem com
// Content-Encoding (telemetria, que é servida pré-gzipada). Ganho ~10x em JSON.
app.use(compression());

// Estáticos com cache no browser. Tiles e imagens são imutáveis (conteúdo fixo
// por mapa); JS/CSS/JSON revalidam mais rápido. maxAge corta re-downloads.
const staticOpts = { maxAge: '7d' };
app.use(express.static('public', staticOpts));
app.use('/pubg-api-assets', express.static('pubg-api-assets', { maxAge: '30d', immutable: true }));

// Cache em disco fora do static root — não deve vazar publicamente (IDs/match
// histórico de jogadores). Arquivos sob `cache/` nunca são servidos diretamente.
const cacheDir = path.join(__dirname, 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
const matchCacheDir = path.join(cacheDir, 'matches');
if (!fs.existsSync(matchCacheDir)) fs.mkdirSync(matchCacheDir, { recursive: true });

// ── Telemetria gzip ───────────────────────────────────────────────────────────
// Telemetrias são salvas comprimidas (telemetry_<id>.json.gz) — ~13x menor,
// lossless. Leitura é transparente (gunzip), com fallback pro .json legado.
function telemetryGzPath(matchId)  { return path.join(matchCacheDir, `telemetry_${matchId}.json.gz`); }
function telemetryRawPath(matchId) { return path.join(matchCacheDir, `telemetry_${matchId}.json`); }
function telemetryExists(matchId) {
    return fs.existsSync(telemetryGzPath(matchId)) || fs.existsSync(telemetryRawPath(matchId));
}
// Lê e parseia os eventos da telemetria (gz preferido, .json fallback). null se não existe.
function readTelemetryEvents(matchId) {
    const gz = telemetryGzPath(matchId);
    if (fs.existsSync(gz)) {
        try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz))); } catch { return null; }
    }
    const raw = telemetryRawPath(matchId);
    if (fs.existsSync(raw)) {
        try { return JSON.parse(fs.readFileSync(raw, 'utf8')); } catch { return null; }
    }
    return null;
}
// Salva eventos como .gz (e remove um eventual .json legado do mesmo match).
function writeTelemetryEvents(matchId, dataOrString) {
    const json = typeof dataOrString === 'string' ? dataOrString : JSON.stringify(dataOrString);
    fs.writeFileSync(telemetryGzPath(matchId), zlib.gzipSync(json));
    try { if (fs.existsSync(telemetryRawPath(matchId))) fs.unlinkSync(telemetryRawPath(matchId)); } catch {}
}
function deleteTelemetryFiles(matchId) {
    for (const p of [telemetryGzPath(matchId), telemetryRawPath(matchId)]) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
}

// ── Skip markers ──────────────────────────────────────────────────────────────
// Partidas não-playable (TDM/arcade/treino/event/custom/mapa sem assets) não são
// salvas. Um marcador minúsculo (skip_<platform>_<id>) evita re-buscar elas da API
// toda vez (não dá pra saber o modo sem buscar). Imutável (modo da partida não muda).
function skipMarkerPath(platform, id) { return path.join(matchCacheDir, `skip_${platform}_${id}`); }
function hasSkipMarker(platform, id)  { return fs.existsSync(skipMarkerPath(platform, id)); }
function writeSkipMarker(platform, id) { try { fs.writeFileSync(skipMarkerPath(platform, id), ''); } catch {} }

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

// ── Refresh cooldown (server-side, fonte da verdade) ──────────────────────────
// Um único cooldown por jogador, materializado num arquivo-marcador cujo mtime =
// hora do último refresh. O endpoint atômico /api/player/:name/refresh é o ÚNICO
// que re-busca da API; os demais endpoints são cache-first puros. Isso evita o
// abuso da chave (martelar ?refresh=1) e a divergência entre front e servidor —
// o front lê `refreshAvailableInMs` da resposta e mostra o estado real.
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
function refreshMarkerFile(platform, name) {
    return path.join(cacheDir, `refresh_${platform}_${safeName(String(name).toLowerCase())}.json`);
}
function refreshRemainingMs(platform, name) {
    const f = refreshMarkerFile(platform, name);
    if (!fs.existsSync(f)) return 0;
    return Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - fs.statSync(f).mtimeMs));
}
function touchRefreshMarker(platform, name) {
    try { fs.writeFileSync(refreshMarkerFile(platform, name), String(Date.now()), 'utf8'); }
    catch (e) { console.error('refresh marker write failed:', e.message); }
}

// ── Cache eviction (10 GB) ────────────────────────────────────────────────────
// Todas as telemetrias são salvas. Quando cache/matches passa de 10 GB, apaga as
// telemetrias mais antigas POR DATA DE SALVAMENTO (mtime), não pela data da
// partida, até voltar abaixo do limite. Match files (≈25KB) nunca são apagados —
// são minúsculos e necessários pro índice/insights.
const CACHE_LIMIT_BYTES = 200 * 1024 * 1024 * 1024; // 200 GB (cache no SSD G:\ via junction)
let _cacheEvictInflight = false;
let _lastEvictMs = 0;
const EVICT_MIN_INTERVAL_MS = 30 * 1000; // varrer 16k+ arquivos no máx 1×/30s
function enforceCacheLimit(force = false) {
    if (_cacheEvictInflight) return;
    if (!force && Date.now() - _lastEvictMs < EVICT_MIN_INTERVAL_MS) return;
    _lastEvictMs = Date.now();
    _cacheEvictInflight = true;
    try {
        let total = 0;
        const telemetries = [];
        for (const f of fs.readdirSync(matchCacheDir)) {
            const fp = path.join(matchCacheDir, f);
            let st;
            try { st = fs.statSync(fp); } catch { continue; }
            if (!st.isFile()) continue;
            total += st.size;
            if (/^telemetry_.+\.json(\.gz)?$/.test(f)) {
                telemetries.push({ fp, size: st.size, mtime: st.mtimeMs });
            }
        }
        if (total <= CACHE_LIMIT_BYTES) return;

        telemetries.sort((a, b) => a.mtime - b.mtime); // mais antigas (save) primeiro
        let removed = 0, freed = 0;
        for (const t of telemetries) {
            if (total <= CACHE_LIMIT_BYTES) break;
            try {
                fs.unlinkSync(t.fp);
                total -= t.size; freed += t.size; removed++;
            } catch { /* ignora */ }
        }
        if (removed) {
            const GiB = 1024 ** 3;
            console.log(`[cache] evicted ${removed} telemetrias (${(freed / GiB).toFixed(2)} GB) — cache agora ${(total / GiB).toFixed(2)} GB`);
        }
    } catch (e) {
        console.error('[cache] eviction failed:', e.message);
    } finally {
        _cacheEvictInflight = false;
    }
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

async function fetchLeaderboard(shard, season, gameMode, force = false) {
    const cacheFile = leaderboardCacheFile(shard, season, gameMode);
    if (!force) {
        const cached = readLeaderboardCache(cacheFile, shard, season, gameMode);
        if (cached) return cached;
    }

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

async function fetchAvailableLeaderboardModes(shard, season, force = false) {
    const cacheFile = leaderboardModesCacheFile(shard, season);
    if (!force) {
        const cached = readLeaderboardModesCache(cacheFile, shard, season);
        if (cached) return cached;
    }

    const groups = new Map();
    const unavailable = [];
    const failures = [];

    for (const mode of LEADERBOARD_MODE_OPTIONS) {
        try {
            const leaderboard = await fetchLeaderboard(shard, season, mode.value, force);
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

    // refreshAvailableInMs (mtime do marcador) sempre fresco — é por ele que o
    // front decide o estado do botão Atualizar. Anexado à resposta sem entrar no cache.
    const withCooldown = obj => ({ ...obj, refreshAvailableInMs: refreshRemainingMs(platform, playerName) });

    const cacheFile = path.join(cacheDir, `player_${platform}_${safeName(playerName)}_${safeName(season)}.json`);
    // Cache-first puro: o refresh real só acontece via /api/player/:name/refresh.
    const cached = readCache(cacheFile, FOREVER);
    if (cached) return res.json(withCooldown(cached));

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
        // Primeira carga conta como "fresco" → inicia o cooldown.
        if (refreshRemainingMs(platform, playerName) <= 0) touchRefreshMarker(platform, playerName);
        res.json(withCooldown(result));
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
    const cached = readCache(cacheFile, FOREVER);  // cache-first puro (refresh via /refresh)
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

// ── Refresh atômico ───────────────────────────────────────────────────────────
// Único ponto que re-busca da API. Gate por marcador (1 cooldown por jogador).
// Atualiza stats + ranked + matchIds e invalida o cache de insights — o front
// chama isso ao clicar em Atualizar OU em Insights (quando disponível) e depois
// recarrega os dados (cache-first, agora frescos). As novas partidas em si são
// baixadas pelo /matches no reload (getMatch on-demand).
app.get('/api/player/:playerName/refresh', async (req, res) => {
    const { playerName } = req.params;
    const { season, platform = 'steam' } = req.query;
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!PLAYER_NAME_RE.test(playerName)) return res.status(400).json({ error: 'Invalid player name' });
    if (season && !SEASON_ID_RE.test(season)) return res.status(400).json({ error: 'Invalid season id' });

    const remaining = refreshRemainingMs(platform, playerName);
    if (remaining > 0) {
        return res.json({ refreshed: false, availableInMs: remaining });
    }
    // Marca já pra fechar a janela de double-click enquanto busca.
    touchRefreshMarker(platform, playerName);

    try {
        // 1) Re-busca player + matchIds (força reescrita de matches_list + playerid)
        const playerId = await getPlayerId(platform, playerName, true);
        if (!playerId) return res.status(404).json({ error: 'Player not found' });

        if (season) {
            // 2) Stats da season
            try {
                const sr = await pubgGet(`${shardUrl(platform)}/players/${playerId}/seasons/${season}`);
                const s = sr.data.data.attributes.gameModeStats;
                writeCache(path.join(cacheDir, `player_${platform}_${safeName(playerName)}_${safeName(season)}.json`), {
                    player: { name: playerName, id: playerId, platform },
                    stats: {
                        fpp: { solo: s['solo-fpp'] || {}, duo: s['duo-fpp'] || {}, squad: s['squad-fpp'] || {} },
                        tpp: { solo: s['solo'] || {}, duo: s['duo'] || {}, squad: s['squad'] || {} },
                    },
                });
            } catch (e) { console.error('refresh stats failed:', e.message); }

            // 3) Ranked (404 = nunca jogou ranked → vazio)
            try {
                let rankedStats = {};
                try {
                    const rr = await pubgGet(`${shardUrl(platform)}/players/${playerId}/seasons/${season}/ranked`);
                    rankedStats = rr.data.data.attributes.rankedGameModeStats || {};
                } catch (e) { if (e.response?.status !== 404) throw e; }
                writeCache(path.join(cacheDir, `ranked_${platform}_${safeName(playerName)}_${safeName(season)}.json`), {
                    player: { name: playerName, id: playerId, platform },
                    ranked: {
                        fpp: { solo: rankedStats['solo-fpp'] || null, duo: rankedStats['duo-fpp'] || null, squad: rankedStats['squad-fpp'] || null },
                        tpp: { solo: rankedStats['solo'] || null, duo: rankedStats['duo'] || null, squad: rankedStats['squad'] || null },
                    },
                });
            } catch (e) { console.error('refresh ranked failed:', e.message); }
        }

        // 4) Completa telemetrias do jogador (CDN, sem rate limit) pra que a seção
        //    de armas dos insights fique correta. Primeiro um lote SÍNCRONO rápido
        //    (cap 25 / deadline 75s pra ficar abaixo do timeout do Cloudflare); o
        //    resto continua em BACKGROUND sem bloquear a resposta.
        const matchIds = telemetryCandidateIds(platform, playerName, playerId);
        const dl = await downloadMissingTelemetries(platform, matchIds, { cap: 25, deadlineMs: 75 * 1000 });

        // 5) Invalida insights individual → recomputa na próxima visita
        try { fs.unlinkSync(playerInsightsCacheFile(platform, playerId)); } catch {}

        // 6) Background: baixa o restante das telemetrias do jogador sem bloquear.
        setImmediate(() => backgroundTelemetryFill(platform, playerId, matchIds));

        touchRefreshMarker(platform, playerName); // re-marca ao terminar
        res.json({ refreshed: true, availableInMs: REFRESH_COOLDOWN_MS, telemetriesDownloaded: dl });
    } catch (error) {
        console.error('refresh failed:', error.message);
        res.status(500).json({ error: 'Failed to refresh' });
    }
});

const matchInflight = new Map();
async function getMatch(platform, matchId) {
    // matchId vem de fontes externas (API e cache); rejeita qualquer coisa que
    // não seja UUID antes de virar nome de arquivo.
    if (!VALID_PLATFORMS.has(platform) || !MATCH_ID_RE.test(matchId)) return null;
    if (hasSkipMarker(platform, matchId)) return null; // não-playable conhecido → não busca de novo
    const cacheFile = path.join(matchCacheDir, `${platform}_${matchId}.json`);
    const cached = readCache(cacheFile, MATCH_TTL);
    if (cached) return cached;

    const inflightKey = `${platform}_${matchId}`;
    if (matchInflight.has(inflightKey)) return matchInflight.get(inflightKey);

    const promise = (async () => {
        try {
            const r = await pubgGet(`${shardUrl(platform)}/matches/${matchId}`);
            // Não salva partidas não-playable (TDM/arcade/treino/etc) — só marca skip
            // pra não re-buscar. Insights e lista nunca usam essas mesmo.
            if (!isPlayableMatchAttrs(r.data?.data?.attributes)) {
                writeSkipMarker(platform, matchId);
                return null;
            }
            writeCache(cacheFile, r.data);
            indexMatch(platform, r.data);
            // Match novo → invalida cache do global insights (lazy regen no próximo request)
            markGlobalInsightsDirty();
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

// O índice é grande (centenas de MB). Escrever síncrono a cada match novo
// (JSON.stringify + writeFileSync) travava o event loop por segundos em rajadas
// (ex: /matches ou /refresh baixando dezenas de matches). Agora a escrita é
// DEBOUNCED: a cópia em memória (matchesIndexCache) é sempre a fonte da verdade
// pros reads; o disco é só persistência, sincronizado no máximo 1x a cada 5s.
const MATCHES_INDEX_FLUSH_MS = 5000;
const _indexFlushTimers = new Map();   // platform → timeout

function flushMatchesIndex(platform) {
    const t = _indexFlushTimers.get(platform);
    if (t) { clearTimeout(t); _indexFlushTimers.delete(platform); }
    const entry = matchesIndexCache.get(platform);
    if (!entry || !entry._pending) return;
    const file = matchesIndexFile(platform);
    try {
        fs.writeFileSync(file, JSON.stringify(entry.data), 'utf8');
        entry.mtimeMs = fs.statSync(file).mtimeMs;  // pra loadMatchesIndex não re-parsear nosso próprio write
        entry._pending = false;
    } catch (e) { console.error('matches index write failed:', e.message); }
}

function saveMatchesIndex(platform) {
    const entry = matchesIndexCache.get(platform);
    if (!entry) return;
    entry._pending = true;
    if (_indexFlushTimers.has(platform)) return;   // já agendado
    _indexFlushTimers.set(platform, setTimeout(() => flushMatchesIndex(platform), MATCHES_INDEX_FLUSH_MS));
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
        .map(m => m.id)
        // Só ids cujo match file ainda existe — partidas >14d apagadas continuam
        // no índice, mas pedir de novo na API só dá 404. Ignora.
        .filter(id => fs.existsSync(path.join(matchCacheDir, `${platform}_${id}.json`)));
}

app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    const { platform = 'steam' } = req.query;
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!PLAYER_NAME_RE.test(playerName)) return res.status(400).json({ error: 'Invalid player name' });

    const listCacheFile = path.join(cacheDir, `matches_list_${platform}_${safeName(playerName)}.json`);
    // Cache-first puro: a lista só é re-buscada via /api/player/:name/refresh.
    let matchIds = readCache(listCacheFile, FOREVER);
    let playerId = null;

    try {
        if (!matchIds) {
            // getPlayerId() escreve matchIds em listCacheFile como efeito colateral.
            playerId = await getPlayerId(platform, playerName);
            if (!playerId) return res.status(404).json({ error: 'Player not found' });
            matchIds = readCache(listCacheFile, FOREVER);
            if (!matchIds) {
                const r = await pubgGet(`${shardUrl(platform)}/players/${playerId}`);
                matchIds = r.data.data.relationships.matches.data.map(m => m.id);
                writeCache(listCacheFile, matchIds);
            }
        } else {
            // matchIds em cache mas precisamos do playerId pro índice local
            playerId = await getPlayerId(platform, playerName);
        }

        // Merge API matchIds + matches cacheados localmente (já dropparam do server
        // PUBG mas continuam no disco). Dedup + preserva ordem da API no topo.
        // Mostra TODAS as partidas, mesmo sem telemetria — o front marca quais têm
        // replay disponível via o mapa `telemetry` abaixo.
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
        // Mapa matchId → tem telemetria cacheada (pro front habilitar/desabilitar o replay)
        const telemetry = {};
        for (const m of validMatches) {
            const id = m?.data?.id;
            if (id) telemetry[id] = telemetryExists(id);
        }
        res.json({ matches: validMatches, telemetry });
    } catch (error) {
        console.error('Error fetching matches:', error.message);
        res.status(500).json({ error: 'Error fetching matches' });
    }
});

// Resolve accountId. `force` re-busca da API mesmo com cache (usado pelo
// refresh manual), atualizando os matchIds cacheados como efeito colateral.
const playerIdInflight = new Map();
async function getPlayerId(platform, playerName, force = false) {
    const cacheFile = path.join(cacheDir, `playerid_${platform}_${safeName(playerName)}.json`);
    if (!force) {
        const cached = readCache(cacheFile, PLAYERID_TTL);
        if (cached) return cached;
    }

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

// ── Insights ────────────────────────────────────────────────────────────────
// Arquitetura (decisão: 2026-05-19):
//
//  1. GLOBAL (byMap, byWeapon/duels, globalAverages.distributions):
//     pré-computado em `scripts/output/insights_global.json` por
//     `scripts/build-insights.js`. Carregado lazy + mtime-cached em RAM (~60KB).
//     Marcado dirty toda vez que getMatch() salva um match novo no cache.
//     Próximo request que precisar de dado global dispara regen em BACKGROUND
//     (spawn de node, throttled). Responde com o cache atual sem bloquear.
//
//  2. INDIVIDUAL (stats do jogador X + percentis vs global):
//     calculado ON-DEMAND quando o usuário pede /api/insights/player/:name.
//     Varre os match files do jogador (matches_index_<platform>.json), agrega
//     stats do participante batendo com accountId, filtra mapas non-playable,
//     cruza com telemetrias cacheadas pra by-weapon/distância. Cache em disco
//     com TTL curto (`cache/insights_player_*`).
//
// Mapas non-playable (minigames/treino/removidos sem assets) são filtrados em
// AMBAS as fases via PLAYABLE_MAPS — espelho de public/utils.js.

const PLAYABLE_MAPS = new Set([
    'Baltic_Main', 'Erangel_Main',
    'Desert_Main', 'Savage_Main', 'DihorOtok_Main',
    'Summerland_Main', 'Tiger_Main', 'Kiki_Main', 'Neon_Main',
]);
const PLAYABLE_MATCH_TYPES = new Set(['official', 'competitive']);
function isPlayableMatchAttrs(a) {
    return !!a && PLAYABLE_MAPS.has(a.mapName) && PLAYABLE_MATCH_TYPES.has(a.matchType);
}

const INSIGHTS_GLOBAL_FILE = path.join(__dirname, 'scripts', 'output', 'insights_global.json');
let _globalCache = null;             // { mtimeMs, data }
// Começa false: no boot o insights_global.json já reflete o cache atual.
// Vira true quando getMatch() baixa um match novo — sinaliza que o dataset está
// desatualizado. NÃO dispara regen automática (decisão: regen é manual, via
// `npm run insights:build`). O flag só aparece em meta.dirty pra UI/diagnóstico.
let _globalDirty = false;

// loadGlobalInsights só usa mtime pra invalidar cache em memória. NÃO depende
// de _globalDirty — esse flag é só pra disparar regen, não pra reload do JSON.
function loadGlobalInsights() {
    if (!fs.existsSync(INSIGHTS_GLOBAL_FILE)) return null;
    const mtimeMs = fs.statSync(INSIGHTS_GLOBAL_FILE).mtimeMs;
    if (_globalCache && _globalCache.mtimeMs === mtimeMs) {
        return _globalCache.data;
    }
    try {
        const data = JSON.parse(fs.readFileSync(INSIGHTS_GLOBAL_FILE, 'utf8'));
        _globalCache = { mtimeMs, data };
        return data;
    } catch (e) {
        console.error('insights global load failed:', e.message);
        return null;
    }
}

// Marca dirty (chamado quando match novo cacheado). Apenas sinaliza que o
// dataset global está atrás do cache; a regeneração é MANUAL (`npm run
// insights:build`) — não há mais regen automática em background.
function markGlobalInsightsDirty() {
    _globalDirty = true;
}

// Percentile (interpolação linear nos quartis pré-calculados)
function approxPercentile(value, dist) {
    if (!dist || !Number.isFinite(value)) return null;
    const points = [
        [dist.min, 0], [dist.p25, 0.25], [dist.median, 0.5],
        [dist.p75, 0.75], [dist.p90, 0.9], [dist.p99, 0.99], [dist.max, 1],
    ].filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
    if (!points.length) return null;
    if (value <= points[0][0]) return 0;
    if (value >= points[points.length - 1][0]) return 1;
    for (let i = 1; i < points.length; i++) {
        const [v1, p1] = points[i - 1], [v2, p2] = points[i];
        if (value <= v2) {
            const span = v2 - v1;
            const t = span > 0 ? (value - v1) / span : 0;
            return Math.max(0, Math.min(1, p1 + (p2 - p1) * t));
        }
    }
    return 1;
}

// ── Insights individuais on-demand ─────────────────────────────────────────
// Varre match files do jogador + telemetrias dele que estiverem cacheadas.
// Resultado cacheado em disco com TTL curto (PLAYER_INSIGHTS_TTL).
const PLAYER_INSIGHTS_TTL = 10 * 60 * 1000;
const PLAYER_INSIGHTS_CACHE_VERSION = 1;

function playerInsightsCacheFile(platform, accountId) {
    return path.join(cacheDir, `insights_player_${platform}_${safeName(accountId)}.json`);
}

function normalizeWeaponId(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let s = raw.replace(/_\d+$/, '');
    if (s.startsWith('Item_Weapon_')) s = 'Weap' + s.slice('Item_Weapon_'.length);
    return s;
}

const DIST_BUCKETS = [
    { key: 'close',    max: 25 },
    { key: 'short',    max: 50 },
    { key: 'med',      max: 100 },
    { key: 'long',     max: 200 },
    { key: 'verylong', max: Infinity },
];
function distanceBucket(m) {
    if (!Number.isFinite(m)) return 'unknown';
    for (const b of DIST_BUCKETS) if (m <= b.max) return b.key;
    return 'verylong';
}

function emptyPlayerStats(name, accountId) {
    return {
        name, accountId,
        matches: 0, kills: 0, knocks: 0, deaths: 0, assists: 0,
        damageDealt: 0, damageTaken: 0,
        headshotKills: 0, longestKillMeters: 0,
        timeSurvived: 0, wins: 0, top10: 0,
        revives: 0, heals: 0, boosts: 0,
        roadKills: 0, vehicleDestroys: 0, teamKills: 0,
        walkDistance: 0, rideDistance: 0,
        killsByWeapon: {}, knocksByWeapon: {},
        killsByDistance: { close: 0, short: 0, med: 0, long: 0, verylong: 0, unknown: 0 },
        killsByMap: {}, matchesByMap: {}, winsByMap: {},
        sumKillDistance: 0, countKillDistance: 0,
        // Trackers só preenchidos quando temos telemetria do match
        shotsFired: 0, telemetryMatchesUsed: 0,
    };
}

// Agrega stats do match file (formato JSON:API da PUBG) pro participante
// com accountId que bate. Filtra mapas non-playable.
function aggregateMatchFileForPlayer(matchData, accountId, stats) {
    const a = matchData?.data?.attributes;
    if (!isPlayableMatchAttrs(a)) return false;
    const part = (matchData.included || [])
        .filter(it => it.type === 'participant')
        .find(p => p.attributes?.stats?.playerId === accountId);
    if (!part) return false;
    const s = part.attributes.stats;
    const mapName = a.mapName;

    stats.matches += 1;
    stats.matchesByMap[mapName] = (stats.matchesByMap[mapName] || 0) + 1;
    stats.kills += s.kills || 0;
    stats.knocks += s.DBNOs || 0;
    stats.damageDealt += s.damageDealt || 0;
    stats.headshotKills += s.headshotKills || 0;
    stats.assists += s.assists || 0;
    stats.revives += s.revives || 0;
    stats.heals += s.heals || 0;
    stats.boosts += s.boosts || 0;
    stats.roadKills += s.roadKills || 0;
    stats.vehicleDestroys += s.vehicleDestroys || 0;
    stats.teamKills += s.teamKills || 0;
    stats.walkDistance += s.walkDistance || 0;
    stats.rideDistance += s.rideDistance || 0;
    stats.timeSurvived += s.timeSurvived || 0;
    if ((s.longestKill || 0) > stats.longestKillMeters) stats.longestKillMeters = s.longestKill;
    if (s.winPlace === 1) {
        stats.wins += 1;
        stats.winsByMap[mapName] = (stats.winsByMap[mapName] || 0) + 1;
    }
    if (s.winPlace > 0 && s.winPlace <= 10) stats.top10 += 1;
    if (s.deathType && s.deathType !== 'alive' && s.deathType !== 'logout') {
        stats.deaths += 1;
    }
    stats.killsByMap[mapName] = (stats.killsByMap[mapName] || 0) + (s.kills || 0);

    if (s.name && !stats.name) stats.name = s.name;
    return true;
}

// Cruza telemetria cacheada (se existir) com o player pra adicionar
// kills por arma, por distância, e shots fired. Não baixa, só usa o que tem.
function enrichStatsWithTelemetry(matchId, accountId, stats) {
    const events = readTelemetryEvents(matchId);
    if (!events) return false;
    let shotsFired = 0;
    for (const ev of events) {
        if (!ev || !ev._T) continue;
        if (ev._T === 'LogPlayerKillV2') {
            if (ev.killer?.accountId !== accountId) continue;
            if (ev.isSuicide || ev.victim?.accountId === accountId) continue;
            const dmg = ev.killerDamageInfo || ev.finishDamageInfo || {};
            const causer = normalizeWeaponId(dmg.damageCauserName);
            if (causer) stats.killsByWeapon[causer] = (stats.killsByWeapon[causer] || 0) + 1;
            const distM = Number.isFinite(dmg.distance) ? dmg.distance / 100 : null;
            if (distM != null) {
                stats.sumKillDistance += distM;
                stats.countKillDistance += 1;
            }
            stats.killsByDistance[distanceBucket(distM)] = (stats.killsByDistance[distanceBucket(distM)] || 0) + 1;
            continue;
        }
        if (ev._T === 'LogPlayerMakeGroggy' && ev.attacker?.accountId === accountId) {
            const causer = normalizeWeaponId(ev.damageCauserName);
            if (causer) stats.knocksByWeapon[causer] = (stats.knocksByWeapon[causer] || 0) + 1;
            continue;
        }
        if (ev._T === 'LogPlayerTakeDamage') {
            if (ev.victim?.accountId === accountId) {
                const dmg = Math.min(Number(ev.damage || 0), Number(ev.victim?.health || 0));
                if (dmg > 0) stats.damageTaken += dmg;
            }
            continue;
        }
        if (ev._T === 'LogPlayerAttack' && ev.attacker?.accountId === accountId) {
            shotsFired += 1;
        }
    }
    stats.shotsFired += shotsFired;
    stats.telemetryMatchesUsed += 1;
    return true;
}

function finalizePlayerStats(stats) {
    const m = Math.max(1, stats.matches);
    stats.killsPerMatch = round(stats.kills / m, 4);
    stats.knocksPerMatch = round(stats.knocks / m, 4);
    stats.damagePerMatch = round(stats.damageDealt / m, 2);
    stats.avgSurvivalSeconds = round(stats.timeSurvived / m, 2);
    const effDeaths = Math.max(1, stats.deaths || (stats.matches - stats.wins) || 1);
    stats.kdr = round(stats.kills / effDeaths, 3);
    stats.headshotRate = stats.kills > 0 ? round(stats.headshotKills / stats.kills, 3) : 0;
    stats.winRate = round(stats.wins / m, 4);
    stats.top10Rate = round(stats.top10 / m, 4);
    stats.aggression = round((stats.kills * 100 + stats.damageDealt) / m, 2);
    stats.shotsPerKill = stats.kills > 0 && stats.shotsFired > 0 ? round(stats.shotsFired / stats.kills, 2) : null;
    stats.avgKillDistance = stats.countKillDistance > 0 ? round(stats.sumKillDistance / stats.countKillDistance, 2) : null;
}

function computePlayerPercentiles(stats, distributions) {
    const fields = [
        'killsPerMatch', 'knocksPerMatch', 'damagePerMatch',
        'avgSurvivalSeconds', 'longestKillMeters',
        'headshotRate', 'kdr', 'winRate', 'top10Rate', 'aggression',
    ];
    const out = {};
    for (const f of fields) {
        const d = distributions?.[f];
        const v = stats[f];
        if (d && v != null) out[f] = approxPercentile(v, d);
    }
    return out;
}

function round(v, d = 2) {
    if (!Number.isFinite(v)) return null;
    const s = 10 ** d;
    return Math.round(v * s) / s;
}

async function buildPlayerInsights(platform, playerName, forceRecompute = false) {
    const accountId = await getPlayerId(platform, playerName);
    if (!accountId) return { error: 'Player not found' };

    // Cache-first: serve o cache existente independente de idade, a menos que
    // forceRecompute (refresh permitido pelo cooldown). Recomputar é caro
    // (lê centenas de telemetrias), então só acontece sob refresh válido.
    const cacheFile = playerInsightsCacheFile(platform, accountId);
    if (!forceRecompute) {
        const cached = readCache(cacheFile, FOREVER);
        if (cached?.cacheVersion === PLAYER_INSIGHTS_CACHE_VERSION) return cached;
    }

    // matches_index_<platform>.json tem matchIds do player
    const index = loadMatchesIndex(platform);
    const entry = index.players[accountId];
    const matchIds = entry?.matches?.map(m => m.id) || [];

    const stats = emptyPlayerStats(entry?.name || playerName, accountId);
    let matchFilesRead = 0, matchFilesMissing = 0, telemetriesUsed = 0;
    for (const matchId of matchIds) {
        const mf = path.join(matchCacheDir, `${platform}_${matchId}.json`);
        if (!fs.existsSync(mf)) { matchFilesMissing += 1; continue; }
        try {
            const md = JSON.parse(fs.readFileSync(mf, 'utf8'));
            const accepted = aggregateMatchFileForPlayer(md, accountId, stats);
            if (accepted) {
                matchFilesRead += 1;
                if (enrichStatsWithTelemetry(matchId, accountId, stats)) telemetriesUsed += 1;
            }
        } catch {
            // ignora arquivos corrompidos
        }
    }
    finalizePlayerStats(stats);

    const result = {
        cacheVersion: PLAYER_INSIGHTS_CACHE_VERSION,
        generatedAt: new Date().toISOString(),
        player: { name: stats.name, accountId, platform },
        stats,
        meta: {
            matchFilesRead,
            matchFilesMissing,
            telemetriesUsed,
            playable: stats.matches,
        },
    };
    writeCache(cacheFile, result);
    return result;
}

app.get('/api/insights/player/:playerName', async (req, res) => {
    const { playerName } = req.params;
    const { platform = 'steam' } = req.query;
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!PLAYER_NAME_RE.test(playerName)) return res.status(400).json({ error: 'Invalid player name' });

    const global = loadGlobalInsights();
    const distributions = global?.globalAverages?.distributions || {};

    try {
        // Cache-first puro: recomputa só se não houver cache (ou se /refresh apagou
        // o cache desse player). O refresh real é orquestrado por /api/player/:name/refresh.
        const result = await buildPlayerInsights(platform, playerName);
        if (result.error) return res.status(404).json(result);

        const percentiles = computePlayerPercentiles(result.stats, distributions);
        const inDataset = result.stats.matches > 0;

        res.json({
            player: { ...result.player, inDataset },
            stats: inDataset ? result.stats : null,
            percentiles: inDataset ? percentiles : {},
            globalAverages: global?.globalAverages || null,
            meta: {
                generatedAt: result.generatedAt,
                ...result.meta,
                globalGeneratedAt: global?.generatedAt,
                globalDirty: _globalDirty,
                matchesProcessed: global?.matchesProcessed,
                totalPlayers: global?.totalPlayers,
                eligiblePlayers: global?.eligiblePlayers,
            },
        });
    } catch (err) {
        console.error('insights player error:', err.message);
        res.status(500).json({ error: 'Failed to build insights' });
    }
});

app.get('/api/insights/weapons', (_req, res) => {
    const global = loadGlobalInsights();
    if (!global) return res.status(503).json({ error: 'Insights not yet generated. Run: npm run insights:build' });
    const weapons = Object.entries(global.byWeapon)
        .map(([id, s]) => ({ id, ...s }))
        .filter(w => w.kills >= 5)
        .sort((a, b) => b.kills - a.kills);
    res.json({
        weapons,
        meta: {
            generatedAt: global.generatedAt,
            matchesProcessed: global.matchesProcessed,
            telemetriesProcessed: global.telemetriesProcessed,
            dirty: _globalDirty,
        },
    });
});

app.get('/api/insights/summary', (_req, res) => {
    const global = loadGlobalInsights();
    if (!global) return res.status(503).json({ error: 'Insights not yet generated. Run: npm run insights:build' });

    res.json({
        byMap: global.byMap,
        globalAverages: global.globalAverages,
        meta: {
            generatedAt: global.generatedAt,
            matchesProcessed: global.matchesProcessed,
            telemetriesProcessed: global.telemetriesProcessed,
            totalPlayers: global.totalPlayers,
            eligiblePlayers: global.eligiblePlayers,
            dirty: _globalDirty,
        },
    });
});


const PORT = process.env.PORT || 8080;

// Baixa e cacheia a telemetria de um match (CDN público, não consome rate limit).
// Retorna 'cached' | 'downloaded' | 'no-url' | 'error'. Usado pelo endpoint de
// telemetria e pelo /refresh (pra completar a telemetria do jogador → armas certas).
async function ensureTelemetry(platform, matchId) {
    if (!VALID_PLATFORMS.has(platform) || !MATCH_ID_RE.test(matchId)) return 'error';
    if (telemetryExists(matchId)) return 'cached';

    const matchCacheFile = path.join(matchCacheDir, `${platform}_${matchId}.json`);
    let telemetryUrl;
    if (fs.existsSync(matchCacheFile)) {
        try {
            const match = JSON.parse(fs.readFileSync(matchCacheFile, 'utf8'));
            telemetryUrl = match.included?.find(i => i.type === 'asset')?.attributes?.URL;
        } catch { /* match file corrompido */ }
    }
    if (!telemetryUrl) return 'no-url';

    try {
        _logApi('PUBLIC', telemetryUrl);
        const r = await axios.get(telemetryUrl);
        console.log(`       \x1b[32m→ ${r.status}\x1b[0m`);
        writeTelemetryEvents(matchId, r.data); // salva comprimido (.json.gz)
        setImmediate(enforceCacheLimit);
        return 'downloaded';
    } catch (err) {
        // 404 = telemetria já caiu do CDN (some ~14d, às vezes antes) → 'gone'
        // (definitivo). Outros erros (timeout/5xx/rede) → 'error' (transiente, tenta depois).
        if (err.response?.status === 404) return 'gone';
        console.error('Telemetry fetch error:', err.message);
        return 'error';
    }
}

// Apaga o match file (usado quando a telemetria é confirmada indisponível).
function deleteMatchFile(platform, matchId) {
    try { fs.unlinkSync(path.join(matchCacheDir, `${platform}_${matchId}.json`)); return true; }
    catch { return false; }
}

// Lista de matchIds candidatos a ter telemetria baixada pro jogador: união da
// lista recente da API (matches_list) + índice local (matches_index), dedup.
function telemetryCandidateIds(platform, playerName, accountId) {
    const seen = new Set();
    const out = [];
    const add = id => { if (id && MATCH_ID_RE.test(id) && !seen.has(id)) { seen.add(id); out.push(id); } };
    // matches_list = recentes da API (getMatch baixa se faltar). Sempre inclui.
    const list = readCache(path.join(cacheDir, `matches_list_${platform}_${safeName(playerName)}.json`)) || [];
    for (const id of list) add(id);
    // Do índice, só inclui ids cujo match file existe (senão é >14d apagado → 404 à toa).
    if (accountId) {
        const index = loadMatchesIndex(platform);
        for (const m of (index.players[accountId]?.matches || [])) {
            if (fs.existsSync(path.join(matchCacheDir, `${platform}_${m.id}.json`))) add(m.id);
        }
    }
    return out;
}

// Baixa telemetrias faltantes pra uma lista de matchIds. cap/deadline limitam o
// lote (0 = sem limite). onProgress(n) é chamado a cada download concluído.
async function downloadMissingTelemetries(platform, matchIds, { cap = Infinity, deadlineMs = 0, onProgress } = {}) {
    const deadline = deadlineMs ? Date.now() + deadlineMs : 0;
    let dl = 0;
    for (const id of matchIds) {
        if (dl >= cap) break;
        if (deadline && Date.now() > deadline) break;
        if (!MATCH_ID_RE.test(id)) continue;
        if (telemetryExists(id)) continue;
        await getMatch(platform, id);                 // garante o match file (URL da telemetria)
        const st = await ensureTelemetry(platform, id);
        if (st === 'downloaded') { dl++; if (onProgress) onProgress(dl); }
        else if (st === 'gone' || st === 'no-url') deleteMatchFile(platform, id); // telemetria indisponível → apaga
        // 'error' = transiente → mantém pra tentar de novo depois
    }
    return dl;
}

// Worker em background: completa as telemetrias restantes do jogador sem bloquear
// a resposta do refresh. Invalida o cache de insights a cada 15 downloads pra que
// a próxima visita pegue mais dados. 1 job por accountId por vez.
const _bgTelemetry = new Set();
async function backgroundTelemetryFill(platform, accountId, matchIds) {
    if (!accountId || _bgTelemetry.has(accountId)) return;
    _bgTelemetry.add(accountId);
    try {
        const dl = await downloadMissingTelemetries(platform, matchIds, {
            onProgress: n => {
                if (n % 15 === 0) { try { fs.unlinkSync(playerInsightsCacheFile(platform, accountId)); } catch {} }
            },
        });
        if (dl) {
            try { fs.unlinkSync(playerInsightsCacheFile(platform, accountId)); } catch {}
            markGlobalInsightsDirty();
            console.log(`[telemetry-bg] ${accountId.slice(0, 20)}… +${dl} telemetrias em background`);
        }
    } catch (e) {
        console.error('[telemetry-bg] erro:', e.message);
    } finally {
        _bgTelemetry.delete(accountId);
    }
}

// ── Manutenção global de telemetria ───────────────────────────────────────────
// Política (por match file cacheado):
//   não-playable (TDM/arcade/treino/etc) → apaga match + telemetria + skip marker
//   playable com telemetria (qualquer idade) → mantém
//   playable <14d sem telemetria  → baixa; 404 (telemetria caiu) → apaga o match
//   playable >14d sem telemetria  → apaga direto (URL morta)
//   idade desconhecida sem telemetria → mantém (não dá pra confirmar)
// Apagar no 404/>14d/não-playable também elimina o retry infinito de 404. Roda no
// boot e a cada 3h. Download em batch (CDN, sem rate limit).
const TELEMETRY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
let _maintainInflight = false;
async function maintainTelemetryCache(platform = 'steam') {
    if (_maintainInflight) return;
    _maintainInflight = true;
    const now = Date.now();
    let kept = 0, deletedOld = 0, deletedGone = 0, deletedNonPlayable = 0, downloaded = 0;
    const toDownload = [];
    try {
        const re = new RegExp(`^${platform}_[a-f0-9-]{36}\\.json$`, 'i');
        const files = fs.readdirSync(matchCacheDir).filter(f => re.test(f));
        for (const f of files) {
            const id = f.slice(platform.length + 1, -5);
            let attrs = null;
            try {
                attrs = JSON.parse(fs.readFileSync(path.join(matchCacheDir, f), 'utf8'))?.data?.attributes;
            } catch {}
            // Não-playable → apaga tudo e marca skip (nunca usado em insights/lista).
            if (attrs && !isPlayableMatchAttrs(attrs)) {
                deleteMatchFile(platform, id);
                deleteTelemetryFiles(id);
                writeSkipMarker(platform, id);
                deletedNonPlayable++;
                continue;
            }
            if (telemetryExists(id)) { kept++; continue; }
            const ts = attrs?.createdAt ? new Date(attrs.createdAt).getTime() : NaN;
            if (!Number.isFinite(ts)) { kept++; continue; }   // idade desconhecida → mantém (seguro)
            if (now - ts > TELEMETRY_MAX_AGE_MS) {
                if (deleteMatchFile(platform, id)) deletedOld++; // >14d s/ tel → apaga
            } else {
                toDownload.push(id);                            // <14d s/ tel → tenta baixar
            }
        }
        console.log(`[maintain] ${files.length} matches | c/ tel: ${kept} | não-playable apagados: ${deletedNonPlayable} | apagados >14d: ${deletedOld} | a baixar <14d: ${toDownload.length}`);

        // Download em batch: CDN sem rate limit, N downloads em paralelo.
        const CONCURRENCY = 8;
        let cursor = 0;
        async function worker() {
            while (cursor < toDownload.length) {
                const id = toDownload[cursor++];
                const st = await ensureTelemetry(platform, id);
                if (st === 'downloaded') {
                    downloaded++;
                    if (downloaded % 50 === 0) {
                        markGlobalInsightsDirty();
                        console.log(`[maintain] ${downloaded}/${toDownload.length} telemetrias baixadas…`);
                    }
                } else if (st === 'gone' || st === 'no-url') {
                    if (deleteMatchFile(platform, id)) deletedGone++; // 404/sem URL → telemetria indisponível, apaga
                }
                // 'error' = transiente → mantém pra tentar de novo no próximo ciclo
            }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        if (downloaded || deletedOld || deletedGone || deletedNonPlayable) markGlobalInsightsDirty();
        console.log(`[maintain] concluído: +${downloaded} telemetrias | apagados: ${deletedOld + deletedGone} s/ telemetria, ${deletedNonPlayable} não-playable`);
    } catch (e) {
        console.error('[maintain] erro:', e.message);
    } finally {
        _maintainInflight = false;
    }
}

app.get('/api/telemetry/:matchId', async (req, res) => {
    const { matchId } = req.params;
    const { platform = 'steam' } = req.query;
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (!MATCH_ID_RE.test(matchId)) return res.status(400).json({ error: 'Invalid match id' });

    const status = await ensureTelemetry(platform, matchId);
    if (status === 'cached' || status === 'downloaded') {
        res.setHeader('Content-Type', 'application/json');
        const gz = telemetryGzPath(matchId);
        if (fs.existsSync(gz)) {
            // Manda os bytes gzip com Content-Encoding: gzip — o browser descomprime
            // de forma transparente (res.json() no front funciona igual).
            res.setHeader('Content-Encoding', 'gzip');
            return res.send(fs.readFileSync(gz));
        }
        // fallback: .json legado (ainda não migrado)
        return res.send(fs.readFileSync(telemetryRawPath(matchId), 'utf8'));
    }
    if (status === 'no-url') return res.status(404).json({ error: 'Match not cached — load match history first' });
    return res.status(500).json({ error: 'Telemetry fetch failed' });
});

// ── Pré-cache (warm) dos leaderboards ranked ──────────────────────────────────
// Mantém os boards das regiões PC sempre quentes no cache (TTL 2h). Sem isso,
// cada visitante que troca de servidor dispara uma chamada à PUBG API (10 req/min)
// — vários usuários vendo várias regiões queimavam a key. Com o warm, o board já
// está cacheado antes de alguém pedir. fetchAvailableLeaderboardModes é cache-first
// e já aquece TODOS os modos do shard (descobre+dedup), então 1 call por shard basta.
const PC_LEADERBOARD_SHARDS = [
    'pc-as', 'pc-eu', 'pc-jp', 'pc-krjp', 'pc-kakao', 'pc-na', 'pc-oc', 'pc-ru', 'pc-sa', 'pc-sea',
];

async function getCurrentRankedSeasonId(platform = 'steam') {
    const cacheFile = path.join(cacheDir, `seasons_${platform}.json`);
    let seasons = readCache(cacheFile, SEASONS_TTL);
    if (!seasons) {
        try {
            const r = await pubgGet(`${shardUrl(platform)}/seasons`);
            seasons = r.data.data;
            writeCache(cacheFile, seasons);
        } catch (e) { console.error('[leaderboard-warm] seasons fetch falhou:', e.message); return null; }
    }
    return (seasons || []).find(s => s.attributes?.isCurrentSeason)?.id || null;
}

// Intervalo entre warms de shards: espalha os 10 shards ao longo de 1 TTL, de modo
// que cada shard seja renovado ~1× a cada 2h (≈12min por shard com 10 shards).
const WARM_SHARD_INTERVAL_MS = Math.floor(LEADERBOARD_TTL / PC_LEADERBOARD_SHARDS.length);

let _warmInflight = false;
let _warmIndex = 0;
// Aquece UM shard por tick (rotação), forçando o refresh. Antes, warmLeaderboards()
// disparava os 10 shards × até 6 modos (~60 calls) numa rajada só — estourava o
// rate limit (10 req/min) no boot e a cada 2h, starvando as buscas reais. Agora 1
// shard por tick a cada ~12min: ~6 calls por vez (bem abaixo de 10/min), cada shard
// renovado 1× por TTL. `force` ignora o cache-first pra realmente renovar no horário.
async function warmNextLeaderboardShard() {
    if (_warmInflight) return;
    _warmInflight = true;
    const shard = PC_LEADERBOARD_SHARDS[_warmIndex % PC_LEADERBOARD_SHARDS.length];
    _warmIndex = (_warmIndex + 1) % PC_LEADERBOARD_SHARDS.length;
    try {
        const season = await getCurrentRankedSeasonId('steam'); // pc-* shards compartilham a season do PC
        if (!season) { console.warn('[leaderboard-warm] sem season atual — pulando'); return; }
        await fetchAvailableLeaderboardModes(shard, season, true); // force: renova mesmo dentro do TTL
        console.log(`[leaderboard-warm] ${shard} quente (season ${season})`);
    } catch (e) {
        console.error(`[leaderboard-warm] ${shard}:`, e.message);
    } finally { _warmInflight = false; }
}

// Flush síncrono do índice de matches pendente — chamado no shutdown pra não
// perder entradas que ainda estavam no buffer do debounce.
function flushAllMatchesIndexes() {
    for (const platform of matchesIndexCache.keys()) flushMatchesIndex(platform);
}
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { flushAllMatchesIndexes(); process.exit(0); });
}
process.on('beforeExit', flushAllMatchesIndexes);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    setImmediate(() => enforceCacheLimit(true)); // checa limite de cache no boot
    // Manutenção de telemetria: baixa as <14d que faltam, apaga sem-telemetria (404/>14d).
    setTimeout(() => maintainTelemetryCache('steam'), 8000);          // 8s após boot
    setInterval(() => maintainTelemetryCache('steam'), 3 * 60 * 60 * 1000); // a cada 3h

    // Warm dos leaderboards: 1 shard por vez (rotação), começando 20s após o boot
    // e avançando a cada ~12min. Espalha as chamadas pra não estourar o rate limit.
    setTimeout(warmNextLeaderboardShard, 20000);
    setInterval(warmNextLeaderboardShard, WARM_SHARD_INTERVAL_MS);

    // Insights global NÃO regenera mais sozinho — só via `npm run insights:build`.
});
