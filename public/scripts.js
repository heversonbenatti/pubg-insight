document.addEventListener('DOMContentLoaded', async function () {
    const seasonSelect = document.getElementById('season-select');
    const playerForm = document.getElementById('player-form');
    const playerStatsContainer = document.getElementById('player-stats');
    const playerNameDisplay = document.getElementById('player-name-display');

    // Hide player stats container initially
    playerStatsContainer.style.display = 'none';

    // Fetch seasons and populate the select dropdown
    try {
        const response = await fetch('/api/seasons');
        const seasons = await response.json();

        if (!seasons || seasons.error) {
            alert('Could not load seasons');
            return;
        }

        let currentSeasonNumber = null;

        const pcSeasons = seasons.filter(season => {
            if (season.id.includes('pc') && !season.id.includes('console')) {
                const seasonNumber = parseInt(season.id.split('-').pop(), 10);
                if (season.attributes.isCurrentSeason) {
                    currentSeasonNumber = seasonNumber;
                }
                return true;
            }
            return false;
        }).sort((a, b) => {
            const seasonA = parseInt(a.id.split('-').pop(), 10);
            const seasonB = parseInt(b.id.split('-').pop(), 10);
            return seasonB - seasonA; // Ordena da maior para a menor
        });

        let currentSeasonId = '';

        pcSeasons.forEach(season => {
            const seasonNumber = parseInt(season.id.split('-').pop(), 10);

            if (currentSeasonNumber && seasonNumber > currentSeasonNumber) {
                return;
            }

            const option = document.createElement('option');
            option.value = season.id;
            option.textContent = `Season ${seasonNumber}`;

            if (season.attributes.isCurrentSeason) {
                currentSeasonId = season.id;
                option.selected = true;
            }

            seasonSelect.appendChild(option);
        });

        if (!currentSeasonId && pcSeasons.length > 0) {
            seasonSelect.selectedIndex = 0;
        }

        // Prevenir comportamento padrão do formulário
        playerForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const playerName = document.getElementById('player-name').value;
            const seasonId = seasonSelect.value;

            try {
                const response = await fetch(`/api/player/${playerName}?season=${seasonId}`);
                const data = await response.json();

                if (!data.stats) {
                    alert('No stats available for this player');
                    return;
                }

                // Make player-stats visible once the player data is loaded
                playerStatsContainer.style.display = 'block'; // Mostra a div player-stats

                // Armazena as estatísticas de FPP e TPP globalmente
                window.fppStats = data.stats.fpp;
                window.tppStats = data.stats.tpp;

                // Atualiza as estatísticas para a aba ativa
                updateStats(window.fppStats, window.tppStats);
                playerNameDisplay.textContent = playerName;

                // Fetch and display the last 20 matches
                await fetchPlayerMatches(playerName);
            } catch (error) {
                alert('Failed to load player stats.');
            }
        });
    } catch (error) {
        alert('Failed to load seasons.');
    }
});

function translateMapName(mapName) {
    const mapNames = {
        'Erangel_Main': 'Erangel',
        'Desert_Main': 'Miramar',
        'Savage_Main': 'Sanhok',
        'DihorOtok_Main': 'Vikendi',
        'Summerland_Main': 'Karakin',
        'Tiger_Main': 'Taego',
        'Kiki_Main': 'Deston'
    };
    
    return mapNames[mapName] || mapName; // Return translated name or fallback to original
}

async function fetchPlayerMatches(playerName) {
    try {
        const response = await fetch(`/api/player/${playerName}/matches`);
        const data = await response.json();
        const matches = data.matches;

        const matchListContainer = document.getElementById('match-list');
        matchListContainer.innerHTML = ''; // Clear previous matches

        if (matches.length === 0) {
            matchListContainer.innerHTML = '<p>No matches found.</p>';
            return;
        }

        matches.forEach((match) => {
            const matchItem = document.createElement('div');
            matchItem.classList.add('match-info');

            // Translate the map name using the function
            const mapName = translateMapName(match.data.attributes.mapName);
            const gameMode = match.data.attributes.gameMode;

            const participants = match.included.filter(item => item.type === 'participant');
            const participant = participants.find(p => p.attributes.stats.name === playerName);

            if (participant) {
                const { kills, damageDealt, winPlace } = participant.attributes.stats;

                matchItem.innerHTML = `
                    <h4>Mapa: ${mapName}</h4>
                    <p>Modo de Jogo: ${gameMode}</p>
                    <p>Posição do Squad: #${winPlace}</p>
                    <p>Kills: ${kills}</p>
                    <p>Dano: ${damageDealt.toFixed(2)}</p>
                `;
            } else {
                matchItem.innerHTML = `<p>Player not found in this match</p>`;
            }

            matchListContainer.appendChild(matchItem);
        });

        matchListContainer.style.display = 'block'; // Ensure it's visible
    } catch (error) {
        console.error('Error fetching matches:', error);
        alert('Failed to load matches');
    }
}

// Função para exibir as informações das últimas partidas
function displayMatches(matchesData, playerName) {
    const matchesContainer = document.getElementById('match-list'); // Target #match-list
    matchesContainer.innerHTML = ''; // Clear previous matches

    matchesData.forEach(match => {
        const matchInfo = document.createElement('div');
        matchInfo.classList.add('match-info');

        const mapName = match.mapName;
        const gameMode = match.gameMode;
        
        // Filtra para encontrar o participante que corresponde ao jogador buscado
        const participant = match.participants.find(p => p.name === playerName);

        if (participant) {
            const { kills, damageDealt, winPlace } = participant.stats;

            // Criação dos elementos HTML para exibir as informações
            matchInfo.innerHTML = `
                <h4>Mapa: ${mapName}</h4>
                <p>Modo de Jogo: ${gameMode}</p>
                <p>Posição do Squad: #${winPlace}</p>
                <p>Kills: ${kills}</p>
                <p>Dano: ${damageDealt.toFixed(2)}</p>
            `;
            matchesContainer.appendChild(matchInfo);
        }
    });
}

function openTab(evt, tabName) {
    var i, tablinks;

    // Remove a classe "active" de todas as abas
    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("w3-gray", "active");
    }

    // Adiciona a classe "active" à aba clicada
    evt.currentTarget.classList.add("w3-gray", "active");

    // Chame a função updateStats sempre que uma aba for clicada
    const fppStats = window.fppStats || {};
    const tppStats = window.tppStats || {};

    updateStats(fppStats, tppStats);
}

function updateStats(fppStats, tppStats) {
    const currentTab = document.querySelector('.tablink.active')?.textContent;

    if (!currentTab) {
        return;
    }

    const stats = currentTab.includes('FPP') ? fppStats : tppStats;
    const mode = currentTab.includes('SOLO') ? 'solo' : currentTab.includes('DUO') ? 'duo' : 'squad';

    const selectedStats = stats && stats[mode] ? stats[mode] : null;

    const statsContainer = document.getElementById('stats-container');
    statsContainer.innerHTML = ''; // Limpa todas as estatísticas anteriores

    if (!selectedStats || !selectedStats.roundsPlayed || selectedStats.roundsPlayed === 0) {
        const noDataMessage = document.createElement('p');
        noDataMessage.textContent = 'No matches found';
        noDataMessage.classList.add('no-data-message');
        statsContainer.appendChild(noDataMessage);
        return;
    }

    function calculateStats(statObj) {
        const totalGames = statObj.roundsPlayed || 1;
        const wins = statObj.wins || 0;
        const kills = (statObj.kills || 0) - (statObj.teamKills || 0);
        const deaths = statObj.losses;
        const top10s = statObj.top10s || statObj.top10 || 0;
        const damageDealt = statObj.damageDealt || 0;
        const assists = statObj.assists || 0;
        const headshotKills = statObj.headshotKills || 0;
        const mostKills = statObj.roundMostKills || 'N/A';
        const longestKill = statObj.longestKill ? statObj.longestKill.toFixed(2) + 'm' : 'N/A';

        const kdRatio = kills && deaths ? (kills / deaths).toFixed(2) : 'N/A';
        const kda = (kills + assists) && deaths ? ((kills + assists) / deaths).toFixed(2) : 'N/A';
        const winPercentage = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(2) + '%' : 'N/A';
        const top10Percentage = totalGames > 0 ? ((top10s / totalGames) * 100).toFixed(2) + '%' : 'N/A';
        const avgDamage = damageDealt ? (damageDealt / totalGames).toFixed(2) : 'N/A';
        const headshotPercentage = kills ? ((headshotKills / kills) * 100).toFixed(2) + '%' : 'N/A';

        return {
            kdRatio,
            winPercentage,
            top10Percentage,
            avgDamage,
            kda,
            headshotPercentage,
            mostKills,
            longestKill
        };
    }

    const statsToDisplay = calculateStats(selectedStats);

    function createStatElement(title, value) {
        const statItem = document.createElement('div');
        statItem.classList.add('stat-item');

        const statTitle = document.createElement('h2');
        statTitle.textContent = title;
        statItem.appendChild(statTitle);

        const statValue = document.createElement('p');
        statValue.textContent = value;
        statItem.appendChild(statValue);

        statsContainer.appendChild(statItem);
    }

    createStatElement('K/D', statsToDisplay.kdRatio);
    createStatElement('Avg. Damage', statsToDisplay.avgDamage);
    createStatElement('Assist', selectedStats.assists || 'N/A');
    createStatElement('Games', selectedStats.roundsPlayed || 'N/A');
    createStatElement('Win %', statsToDisplay.winPercentage);
    createStatElement('Wins', selectedStats.wins || 'N/A');
    createStatElement('KDA', statsToDisplay.kda);
    createStatElement('Headshot %', statsToDisplay.headshotPercentage);
    createStatElement('Most Kills', statsToDisplay.mostKills);
    createStatElement('Longest Kill', statsToDisplay.longestKill);
    createStatElement('Top 10 %', statsToDisplay.top10Percentage);
    createStatElement('Top 10', selectedStats.top10s || selectedStats.top10 || 'N/A');
}
