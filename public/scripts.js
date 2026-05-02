import { showModal } from './modal.js';
import { translateMapName } from './utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons (inline, 24×24 viewBox)
// ─────────────────────────────────────────────────────────────────────────────
function svg(d, { size = 16, fill = 'none', stroke = 1.7, solid = false } = {}) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="${solid ? 'currentColor' : fill}"
    stroke="${solid ? 'none' : 'currentColor'}"
    stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"
    style="display:inline-block;flex-shrink:0;vertical-align:middle">
    <path d="${d}"/>
  </svg>`;
}

const Icon = {
  search:   (s=16) => svg('M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0 -14M20 20l-3.5 -3.5', {size:s}),
  clock:    (s=16) => svg('M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0 -18M12 7v5l3 2', {size:s}),
  target:   (s=16) => svg('M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0 -18M12 7a5 5 0 1 1 0 10a5 5 0 0 1 0 -10M12 11a1 1 0 1 1 0 2a1 1 0 0 1 0 -2', {size:s}),
  play:     (s=16) => svg('M7 5l12 7l-12 7z', {size:s, solid:true}),
  chevron:  (s=16) => svg('M9 6l6 6l-6 6', {size:s}),
  chevronD: (s=16) => svg('M6 9l6 6l6 -6', {size:s}),
  x:        (s=16) => svg('M6 6l12 12M18 6l-12 12', {size:s}),
  arrowR:   (s=16) => svg('M5 12h14M13 6l6 6l-6 6', {size:s}),
  star:     (s=16) => svg('M12 4l2.5 5l5.5 0.8l-4 3.8l1 5.4l-5 -2.6l-5 2.6l1 -5.4l-4 -3.8l5.5 -0.8z', {size:s}),
  filter:   (s=16) => svg('M4 6h16M7 12h10M10 18h4', {size:s}),
  share:    (s=16) => svg('M15 8a3 3 0 1 1 3 -3M9 12a3 3 0 1 1 -3 3M15 16a3 3 0 1 1 3 3M8.7 13.3l6.6 3.4M15.3 7.3l-6.6 3.4', {size:s}),
  steam:    (s=16) => svg('M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0 -18M8 16a2.5 2.5 0 1 0 0 -5a2.5 2.5 0 0 0 0 5zM16 6a3 3 0 1 1 0 6a3 3 0 0 1 0 -6M13 11l-5 3', {size:s}),
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function buildLogo(large = false) {
  const sz = large ? '64px' : '18px';
  const dotStyle = large
    ? 'width:12px;height:12px;transform:translateY(-40px);margin-left:10px;'
    : 'width:6px;height:6px;transform:translateY(-8px);margin-left:6px;';
  return `<div class="pi-logo ${large ? 'large' : 'compact'}">
    <span class="logo-pubg" style="font-size:${sz}">pubg</span>
    <span class="logo-insight" style="font-size:${sz}">insight</span>
    <span class="logo-dot" style="${dotStyle}"></span>
  </div>`;
}

function rankChip(place, total, size = 'md') {
  const isWin = place === 1;
  return `<div class="rank-chip ${size} ${isWin ? 'win' : 'normal'}">
    <span class="rank-chip-place">#${place}</span>
    <span class="rank-chip-total">/${total}</span>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let allSeasons = [];
let allMatches = [];
let currentPlayerName = '';
let currentIndex = 0;
const MATCHES_PER_PAGE = 20;
let activeMode = 'squadFpp';
let recentSearches = [];
try { recentSearches = JSON.parse(localStorage.getItem('pi_recents') || '[]'); } catch(e) {}
let fppStats = {}, tppStats = {};

const MODES = [
  { key: 'soloFpp',  label: 'Solo',  persp: 'FPP', statKey: 'solo',  perspKey: 'fpp' },
  { key: 'duoFpp',   label: 'Duo',   persp: 'FPP', statKey: 'duo',   perspKey: 'fpp' },
  { key: 'squadFpp', label: 'Squad', persp: 'FPP', statKey: 'squad', perspKey: 'fpp' },
  { key: 'soloTpp',  label: 'Solo',  persp: 'TPP', statKey: 'solo',  perspKey: 'tpp' },
  { key: 'duoTpp',   label: 'Duo',   persp: 'TPP', statKey: 'duo',   perspKey: 'tpp' },
  { key: 'squadTpp', label: 'Squad', persp: 'TPP', statKey: 'squad', perspKey: 'tpp' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
function renderHeader(query = '', season = '') {
  const h = document.getElementById('pi-header');
  if (!h) return;
  h.innerHTML = `
    <a href="#" id="header-logo-link" style="text-decoration:none">${buildLogo(false)}</a>
    <div style="flex:1">
      <form id="header-search-form" class="pi-search-form">
        <div class="pi-search-input-wrap">
          ${Icon.search(16)}
          <input id="header-player-name" value="${escapeAttr(query)}" placeholder="Search player name" autocomplete="off">
          <div class="pi-search-hint">⏎</div>
        </div>
        <div class="pi-season-wrap">
          <select id="header-season-select" class="pi-season-select"></select>
          <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
        </div>
        <button type="submit" class="pi-btn primary">${Icon.search(14)} Search</button>
      </form>
    </div>
    <div class="pi-header-actions">
      <button class="pi-btn subtle">${Icon.clock(14)} History</button>
      <button class="pi-btn subtle">${Icon.star(14)} Saved</button>
    </div>`;
  populateSeasonSelect('header-season-select', season);
  document.getElementById('header-search-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
  document.getElementById('header-logo-link').addEventListener('click', e => { e.preventDefault(); showLanding(); });
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function populateSeasonSelect(id, selectedId = '') {
  const sel = document.getElementById(id);
  if (!sel || !allSeasons.length) return;
  sel.innerHTML = allSeasons.map(s => {
    const n = parseInt(s.id.split('-').pop(), 10);
    const label = `Season ${n}${s.attributes.isCurrentSeason ? ' · current' : ''}`;
    const isSelected = s.id === selectedId || (!selectedId && s.attributes.isCurrentSeason);
    return `<option value="${s.id}"${isSelected ? ' selected' : ''}>${label}</option>`;
  }).join('');
}

function getCurrentSeason() {
  return document.getElementById('header-season-select')?.value
      || document.getElementById('landing-season-select')?.value
      || (allSeasons.find(s => s.attributes.isCurrentSeason)?.id ?? '');
}

function getQuery() {
  return (document.getElementById('header-player-name')?.value
       || document.getElementById('landing-player-name')?.value || '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Landing
// ─────────────────────────────────────────────────────────────────────────────
function showLanding() {
  document.getElementById('landing-wrap').style.display = '';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('pi-header').style.display = 'none';
  renderLanding();
  closeDrawer();
}

function renderLanding() {
  const recentHTML = recentSearches.slice(0, 6).map(name =>
    `<button class="pi-chip recent-chip" data-name="${escapeAttr(name)}">${Icon.clock(12)} ${name}</button>`
  ).join('');

  document.getElementById('landing').innerHTML = `
    <div class="landing-logo-wrap">${buildLogo(true)}</div>
    <p class="landing-tagline">Season-by-season PUBG stats, match history and 2D replays. Search a Steam username to get started.</p>

    <div class="landing-search-wrap">
      <form id="landing-form" class="pi-search-form large" style="width:100%">
        <div class="pi-search-input-wrap" style="flex:1">
          ${Icon.search(18)}
          <input id="landing-player-name" placeholder="Enter player name…" autocomplete="off" autofocus>
          <div class="pi-steam-badge">
            ${Icon.steam(14)} <span class="micro">STEAM</span>
          </div>
          <div class="pi-season-wrap" style="margin-right:8px">
            <select id="landing-season-select" class="pi-season-select"></select>
            <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
          </div>
        </div>
        <button type="submit" class="pi-btn primary large">${Icon.arrowR(14)} Search</button>
      </form>
    </div>

    <div class="landing-recents">
      <span class="micro" style="color:var(--text-faint)">RECENT</span>
      ${recentHTML || '<span style="color:var(--text-faint);font-size:12px">No recent searches</span>'}
    </div>

    <div class="landing-features">
      <div class="feature-card">
        <div class="feature-icon">${Icon.target(16)}</div>
        <div class="feature-title">Season stats</div>
        <div class="feature-body">K/D, win rate, avg damage for SOLO / DUO / SQUAD across FPP and TPP.</div>
      </div>
      <div class="feature-card">
        <div class="feature-icon">${Icon.clock(16)}</div>
        <div class="feature-title">Match history</div>
        <div class="feature-body">Last 20+ matches with placement, kills, damage and time survived.</div>
      </div>
      <div class="feature-card">
        <div class="feature-icon">${Icon.play(14)}</div>
        <div class="feature-title">2D replay</div>
        <div class="feature-body">Rewatch every match with a top-down telemetry timeline and team panel.</div>
      </div>
    </div>`;

  populateSeasonSelect('landing-season-select');
  document.getElementById('landing-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
  document.querySelectorAll('.recent-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.name;
      const inp = document.getElementById('landing-player-name');
      if (inp) { inp.value = n; inp.focus(); }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────
function showLoading() {
  document.getElementById('landing-wrap').style.display = 'none';
  document.getElementById('loading-state').style.display = 'block';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('pi-header').style.display = 'flex';
  document.getElementById('loading-state').innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:28px 32px">
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:24px">
        <div class="skel" style="width:64px;height:64px;border-radius:50%"></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="skel" style="width:220px;height:24px"></div>
          <div class="skel" style="width:160px;height:14px"></div>
        </div>
      </div>
      <div class="skel" style="width:100%;height:46px;margin-bottom:20px"></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:36px">
        ${Array.from({length:8}).map(()=>`<div class="skel" style="height:96px"></div>`).join('')}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${Array.from({length:5}).map(()=>`<div class="skel" style="height:76px"></div>`).join('')}
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player page
// ─────────────────────────────────────────────────────────────────────────────
function showPlayerPage(playerName, seasonId) {
  document.getElementById('landing-wrap').style.display = 'none';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('player-page').style.display = 'block';
  document.getElementById('pi-header').style.display = 'flex';
  renderPlayerHeader(playerName, seasonId);
  renderModeTabs();
  renderStatsGrid();
  renderMatchList();
}

function renderPlayerHeader(name, seasonId) {
  const n = parseInt((seasonId || '').split('-').pop(), 10);
  const seasonLabel = n ? `Season ${n}` : 'Season';
  document.getElementById('player-header-area').innerHTML = `
    <div class="player-header">
      <div class="player-avatar">
        <img src="/images/steam-logo-transparent.png" alt="">
      </div>
      <div style="flex:1;min-width:0">
        <div class="player-name-row">
          <h1 class="player-name" id="player-name-display">${name}</h1>
          <span class="steam-badge">${Icon.steam(11)} STEAM</span>
        </div>
        <div class="player-meta">
          <span class="mono">${seasonLabel.toUpperCase()}</span>
          <span>·</span>
          <span>Steam account</span>
        </div>
      </div>
      <button class="pi-btn ghost">${Icon.star(14)} Save</button>
      <button class="pi-btn ghost">${Icon.share(14)} Share</button>
    </div>`;
}

function renderModeTabs() {
  const tabs = MODES.map(m => {
    const s = (m.perspKey === 'fpp' ? fppStats : tppStats)?.[m.statKey];
    const isEmpty = !s?.roundsPlayed;
    const isActive = m.key === activeMode;
    return `<button class="mode-tab${isActive ? ' active' : ''}${isEmpty ? ' empty' : ''}" data-mode="${m.key}">
      <span>${m.label}</span>
      <span class="mode-tab-persp">${m.persp}</span>
      ${isEmpty ? '<span class="mode-tab-dot"></span>' : ''}
    </button>`;
  }).join('');
  document.getElementById('mode-tabs-area').innerHTML = `<div class="mode-tabs">${tabs}</div>`;
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeMode = btn.dataset.mode;
      renderModeTabs();
      renderStatsGrid();
    });
  });
}

function getActiveModeData() {
  const m = MODES.find(m => m.key === activeMode);
  if (!m) return null;
  const stats = m.perspKey === 'fpp' ? fppStats : tppStats;
  return stats?.[m.statKey] || null;
}

function renderStatsGrid() {
  const s = getActiveModeData();
  const container = document.getElementById('stats-grid-area');
  if (!s || !s.roundsPlayed) {
    container.innerHTML = `
      <div class="stats-grid-new">
        <div class="stats-empty">
          <div class="stats-empty-label">NO_DATA</div>
          <div style="font-size:14px;color:var(--text-dim)">No matches played in this mode &amp; season.</div>
        </div>
      </div>`;
    return;
  }

  const total = s.roundsPlayed || 1;
  const kills = (s.kills || 0) - (s.teamKills || 0);
  const deaths = s.losses || 1;
  const assists = s.assists || 0;
  const top10s = s.top10s || 0;

  const cards = [
    { label: 'K/D',          value: (kills/deaths).toFixed(2),                       accent: true },
    { label: 'AVG. DAMAGE',  value: Math.round((s.damageDealt||0)/total) },
    { label: 'ASSIST',       value: assists },
    { label: 'GAMES',        value: total },
    { label: 'WIN %',        value: (((s.wins||0)/total)*100).toFixed(2)+'%',         accent: true },
    { label: 'WINS',         value: s.wins || 0 },
    { label: 'KDA',          value: ((kills+assists)/deaths).toFixed(2) },
    { label: 'HEADSHOT %',   value: kills ? (((s.headshotKills||0)/kills)*100).toFixed(2)+'%' : '0.00%' },
    { label: 'MOST KILLS',   value: s.roundMostKills || 0 },
    { label: 'LONGEST KILL', value: s.longestKill ? Math.round(s.longestKill)+'m' : '0m' },
    { label: 'TOP 10 %',     value: ((top10s/total)*100).toFixed(2)+'%' },
    { label: 'TOP 10',       value: top10s },
  ];

  container.innerHTML = `<div class="stats-grid-new">${cards.map(c => `
    <div class="stat-card-new">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value${c.accent ? ' accent' : ''}">${c.value}</div>
    </div>`).join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Match list
// ─────────────────────────────────────────────────────────────────────────────
function renderMatchList() {
  currentIndex = 0;
  const container = document.getElementById('match-list-area');
  if (!allMatches.length) { container.innerHTML = ''; return; }
  appendMatches(container, true);
}

function appendMatches(container, reset = false) {
  const nextBatch = allMatches.slice(currentIndex, currentIndex + MATCHES_PER_PAGE);
  currentIndex += nextBatch.length;

  if (reset) {
    const rows = allMatches.slice(0, currentIndex).map(m => buildMatchRow(m)).filter(Boolean).join('');
    container.innerHTML = `
      <div class="match-section-header">
        <h2 class="match-section-title">Last matches <span class="match-section-count" id="match-count">${currentIndex}/${allMatches.length}</span></h2>
        <div class="match-section-actions">
          <button class="pi-btn subtle">${Icon.filter(13)} Filter</button>
          <button class="pi-btn subtle">All modes</button>
        </div>
      </div>
      <div class="match-list-new" id="match-list-inner">${rows}</div>
      ${currentIndex < allMatches.length ? `<div class="load-more-wrap"><button id="load-more-btn" class="pi-btn ghost">Load more ${Icon.chevronD(14)}</button></div>` : ''}`;
    bindMatchRows(container);
    document.getElementById('load-more-btn')?.addEventListener('click', () => appendMatches(container, false));
  } else {
    const list = container.querySelector('#match-list-inner');
    nextBatch.forEach(m => { const r = buildMatchRow(m); if(r){ const div=document.createElement('div'); div.innerHTML=r; const btn=div.firstElementChild; list.appendChild(btn); bindRow(btn); } });
    const cnt = container.querySelector('#match-count');
    if (cnt) cnt.textContent = `${currentIndex}/${allMatches.length}`;
    if (currentIndex >= allMatches.length) container.querySelector('.load-more-wrap')?.remove();
  }
}

function bindMatchRows(container) {
  container.querySelectorAll('.match-row-new').forEach(btn => bindRow(btn));
}

function bindRow(btn) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.matchId;
    const m = allMatches.find(x => x.data.id === id);
    if (m) openDrawer(m);
  });
}

function buildMatchRow(match) {
  const attr = match.data.attributes;
  const participant = match.included
    .filter(i => i.type === 'participant')
    .find(p => p.attributes?.stats?.name === currentPlayerName);
  if (!participant) return '';

  const { kills, assists, damageDealt, winPlace, timeSurvived } = participant.attributes.stats;
  const totalRosters = match.data.relationships.rosters.data.length;
  const translatedMap = translateMapName(attr.mapName);
  const gameMode = attr.gameMode.toUpperCase().replace(/-/g, ' ');
  const matchCategory = attr.matchType === 'competitive' ? 'RANKED' : 'NORMAL';
  const isWin = winPlace === 1;
  const ago = timeAgo(attr.createdAt);
  const mapImg = translatedMap.toLowerCase();

  return `<button class="match-row-new${isWin ? ' winner' : ''}" data-match-id="${match.data.id}">
    ${rankChip(winPlace, totalRosters, 'sm')}
    <div class="match-map-cell">
      <div class="match-thumb stripe-placeholder">
        <img src="/images/${mapImg}.jpg" alt="${translatedMap}"
          style="width:100%;height:100%;object-fit:cover;display:block"
          onerror="this.style.display='none'">
      </div>
      <div>
        <div class="match-map-name">${translatedMap}</div>
        <div class="match-mode-line">${gameMode} · ${matchCategory}</div>
      </div>
    </div>
    <div class="match-ago">${ago}</div>
    <div class="match-stats-row">
      ${[['KILLS', kills], ['ASSIST', assists], ['DMG', Math.round(damageDealt)], ['TIME', formatTime(timeSurvived)]].map(([l,v]) =>
        `<div class="match-stat-col"><span class="match-stat-label">${l}</span><span class="match-stat-value">${v}</span></div>`
      ).join('')}
    </div>
    <span class="match-chevron">${Icon.chevron(14)}</span>
  </button>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Match drawer
// ─────────────────────────────────────────────────────────────────────────────
function openDrawer(matchData) {
  renderDrawer(matchData);
  document.getElementById('match-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
}

function closeDrawer() {
  document.getElementById('match-drawer')?.classList.remove('open');
  document.getElementById('drawer-backdrop')?.classList.remove('open');
}

function renderDrawer(matchData) {
  const attr = matchData.data.attributes;
  const participant = matchData.included
    .filter(i => i.type === 'participant')
    .find(p => p.attributes?.stats?.name === currentPlayerName);
  if (!participant) return;

  const { kills, assists, damageDealt, winPlace, timeSurvived } = participant.attributes.stats;
  const totalRosters = matchData.data.relationships.rosters.data.length;
  const translatedMap = translateMapName(attr.mapName);
  const gameMode = attr.gameMode.toUpperCase().replace(/-/g, ' ');
  const matchCategory = attr.matchType === 'competitive' ? 'RANKED' : 'NORMAL';
  const isWin = winPlace === 1;
  const ago = timeAgo(attr.createdAt);

  // Find teammates via roster
  const rosters = matchData.included.filter(i => i.type === 'roster');
  const myRoster = rosters.find(r =>
    r.relationships?.participants?.data?.some(pd => {
      const p = matchData.included.find(i => i.id === pd.id && i.type === 'participant');
      return p?.attributes?.stats?.name === currentPlayerName;
    })
  );
  const teammates = myRoster
    ? myRoster.relationships.participants.data
        .map(pd => matchData.included.find(i => i.id === pd.id && i.type === 'participant'))
        .filter(Boolean)
        .map(p => p.attributes?.stats?.name)
        .filter(n => n && n !== currentPlayerName)
    : [];

  const statusColor = isWin ? 'var(--accent)' : 'var(--text-dim)';
  const statusLabel = isWin ? 'CHICKEN DINNER' : 'FINISHED';

  document.getElementById('match-drawer').innerHTML = `
    <div class="drawer-header">
      ${rankChip(winPlace, totalRosters, 'lg')}
      <div class="drawer-header-info">
        <div class="drawer-status-row">
          <span class="micro" style="color:${statusColor}">${statusLabel}</span>
          <span class="mono" style="font-size:10px;color:var(--text-faint)">· ${ago}</span>
        </div>
        <div class="drawer-map-name">${translatedMap}</div>
        <div class="drawer-mode-line">${gameMode} · ${matchCategory}</div>
      </div>
      <button class="drawer-close" id="drawer-close-btn">${Icon.x(14)}</button>
    </div>

    <div class="drawer-body">
      <div class="micro drawer-section-label">YOUR PERFORMANCE</div>
      <div class="drawer-perf-grid">
        ${[['KILLS', kills], ['ASSIST', assists], ['DAMAGE', Math.round(damageDealt)], ['SURVIVED', formatTime(timeSurvived)]].map(([l,v]) =>
          `<div class="drawer-perf-cell"><div class="drawer-perf-label">${l}</div><div class="drawer-perf-value">${v}</div></div>`
        ).join('')}
      </div>

      <div class="micro drawer-section-label">TEAM</div>
      <div class="drawer-teammates">
        <div class="drawer-teammate">
          <div class="drawer-teammate-badge self">★</div>
          <span class="drawer-teammate-name" style="font-weight:600">${currentPlayerName}</span>
          <span class="drawer-teammate-kills">${kills} K</span>
        </div>
        ${teammates.map((name, i) => `
          <div class="drawer-teammate">
            <div class="drawer-teammate-badge other">${i + 2}</div>
            <span class="drawer-teammate-name" style="color:var(--text-dim)">${name}</span>
          </div>`).join('')}
      </div>

      <div class="micro drawer-section-label">MATCH TIMELINE</div>
      <div class="drawer-timeline">
        <div class="drawer-timeline-track">
          ${[10,25,40,55,70,88].map((p, i) =>
            `<div class="drawer-timeline-dot" style="left:${p}%;background:${i===5&&isWin?'var(--accent)':'var(--text-dim)'}"></div>`
          ).join('')}
        </div>
        <div class="drawer-timeline-labels">
          <span>00:00</span><span>${formatTime(timeSurvived)}</span>
        </div>
      </div>
    </div>

    <div class="drawer-footer">
      <button class="pi-btn ghost">${Icon.share(14)} Share</button>
      <div style="flex:1"></div>
      <button class="pi-btn primary" id="open-replay-btn">${Icon.play(12)} Open 2D replay</button>
    </div>`;

  document.getElementById('drawer-close-btn').addEventListener('click', closeDrawer);
  document.getElementById('open-replay-btn').addEventListener('click', () => {
    window.globalMatchData = matchData;
    showModal(matchData);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Search / fetch
// ─────────────────────────────────────────────────────────────────────────────
async function doSearch() {
  const name = getQuery();
  const seasonId = getCurrentSeason();
  if (!name) return;

  currentPlayerName = name;
  recentSearches = [name, ...recentSearches.filter(n => n !== name)].slice(0, 6);
  try { localStorage.setItem('pi_recents', JSON.stringify(recentSearches)); } catch(e) {}

  showLoading();
  renderHeader(name, seasonId);

  try {
    const [statsRes, matchesRes] = await Promise.all([
      fetch(`/api/player/${encodeURIComponent(name)}?season=${encodeURIComponent(seasonId)}`),
      fetch(`/api/player/${encodeURIComponent(name)}/matches`),
    ]);

    const statsData = await statsRes.json();
    const matchesData = await matchesRes.json();

    if (!statsData.stats) { alert('No stats available for this player'); showLanding(); return; }

    fppStats = statsData.stats.fpp || {};
    tppStats = statsData.stats.tpp || {};
    window.fppStats = fppStats;
    window.tppStats = tppStats;
    allMatches = matchesData.matches || [];
    currentIndex = 0;
    activeMode = getBestMode(fppStats, tppStats);

    showPlayerPage(name, seasonId);
  } catch (err) {
    console.error(err);
    alert('Failed to load player data.');
    showLanding();
  }
}

function getBestMode(fpp, tpp) {
  let maxRounds = 0, selectedMode = 'squadFpp';
  ['solo', 'duo', 'squad'].forEach(mode => {
    const f = fpp[mode]?.roundsPlayed || 0;
    const t = tpp[mode]?.roundsPlayed || 0;
    if (f > maxRounds) { maxRounds = f; selectedMode = `${mode}Fpp`; }
    if (t > maxRounds) { maxRounds = t; selectedMode = `${mode}Tpp`; }
  });
  return selectedMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

// ─────────────────────────────────────────────────────────────────────────────
// App shell + boot
// ─────────────────────────────────────────────────────────────────────────────
function buildAppShell() {
  document.getElementById('app').innerHTML = `
    <header id="pi-header" class="pi-header" style="display:none"></header>
    <div id="landing-wrap">
      <div id="landing"></div>
    </div>
    <div id="loading-state" style="display:none"></div>
    <div id="player-page" style="display:none">
      <div class="player-content">
        <div id="player-header-area"></div>
        <div id="mode-tabs-area"></div>
        <div id="stats-grid-area"></div>
        <div id="match-list-area"></div>
      </div>
    </div>
    <div id="drawer-backdrop"></div>
    <aside id="match-drawer"></aside>`;

  document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
}

async function init() {
  buildAppShell();
  try {
    const res = await fetch('/api/seasons');
    const seasons = await res.json();
    if (!seasons || seasons.error) throw new Error('seasons failed');

    allSeasons = seasons
      .filter(s => s.id.includes('pc') && !s.id.includes('console'))
      .sort((a, b) => parseInt(b.id.split('-').pop(), 10) - parseInt(a.id.split('-').pop(), 10));

    renderHeader('', allSeasons.find(s => s.attributes.isCurrentSeason)?.id || '');
    showLanding();
  } catch (err) {
    console.error(err);
    alert('Failed to load seasons.');
  }
}

init();
