import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const weaponsDir = path.join(rootDir, 'weapons', 'TslGame', 'Content', 'Blueprints', 'Weapons');
const dataAssetsDir = path.join(weaponsDir, 'DataAssets');
const ballisticDir = path.join(weaponsDir, 'BallisticData');
const damageConfigPath = path.join(rootDir, 'weapons', 'TslGame', 'Content', 'Blueprints', 'DamageConfigs', 'DefaultDamageConfig.json');
const equipDir = path.join(rootDir, 'weapons', 'TslGame', 'Content', 'Item', 'TestItems', 'Equip');
const itemDictPath = path.join(rootDir, 'pubg-api-assets', 'dictionaries', 'telemetry', 'item', 'itemId.json');
const iconRoot = path.join(rootDir, 'pubg-api-assets', 'Assets', 'Icons', 'Item', 'Weapon');
const outputDir = path.join(rootDir, 'public', 'data');
const outputFile = path.join(outputDir, 'weapon-stats.json');

const IMAGE_PREFIX = '/pubg-api-assets/Assets/Icons/Item';
const ARMOR_DAMAGE_REDUCTION = { 1: 0.30, 2: 0.40, 3: 0.55 };
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
  return Object.values(props).find(v =>
    v && typeof v === 'object' &&
    typeof v.InitialSpeed === 'number' &&
    typeof v['*e1e3aec97a'] === 'number'
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
    const icon = resolveWeaponIcon(fileBase, iconIndex);
    if (!icon || seen.has(icon.itemId)) continue;

    const trajectory = weaponTrajectoryData(assetName(props.WeaponTrajectoryData));
    if (!trajectory) continue;

    const cls = className(props.WeaponConfig?.['*6f6b05f0e9']);
    const ballisticName = assetName(trajectory['*73867de22e']);
    const damageCurve = ballisticDamageCurve(ballisticName);

    seen.add(icon.itemId);
    out.push({
      id: icon.itemId,
      name: itemNames[icon.itemId] || props['*709b93d2ba'] || fileBase.replace(/^Weap/, ''),
      class: cls || (icon.kind === 'Handgun' ? 'Pistol' : 'Unknown'),
      category: icon.kind,
      baseDamage: Number(trajectory['*e1e3aec97a']),
      headshotMultiplier: HEADSHOT_MULTIPLIER_OVERRIDES[icon.itemId] || null,
      initialSpeed: Number(trajectory.InitialSpeed || 0),
      rangeModifier: Number(trajectory.RangeModifier ?? 1),
      referenceDistance: Number(trajectory.ReferenceDistance ?? 0),
      travelDistanceMax: Number(trajectory.TravelDistanceMax ?? 1000),
      damageCurve: damageCurve.length ? damageCurve : [{ time: 0, value: 1, interp: 'RCIM_Linear', arriveTangent: 0, leaveTangent: 0 }],
      image: publicIconPath(icon.kind, icon.fileName),
      source: {
        weapon: `weapons/TslGame/Content/Blueprints/Weapons/${file}`,
        trajectory: `weapons/TslGame/Content/Blueprints/Weapons/DataAssets/${assetName(props.WeaponTrajectoryData)}.json`,
        ballistic: ballisticName ? `weapons/TslGame/Content/Blueprints/Weapons/BallisticData/${ballisticName}.json` : null,
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

function equipmentValue(fileName) {
  const props = defaultObject(readJson(path.join(equipDir, fileName)))?.Properties || {};
  return {
    reduction: Number(props['*e8f64df1c2'] || 0),
    durability: Number(props['*61b8a90d8f'] || 0),
  };
}

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
      label: level ? `Capacete ${level}` : 'Sem Capacete',
      image: helmetIcons[level] ? `${IMAGE_PREFIX}/Equipment/${helmetIcons[level].replace(/^Equipment\//, '')}` : null,
      ...(level ? equipmentValue(`Item_Equip_Helmet_Lv${level}.json`) : { durability: 0 }),
      reduction: ARMOR_DAMAGE_REDUCTION[level] || 0,
    })),
    vests: [0, 1, 2, 3].map(level => ({
      id: `vest-${level}`,
      level,
      label: level ? `Colete ${level}` : 'Sem Colete',
      image: vestIcons[level] ? `${IMAGE_PREFIX}/Equipment/${vestIcons[level].replace(/^Equipment\//, '')}` : null,
      ...(level ? equipmentValue(`Item_Equip_Armor_Lv${level}.json`) : { durability: 0 }),
      reduction: ARMOR_DAMAGE_REDUCTION[level] || 0,
    })),
  };
}

const data = {
  generatedAt: new Date().toISOString(),
  distanceUnit: 'm',
  weapons: extractWeapons(),
  equipment: extractEquipment(),
  damageZones: parseDamageZones(),
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(rootDir, outputFile)} with ${data.weapons.length} weapons`);
