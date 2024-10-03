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

    const selectedStats = stats && stats[mode] ? stats[mode] : {};

    // Função para calcular K/D, Win %, etc.
    function calculateStats(statObj) {
        const totalGames = statObj.roundsPlayed || 1;  // Total de jogos
        const wins = statObj.wins || 0;  // Total de vitórias
        const kills = (statObj.kills || 0) - (statObj.teamKills || 0);  // Kills - Team Kills
        const deaths = totalGames - wins;  // Deaths = Total de jogos - Vitórias
        const top10s = statObj.top10s || statObj.top10 || 0;  // Top 10s
        const damageDealt = statObj.damageDealt || 0;  // Dano causado
        const assists = statObj.assists || 0;  // Assistências
        const headshotKills = statObj.headshotKills || 0;  // Headshots
        const mostKills = statObj.roundMostKills || 'N/A';  // Most Kills
        const longestKill = statObj.longestKill ? statObj.longestKill.toFixed(2) + 'm' : 'N/A';  // Longest Kill

        // Calculando estatísticas
        const kdRatio = kills && deaths ? (kills / deaths).toFixed(2) : 'N/A';  // K/D Ratio
        const kda = (kills + assists) && deaths ? ((kills + assists) / deaths).toFixed(2) : 'N/A';  // KDA
        const winPercentage = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(2) + '%' : 'N/A';  // Win %
        const top10Percentage = totalGames > 0 ? ((top10s / totalGames) * 100).toFixed(2) + '%' : 'N/A';  // Top 10 %
        const avgDamage = damageDealt ? (damageDealt / totalGames).toFixed(2) : 'N/A';  // Avg Damage
        const headshotPercentage = kills ? ((headshotKills / kills) * 100).toFixed(2) + '%' : 'N/A';  // Headshot %

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

    // Atualiza os elementos na página
    function updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value || 'N/A';
        }
    }

    updateElement('kd', statsToDisplay.kdRatio);
    updateElement('win-percentage', statsToDisplay.winPercentage);
    updateElement('top10-percentage', statsToDisplay.top10Percentage);
    updateElement('games', selectedStats.roundsPlayed || 'N/A');
    updateElement('total-damage', selectedStats.damageDealt || 'N/A');
    updateElement('avg-damage', statsToDisplay.avgDamage);
    updateElement('kda', statsToDisplay.kda);
    updateElement('top10', selectedStats.top10s || selectedStats.top10 || 'N/A');
    updateElement('wins', selectedStats.wins || 'N/A');
    updateElement('most-kills', statsToDisplay.mostKills);
    updateElement('assists', selectedStats.assists || 'N/A');
    updateElement('headshot-percentage', statsToDisplay.headshotPercentage);
    updateElement('longest-kill', statsToDisplay.longestKill);
}
