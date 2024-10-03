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

        const playerId = playerResponse.data.data[0].id;
        const seasonStatsResponse = await axios.get(`${BASE_URL}/players/${playerId}/seasons/${season}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });

        const stats = seasonStatsResponse.data.data.attributes.gameModeStats;

        // Garante que as estatísticas FPP e TPP sejam retornadas, mesmo que vazias
        const playerStats = {
            fpp: {
                solo: stats['solo-fpp'] || { kills: 0, deaths: 0, assists: 0, knockdowns: 0, damageDealt: 0, killsPerMatch: 0 },
                duo: stats['duo-fpp'] || { kills: 0, deaths: 0, assists: 0, knockdowns: 0, damageDealt: 0, killsPerMatch: 0 },
                squad: stats['squad-fpp'] || { kills: 0, deaths: 0, assists: 0, knockdowns: 0, damageDealt: 0, killsPerMatch: 0 }
            },
            tpp: {
                solo: stats['solo-tpp'] || { kills: 0, deaths: 0, assists: 0, knockdowns: 0, damageDealt: 0, killsPerMatch: 0 },
                duo: stats['duo-tpp'] || { kills: 0, deaths: 0, assists: 0, knockdowns: 0, damageDealt: 0, killsPerMatch: 0 },
                squad: stats['squad-tpp'] || { kills: 0, deaths: 0, assists: 0, knockdowns: 0, damageDealt: 0, killsPerMatch: 0 }
            }
        };

        res.json({ player: { name: playerName }, stats: playerStats });
    } catch (error) {
        res.json({ error: 'Player not found or API error' });
    }
});

const fs = require('fs'); // Require the filesystem module

app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    try {
        // Fetch player data (including matches)
        const playerResponse = await axios.get(`${BASE_URL}/players?filter[playerNames]=${playerName}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });

        const matchesData = playerResponse.data.data[0].relationships.matches.data;

        // Limit to the first 3 matches
        const limitedMatches = matchesData.slice(0, 3);

        const matchDetails = [];
        for (const match of limitedMatches) {
            const matchId = match.id;
            const matchResponse = await axios.get(`${BASE_URL}/matches/${matchId}`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/vnd.api+json'
                }
            });
            matchDetails.push(matchResponse.data);
        }

        // Save the matches JSON to a file
        const jsonData = JSON.stringify(matchDetails, null, 2); // Convert to JSON
        fs.writeFileSync('matches.json', jsonData); // Save the JSON to a file

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
