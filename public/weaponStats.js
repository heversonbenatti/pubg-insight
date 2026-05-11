const DATA_URL = '/data/weapon-stats.json';

const BODY_PARTS = [
  { key: 'head', label: 'Head', zone: 'Head', bone: 'head', css: 'target-head' },
  { key: 'neck', label: 'Neck', zone: 'Head', bone: 'neck_01', css: 'target-neck' },
  { key: 'upperChest', label: 'Upper chest', zone: 'Torso', bone: 'spine_03', css: 'target-upper-chest' },
  { key: 'chest', label: 'Chest', zone: 'Torso', bone: 'spine_02', css: 'target-chest' },
  { key: 'stomach', label: 'Stomach', zone: 'Torso', bone: 'spine_01', css: 'target-stomach' },
  { key: 'pelvis', label: 'Pelvis', zone: 'Pelvis', bone: 'pelvis', css: 'target-pelvis' },
  { key: 'upperArm', label: 'Upper arm', zone: 'Arm', bone: 'upperarm_l', css: 'target-arm' },
  { key: 'forearm', label: 'Forearm', zone: 'Arm', bone: 'lowerarm_l', css: 'target-forearm' },
  { key: 'hand', label: 'Hand', zone: 'Arm', bone: 'hand_l', css: 'target-hand' },
  { key: 'thigh', label: 'Thigh', zone: 'Leg', bone: 'thigh_l', css: 'target-thigh' },
  { key: 'calf', label: 'Calf', zone: 'Leg', bone: 'calf_l', css: 'target-calf' },
  { key: 'foot', label: 'Foot', zone: 'Leg', bone: 'foot_l', css: 'target-foot' },
];

let cache = null;
let state = {
  weaponId: '',
  helmetLevel: 0,
  vestLevel: 0,
  vestBroken: false,
  distance: 100,
  query: '',
  category: 'all',
};

async function loadData() {
  if (cache) return cache;
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error('weapon stats data failed');
  cache = await res.json();
  state.weaponId = cache.weapons[0]?.id || '';
  return cache;
}

function fmtDamage(value) {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1);
}

function evalCurve(keys, x, weapon = null) {
  if ((!keys || keys.length <= 1) && weapon?.referenceDistance > 0 && weapon?.rangeModifier > 0 && weapon.rangeModifier !== 1) {
    return Math.pow(weapon.rangeModifier, x / weapon.referenceDistance);
  }
  if (!keys?.length) return 1;
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  if (x <= sorted[0].time) return sorted[0].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (x > b.time) continue;
    const span = b.time - a.time || 1;
    const t = Math.max(0, Math.min(1, (x - a.time) / span));
    if (a.interp === 'RCIM_Constant') return a.value;
    if (a.interp === 'RCIM_Cubic') {
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      return h00 * a.value + h10 * span * a.leaveTangent + h01 * b.value + h11 * span * b.arriveTangent;
    }
    return a.value + (b.value - a.value) * t;
  }
  return sorted[sorted.length - 1].value;
}

function zoneByName(data, zoneName) {
  return data.damageZones.find(z => z.zone === zoneName);
}

function boneMultiplier(zone, boneName) {
  return zone?.bones?.find(b => b.name === boneName)?.multiplier ?? 1;
}

function selectedEquipment(data) {
  return {
    helmet: data.equipment.helmets.find(h => h.level === state.helmetLevel) || data.equipment.helmets[0],
    vest: data.equipment.vests.find(v => v.level === state.vestLevel) || data.equipment.vests[0],
  };
}

function effectiveReduction(zone, equipment, data) {
  if (zone?.equipSlot === 'Head') {
    if (equipment.helmet.level === 0) return 0;
    return equipment.helmet.reduction;
  }
  if (zone?.equipSlot === 'TorsoArmor') {
    if (equipment.vest.level === 0) return 0;
    if (state.vestBroken) return data.brokenArmor?.vestReduction ?? 0.20;
    return equipment.vest.reduction;
  }
  return 0;
}

function partDamage(data, weapon, part) {
  const zone = zoneByName(data, part.zone);
  const classMult = part.zone === 'Head' && weapon.headshotMultiplier
    ? weapon.headshotMultiplier
    : zone?.classMultipliers?.[weapon.class] ?? 1;
  const damageDistance = weapon.class === 'Shotgun' ? Math.max(0, state.distance - 0.83) : state.distance;
  const distMult = evalCurve(weapon.damageCurve, damageDistance, weapon);
  const boneMult = boneMultiplier(zone, part.bone);
  const equipment = selectedEquipment(data);
  const reduction = effectiveReduction(zone, equipment, data);
  return weapon.baseDamage * distMult * classMult * boneMult * (1 - reduction);
}

function optionButton(item, type) {
  const active = type === 'helmet' ? item.level === state.helmetLevel : item.level === state.vestLevel;
  return `<button class="damage-equipment-option${active ? ' active' : ''}" data-${type}="${item.level}" type="button">
    <div class="damage-equipment-icon">
      ${item.image ? `<img src="${item.image}" alt="">` : '<span class="damage-empty-equipment">0</span>'}
    </div>
    <span>${item.label}</span>
  </button>`;
}

function brokenToggle(type) {
  const level = type === 'helmet' ? state.helmetLevel : state.vestLevel;
  const broken = type === 'helmet' ? state.helmetBroken : state.vestBroken;
  const disabled = level === 0;
  return `<label class="damage-broken-toggle${disabled ? ' disabled' : ''}${broken ? ' active' : ''}">
    <input type="checkbox" data-broken="${type}" ${broken ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
    <span>Quebrado</span>
  </label>`;
}

function weaponCard(weapon) {
  const active = weapon.id === state.weaponId;
  const img = weapon.image
    ? `<img src="${weapon.image}" alt="">`
    : `<div class="damage-weapon-placeholder">${weapon.name.split(/\s+/).map(s => s[0] || '').join('').slice(0, 3).toUpperCase()}</div>`;
  return `<button class="damage-weapon-card${active ? ' active' : ''}" data-weapon-id="${weapon.id}" type="button">
    ${img}
    <span class="damage-weapon-name">${weapon.name}</span>
    <span class="damage-weapon-meta">${weapon.class}</span>
    <strong>${weapon.baseDamage}</strong>
  </button>`;
}

function filteredWeapons(data) {
  const q = state.query.trim().toLowerCase();
  return data.weapons.filter(w => {
    const matchesCategory = state.category === 'all' || w.category === state.category;
    const matchesQuery = !q || w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });
}

function renderTarget(data, weapon) {
  const parts = BODY_PARTS.map(part => {
    const damage = fmtDamage(partDamage(data, weapon, part));
    return `<div class="target-damage-pill ${part.css}" data-part="${part.key}">
      <span>${part.label}</span>
      <strong data-part-damage="${part.key}">${damage}</strong>
    </div>`;
  }).join('');

  return `<div class="damage-target-wrap">
    <div class="damage-target">
      <svg class="target-figure" viewBox="0 0 330 520" aria-hidden="true">
        <defs>
          <linearGradient id="targetSkin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--surface-3)" />
            <stop offset="1" stop-color="var(--surface-2)" />
          </linearGradient>
          <linearGradient id="targetGear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="oklch(0.30 0.02 250)" />
            <stop offset="1" stop-color="oklch(0.19 0.015 250)" />
          </linearGradient>
          <filter id="targetShadow" x="-25%" y="-10%" width="150%" height="130%">
            <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="black" flood-opacity="0.28" />
          </filter>
        </defs>
        <ellipse class="target-ground" cx="165" cy="504" rx="92" ry="12" />
        <g filter="url(#targetShadow)">
          <path class="target-limb" d="M95 138 C65 166 52 214 45 278 C43 300 54 318 70 315 C85 312 88 292 90 274 C96 224 110 186 130 160 Z" />
          <path class="target-limb" d="M235 138 C265 166 278 214 285 278 C287 300 276 318 260 315 C245 312 242 292 240 274 C234 224 220 186 200 160 Z" />
          <path class="target-hand" d="M41 294 C39 311 46 326 62 328 C78 330 88 319 88 302 C75 308 59 305 41 294 Z" />
          <path class="target-hand" d="M289 294 C291 311 284 326 268 328 C252 330 242 319 242 302 C255 308 271 305 289 294 Z" />
          <path class="target-leg" d="M118 340 C108 382 101 430 96 490 C115 499 135 500 153 492 C155 448 160 405 169 363 Z" />
          <path class="target-leg" d="M212 340 C222 382 229 430 234 490 C215 499 195 500 177 492 C175 448 170 405 161 363 Z" />
          <path class="target-boot" d="M91 484 C109 489 132 489 154 482 L157 505 C134 513 108 512 84 502 Z" />
          <path class="target-boot" d="M239 484 C221 489 198 489 176 482 L173 505 C196 513 222 512 246 502 Z" />
          <path class="target-pelvis-figure" d="M110 298 C126 286 204 286 220 298 C220 326 207 354 165 364 C123 354 110 326 110 298 Z" />
          <path class="target-torso-figure" d="M92 124 C116 100 214 100 238 124 C248 178 236 248 218 300 C189 316 141 316 112 300 C94 248 82 178 92 124 Z" />
          <path class="target-vest-line" d="M116 126 C128 164 144 206 165 250 C186 206 202 164 214 126" />
          <path class="target-vest-line" d="M108 214 C141 228 189 228 222 214" />
          <path class="target-neck-figure" d="M141 76 C151 88 179 88 189 76 L193 112 C181 121 149 121 137 112 Z" />
          <path class="target-head-figure" d="M129 43 C132 16 151 5 165 5 C179 5 198 16 201 43 C204 72 187 91 165 91 C143 91 126 72 129 43 Z" />
          <path class="target-face-line" d="M145 49 C158 55 172 55 185 49" />
          <path class="target-face-line" d="M151 68 C160 73 170 73 179 68" />
          <path class="target-helmet-figure" d="M130 45 C130 18 148 3 165 3 C182 3 200 18 200 45 C180 35 150 35 130 45 Z" />
        </g>
      </svg>
      ${parts}
    </div>
  </div>`;
}

function updateDistanceDamage(container, data) {
  const weapon = data.weapons.find(w => w.id === state.weaponId) || data.weapons[0];
  const distanceLabel = container.querySelector('[data-distance-value]');
  if (distanceLabel) distanceLabel.textContent = `${state.distance}m`;
  for (const part of BODY_PARTS) {
    const value = container.querySelector(`[data-part-damage="${part.key}"]`);
    if (value) value.textContent = fmtDamage(partDamage(data, weapon, part));
  }
}

function renderHTML(data) {
  const weapon = data.weapons.find(w => w.id === state.weaponId) || data.weapons[0];
  const equipment = selectedEquipment(data);
  const weapons = filteredWeapons(data);
  const categoryLabels = { Main: 'Main', Handgun: 'Handgun', Melee: 'Melee' };
  const categoryOrder = ['Main', 'Handgun', 'Melee'];
  const categories = [
    ['all', 'All'],
    ...[...new Set(data.weapons.map(w => w.category))]
      .sort((a, b) => {
        const ai = categoryOrder.indexOf(a);
        const bi = categoryOrder.indexOf(b);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return (categoryLabels[a] || a).localeCompare(categoryLabels[b] || b);
      })
      .map(key => [key, categoryLabels[key] || key]),
  ];

  return `<div class="damage-page">
    <div class="damage-page-header">
      <div>
        <div class="micro">WEAPON LAB</div>
        <h1>Weapon damage</h1>
      </div>
      <div class="damage-selected-weapon">
        ${weapon.image ? `<img src="${weapon.image}" alt="">` : `<div class="damage-weapon-placeholder">${weapon.name.split(/\s+/).map(s => s[0] || '').join('').slice(0, 3).toUpperCase()}</div>`}
        <div>
          <span>${weapon.name}</span>
          <strong>${weapon.baseDamage} base damage</strong>
        </div>
      </div>
    </div>

    <div class="damage-layout">
      <section class="damage-target-panel">
        ${renderTarget(data, weapon)}
      </section>

      <section class="damage-control-panel">
        <div class="damage-distance-row">
          <div>
            <div class="micro">DISTANCE</div>
            <strong data-distance-value>${state.distance}m</strong>
          </div>
          <input id="damage-distance" type="range" min="0" max="1000" step="5" value="${state.distance}">
        </div>

        <div class="damage-control-group">
          <div class="micro">HELMET</div>
          <div class="damage-equipment-list">
            ${data.equipment.helmets.map(item => optionButton(item, 'helmet')).join('')}
          </div>
        </div>

        <div class="damage-control-group">
          <div class="micro">VEST</div>
          <div class="damage-equipment-list">
            ${data.equipment.vests.map(item => optionButton(item, 'vest')).join('')}
          </div>
          ${brokenToggle('vest')}
        </div>

        <div class="damage-equipment-summary">
          <span>${equipment.helmet.label}: ${Math.round(effectiveReduction({equipSlot:'Head'}, equipment, data) * 100)}%</span>
          <span>${equipment.vest.label}: ${Math.round(effectiveReduction({equipSlot:'TorsoArmor'}, equipment, data) * 100)}%${state.vestBroken && equipment.vest.level ? ' (quebrado)' : ''}</span>
        </div>
      </section>
    </div>

    <section class="damage-weapons-section">
      <div class="damage-weapons-toolbar">
        <div class="damage-category-tabs">
          ${categories.map(([key, label]) => `<button class="${state.category === key ? 'active' : ''}" data-category="${key}" type="button">${label}</button>`).join('')}
        </div>
        <input id="damage-weapon-search" value="${state.query.replace(/"/g, '&quot;')}" placeholder="Search weapon" autocomplete="off">
      </div>
      <div class="damage-weapon-grid">
        ${weapons.map(weaponCard).join('') || '<div class="damage-empty-list">No weapons found.</div>'}
      </div>
    </section>
  </div>`;
}

function bind(container, data) {
  container.querySelector('#damage-distance')?.addEventListener('input', e => {
    state.distance = Number(e.target.value);
    updateDistanceDamage(container, data);
  });
  container.querySelectorAll('[data-helmet]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.helmetLevel = Number(btn.dataset.helmet);
      renderLoaded(container, data);
    });
  });
  container.querySelectorAll('[data-vest]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.vestLevel = Number(btn.dataset.vest);
      if (state.vestLevel === 0) state.vestBroken = false;
      renderLoaded(container, data);
    });
  });
  container.querySelectorAll('[data-broken]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.dataset.broken === 'vest') state.vestBroken = input.checked;
      renderLoaded(container, data);
    });
  });
  container.querySelectorAll('[data-weapon-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.weaponId = btn.dataset.weaponId;
      renderLoaded(container, data);
    });
  });
  container.querySelectorAll('[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.category = btn.dataset.category;
      renderLoaded(container, data);
    });
  });
  container.querySelector('#damage-weapon-search')?.addEventListener('input', e => {
    state.query = e.target.value;
    renderLoaded(container, data);
    const input = container.querySelector('#damage-weapon-search');
    input?.focus();
    input?.setSelectionRange(state.query.length, state.query.length);
  });
}

function renderLoaded(container, data) {
  container.innerHTML = renderHTML(data);
  bind(container, data);
}

export async function renderWeaponStatsPage(container) {
  if (!container) return;
  container.innerHTML = `<div class="damage-page"><div class="career-skeleton skel"></div></div>`;
  try {
    const data = await loadData();
    renderLoaded(container, data);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="damage-page"><div class="career-empty"><div class="career-empty-label">DATA ERROR</div><div class="career-empty-message">Could not load weapon stats.</div></div></div>`;
  }
}
