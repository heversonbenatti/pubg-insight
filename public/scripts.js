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
let savedPlayers = [];
let currentPlatform = 'steam';
try { recentSearches = JSON.parse(localStorage.getItem('pi_recents') || '[]'); } catch(e) {}
try { savedPlayers   = JSON.parse(localStorage.getItem('pi_saved')   || '[]'); } catch(e) {}
try {
  const p = localStorage.getItem('pi_platform');
  if (p) currentPlatform = p;
} catch(e) {}
let fppStats = {}, tppStats = {};
let mapFilter = new Set();
let perspectiveFilter = 'all';   // 'all' | 'fpp' | 'tpp' | 'ranked' | 'normal'

const PLATFORMS = [
  { value: 'steam',  label: 'Steam'  },
  { value: 'kakao',  label: 'Kakao'  },
  { value: 'psn',    label: 'PSN'    },
  { value: 'xbox',   label: 'Xbox'   },
  { value: 'stadia', label: 'Stadia' },
];

function platformLabel(value = currentPlatform) {
  return PLATFORMS.find(p => p.value === value)?.label || 'Steam';
}

function isConsolePlatform(p = currentPlatform) {
  return p === 'psn' || p === 'xbox' || p === 'stadia';
}

function platformSelectHTML(idPrefix) {
  return `<div class="pi-season-wrap">
    <select id="${idPrefix}-platform-select" class="pi-season-select">
      ${PLATFORMS.map(p => `<option value="${p.value}"${p.value === currentPlatform ? ' selected' : ''}>${p.label}</option>`).join('')}
    </select>
    <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
  </div>`;
}

async function loadSeasonsForCurrentPlatform() {
  const res = await fetch(`/api/seasons?platform=${currentPlatform}`);
  const seasons = await res.json();
  if (!seasons || seasons.error) throw new Error('seasons failed');

  const isConsole = isConsolePlatform();
  allSeasons = seasons
    .filter(s => isConsole ? !s.id.includes('pc') || s.id.includes('console') : (s.id.includes('pc') && !s.id.includes('console')))
    .sort((a, b) => parseInt(b.id.split('-').pop(), 10) - parseInt(a.id.split('-').pop(), 10));
}

async function changePlatform(newPlatform) {
  if (newPlatform === currentPlatform) return;
  currentPlatform = newPlatform;
  try { localStorage.setItem('pi_platform', newPlatform); } catch (_) {}
  try {
    await loadSeasonsForCurrentPlatform();
  } catch (e) {
    alert('Failed to load seasons for ' + platformLabel());
    return;
  }
  // Repopulate selects
  populateSeasonSelect('header-season-select');
  populateSeasonSelect('landing-season-select');
  // Sync platform selects so both copies match
  ['header-platform-select', 'landing-platform-select'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = currentPlatform;
  });
}

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
        ${platformSelectHTML('header')}
        <div class="pi-season-wrap">
          <select id="header-season-select" class="pi-season-select"></select>
          <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
        </div>
        <button type="submit" class="pi-btn primary">${Icon.search(14)} Search</button>
      </form>
    </div>
    <div class="pi-header-actions">
      <div class="pi-popover-host">
        <button id="btn-history" class="pi-btn subtle" type="button">${Icon.clock(14)} History</button>
      </div>
      <div class="pi-popover-host">
        <button id="btn-saved" class="pi-btn subtle" type="button">${Icon.star(14)} Saved</button>
      </div>
    </div>`;
  populateSeasonSelect('header-season-select', season);
  document.getElementById('header-search-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
  document.getElementById('header-logo-link').addEventListener('click', e => { e.preventDefault(); showLanding(); });
  document.getElementById('header-platform-select')?.addEventListener('change', e => changePlatform(e.target.value));
  document.getElementById('btn-history').addEventListener('click', e => {
    e.stopPropagation();
    togglePlayerListPopover('btn-history', 'History', recentSearches, name => {
      recentSearches = recentSearches.filter(x => x !== name);
      try { localStorage.setItem('pi_recents', JSON.stringify(recentSearches)); } catch(_) {}
    });
  });
  document.getElementById('btn-saved').addEventListener('click', e => {
    e.stopPropagation();
    togglePlayerListPopover('btn-saved', 'Saved', savedPlayers, name => {
      savedPlayers = savedPlayers.filter(x => x !== name);
      try { localStorage.setItem('pi_saved', JSON.stringify(savedPlayers)); } catch(_) {}
      updateSaveButtonState();
    });
  });
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
  const url = new URL(window.location.href);
  if (url.search || url.hash) {
    url.search = '';
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  }
}

function renderLanding() {
  const recentHTML = recentSearches.slice(0, 6).map(name =>
    `<button class="pi-chip recent-chip" data-name="${escapeAttr(name)}" title="Search ${escapeAttr(name)}">${Icon.clock(12)} ${name} <span class="recent-chip-x" title="Remove">${Icon.x(10)}</span></button>`
  ).join('');

  document.getElementById('landing').innerHTML = `
    <div class="landing-logo-wrap">${buildLogo(true)}</div>
    <p class="landing-tagline">Season-by-season PUBG stats, match history and 2D replays. Search a Steam username to get started.</p>

    <div class="landing-search-wrap">
      <form id="landing-form" class="pi-search-form large" style="width:100%">
        <div class="pi-search-input-wrap" style="flex:1">
          ${Icon.search(18)}
          <input id="landing-player-name" placeholder="Enter player name…" autocomplete="off" autofocus>
          <div class="pi-season-wrap" style="margin-right:8px">
            <select id="landing-platform-select" class="pi-season-select" title="Platform">
              ${PLATFORMS.map(p => `<option value="${p.value}"${p.value === currentPlatform ? ' selected' : ''}>${p.label}</option>`).join('')}
            </select>
            <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
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
  document.getElementById('landing-platform-select')?.addEventListener('change', e => changePlatform(e.target.value));
  document.querySelectorAll('.recent-chip').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.closest('.recent-chip-x')) {
        const n = btn.dataset.name;
        recentSearches = recentSearches.filter(x => x !== n);
        try { localStorage.setItem('pi_recents', JSON.stringify(recentSearches)); } catch(e) {}
        renderLanding();
        return;
      }
      const inp = document.getElementById('landing-player-name');
      if (inp) inp.value = btn.dataset.name;
      doSearch();
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
  renderCareerChart();      // skeleton first; data fills in async
  renderMatchList();
  loadCareerData(playerName);
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
          <span class="steam-badge">${Icon.steam(11)} ${platformLabel().toUpperCase()}</span>
        </div>
        <div class="player-meta">
          <span class="mono">${seasonLabel.toUpperCase()}</span>
          <span>·</span>
          <span>${platformLabel()} account</span>
        </div>
      </div>
      <button id="btn-save-player" class="pi-btn ghost" type="button">${Icon.star(14)} Save</button>
      <button id="btn-share-player" class="pi-btn ghost" type="button">${Icon.share(14)} Share</button>
    </div>`;
  document.getElementById('btn-save-player').addEventListener('click', () => toggleSavePlayer(currentPlayerName));
  document.getElementById('btn-share-player').addEventListener('click', () => copyToClipboard(buildPlayerShareUrl()));
  updateSaveButtonState();
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

  const cards = [
    { label: 'K/D',          value: (kills/deaths).toFixed(2),                       accent: true, wide: true },
    { label: 'AVG. KILLS',   value: (kills/total).toFixed(2) },
    { label: 'AVG. DAMAGE',  value: Math.round((s.damageDealt||0)/total) },
    { label: 'KILLS',        value: kills },
    { label: 'GAMES',        value: total },
    { label: 'WIN %',        value: (((s.wins||0)/total)*100).toFixed(2)+'%',        accent: true },
    { label: 'WINS',         value: s.wins || 0 },
    { label: 'ASSISTS',      value: assists },
    { label: 'HEADSHOT %',   value: kills ? (((s.headshotKills||0)/kills)*100).toFixed(2)+'%' : '0.00%' },
    { label: 'MOST KILLS',   value: s.roundMostKills || 0 },
    { label: 'LONGEST KILL', value: s.longestKill ? Math.round(s.longestKill)+'m' : '0m' },
  ];

  container.innerHTML = `<div class="stats-grid-new">${cards.map(c => `
    <div class="stat-card-new${c.wide ? ' wide' : ''}">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value${c.accent ? ' accent' : ''}">${c.value}</div>
    </div>`).join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Career chart (across seasons)
// ─────────────────────────────────────────────────────────────────────────────
let careerData = null;
let careerLoading = false;
let careerVisible = { kd: true, avgKills: true, avgDamage: true, winRate: true, headshotRate: true };

const CAREER_METRICS = [
  { key: 'kd',           label: 'K/D',       color: '#ffd866', fmt: v => v.toFixed(2)            },
  { key: 'avgKills',     label: 'Avg Kills', color: '#7dd3fc', fmt: v => v.toFixed(2)            },
  { key: 'avgDamage',    label: 'Avg DMG',   color: '#86efac', fmt: v => Math.round(v).toString() },
  { key: 'winRate',      label: 'Win %',     color: '#c084fc', fmt: v => v.toFixed(1) + '%'      },
  { key: 'headshotRate', label: 'HS %',      color: '#f87171', fmt: v => v.toFixed(1) + '%'      },
];

function aggregateSeasonStats(stats) {
  const buckets = [];
  for (const persp of ['fpp', 'tpp']) {
    for (const mode of ['solo', 'duo', 'squad']) {
      buckets.push(stats?.[persp]?.[mode] || {});
    }
  }
  const sum = (k) => buckets.reduce((acc, s) => acc + (s[k] || 0), 0);
  const rounds = sum('roundsPlayed');
  const kills = sum('kills') - sum('teamKills');
  const losses = sum('losses');
  const wins = sum('wins');
  const damageDealt = sum('damageDealt');
  const headshotKills = sum('headshotKills');
  return {
    rounds,
    kd: losses ? kills / losses : 0,
    avgKills: rounds ? kills / rounds : 0,
    avgDamage: rounds ? damageDealt / rounds : 0,
    winRate: rounds ? (wins / rounds) * 100 : 0,
    headshotRate: kills ? (headshotKills / kills) * 100 : 0,
  };
}

const CAREER_MIN_MATCHES = 20;
const CAREER_SCAN_LIMIT  = 20;
const CAREER_TARGET      = 20;

async function loadCareerData(playerName) {
  careerData = null;
  careerLoading = true;
  renderCareerChart();
  try {
    const r = await fetch(`/api/player/${encodeURIComponent(playerName)}/career?platform=${currentPlatform}&limit=${CAREER_SCAN_LIMIT}`);
    const data = await r.json();
    careerLoading = false;

    const aggregated = (data.seasons || []).map(s => ({
      seasonId: s.seasonId,
      n: parseInt(s.seasonId.split('-').pop(), 10),
      isCurrent: s.isCurrent,
      agg: aggregateSeasonStats(s.stats),
    }));

    // Take the up-to-CAREER_TARGET most recent seasons that meet the minimum,
    // then re-sort oldest → newest so the chart plots left-to-right.
    const newestFirst = [...aggregated].sort((a, b) => b.n - a.n);
    const qualifying = newestFirst
      .filter(s => s.agg.rounds >= CAREER_MIN_MATCHES)
      .slice(0, CAREER_TARGET)
      .sort((a, b) => a.n - b.n);

    careerData = {
      seasons: qualifying,
      scanned: aggregated.length,
      minMatches: CAREER_MIN_MATCHES,
    };
    renderCareerChart();
  } catch (e) {
    console.error('career fetch failed', e);
    careerLoading = false;
    careerData = { seasons: [], scanned: 0, minMatches: CAREER_MIN_MATCHES };
    renderCareerChart();
  }
}

function renderCareerChart() {
  const c = document.getElementById('career-chart-area');
  if (!c) return;
  if (careerLoading) {
    c.innerHTML = `
      <div class="career-section">
        <div class="career-header">
          <h2 class="match-section-title">Across seasons <span class="match-section-count">loading…</span></h2>
        </div>
        <div class="career-skeleton skel"></div>
      </div>`;
    return;
  }
  if (!careerData) { c.innerHTML = ''; return; }

  // Zero qualifying seasons → big message
  if (careerData.seasons.length === 0) {
    c.innerHTML = `
      <div class="career-section">
        <div class="career-empty">
          <div class="career-empty-label">NOT ENOUGH DATA</div>
          <div class="career-empty-message">
            Career trends need at least <strong>${careerData.minMatches} matches</strong> in a season.
            ${careerData.scanned > 0
              ? `Scanned the last ${careerData.scanned} seasons — none reached that.`
              : 'No season data found for this player.'}
          </div>
        </div>
      </div>`;
    return;
  }

  c.innerHTML = renderCareerHTML();
  bindCareerLegend();
}

function renderCareerHTML() {
  const seasons = careerData.seasons;
  const W = 800, H = 280;
  const padL = 16, padR = 16, padT = 24, padB = 56;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xAt = i => seasons.length === 1
    ? padL + innerW / 2
    : padL + (i / (seasons.length - 1)) * innerW;

  // Per-stat min/max for normalization (each line uses its own scale)
  const ranges = {};
  CAREER_METRICS.forEach(m => {
    const vals = seasons.map(s => s.agg[m.key]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    ranges[m.key] = { min, max, span: Math.max(0.0001, max - min) };
  });

  const yAt = (val, range) => {
    const norm = (val - range.min) / range.span;  // 0..1
    return padT + innerH - norm * innerH;          // 0 at top
  };

  // Background grid
  const gridLines = [0.25, 0.5, 0.75].map(p => {
    const y = padT + innerH * p;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--divider)" stroke-width="0.5" stroke-dasharray="2 4" />`;
  }).join('');

  // Per-metric polyline + dots
  const lines = CAREER_METRICS.map(m => {
    if (!careerVisible[m.key]) return '';
    const r = ranges[m.key];
    const pts = seasons.map((s, i) => `${xAt(i)},${yAt(s.agg[m.key], r)}`).join(' ');
    const dots = seasons.map((s, i) =>
      `<circle data-key="${m.key}" data-idx="${i}" cx="${xAt(i)}" cy="${yAt(s.agg[m.key], r)}" r="3.5" fill="${m.color}" stroke="var(--bg)" stroke-width="1.5" />`
    ).join('');
    return `
      <polyline points="${pts}" fill="none" stroke="${m.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" />
      ${dots}`;
  }).join('');

  // X-axis labels
  const xLabels = seasons.map((s, i) =>
    `<text x="${xAt(i)}" y="${H - 32}" text-anchor="middle" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="10.5">S${s.n}</text>` +
    (s.isCurrent ? `<text x="${xAt(i)}" y="${H - 18}" text-anchor="middle" fill="var(--accent)" font-family="JetBrains Mono, monospace" font-size="9" letter-spacing="0.06em">CURRENT</text>` : '')
  ).join('');

  // Cursor line + per-season hover hit areas
  const cursor = `<line id="career-cursor" x1="0" y1="${padT}" x2="0" y2="${padT + innerH}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />`;
  const hoverRects = seasons.map((s, i) => {
    const x0 = i === 0 ? padL : (xAt(i - 1) + xAt(i)) / 2;
    const x1 = i === seasons.length - 1 ? W - padR : (xAt(i) + xAt(i + 1)) / 2;
    return `<rect class="career-hover-rect" data-idx="${i}" x="${x0}" y="${padT}" width="${x1 - x0}" height="${innerH + 12}" fill="transparent" />`;
  }).join('');

  // Legend
  const cur = seasons[seasons.length - 1];
  const legend = CAREER_METRICS.map(m => {
    const visible = careerVisible[m.key];
    return `
      <button class="career-legend-chip${visible ? '' : ' off'}" data-key="${m.key}" type="button" title="Toggle ${m.label}">
        <span class="legend-dot" style="background:${m.color}"></span>
        <span class="legend-label">${m.label}</span>
        <span class="legend-value">${m.fmt(cur.agg[m.key])}</span>
      </button>`;
  }).join('');

  return `
    <div class="career-section">
      <div class="career-header">
        <div>
          <h2 class="match-section-title">
            Across seasons
            <span class="match-section-count">${seasons.length} season${seasons.length === 1 ? '' : 's'}</span>
            <span class="career-min-note" title="Seasons under ${careerData.minMatches} matches are skipped to keep averages meaningful">· min ${careerData.minMatches} matches</span>
          </h2>
          <div class="career-section-label" data-default="Latest: Season ${cur.n} · ${cur.agg.rounds} matches">Latest: Season ${cur.n} · ${cur.agg.rounds} matches</div>
        </div>
        <div class="career-legend">${legend}</div>
      </div>
      <div class="career-chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" id="career-svg">
          ${gridLines}
          ${lines}
          ${xLabels}
          ${cursor}
          ${hoverRects}
        </svg>
      </div>
    </div>`;
}

function bindCareerLegend() {
  document.querySelectorAll('.career-legend-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.key;
      careerVisible[key] = !careerVisible[key];
      // Don't allow all-off — re-enable the just-clicked one
      if (Object.values(careerVisible).every(v => !v)) careerVisible[key] = true;
      renderCareerChart();
    });
  });
  document.querySelectorAll('#career-svg .career-hover-rect').forEach(r => {
    r.addEventListener('mouseenter', () => updateCareerHover(parseInt(r.dataset.idx, 10)));
    r.addEventListener('mouseleave', () => updateCareerHover(null));
  });
}

function updateCareerHover(idx) {
  if (!careerData) return;
  const seasons = careerData.seasons;
  const target = idx == null ? seasons[seasons.length - 1] : seasons[idx];
  if (!target) return;

  document.querySelectorAll('.career-legend-chip').forEach(chip => {
    const key = chip.dataset.key;
    const m = CAREER_METRICS.find(mm => mm.key === key);
    const v = chip.querySelector('.legend-value');
    if (v) v.textContent = m.fmt(target.agg[key]);
  });

  const lbl = document.querySelector('.career-section-label');
  if (lbl) {
    lbl.textContent = idx == null
      ? lbl.dataset.default
      : `Season ${target.n}${target.isCurrent ? ' · current' : ''} · ${target.agg.rounds} matches`;
  }

  const cursor = document.getElementById('career-cursor');
  if (cursor) {
    if (idx == null) { cursor.setAttribute('opacity', '0'); return; }
    const W = 800, padL = 16, padR = 16;
    const innerW = W - padL - padR;
    const x = seasons.length === 1 ? padL + innerW / 2 : padL + (idx / (seasons.length - 1)) * innerW;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
    cursor.setAttribute('opacity', '1');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Match list
// ─────────────────────────────────────────────────────────────────────────────
let filterPanelOpen = false;

function getFilteredMatches() {
  return allMatches.filter(m => {
    const attr = m.data.attributes;
    const mapName = translateMapName(attr.mapName);
    if (mapFilter.size > 0 && !mapFilter.has(mapName)) return false;
    const gm = (attr.gameMode || '').toLowerCase();
    const isFpp = gm.includes('fpp');
    const isRanked = attr.matchType === 'competitive';
    if (perspectiveFilter === 'fpp' && !isFpp) return false;
    if (perspectiveFilter === 'tpp' && isFpp) return false;
    if (perspectiveFilter === 'ranked' && !isRanked) return false;
    if (perspectiveFilter === 'normal' && isRanked) return false;
    return true;
  });
}

function getUniqueMaps() {
  const set = new Set();
  allMatches.forEach(m => set.add(translateMapName(m.data.attributes.mapName)));
  return [...set].sort();
}

function perspectiveLabel() {
  return ({
    all:    'All modes',
    fpp:    'FPP only',
    tpp:    'TPP only',
    ranked: 'Ranked',
    normal: 'Normal',
  })[perspectiveFilter];
}

function cyclePerspective() {
  const order = ['all', 'fpp', 'tpp', 'ranked', 'normal'];
  perspectiveFilter = order[(order.indexOf(perspectiveFilter) + 1) % order.length];
  renderMatchList();
}

function renderMatchList() {
  currentIndex = 0;
  const container = document.getElementById('match-list-area');
  if (!allMatches.length) { container.innerHTML = ''; return; }
  appendMatches(container, true);
}

function appendMatches(container, reset = false) {
  const filtered = getFilteredMatches();
  const nextBatch = filtered.slice(currentIndex, currentIndex + MATCHES_PER_PAGE);
  currentIndex += nextBatch.length;

  if (reset) {
    const rows = filtered.slice(0, currentIndex).map(m => buildMatchRow(m)).filter(Boolean).join('');
    container.innerHTML = `
      <div class="match-section-header">
        <h2 class="match-section-title">Last matches <span class="match-section-count" id="match-count">${currentIndex}/${filtered.length}${filtered.length !== allMatches.length ? ` <span class="match-section-filtered">(of ${allMatches.length})</span>` : ''}</span></h2>
        <div class="match-section-actions">
          <button id="btn-filter" class="pi-btn subtle${mapFilter.size > 0 ? ' active' : ''}" type="button">${Icon.filter(13)} Filter${mapFilter.size > 0 ? ` · ${mapFilter.size}` : ''}</button>
          <button id="btn-mode" class="pi-btn subtle${perspectiveFilter !== 'all' ? ' active' : ''}" type="button">${perspectiveLabel()}</button>
        </div>
      </div>
      ${filterPanelOpen ? renderFilterPanel() : ''}
      <div class="match-list-new" id="match-list-inner">${rows || '<div class="match-empty-filter">No matches match the current filter.</div>'}</div>
      ${currentIndex < filtered.length ? `<div class="load-more-wrap"><button id="load-more-btn" class="pi-btn ghost">Load more ${Icon.chevronD(14)}</button></div>` : ''}`;
    bindMatchRows(container);
    document.getElementById('load-more-btn')?.addEventListener('click', () => appendMatches(container, false));
    document.getElementById('btn-filter')?.addEventListener('click', () => {
      filterPanelOpen = !filterPanelOpen;
      renderMatchList();
    });
    document.getElementById('btn-mode')?.addEventListener('click', cyclePerspective);
    if (filterPanelOpen) bindFilterPanel();
  } else {
    const list = container.querySelector('#match-list-inner');
    nextBatch.forEach(m => { const r = buildMatchRow(m); if(r){ const div=document.createElement('div'); div.innerHTML=r; const btn=div.firstElementChild; list.appendChild(btn); bindRow(btn); } });
    const cnt = container.querySelector('#match-count');
    if (cnt) {
      cnt.innerHTML = `${currentIndex}/${filtered.length}${filtered.length !== allMatches.length ? ` <span class="match-section-filtered">(of ${allMatches.length})</span>` : ''}`;
    }
    if (currentIndex >= filtered.length) container.querySelector('.load-more-wrap')?.remove();
  }
}

function renderFilterPanel() {
  const maps = getUniqueMaps();
  const chips = maps.map(m => `
    <button class="pi-chip filter-map-chip${mapFilter.has(m) ? ' active' : ''}" data-map="${escapeAttr(m)}" type="button">${m}</button>`
  ).join('');
  return `
    <div class="filter-panel">
      <div class="filter-panel-row">
        <span class="micro filter-panel-label">MAPS</span>
        <div class="filter-panel-chips">${chips}</div>
        ${mapFilter.size > 0 ? '<button id="btn-clear-maps" class="pi-btn subtle" type="button">Clear</button>' : ''}
      </div>
    </div>`;
}

function bindFilterPanel() {
  document.querySelectorAll('.filter-map-chip').forEach(c => {
    c.addEventListener('click', () => {
      const m = c.dataset.map;
      if (mapFilter.has(m)) mapFilter.delete(m); else mapFilter.add(m);
      renderMatchList();
    });
  });
  document.getElementById('btn-clear-maps')?.addEventListener('click', () => {
    mapFilter.clear();
    renderMatchList();
  });
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

  // Find teammates via roster (includes searched player)
  const rosters = matchData.included.filter(i => i.type === 'roster');
  const myRoster = rosters.find(r =>
    r.relationships?.participants?.data?.some(pd => {
      const p = matchData.included.find(i => i.id === pd.id && i.type === 'participant');
      return p?.attributes?.stats?.name === currentPlayerName;
    })
  );
  const teamParticipants = myRoster
    ? myRoster.relationships.participants.data
        .map(pd => matchData.included.find(i => i.id === pd.id && i.type === 'participant'))
        .filter(Boolean)
        .sort((a, b) => (b.attributes.stats.damageDealt || 0) - (a.attributes.stats.damageDealt || 0))
    : [participant];

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
        ${teamParticipants.map(p => {
          const ts = p.attributes.stats;
          const isSelf = ts.name === currentPlayerName;
          return `
          <div class="drawer-teammate${isSelf ? ' self' : ''}">
            <div class="drawer-teammate-badge ${isSelf ? 'self' : 'other'}">${isSelf ? '★' : '·'}</div>
            <a class="drawer-teammate-name" href="${escapeAttr(buildPlayerLinkFor(ts.name))}" target="_blank" rel="noopener noreferrer" title="Open ${escapeAttr(ts.name)} in a new tab">${ts.name}</a>
            <span class="drawer-teammate-kills">${ts.kills}K · ${Math.round(ts.damageDealt)} DMG</span>
          </div>`;
        }).join('')}
      </div>

      <div class="micro drawer-section-label">DETAILS</div>
      <div class="drawer-detail-list">
        ${drawerDetailRows(participant.attributes.stats, attr.duration).map(([label, value]) => `
          <div class="drawer-detail-row">
            <span class="drawer-detail-label">${label}</span>
            <span class="drawer-detail-value">${value}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="drawer-footer">
      <button id="btn-share-match" class="pi-btn ghost" type="button">${Icon.share(14)} Share</button>
      <div style="flex:1"></div>
      <button class="pi-btn primary" id="open-replay-btn" type="button">${Icon.play(12)} Open 2D replay</button>
    </div>`;

  document.getElementById('drawer-close-btn').addEventListener('click', closeDrawer);
  document.getElementById('btn-share-match').addEventListener('click', () => copyToClipboard(buildMatchShareUrl(matchData.data.id)));
  document.getElementById('open-replay-btn').addEventListener('click', () => {
    window.globalMatchData = matchData;
    showModal(matchData);
  });
}

function drawerDetailRows(s, matchDuration) {
  // walk/ride/swim distances are in METERS (per PUBG API docs)
  const distM = (s.walkDistance || 0) + (s.rideDistance || 0) + (s.swimDistance || 0);
  const distLabel = distM >= 1000
    ? (distM / 1000).toFixed(2) + ' km'
    : Math.round(distM) + ' m';
  return [
    ['Headshots',      s.headshotKills ?? 0],
    ['Knocks',         s.DBNOs ?? 0],
    ['Weapons picked', s.weaponsAcquired ?? 0],
    ['Distance',       distLabel],
    ['Match length',   formatTime(matchDuration || 0)],
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Search / fetch
// ─────────────────────────────────────────────────────────────────────────────
async function doSearch(opts = {}) {
  const name = opts.name || getQuery();
  const seasonId = opts.seasonId || getCurrentSeason();
  if (!name) return;

  currentPlayerName = name;
  mapFilter.clear();
  perspectiveFilter = 'all';
  filterPanelOpen = false;
  recentSearches = [name, ...recentSearches.filter(n => n !== name)].slice(0, 6);
  try { localStorage.setItem('pi_recents', JSON.stringify(recentSearches)); } catch(e) {}

  showLoading();
  renderHeader(name, seasonId);

  try {
    const [statsRes, matchesRes] = await Promise.all([
      fetch(`/api/player/${encodeURIComponent(name)}?season=${encodeURIComponent(seasonId)}&platform=${currentPlatform}`),
      fetch(`/api/player/${encodeURIComponent(name)}/matches?platform=${currentPlatform}`),
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

    // Reflect search in URL (without reloading)
    const url = new URL(window.location.href);
    url.searchParams.set('p', name);
    if (seasonId) url.searchParams.set('s', seasonId);
    if (!opts.matchId) url.searchParams.delete('m');
    window.history.replaceState({}, '', url.toString());

    if (opts.matchId) {
      const match = allMatches.find(m => m.data.id === opts.matchId);
      if (match) openDrawer(match);
    }
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
// Popovers (History / Saved)
// ─────────────────────────────────────────────────────────────────────────────
function closeAllPopovers() {
  document.querySelectorAll('.pi-popover').forEach(p => p.remove());
}

function togglePlayerListPopover(anchorId, title, items, onRemove) {
  const existing = document.querySelector(`.pi-popover[data-anchor="${anchorId}"]`);
  closeAllPopovers();
  if (existing) return;

  const anchor = document.getElementById(anchorId);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();

  const pop = document.createElement('div');
  pop.className = 'pi-popover';
  pop.dataset.anchor = anchorId;
  pop.style.top = `${rect.bottom + 6 + window.scrollY}px`;
  pop.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;

  const list = items.length === 0
    ? `<div class="pi-popover-empty">No ${title.toLowerCase()} yet</div>`
    : items.map(name => `
        <div class="pi-popover-row" data-name="${escapeAttr(name)}">
          <button class="pi-popover-pick" type="button">${Icon.search(12)} ${name}</button>
          <button class="pi-popover-remove" type="button" title="Remove">${Icon.x(12)}</button>
        </div>`).join('');

  pop.innerHTML = `
    <div class="pi-popover-title">${title}</div>
    <div class="pi-popover-body">${list}</div>`;

  document.body.appendChild(pop);

  pop.querySelectorAll('.pi-popover-row').forEach(row => {
    const name = row.dataset.name;
    row.querySelector('.pi-popover-pick').addEventListener('click', () => {
      closeAllPopovers();
      const inp = document.getElementById('header-player-name');
      if (inp) inp.value = name;
      doSearch();
    });
    row.querySelector('.pi-popover-remove').addEventListener('click', e => {
      e.stopPropagation();
      onRemove?.(name);
      // Re-render this popover with updated items
      const updated = anchorId === 'btn-history' ? recentSearches : savedPlayers;
      togglePlayerListPopover(anchorId, title, updated, onRemove);
    });
  });

  setTimeout(() => {
    const handler = (e) => {
      if (!pop.contains(e.target) && e.target.id !== anchorId) {
        closeAllPopovers();
        document.removeEventListener('click', handler);
      }
    };
    document.addEventListener('click', handler);
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Save / Share
// ─────────────────────────────────────────────────────────────────────────────
function isSaved(name) { return savedPlayers.includes(name); }

function toggleSavePlayer(name) {
  if (isSaved(name)) savedPlayers = savedPlayers.filter(x => x !== name);
  else savedPlayers = [name, ...savedPlayers].slice(0, 50);
  try { localStorage.setItem('pi_saved', JSON.stringify(savedPlayers)); } catch (_) {}
  updateSaveButtonState();
}

function updateSaveButtonState() {
  const btn = document.getElementById('btn-save-player');
  if (!btn) return;
  const active = isSaved(currentPlayerName);
  btn.classList.toggle('active', active);
  btn.innerHTML = `${Icon.star(14)} ${active ? 'Saved' : 'Save'}`;
}

function buildPlayerShareUrl() {
  return buildPlayerLinkFor(currentPlayerName);
}

function buildPlayerLinkFor(name) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('p', name);
  const season = getCurrentSeason();
  if (season) url.searchParams.set('s', season);
  url.searchParams.set('platform', currentPlatform);
  return url.toString();
}

function buildMatchShareUrl(matchId) {
  const url = new URL(buildPlayerShareUrl());
  url.searchParams.set('m', matchId);
  return url.toString();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied to clipboard');
  } catch (_) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Link copied to clipboard'); }
    catch (_) { toast('Could not copy'); }
    ta.remove();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
function toast(message) {
  let el = document.getElementById('pi-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pi-toast';
    el.className = 'pi-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDrawer(); closeAllPopovers(); }
});

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
        <div id="career-chart-area"></div>
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
    // Honor ?platform= from URL before loading seasons (so deep links to other platforms work)
    const params = new URLSearchParams(window.location.search);
    const linkedPlatform = params.get('platform');
    if (linkedPlatform && PLATFORMS.some(p => p.value === linkedPlatform)) {
      currentPlatform = linkedPlatform;
      try { localStorage.setItem('pi_platform', linkedPlatform); } catch (_) {}
    }

    await loadSeasonsForCurrentPlatform();

    const defaultSeason = allSeasons.find(s => s.attributes.isCurrentSeason)?.id || '';
    renderHeader('', defaultSeason);

    // Deep link: ?p=<name>&s=<season>&m=<matchId>&platform=<platform>
    const linkedPlayer = params.get('p');
    if (linkedPlayer) {
      const linkedSeason = params.get('s') || defaultSeason;
      const linkedMatch = params.get('m') || null;
      doSearch({ name: linkedPlayer, seasonId: linkedSeason, matchId: linkedMatch });
    } else {
      showLanding();
    }
  } catch (err) {
    console.error(err);
    alert('Failed to load seasons.');
  }
}

init();
