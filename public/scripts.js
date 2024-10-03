document.addEventListener('DOMContentLoaded', async function() {
    const seasonSelect = document.getElementById('season-select');

    // Fetch seasons and populate the select element
    try {
        const response = await fetch('/api/seasons');
        const seasons = await response.json();

        if (seasons.error) {
            alert('Could not load seasons');
            return;
        }

        const pcSeasons = seasons.filter(season => season.id.includes('pc'));
        pcSeasons.forEach(season => {
            const option = document.createElement('option');
            const seasonNumber = season.id.match(/-(\d{2})$/);
            option.value = season.id;
            option.textContent = `Season ${seasonNumber[1]}`;
            seasonSelect.appendChild(option);
        });
    } catch (error) {
        alert('Failed to load seasons.');
    }

    document.getElementById('player-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        const playerName = document.getElementById('player-name').value;
        const seasonId = document.getElementById('season-select').value;

        // Fetch player stats for both FPP and TPP
        try {
            const response = await fetch(`/api/player/${playerName}?season=${seasonId}`);
            const data = await response.json();

            if (data.error) {
                alert('Player not found');
                return;
            }

            // Set player name
            document.getElementById('player-name-display').textContent = playerName;

            // Display stats for FPP and TPP in respective tabs
            updateStats(data.stats.fpp, data.stats.tpp);
        } catch (error) {
            alert('Failed to load player stats.');
        }
    });
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
