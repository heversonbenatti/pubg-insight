document.addEventListener('DOMContentLoaded', async function() {
    const seasonSelect = document.getElementById('season-select');

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
    } catch (error) {
        alert('Failed to load seasons.');
    }
});

function updateStats(fppStats, tppStats) {
    const currentTab = document.querySelector('.w3-bar .w3-gray').textContent;
    const stats = currentTab.includes('FPP') ? fppStats : tppStats;
    const mode = currentTab.includes('SOLO') ? 'solo' : currentTab.includes('DUO') ? 'duo' : 'squad';

    const selectedStats = stats[mode] || {};

    document.getElementById('kd').textContent = selectedStats.kdRatio || 'N/A';
    document.getElementById('win-percentage').textContent = selectedStats.winRate || 'N/A';
    document.getElementById('top10-percentage').textContent = selectedStats.top10Rate || 'N/A';
    document.getElementById('games').textContent = selectedStats.gamesPlayed || 'N/A';
    document.getElementById('total-damage').textContent = selectedStats.damageDealt || 'N/A';
    document.getElementById('avg-damage').textContent = selectedStats.damagePerGame || 'N/A';
    document.getElementById('kda').textContent = selectedStats.kda || 'N/A';
    document.getElementById('top10').textContent = selectedStats.top10s || 'N/A';
    document.getElementById('wins').textContent = selectedStats.wins || 'N/A';
    document.getElementById('most-kills').textContent = selectedStats.mostKills || 'N/A';
    document.getElementById('assists').textContent = selectedStats.assists || 'N/A';
    document.getElementById('headshot-percentage').textContent = selectedStats.headshotRate || 'N/A';
}

// Tab navigation
function openTab(evt, tabName) {
    let i, x, tablinks;
    x = document.getElementsByClassName("tab-content");
    for (i = 0; i < x.length; i++) {
        x[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" w3-gray", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " w3-gray";

    // Update stats based on the selected tab
    const currentTab = evt.currentTarget.textContent;
    const stats = currentTab.includes('FPP') ? 'fppStats' : 'tppStats';
    updateStats(window[stats][currentTab.toLowerCase()]);
}
