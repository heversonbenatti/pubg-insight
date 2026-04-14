const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://api.pubg.com/shards/steam';

app.use(express.static('public'));

const jsonsCacheDir = path.join(__dirname, 'public', 'jsons');
if (!fs.existsSync(jsonsCacheDir)) fs.mkdirSync(jsonsCacheDir, { recursive: true });

const SEASONS_CACHE_TTL = 24 * 60 * 60 * 1000;
const seasonsFilePath = path.join(__dirname, 'public', 'jsons', 'seasons.json');

function isSeasonsExpired() {
    if (!fs.existsSync(seasonsFilePath)) return true;
    return (Date.now() - fs.statSync(seasonsFilePath).mtimeMs) > SEASONS_CACHE_TTL;
}

app.get('/api/seasons', async (req, res) => {
    if (!isSeasonsExpired()) {
        fs.readFile(seasonsFilePath, 'utf8', (err, data) => {
            if (err) return res.status(500).json({ error: 'Failed to read seasons file' });
            res.json(JSON.parse(data));
        });
    } else {
        try {
            const response = await axios.get(`${BASE_URL}/seasons`, {
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' }
            });
            fs.writeFile(seasonsFilePath, JSON.stringify(response.data.data), 'utf8', () => {});
            res.json(response.data.data);
        } catch (error) {
            console.error('Error fetching seasons:', error.message);
            res.status(500).json({ error: 'Failed to fetch seasons from API' });
        }
    }
});

app.get('/api/player/:playerName', async (req, res) => {
    const { playerName } = req.params;
    const { season } = req.query;
    if (!season) return res.status(400).json({ error: 'Season parameter is required' });

    try {
        const playerResponse = await axios.get(`${BASE_URL}/players?filter[playerNames]=${playerName}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' }
        });
        if (!playerResponse.data.data.length) return res.json({ error: 'Player not found' });

        const playerId = playerResponse.data.data[0].id;
        const statsResponse = await axios.get(`${BASE_URL}/players/${playerId}/seasons/${season}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' }
        });
        const s = statsResponse.data.data.attributes.gameModeStats;
        res.json({
            player: { name: playerName },
            stats: {
                fpp: { solo: s['solo-fpp'] || {}, duo: s['duo-fpp'] || {}, squad: s['squad-fpp'] || {} },
                tpp: { solo: s['solo'] || {}, duo: s['duo'] || {}, squad: s['squad'] || {} }
            }
        });
    } catch (error) {
        console.error('Error fetching player stats:', error.message);
        res.status(500).json({ error: 'Player not found or API error' });
    }
});

app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    try {
        const playerResponse = await axios.get(`${BASE_URL}/players?filter[playerNames]=${playerName}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' }
        });
        const matchesData = playerResponse.data.data[0].relationships.matches.data;
        const matchDetails = await Promise.all(matchesData.map(async match => {
            try {
                const r = await axios.get(`${BASE_URL}/matches/${match.id}`, {
                    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/vnd.api+json' }
                });
                return r.data;
            } catch { return null; }
        }));
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
        fs.writeFileSync(path.join(__dirname, 'public', 'jsons', 'last_telemetry.json'), response.data);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
