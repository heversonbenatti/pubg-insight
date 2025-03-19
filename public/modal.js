import { generateUniqueColor } from './utils.js';
import { startModal } from './replay2d.js';

export function showModal(matchData) {
    const existingModal = document.querySelector('.modal');
    if (existingModal) {
        existingModal.remove();
    }

    const telemetryUrl = matchData.included.find(item => item.type === "asset").attributes.URL;

    const modal = document.createElement('div');
    modal.classList.add('modal-custom');

    const modalContent = document.createElement('div');
    modalContent.classList.add('modal-content-custom');

    const modalContainer = document.createElement('div');
    modalContainer.classList.add('modal-container-custom');

    const teamList = document.createElement('div');
    teamList.id = 'team-list-custom';
    teamList.classList.add('team-list-custom');

    const viewport = document.createElement('div');
    viewport.id = 'viewport';
    viewport.setAttribute('data-map-width', '800000');
    viewport.setAttribute('data-map-height', '800000');
    viewport.setAttribute('data-canvas-scale', '0.001');

    const replayDiv = document.createElement('div');
    replayDiv.id = 'replayDiv';
    replayDiv.appendChild(viewport);

    const canvasContainer = document.createElement('div');
    canvasContainer.id = 'canvasContainer';
    viewport.appendChild(canvasContainer);

    const mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'mapCanvas';

    const drawCanvas = document.createElement('canvas');
    drawCanvas.id = 'drawCanvas';
    canvasContainer.appendChild(mapCanvas);
    canvasContainer.appendChild(drawCanvas);

    const progressBar = document.createElement('input');
    progressBar.id = 'progressBar';
    progressBar.type = 'range';
    progressBar.min = '0';
    progressBar.step = '1';
    progressBar.value = '0';

    const timer = document.createElement('div');
    timer.id = 'timer';
    viewport.appendChild(timer);

    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'controlsConatiner';
    controlsContainer.style.position = 'absolute';
    controlsContainer.style.bottom = '-30px';
    controlsContainer.style.width = '100%';
    controlsContainer.style.display = 'flex';
    controlsContainer.style.justifyContent = 'space-between';
    controlsContainer.style.gap = '10px';

    const playButton = document.createElement('button');
    playButton.innerHTML = '▶';
    playButton.style.background = 'rgba(85, 85, 85, 0)';
    playButton.style.color = 'white';
    playButton.style.border = 'none';
    playButton.style.borderRadius = '4px';
    playButton.style.cursor = 'pointer';
    playButton.style.left = '10px';
    window.globalPlayButton = playButton;

    controlsContainer.appendChild(playButton);
    controlsContainer.appendChild(progressBar);
    viewport.appendChild(controlsContainer);

    const teamDetails = document.createElement('div');
    teamDetails.id = 'team-details-custom';
    teamDetails.classList.add('team-details-custom');

    modalContainer.appendChild(teamList);
    modalContainer.appendChild(viewport);
    modalContainer.appendChild(teamDetails);

    modalContent.appendChild(modalContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    startModal(telemetryUrl, matchData.data.attributes.mapName);

    if (typeof populateTeams === "function") {
        populateTeams(matchData, teamList);
    }

    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function populateTeams(matchData, teamList) {
    teamList.innerHTML = '';

    const rosters = matchData.included.filter(item => item.type === 'roster');

    rosters.forEach((roster, index) => {
        const teamNumber = roster.attributes.stats.rank || roster.attributes.stats.teamId;

        let uniqueColor = generateUniqueColor(index);
        roster.color = uniqueColor;

        const teamDiv = document.createElement('div');
        teamDiv.classList.add('team-custom');
        teamDiv.style.cursor = 'pointer';

        const teamNumberDiv = document.createElement('div');
        teamNumberDiv.classList.add('team-number-custom');
        teamNumberDiv.textContent = teamNumber;
        teamNumberDiv.style.backgroundColor = uniqueColor;

        const playersDiv = document.createElement('div');
        playersDiv.classList.add('players-list-custom');

        roster.relationships.participants.data.forEach(participantRef => {
            const participant = matchData.included.find(p => p.id === participantRef.id);
            const playerDiv = document.createElement('div');
            playerDiv.textContent = participant.attributes.stats.name;
            playersDiv.appendChild(playerDiv);
        });

        teamDiv.appendChild(teamNumberDiv);
        teamDiv.appendChild(playersDiv);

        teamList.appendChild(teamDiv);

        teamDiv.addEventListener('click', function() {
            displayTeamDetails(roster, matchData);
        });
    });
}

function displayTeamDetails(roster, matchData) {
    const teamDetailsDiv = document.getElementById('team-details-custom');

    teamDetailsDiv.innerHTML = '';

    roster.relationships.participants.data.forEach(participantRef => {
        const participant = matchData.included.find(p => p.id === participantRef.id);

        const playerDetailDiv = document.createElement('div');
        playerDetailDiv.classList.add('player-detail-custom');
        playerDetailDiv.textContent = `Player: ${participant.attributes.stats.name} - Kills: ${participant.attributes.stats.kills}, Damage: ${participant.attributes.stats.damageDealt.toFixed(2)}`;

        teamDetailsDiv.appendChild(playerDetailDiv);
    });
}