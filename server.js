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

app.use(express.static('public'));

const cacheDir = path.join(__dirname, 'public', 'jsons');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
const matchCacheDir = path.join(cacheDir, 'matches');
if (!fs.existsSync(matchCacheDir)) fs.mkdirSync(matchCacheDir, { recursive: true });

const SEASONS_TTL      = 24 * 60 * 60 * 1000;   // 24h
const PLAYER_TTL       = 10 * 60 * 1000;        // 10min
const MATCHES_LIST_TTL = 5  * 60 * 1000;        // 5min
const MATCH_TTL        = 7  * 24 * 60 * 60 * 1000; // 7d (matches are immutable)

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
        const r = await axios.get(`${shardUrl(platform)}/seasons`, { headers: pubgHeaders() });
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
    const cached = readCache(cacheFile, PLAYER_TTL);
    if (cached) return res.json(cached);

    try {
        const playerResponse = await axios.get(
            `${shardUrl(platform)}/players?filter[playerNames]=${encodeURIComponent(playerName)}`,
            { headers: pubgHeaders() }
        );
        if (!playerResponse.data.data.length) return res.json({ error: 'Player not found' });

        const playerId = playerResponse.data.data[0].id;
        const statsResponse = await axios.get(
            `${shardUrl(platform)}/players/${playerId}/seasons/${season}`,
            { headers: pubgHeaders() }
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
            const r = await axios.get(`${shardUrl(platform)}/matches/${matchId}`, { headers: pubgHeaders() });
            writeCache(cacheFile, r.data);
            return r.data;
        } catch { return null; }
        finally { matchInflight.delete(inflightKey); }
    })();
    matchInflight.set(inflightKey, promise);
    return promise;
}

app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    const { platform = 'steam' } = req.query;
    if (!VALID_PLATFORMS.has(platform)) return res.status(400).json({ error: 'Invalid platform' });

    const listCacheFile = path.join(cacheDir, `matches_list_${platform}_${safeName(playerName)}.json`);
    let matchIds = readCache(listCacheFile, MATCHES_LIST_TTL);

    try {
        if (!matchIds) {
            const playerResponse = await axios.get(
                `${shardUrl(platform)}/players?filter[playerNames]=${encodeURIComponent(playerName)}`,
                { headers: pubgHeaders() }
            );
            if (!playerResponse.data.data.length) return res.status(404).json({ error: 'Player not found' });
            matchIds = playerResponse.data.data[0].relationships.matches.data.map(m => m.id);
            writeCache(listCacheFile, matchIds);
        }

        const matchDetails = await Promise.all(matchIds.map(id => getMatch(platform, id)));
        const validMatches = matchDetails.filter(Boolean);
        if (!validMatches.length) throw new Error('No matches found');
        res.json({ matches: validMatches });
    } catch (error) {
        console.error('Error fetching matches:', error.message);
        res.status(500).json({ error: 'Error fetching matches' });
    }
});

app.get('/api/telemetry/save', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url param required' });
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync(path.join(cacheDir, 'last_telemetry.json'), response.data);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
