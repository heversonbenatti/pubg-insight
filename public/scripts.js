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
        
                // Make player-stats visible once the player data is loaded
                playerStatsContainer.style.display = 'block'; // Show the player stats div
        
                // Store FPP and TPP stats globally (if necessary)
                window.fppStats = data.stats.fpp;
                window.tppStats = data.stats.tpp;
        
                // Update the stats for the active tab
                updateStats(window.fppStats, window.tppStats);
                playerNameDisplay.textContent = playerName;
        
                // Fetch and display the last 5 matches
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
        allMatches = data.matches;  // Store all matches
        currentIndex = 0;  // Reset the current index

        displayNextMatches(playerName);  // Pass playerName to the next function
        setupLoadMoreButton(playerName);  // Pass playerName to the setup function

    } catch (error) {
        console.error('Error fetching matches:', error);
        alert('Failed to load matches');
    }
}

function displayNextMatches(playerName) {
    const matchListContainer = document.getElementById('match-list');
    
    const nextMatches = allMatches.slice(currentIndex, currentIndex + matchesPerPage);  // Get the next 20 matches
    currentIndex += nextMatches.length;  // Update currentIndex

    nextMatches.forEach((match) => {
        const matchItem = document.createElement('div');
        matchItem.classList.add('match-info');

        const matchType = match.data.attributes.matchType;
        const gameMode = match.data.attributes.gameMode.toUpperCase().replace('-', ' ');
        const mapName = match.data.attributes.mapName;

        // Translate the map name for the image URL
        const translatedMapName = translateMapName(mapName);

        // Determine if the match is Ranked or Normal
        const matchCategory = matchType === "competitive" ? "Ranked" : "Normal";

        // Count the number of rosters (teams) in the match
        const totalRosters = match.data.relationships.rosters.data.length;

        // Find the participant matching the player's name
        const participants = match.included.filter(item => item.type === 'participant');
        const participant = participants.find(p => p.attributes?.stats?.name === playerName);

        if (participant) {
            const { kills, assists, damageDealt, winPlace, timeSurvived } = participant.attributes.stats;

            // Add the 'first-place' class if the team finished first
            const firstPlaceClass = winPlace === 1 ? 'first-place' : '';

            // Create the HTML structure with three divs
            matchItem.innerHTML = `
            <div class="match-section match-photo-rank">
                <div class="match-background ${firstPlaceClass}" style="background-image: url('${translatedMapName.toLowerCase()}.jpg');">
                    <div class="match-rank-overlay">
                        <span class="rank-large">#${winPlace}</span><span class="rank-small">/${totalRosters}</span>
                    </div>
                </div>
            </div>
            <div class="match-section match-map-mode">
                <div class="match-map">${matchCategory}</div>
                <div class="match-mode">${gameMode}</div>
            </div>
            <div class="match-section match-stats">
                <div class="match-kills">Kills: ${kills}</div>
                <div class="match-assists">Assists: ${assists}</div>
                <div class="match-damage">Damage: ${Math.round(damageDealt)}</div>
                <div class="match-time">Time: ${formatTime(timeSurvived)}</div>
            </div>
        `;
        } else {
            matchItem.innerHTML = `<p>Player not found in this match or match data is incomplete</p>`;
        }

        matchListContainer.appendChild(matchItem);
    });

    // If we have displayed all matches, hide the Load More button
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
        const mostKills = statObj.roundMostKills || 'N/A';
        const longestKill = statObj.longestKill ? Math.round(statObj.longestKill) + 'm' : 'N/A';

        const kdRatio = kills && deaths ? (kills / deaths).toFixed(2) : 'N/A';
        const kda = (kills + assists) && deaths ? ((kills + assists) / deaths).toFixed(2) : 'N/A';
        const winPercentage = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(2) + '%' : 'N/A';
        const top10Percentage = totalGames > 0 ? ((top10s / totalGames) * 100).toFixed(2) + '%' : 'N/A';
        const avgDamage = damageDealt ? Math.round((damageDealt / totalGames)) : 'N/A';
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
