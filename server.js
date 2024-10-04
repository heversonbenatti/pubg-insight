const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://api.pubg.com/shards/steam';

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Path to save seasons.json file
const seasonsFilePath = path.join(__dirname, 'public', 'jsons', 'seasons.json');

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

const playerStatsFilePath = (playerName) => path.join(__dirname, 'public', 'jsons', `${playerName}_stats.json`);
// API to get player stats for a specific season
app.get('/api/player/:playerName', async (req, res) => {
    const { playerName } = req.params;
    const { season } = req.query;

    const playerFile = playerStatsFilePath(playerName);

    if (fs.existsSync(playerFile)) {
        // Read cached player stats
        fs.readFile(playerFile, 'utf8', (err, data) => {
            if (err) {
                console.error(`Error reading ${playerName}_stats.json:`, err);
                return res.status(500).json({ error: 'Failed to read player stats' });
            }
            res.json(JSON.parse(data));
        });
    } else {
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

            // Write player stats to file
            fs.writeFile(playerFile, JSON.stringify({ player: { name: playerName }, stats: playerStats }), 'utf8', (err) => {
                if (err) {
                    console.error(`Error writing ${playerName}_stats.json:`, err);
                }
            });

            res.json({ player: { name: playerName }, stats: playerStats });
        } catch (error) {
            console.error('Error fetching player stats:', error.message);
            res.status(500).json({ error: 'Player not found or API error' });
        }
    }
});

// Função para ler arquivos de cache com Promise
function readCacheFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                return reject(err);
            }
            try {
                const jsonData = JSON.parse(data);
                resolve(jsonData);
            } catch (parseError) {
                reject(new Error('Erro ao analisar JSON do cache'));
            }
        });
    });
}

// Função para gravar arquivos de cache com Promise
function writeCacheFile(filePath, data) {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(data), 'utf8', (err) => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

// Caminho para salvar as partidas no cache
const playerMatchesFilePath = (playerName) => path.join(__dirname, 'public', 'jsons', `${playerName}_matches.json`);

// API para buscar as partidas do jogador
app.get('/api/player/:playerName/matches', async (req, res) => {
    const { playerName } = req.params;
    const matchesFile = playerMatchesFilePath(playerName);

    // Verificar se o arquivo de cache existe
    if (fs.existsSync(matchesFile)) {
        try {
            // Ler o arquivo de cache
            const cachedData = await readCacheFile(matchesFile);
            return res.json(cachedData);  // Retornar o cache se encontrado
        } catch (error) {
            console.error(`Erro ao ler o cache para ${playerName}:`, error.message);
            return res.status(500).json({ error: 'Erro ao ler o cache' });
        }
    }

    // Se o cache não existir, buscar os dados da API externa
    try {
        const playerResponse = await axios.get(`${BASE_URL}/players?filter[playerNames]=${playerName}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/vnd.api+json'
            }
        });

        const matchesData = playerResponse.data.data[0].relationships.matches.data;

        const matchDetails = await Promise.all(matchesData.map(async match => {
            try {
                const matchId = match.id;
                const matchResponse = await axios.get(`${BASE_URL}/matches/${matchId}`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/vnd.api+json'
                    }
                });
                return matchResponse.data;
            } catch (error) {
                console.error(`Erro ao buscar a partida ${match.id}:`, error.message);
                return null;  // Retornar null se a partida falhar
            }
        }));

        const validMatches = matchDetails.filter(match => match !== null);

        if (validMatches.length === 0) {
            throw new Error('Nenhuma partida encontrada');
        }

        // Retornar os dados imediatamente ao cliente
        res.json({ matches: validMatches });

        // Salvar os detalhes da partida no cache de forma assíncrona
        writeCacheFile(matchesFile, { matches: validMatches })
            .then(() => console.log(`Cache salvo para o jogador ${playerName}`))
            .catch((error) => console.error(`Erro ao salvar o cache para ${playerName}:`, error.message));

    } catch (error) {
        console.error('Erro ao buscar as partidas:', error.message);
        res.status(500).json({ error: 'Erro ao buscar as partidas' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
