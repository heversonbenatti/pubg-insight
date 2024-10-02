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
    const { season, isFPP } = req.query;
    const mode = isFPP === 'true' ? 'fpp' : 'tpp';

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
        const playerStats = {
            solo: stats[`solo-${mode}`] || { gamesPlayed: 0, kdRatio: 0 },
            duo: stats[`duo-${mode}`] || { gamesPlayed: 0, kdRatio: 0 },
            squad: stats[`squad-${mode}`] || { gamesPlayed: 0, kdRatio: 0 }
        };

        res.json({ player: { name: playerName }, stats: playerStats });
    } catch (error) {
        res.json({ error: 'Player not found or API error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
