// Renderiza /api/insights/player/:name + comparações vs média global.
// Carrega weapon-stats.json em paralelo pra exibir nomes amigáveis das armas
// (HK416 em vez de WeapHK416_C).

import { translateMapName } from './utils.js';

// Dicionário oficial da PUBG (item id → nome legível). Keys no formato
// "Item_Weapon_HK416_C" → "M416". Servido estaticamente via /pubg-api-assets.
let weaponNameCache = null;
async function loadWeaponNames() {
  if (weaponNameCache) return weaponNameCache;
  try {
    const r = await fetch('/pubg-api-assets/dictionaries/telemetry/item/itemId.json');
    if (!r.ok) return (weaponNameCache = {});
    weaponNameCache = await r.json();
    return weaponNameCache;
  } catch { return (weaponNameCache = {}); }
}

// insights manda "WeapHK416_C"; o dict usa "Item_Weapon_HK416_C". Converte e
// faz lookup; fallback pra string limpa pra itens fora do dict (granadas etc).
function weaponLabel(id, names) {
  const itemId = String(id || '').replace(/^Weap/, 'Item_Weapon_');
  if (names[itemId]) return names[itemId];
  if (names[id]) return names[id];
  return String(id || '')
    .replace(/^Item_Weapon_/, '')
    .replace(/^Weap/, '')
    .replace(/_C$/, '')
    .replace(/_Projectile$/, '')
    .replace(/_EffectActor$/, '');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  return (value * 100).toFixed(digits) + '%';
}

function fmtSeconds(s) {
  if (s == null || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// 0..1 → cor verde→amarelo→vermelho, mas invertendo pro caso de "menor é melhor"
function pctColor(pct, lowerIsBetter = false) {
  if (pct == null) return 'var(--text-muted)';
  const p = lowerIsBetter ? 1 - pct : pct;
  if (p >= 0.75) return 'var(--win)';
  if (p >= 0.5)  return 'var(--good)';
  if (p >= 0.25) return 'var(--accent)';
  return 'var(--bad)';
}

// Campos sempre disponíveis (vem do match data — todos os matches do player)
const STAT_DEFS_BASE = [
  { key: 'kdr',                 label: 'K/D',              fmt: v => fmt(v, 2),                   distKey: 'kdr' },
  { key: 'killsPerMatch',       label: 'Kills / match',    fmt: v => fmt(v, 2),                   distKey: 'killsPerMatch' },
  { key: 'knocksPerMatch',      label: 'Knocks / match',   fmt: v => fmt(v, 2),                   distKey: 'knocksPerMatch' },
  { key: 'damagePerMatch',      label: 'Damage / match',   fmt: v => fmt(v, 0),                   distKey: 'damagePerMatch' },
  { key: 'avgSurvivalSeconds',  label: 'Avg survival',     fmt: v => fmtSeconds(v),               distKey: 'avgSurvivalSeconds' },
  { key: 'headshotRate',        label: 'Headshot %',       fmt: v => fmtPct(v, 1),                distKey: 'headshotRate' },
  { key: 'winRate',             label: 'Win rate',         fmt: v => fmtPct(v, 1),                distKey: 'winRate' },
  { key: 'aggression',          label: 'Aggression',       fmt: v => fmt(v, 0),                   distKey: 'aggression',
    tooltip: 'kills × 100 + damage, por match. Combina frags e dano total.' },
];

const DISTANCE_LABELS = {
  close:    '≤ 25m',
  short:    '25–50m',
  med:      '50–100m',
  long:     '100–200m',
  verylong: '200m+',
  unknown:  'Unknown',
};

function statCard(def, playerValue, dist, percentile) {
  const playerStr = def.fmt(playerValue);
  const medianStr = dist ? def.fmt(dist.median) : '—';
  const pct = percentile == null ? null : percentile;
  const color = pctColor(pct, def.lowerIsBetter);
  const pctLabel = pct == null ? '—' : Math.round(pct * 100) + 'th';
  const barW = pct == null ? 0 : Math.max(2, pct * 100);

  return `<div class="ins-card" ${def.tooltip ? `title="${escapeHtml(def.tooltip)}"` : ''}>
    <div class="ins-card-label">${escapeHtml(def.label)}</div>
    <div class="ins-card-value mono">${escapeHtml(playerStr)}</div>
    <div class="ins-card-bar"><div class="ins-card-bar-fill" style="width:${barW}%;background:${color}"></div></div>
    <div class="ins-card-meta">
      <span class="mono" style="color:${color}">${escapeHtml(pctLabel)} pct</span>
      <span class="mono ins-card-median">avg <span style="color:var(--text-dim)">${escapeHtml(medianStr)}</span></span>
    </div>
  </div>`;
}

function emptyDatasetState(playerName, meta) {
  return `<div class="ins-empty">
    <div class="ins-empty-icon">○</div>
    <div class="ins-empty-title">No telemetry insights for ${escapeHtml(playerName)}</div>
    <div class="ins-empty-body">
      Insights são derivados de telemetria de partidas que outros usuários do PUBG INSIGHT já consultaram —
      esse jogador ainda não apareceu em nenhum dos ${meta.telemetryFiles ?? '?'} matches no nosso cache.
      Tenta procurar o jogador na home e abrir alguma partida dele: a telemetria fica em cache
      e na próxima geração de insights os stats aparecem aqui.
    </div>
  </div>`;
}

function renderWeaponsSection(stats, names) {
  const entries = Object.entries(stats.killsByWeapon || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  if (!entries.length) {
    return `<div class="ins-section-empty">Nenhuma kill com arma identificada.</div>`;
  }
  const maxN = entries[0][1];
  return entries.map(([id, n]) => {
    const w = (maxN > 0 ? n / maxN : 0) * 100;
    return `<div class="ins-bar-row">
      <span class="ins-bar-label">${escapeHtml(weaponLabel(id, names))}</span>
      <div class="ins-bar"><div class="ins-bar-fill" style="width:${w}%"></div></div>
      <span class="mono ins-bar-value">${n}</span>
    </div>`;
  }).join('');
}

function renderDistanceSection(stats) {
  const by = stats.killsByDistance || {};
  const total = Object.values(by).reduce((s, v) => s + v, 0);
  if (!total) return `<div class="ins-section-empty">Sem dados de distância.</div>`;
  const order = ['close', 'short', 'med', 'long', 'verylong', 'unknown'];
  return order.filter(k => by[k]).map(k => {
    const n = by[k] || 0;
    const pct = total > 0 ? n / total : 0;
    return `<div class="ins-bar-row">
      <span class="ins-bar-label">${escapeHtml(DISTANCE_LABELS[k])}</span>
      <div class="ins-bar"><div class="ins-bar-fill" style="width:${pct * 100}%;background:var(--cool)"></div></div>
      <span class="mono ins-bar-value">${n} <span style="color:var(--text-faint)">(${(pct * 100).toFixed(0)}%)</span></span>
    </div>`;
  }).join('');
}

function renderMapsSection(stats) {
  const maps = Object.entries(stats.matchesByMap || {})
    .map(([m, matches]) => ({
      map: m,
      matches,
      kills: stats.killsByMap?.[m] || 0,
      wins: stats.winsByMap?.[m] || 0,
    }))
    .sort((a, b) => b.matches - a.matches);
  if (!maps.length) return `<div class="ins-section-empty">Sem dados por mapa.</div>`;
  const rows = maps.map(m => {
    const kpm = m.matches > 0 ? (m.kills / m.matches) : 0;
    const wr = m.matches > 0 ? (m.wins / m.matches) * 100 : 0;
    return `<tr>
      <td>${escapeHtml(translateMapName ? translateMapName(m.map) : m.map)}</td>
      <td class="num">${m.matches}</td>
      <td class="num">${m.kills}</td>
      <td class="num">${fmt(kpm, 2)}</td>
      <td class="num">${m.wins}</td>
      <td class="num" style="color:${wr >= 5 ? 'var(--win)' : 'var(--text-dim)'}">${wr.toFixed(1)}%</td>
    </tr>`;
  }).join('');
  return `<table class="ins-table">
    <thead><tr><th>Map</th><th class="num">Matches</th><th class="num">Kills</th><th class="num">K/match</th><th class="num">Wins</th><th class="num">Win%</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLoadingState(playerName) {
  return `<div class="ins-page-wrap">
    ${backButton(playerName)}
    <div class="ins-page-header">
      <h1 class="ins-page-title">Player Insights</h1>
      <div class="ins-page-sub">${escapeHtml(playerName)}</div>
    </div>
    <div class="ins-calculating">
      <div class="ins-spinner"></div>
      <div class="ins-calculating-title">Calculando insights…</div>
      <div class="ins-calculating-sub">
        Varrendo todos os matches cacheados do jogador e cruzando com telemetria detalhada quando disponível.
        Geralmente leva 1-3 segundos.
      </div>
    </div>
  </div>`;
}

function backButton(playerName) {
  return `<button class="ins-back-btn pi-btn ghost" type="button">← Back to ${escapeHtml(playerName)}</button>`;
}

export async function renderInsightsPage(container, { playerName, platform = 'steam', onBack } = {}) {
  if (!container) return;

  // Delegação: um listener no container persiste através dos re-renders do innerHTML.
  if (typeof onBack === 'function') {
    container.onclick = (e) => {
      if (e.target.closest('.ins-back-btn')) onBack();
    };
  }

  // Loading explícito enquanto o backend varre os match files do player
  container.innerHTML = renderLoadingState(playerName);

  // Cache-first: o refresh (recompute) é orquestrado pelo refreshAll() antes de abrir.
  let dataset, names;
  try {
    const [r, n] = await Promise.all([
      fetch(`/api/insights/player/${encodeURIComponent(playerName)}?platform=${encodeURIComponent(platform)}`),
      loadWeaponNames(),
    ]);
    if (r.status === 503) {
      container.innerHTML = `<div class="ins-error">
        <h2>Dataset global ainda não foi gerado</h2>
        <p>Rode <code>npm run insights:build</code> pra criar o cache inicial. Insights individuais dependem das distribuições globais pra calcular percentis.</p>
      </div>`;
      return;
    }
    if (r.status === 404) {
      const err = await r.json().catch(() => ({}));
      container.innerHTML = `<div class="ins-error"><h2>Player não encontrado</h2><p>${escapeHtml(err.error || playerName)}</p></div>`;
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    dataset = await r.json();
    names = n;
  } catch (err) {
    container.innerHTML = `<div class="ins-error"><h2>Failed to load insights</h2><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const meta = {
    ...(dataset.meta || {}),
    minMatchesFilter: dataset.globalAverages?.minMatchesFilter,
  };
  const distributions = dataset.globalAverages?.distributions || {};

  if (!dataset.player?.inDataset || !dataset.stats) {
    container.innerHTML = `<div class="ins-page-wrap">
      ${backButton(playerName)}
      <div class="ins-page-header">
        <h1 class="ins-page-title">Player Insights</h1>
        <div class="ins-page-sub">${escapeHtml(playerName)}</div>
      </div>
      ${emptyDatasetState(playerName, meta)}
    </div>`;
    return;
  }

  const stats = dataset.stats;
  const percentiles = dataset.percentiles || {};
  const hasTelemetry = (meta.telemetriesUsed || 0) > 0;

  // Cards base (do match data, sempre disponível)
  const baseCards = STAT_DEFS_BASE.map(def =>
    statCard(def, stats[def.key], distributions[def.distKey], percentiles[def.key])
  ).join('');

  const matchesUsed = stats.matches;
  const showRecency = matchesUsed < 5
    ? `<div class="ins-low-data">Apenas ${matchesUsed} match${matchesUsed === 1 ? '' : 'es'} no cache — percentis ainda muito ruidosos.</div>`
    : '';

  const weaponsSection = hasTelemetry ? `
    <div class="ins-two-col">
      <section class="ins-section">
        <h2 class="ins-section-title">Kills por arma <span class="ins-section-sub">top 12</span></h2>
        ${renderWeaponsSection(stats, names)}
      </section>
      <section class="ins-section">
        <h2 class="ins-section-title">Kills por distância</h2>
        ${renderDistanceSection(stats)}
      </section>
    </div>` : '';

  container.innerHTML = `<div class="ins-page-wrap">
    ${backButton(playerName)}
    <div class="ins-page-header">
      <h1 class="ins-page-title">Player Insights</h1>
      <div class="ins-page-sub">${escapeHtml(playerName)} · ${matchesUsed} match${matchesUsed === 1 ? '' : 'es'} analisados</div>
    </div>

    ${showRecency}

    <h2 class="ins-section-title">Performance vs média</h2>
    <div class="ins-grid">${baseCards}</div>

    ${weaponsSection}

    <section class="ins-section">
      <h2 class="ins-section-title">Performance por mapa</h2>
      ${renderMapsSection(stats)}
    </section>
  </div>`;
}
