import { generateUniqueColor, translateMapName } from './utils.js';
import { startModal } from './replay2d.js';

function buildPlayerLink(name) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('p', name);
    const search = new URLSearchParams(window.location.search);
    const season = search.get('s');
    if (season) url.searchParams.set('s', season);
    let platform = 'steam';
    try { platform = localStorage.getItem('pi_platform') || 'steam'; } catch (_) {}
    url.searchParams.set('platform', platform);
    return url.toString();
}

export function showModal(matchData, platform = 'steam') {
    const existingModal = document.querySelector('.modal-custom');
    if (existingModal) existingModal.remove();

    const matchId = matchData.data.id;

    // ── Outer modal backdrop ─────────────────────────────────────────────────
    const modal = document.createElement('div');
    modal.classList.add('modal-custom');

    // ── Inner card ───────────────────────────────────────────────────────────
    const modalContent = document.createElement('div');
    modalContent.classList.add('modal-content-custom');
    modalContent.style.cssText = `
        display:flex;flex-direction:column;
        width:100%;height:100%;max-width:1600px;
        background:var(--bg);
        border:1px solid var(--border);
        border-radius:var(--r-md);
        overflow:hidden;
    `;

    // ── Top bar ──────────────────────────────────────────────────────────────
    const attr = matchData.data.attributes;
    const mapName = attr.mapName;
    const gameMode = attr.gameMode.toUpperCase().replace(/-/g, ' ');
    const matchCategory = attr.matchType === 'competitive' ? 'RANKED' : 'NORMAL';

    // Find player placement
    const searchedPlayerName = document.getElementById('player-name-display')?.textContent?.trim() || '';
    const participant = matchData.included
        .filter(i => i.type === 'participant')
        .find(p => p.attributes?.stats?.name === searchedPlayerName);
    const place = participant?.attributes?.stats?.winPlace ?? 1;
    const total = matchData.data.relationships.rosters.data.length;

    const topBar = document.createElement('div');
    topBar.style.cssText = `
        display:flex;align-items:center;gap:14px;
        padding:7px 16px;
        border-bottom:1px solid var(--divider);
        flex-shrink:0;
        background:var(--surface);
    `;

    // Rank chip
    const isWin = place === 1;
    const rankChipEl = document.createElement('div');
    rankChipEl.style.cssText = `
        width:34px;height:34px;border-radius:var(--r-sm);
        background:${isWin ? 'oklch(0.78 0.15 75 / 0.12)' : 'var(--surface-2)'};
        border:1px solid ${isWin ? 'oklch(0.78 0.15 75 / 0.45)' : 'var(--border)'};
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:var(--font-mono);line-height:1.1;flex-shrink:0;
    `;
    rankChipEl.innerHTML = `
        <span style="font-size:13px;font-weight:700;letter-spacing:-0.02em;color:${isWin ? 'var(--win)' : 'var(--text)'}">#${place}</span>
        <span style="font-size:9px;color:var(--text-faint)">/${total}</span>
    `;

    // Map + mode info
    const mapInfo = document.createElement('div');
    mapInfo.style.cssText = 'flex:1;min-width:0;';
    mapInfo.innerHTML = `
        <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:var(--text)">
            ${translateMapName(mapName)}
            <span style="font-family:var(--font-mono);margin-left:10px;color:var(--text-muted);font-size:11px;font-weight:400">${gameMode} · ${matchCategory}</span>
        </div>
        <div style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);margin-top:2px;letter-spacing:0.04em">
            2D REPLAY · TELEMETRY
        </div>
    `;

    // Share button
    const shareBtn = document.createElement('button');
    shareBtn.style.cssText = `
        display:inline-flex;align-items:center;gap:8px;
        height:32px;padding:0 12px;
        border-radius:var(--r-sm);
        background:transparent;color:var(--text-dim);
        border:none;font-family:var(--font-ui);font-size:13px;
        cursor:pointer;transition:background 140ms;
    `;
    shareBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a3 3 0 1 1 3 -3M9 12a3 3 0 1 1 -3 3M15 16a3 3 0 1 1 3 3M8.7 13.3l6.6 3.4M15.3 7.3l-6.6 3.4"/></svg> Share`;
    shareBtn.onmouseenter = () => shareBtn.style.background = 'var(--surface-2)';
    shareBtn.onmouseleave = () => shareBtn.style.background = 'transparent';
    shareBtn.addEventListener('click', () => {
        const url = new URL(window.location.href);
        url.search = '';
        url.searchParams.set('p', searchedPlayerName);
        url.searchParams.set('m', matchData.data.id);
        const text = url.toString();
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            ta.remove();
        };
        const showToast = () => {
            shareBtn.style.color = 'var(--accent)';
            const orig = shareBtn.innerHTML;
            shareBtn.innerHTML = '✓ Copied';
            setTimeout(() => { shareBtn.innerHTML = orig; shareBtn.style.color = ''; }, 1400);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(showToast).catch(() => { fallback(); showToast(); });
        } else {
            fallback(); showToast();
        }
    });

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = `
        width:32px;height:32px;border-radius:var(--r-sm);
        background:var(--surface-2);border:1px solid var(--border);
        color:var(--text-dim);cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:background 140ms;
    `;
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6l-12 12"/></svg>`;
    closeBtn.onmouseenter = () => closeBtn.style.background = 'var(--surface-3)';
    closeBtn.onmouseleave = () => closeBtn.style.background = 'var(--surface-2)';
    closeBtn.addEventListener('click', () => {
        if (window._loadoutInterval) clearInterval(window._loadoutInterval);
        modal.remove();
    });

    topBar.appendChild(rankChipEl);
    topBar.appendChild(mapInfo);
    topBar.appendChild(shareBtn);
    topBar.appendChild(closeBtn);
    modalContent.appendChild(topBar);

    // ── Body row ─────────────────────────────────────────────────────────────
    const bodyRow = document.createElement('div');
    bodyRow.style.cssText = 'flex:1;display:flex;gap:10px;padding:10px;min-height:0;overflow:hidden;';

    // ── Team list (left, 220px) ───────────────────────────────────────────────
    const teamList = document.createElement('div');
    teamList.id = 'team-list-custom';
    teamList.classList.add('team-list-custom');
    teamList.style.cssText = `
        width:270px;flex-shrink:0;
        background:var(--surface);
        border:1px solid var(--border);
        border-radius:var(--r-md);
        overflow:hidden;height:100%;
        display:flex;flex-direction:column;
    `;

    // Team list header
    const teamListHeader = document.createElement('div');
    teamListHeader.style.cssText = `
        padding:10px 12px;
        border-bottom:1px solid var(--divider);
        display:flex;align-items:center;justify-content:space-between;
        flex-shrink:0;
    `;
    teamListHeader.innerHTML = `
        <span style="font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;font-size:9.5px;color:var(--text-muted)">TEAMS</span>
        <span id="team-count" style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint)">0</span>
    `;
    teamList.appendChild(teamListHeader);

    const teamListScroll = document.createElement('div');
    teamListScroll.style.cssText = 'overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:var(--surface-3) transparent;';
    teamList.appendChild(teamListScroll);

    // ── View controls footer (inside teamList, stacked vertically) ────────────
    function voLabel(text) {
        const s = document.createElement('span');
        s.style.cssText = 'font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;font-size:9.5px;color:var(--text-muted);flex-shrink:0;min-width:52px;';
        s.textContent = text;
        return s;
    }
    function voValue(text, minW = '24px') {
        const s = document.createElement('span');
        s.style.cssText = `font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--text-dim);min-width:${minW};text-align:right;flex-shrink:0;`;
        s.textContent = text;
        return s;
    }
    function voSlider(min, max, step, val) {
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
        inp.style.cssText = 'flex:1;min-width:0;';
        return inp;
    }
    function voRow(label, slider, value) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;';
        row.appendChild(label); row.appendChild(slider); row.appendChild(value);
        return row;
    }

    // — Player dot size —
    const savedSize = parseInt(localStorage.getItem('pi_playerSize') ?? '6');
    window._replayPlayerSize = Math.max(4, Math.min(8, isNaN(savedSize) ? 6 : savedSize));
    const sizeSlider = voSlider(4, 8, 1, window._replayPlayerSize);
    const sizeValueEl = voValue(String(window._replayPlayerSize));
    sizeSlider.addEventListener('input', () => {
        window._replayPlayerSize = parseInt(sizeSlider.value);
        sizeValueEl.textContent = sizeSlider.value;
        try { localStorage.setItem('pi_playerSize', sizeSlider.value); } catch (_) {}
    });

    // — Feed scale —
    const _feedScaleSteps = [0.65, 0.8, 1.0, 1.25, 1.6];
    const savedFeedScale = parseFloat(localStorage.getItem('pi_feedScale') ?? '1.0');
    const _initFeedScale = isNaN(savedFeedScale) ? 1.0 : Math.max(0.65, Math.min(1.6, savedFeedScale));
    const _initFeedStep = _feedScaleSteps.reduce((best, v, i) =>
        Math.abs(v - _initFeedScale) < Math.abs(_feedScaleSteps[best] - _initFeedScale) ? i : best, 2);
    window._replayFeedScale = _feedScaleSteps[_initFeedStep];
    const feedSlider = voSlider(0, 4, 1, _initFeedStep);
    const feedValueEl = voValue(`${Math.round(window._replayFeedScale * 100)}%`, '32px');
    feedSlider.addEventListener('input', () => {
        const scale = _feedScaleSteps[parseInt(feedSlider.value)];
        window._replayFeedScale = scale;
        feedValueEl.textContent = `${Math.round(scale * 100)}%`;
        try { localStorage.setItem('pi_feedScale', String(scale)); } catch (_) {}
    });

    // — Feed max events —
    const savedFeedMax = parseInt(localStorage.getItem('pi_feedMax') ?? '5');
    window._replayFeedMax = isNaN(savedFeedMax) ? 5 : Math.max(4, Math.min(10, savedFeedMax));
    const feedMaxSlider = voSlider(4, 10, 1, window._replayFeedMax);
    const feedMaxValueEl = voValue(String(window._replayFeedMax));
    feedMaxSlider.addEventListener('input', () => {
        window._replayFeedMax = parseInt(feedMaxSlider.value);
        feedMaxValueEl.textContent = feedMaxSlider.value;
        try { localStorage.setItem('pi_feedMax', feedMaxSlider.value); } catch (_) {}
    });

    const viewFooter = document.createElement('div');
    viewFooter.style.cssText = `
        padding:8px 12px;gap:5px;
        border-top:1px solid var(--divider);
        flex-shrink:0;display:flex;flex-direction:column;
    `;
    const viewFooterLabel = document.createElement('span');
    viewFooterLabel.style.cssText = 'font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.1em;font-size:9px;color:var(--text-faint);margin-bottom:1px;';
    viewFooterLabel.textContent = 'VIEW';
    viewFooter.appendChild(viewFooterLabel);
    viewFooter.appendChild(voRow(voLabel('PLAYERS'), sizeSlider, sizeValueEl));
    viewFooter.appendChild(voRow(voLabel('FEED'), feedSlider, feedValueEl));
    viewFooter.appendChild(voRow(voLabel('MAX'), feedMaxSlider, feedMaxValueEl));
    teamList.appendChild(viewFooter);

    // ── Center column: viewport + controls ───────────────────────────────────
    // centerCol is flex:1 and centers its children.
    // innerColumn wraps viewport + controls so controls bar matches viewport width exactly.
    const centerCol = document.createElement('div');
    centerCol.style.cssText = `
        flex:1;min-width:0;
        display:flex;
        align-items:center;
        justify-content:center;
    `;

    // innerColumn: flex-column that wraps viewport + controls.
    // align-items:flex-start lets the viewport size itself via aspect-ratio:1/1
    // (align-items:stretch would override aspect-ratio, making the viewport wider than tall).
    // The controlsBar uses align-self:stretch to still match the viewport width.
    const innerColumn = document.createElement('div');
    innerColumn.style.cssText = `
        display:flex;flex-direction:column;gap:10px;
        height:100%;width:fit-content;
        align-items:flex-start;
    `;

    // Viewport
    const viewport = document.createElement('div');
    viewport.id = 'viewport';
    viewport.style.cssText = `
        aspect-ratio:1/1;height:100%;width:auto;min-height:0;
        position:relative;
        background:#0e1014;
        border:1px solid var(--border);
        border-radius:var(--r-md);
        overflow:hidden;
        flex-shrink:1;
    `;

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
    const dims = MAP_DIMENSIONS[mapName] || { width: 816000, height: 816000 };
    viewport.setAttribute('data-map-width', dims.width);
    viewport.setAttribute('data-map-height', dims.height);
    viewport.setAttribute('data-canvas-scale', '0.001');

    const canvasContainer = document.createElement('div');
    canvasContainer.id = 'canvasContainer';
    canvasContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    viewport.appendChild(canvasContainer);

    const mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'mapCanvas';
    const drawCanvas = document.createElement('canvas');
    drawCanvas.id = 'drawCanvas';
    canvasContainer.appendChild(mapCanvas);
    canvasContainer.appendChild(drawCanvas);

    const timer = document.createElement('div');
    timer.id = 'timer';
    timer.style.cssText = `
        position:absolute;top:10px;left:50%;transform:translateX(-50%);
        font-family:var(--font-mono);font-size:18px;font-weight:600;
        color:var(--text);letter-spacing:0.05em;
        text-shadow:0 2px 8px rgba(0,0,0,0.9);
        z-index:5;
    `;
    viewport.appendChild(timer);

    // Zoom/pan hint chip bottom-right
    const hintChip = document.createElement('div');
    hintChip.style.cssText = `
        position:absolute;bottom:10px;right:10px;
        font-family:var(--font-mono);font-size:10px;letter-spacing:0.06em;text-transform:uppercase;
        color:var(--text-faint);
        background:rgba(0,0,0,0.5);
        padding:3px 7px;border-radius:4px;
        pointer-events:none;z-index:5;
    `;
    hintChip.textContent = 'SCROLL TO ZOOM · DRAG TO PAN';
    viewport.appendChild(hintChip);

    // ── Controls bar ─────────────────────────────────────────────────────────
    const controlsBar = document.createElement('div');
    controlsBar.id = 'controlsConatiner';
    controlsBar.style.cssText = `
        display:flex;align-items:center;gap:10px;
        min-width:0;padding:8px 12px;box-sizing:border-box;
        background:var(--surface-2);
        border:1px solid var(--border);
        border-radius:var(--r-md);
        flex-shrink:0;
        align-self:stretch;
    `;
    /* NOTE: width is intentionally NOT set to 100% here.
       The parent (innerColumn) has align-items:stretch so the bar fills the
       full width anyway — but letting CSS drive it (instead of width:100%)
       breaks the circular flex dependency that caused innerColumn to be
       wider than the square viewport, resulting in letterboxing. */

    // Play/pause — amber 32×32
    const playButton = document.createElement('button');
    playButton.style.cssText = `
        width:32px;height:32px;border-radius:6px;
        background:var(--accent);color:#111;
        border:none;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        flex-shrink:0;transition:filter 140ms;
    `;
    playButton.innerHTML = `<svg width="10" height="12" viewBox="0 0 10 12"><path d="M0 0 L10 6 L0 12 Z" fill="#111"/></svg>`;
    playButton.onmouseenter = () => playButton.style.filter = 'brightness(1.1)';
    playButton.onmouseleave = () => playButton.style.filter = '';
    window.globalPlayButton = playButton;

    // Current time display
    const currentTimeDisplay = document.createElement('span');
    currentTimeDisplay.style.cssText = 'font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--text-dim);min-width:40px;flex-shrink:0;';
    currentTimeDisplay.textContent = '00:00';

    // Progress bar — flex:1 so it fills all remaining space
    const progressBar = document.createElement('input');
    progressBar.id = 'progressBar';
    progressBar.type = 'range';
    progressBar.min = '0';
    progressBar.step = '1';
    progressBar.value = '0';
    progressBar.style.cssText = 'flex:1;min-width:0;';

    // Total time display
    const totalTimeDisplay = document.createElement('span');
    totalTimeDisplay.style.cssText = 'font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--text-faint);min-width:40px;flex-shrink:0;';
    totalTimeDisplay.textContent = '00:00';

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = 'width:1px;height:18px;background:var(--border);flex-shrink:0;';

    // Speed label
    const speedLabel = document.createElement('span');
    speedLabel.style.cssText = 'font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;font-size:9.5px;color:var(--text-muted);flex-shrink:0;';
    speedLabel.textContent = 'SPEED';

    // Speed slider
    const speedSlider = document.createElement('input');
    speedSlider.id = 'speedSlider';
    speedSlider.type = 'range';
    speedSlider.min = '0'; speedSlider.max = '9'; speedSlider.step = '1'; speedSlider.value = '2';
    speedSlider.style.cssText = 'width:80px;flex-shrink:0;';

    // Speed display
    const speedDisplay = document.createElement('span');
    speedDisplay.id = 'speedDisplay';
    speedDisplay.textContent = '1x';
    speedDisplay.style.cssText = 'font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--accent);min-width:34px;text-align:right;flex-shrink:0;';

    controlsBar.appendChild(playButton);
    controlsBar.appendChild(currentTimeDisplay);
    controlsBar.appendChild(progressBar);
    controlsBar.appendChild(totalTimeDisplay);
    controlsBar.appendChild(divider);
    controlsBar.appendChild(speedLabel);
    controlsBar.appendChild(speedSlider);
    controlsBar.appendChild(speedDisplay);

    // Sync timer el → currentTimeDisplay (replay2d writes to #timer)
    const timerObserver = new MutationObserver(() => {
        currentTimeDisplay.textContent = timer.textContent;
    });
    timerObserver.observe(timer, { childList: true, characterData: true, subtree: true });

    innerColumn.appendChild(viewport);
    innerColumn.appendChild(controlsBar);
    centerCol.appendChild(innerColumn);

    // ── Pinned teams container (right) ────────────────────────────────────────
    const pinnedContainer = document.createElement('div');
    pinnedContainer.id = 'pinned-teams-container';
    pinnedContainer.style.cssText = 'display:none;flex-shrink:0;gap:10px;height:100%;';

    bodyRow.appendChild(teamList);
    bodyRow.appendChild(centerCol);
    bodyRow.appendChild(pinnedContainer);
    modalContent.appendChild(bodyRow);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    window.teamNameVisibility = {};
    window.pinnedTeams = [null, null];

    startModal(matchId, platform, matchData.data.attributes.mapName);
    populateTeams(matchData, teamListScroll);

    // Exposed so replay2d can pin a team by clicking a player on the canvas.
    // Finds the right .team-custom div and simulates a click — reuses all
    // existing pin/unpin logic and visual updates for free.
    window.pinTeamByAccountId = (accountId) => {
        const pid = matchData.included.filter(p => p.type === 'participant')
            .find(p => p.attributes?.stats?.playerId === accountId)?.id;
        const roster = matchData.included.filter(r => r.type === 'roster')
            .find(r => r.relationships.participants.data.some(p => p.id === pid));
        if (!roster) return;
        const teamDiv = document.querySelector(`.team-custom[data-team-id="${roster.attributes.stats.teamId}"]`);
        if (teamDiv) teamDiv.click();
    };

    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            timerObserver.disconnect();
            if (window._loadoutInterval) clearInterval(window._loadoutInterval);
            modal.remove();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pinned panel management
// ─────────────────────────────────────────────────────────────────────────────

function updatePinnedLayout() {
    const container = document.getElementById('pinned-teams-container');
    if (!container) return;
    const filled = window.pinnedTeams.filter(Boolean).length;
    container.style.display = filled > 0 ? 'flex' : 'none';
}

function buildTeamPanel(roster, matchData, teamId, color, slotIndex) {
    const panel = document.createElement('div');
    panel.dataset.teamId = teamId;
    panel.style.cssText = `
        width:220px;flex-shrink:0;
        background:var(--surface);
        border:1px solid var(--border);
        border-radius:var(--r-md);
        display:flex;flex-direction:column;
        overflow:hidden;height:100%;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        display:flex;align-items:center;gap:8px;
        padding:10px;
        background:var(--surface-2);
        border-bottom:1px solid var(--divider);
        flex-shrink:0;
    `;

    const dot = document.createElement('div');
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;`;

    const title = document.createElement('span');
    title.textContent = `Team #${roster.attributes.stats.rank || roster.attributes.stats.teamId}`;
    title.style.cssText = 'font-size:12px;font-weight:600;flex:1;color:var(--text);';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        width:22px;height:22px;border-radius:4px;border:none;
        background:transparent;color:var(--text-muted);cursor:pointer;
        font-size:12px;display:flex;align-items:center;justify-content:center;
        transition:background 140ms;
    `;
    closeBtn.onmouseenter = () => closeBtn.style.background = 'var(--surface-3)';
    closeBtn.onmouseleave = () => closeBtn.style.background = 'transparent';
    closeBtn.addEventListener('click', () => unpinTeam(teamId));

    header.appendChild(dot);
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Toggles section
    const optionsRow = document.createElement('div');
    optionsRow.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--divider);flex-shrink:0;';

    function makeToggle(label, initialState, onChange) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 0;';

        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'font-size:11px;color:var(--text-dim);';

        const pill = document.createElement('button');
        let active = initialState;
        pill.style.cssText = `
            width:28px;height:16px;border-radius:8px;border:none;cursor:pointer;
            background:${active ? 'var(--accent)' : 'var(--surface-3)'};
            position:relative;transition:background 160ms;flex-shrink:0;
        `;
        const knob = document.createElement('span');
        knob.style.cssText = `
            position:absolute;top:2px;left:${active ? '14px' : '2px'};
            width:12px;height:12px;border-radius:50%;
            background:#111;transition:left 160ms;
        `;
        pill.appendChild(knob);

        pill.addEventListener('click', () => {
            active = !active;
            pill.style.background = active ? 'var(--accent)' : 'var(--surface-3)';
            knob.style.left = active ? '14px' : '2px';
            onChange(active);
        });

        row.appendChild(lbl);
        row.appendChild(pill);
        return row;
    }

    if (!window.teamNameVisibility) window.teamNameVisibility = {};
    if (!window.teamTrackVisibility) window.teamTrackVisibility = {};
    optionsRow.appendChild(makeToggle('Show names', !!window.teamNameVisibility[teamId], val => { window.teamNameVisibility[teamId] = val; }));
    optionsRow.appendChild(makeToggle('Track path', !!window.teamTrackVisibility[teamId], val => { window.teamTrackVisibility[teamId] = val; }));
    panel.appendChild(optionsRow);

    // Scrollable player list
    const playerList = document.createElement('div');
    playerList.style.cssText = 'flex:1;overflow-y:auto;padding:8px;scrollbar-width:thin;scrollbar-color:var(--surface-3) transparent;';

    const ASSETS = 'pubg-api-assets/Assets/Item';
    const IGNORED_BACKPACKS = new Set(['Item_Back_B_01_StartParachutePack_C']);
    const SEP_HTML = '<div style="width:1px;background:var(--divider);align-self:stretch;margin:0 3px;"></div>';
    const SLOT_SM = `flex-shrink:0;width:32px;height:32px;background:var(--surface);border:1px solid var(--divider);border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;`;
    const SLOT_WP = `flex-shrink:0;width:44px;height:32px;background:var(--surface);border:1px solid var(--divider);border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;`;

    function itemImg(src, alt) {
        return `<img src="/${src}" alt="${alt}" title="${alt}" style="width:100%;height:100%;object-fit:contain;" onerror="this.style.opacity=0.15">`;
    }
    const _WEP_HANDGUNS = new Set(['Item_Weapon_AK47_C','Item_Weapon_Berreta686_C','Item_Weapon_DesertEagle_C','Item_Weapon_Glock_C','Item_Weapon_M1911_C','Item_Weapon_NagantM1895_C','Item_Weapon_P18C_C','Item_Weapon_P1911_C','Item_Weapon_P92_C','Item_Weapon_R1895_C','Item_Weapon_R45_C','Item_Weapon_SAF_C','Item_Weapon_Skorpion_C','Item_Weapon_TEC9_C','Item_Weapon_vz61Skorpion_C']);
    const _WEP_MELEE   = new Set(['Item_Weapon_Crowbar_C','Item_Weapon_Machete_C','Item_Weapon_Pan_C','Item_Weapon_SickleC','Item_Weapon_Sickle_C','Item_Weapon_Knife_C']);
    function _weapSubFolder(id) {
        if (_WEP_HANDGUNS.has(id)) return 'Handgun';
        if (_WEP_MELEE.has(id))   return 'Melee';
        return 'Main';
    }
    function getItemImg(id) {
        if (!id) return null;
        if (id.startsWith('Item_Armor_'))  return `${ASSETS}/Equipment/Vest/${id}.png`;
        if (id.startsWith('Item_Head_'))   return `${ASSETS}/Equipment/Headgear/${id}.png`;
        if (id.startsWith('Item_Back_'))   return `${ASSETS}/Equipment/Backpack/${id.replace(/^(Item_Back_BlueBlocker).*/, '$1')}.png`;
        if (id.startsWith('Item_Attach_')) return `${ASSETS}/Attachment/${id}.png`;
        if (id.startsWith('Item_Weapon_')) return `${ASSETS}/Weapon/${_weapSubFolder(id)}/${id}.png`;
        return null;
    }
    function getWeaponImg(id, sub) {
        const folder = sub === 'Handgun' ? 'Handgun' : sub === 'Melee' ? 'Melee' : 'Main';
        return `${ASSETS}/Weapon/${folder}/${id}.png`;
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
        card.style.cssText = `
            background:var(--surface-2);
            border:1px solid var(--divider);
            border-radius:6px;padding:8px;margin-bottom:6px;
        `;

        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px;';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = s.name;
        nameSpan.title = `Open ${s.name} in a new tab`;
        nameSpan.style.cssText = 'font-size:11.5px;font-weight:600;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;color:var(--text);cursor:pointer;';
        nameSpan.addEventListener('mouseenter', () => { nameSpan.style.textDecoration = 'underline'; });
        nameSpan.addEventListener('mouseleave', () => { nameSpan.style.textDecoration = ''; });
        nameSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(buildPlayerLink(s.name), '_blank', 'noopener');
        });

        const hpWrapper = document.createElement('div');
        hpWrapper.style.cssText = 'flex:1;display:flex;align-items:center;gap:6px;';

        const hpTrack = document.createElement('div');
        hpTrack.style.cssText = 'flex:1;height:4px;background:var(--surface-3);border-radius:2px;overflow:hidden;';
        const hpFill = document.createElement('div');
        hpFill.style.cssText = 'height:100%;border-radius:2px;transition:width 180ms,background 180ms;width:100%;background:oklch(0.76 0.14 155);';
        hpTrack.appendChild(hpFill);

        const hpText = document.createElement('span');
        hpText.textContent = '100';
        hpText.style.cssText = 'font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:10px;color:var(--text-muted);min-width:22px;text-align:right;flex-shrink:0;';

        hpWrapper.appendChild(hpTrack);
        hpWrapper.appendChild(hpText);
        nameRow.appendChild(nameSpan);
        nameRow.appendChild(hpWrapper);

        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:6px;';
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

    const intervalKey = `_loadout_${teamId}`;
    if (window[intervalKey]) clearInterval(window[intervalKey]);

    function update() {
        if (!window.getLoadoutAt) return;
        const elapsed = window.replayCurrentTime ?? 0;

        Object.entries(playerDivs).forEach(([accountId, div]) => {
            const { weapons, equipment } = window.getLoadoutAt(accountId, elapsed);

            const hp = window.playerHpByTime?.[accountId]?.[Math.round(elapsed)] ?? 100;
            const hpRatio = Math.max(0, Math.min(1, hp / 100));
            const { fill, text } = hpDivs[accountId];
            fill.style.width = `${hpRatio * 100}%`;
            fill.style.background = hpRatio > 0.5
                ? 'oklch(0.76 0.14 155)'
                : hpRatio > 0.25
                    ? 'oklch(0.80 0.15 60)'
                    : 'oklch(0.68 0.18 25)';
            text.textContent = Math.round(hp);

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
    if (slots[0]?.teamId === teamId || slots[1]?.teamId === teamId) {
        unpinTeam(teamId);
        return;
    }
    if (slots[0] === null) {
        slots[0] = { teamId, roster, matchData, color };
    } else if (slots[1] === null) {
        slots[1] = { teamId, roster, matchData, color };
    } else {
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
    if (window[`_loadout_${teamId}`]) { clearInterval(window[`_loadout_${teamId}`]); delete window[`_loadout_${teamId}`]; }
    slots[idx] = null;
    if (slots[0] === null && slots[1] !== null) { slots[0] = slots[1]; slots[1] = null; }
    renderPinnedPanels();
    document.querySelectorAll('.team-custom').forEach(d => {
        const isSelected = window.pinnedTeams.some(s => s?.teamId === parseInt(d.dataset.teamId));
        if (!isSelected) d.style.borderLeftColor = 'transparent';
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

function populateTeams(matchData, teamListEl) {
    teamListEl.innerHTML = '';
    const searchedPlayerName = document.getElementById('player-name-display')?.textContent?.trim();
    const rosters = matchData.included.filter(item => item.type === 'roster');

    const countEl = document.getElementById('team-count');
    if (countEl) countEl.textContent = rosters.length;

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

        const teamDiv = document.createElement('button');
        teamDiv.classList.add('team-custom');
        teamDiv.dataset.teamId = teamId;
        teamDiv.style.cssText = `
            width:100%;text-align:left;
            display:flex;align-items:center;gap:10px;
            padding:8px 10px;
            background:${isSearchedTeam ? 'var(--surface-2)' : 'transparent'};
            border:none;
            border-left:3px solid transparent;
            color:${isSearchedTeam ? 'var(--text)' : 'var(--text-muted)'};
            cursor:pointer;
            opacity:${isSearchedTeam ? '1' : '0.55'};
            border-bottom:1px solid var(--divider);
            font-family:var(--font-ui);
            transition:background 140ms,opacity 140ms;
        `;

        const rankChip = document.createElement('div');
        rankChip.style.cssText = `
            width:26px;height:26px;border-radius:4px;
            background:${uniqueColor};color:#111;
            display:flex;align-items:center;justify-content:center;
            font-family:var(--font-mono);font-size:11px;font-weight:700;
            flex-shrink:0;box-shadow:0 1px 2px oklch(0 0 0 / 0.4);
        `;
        rankChip.textContent = teamNumber;

        const playersDiv = document.createElement('div');
        playersDiv.style.cssText = 'flex:1;min-width:0;';

        roster.relationships.participants.data.forEach(ref => {
            const participant = matchData.included.find(p => p.id === ref.id);
            const name = participant.attributes.stats.name;
            const isSelf = name === searchedPlayerName;
            const playerDiv = document.createElement('span');
            playerDiv.textContent = name;
            playerDiv.style.cssText = `
                font-size:11.5px;
                font-weight:${isSelf ? '600' : '400'};
                color:${isSelf ? 'var(--accent)' : 'inherit'};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                display:block;
                padding:1px 0;
            `;
            playersDiv.appendChild(playerDiv);
        });

        teamDiv.appendChild(rankChip);
        teamDiv.appendChild(playersDiv);
        teamListEl.appendChild(teamDiv);

        teamDiv.addEventListener('click', function (e) {
            e.preventDefault();
            pinTeam(roster, matchData, teamId, uniqueColor);
            document.querySelectorAll('.team-custom').forEach(d => {
                const tid = parseInt(d.dataset.teamId);
                const isSelected = window.pinnedTeams.some(s => s?.teamId === tid);
                d.style.borderLeftColor = isSelected ? generateUniqueColor(rosters.findIndex(r => r.attributes.stats.teamId === tid)) : 'transparent';
                d.style.background = isSelected ? 'var(--surface-3)' : (tid === teamId || isSearchedTeam ? 'var(--surface-2)' : 'transparent');
                d.style.opacity = isSelected || d.dataset.teamId == searchedRoster?.attributes?.stats?.teamId ? '1' : '0.55';
            });
        });

        teamDiv.onmouseenter = () => { if (teamDiv.style.opacity !== '1') teamDiv.style.opacity = '0.8'; };
        teamDiv.onmouseleave = () => {
            const tid = parseInt(teamDiv.dataset.teamId);
            const isSelected = window.pinnedTeams.some(s => s?.teamId === tid);
            teamDiv.style.opacity = (isSelected || isSearchedTeam) ? '1' : '0.55';
        };
    });
}
