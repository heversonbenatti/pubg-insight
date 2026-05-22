import { showModal } from './modal.js';
import { translateMapName, isPlayableMatch } from './utils.js';
import { renderWeaponStatsPage } from './weaponStats.js';
import { renderInsightsPage, renderInsightsLoading } from './insights.js';

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
  refresh:  (s=16) => svg('M20 11a8 8 0 1 0 -2.3 5.7M20 5v6h-6', {size:s}),
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
let matchTelemetry = {};   // matchId → tem telemetria cacheada (replay disponível)
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
let rankedFppStats = {}, rankedTppStats = {};
let activeStatsView = 'normal';
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
    <button id="header-back-player" class="pi-btn ghost" type="button" style="display:none"></button>
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
        <button id="btn-leaderboard" class="pi-btn subtle" type="button">${Icon.target(14)} Leaderboard</button>
      </div>
      <div class="pi-popover-host">
        <button id="btn-weapons" class="pi-btn subtle" type="button">${Icon.target(14)} Weapons</button>
      </div>
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
  document.getElementById('header-back-player')?.addEventListener('click', () => goBackToPlayer());
  document.getElementById('header-platform-select')?.addEventListener('change', e => changePlatform(e.target.value));
  document.getElementById('btn-weapons')?.addEventListener('click', e => {
    e.preventDefault();
    showWeaponStatsPage();
  });
  document.getElementById('btn-leaderboard')?.addEventListener('click', e => {
    e.preventDefault();
    showLeaderboardPage();
  });
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

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
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
  const header = document.getElementById('header-season-select');
  const landing = document.getElementById('landing-season-select');
  const landingVisible = document.getElementById('landing-wrap')?.style.display !== 'none';
  const headerVisible = document.getElementById('pi-header')?.style.display !== 'none';
  if (landingVisible && landing) return landing.value;
  if (headerVisible && header) return header.value;
  return header?.value || landing?.value || (allSeasons.find(s => s.attributes.isCurrentSeason)?.id ?? '');
}

function getQuery() {
  const header = document.getElementById('header-player-name');
  const landing = document.getElementById('landing-player-name');
  const active = document.activeElement;
  if (active === landing || active === header) return active.value.trim();

  const landingVisible = document.getElementById('landing-wrap')?.style.display !== 'none';
  const headerVisible = document.getElementById('pi-header')?.style.display !== 'none';
  if (landingVisible && landing) return landing.value.trim();
  if (headerVisible && header) return header.value.trim();

  return (header?.value || landing?.value || '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Landing
// ─────────────────────────────────────────────────────────────────────────────
function showLanding() {
  document.getElementById('landing-wrap').style.display = '';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('weapon-stats-page').style.display = 'none';
  document.getElementById('leaderboard-page').style.display = 'none';
  document.getElementById('insights-page').style.display = 'none';
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

    <div class="landing-nav">
      <button id="landing-nav-leaderboard" class="pi-btn ghost" type="button">${Icon.target(14)} Leaderboard</button>
      <button id="landing-nav-weapons" class="pi-btn ghost" type="button">${Icon.target(14)} Weapons</button>
      <div class="pi-popover-host">
        <button id="landing-nav-history" class="pi-btn ghost" type="button">${Icon.clock(14)} History</button>
      </div>
      <div class="pi-popover-host">
        <button id="landing-nav-saved" class="pi-btn ghost" type="button">${Icon.star(14)} Saved</button>
      </div>
    </div>

    <div class="landing-recents">
      <span class="micro" style="color:var(--text-faint)">RECENT</span>
      ${recentHTML || '<span style="color:var(--text-faint);font-size:12px">No recent searches</span>'}
    </div>`;

  populateSeasonSelect('landing-season-select');
  document.getElementById('landing-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
  document.getElementById('landing-platform-select')?.addEventListener('change', e => changePlatform(e.target.value));
  document.getElementById('landing-nav-leaderboard')?.addEventListener('click', () => showLeaderboardPage());
  document.getElementById('landing-nav-weapons')?.addEventListener('click', () => showWeaponStatsPage());
  document.getElementById('landing-nav-history')?.addEventListener('click', e => {
    e.stopPropagation();
    togglePlayerListPopover('landing-nav-history', 'History', recentSearches, name => {
      recentSearches = recentSearches.filter(x => x !== name);
      try { localStorage.setItem('pi_recents', JSON.stringify(recentSearches)); } catch(_) {}
    });
  });
  document.getElementById('landing-nav-saved')?.addEventListener('click', e => {
    e.stopPropagation();
    togglePlayerListPopover('landing-nav-saved', 'Saved', savedPlayers, name => {
      savedPlayers = savedPlayers.filter(x => x !== name);
      try { localStorage.setItem('pi_saved', JSON.stringify(savedPlayers)); } catch(_) {}
    });
  });
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
  document.getElementById('weapon-stats-page').style.display = 'none';
  document.getElementById('leaderboard-page').style.display = 'none';
  document.getElementById('insights-page').style.display = 'none';
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
  document.getElementById('weapon-stats-page').style.display = 'none';
  document.getElementById('leaderboard-page').style.display = 'none';
  document.getElementById('insights-page').style.display = 'none';
  document.getElementById('pi-header').style.display = 'flex';
  setHeaderBackButton(null); // estamos no player → sem botão voltar
  renderPlayerHeader(playerName, seasonId);
  renderModeTabs();
  renderStatsView();
  renderMatchList();
}

function showWeaponStatsPage() {
  document.getElementById('landing-wrap').style.display = 'none';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('weapon-stats-page').style.display = 'block';
  document.getElementById('leaderboard-page').style.display = 'none';
  document.getElementById('insights-page').style.display = 'none';
  document.getElementById('pi-header').style.display = 'flex';
  renderHeader(getQuery(), getCurrentSeason());
  setHeaderBackButton(currentPlayerName);
  closeDrawer();
  closeAllPopovers();
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view', 'weapons');
  window.history.replaceState({}, '', url.toString());
  renderWeaponStatsPage(document.getElementById('weapon-stats-page'));
}

// `defer: true` mostra só a tela "Gerando insights…" (sem fetch) — usado pra dar
// feedback imediato no clique em Insights enquanto o refresh ainda roda. Sem
// defer, busca e renderiza os insights (cache-first).
function showInsightsPage(playerName, { defer = false } = {}) {
  if (!playerName) { toast('Procure um jogador primeiro'); return; }
  document.getElementById('landing-wrap').style.display = 'none';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('weapon-stats-page').style.display = 'none';
  document.getElementById('leaderboard-page').style.display = 'none';
  document.getElementById('insights-page').style.display = 'none';
  document.getElementById('insights-page').style.display = 'block';
  document.getElementById('pi-header').style.display = 'flex';
  renderHeader(playerName, getCurrentSeason());
  closeDrawer();
  closeAllPopovers();
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view', 'insights');
  url.searchParams.set('p', playerName);
  url.searchParams.set('platform', currentPlatform);
  window.history.replaceState({}, '', url.toString());

  const onBack = () => {
    // Se já temos os dados do player carregados, só troca de página; senão refaz a busca.
    if (currentPlayerName === playerName && allMatches.length) {
      showPlayerPage(playerName, getCurrentSeason());
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      window.history.replaceState({}, '', url.toString());
    } else {
      doSearch({ name: playerName, seasonId: getCurrentSeason() });
    }
  };

  const container = document.getElementById('insights-page');
  if (defer) { renderInsightsLoading(container, { playerName, onBack }); return; }
  // View puro: cache-first. O refresh (e a invalidação do cache de insights) é
  // feito antes por refreshAll() quando você clica em Insights com cooldown livre.
  renderInsightsPage(container, {
    playerName,
    platform: currentPlatform,
    onBack,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard page
// ─────────────────────────────────────────────────────────────────────────────
const LEADERBOARD_REGIONS = [
  { value: 'pc-sa',    label: 'PC · South America' },
  { value: 'pc-na',    label: 'PC · North America' },
  { value: 'pc-eu',    label: 'PC · Europe'        },
  { value: 'pc-as',    label: 'PC · Asia'          },
  { value: 'pc-sea',   label: 'PC · SE Asia'       },
  { value: 'pc-oc',    label: 'PC · Oceania'       },
  { value: 'pc-jp',    label: 'PC · Japan'         },
  { value: 'pc-krjp',  label: 'PC · Korea/Japan'   },
  { value: 'pc-kakao', label: 'PC · Kakao'         },
  { value: 'pc-ru',    label: 'PC · Russia'        },
  { value: 'psn-na',   label: 'PSN · North America'},
  { value: 'psn-eu',   label: 'PSN · Europe'       },
  { value: 'psn-as',   label: 'PSN · Asia'         },
  { value: 'psn-oc',   label: 'PSN · Oceania'      },
  { value: 'xbox-na',  label: 'Xbox · North America'},
  { value: 'xbox-eu',  label: 'Xbox · Europe'      },
  { value: 'xbox-as',  label: 'Xbox · Asia'        },
  { value: 'xbox-oc',  label: 'Xbox · Oceania'     },
  { value: 'xbox-sa',  label: 'Xbox · South America'},
];
const LEADERBOARD_MODES = [
  { value: 'squad-fpp', label: 'Squad FPP' },
  { value: 'squad',     label: 'Squad TPP' },
  { value: 'duo-fpp',   label: 'Duo FPP'   },
  { value: 'duo',       label: 'Duo TPP'   },
  { value: 'solo-fpp',  label: 'Solo FPP'  },
  { value: 'solo',      label: 'Solo TPP'  },
];
let leaderboardShard = 'pc-sa';
let leaderboardMode  = 'squad';
let leaderboardLimit = 100;
let leaderboardAvailableModes = LEADERBOARD_MODES;
let leaderboardViewSeq = 0;
try {
  const sv = localStorage.getItem('pi_lb_shard'); if (sv && LEADERBOARD_REGIONS.some(r => r.value === sv)) leaderboardShard = sv;
  const mv = localStorage.getItem('pi_lb_mode');  if (mv && LEADERBOARD_MODES.some(m => m.value === mv))   leaderboardMode  = mv;
} catch (_) {}

async function showLeaderboardPage() {
  const seq = ++leaderboardViewSeq;
  document.getElementById('landing-wrap').style.display = 'none';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('weapon-stats-page').style.display = 'none';
  document.getElementById('leaderboard-page').style.display = 'block';
  document.getElementById('pi-header').style.display = 'flex';
  renderHeader(getQuery(), getCurrentSeason());
  setHeaderBackButton(currentPlayerName);
  closeDrawer();
  closeAllPopovers();

  updateLeaderboardUrl();
  renderLeaderboardShell({ modesLoading: true });
  await loadLeaderboardModes(seq);
  if (seq !== leaderboardViewSeq) return;
  renderLeaderboardShell();
  updateLeaderboardUrl();
  loadLeaderboard(seq);
}

function updateLeaderboardUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view', 'leaderboard');
  url.searchParams.set('shard', leaderboardShard);
  url.searchParams.set('mode', leaderboardMode);
  window.history.replaceState({}, '', url.toString());
}

async function loadLeaderboardModes(seq) {
  const seasonId = getCurrentSeason();
  if (!seasonId) {
    leaderboardAvailableModes = [];
    return;
  }

  try {
    const r = await fetch(`/api/leaderboard/modes?shard=${encodeURIComponent(leaderboardShard)}&season=${encodeURIComponent(seasonId)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to load leaderboard modes');
    if (seq !== leaderboardViewSeq) return;

    const validModeValues = new Set(LEADERBOARD_MODES.map(m => m.value));
    const modes = Array.isArray(data.modes)
      ? data.modes.filter(m => m && validModeValues.has(m.value))
      : [];
    leaderboardAvailableModes = modes.length ? modes : [];
  } catch (err) {
    if (seq !== leaderboardViewSeq) return;
    console.error(err);
    leaderboardAvailableModes = LEADERBOARD_MODES;
  }

  if (leaderboardAvailableModes.length && !leaderboardAvailableModes.some(m => m.value === leaderboardMode)) {
    leaderboardMode = leaderboardAvailableModes[0].value;
    try { localStorage.setItem('pi_lb_mode', leaderboardMode); } catch(_){}
  }
}

function renderLeaderboardShell({ modesLoading = false } = {}) {
  const page = document.getElementById('leaderboard-page');
  const regionOpts = LEADERBOARD_REGIONS.map(r =>
    `<option value="${r.value}"${r.value === leaderboardShard ? ' selected' : ''}>${escapeText(r.label)}</option>`).join('');
  const modeControl = renderLeaderboardModeControl(modesLoading);

  page.innerHTML = `
    <div class="leaderboard-content">
      <div class="leaderboard-header">
        <h1 class="leaderboard-title">Leaderboard</h1>
        <div class="leaderboard-subtitle">Top 500 ranked players · current season · updated every 2h</div>
      </div>
      <div class="leaderboard-controls">
        <label class="lb-control">
          <span class="lb-label">Region</span>
          <div class="pi-season-wrap">
            <select id="lb-shard-select" class="pi-season-select">${regionOpts}</select>
            <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
          </div>
        </label>
        ${modeControl}
      </div>
      <div id="leaderboard-list-area"></div>
    </div>`;

  document.getElementById('lb-shard-select').addEventListener('change', e => {
    leaderboardShard = e.target.value;
    leaderboardLimit = 100;
    try { localStorage.setItem('pi_lb_shard', leaderboardShard); } catch(_){}
    showLeaderboardPage(); // re-render to update URL + re-fetch
  });
  document.getElementById('lb-mode-select')?.addEventListener('change', e => {
    leaderboardMode = e.target.value;
    leaderboardLimit = 100;
    try { localStorage.setItem('pi_lb_mode', leaderboardMode); } catch(_){}
    showLeaderboardPage();
  });
}

function renderLeaderboardModeControl(modesLoading) {
  if (modesLoading) {
    return `
        <label class="lb-control">
          <span class="lb-label">Mode</span>
          <div class="pi-season-wrap">
            <select class="pi-season-select" disabled><option>Checking modes...</option></select>
            <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
          </div>
        </label>`;
  }

  if (!leaderboardAvailableModes.length) {
    return `
        <label class="lb-control">
          <span class="lb-label">Mode</span>
          <div class="lb-static-value">No ranked modes</div>
        </label>`;
  }

  if (leaderboardAvailableModes.length === 1) {
    return `
        <label class="lb-control">
          <span class="lb-label">Mode</span>
          <div class="lb-static-value">${escapeText(leaderboardAvailableModes[0].label)}</div>
        </label>`;
  }

  const modeOpts = leaderboardAvailableModes.map(m =>
    `<option value="${escapeAttr(m.value)}"${m.value === leaderboardMode ? ' selected' : ''}>${escapeText(m.label)}</option>`).join('');
  return `
        <label class="lb-control">
          <span class="lb-label">Mode</span>
          <div class="pi-season-wrap">
            <select id="lb-mode-select" class="pi-season-select">${modeOpts}</select>
            <span class="pi-season-chevron">${Icon.chevronD(14)}</span>
          </div>
        </label>`;
}

async function loadLeaderboard(seq = leaderboardViewSeq) {
  const area = document.getElementById('leaderboard-list-area');
  if (!area) return;
  area.innerHTML = `<div class="leaderboard-loading">Loading top players...</div>`;
  const seasonId = getCurrentSeason();
  if (!seasonId) { area.innerHTML = `<div class="leaderboard-empty">No current season available.</div>`; return; }
  if (!leaderboardMode || !leaderboardAvailableModes.length) {
    area.innerHTML = `<div class="leaderboard-empty">No leaderboard data for this region & mode.</div>`;
    return;
  }
  const requestShard = leaderboardShard;
  const requestMode = leaderboardMode;
  try {
    const r = await fetch(`/api/leaderboard?shard=${encodeURIComponent(requestShard)}&season=${encodeURIComponent(seasonId)}&gameMode=${encodeURIComponent(requestMode)}`);
    const data = await r.json();
    if (seq !== leaderboardViewSeq || requestShard !== leaderboardShard || requestMode !== leaderboardMode) return;
    if (data.error || !Array.isArray(data.players) || !data.players.length) {
      area.innerHTML = `<div class="leaderboard-empty">No leaderboard data for this region & mode.</div>`;
      return;
    }
    renderLeaderboardList(data.players);
  } catch (err) {
    if (seq !== leaderboardViewSeq) return;
    console.error(err);
    area.innerHTML = `<div class="leaderboard-empty">Failed to load leaderboard.</div>`;
  }
}

function renderLeaderboardList(players) {
  const area = document.getElementById('leaderboard-list-area');
  const shown = players.slice(0, leaderboardLimit);

  // Plataforma usada quando abrir o player page (shard pc-sa → platform steam).
  const platformFromShard = leaderboardShard.startsWith('pc-') ? 'steam'
                          : leaderboardShard.startsWith('psn-') ? 'psn'
                          : leaderboardShard.startsWith('xbox-') ? 'xbox' : 'steam';

  const rows = shown.map(p => {
    // Leaderboard API devolve kda/killDeathRatio sempre 0 (deprecated); usa
    // averageKill (kills/game) que vem populado.
    const tierTxt = tierLabel(p.tier, p.subTier);
    return `
      <div class="lb-row" data-name="${escapeAttr(p.name)}" data-platform="${platformFromShard}">
        <div class="lb-rank">${p.rank}</div>
        <img class="lb-tier-img" src="${tierIconPath(p.tier, p.subTier)}" alt="" onerror="this.src='/pubg-api-assets/Assets/Icons/Insignias/Unranked.png'">
        <div class="lb-name-cell">
          <div class="lb-name">${p.name}</div>
          <div class="lb-tier">${tierTxt} · ${(p.rankPoints||0).toLocaleString()} RP</div>
        </div>
        <div class="lb-stat"><div class="lb-stat-label">AVG DMG</div><div class="lb-stat-value">${Math.round(p.averageDamage||0)}</div></div>
        <div class="lb-stat"><div class="lb-stat-label">AVG KILLS</div><div class="lb-stat-value">${(p.averageKill||0).toFixed(2)}</div></div>
        <div class="lb-stat"><div class="lb-stat-label">WIN %</div><div class="lb-stat-value">${(((p.winRatio||0))*100).toFixed(1)}%</div></div>
        <div class="lb-stat"><div class="lb-stat-label">WINS</div><div class="lb-stat-value">${p.wins||0}</div></div>
        <div class="lb-stat"><div class="lb-stat-label">GAMES</div><div class="lb-stat-value">${p.games||0}</div></div>
      </div>`;
  }).join('');

  const more = players.length > leaderboardLimit
    ? `<button id="lb-load-more" class="pi-btn ghost" type="button">Show next 100 (${leaderboardLimit + 1}–${Math.min(leaderboardLimit+100, players.length)})</button>`
    : '';

  area.innerHTML = `<div class="lb-list">${rows}</div><div class="lb-footer">${more}</div>`;

  document.querySelectorAll('.lb-row').forEach(row => {
    row.addEventListener('click', async () => {
      const name = row.dataset.name;
      const platform = row.dataset.platform;
      // changePlatform recarrega seasons; precisa esperar pra doSearch ter season válida
      if (platform && platform !== currentPlatform) await changePlatform(platform);
      doSearch({ name, seasonId: getCurrentSeason() });
    });
  });
  document.getElementById('lb-load-more')?.addEventListener('click', () => {
    leaderboardLimit += 100;
    renderLeaderboardList(players);
  });
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
      <button id="btn-refresh-player" class="pi-btn refresh" type="button">${Icon.refresh(14)} Atualizar</button>
      <button id="btn-insights-player" class="pi-btn ghost" type="button">${Icon.filter(14)} Insights</button>
      <button id="btn-save-player" class="pi-btn ghost" type="button">${Icon.star(14)} Save</button>
      <button id="btn-share-player" class="pi-btn ghost" type="button">${Icon.share(14)} Share</button>
    </div>`;
  document.getElementById('btn-refresh-player').addEventListener('click', () => refreshAll(currentPlayerName, { gotoInsights: false }));
  document.getElementById('btn-insights-player').addEventListener('click', () => refreshAll(currentPlayerName, { gotoInsights: true }));
  document.getElementById('btn-save-player').addEventListener('click', () => toggleSavePlayer(currentPlayerName));
  document.getElementById('btn-share-player').addEventListener('click', () => copyToClipboard(buildPlayerShareUrl()));
  updateSaveButtonState();
  updateRefreshButtonState();
}

// Botão "voltar pro jogador" no header (visível em weapons/leaderboard/insights
// quando há um jogador pesquisado). Centraliza a navegação de volta.
function setHeaderBackButton(name) {
  const btn = document.getElementById('header-back-player');
  if (!btn) return;
  if (name) {
    btn.style.display = '';
    btn.textContent = `← ${name}`;
  } else {
    btn.style.display = 'none';
  }
}
function goBackToPlayer() {
  const name = currentPlayerName;
  if (!name) { showLanding(); return; }
  if (allMatches.length) {
    showPlayerPage(name, getCurrentSeason());
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.replaceState({}, '', url.toString());
  } else {
    doSearch({ name, seasonId: getCurrentSeason() });
  }
}

// ── Refresh unificado (cooldown server-side é a fonte da verdade) ──────────────
// `refreshReadyAt` = timestamp absoluto em que o próximo refresh fica liberado,
// derivado do `refreshAvailableInMs` que o backend manda. O botão só reflete isso.
let refreshReadyAt = 0;
let _refreshTimer = null;
let _refreshing = false;

function setRefreshCooldownFromServer(availableInMs) {
  refreshReadyAt = Date.now() + (Number(availableInMs) || 0);
  updateRefreshButtonState();
}

function updateRefreshButtonState() {
  const btn = document.getElementById('btn-refresh-player');
  if (!btn) { if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; } return; }
  const remaining = Math.max(0, refreshReadyAt - Date.now());
  if (_refreshing) {
    btn.disabled = true;
    btn.classList.remove('refresh');
    btn.classList.add('refresh-cooldown');
    btn.innerHTML = `${Icon.clock(14)} Atualizando…`;
    return;
  }
  if (remaining > 0) {
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000);
    btn.disabled = true;
    btn.classList.remove('refresh');
    btn.classList.add('refresh-cooldown');
    btn.innerHTML = `${Icon.clock(14)} ${mm}:${ss < 10 ? '0' : ''}${ss}`;
    if (!_refreshTimer) _refreshTimer = setInterval(updateRefreshButtonState, 1000);
  } else {
    btn.disabled = false;
    btn.classList.add('refresh');
    btn.classList.remove('refresh-cooldown');
    btn.innerHTML = `${Icon.refresh(14)} Atualizar`;
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }
}

// Clicar em Atualizar OU em Insights chama isto. Pede o refresh atômico ao servidor
// (que decide pelo cooldown), depois recarrega tudo cache-first (já fresco) e mostra
// a página apropriada. O servidor é quem manda — o front só exibe o resultado.
async function refreshAll(name, { gotoInsights = false } = {}) {
  if (!name) return;
  if (_refreshing) return;
  _refreshing = true;
  updateRefreshButtonState();

  // Insights pode levar até ~1min (o refresh baixa telemetria + recomputa). Navega
  // pra tela "Gerando insights…" JÁ no clique, antes de qualquer await, pra dar
  // feedback imediato e evitar cliques repetidos achando que não respondeu.
  if (gotoInsights) showInsightsPage(name, { defer: true });

  const season = getCurrentSeason();
  let resp = null;
  try {
    const r = await fetch(`/api/player/${encodeURIComponent(name)}/refresh?platform=${currentPlatform}&season=${encodeURIComponent(season)}`);
    resp = await r.json();
  } catch (_) {
    toast('Falha ao atualizar');
  }
  _refreshing = false;

  if (resp?.refreshed) {
    toast('Atualizado agora');
  } else if (resp && typeof resp.availableInMs === 'number') {
    const m = Math.max(1, Math.ceil(resp.availableInMs / 60000));
    toast(`Já estava atualizado · libera em ${m} min`);
  }
  if (resp && typeof resp.availableInMs === 'number') setRefreshCooldownFromServer(resp.availableInMs);

  if (gotoInsights) {
    // Recarrega os dados do player em segundo plano (pro botão "← Back"), SEM
    // trocar a view — continuamos na tela de insights — depois renderiza os
    // insights frescos por cima do loading.
    await doSearch({ name, seasonId: season, silent: true });
    showInsightsPage(name);
  } else {
    // Recarrega e mostra a página do player (cache-first, agora fresco).
    await doSearch({ name, seasonId: season });
  }
}

function renderModeTabs() {
  const tabs = MODES.map(m => {
    const s = (m.perspKey === 'fpp' ? fppStats : tppStats)?.[m.statKey];
    const r = (m.perspKey === 'fpp' ? rankedFppStats : rankedTppStats)?.[m.statKey];
    const hasNormal = !!s?.roundsPlayed;
    const hasRanked = !!r?.roundsPlayed;
    const isEmpty = !hasNormal && !hasRanked;
    const isActive = m.key === activeMode;
    return `<button class="mode-tab${isActive ? ' active' : ''}${isEmpty ? ' empty' : ''}" data-mode="${m.key}">
      <span>${m.label}</span>
      <span class="mode-tab-persp">${m.persp}</span>
      ${hasRanked ? '<span class="mode-tab-ranked" title="Ranked data available">R</span>' : ''}
      ${isEmpty && !hasRanked ? '<span class="mode-tab-dot"></span>' : ''}
    </button>`;
  }).join('');
  document.getElementById('mode-tabs-area').innerHTML = `<div class="mode-tabs">${tabs}</div>`;
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeMode = btn.dataset.mode;
      renderModeTabs();
      renderStatsView();
    });
  });
}

function getActiveModeData() {
  const m = MODES.find(m => m.key === activeMode);
  if (!m) return null;
  const stats = m.perspKey === 'fpp' ? fppStats : tppStats;
  return stats?.[m.statKey] || null;
}

function getActiveModeRanked() {
  const m = MODES.find(m => m.key === activeMode);
  if (!m) return null;
  const ranked = m.perspKey === 'fpp' ? rankedFppStats : rankedTppStats;
  return ranked?.[m.statKey] || null;
}

function getActiveStatsAvailability() {
  const normal = getActiveModeData();
  const ranked = getActiveModeRanked();
  return {
    hasNormal: !!normal?.roundsPlayed,
    hasRanked: !!ranked?.roundsPlayed,
  };
}

function normalizeActiveStatsView() {
  const availability = getActiveStatsAvailability();
  if (activeStatsView === 'ranked' && !availability.hasRanked) activeStatsView = 'normal';
  if (activeStatsView === 'normal' && !availability.hasNormal && availability.hasRanked) activeStatsView = 'ranked';
  return availability;
}

function renderStatsView() {
  const availability = normalizeActiveStatsView();
  renderStatsViewToggle(availability);

  const rankedArea = document.getElementById('ranked-panel-area');
  const statsArea = document.getElementById('stats-grid-area');
  if (activeStatsView === 'ranked') {
    if (statsArea) statsArea.innerHTML = '';
    renderRankedPanel();
    return;
  }

  if (rankedArea) rankedArea.innerHTML = '';
  renderStatsGrid();
}

function renderStatsViewToggle({ hasNormal, hasRanked }) {
  const container = document.getElementById('stats-view-toggle-area');
  if (!container) return;
  if (!hasNormal || !hasRanked) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="stats-view-toggle" role="group" aria-label="Stats view">
      <button class="stats-view-option${activeStatsView === 'normal' ? ' active' : ''}" type="button" data-stats-view="normal">Normal</button>
      <button class="stats-view-option${activeStatsView === 'ranked' ? ' active' : ''}" type="button" data-stats-view="ranked">Ranked</button>
    </div>`;
  container.querySelectorAll('.stats-view-option').forEach(btn => {
    btn.addEventListener('click', () => {
      activeStatsView = btn.dataset.statsView;
      renderStatsView();
    });
  });
}

// Algarismos romanos pros subtiers (PUBG manda como "1"-"5", convenção visual é I-V).
const SUBTIER_ROMAN = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V' };

// Ícones que existem em pubg-api-assets/Assets/Icons/Insignias/.
// Tiers novos (Crystal/Survivor adicionados pós-extração) fazem fallback pro mais próximo.
const TIER_ICON_FALLBACK = { Crystal: 'Master', Survivor: 'Master', 'Grand Master': 'Master' };
const TIERS_WITHOUT_SUBTIER = new Set(['Master', 'Survivor', 'Grand Master']);

function tierIconPath(tier, subTier) {
  if (!tier || tier === 'Unranked') return '/pubg-api-assets/Assets/Icons/Insignias/Unranked.png';
  const iconTier = TIER_ICON_FALLBACK[tier] || tier;
  if (TIERS_WITHOUT_SUBTIER.has(iconTier)) return `/pubg-api-assets/Assets/Icons/Insignias/${iconTier}.png`;
  return `/pubg-api-assets/Assets/Icons/Insignias/${iconTier}-${subTier || 1}.png`;
}

function tierLabel(tier, subTier) {
  if (!tier || tier === 'Unranked') return 'Unranked';
  if (tier === 'Master' || tier === 'Grand Master') return tier;
  return `${tier} ${SUBTIER_ROMAN[String(subTier)] || subTier || ''}`.trim();
}

function renderRankedPanel() {
  const container = document.getElementById('ranked-panel-area');
  if (!container) return;
  const r = getActiveModeRanked();
  // Sem dados, ou modo onde o player nunca jogou ranked → some o painel inteiro.
  if (!r || !r.roundsPlayed) { container.innerHTML = ''; return; }

  const cur = r.currentTier || {};
  const best = r.bestTier || {};
  const currentRP = r.currentRankPoint || 0;
  const bestRP    = r.bestRankPoint || 0;

  // Algumas das melhores métricas pra ranked: KDA é o oficial da Krafton (kills+assists)/deaths.
  // Top10 ratio dá noção de consistência (chega na zona final?). Avg rank = colocação média.
  // API às vezes devolve kda=0 mesmo com partidas jogadas; calcula manual quando isso acontece.
  const rounds = r.roundsPlayed || 1;
  const deaths = Math.max(1, r.deaths || 0);
  const kills = r.kills || 0;
  const assists = r.assists || 0;
  const kda = (r.kda > 0 ? r.kda : (kills + assists) / deaths).toFixed(2);
  const winPct = ((r.winRatio || 0) * 100).toFixed(1);
  const top10Pct = ((r.top10Ratio || 0) * 100).toFixed(1);
  const avgRank = (r.avgRank || 0).toFixed(1);
  // API tem typo histórico (`damageDalt`); usa o canônico mas mantém fallback.
  const avgDmg = Math.round((r.damageDealt ?? r.damageDalt ?? 0) / rounds);

  const cards = [
    { label: 'KDA',         value: kda,             accent: true },
    { label: 'WIN %',       value: `${winPct}%`,    accent: true },
    { label: 'TOP 10 %',    value: `${top10Pct}%`                },
    { label: 'AVG. RANK',   value: `#${avgRank}`                 },
    { label: 'AVG. DAMAGE', value: avgDmg                        },
    { label: 'KILLS',       value: kills                         },
    { label: 'WINS',        value: r.wins || 0                   },
    { label: 'GAMES',       value: rounds                        },
  ];

  const sameTier = cur.tier === best.tier && cur.subTier === best.subTier;
  const rpDelta = currentRP - bestRP; // sempre ≤ 0 (best é o ápice da season)

  container.innerHTML = `
    <div class="ranked-panel">
      <div class="ranked-header">
        <div class="ranked-tier-badge">
          <img src="${tierIconPath(cur.tier, cur.subTier)}" alt="${tierLabel(cur.tier, cur.subTier)}" class="ranked-tier-img">
          <div class="ranked-tier-info">
            <div class="ranked-tier-label">RANKED · ${tierLabel(cur.tier, cur.subTier).toUpperCase()}</div>
            <div class="ranked-tier-rp">${currentRP.toLocaleString()} <span class="ranked-tier-rp-unit">RP</span></div>
            <div class="ranked-tier-best">
              ${sameTier
                ? `Peak this season`
                : `Peak: ${tierLabel(best.tier, best.subTier)} · ${bestRP.toLocaleString()} RP <span class="ranked-tier-rp-delta">(${rpDelta} from peak)</span>`}
            </div>
          </div>
        </div>
      </div>
      <div class="ranked-stats-grid">${cards.map(c => `
        <div class="stat-card-new">
          <div class="stat-label">${c.label}</div>
          <div class="stat-value${c.accent ? ' accent' : ''}">${c.value}</div>
        </div>`).join('')}</div>
    </div>`;
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
  const isRankedMatch = attr.matchType === 'competitive';
  const matchCategory = isRankedMatch ? 'RANKED' : 'NORMAL';
  const isWin = winPlace === 1;
  const ago = timeAgo(attr.createdAt);
  const mapImg = translatedMap.toLowerCase();

  return `<button class="match-row-new${isWin ? ' winner' : ''}${isRankedMatch ? ' ranked' : ''}" data-match-id="${match.data.id}">
    ${rankChip(winPlace, totalRosters, 'sm')}
    <div class="match-map-cell">
      <div class="match-thumb stripe-placeholder">
        <img src="/images/${mapImg}.jpg" alt="${translatedMap}"
          style="width:100%;height:100%;object-fit:cover;display:block"
          onerror="this.style.display='none'">
      </div>
      <div>
        <div class="match-map-name">${translatedMap}${isRankedMatch ? '<span class="match-ranked-badge">Ranked</span>' : ''}</div>
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

  // ── Preload telemetry so replay opens with zero gray-screen delay ────────────
  const matchId = matchData.data.id;
  if (!window._telemetryPreload) window._telemetryPreload = {};
  if (!window._telemetryPreload[matchId]) {
    window._telemetryPreload[matchId] = fetch(`/api/telemetry/${matchId}?platform=${currentPlatform}`)
      .then(r => r.json())
      .catch(() => null);
  }

  // ── Preload z=0 map tile (30KB) so the map appears instantly ────────────────
  const mapLower = translateMapName(matchData.data.attributes.mapName).toLowerCase();
  const z0url = `/tiles/${mapLower}/0/0_0.jpg`;
  if (!window._tilePreload) window._tilePreload = new Set();
  if (!window._tilePreload.has(z0url)) {
    window._tilePreload.add(z0url);
    new Image().src = z0url; // browser caches it for replay2d
  }
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
  const isRankedMatch = attr.matchType === 'competitive';
  const matchCategory = isRankedMatch ? 'RANKED' : 'NORMAL';
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
        <div class="drawer-map-name">${translatedMap}${isRankedMatch ? '<span class="match-ranked-badge">Ranked</span>' : ''}</div>
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
      ${matchTelemetry[matchData.data.id]
        ? `<button class="pi-btn primary" id="open-replay-btn" type="button">${Icon.play(12)} Open 2D replay</button>`
        : `<button class="pi-btn" type="button" disabled title="Telemetria não cacheada — partida com mais de 14 dias">${Icon.play(12)} Replay não disponível</button>`}
    </div>`;

  document.getElementById('drawer-close-btn').addEventListener('click', closeDrawer);
  document.getElementById('btn-share-match').addEventListener('click', () => copyToClipboard(buildMatchShareUrl(matchData.data.id)));
  document.getElementById('open-replay-btn')?.addEventListener('click', () => {
    window.globalMatchData = matchData;
    showModal(matchData, currentPlatform);
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

  // `silent`: só recarrega o estado do player (pro botão "← Back" dos insights),
  // sem trocar a view nem mexer na URL — quem chamou já está mostrando outra tela.
  if (!opts.silent) {
    showLoading();
    renderHeader(name, seasonId);
  }

  try {
    // Todos cache-first. O refresh real é só via refreshAll()/endpoint /refresh.
    const [statsRes, matchesRes, rankedRes] = await Promise.all([
      fetch(`/api/player/${encodeURIComponent(name)}?season=${encodeURIComponent(seasonId)}&platform=${currentPlatform}`),
      fetch(`/api/player/${encodeURIComponent(name)}/matches?platform=${currentPlatform}`),
      fetch(`/api/player/${encodeURIComponent(name)}/ranked?season=${encodeURIComponent(seasonId)}&platform=${currentPlatform}`),
    ]);

    const statsData = await statsRes.json();
    const matchesData = await matchesRes.json();
    const rankedData = await rankedRes.json().catch(() => ({}));

    if (!statsData.stats) {
      if (!opts.silent) { alert('No stats available for this player'); showLanding(); }
      return;
    }

    // Cooldown do botão Atualizar vem do servidor (fonte da verdade).
    if (typeof statsData.refreshAvailableInMs === 'number') {
      refreshReadyAt = Date.now() + statsData.refreshAvailableInMs;
    }

    fppStats = statsData.stats.fpp || {};
    tppStats = statsData.stats.tpp || {};
    rankedFppStats = rankedData?.ranked?.fpp || {};
    rankedTppStats = rankedData?.ranked?.tpp || {};
    window.fppStats = fppStats;
    window.tppStats = tppStats;
    // Filtra non-playable: mapas sem assets (Camp Jackal/SafeHouse/Paramo/Haven) E
    // modos arcade/event/custom/treino mesmo em mapas válidos (TDM, IBR, Heist,
    // Air Royale, Binary Spot). Só sobra BR clássico (official + competitive ranked).
    allMatches = (matchesData.matches || []).filter(isPlayableMatch);
    matchTelemetry = matchesData.telemetry || {};
    currentIndex = 0;
    activeMode = getBestMode(fppStats, tppStats);
    activeStatsView = 'normal';

    if (!opts.silent) {
      showPlayerPage(name, seasonId);

      // Reflect search in URL (without reloading)
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      url.searchParams.set('p', name);
      if (seasonId) url.searchParams.set('s', seasonId);
      if (!opts.matchId) url.searchParams.delete('m');
      window.history.replaceState({}, '', url.toString());

      if (opts.matchId) {
        const match = allMatches.find(m => m.data.id === opts.matchId);
        if (match) openDrawer(match);
      }
    }
  } catch (err) {
    console.error(err);
    if (!opts.silent) { alert('Failed to load player data.'); showLanding(); }
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
        <div id="stats-view-toggle-area"></div>
        <div id="ranked-panel-area"></div>
        <div id="stats-grid-area"></div>
        <div id="match-list-area"></div>
      </div>
    </div>
    <div id="weapon-stats-page" style="display:none"></div>
    <div id="leaderboard-page" style="display:none"></div>
    <div id="insights-page" style="display:none"></div>
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

    if (params.get('view') === 'weapons') {
      showWeaponStatsPage();
      return;
    }
    if (params.get('view') === 'insights') {
      const pname = params.get('p');
      if (pname) {
        currentPlayerName = pname;
        showInsightsPage(pname);
        return;
      }
    }
    if (params.get('view') === 'leaderboard') {
      const sv = params.get('shard');
      const mv = params.get('mode');
      if (sv && LEADERBOARD_REGIONS.some(r => r.value === sv)) leaderboardShard = sv;
      if (mv && LEADERBOARD_MODES.some(m => m.value === mv)) leaderboardMode = mv;
      showLeaderboardPage();
      return;
    }

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
