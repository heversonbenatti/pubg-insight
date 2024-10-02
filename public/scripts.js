// Função para carregar as temporadas ao carregar a página
document.addEventListener('DOMContentLoaded', async function() {
    const seasonSelect = document.getElementById('season-select');
    
    try {
        // Requisição para obter as temporadas
        const response = await fetch('/api/seasons');
        const seasons = await response.json();

        if (seasons.error) {
            alert('Could not load seasons');
            return;
        }

        let currentSeasonId = null;

        // Filtrar apenas as temporadas de PC
        const pcSeasons = seasons.filter(season => season.id.includes('pc'));

        if (pcSeasons.length === 0) {
            alert('No PC seasons found');
            return;
        }

        // Popula o dropdown com as temporadas de PC e identifica a temporada atual
        pcSeasons.forEach(season => {
            const option = document.createElement('option');
            option.value = season.id;
            option.textContent = season.id;
            seasonSelect.appendChild(option);

            // Verifica se é a temporada atual
            if (season.attributes.isCurrentSeason) {
                currentSeasonId = season.id;
            }
        });

        // Seleciona automaticamente a temporada atual
        if (currentSeasonId) {
            seasonSelect.value = currentSeasonId;
        }

    } catch (error) {
        console.error('Error loading seasons:', error);
        alert('Failed to load seasons.');
    }
});

// Função para limpar os dados anteriores
function clearStats() {
    document.getElementById('stats-section').classList.add('hidden');
    
    ['solo', 'duo', 'squad'].forEach(mode => {
        const modeInfo = document.getElementById(`${mode}-info`);
        modeInfo.querySelector('.no-data').classList.remove('hidden');
        modeInfo.querySelector('.stats').classList.add('hidden');
    });
}

// Função para exibir as estatísticas de um modo específico (solo, duo, squad)
function displayStats(mode, stats) {
    const modeInfo = document.getElementById(`${mode}-info`);
    
    if (stats.roundsPlayed === 0) {
        // Exibe "No data available" e oculta todas as estatísticas
        modeInfo.querySelector('.no-data').classList.remove('hidden');
        modeInfo.querySelector('.stats').classList.add('hidden');  // Esconder as estatísticas
    } else {
        // Preenche as estatísticas e oculta "No data available"
        modeInfo.querySelector('.no-data').classList.add('hidden');
        const statsDiv = modeInfo.querySelector('.stats');
        statsDiv.classList.remove('hidden');

        statsDiv.querySelector('.games').innerText = stats.roundsPlayed || 'N/A';
        statsDiv.querySelector('.kd').innerText = stats.kills ? (stats.kills / Math.max(stats.roundsPlayed - stats.wins, 1)).toFixed(2) : 'N/A';
        statsDiv.querySelector('.damage').innerText = stats.damageDealt ? (stats.damageDealt / stats.roundsPlayed).toFixed(0) : 'N/A';
        statsDiv.querySelector('.winrate').innerText = stats.wins ? ((stats.wins / stats.roundsPlayed) * 100).toFixed(1) + '%' : 'N/A';
        statsDiv.querySelector('.top10rate').innerText = stats.top10s ? (((stats.top10s - stats.wins) / stats.roundsPlayed) * 100).toFixed(1) + '%' : 'N/A';
        statsDiv.querySelector('.longestkill').innerText = stats.longestKill ? stats.longestKill.toFixed(1) + 'm' : 'N/A';
        statsDiv.querySelector('.headshot').innerText = stats.headshotKills ? ((stats.headshotKills / Math.max(stats.kills, 1)) * 100).toFixed(1) + '%' : 'N/A';
        statsDiv.querySelector('.mostkills').innerText = stats.roundMostKills || 'N/A';
    }
}

// Função para exibir todas as estatísticas de Solo, Duo e Squad
function displayAllStats(data) {
    const modes = ['solo', 'duo', 'squad'];
    
    modes.forEach(mode => {
        const modeStats = data.stats[mode] || { roundsPlayed: 0 };
        displayStats(mode, modeStats);
    });

    // Exibir a seção de estatísticas
    document.getElementById('stats-section').classList.remove('hidden');
}

document.getElementById('player-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const playerName = document.getElementById('player-name').value;
    const seasonId = document.getElementById('season-select').value;
    const isFPP = document.getElementById('is-fpp').checked ? 'true' : 'false';

    // Limpar os dados antigos
    clearStats();

    // Requisitar estatísticas do jogador
    const response = await fetch(`/api/player/${playerName}?season=${seasonId}&isFPP=${isFPP}`);
    const data = await response.json();

    if (data.error) {
        alert('Player not found');
        return;
    }

    // Exibir as estatísticas do jogador
    displayAllStats(data);
});

// Função para formatar o tempo em minutos e segundos
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
}
