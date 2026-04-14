import { showModal } from './modal.js';
import { translateMapName } from './utils.js';

document.addEventListener('click', function (e) {
    if (e.target.closest('.match-info')) {
        const matchId = e.target.closest('.match-info').querySelector('.arrow').dataset.matchId;
        const matchData = allMatches.find(match => match.data.id === matchId);
        window.globalMatchData = matchData;
        if (matchData) showModal(matchData);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.w3-bar-item.w3-button.tablink').forEach(button => {
        button.addEventListener('click', (event) => openTab(event, button.getAttribute('data-tab')));
    });
});

document.addEventListener('DOMContentLoaded', async function () {
    const seasonSelect = document.getElementById('season-select');
    const playerForm = document.getElementById('player-form');
    const playerStatsContainer = document.getElementById('player-stats');
    const playerNameDisplay = document.getElementById('player-name-display');

    playerStatsContainer.style.display = 'none';

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
                const n = parseInt(season.id.split('-').pop(), 10);
                if (season.attributes.isCurrentSeason) currentSeasonNumber = n;
                return true;
            }
            return false;
        }).sort((a, b) => parseInt(b.id.split('-').pop(), 10) - parseInt(a.id.split('-').pop(), 10));

        let currentSeasonId = '';
        pcSeasons.forEach(season => {
            const n = parseInt(season.id.split('-').pop(), 10);
            if (currentSeasonNumber && n > currentSeasonNumber) return;
            const option = document.createElement('option');
            option.value = season.id;
            option.textContent = `Season ${n}`;
            if (season.attributes.isCurrentSeason) { currentSeasonId = season.id; option.selected = true; }
            seasonSelect.appendChild(option);
        });

        if (!currentSeasonId && pcSeasons.length > 0) seasonSelect.selectedIndex = 0;

        playerForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const playerName = document.getElementById('player-name').value;
            const seasonId = seasonSelect.value;

            playerStatsContainer.style.display = 'none';
            document.getElementById('stats-container').innerHTML = '';
            document.getElementById('match-list').innerHTML = '<h2>Last Matches</h2>';
            document.getElementById('matches-container').style.display = 'none';
            const oldLoadMore = document.getElementById('load-more');
            if (oldLoadMore) oldLoadMore.remove();
            allMatches = [];
            currentIndex = 0;

            try {
                const response = await fetch(`/api/player/${playerName}?season=${seasonId}`);
                const data = await response.json();
                if (!data.stats) { alert('No stats available for this player'); return; }
                playerStatsContainer.style.display = 'block';
                window.fppStats = data.stats.fpp;
                window.tppStats = data.stats.tpp;
                displayStatsForModeWithMostRounds(window.fppStats, window.tppStats);
                playerNameDisplay.textContent = playerName;
                await fetchAndDisplayPlayerMatches(playerName);
            } catch (error) {
                alert('Failed to load player stats.');
            }
        });
    } catch (error) {
        alert('Failed to load seasons.');
    }
});

let allMatches = [];
let currentIndex = 0;
const matchesPerPage = 20;

async function fetchAndDisplayPlayerMatches(playerName) {
    try {
        const response = await fetch(`/api/player/${playerName}/matches`);
        const data = await response.json();
        if (!data.matches) throw new Error('No matches found');
        allMatches = data.matches;
        currentIndex = 0;
        document.getElementById('matches-container').style.display = 'block';
        displayNextMatches(playerName);
        setupLoadMoreButton(playerName);
    } catch (error) {
        alert('Failed to load matches');
    }
}

function displayNextMatches(playerName) {
    if (!allMatches || allMatches.length === 0) { alert('No matches to display'); return; }

    const matchListContainer = document.getElementById('match-list');
    const nextMatches = allMatches.slice(currentIndex, currentIndex + matchesPerPage);
    currentIndex += nextMatches.length;

    nextMatches.forEach(match => {
        const matchType = match.data.attributes.matchType;
        const gameMode = match.data.attributes.gameMode.toUpperCase().replace('-', ' ');
        const translatedMapName = translateMapName(match.data.attributes.mapName);
        const matchCategory = matchType === 'competitive' ? 'Ranked' : 'Normal';
        const totalRosters = match.data.relationships.rosters.data.length;
        const participant = match.included.filter(i => i.type === 'participant').find(p => p.attributes?.stats?.name === playerName);
        if (!participant) return;

        const { kills, assists, damageDealt, winPlace, timeSurvived } = participant.attributes.stats;
        const firstPlaceClass = winPlace === 1 ? 'first-place' : '';
        const matchItem = document.createElement('div');
        matchItem.classList.add('match-info');
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
            </div>`;
        matchListContainer.appendChild(matchItem);
    });

    if (currentIndex >= allMatches.length) document.getElementById('load-more').style.display = 'none';
}

function setupLoadMoreButton(playerName) {
    let btn = document.getElementById('load-more');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'load-more';
        btn.textContent = 'Load More';
        btn.style.cssText = 'display:block;margin:20px auto;padding:10px;cursor:pointer;';
        document.getElementById('matches-container').appendChild(btn);
        btn.addEventListener('click', () => displayNextMatches(playerName));
    }
}

function formatTime(timeInSeconds) {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function openTab(evt, tabName) {
    document.getElementsByClassName('tablink').forEach
    ? [...document.getElementsByClassName('tablink')].forEach(t => t.classList.remove('w3-gray', 'active'))
    : null;
    Array.from(document.getElementsByClassName('tablink')).forEach(t => t.classList.remove('w3-gray', 'active'));
    evt.currentTarget.classList.add('w3-gray', 'active');
    updateStats(window.fppStats || {}, window.tppStats || {});
}

function getGameModeWithMostRounds(fppStats, tppStats) {
    let maxRounds = 0, selectedMode = 'squadFpp';
    ['solo', 'duo', 'squad'].forEach(mode => {
        const fpp = fppStats[mode]?.roundsPlayed || 0;
        const tpp = tppStats[mode]?.roundsPlayed || 0;
        if (fpp > maxRounds) { maxRounds = fpp; selectedMode = `${mode}Fpp`; }
        if (tpp > maxRounds) { maxRounds = tpp; selectedMode = `${mode}Tpp`; }
    });
    return selectedMode;
}

function displayStatsForModeWithMostRounds(fppStats, tppStats) {
    const gameMode = getGameModeWithMostRounds(fppStats, tppStats);
    document.querySelector(`.tablink[data-tab="${gameMode}"]`)?.click();
}

function updateStats(fppStats, tppStats) {
    const currentTab = document.querySelector('.tablink.active')?.textContent;
    if (!currentTab) return;

    const stats = currentTab.includes('FPP') ? fppStats : tppStats;
    const mode = currentTab.includes('SOLO') ? 'solo' : currentTab.includes('DUO') ? 'duo' : 'squad';
    const selectedStats = stats?.[mode] || null;

    const statsContainer = document.getElementById('stats-container');
    statsContainer.innerHTML = '';

    if (!selectedStats?.roundsPlayed) {
        const msg = document.createElement('p');
        msg.textContent = 'No matches found';
        msg.classList.add('no-data-message');
        statsContainer.appendChild(msg);
        return;
    }

    const total = selectedStats.roundsPlayed || 1;
    const kills = (selectedStats.kills || 0) - (selectedStats.teamKills || 0);
    const deaths = selectedStats.losses;
    const top10s = selectedStats.top10s || selectedStats.top10 || 0;
    const assists = selectedStats.assists || 0;
    const headshotKills = selectedStats.headshotKills || 0;
    const damageDealt = Math.round(selectedStats.damageDealt) || 0;

    const stats_ = {
        'K/D': kills && deaths ? (kills / deaths).toFixed(2) : 0,
        'Avg. Damage': damageDealt ? Math.round(damageDealt / total) : 0,
        'Assist': assists,
        'Games': total,
        'Win %': ((( selectedStats.wins || 0) / total) * 100).toFixed(2) + '%',
        'Wins': selectedStats.wins || 0,
        'KDA': (kills + assists) && deaths ? ((kills + assists) / deaths).toFixed(2) : 0,
        'Headshot %': kills ? ((headshotKills / kills) * 100).toFixed(2) + '%' : 0,
        'Most Kills': selectedStats.roundMostKills || 0,
        'Longest Kill': selectedStats.longestKill ? Math.round(selectedStats.longestKill) + 'm' : 0,
        'Top 10 %': ((top10s / total) * 100).toFixed(2) + '%',
        'Top 10': top10s,
    };

    Object.entries(stats_).forEach(([title, value]) => {
        const item = document.createElement('div');
        item.classList.add('stat-item');
        item.innerHTML = `<h2>${title}</h2><p>${value}</p>`;
        statsContainer.appendChild(item);
    });
}
