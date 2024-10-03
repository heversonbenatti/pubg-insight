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

    const selectedStats = stats[mode] || {};

    function updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value || 'N/A';
        }
    }

    updateElement('kd', selectedStats.kdRatio);
    updateElement('win-percentage', selectedStats.winRate);
    updateElement('top10-percentage', selectedStats.top10Rate);
    updateElement('games', selectedStats.gamesPlayed);
    updateElement('total-damage', selectedStats.damageDealt);
    updateElement('avg-damage', selectedStats.damagePerGame);
    updateElement('kda', selectedStats.kda);
    updateElement('top10', selectedStats.top10s);
    updateElement('wins', selectedStats.wins);
    updateElement('most-kills', selectedStats.mostKills);
    updateElement('assists', selectedStats.assists);
    updateElement('headshot-percentage', selectedStats.headshotRate);
}
