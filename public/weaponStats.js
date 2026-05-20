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

const TARGET_MARKERS = {
  head: [512, 125],
  neck: [512, 244],
  upperChest: [512, 345],
  chest: [512, 505],
  stomach: [512, 645],
  pelvis: [512, 760],
  upperArm: [684, 365],
  forearm: [703, 590],
  hand: [711, 770],
  thigh: [584, 885],
  calf: [586, 1138],
  foot: [586, 1367],
};

const WEAPON_GROUPS = [
  { key: 'all', label: 'ALL' },
  { key: 'SR', label: 'SR' },
  { key: 'DMR', label: 'DMR' },
  { key: 'AR', label: 'AR' },
  { key: 'SMG', label: 'SMG' },
  { key: 'LMG', label: 'LMG' },
  { key: 'SHOTGUN', label: 'SHOTGUN' },
  { key: 'PISTOL', label: 'PISTOL' },
];

const CLASS_TO_GROUP = {
  Sniper: 'SR',
  DMR: 'DMR',
  Rifle: 'AR',
  SMG: 'SMG',
  LMG: 'LMG',
  Shotgun: 'SHOTGUN',
  Pistol: 'PISTOL',
};

const GROUP_ORDER = Object.fromEntries(WEAPON_GROUPS.map((group, index) => [group.key, index]));

const SORT_OPTIONS = [
  { key: 'category', label: 'Category' },
  { key: 'damage', label: 'Damage' },
  { key: 'rpm', label: 'RPM' },
  { key: 'dps', label: 'DPS' },
  { key: 'ammo', label: 'Ammo' },
];

const AMMO_BY_WEAPON = {
  ACE32: '7.62mm',
  AKM: '7.62mm',
  'AUG A3': '5.56mm',
  AWM: '.300 Mag',
  Beryl: '7.62mm',
  Bizon: '9mm',
  Crossbow: 'Bolt',
  DBS: '12 Gauge',
  Deagle: '.45 ACP',
  'DP-28': '7.62mm',
  Dragunov: '7.62mm',
  FamasG2: '5.56mm',
  G36C: '5.56mm',
  Groza: '7.62mm',
  JS9: '9mm',
  K2: '5.56mm',
  Kar98k: '7.62mm',
  'Lynx AMR': '.50 Cal',
  M16A4: '5.56mm',
  M24: '7.62mm',
  M249: '5.56mm',
  M416: '5.56mm',
  M9: '9mm',
  MG3: '7.62mm',
  'Micro Uzi': '9mm',
  'Mini 14': '5.56mm',
  Mk12: '5.56mm',
  'Mk14 EBR': '7.62mm',
  'Mk47 Mutant': '7.62mm',
  'Mosin-Nagant': '7.62mm',
  MP5K: '9mm',
  MP9: '9mm',
  O12: '12 Gauge',
  P18C: '9mm',
  P1911: '.45 ACP',
  P90: '5.7mm',
  P92: '9mm',
  QBU88: '5.56mm',
  QBZ95: '5.56mm',
  R1895: '7.62mm',
  R45: '.45 ACP',
  S12K: '12 Gauge',
  S1897: '12 Gauge',
  S686: '12 Gauge',
  'Sawed-off': '12 Gauge',
  'SCAR-L': '5.56mm',
  SKS: '7.62mm',
  SLR: '7.62mm',
  Skorpion: '9mm',
  Thompson: '.45 ACP',
  'Tommy Gun': '.45 ACP',
  UMP9: '.45 ACP',
  Vector: '9mm',
  VSS: '9mm',
  Win94: '.45 ACP',
};

const AMMO_ORDER = ['5.56mm', '7.62mm', '9mm', '.45 ACP', '12 Gauge', '.300 Mag', '.50 Cal', '5.7mm', 'Bolt', 'Unknown'];
const COMPARE_PART_KEYS = ['head', 'chest', 'pelvis'];

let cache = null;
let duelsCache = null;        // { weapons: [{id, kills, duels, ...}], byId: Map }
let duelsFetchPromise = null;
let state = {
  weaponId: '',
  compareWeaponId: '',
  helmetLevel: 0,
  helmetBroken: false,
  vestLevel: 0,
  vestBroken: false,
  distance: 100,
  query: '',
  category: 'all',
  sortBy: 'category',
  targetMetric: 'damage', // 'damage' | 'ttk' | 'btk'
};

const TARGET_METRICS = [
  { key: 'damage', label: 'DMG', tip: 'Damage per shot' },
  { key: 'ttk',    label: 'TTK', tip: 'Time to kill — 100 HP target (seconds)' },
  { key: 'btk',    label: 'BTK', tip: 'Bullets to kill — 100 HP target' },
];

async function loadData() {
  if (cache) return cache;
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error('weapon stats data failed');
  cache = await res.json();
  // Estado inicial: slots A e B começam vazios — placeholder "drag a weapon here"
  // até o usuário clicar ou arrastar uma arma.
  state.weaponId = '';
  state.compareWeaponId = '';
  return cache;
}

// telemetry-derived duels (insights.json). Carregamento opcional — se falhar,
// a seção de duelos some silenciosamente.
async function loadDuels() {
  if (duelsCache) return duelsCache;
  if (duelsFetchPromise) return duelsFetchPromise;
  duelsFetchPromise = (async () => {
    try {
      const r = await fetch('/api/insights/weapons');
      if (!r.ok) return null;
      const data = await r.json();
      const byId = new Map();
      for (const w of (data.weapons || [])) {
        // Insights id: "WeapHK416_C". Weapon-stats id: "Item_Weapon_HK416_C". Normaliza.
        const normalizedId = String(w.id || '').replace(/^Weap/, 'Item_Weapon_');
        byId.set(normalizedId, w);
        // Mantém também a chave original pra lookup direto
        byId.set(w.id, w);
      }
      duelsCache = { weapons: data.weapons || [], byId };
      return duelsCache;
    } catch { return null; }
  })();
  return duelsFetchPromise;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function fmtDamage(value) {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1);
}

function weaponGroup(weapon) {
  const key = CLASS_TO_GROUP[weapon?.class] || 'OTHER';
  return WEAPON_GROUPS.find(group => group.key === key) || { key, label: key };
}

function ammoType(weapon) {
  if (!weapon) return 'Unknown';
  if (weapon.ammo) return weapon.ammo;
  if (AMMO_BY_WEAPON[weapon.name]) return AMMO_BY_WEAPON[weapon.name];
  if (weapon.class === 'Shotgun') return '12 Gauge';
  if (weapon.class === 'Crossbow') return 'Bolt';
  return 'Unknown';
}

function compareByName(a, b) {
  return a.name.localeCompare(b.name);
}

function compareByCategory(a, b) {
  const ag = weaponGroup(a).key;
  const bg = weaponGroup(b).key;
  const order = (GROUP_ORDER[ag] ?? 99) - (GROUP_ORDER[bg] ?? 99);
  return order || compareByName(a, b);
}

function compareByAmmo(a, b) {
  const aa = ammoType(a);
  const ba = ammoType(b);
  const order = (AMMO_ORDER.indexOf(aa) === -1 ? 99 : AMMO_ORDER.indexOf(aa))
    - (AMMO_ORDER.indexOf(ba) === -1 ? 99 : AMMO_ORDER.indexOf(ba));
  return order || compareByCategory(a, b);
}

// DPS "cru" = baseDamage × rpm / 60 (sem armadura, sem multiplicadores de zona).
// Usado só pra ordenação rápida — comparação real com armor sai no comparador abaixo.
function rawDps(weapon) {
  if (!weapon?.rpm || !weapon?.baseDamage) return 0;
  return weapon.baseDamage * weapon.rpm / 60;
}

function sortWeapons(weapons) {
  return [...weapons].sort((a, b) => {
    if (state.sortBy === 'damage') return (b.baseDamage - a.baseDamage) || compareByCategory(a, b);
    if (state.sortBy === 'rpm') return ((b.rpm || 0) - (a.rpm || 0)) || compareByCategory(a, b);
    if (state.sortBy === 'dps') return (rawDps(b) - rawDps(a)) || compareByCategory(a, b);
    if (state.sortBy === 'ammo') return compareByAmmo(a, b);
    return compareByCategory(a, b);
  });
}

function defaultCompareWeapon(data, primaryId) {
  return data.weapons.find(w => w.name === 'AKM' && w.id !== primaryId)
    || data.weapons.find(w => weaponGroup(w).key === 'AR' && w.id !== primaryId)
    || data.weapons.find(w => w.id !== primaryId)
    || data.weapons[0];
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .map(s => s[0] || '')
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function weaponImage(weapon, className = '') {
  if (weapon.image) return `<img class="${className}" src="${escapeHTML(weapon.image)}" alt="">`;
  return `<div class="damage-weapon-placeholder ${className}">${escapeHTML(initials(weapon.name))}</div>`;
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

// Valor exibido em cada marcador da figura. Depende de state.targetMetric:
//   damage — dano por tiro
//   btk    — bullets to kill (100 HP), = ceil(100 / damage)
//   ttk    — time to kill (100 HP) em segundos, = (btk - 1) × fireInterval
function partTargetValue(data, weapon, part) {
  const damage = partDamage(data, weapon, part);
  if (state.targetMetric === 'btk') {
    if (damage <= 0) return null;
    return Math.ceil(100 / damage);
  }
  if (state.targetMetric === 'ttk') {
    if (damage <= 0 || !weapon?.fireInterval) return null;
    const btk = Math.ceil(100 / damage);
    return Math.max(0, btk - 1) * weapon.fireInterval;
  }
  return damage;
}

function fmtTargetValue(value, metric) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (metric === 'btk') return String(value);
  if (metric === 'ttk') {
    if (value === 0) return '0';
    if (value < 0.1) return value.toFixed(3) + 's';
    return value.toFixed(2) + 's';
  }
  return fmtDamage(value);
}

function optionButton(item, type) {
  const active = type === 'helmet' ? item.level === state.helmetLevel : item.level === state.vestLevel;
  const shortLabel = item.level ? `Lv ${item.level}` : 'None';
  return `<button class="damage-equipment-option${active ? ' active' : ''}" data-${type}="${item.level}" type="button">
    <div class="damage-equipment-icon">
      ${item.image ? `<img src="${item.image}" alt="">` : '<span class="damage-empty-equipment">0</span>'}
    </div>
    <span title="${escapeHTML(item.label)}">${shortLabel}</span>
  </button>`;
}

function brokenToggle(type) {
  const level = type === 'helmet' ? state.helmetLevel : state.vestLevel;
  const broken = type === 'helmet' ? state.helmetBroken : state.vestBroken;
  const disabled = level === 0;
  return `<label class="damage-broken-toggle${disabled ? ' disabled' : ''}${broken ? ' active' : ''}">
    <input type="checkbox" data-broken="${type}" ${broken ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
    <span>Broken</span>
  </label>`;
}

function weaponCard(weapon) {
  const activeA = weapon.id === state.weaponId;
  const activeB = weapon.id === state.compareWeaponId;
  const group = weaponGroup(weapon);
  const rpmText = weapon.rpm ? `${weapon.rpm} rpm` : '';
  const badge = activeA ? '<span class="damage-weapon-badge badge-a">A</span>'
              : activeB ? '<span class="damage-weapon-badge badge-b">B</span>'
              : '';
  return `<div class="damage-weapon-card${activeA ? ' active' : ''}${activeB ? ' compare-active' : ''}" data-weapon-id="${escapeHTML(weapon.id)}" draggable="true" tabindex="0" role="button" aria-label="Select ${escapeHTML(weapon.name)}">
    ${badge}
    ${weaponImage(weapon)}
    <span class="damage-weapon-name">${escapeHTML(weapon.name)}</span>
    <span class="damage-weapon-meta"><span>${group.label}</span><span>${escapeHTML(ammoType(weapon))}</span>${rpmText ? `<span>${rpmText}</span>` : ''}</span>
    <span class="damage-weapon-damage"><span>DMG</span><strong>${weapon.baseDamage}</strong></span>
  </div>`;
}

function filteredWeapons(data) {
  const q = state.query.trim().toLowerCase();
  const weapons = data.weapons.filter(w => {
    const matchesCategory = state.category === 'all' || weaponGroup(w).key === state.category;
    const matchesQuery = !q || w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });
  return sortWeapons(weapons);
}

// Versão "vazia" do target — usado quando nenhuma arma está selecionada.
// Reusa o corpo desenhado em renderTarget mas com markers mostrando "—" e toggle disabled.
function renderEmptyTarget() {
  return renderTargetInternal(null);
}

function renderTarget(data, weapon) {
  return renderTargetInternal({ data, weapon });
}

function renderTargetInternal(ctx) {
  const hasWeapon = !!ctx?.weapon;
  const markers = BODY_PARTS.map(part => {
    const value = hasWeapon ? fmtTargetValue(partTargetValue(ctx.data, ctx.weapon, part), state.targetMetric) : '—';
    const [x, y] = TARGET_MARKERS[part.key];
    return `<g class="target-damage-marker ${part.css}" data-part="${part.key}" transform="translate(${x} ${y})">
      <title>${escapeHTML(part.label)}</title>
      <rect x="-58" y="-27" width="116" height="54" rx="27" />
      <text data-part-damage="${part.key}" text-anchor="middle" dominant-baseline="central">${value}</text>
    </g>`;
  }).join('');

  const metricToggle = `<div class="damage-target-metric" role="tablist" aria-label="Target metric">
    ${TARGET_METRICS.map(metric => {
      const disabled = !hasWeapon || (metric.key === 'ttk' && !ctx.weapon.fireInterval);
      const active = state.targetMetric === metric.key;
      return `<button class="damage-target-metric-btn${active ? ' active' : ''}" data-target-metric="${metric.key}" type="button" role="tab" aria-selected="${active}" title="${escapeHTML(metric.tip)}" ${disabled ? 'disabled' : ''}>${metric.label}</button>`;
    }).join('')}
  </div>`;

  return `<div class="damage-target-wrap${hasWeapon ? '' : ' damage-target-wrap-empty'}">
    ${metricToggle}
    <div class="damage-target">
      <svg class="target-figure" viewBox="245 -60 560 1600" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="targetSkin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="oklch(0.68 0.07 58)" />
            <stop offset="1" stop-color="oklch(0.48 0.055 58)" />
          </linearGradient>
          <linearGradient id="targetCloth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="oklch(0.68 0.08 227)" />
            <stop offset="1" stop-color="oklch(0.52 0.075 227)" />
          </linearGradient>
          <linearGradient id="targetPlate" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="oklch(0.70 0.08 226)" />
            <stop offset="1" stop-color="oklch(0.55 0.075 226)" />
          </linearGradient>
          <linearGradient id="targetAccent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="oklch(0.74 0.13 286)" />
            <stop offset="1" stop-color="oklch(0.57 0.12 286)" />
          </linearGradient>
          <filter id="targetShadow" x="-25%" y="-10%" width="150%" height="130%">
            <feDropShadow dx="0" dy="14" stdDeviation="13" flood-color="black" flood-opacity="0.34" />
          </filter>
        </defs>
        <g class="target-scale">
          <ellipse class="target-ground" cx="512" cy="1487" rx="190" ry="24" />
          <g class="target-body" filter="url(#targetShadow)">
            <path class="target-zone target-zone-head" d="M497 46L475 53 467 58 456 69 449 81 444 98 443 126 447 148 452 160 458 185 463 195 472 204 485 211 497 214 514 214 528 210 539 204 549 194 554 184 559 161 567 140 569 121 568 100 564 84 559 74 547 60 524 48 515 46Z"/>
            <path class="target-zone target-zone-neck" d="M466 222L463 251 467 256 494 263 517 263 536 259 548 253 549 247 546 223 542 218 512 226 492 225 473 218 468 219Z"/>
            <path class="target-zone target-zone-chest" d="M383 292L380 300 380 331 383 359 394 399 402 421 407 427 415 429 477 424 534 424 601 428 607 424 623 380 630 344 631 299 626 289 619 284 585 270 562 264 552 265 527 273 512 275 489 274 463 266 449 264 432 268 405 278 389 286Z"/>
            <path class="target-zone target-zone-arm" d="M356 291L339 293 328 299 316 313 309 336 308 371 302 433 301 486 306 493 337 499 345 498 351 489 363 436 369 395 370 347 368 301 362 293Z"/>
            <path class="target-zone target-zone-arm" d="M657 291L648 294 643 301 641 388 646 427 660 491 665 498 673 499 704 493 709 486 709 445 703 379 702 339 697 318 690 306 676 295 668 292Z"/>
            <path class="target-zone target-zone-stomach" d="M408 445L406 450 406 473 409 525 411 540 415 545 429 548 551 549 591 547 599 541 602 517 605 456 604 447 600 442 596 440 567 437 495 435 424 439 413 441Z"/>
            <path class="target-zone target-zone-forearm" d="M302 505L297 508 294 515 286 559 283 599 283 672 288 678 313 682 319 678 338 602 345 557 346 517 342 512 337 510Z"/>
            <path class="target-zone target-zone-forearm" d="M709 505L673 510 667 513 664 519 666 564 673 606 691 679 697 682 721 678 727 671 727 599 725 567 716 514 714 509Z"/>
            <path class="target-zone target-zone-stomach" d="M412 563L409 574 406 608 405 655 408 662 413 667 434 674 454 677 523 679 555 677 579 673 595 668 603 660 605 655 604 603 601 570 596 561 591 559 554 561 457 561 419 559Z"/>
            <path class="target-zone target-zone-pelvis" d="M388 717L388 729 392 735 431 751 459 770 483 791 499 797 512 797 525 793 562 762 589 745 618 733 622 727 622 716 616 695 608 684 600 681 562 688 522 691 455 689 410 681 403 683 396 691Z"/>
            <path class="target-zone target-zone-hand" d="M724 690L703 692 697 695 695 712 688 728 684 743 684 778 686 789 689 792 695 791 697 787 698 762 701 757 705 760 707 766 707 788 701 816 701 826 703 829 708 829 718 814 727 796 734 767 730 701 727 692Z"/>
            <path class="target-zone target-zone-hand" d="M286 690L283 692 280 699 275 754 276 771 281 793 290 812 301 829 306 829 309 820 302 786 303 763 307 757 311 760 312 786 316 792 321 792 325 784 325 739 315 714 314 697 312 694 295 690Z"/>
            <path class="target-zone target-zone-thigh" d="M620 748L611 748 598 753 571 769 552 784 534 802 527 815 526 840 544 996 546 1002 555 1008 607 1005 614 1002 618 996 626 933 631 860 631 802 629 769 627 756Z"/>
            <path class="target-zone target-zone-thigh" d="M393 750L390 751 384 759 380 800 381 887 392 995 398 1003 403 1005 455 1008 463 1004 467 994 483 865 485 819 477 802 453 779 433 765 414 755 403 751Z"/>
            <path class="target-zone target-zone-calf" d="M610 1017L556 1020 550 1025 545 1098 546 1133 558 1218 563 1276 566 1280 572 1282 603 1281 608 1275 625 1126 624 1079 618 1027 615 1020Z"/>
            <path class="target-zone target-zone-calf" d="M400 1017L394 1022 391 1038 385 1094 385 1127 402 1277 407 1281 438 1282 442 1281 447 1274 451 1225 464 1137 465 1091 461 1027 459 1023 454 1020Z"/>
            <path class="target-zone target-zone-foot" d="M409 1293L403 1298 401 1338 398 1357 390 1389 380 1414 378 1427 384 1435 394 1440 405 1443 426 1445 436 1443 441 1440 447 1433 450 1422 448 1398 449 1349 446 1299 439 1293Z"/>
            <path class="target-zone target-zone-foot" d="M570 1293L566 1295 563 1300 562 1340 560 1351 561 1399 559 1411 561 1430 568 1440 577 1444 588 1445 609 1442 624 1436 630 1430 631 1421 619 1388 613 1365 608 1336 606 1297 600 1293Z"/>
          </g>
          ${markers}
        </g>
      </svg>
    </div>
  </div>`;
}

function updateDistanceDamage(container, data) {
  const weapon = data.weapons.find(w => w.id === state.weaponId) || null;
  const distanceLabel = container.querySelector('[data-distance-value]');
  if (distanceLabel) distanceLabel.textContent = `${state.distance}m`;
  for (const part of BODY_PARTS) {
    const value = container.querySelector(`[data-part-damage="${part.key}"]`);
    if (!value) continue;
    value.textContent = weapon ? fmtTargetValue(partTargetValue(data, weapon, part), state.targetMetric) : '—';
  }
}

function btkForDamage(damage) {
  return damage > 0 ? Math.ceil(100 / damage) : null;
}
function ttkForWeaponPart(data, weapon, part) {
  if (!weapon?.fireInterval) return null;
  const dmg = partDamage(data, weapon, part);
  const btk = btkForDamage(dmg);
  if (btk == null) return null;
  return Math.max(0, btk - 1) * weapon.fireInterval;
}

// Compara dois valores e retorna 'A', 'B', 'tie' indicando o vencedor.
// `lowerIsBetter`: pra métricas como TTK/BTK onde menor = melhor.
function compareWinner(a, b, lowerIsBetter = false) {
  if (a == null && b == null) return 'tie';
  if (a == null) return 'B';
  if (b == null) return 'A';
  const diff = a - b;
  if (Math.abs(diff) < 0.001) return 'tie';
  if (lowerIsBetter) return diff < 0 ? 'A' : 'B';
  return diff > 0 ? 'A' : 'B';
}

function fmtStat(value, kind) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (kind === 'btk') return String(value);
  if (kind === 'ttk') {
    if (value === 0) return '0';
    return value < 0.1 ? value.toFixed(3) + 's' : value.toFixed(2) + 's';
  }
  if (kind === 'int') return String(Math.round(value));
  return fmtDamage(value);
}

function buildCompareStats(data, weapon) {
  const chest = BODY_PARTS.find(p => p.key === 'chest');
  const head = BODY_PARTS.find(p => p.key === 'head');
  return {
    base: { value: weapon.baseDamage, kind: 'int' },
    rpm:  { value: weapon.rpm ?? null, kind: 'int' },
    speed: { value: weapon.initialSpeed || null, kind: 'int' },
    chestDmg: { value: partDamage(data, weapon, chest), kind: 'dmg' },
    headDmg:  { value: partDamage(data, weapon, head),  kind: 'dmg' },
    ttkChest: { value: ttkForWeaponPart(data, weapon, chest), kind: 'ttk', lowerBetter: true },
    ttkHead:  { value: ttkForWeaponPart(data, weapon, head),  kind: 'ttk', lowerBetter: true },
    btkChest: { value: btkForDamage(partDamage(data, weapon, chest)), kind: 'btk', lowerBetter: true },
    btkHead:  { value: btkForDamage(partDamage(data, weapon, head)),  kind: 'btk', lowerBetter: true },
  };
}

const COMPARE_STAT_ROWS = [
  { key: 'base',     label: 'Base dmg' },
  { key: 'rpm',      label: 'RPM' },
  { key: 'chestDmg', label: 'Chest dmg' },
  { key: 'headDmg',  label: 'Head dmg' },
];

function renderEmptyCompareCard(slot) {
  return `<div class="compare-card compare-card-empty" data-compare-slot="${slot}">
    <div class="compare-card-slot">SLOT ${slot}</div>
    <div class="compare-card-empty-body">
      <div class="compare-card-empty-icon">+</div>
      <strong>Drop a weapon here</strong>
      <span>or click a weapon below to set as A</span>
    </div>
  </div>`;
}

function renderCompareCard(data, weapon, otherWeapon, slot) {
  if (!weapon) return renderEmptyCompareCard(slot);
  const stats = buildCompareStats(data, weapon);
  const other = otherWeapon ? buildCompareStats(data, otherWeapon) : null;
  const rows = COMPARE_STAT_ROWS.map(row => {
    const me = stats[row.key];
    const op = other?.[row.key];
    const winner = op ? compareWinner(me.value, op.value, !!me.lowerBetter) : 'tie';
    const myTag = !other ? 'tie' : (winner === slot ? 'win' : winner === 'tie' ? 'tie' : 'lose');
    return `<div class="compare-stat compare-stat-${myTag}">
      <span class="compare-stat-label">${row.label}</span>
      <span class="compare-stat-value">${fmtStat(me.value, me.kind)}</span>
    </div>`;
  }).join('');

  return `<div class="compare-card" data-compare-slot="${slot}" data-weapon-id="${escapeHTML(weapon.id)}">
    <div class="compare-card-slot">SLOT ${slot}</div>
    <div class="compare-card-head">
      ${weaponImage(weapon, 'compare-card-img')}
      <div class="compare-card-id">
        <strong>${escapeHTML(weapon.name)}</strong>
        <span>${weaponGroup(weapon).label} · ${escapeHTML(ammoType(weapon))}</span>
      </div>
      <button class="compare-card-clear" type="button" data-compare-clear="${slot}" title="Remove from slot">×</button>
    </div>
    <div class="compare-card-stats">${rows}</div>
  </div>`;
}

function renderComparator(data, weapon, compareWeapon, duels) {
  const canSwap = !!(weapon && compareWeapon);
  const duelHtml = (weapon && compareWeapon)
    ? renderComparatorDuel(duels, weapon, compareWeapon)
    : '';
  return `<section class="damage-comparator">
    <div class="damage-comparator-header">
      <div class="micro">COMPARATOR</div>
      <div class="damage-comparator-actions">
        <button class="damage-comparator-swap" type="button" data-compare-swap title="Swap A and B" ${canSwap ? '' : 'disabled'}>↔</button>
      </div>
    </div>
    <div class="damage-comparator-grid">
      ${renderCompareCard(data, weapon, compareWeapon, 'A')}
      ${renderCompareCard(data, compareWeapon, weapon, 'B')}
    </div>
    ${duelHtml}
  </section>`;
}

// Confronto direto A vs B a partir das telemetrias (quantas vezes cada uma
// matou alguém segurando a outra). Retorna null se não houver dados do par.
function getDuelHeadToHead(duels, weaponA, weaponB) {
  if (!duels || !weaponA || !weaponB) return null;
  // weapon-stats id = "Item_Weapon_HK416_C"; insights usa "WeapHK416_C".
  const aWeapKey = weaponA.id.replace(/^Item_Weapon_/, 'Weap');
  const bWeapKey = weaponB.id.replace(/^Item_Weapon_/, 'Weap');
  const aEntry = duels.byId.get(weaponA.id);
  const bEntry = duels.byId.get(weaponB.id);
  const aWins = aEntry?.duels?.[bWeapKey] || 0;
  const bWins = bEntry?.duels?.[aWeapKey] || 0;
  if (aWins === 0 && bWins === 0) return null;
  return { aWins, bWins, total: aWins + bWins };
}

function renderComparatorDuel(duels, weaponA, weaponB) {
  const h2h = getDuelHeadToHead(duels, weaponA, weaponB);
  if (!h2h) return '';
  const { aWins, bWins, total } = h2h;
  const aPct = total > 0 ? (aWins / total) * 100 : 50;
  const bPct = 100 - aPct;
  return `<div class="compare-duel">
    <div class="compare-duel-title">Head-to-head <span>${total.toLocaleString()} trocas em telemetria</span></div>
    <div class="compare-duel-bar">
      <div class="compare-duel-fill-a" style="width:${aPct}%"></div>
      <div class="compare-duel-fill-b" style="width:${bPct}%"></div>
    </div>
    <div class="compare-duel-legend">
      <span class="compare-duel-a">${escapeHTML(weaponA.name)} <strong>${aWins.toLocaleString()}</strong> (${aPct.toFixed(0)}%)</span>
      <span class="compare-duel-b"><strong>${bWins.toLocaleString()}</strong> ${escapeHTML(weaponB.name)} (${bPct.toFixed(0)}%)</span>
    </div>
  </div>`;
}

function renderHTML(data, duels) {
  const weapon = data.weapons.find(w => w.id === state.weaponId) || null;
  const compareWeapon = data.weapons.find(w => w.id === state.compareWeaponId) || null;
  const equipment = selectedEquipment(data);
  const weapons = filteredWeapons(data);
  const categoryCounts = data.weapons.reduce((acc, item) => {
    const key = weaponGroup(item).key;
    acc.all = (acc.all || 0) + 1;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return `<div class="damage-page">
    <div class="damage-workbench">
      <aside class="damage-target-column">
        <section class="damage-target-panel">
          ${weapon ? renderTarget(data, weapon) : renderEmptyTarget()}
        </section>

        <section class="damage-selected-card">
          ${weapon ? `
            ${weaponImage(weapon, 'damage-selected-card-img')}
            <div class="damage-selected-card-info">
              <strong>${escapeHTML(weapon.name)}</strong>
              <span>${weaponGroup(weapon).label} · ${escapeHTML(ammoType(weapon))} · ${weapon.baseDamage} dmg${weapon.rpm ? ` · ${weapon.rpm} rpm` : ''}</span>
            </div>
          ` : `
            <div class="damage-selected-card-info">
              <strong>No weapon selected</strong>
              <span>click or drag a weapon below</span>
            </div>
          `}
        </section>
      </aside>

      <div class="damage-middle-column">
        <section class="damage-controls-stack">
          <div class="damage-controls-distance">
            <div class="micro">DISTANCE</div>
            <strong data-distance-value>${state.distance}m</strong>
            <input id="damage-distance" type="range" min="0" max="1000" step="5" value="${state.distance}">
          </div>

          <div class="damage-controls-group">
            <div class="micro">HELMET</div>
            <div class="damage-equipment-list">
              ${data.equipment.helmets.map(item => optionButton(item, 'helmet')).join('')}
            </div>
          </div>

          <div class="damage-controls-group">
            <div class="micro">VEST</div>
            <div class="damage-equipment-list">
              ${data.equipment.vests.map(item => optionButton(item, 'vest')).join('')}
            </div>
            ${brokenToggle('vest')}
          </div>
        </section>

        ${renderComparator(data, weapon, compareWeapon, duels)}
      </div>

      <section class="damage-weapons-section">
        <div class="damage-weapons-toolbar">
          <div class="damage-category-tabs">
            ${WEAPON_GROUPS.map(group => `<button class="${state.category === group.key ? 'active' : ''}" data-category="${group.key}" type="button"><span>${group.label}</span><strong>${categoryCounts[group.key] || 0}</strong></button>`).join('')}
          </div>
          <div class="damage-toolbar-actions">
            <label class="damage-sort-control">
              <span>Sort</span>
              <select id="damage-sort">
                ${SORT_OPTIONS.map(option => `<option value="${option.key}" ${state.sortBy === option.key ? 'selected' : ''}>${option.label}</option>`).join('')}
              </select>
            </label>
            <input id="damage-weapon-search" value="${escapeHTML(state.query)}" placeholder="Search weapon" autocomplete="off">
          </div>
        </div>
        <div class="damage-weapon-grid">
          ${weapons.map(weaponCard).join('') || '<div class="damage-empty-list">No weapons found.</div>'}
        </div>
      </section>
    </div>
  </div>`;
}

function bind(container, data, duels) {
  // Helper local pra evitar passar `duels` em todas as 12+ chamadas.
  const rerender = () => renderLoaded(container, data, duels);
  container.querySelector('#damage-distance')?.addEventListener('input', e => {
    state.distance = Number(e.target.value);
    updateDistanceDamage(container, data);
  });
  container.querySelector('#damage-distance')?.addEventListener('change', e => {
    state.distance = Number(e.target.value);
    rerender();
  });
  container.querySelectorAll('[data-helmet]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.helmetLevel = Number(btn.dataset.helmet);
      rerender();
    });
  });
  container.querySelectorAll('[data-vest]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.vestLevel = Number(btn.dataset.vest);
      if (state.vestLevel === 0) state.vestBroken = false;
      rerender();
    });
  });
  container.querySelectorAll('[data-broken]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.dataset.broken === 'vest') state.vestBroken = input.checked;
      rerender();
    });
  });
  container.querySelectorAll('[data-target-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const metric = btn.dataset.targetMetric;
      if (metric === state.targetMetric) return;
      state.targetMetric = TARGET_METRICS.some(m => m.key === metric) ? metric : 'damage';
      // Toggle local sem full re-render: atualiza botões + valores
      container.querySelectorAll('[data-target-metric]').forEach(b => {
        const isActive = b.dataset.targetMetric === state.targetMetric;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      updateDistanceDamage(container, data);
    });
  });
  container.querySelectorAll('.damage-weapon-card[data-weapon-id]').forEach(card => {
    card.addEventListener('click', () => {
      state.weaponId = card.dataset.weaponId;
      rerender();
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        state.weaponId = card.dataset.weaponId;
        rerender();
      }
    });
    card.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', card.dataset.weaponId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  container.querySelectorAll('.compare-card[data-compare-slot]').forEach(slot => {
    slot.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      slot.classList.add('drop-target');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drop-target');
      const weaponId = e.dataTransfer.getData('text/plain');
      if (!weaponId || !data.weapons.some(w => w.id === weaponId)) return;
      const targetSlot = slot.dataset.compareSlot;
      const otherKey = targetSlot === 'A' ? 'compareWeaponId' : 'weaponId';
      const targetKey = targetSlot === 'A' ? 'weaponId' : 'compareWeaponId';
      // Se a arma já está no outro slot, faz swap
      if (state[otherKey] === weaponId) state[otherKey] = state[targetKey];
      state[targetKey] = weaponId;
      rerender();
    });
  });
  container.querySelectorAll('[data-compare-clear]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slot = btn.dataset.compareClear;
      if (slot === 'A') state.weaponId = '';
      else state.compareWeaponId = '';
      rerender();
    });
  });
  container.querySelector('[data-compare-swap]')?.addEventListener('click', () => {
    if (!state.weaponId || !state.compareWeaponId) return;
    const tmp = state.weaponId;
    state.weaponId = state.compareWeaponId;
    state.compareWeaponId = tmp;
    rerender();
  });
  container.querySelectorAll('[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.category = btn.dataset.category;
      rerender();
    });
  });
  container.querySelector('#damage-sort')?.addEventListener('change', e => {
    state.sortBy = e.target.value;
    rerender();
  });
  container.querySelector('#damage-weapon-search')?.addEventListener('input', e => {
    state.query = e.target.value;
    rerender();
    const input = container.querySelector('#damage-weapon-search');
    input?.focus();
    input?.setSelectionRange(state.query.length, state.query.length);
  });
}

function renderLoaded(container, data, duels) {
  container.innerHTML = renderHTML(data, duels);
  bind(container, data, duels);
}

export async function renderWeaponStatsPage(container) {
  if (!container) return;
  container.innerHTML = `<div class="damage-page"><div class="career-skeleton skel"></div></div>`;
  try {
    // Insights são opcionais — se falhar, a seção de duelos só não aparece.
    const [data, duels] = await Promise.all([loadData(), loadDuels()]);
    renderLoaded(container, data, duels);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="damage-page"><div class="career-empty"><div class="career-empty-label">DATA ERROR</div><div class="career-empty-message">Could not load weapon stats.</div></div></div>`;
  }
}
