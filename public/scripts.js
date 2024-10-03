document.addEventListener('DOMContentLoaded', async function() {
    const seasonSelect = document.getElementById('season-select');
    const playerForm = document.getElementById('player-form');

    try {
        const response = await fetch('/api/seasons');
        const seasons = await response.json();

        if (!seasons || seasons.error) {
            alert('Could not load seasons');
            return;
        }

        // Inicializa a variável para armazenar o número da temporada atual
        let currentSeasonNumber = null;

        // Filtrar apenas as seasons de "pc" e que não sejam de "console"
        const pcSeasons = seasons.filter(season => {
            if (season.id.includes('pc') && !season.id.includes('console')) {
                const seasonNumber = parseInt(season.id.split('-').pop(), 10);
                if (season.attributes.isCurrentSeason) {
                    currentSeasonNumber = seasonNumber; // Armazena o número da currentSeason
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

        // Preencher o select com as seasons, exceto as futuras
        pcSeasons.forEach(season => {
            const seasonNumber = parseInt(season.id.split('-').pop(), 10);

            // Ignora seasons maiores que a atual (futuras)
            if (currentSeasonNumber && seasonNumber > currentSeasonNumber) {
                return;
            }

            const option = document.createElement('option');
            option.value = season.id;
            option.textContent = `Season ${seasonNumber}`;

            // Define a season atual como selecionada
            if (season.attributes.isCurrentSeason) {
                currentSeasonId = season.id;
                option.selected = true;
            }

            seasonSelect.appendChild(option);
        });

        // Caso não tenha sido encontrado currentSeasonId, selecionar a primeira temporada disponível
        if (!currentSeasonId && pcSeasons.length > 0) {
            seasonSelect.selectedIndex = 0; // Seleciona a primeira season
        }

        // Prevenir comportamento padrão do formulário
        playerForm.addEventListener('submit', async function(e) {
            e.preventDefault(); // Previne o reload da página

            const playerName = document.getElementById('player-name').value;
            const seasonId = seasonSelect.value;

            // Fetch player stats
            try {
                const response = await fetch(`/api/player/${playerName}?season=${seasonId}`);
                const data = await response.json();

                if (!data.stats) {
                    alert('No stats available for this player');
                    return;
                }

                // Armazena as estatísticas de FPP e TPP globalmente
                window.fppStats = data.stats.fpp;
                window.tppStats = data.stats.tpp;

                // Atualiza as estatísticas para a aba ativa
                updateStats(window.fppStats, window.tppStats);
                document.getElementById('player-name-display').textContent = playerName;
            } catch (error) {
                alert('Failed to load player stats.');
            }
        });

    } catch (error) {
        alert('Failed to load seasons.');
    }
});

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
    const fppStats = window.fppStats || {}; // Garantindo que os dados de FPP estejam disponíveis
    const tppStats = window.tppStats || {}; // Garantindo que os dados de TPP estejam disponíveis

    // Atualiza os dados com base na aba ativa
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

    // Limpa o conteúdo anterior
    const statsContainer = document.getElementById('stats-container');
    statsContainer.innerHTML = ''; // Limpa todas as estatísticas anteriores

    if (!selectedStats || !selectedStats.roundsPlayed || selectedStats.roundsPlayed === 0) {
        const noDataMessage = document.createElement('p');
        noDataMessage.textContent = 'No matches found';
        noDataMessage.classList.add('no-data-message'); // Adiciona a classe
        statsContainer.appendChild(noDataMessage);
        return;
    }

    // Função para calcular as estatísticas
    function calculateStats(statObj) {
        const totalGames = statObj.roundsPlayed || 1;
        const wins = statObj.wins || 0;
        const kills = (statObj.kills || 0) - (statObj.teamKills || 0);
        const deaths = totalGames - wins;
        const top10s = statObj.top10s || statObj.top10 || 0;
        const damageDealt = statObj.damageDealt || 0; // Ainda utilizamos para Avg Damage
        const assists = statObj.assists || 0;
        const headshotKills = statObj.headshotKills || 0;
        const mostKills = statObj.roundMostKills || 'N/A';
        const longestKill = statObj.longestKill ? statObj.longestKill.toFixed(2) + 'm' : 'N/A';

        const kdRatio = kills && deaths ? (kills / deaths).toFixed(2) : 'N/A';
        const kda = (kills + assists) && deaths ? ((kills + assists) / deaths).toFixed(2) : 'N/A';
        const winPercentage = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(2) + '%' : 'N/A';
        const top10Percentage = totalGames > 0 ? ((top10s / totalGames) * 100).toFixed(2) + '%' : 'N/A';
        const avgDamage = damageDealt ? (damageDealt / totalGames).toFixed(2) : 'N/A'; // Continua para Avg Damage
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

    // Exibir as estatísticas (sem "Total Damage")
    createStatElement('K/D', statsToDisplay.kdRatio);
    createStatElement('Win %', statsToDisplay.winPercentage);
    createStatElement('Top 10 %', statsToDisplay.top10Percentage);
    createStatElement('Games', selectedStats.roundsPlayed || 'N/A');
    createStatElement('Avg. Damage', statsToDisplay.avgDamage);
    createStatElement('KDA', statsToDisplay.kda);
    createStatElement('Top 10', selectedStats.top10s || selectedStats.top10 || 'N/A');
    createStatElement('Wins', selectedStats.wins || 'N/A');
    createStatElement('Most Kills', statsToDisplay.mostKills);
    createStatElement('Assist', selectedStats.assists || 'N/A');
    createStatElement('Headshot %', statsToDisplay.headshotPercentage);
    createStatElement('Longest Kill', statsToDisplay.longestKill);
}
