import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const weaponsDir = path.join(rootDir, 'Blueprints', 'Weapons');
const dataAssetsDir = path.join(weaponsDir, 'DataAssets');
const ballisticDir = path.join(weaponsDir, 'BallisticData');
const damageConfigPath = path.join(rootDir, 'Blueprints', 'DamageConfigs', 'DefaultDamageConfig.json');
const itemDictPath = path.join(rootDir, 'pubg-api-assets', 'dictionaries', 'telemetry', 'item', 'itemId.json');
const iconRoot = path.join(rootDir, 'pubg-api-assets', 'Assets', 'Icons', 'Item', 'Weapon');
const outputDir = path.join(rootDir, 'public', 'data');
const outputFile = path.join(outputDir, 'weapon-stats.json');

const IMAGE_PREFIX = '/pubg-api-assets/Assets/Icons/Item';
const ARMOR_DAMAGE_REDUCTION = { 1: 0.30, 2: 0.40, 3: 0.55 };
// Vest quebrado: redução residual de 20% (factor 0.80), INDEPENDENTE do nível original.
// Descoberto empiricamente em ~700 amostras de telemetria (scripts/validate-damage-formula.js).
const BROKEN_VEST_REDUCTION = 0.20;
// Capacete quebrado: voa da cabeça do personagem (visual confirmation), proteção = 0.
const BROKEN_HELMET_REDUCTION = 0;
const HEADSHOT_MULTIPLIER_OVERRIDES = {
  Item_Weapon_Dragunov_C: 2.8,
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function defaultObject(entries) {
  return entries.find(o => o.Name?.startsWith('Default__')) || entries[1] || entries[0];
}

function assetName(ref) {
  return ref?.ObjectName?.match(/'([^']+)'/)?.[1] || '';
}

function className(value) {
  return String(value || '').split('::').pop()?.replace('Class_', '') || '';
}

function normalizeId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function publicIconPath(kind, fileName) {
  return `${IMAGE_PREFIX}/Weapon/${kind}/${fileName}`;
}

function readIconIndex() {
  const iconFiles = [];
  for (const kind of ['Main', 'Handgun', 'Melee']) {
    const dir = path.join(iconRoot, kind);
    if (!fs.existsSync(dir)) continue;
    for (const fileName of fs.readdirSync(dir).filter(f => f.endsWith('.png'))) {
      const itemId = fileName.replace(/\.png$/, '');
      iconFiles.push({ kind, fileName, itemId, norm: normalizeId(itemId.replace(/^Item_Weapon_/, '').replace(/_C$/, '')) });
    }
  }
  return iconFiles;
}

function resolveWeaponIcon(fileBase, iconIndex) {
  const overrides = {
    WeapCrossbow_1: 'Item_Weapon_Crossbow_C',
    WeapFamasG2: 'Item_Weapon_FAMASG2_C',
    WeapMosinNagant: 'Item_Weapon_Mosin_C',
    WeapSawnOff: 'Item_Weapon_Sawnoff_C',
    WeapWin94: 'Item_Weapon_Win1894_C',
    Weapvz61Skorpion: 'Item_Weapon_vz61Skorpion_C',
  };
  const wanted = overrides[fileBase];
  if (wanted) return iconIndex.find(i => i.itemId === wanted) || null;

  const norm = normalizeId(fileBase.replace(/^Weap/, ''));
  return iconIndex.find(i => i.norm === norm) || null;
}

function curveKeys(curve) {
  return (curve?.Keys || []).map(k => ({
    time: Number(k.Time),
    value: Number(k.Value),
    interp: k.InterpMode || 'RCIM_Linear',
    arriveTangent: Number(k.ArriveTangent || 0),
    leaveTangent: Number(k.LeaveTangent || 0),
  }));
}

function ballisticDamageCurve(ballisticName) {
  if (!ballisticName) return [];
  const file = path.join(ballisticDir, `${ballisticName}.json`);
  if (!fs.existsSync(file)) return [];
  const props = readJson(file)[0]?.Properties || {};
  const curves = Object.values(props).filter(v => v && Array.isArray(v.Keys));
  return curveKeys(curves[1] || curves[0]);
}

function weaponTrajectoryData(trajName) {
  if (!trajName) return null;
  const file = path.join(dataAssetsDir, `${trajName}.json`);
  if (!fs.existsSync(file)) return null;
  const props = readJson(file)[0]?.Properties || {};
  // O bloco aninhado é identificado pelo campo *e1e3aec97a (= baseDamage). InitialSpeed só existe
  // em armas com balística customizada (a maioria), mas Vector/JS9 e algumas outras não têm — então
  // não exigimos InitialSpeed.
  return Object.values(props).find(v =>
    v && typeof v === 'object' &&
    typeof v['*e1e3aec97a'] === 'number'
  ) || null;
}

// Lê o WeaponGunData de uma arma e retorna o bloco com TimeBetweenShots, magazine size, etc.
// Confirmado: o nested object com TimeBetweenShots é o "gunplay block". O nome do asset bate com
// o fileBase da weapon (ex.: WeapBerylM762 → WeapBerylM762_WeaponGunData.json).
function weaponGunData(fileBase) {
  if (!fileBase) return null;
  const file = path.join(dataAssetsDir, `${fileBase}_WeaponGunData.json`);
  if (!fs.existsSync(file)) return null;
  const props = readJson(file)[0]?.Properties || {};
  return Object.values(props).find(v =>
    v && typeof v === 'object' && typeof v.TimeBetweenShots === 'number'
  ) || null;
}

function extractWeapons() {
  const itemNames = fs.existsSync(itemDictPath) ? readJson(itemDictPath) : {};
  const iconIndex = readIconIndex();
  const seen = new Set();
  const out = [];

  for (const file of fs.readdirSync(weaponsDir).filter(f => /^Weap.*\.json$/.test(f))) {
    const fileBase = file.replace(/\.json$/, '');
    if (/Testing|Test|Duncan|Julie|Lunchmeat|Mads|Planted|Defusing|Spare|Spike|Stun|Zipline|Flare|Panzer|Mortar|Bomb|BZGL/i.test(fileBase)) continue;

    const entry = defaultObject(readJson(path.join(weaponsDir, file)));
    const props = entry?.Properties || {};
    const trajectory = weaponTrajectoryData(assetName(props.WeaponTrajectoryData));
    if (!trajectory) continue;

    const icon = resolveWeaponIcon(fileBase, iconIndex);
    const cls = className(props.WeaponConfig?.['*6f6b05f0e9']);
    const ballisticName = assetName(trajectory['*73867de22e']);
    const damageCurve = ballisticDamageCurve(ballisticName);
    const gunData = weaponGunData(fileBase);
    const timeBetweenShots = gunData ? Number(gunData.TimeBetweenShots) : 0;

    // Inferir itemId: pelo ícone se houver; senão `Item_Weapon_<fileBase sem Weap>_C` (bate com o dicionário de telemetria).
    const baseNoPrefix = fileBase.replace(/^Weap/, '');
    const itemId = icon?.itemId || `Item_Weapon_${baseNoPrefix}_C`;
    if (seen.has(itemId)) continue;
    seen.add(itemId);

    const kind = icon?.kind || (cls === 'Pistol' ? 'Handgun' : cls === 'Melee' ? 'Melee' : 'Main');
    out.push({
      id: itemId,
      name: itemNames[itemId] || props['*709b93d2ba'] || baseNoPrefix,
      class: cls || (kind === 'Handgun' ? 'Pistol' : 'Unknown'),
      category: kind,
      baseDamage: Number(trajectory['*e1e3aec97a']),
      headshotMultiplier: HEADSHOT_MULTIPLIER_OVERRIDES[itemId] || null,
      initialSpeed: Number(trajectory.InitialSpeed || 0),
      // Cadência: tempo entre disparos (s) e RPM derivado. Vem de WeaponGunData.TimeBetweenShots,
      // que é o intervalo do FullAuto/single da arma — não inclui delay de burst-end.
      fireInterval: timeBetweenShots || null,
      rpm: timeBetweenShots > 0 ? Math.round(60 / timeBetweenShots) : null,
      rangeModifier: Number(trajectory.RangeModifier ?? 1),
      referenceDistance: Number(trajectory.ReferenceDistance ?? 0),
      travelDistanceMax: Number(trajectory.TravelDistanceMax ?? 1000),
      damageCurve: damageCurve.length ? damageCurve : [{ time: 0, value: 1, interp: 'RCIM_Linear', arriveTangent: 0, leaveTangent: 0 }],
      image: icon ? publicIconPath(icon.kind, icon.fileName) : null,
      source: {
        weapon: `Blueprints/Weapons/${file}`,
        trajectory: `Blueprints/Weapons/DataAssets/${assetName(props.WeaponTrajectoryData)}.json`,
        ballistic: ballisticName ? `Blueprints/Weapons/BallisticData/${ballisticName}.json` : null,
      },
    });
  }

  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function parseDamageZones() {
  const props = readJson(damageConfigPath)[0]?.Properties || {};
  const zoneEntries = Object.values(props).find(v =>
    Array.isArray(v) && v.some(entry => String(entry.Key || '').startsWith('EDamageZoneType::'))
  ) || [];

  return zoneEntries.map(entry => {
    const value = entry.Value || {};
    const arrays = Object.values(value).filter(Array.isArray);
    const bones = arrays.find(arr => arr.some(x => typeof x.Key === 'string' && !x.Key.includes('::'))) || [];
    const classMultipliers = arrays.find(arr => arr.some(x => String(x.Key || '').startsWith('EWeaponClass::'))) || [];
    const equipSlot = Object.values(value).find(v => typeof v === 'string' && v.startsWith('EEquipSlotID::')) || 'EEquipSlotID::MaxOrNone';
    return {
      zone: String(entry.Key).split('::').pop(),
      equipSlot: equipSlot.split('::').pop(),
      damageReason: String(value.DamageReason || '').split('::').pop(),
      bones: bones.map(x => ({ name: x.Key, multiplier: Number(x.Value) })),
      classMultipliers: Object.fromEntries(classMultipliers.map(x => [className(x.Key), Number(x.Value)])),
    };
  });
}

// Durabilidades dos game files (TestItems/Equip). Hardcoded porque essa pasta não vem no dump
// da Blueprints/ — os valores são estáveis há vários patches. As reductions já estão em
// ARMOR_DAMAGE_REDUCTION acima.
const HELMET_DURABILITY = { 1: 80, 2: 150, 3: 230 };
const VEST_DURABILITY = { 1: 200, 2: 220, 3: 250 };

function extractEquipment() {
  const helmetIcons = [
    null,
    'Equipment/Headgear/Item_Head_E_00_Lv1_C.png',
    'Equipment/Headgear/Item_Head_F_00_Lv2_C.png',
    'Equipment/Headgear/Item_Head_G_00_Lv3_C.png',
  ];
  const vestIcons = [
    null,
    'Equipment/Vest/Item_Armor_E_00_Lv1_C.png',
    'Equipment/Vest/Item_Armor_D_00_Lv2_C.png',
    'Equipment/Vest/Item_Armor_C_00_Lv3_C.png',
  ];

  return {
    helmets: [0, 1, 2, 3].map(level => ({
      id: `helmet-${level}`,
      level,
      label: level ? `Helmet ${level}` : 'No Helmet',
      image: helmetIcons[level] ? `${IMAGE_PREFIX}/Equipment/${helmetIcons[level].replace(/^Equipment\//, '')}` : null,
      durability: HELMET_DURABILITY[level] || 0,
      reduction: ARMOR_DAMAGE_REDUCTION[level] || 0,
    })),
    vests: [0, 1, 2, 3].map(level => ({
      id: `vest-${level}`,
      level,
      label: level ? `Vest ${level}` : 'No Vest',
      image: vestIcons[level] ? `${IMAGE_PREFIX}/Equipment/${vestIcons[level].replace(/^Equipment\//, '')}` : null,
      durability: VEST_DURABILITY[level] || 0,
      reduction: ARMOR_DAMAGE_REDUCTION[level] || 0,
    })),
  };
}

if (!fs.existsSync(weaponsDir)) {
  console.warn(`[build-weapon-stats] Pasta de game files não encontrada: ${path.relative(rootDir, weaponsDir)}`);
  console.warn(`[build-weapon-stats] Extraia o conteúdo de TslGame/Content/Blueprints (Weapons + DamageConfigs) via FModel`);
  console.warn(`[build-weapon-stats] e salve no diretório Blueprints/ na raiz do projeto antes de re-rodar.`);
  console.warn(`[build-weapon-stats] Pulando — o weapon-stats.json existente continua válido.`);
  process.exit(0);
}

const data = {
  generatedAt: new Date().toISOString(),
  distanceUnit: 'm',
  // Reduções de armadura aplicadas no cálculo final: damage = base × class × bone × distFactor × (1 - reduction).
  // Para armadura QUEBRADA (durability=0 mas ainda vestida), a redução fica 0.20 fixa para colete (qualquer nível);
  // para capacete quebrado, validado em poucas amostras — assumimos o mesmo behavior até ter mais dados.
  brokenArmor: {
    vestReduction: BROKEN_VEST_REDUCTION,
    helmetReduction: BROKEN_HELMET_REDUCTION,
    note: 'Broken helmet is removed from the character (protection=0). Broken vest remains equipped with a fixed 0.20 reduction regardless of original level.',
  },
  weapons: extractWeapons(),
  equipment: extractEquipment(),
  damageZones: parseDamageZones(),
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(rootDir, outputFile)} with ${data.weapons.length} weapons`);
