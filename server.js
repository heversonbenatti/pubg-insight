require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://api.pubg.com/shards/steam';

app.use(express.static('public'));

app.get('/api/seasons', async (req, res) => {
    try {
        const response = await axios.get(`${BASE_URL}/seasons`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });
        res.json(response.data.data);
    } catch (error) {
        res.json({ error: 'Could not fetch seasons' });
    }
});

app.get('/api/player/:playerName', async (req, res) => {
    const { playerName } = req.params;
    const { season } = req.query;

    try {
        const playerResponse = await axios.get(`${BASE_URL}/players?filter[playerNames]=${playerName}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });

        if (!playerResponse.data.data.length) {
            console.error(`Player ${playerName} not found`);
            return res.json({ error: 'Player not found' });
        }

        const playerId = playerResponse.data.data[0].id;
        const seasonStatsResponse = await axios.get(`${BASE_URL}/players/${playerId}/seasons/${season}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });

        if (!seasonStatsResponse.data.data) {
            console.error('No season stats found for this player');
            return res.json({ error: 'No stats available for this player' });
        }

        const stats = seasonStatsResponse.data.data.attributes.gameModeStats;
        
        const playerStats = {
            fpp: {
                solo: stats['solo-fpp'] || {},
                duo: stats['duo-fpp'] || {},
                squad: stats['squad-fpp'] || {}
            },
            tpp: {
                solo: stats['solo-tpp'] || {},
                duo: stats['duo-tpp'] || {},
                squad: stats['squad-tpp'] || {}
            }
        };

        res.json({ player: { name: playerName }, stats: playerStats });
    } catch (error) {
        console.error('Error fetching player stats:', error.message); // Log the error message
        res.status(500).json({ error: 'Player not found or API error' });
    }
});

app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    try {
        const playerResponse = await axios.get(`${BASE_URL}/players?filter[playerNames]=${playerName}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });

        const matchesData = playerResponse.data.data[0].relationships.matches.data;

        const matchDetails = await Promise.all(matchesData.map(async match => {
            const matchId = match.id;
            const matchResponse = await axios.get(`${BASE_URL}/matches/${matchId}`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/vnd.api+json'
                }
            });
            return matchResponse.data;
        }));

        res.json({ matches: matchDetails });
    } catch (error) {
        console.error('Error fetching matches:', error.message);
        res.status(500).json({ error: 'Failed to fetch matches' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
