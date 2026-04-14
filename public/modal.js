import { generateUniqueColor } from './utils.js';
import { startModal } from './replay2d.js';

export function showModal(matchData) {
    const existingModal = document.querySelector('.modal-custom');
    if (existingModal) existingModal.remove();

    const telemetryUrl = matchData.included.find(item => item.type === "asset").attributes.URL;

    const modal = document.createElement('div');
    modal.classList.add('modal-custom');

    const modalContent = document.createElement('div');
    modalContent.classList.add('modal-content-custom');

    const modalContainer = document.createElement('div');
    modalContainer.classList.add('modal-container-custom');

    // Left: team list
    const teamList = document.createElement('div');
    teamList.id = 'team-list-custom';
    teamList.classList.add('team-list-custom');

    // Center: replay + pinned teams all in one flex row
    const replayColumn = document.createElement('div');
    replayColumn.style.cssText = 'display:flex;flex-direction:row;align-items:stretch;gap:12px;flex:1;min-width:0;height:100%;padding:0 12px;box-sizing:border-box;justify-content:center;';

    const viewport = document.createElement('div');
    viewport.id = 'viewport';
    const MAP_DIMENSIONS = {
        'Erangel_Main':    { width: 816000, height: 816000 },
        'Baltic_Main':     { width: 816000, height: 816000 },
        'Desert_Main':     { width: 816000, height: 816000 },
        'DihorOtok_Main':  { width: 816000, height: 816000 },
        'Tiger_Main':      { width: 816000, height: 816000 },
        'Kiki_Main':       { width: 816000, height: 816000 },
        'Neon_Main':       { width: 816000, height: 816000 },
        'Savage_Main':     { width: 408000, height: 408000 },
        'Summerland_Main': { width: 204800, height: 204800 },
        'Paramo_Main':     { width: 306000, height: 306000 },
    };
    const mapName = matchData.data.attributes.mapName;
    const dims = MAP_DIMENSIONS[mapName] || { width: 816000, height: 816000 };
    viewport.setAttribute('data-map-width', dims.width);
    viewport.setAttribute('data-map-height', dims.height);
    viewport.setAttribute('data-canvas-scale', '0.001');

    const canvasContainer = document.createElement('div');
    canvasContainer.id = 'canvasContainer';
    viewport.appendChild(canvasContainer);

    const mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'mapCanvas';
    const drawCanvas = document.createElement('canvas');
    drawCanvas.id = 'drawCanvas';
    canvasContainer.appendChild(mapCanvas);
    canvasContainer.appendChild(drawCanvas);

    const timer = document.createElement('div');
    timer.id = 'timer';
    viewport.appendChild(timer);

    const controlsBar = document.createElement('div');
    controlsBar.id = 'controlsConatiner';
    controlsBar.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;box-sizing:border-box;background:rgba(20,20,20,0.95);border-radius:6px;';

    const playButton = document.createElement('button');
    playButton.innerHTML = '▶';
    playButton.style.cssText = 'background:transparent;color:white;border:none;font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0;';
    window.globalPlayButton = playButton;

    const progressBar = document.createElement('input');
    progressBar.id = 'progressBar';
    progressBar.type = 'range';
    progressBar.min = '0';
    progressBar.step = '1';
    progressBar.value = '0';
    progressBar.style.cssText = 'flex:1;cursor:pointer;';

    const sep = () => { const s = document.createElement('div'); s.style.cssText = 'width:1px;height:18px;background:#444;flex-shrink:0;'; return s; };

    const speedLabel = document.createElement('span');
    speedLabel.textContent = 'Speed:';
    speedLabel.style.cssText = 'color:#aaa;font-size:11px;white-space:nowrap;flex-shrink:0;';

    const speedSlider = document.createElement('input');
    speedSlider.id = 'speedSlider';
    speedSlider.type = 'range';
    speedSlider.min = '0'; speedSlider.max = '9'; speedSlider.step = '1'; speedSlider.value = '2';
    speedSlider.style.cssText = 'width:80px;cursor:pointer;flex-shrink:0;';

    const speedDisplay = document.createElement('span');
    speedDisplay.id = 'speedDisplay';
    speedDisplay.textContent = '1x';
    speedDisplay.style.cssText = 'color:white;font-size:11px;min-width:28px;flex-shrink:0;';

    controlsBar.appendChild(playButton);
    controlsBar.appendChild(progressBar);
    controlsBar.appendChild(sep());
    controlsBar.appendChild(speedLabel);
    controlsBar.appendChild(speedSlider);
    controlsBar.appendChild(speedDisplay);

    // Inner column: viewport + controls
    const innerColumn = document.createElement('div');
    innerColumn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;flex-shrink:1;height:100%;min-width:0;';
    innerColumn.appendChild(viewport);
    innerColumn.appendChild(controlsBar);
    replayColumn.appendChild(innerColumn);

    // Right: pinned teams container (inside replayColumn)
    const pinnedContainer = document.createElement('div');
    pinnedContainer.id = 'pinned-teams-container';
    pinnedContainer.style.cssText = 'display:none;flex-shrink:0;gap:8px;height:100%;';
    replayColumn.appendChild(pinnedContainer);

    modalContainer.appendChild(teamList);
    modalContainer.appendChild(replayColumn);

    modalContent.appendChild(modalContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    window.teamNameVisibility = {};
    window.pinnedTeams = [null, null]; // [slot0, slot1]

    startModal(telemetryUrl, matchData.data.attributes.mapName);
    fetch(`/api/telemetry/save?url=${encodeURIComponent(telemetryUrl)}`).catch(() => {});
    populateTeams(matchData, teamList);

    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            if (window._loadoutInterval) clearInterval(window._loadoutInterval);
            modal.remove();
        }
    });
}

// --- Pinned team panel management ---

function updatePinnedLayout() {
    const container = document.getElementById('pinned-teams-container');
    if (!container) return;
    const filled = window.pinnedTeams.filter(Boolean).length;
    // Show/hide container and resize modal
    container.style.display = filled > 0 ? 'flex' : 'none';
}

function buildTeamPanel(roster, matchData, teamId, color, slotIndex) {
    const panel = document.createElement('div');
    panel.dataset.teamId = teamId;
    panel.style.cssText = `width:220px;flex-shrink:0;background:#1d1d1d;border:1px solid #3a3a3a;border-radius:5px;display:flex;flex-direction:column;overflow:hidden;height:100%;`;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid #333;background:#222;flex-shrink:0;`;

    const dot = document.createElement('div');
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;`;

    const title = document.createElement('span');
    title.textContent = `Team #${roster.attributes.stats.rank || roster.attributes.stats.teamId}`;
    title.style.cssText = 'color:white;font-weight:bold;font-size:12px;flex:1;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:12px;padding:0 2px;';
    closeBtn.addEventListener('click', () => unpinTeam(teamId));

    header.appendChild(dot);
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Toggles
    const optionsRow = document.createElement('div');
    optionsRow.style.cssText = 'padding:6px 8px;border-bottom:1px solid #222;flex-shrink:0;';

    function makeToggle(label, initialState, onChange) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'color:#ccc;font-size:11px;';
        const toggle = document.createElement('div');
        let active = initialState;
        const knob = document.createElement('div');
        knob.style.cssText = 'width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:3px;transition:transform 0.2s;';
        toggle.style.cssText = 'width:32px;height:18px;border-radius:9px;position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;';
        const update = () => { toggle.style.background = active ? '#3a7bd5' : '#555'; knob.style.transform = active ? 'translateX(14px)' : 'translateX(3px)'; };
        toggle.appendChild(knob);
        update();
        toggle.addEventListener('click', () => { active = !active; update(); onChange(active); });
        row.appendChild(lbl);
        row.appendChild(toggle);
        return row;
    }

    if (!window.teamNameVisibility) window.teamNameVisibility = {};
    if (!window.teamTrackVisibility) window.teamTrackVisibility = {};
    optionsRow.appendChild(makeToggle('Show Names', !!window.teamNameVisibility[teamId], val => { window.teamNameVisibility[teamId] = val; }));
    optionsRow.appendChild(makeToggle('Track', !!window.teamTrackVisibility[teamId], val => { window.teamTrackVisibility[teamId] = val; }));
    panel.appendChild(optionsRow);

    // Scrollable player list
    const playerList = document.createElement('div');
    playerList.style.cssText = 'flex:1;overflow-y:auto;padding:6px;scrollbar-width:thin;scrollbar-color:#555 #333;';

    const ASSETS = 'api-assets-master/Assets/Item';
    const IGNORED_BACKPACKS = new Set(['Item_Back_B_01_StartParachutePack_C']);
    const SEP_HTML = '<div style="width:1px;background:#333;align-self:stretch;margin:0 3px;"></div>';
    const SLOT_SM = 'flex-shrink:0;width:32px;height:32px;background:#111;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;';
    const SLOT_WP = 'flex-shrink:0;width:44px;height:32px;background:#111;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;';

    function itemImg(src, alt) {
        return `<img src="/${src}" alt="${alt}" title="${alt}" style="width:100%;height:100%;object-fit:contain;" onerror="this.style.opacity=0.15">`;
    }
    function getItemImg(id) {
        if (!id) return null;
        if (id.startsWith('Item_Armor_')) return `${ASSETS}/Equipment/Vest/${id}.png`;
        if (id.startsWith('Item_Head_')) return `${ASSETS}/Equipment/Headgear/${id}.png`;
        if (id.startsWith('Item_Back_')) return `${ASSETS}/Equipment/Backpack/${id.replace(/^(Item_Back_BlueBlocker).*/, '$1')}.png`;
        if (id.startsWith('Item_Attach_')) return `${ASSETS}/Attachment/${id}.png`;
        return null;
    }
    function getWeaponImg(id, sub) {
        return `${ASSETS}/Weapon/${sub === 'Handgun' ? 'Handgun' : 'Main'}/${id}.png`;
    }
    function getScopeId(attachments) {
        for (const a of attachments) { if (a.includes('_Upper_') || a.includes('_SideRail_')) return a; }
        return null;
    }
    function weaponBlock(w) {
        const scopeId = getScopeId(w.attachments);
        const scopePath = scopeId ? getItemImg(scopeId) : null;
        return `<div style="${SLOT_WP}">${itemImg(getWeaponImg(w.itemId, w.subCategory), w.itemId)}</div><div style="${SLOT_SM}">${scopePath ? itemImg(scopePath, scopeId) : ''}</div>`;
    }

    const playerDivs = {};
    const hpDivs = {};

    roster.relationships.participants.data.forEach(ref => {
        const participant = matchData.included.find(p => p.id === ref.id);
        const s = participant.attributes.stats;
        const accountId = s.playerId;

        const card = document.createElement('div');
        card.style.cssText = 'background:#1a1a1a;border-radius:5px;padding:6px;margin-bottom:5px;';

        // Name row with HP bar
        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;gap:6px;';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = s.name;
        nameSpan.style.cssText = 'color:white;font-weight:bold;font-size:11px;flex-shrink:0;';

        const hpWrapper = document.createElement('div');
        hpWrapper.style.cssText = 'flex:1;display:flex;align-items:center;gap:4px;';

        const hpBar = document.createElement('div');
        hpBar.style.cssText = 'flex:1;height:4px;background:#333;border-radius:2px;overflow:hidden;';
        const hpFill = document.createElement('div');
        hpFill.style.cssText = 'height:100%;background:#4caf50;border-radius:2px;transition:width 0.2s,background 0.2s;width:100%;';
        hpBar.appendChild(hpFill);

        const hpText = document.createElement('span');
        hpText.textContent = '100';
        hpText.style.cssText = 'color:#aaa;font-size:10px;min-width:22px;text-align:right;flex-shrink:0;';

        hpWrapper.appendChild(hpBar);
        hpWrapper.appendChild(hpText);

        nameRow.appendChild(nameSpan);
        nameRow.appendChild(hpWrapper);

        // Stats row
        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'color:#666;font-size:10px;margin-bottom:4px;';
        statsRow.textContent = `K:${s.kills}  A:${s.assists}  D:${Math.round(s.damageDealt)}`;

        const loadoutDiv = document.createElement('div');

        card.appendChild(nameRow);
        card.appendChild(statsRow);
        card.appendChild(loadoutDiv);
        playerList.appendChild(card);

        playerDivs[accountId] = loadoutDiv;
        hpDivs[accountId] = { fill: hpFill, text: hpText };
    });

    panel.appendChild(playerList);

    // Live update
    const intervalKey = `_loadout_${teamId}`;
    if (window[intervalKey]) clearInterval(window[intervalKey]);

    function update() {
        if (!window.getLoadoutAt) return;
        const elapsed = window.replayCurrentTime ?? 0;

        Object.entries(playerDivs).forEach(([accountId, div]) => {
            const { weapons, equipment } = window.getLoadoutAt(accountId, elapsed);

            // HP
            const hp = window.playerHpByTime?.[accountId]?.[Math.round(elapsed)] ?? 100;
            const hpRatio = Math.max(0, Math.min(1, hp / 100));
            const { fill, text } = hpDivs[accountId];
            fill.style.width = `${hpRatio * 100}%`;
            fill.style.background = hpRatio > 0.5 ? '#4caf50' : hpRatio > 0.25 ? '#ff9800' : '#f44336';
            text.textContent = Math.round(hp);

            // Loadout
            const helmet = equipment['headgear'];
            const vest = equipment['vest'];
            const rawBackpack = equipment['backpack'];
            const backpack = rawBackpack && !IGNORED_BACKPACKS.has(rawBackpack) ? rawBackpack : null;
            const mains = Object.values(weapons).filter(w => w.subCategory === 'Main').slice(0, 2);

            let html = `<div style="display:flex;gap:3px;margin-bottom:3px;">`;
            [helmet, vest, backpack].forEach(id => {
                html += `<div style="${SLOT_SM}">${id ? itemImg(getItemImg(id), id) : ''}</div>`;
            });
            html += `</div><div style="display:flex;align-items:center;gap:3px;">`;
            const s1 = mains[0] || null, s2 = mains[1] || null;
            [s1, s2].forEach((w, i) => {
                if (i > 0) html += SEP_HTML;
                html += w ? weaponBlock(w) : `<div style="${SLOT_WP}"></div><div style="${SLOT_SM}"></div>`;
            });
            html += `</div>`;
            div.innerHTML = html;
        });
    }

    window[intervalKey] = setInterval(update, 200);
    update();

    return panel;
}

function pinTeam(roster, matchData, teamId, color) {
    const slots = window.pinnedTeams;
    // Already pinned → unpin
    if (slots[0]?.teamId === teamId || slots[1]?.teamId === teamId) {
        unpinTeam(teamId);
        return;
    }
    // Find empty slot
    if (slots[0] === null) {
        slots[0] = { teamId, roster, matchData, color };
    } else if (slots[1] === null) {
        slots[1] = { teamId, roster, matchData, color };
    } else {
        // Both full: replace slot 0, keep slot 1
        if (window[`_loadout_${slots[0].teamId}`]) {
            clearInterval(window[`_loadout_${slots[0].teamId}`]);
            delete window[`_loadout_${slots[0].teamId}`];
        }
        slots[0] = { teamId, roster, matchData, color };
    }
    renderPinnedPanels();
}

function unpinTeam(teamId) {
    const slots = window.pinnedTeams;
    const idx = slots.findIndex(s => s?.teamId === teamId);
    if (idx === -1) return;
    // Clear interval
    if (window[`_loadout_${teamId}`]) { clearInterval(window[`_loadout_${teamId}`]); delete window[`_loadout_${teamId}`]; }
    slots[idx] = null;
    // Compact: move slot1 to slot0 if slot0 is empty
    if (slots[0] === null && slots[1] !== null) { slots[0] = slots[1]; slots[1] = null; }
    renderPinnedPanels();
    // Update team list outlines
    document.querySelectorAll('.team-custom').forEach(d => {
        const isSelected = window.pinnedTeams.some(s => s?.teamId === parseInt(d.dataset.teamId));
        if (!isSelected) d.style.outline = 'none';
    });
}

function renderPinnedPanels() {
    const container = document.getElementById('pinned-teams-container');
    if (!container) return;
    container.innerHTML = '';
    const filled = window.pinnedTeams.filter(Boolean);
    if (filled.length === 0) {
        container.style.display = 'none';
    } else {
        container.style.display = 'flex';
        filled.forEach((slot, i) => {
            const panel = buildTeamPanel(slot.roster, slot.matchData, slot.teamId, slot.color, i);
            container.appendChild(panel);
        });
    }
}

function populateTeams(matchData, teamList) {
    teamList.innerHTML = '';
    const searchedPlayerName = document.getElementById('player-name-display')?.textContent?.trim();
    const rosters = matchData.included.filter(item => item.type === 'roster');

    const searchedRoster = rosters.find(roster =>
        roster.relationships.participants.data.some(ref => {
            const p = matchData.included.find(p => p.id === ref.id);
            return p?.attributes?.stats?.name === searchedPlayerName;
        })
    );

    window.teamNameVisibility = {};
    window.teamTrackVisibility = {};

    rosters.forEach((roster, index) => {
        const teamNumber = roster.attributes.stats.rank || roster.attributes.stats.teamId;
        const teamId = roster.attributes.stats.teamId;
        const isSearchedTeam = roster === searchedRoster;

        const uniqueColor = generateUniqueColor(index);
        roster.color = uniqueColor;

        window.teamNameVisibility[teamId] = isSearchedTeam;
        window.teamTrackVisibility[teamId] = false;

        const teamDiv = document.createElement('div');
        teamDiv.classList.add('team-custom');
        teamDiv.dataset.teamId = teamId;
        teamDiv.style.cursor = 'pointer';
        if (!isSearchedTeam) teamDiv.style.opacity = '0.5';

        const teamNumberDiv = document.createElement('div');
        teamNumberDiv.classList.add('team-number-custom');
        teamNumberDiv.textContent = teamNumber;
        teamNumberDiv.style.backgroundColor = uniqueColor;

        const playersDiv = document.createElement('div');
        playersDiv.classList.add('players-list-custom');

        roster.relationships.participants.data.forEach(ref => {
            const participant = matchData.included.find(p => p.id === ref.id);
            const playerDiv = document.createElement('div');
            playerDiv.textContent = participant.attributes.stats.name;
            if (participant.attributes.stats.name === searchedPlayerName) {
                playerDiv.style.fontWeight = 'bold';
                playerDiv.style.color = '#ffdd57';
            }
            playersDiv.appendChild(playerDiv);
        });

        teamDiv.appendChild(teamNumberDiv);
        teamDiv.appendChild(playersDiv);
        teamList.appendChild(teamDiv);

        teamDiv.addEventListener('click', function (e) {
            e.preventDefault();
            pinTeam(roster, matchData, teamId, uniqueColor);
            // Update outline
            document.querySelectorAll('.team-custom').forEach(d => {
                const tid = parseInt(d.dataset.teamId);
                const isSelected = window.pinnedTeams.some(s => s?.teamId === tid);
                d.style.outline = isSelected ? `2px solid ${generateUniqueColor(rosters.findIndex(r => r.attributes.stats.teamId === tid))}` : 'none';
                d.style.opacity = isSelected ? '1' : '0.5';
            });
        });
    });
}
