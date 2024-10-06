document.addEventListener('click', function (e) {
    if (e.target.closest('.arrow')) {
        const matchId = e.target.closest('.arrow').dataset.matchId;
        
        // Encontre os dados da partida correta com base no matchId
        const matchData = allMatches.find(match => match.data.id === matchId);

        // Abra a modal e passe os dados da partida específica
        if (matchData) {
            showModal(matchData);
        }
    }
});
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
                    console.error('No stats data received:', data); // Log data for debugging
                    return;
                }
        
                // Torna visível a seção de estatísticas após carregar os dados do jogador
                playerStatsContainer.style.display = 'block'; 
        
                // Salvar as estatísticas globalmente
                window.fppStats = data.stats.fpp;
                window.tppStats = data.stats.tpp;
        
                // Exibe o modo de jogo com mais partidas jogadas
                displayStatsForModeWithMostRounds(window.fppStats, window.tppStats);
        
                // Exibe o nome do jogador
                playerNameDisplay.textContent = playerName;
        
                // Carrega e exibe as últimas partidas
                await fetchAndDisplayPlayerMatches(playerName);
            } catch (error) {
                alert('Failed to load player stats.');
                console.error('Error fetching player stats:', error); // Log the error
            }
        });
    } catch (error) {
        alert('Failed to load seasons.');
    }
});

function showModal(matchData) {
    // Remove qualquer modal existente
    const existingModal = document.querySelector('.modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Cria a janela modal
    const modal = document.createElement('div');
    modal.classList.add('modal-custom');

    const modalContent = document.createElement('div');
    modalContent.classList.add('modal-content-custom');

    const modalContainer = document.createElement('div');
    modalContainer.classList.add('modal-container-custom');

    // Div para a lista de times
    const teamList = document.createElement('div');
    teamList.id = 'team-list-custom';
    teamList.classList.add('team-list-custom');

    // Div para o mapa
    const matchMap = document.createElement('div');
    matchMap.id = 'match-map-custom';
    matchMap.classList.add('match-map-custom');
    const mapImage = document.createElement('img');
    mapImage.id = 'map-image-custom';
    matchMap.appendChild(mapImage);

    // Div para os detalhes do time selecionado
    const teamDetails = document.createElement('div');
    teamDetails.id = 'team-details-custom';
    teamDetails.classList.add('team-details-custom');

    modalContainer.appendChild(teamList);
    modalContainer.appendChild(matchMap);
    modalContainer.appendChild(teamDetails);

    modalContent.appendChild(modalContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Popula os times na div da esquerda
    populateTeams(matchData, teamList);

    const mapName = matchData.data.attributes.mapName;
    updateMap(mapName);

    // Fecha a modal ao clicar fora
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function populateTeams(matchData, teamList) {
    // Limpa a lista de times
    teamList.innerHTML = '';

    // Filtra os rosters (times) no matchData
    const rosters = matchData.included.filter(item => item.type === 'roster');
    
    // Para cada time (roster)
    rosters.forEach((roster, index) => {
        // Pega o número do time (rank ou teamNumber)
        const teamNumber = roster.attributes.stats.rank || roster.attributes.stats.teamId;

        // Cria a div do time
        const teamDiv = document.createElement('div');
        teamDiv.classList.add('team-custom');
        teamDiv.style.cursor = 'pointer'; // Cursor de clique

        // Cria o elemento para o número do time
        const teamNumberDiv = document.createElement('div');
        teamNumberDiv.classList.add('team-number-custom');
        teamNumberDiv.textContent = teamNumber; // Exibe apenas o número do time

        // Gera uma cor única para o quadrado do número
        teamNumberDiv.style.backgroundColor = generateUniqueColor(index);

        // Cria o container para os jogadores
        const playersDiv = document.createElement('div');
        playersDiv.classList.add('players-list-custom');

        // Adiciona os jogadores dentro da div de jogadores
        roster.relationships.participants.data.forEach(participantRef => {
            const participant = matchData.included.find(p => p.id === participantRef.id);
            const playerDiv = document.createElement('div');
            playerDiv.textContent = participant.attributes.stats.name;
            playersDiv.appendChild(playerDiv);
        });

        // Adiciona o número do time e a lista de jogadores
        teamDiv.appendChild(teamNumberDiv);
        teamDiv.appendChild(playersDiv);

        // Adiciona o time na lista de times
        teamList.appendChild(teamDiv);

        // Torna a div clicável para mostrar os detalhes dos jogadores
        teamDiv.addEventListener('click', function() {
            displayTeamDetails(roster, matchData);
        });
    });
}

function generateUniqueColor(index) {
    const hue = (index * 137.5) % 360; // Gera uma cor diferente baseado no índice
    return `hsl(${hue}, 70%, 50%)`; // Retorna uma cor em formato HSL
}

// Função para exibir os detalhes dos jogadores do time na div da direita
function displayTeamDetails(roster, matchData) {
    const teamDetailsDiv = document.getElementById('team-details-custom');
    
    // Limpa os detalhes atuais
    teamDetailsDiv.innerHTML = '';

    // Adiciona os detalhes de cada jogador
    roster.relationships.participants.data.forEach(participantRef => {
        const participant = matchData.included.find(p => p.id === participantRef.id);
        
        // Criar uma div para cada jogador com detalhes
        const playerDetailDiv = document.createElement('div');
        playerDetailDiv.classList.add('player-detail-custom');
        playerDetailDiv.textContent = `Player: ${participant.attributes.stats.name} - Kills: ${participant.attributes.stats.kills}, Damage: ${participant.attributes.stats.damageDealt.toFixed(2)}`;
        
        // Adiciona os detalhes do jogador à div de detalhes do time
        teamDetailsDiv.appendChild(playerDetailDiv);
    });
}

// Função para atualizar a imagem do mapa
function updateMap(mapName) {
    const translatedMapName = translateMapName(mapName); // Traduz o nome do mapa
    const mapImage = document.getElementById('map-image-custom');
    mapImage.src = `/images/${translatedMapName.toLowerCase()}map.png`; // Usa o nome traduzido
    mapImage.alt = `${translatedMapName} map`; // Define o atributo alt
}

// Função para adicionar terminação ordinal ao número
function getOrdinalSuffix(rank) {
    const j = rank % 10,
          k = rank % 100;
    if (j == 1 && k != 11) {
        return rank + "st";
    }
    if (j == 2 && k != 12) {
        return rank + "nd";
    }
    if (j == 3 && k != 13) {
        return rank + "rd";
    }
    return rank + "th";
}

function translateMapName(mapName) {
    const mapNames = {
        'Erangel_Main': 'Erangel',
        'Desert_Main': 'Miramar',
        'Savage_Main': 'Sanhok',
        'DihorOtok_Main': 'Vikendi',
        'Summerland_Main': 'Karakin',
        'Tiger_Main': 'Taego',
        'Kiki_Main': 'Deston',
        'Neon_Main': 'Rondo',
        'Baltic_Main': 'Erangel'
    };
    
    return mapNames[mapName] || mapName; // Return translated name or fallback to original
}

let allMatches = [];  // This will hold all the fetched matches
let currentIndex = 0;  // This will keep track of how many matches have been displayed so far
const matchesPerPage = 20;  // Number of matches to load at once

async function fetchAndDisplayPlayerMatches(playerName) {
    try {
        const response = await fetch(`/api/player/${playerName}/matches`);
        const data = await response.json();

        if (!data.matches) {
            throw new Error('No matches found');
        }

        allMatches = data.matches;
        currentIndex = 0;

        // Exibir a div de Last Matches quando as partidas forem carregadas
        const matchesContainer = document.getElementById('matches-container');
        matchesContainer.style.display = 'block';  // Mostra a div das partidas

        displayNextMatches(playerName);
        setupLoadMoreButton(playerName);
    } catch (error) {
        console.error('Error fetching matches:', error);
        alert('Failed to load matches');
    }
}

function displayNextMatches(playerName) {
    if (!allMatches || allMatches.length === 0) {
        alert('No matches to display');
        return;
    }

    const matchListContainer = document.getElementById('match-list');
    const nextMatches = allMatches.slice(currentIndex, currentIndex + matchesPerPage);  // Pega as próximas 20 partidas
    currentIndex += nextMatches.length;  // Atualiza currentIndex

    nextMatches.forEach((match) => {

        const matchType = match.data.attributes.matchType;
        const gameMode = match.data.attributes.gameMode.toUpperCase().replace('-', ' ');
        const mapName = match.data.attributes.mapName;

        // Traduza o nome do mapa para a URL da imagem
        const translatedMapName = translateMapName(mapName);

        // Determine se a partida é Ranked ou Normal
        const matchCategory = matchType === "competitive" ? "Ranked" : "Normal";

        // Conta o número de rosters (times) na partida
        const totalRosters = match.data.relationships.rosters.data.length;

        // Encontre o participante que corresponde ao nome do jogador
        const participants = match.included.filter(item => item.type === 'participant');
        const participant = participants.find(p => p.attributes?.stats?.name === playerName);

        if (participant) {
            // Criar o elemento de exibição de partida somente se o participante for encontrado
            const matchItem = document.createElement('div');
            matchItem.classList.add('match-info');
        
            const { kills, assists, damageDealt, winPlace, timeSurvived } = participant.attributes.stats;
            const firstPlaceClass = winPlace === 1 ? 'first-place' : '';
        
            // Inserir o HTML com os dados da partida
            matchItem.innerHTML = `
            <div class="match-photo-rank">
                <div class="match-background ${firstPlaceClass}" style="background-image: url('/images/${translatedMapName.toLowerCase()}.jpg');">
                    <div class="match-rank-overlay">
                        <span class="rank-large">#${winPlace}</span><span class="rank-small">/${totalRosters}</span>
                    </div>
                </div>
            </div>
            <div class="match-map-mode">
                <div class="match-map">${matchCategory}</div>
                <div class="match-mode">${gameMode}</div>
            </div>
            <div class="match-stats">
                <div class="match-kills">Kills: ${kills}</div>
                <div class="match-assists">Assists: ${assists}</div>
                <div class="match-damage">Damage: ${Math.round(damageDealt)}</div>
                <div class="match-time">Time: ${formatTime(timeSurvived)}</div>
            </div>
            <div class="match-arrow">
                <div class="arrow" data-match-id="${match.data.id}">
                    <div class="arrow-top"></div>
                    <div class="arrow-bottom"></div>
                </div>
            </div>
            `;
        
            // Adiciona o elemento ao container de partidas
            matchListContainer.appendChild(matchItem);
        } else {
            return;
        }
    });

    if (currentIndex >= allMatches.length) {
        document.getElementById('load-more').style.display = 'none';
    }
}

function setupLoadMoreButton(playerName) {
    // Create a Load More button if it doesn't exist
    let loadMoreButton = document.getElementById('load-more');
    if (!loadMoreButton) {
        loadMoreButton = document.createElement('button');
        loadMoreButton.id = 'load-more';
        loadMoreButton.textContent = 'Load More';
        loadMoreButton.style.display = 'block';
        loadMoreButton.style.margin = '20px auto';
        loadMoreButton.style.padding = '10px';
        loadMoreButton.style.cursor = 'pointer';

        // Add the button to the DOM
        const matchListContainer = document.getElementById('matches-container');
        matchListContainer.appendChild(loadMoreButton);

        // Add click event listener
        loadMoreButton.addEventListener('click', () => displayNextMatches(playerName));  // Pass playerName to displayNextMatches
    }
}

// Helper function to format the time survived in minutes:seconds
function formatTime(timeInSeconds) {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
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

function getGameModeWithMostRounds(fppStats, tppStats) {
    const modes = ['solo', 'duo', 'squad'];

    // Inicializa com valores de rounds jogados e seu modo correspondente
    let maxRounds = 0;
    let selectedMode = 'squadFpp'; // Default caso não tenha nenhum modo com partidas

    modes.forEach(mode => {
        const fppRounds = fppStats[mode]?.roundsPlayed || 0;
        const tppRounds = tppStats[mode]?.roundsPlayed || 0;

        // Verifica se o modo FPP tem mais rounds jogados
        if (fppRounds > maxRounds) {
            maxRounds = fppRounds;
            selectedMode = `${mode}Fpp`;
        }

        // Verifica se o modo TPP tem mais rounds jogados
        if (tppRounds > maxRounds) {
            maxRounds = tppRounds;
            selectedMode = `${mode}Tpp`;
        }
    });

    return selectedMode;
}

function displayStatsForModeWithMostRounds(fppStats, tppStats) {
    const gameMode = getGameModeWithMostRounds(fppStats, tppStats);

    // Simula um clique no botão correspondente ao gameMode com mais rounds
    const button = document.querySelector(`.tablink[onclick*="${gameMode}"]`);
    if (button) {
        button.click(); // Simula o clique para abrir a aba automaticamente
    }
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
        const damageDealt = Math.round(statObj.damageDealt) || 0;
        const assists = statObj.assists || 0;
        const headshotKills = statObj.headshotKills || 0;
        const mostKills = statObj.roundMostKills || 0;
        const longestKill = statObj.longestKill ? Math.round(statObj.longestKill) + 'm' : 0;

        const kdRatio = kills && deaths ? (kills / deaths).toFixed(2) : 0;
        const kda = (kills + assists) && deaths ? ((kills + assists) / deaths).toFixed(2) : 0;
        const winPercentage = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(2) + '%' : 0;
        const top10Percentage = totalGames > 0 ? ((top10s / totalGames) * 100).toFixed(2) + '%' : 0;
        const avgDamage = damageDealt ? Math.round((damageDealt / totalGames)) : 0;
        const headshotPercentage = kills ? ((headshotKills / kills) * 100).toFixed(2) + '%' : 0;

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
    createStatElement('Assist', selectedStats.assists || 0);
    createStatElement('Games', selectedStats.roundsPlayed || 0);
    createStatElement('Win %', statsToDisplay.winPercentage);
    createStatElement('Wins', selectedStats.wins || 0);
    createStatElement('KDA', statsToDisplay.kda);
    createStatElement('Headshot %', statsToDisplay.headshotPercentage);
    createStatElement('Most Kills', statsToDisplay.mostKills);
    createStatElement('Longest Kill', statsToDisplay.longestKill);
    createStatElement('Top 10 %', statsToDisplay.top10Percentage);
    createStatElement('Top 10', selectedStats.top10s || selectedStats.top10 || 0);
}
