const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://api.pubg.com/shards/steam';

// Serve static files
app.use(express.static('public'));

// Path to save seasons.json file
const seasonsFilePath = path.join(__dirname, 'public', 'seasons.json');

// API to fetch and cache seasons
app.get('/api/seasons', async (req, res) => {
    // Check if seasons.json exists
    if (fs.existsSync(seasonsFilePath)) {
        // Read cached seasons.json
        fs.readFile(seasonsFilePath, 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading seasons.json:', err);
                return res.status(500).json({ error: 'Failed to read seasons file' });
            }
            res.json(JSON.parse(data));
        });
    } else {
        // Fetch from API and save to seasons.json
        try {
            const response = await axios.get(`${BASE_URL}/seasons`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/vnd.api+json'
                }
            });

            // Write to seasons.json
            fs.writeFile(seasonsFilePath, JSON.stringify(response.data.data), 'utf8', (err) => {
                if (err) {
                    console.error('Error writing seasons.json:', err);
                }
            });

            // Respond with API data
            res.json(response.data.data);
        } catch (error) {
            console.error('Error fetching seasons from API:', error);
            res.status(500).json({ error: 'Failed to fetch seasons from API' });
        }
    }
});

// API to get player stats for a specific season
app.get('/api/player/:playerName', async (req, res) => {
    const { playerName } = req.params;
    const { season } = req.query;

    try {
        // Fetch player ID
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

        // Fetch season stats for player
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
        console.error('Error fetching player stats:', error.message);
        res.status(500).json({ error: 'Player not found or API error' });
    }
});

// API to fetch matches for a player
app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    try {
        // Fetch player ID
        const playerResponse = await axios.get(`${BASE_URL}/players?filter[playerNames]=${playerName}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });

        const matchesData = playerResponse.data.data[0].relationships.matches.data;

        // Fetch match details for each match
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
