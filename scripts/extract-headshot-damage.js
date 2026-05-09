import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TELEMETRY_DIR = path.join(ROOT, 'public', 'jsons', 'matches');
const DEFAULT_OUT = path.join(ROOT, 'AI_training', 'headshot_damage_samples.json');
const ITEM_DICT = readOptionalJson(path.join(ROOT, 'pubg-api-assets', 'dictionaries', 'telemetry', 'item', 'itemId.json')) || {};
const DAMAGE_EPSILON = 0.02;

function parseArgs(argv) {
  const args = {
    telemetryDir: DEFAULT_TELEMETRY_DIR,
    out: DEFAULT_OUT,
    limit: 0,
    matchId: null,
    dryRun: false,
    positiveOnly: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--telemetry-dir') args.telemetryDir = path.resolve(next), i++;
    else if (arg === '--out') args.out = path.resolve(next), i++;
    else if (arg === '--limit') args.limit = Math.max(0, parseInt(next, 10) || 0), i++;
    else if (arg === '--match-id') args.matchId = next, i++;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--positive-only') args.positiveOnly = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/extract-headshot-damage.js [options]

Options:
  --telemetry-dir <dir>  Directory with telemetry_*.json files. Default: public/jsons/matches
  --out <file>           Output JSON file. Default: AI_training/headshot_damage_samples.json
  --limit <n>            Process only the first n telemetry files
  --match-id <id>        Process one match id
  --positive-only        Keep only headshots with damage > 0
  --dry-run              Process and print summary without writing the JSON
`);
}

function readOptionalJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function telemetryMatchId(file) {
  return path.basename(file).replace(/^telemetry_/, '').replace(/\.json$/, '');
}

function listTelemetryFiles(args) {
  if (!fs.existsSync(args.telemetryDir)) throw new Error(`Telemetry dir not found: ${args.telemetryDir}`);
  let files = fs.readdirSync(args.telemetryDir)
    .filter(file => /^telemetry_.+\.json$/.test(file))
    .map(file => path.join(args.telemetryDir, file))
    .sort();

  if (args.matchId) files = files.filter(file => telemetryMatchId(file) === args.matchId);
  if (args.limit > 0) files = files.slice(0, args.limit);
  return files;
}

function findMatchMetadata(telemetryDir, matchId) {
  const candidates = fs.readdirSync(telemetryDir)
    .filter(file => file.endsWith(`${matchId}.json`) && !file.startsWith('telemetry_'))
    .sort();
  for (const file of candidates) {
    const data = readOptionalJson(path.join(telemetryDir, file));
    if (data?.data?.attributes) return { file, data };
  }

  const trainingMatch = path.join(ROOT, 'AI_training', 'cache', `match_${matchId}.json`);
  const data = readOptionalJson(trainingMatch);
  if (data?.data?.attributes) return { file: path.relative(ROOT, trainingMatch), data };
  return { file: null, data: null };
}

function matchInfo(telemetryDir, matchId) {
  const meta = findMatchMetadata(telemetryDir, matchId);
  const attr = meta.data?.data?.attributes || {};
  return {
    id: matchId,
    mapName: attr.mapName || 'Unknown',
    gameMode: attr.gameMode || '',
    createdAt: attr.createdAt || '',
    shardId: attr.shardId || '',
    metadataFile: meta.file,
  };
}

function buildElapsedMapper(events) {
  const timeline = events
    .filter(ev => ev.gameState && ev._D)
    .map(ev => ({ dMs: new Date(ev._D).getTime(), elapsed: Number(ev.gameState.elapsedTime) || 0 }))
    .filter(row => Number.isFinite(row.dMs))
    .sort((a, b) => a.dMs - b.dMs);

  const matchStart = events.find(ev => ev._T === 'LogMatchStart')?._D;
  const startMs = new Date(matchStart || timeline[0]?.dMs || 0).getTime();

  return function toElapsed(ev) {
    if (Number.isFinite(ev.elapsedTime)) return Number(ev.elapsedTime);
    const dMs = new Date(ev._D).getTime();
    if (!Number.isFinite(dMs)) return null;
    if (!timeline.length) return Math.max(0, (dMs - startMs) / 1000);
    if (dMs <= timeline[0].dMs) return timeline[0].elapsed;
    if (dMs >= timeline[timeline.length - 1].dMs) return timeline[timeline.length - 1].elapsed;

    let lo = 0, hi = timeline.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timeline[mid].dMs < dMs) lo = mid + 1;
      else hi = mid;
    }

    const next = timeline[lo];
    const prev = timeline[lo - 1] || next;
    const span = Math.max(1, next.dMs - prev.dMs);
    const ratio = (dMs - prev.dMs) / span;
    return prev.elapsed + (next.elapsed - prev.elapsed) * ratio;
  };
}

function itemLabel(itemId) {
  return ITEM_DICT[itemId] || itemId || '';
}

function itemLevel(itemId) {
  const match = String(itemId || '').match(/Lv([123])_C/i);
  return match ? Number(match[1]) : 0;
}

function slotForItem(item) {
  const id = String(item?.itemId || '');
  const sub = String(item?.subCategory || '');
  const label = itemLabel(id);
  if (/^Item_Head_/i.test(id) || /helmet/i.test(label) || /head/i.test(sub)) return 'helmet';
  if (/^Item_Armor_/i.test(id) || /vest/i.test(label) || /vest|armor/i.test(sub)) return 'vest';
  return null;
}

function equipmentFromItem(item) {
  const itemId = item?.itemId || '';
  return {
    level: itemLevel(itemId),
    itemId,
    label: itemLabel(itemId),
  };
}

function emptyHelmet() {
  return { level: 0, itemId: null, label: 'None' };
}

function getEquipmentState(states, accountId) {
  if (!accountId) return { helmet: null, vest: null };
  if (!states.has(accountId)) states.set(accountId, { helmet: null, vest: null });
  return states.get(accountId);
}

function locationOf(character) {
  const loc = character?.location;
  if (!loc) return null;
  return {
    x: round(Number(loc.x), 3),
    y: round(Number(loc.y), 3),
    z: round(Number(loc.z), 3),
  };
}

function characterRow(character) {
  return {
    name: character?.name || '',
    accountId: character?.accountId || '',
    teamId: character?.teamId ?? null,
    health: round(Number(character?.health ?? 0), 4),
    isDBNO: character?.isDBNO === true,
    isInVehicle: character?.isInVehicle === true,
    location: locationOf(character),
  };
}

function distanceRows(attacker, victim) {
  const a = attacker?.location;
  const v = victim?.location;
  if (!a || !v) {
    return {
      distanceMeters: null,
      distance2dMeters: null,
      distanceUnrealUnits: null,
    };
  }

  const dx = Number(a.x) - Number(v.x);
  const dy = Number(a.y) - Number(v.y);
  const dz = Number(a.z || 0) - Number(v.z || 0);
  const dist3d = Math.hypot(dx, dy, dz);
  const dist2d = Math.hypot(dx, dy);
  return {
    distanceMeters: round(dist3d / 100, 2),
    distance2dMeters: round(dist2d / 100, 2),
    distanceUnrealUnits: round(dist3d, 3),
  };
}

function collectArmorDestroyByAttack(events) {
  const byAttackId = new Map();
  for (const ev of events) {
    if (ev._T !== 'LogArmorDestroy' || ev.attackId == null || !ev.item) continue;
    const slot = slotForItem(ev.item);
    if (!slot) continue;
    const row = { slot, ...equipmentFromItem(ev.item) };
    const key = String(ev.attackId);
    const list = byAttackId.get(key) || [];
    list.push(row);
    byAttackId.set(key, list);
  }
  return byAttackId;
}

function processTelemetry(file, args) {
  const matchId = telemetryMatchId(file);
  const info = matchInfo(args.telemetryDir, matchId);
  const events = readJson(file);
  const toElapsed = buildElapsedMapper(events);
  const destroyedByAttack = collectArmorDestroyByAttack(events);
  const states = new Map();
  const attacks = new Map();
  const samples = [];
  const skipped = { zeroDamage: 0, nonGun: 0, missingPlayers: 0 };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    if (ev._T === 'LogPlayerAttack' && ev.attackId != null) {
      attacks.set(String(ev.attackId), ev);
      continue;
    }

    if ((ev._T === 'LogItemEquip' || ev._T === 'LogItemUnequip') && ev.character?.accountId && ev.item) {
      const slot = slotForItem(ev.item);
      if (!slot) continue;
      const state = getEquipmentState(states, ev.character.accountId);
      state[slot] = ev._T === 'LogItemEquip' ? equipmentFromItem(ev.item) : null;
      continue;
    }

    if (ev._T === 'LogPlayerTakeDamage') {
      if (ev.damageReason !== 'HeadShot') continue;
      if (ev.damageTypeCategory !== 'Damage_Gun') {
        skipped.nonGun += 1;
        continue;
      }
      if (!ev.attacker?.location || !ev.victim?.location) {
        skipped.missingPlayers += 1;
        continue;
      }

      const damage = Number(ev.damage ?? 0);
      if (args.positiveOnly && damage <= 0) {
        skipped.zeroDamage += 1;
        continue;
      }

      const attackId = ev.attackId == null ? '' : String(ev.attackId);
      const attack = attacks.get(attackId) || null;
      const destroyedItems = destroyedByAttack.get(attackId) || [];
      const destroyedHelmet = destroyedItems.find(item => item.slot === 'helmet') || null;
      const victimState = getEquipmentState(states, ev.victim.accountId);
      const helmet = destroyedHelmet || victimState.helmet || emptyHelmet();
      const victimHealthBefore = Number(ev.victim.health ?? 0);
      const throughPenetrableWall = ev.isThroughPenetrableWall === true;
      const victimWasDbno = ev.victim?.isDBNO === true;
      const usableForValidation = damage > 0
        && victimHealthBefore > 0
        && !victimWasDbno
        && !throughPenetrableWall;
      const usableForDamageCalibration = usableForValidation
        && victimHealthBefore > damage + DAMAGE_EPSILON;

      samples.push({
        matchId,
        mapName: info.mapName,
        gameMode: info.gameMode,
        createdAt: info.createdAt,
        eventIndex: i,
        eventTime: ev._D || '',
        elapsedTime: round(toElapsed(ev), 3),
        attackId: ev.attackId ?? null,
        weapon: ev.damageCauserName || '',
        attackWeaponItemId: attack?.weapon?.itemId || '',
        attackType: attack?.attackType || '',
        damageTypeCategory: ev.damageTypeCategory || '',
        damageReason: ev.damageReason || '',
        damage: round(damage, 4),
        victimHealthBefore: round(victimHealthBefore, 4),
        victimHealthAfter: round(Math.max(0, victimHealthBefore - damage), 4),
        usableForAverage: usableForDamageCalibration,
        usableForValidation,
        usableForDamageCalibration,
        excludedFromDamageCalibrationReason: usableForDamageCalibration
          ? null
          : damage <= 0
            ? 'zero_damage'
            : victimWasDbno
              ? 'victim_dbno'
              : throughPenetrableWall
                ? 'penetrable_wall'
                : victimHealthBefore <= damage + DAMAGE_EPSILON
                  ? 'capped_by_victim_health'
                  : null,
        helmetLevel: helmet.level || 0,
        helmetItemId: helmet.itemId,
        helmetLabel: helmet.label,
        helmetDestroyedByShot: !!destroyedHelmet,
        destroyedArmor: destroyedItems,
        isThroughPenetrableWall: throughPenetrableWall,
        ...distanceRows(ev.attacker, ev.victim),
        attacker: characterRow(ev.attacker),
        victim: characterRow(ev.victim),
      });

      if (damage <= 0) skipped.zeroDamage += 1;
      continue;
    }

    if (ev._T === 'LogArmorDestroy' && ev.victim?.accountId && ev.item) {
      const slot = slotForItem(ev.item);
      if (!slot) continue;
      const state = getEquipmentState(states, ev.victim.accountId);
      state[slot] = null;
    }
  }

  return { match: info, telemetryFile: path.relative(ROOT, file), events: events.length, samples, skipped };
}

function createAgg() {
  return {
    count: 0,
    usableCount: 0,
    damageSum: 0,
    distanceSum: 0,
    distanceCount: 0,
    minDamage: null,
    maxDamage: null,
  };
}

function addAgg(target, key, sample) {
  const row = target[key] || createAgg();
  row.count += 1;
  if (sample.usableForAverage) {
    row.usableCount += 1;
    row.damageSum += sample.damage;
    if (Number.isFinite(sample.distanceMeters)) {
      row.distanceSum += sample.distanceMeters;
      row.distanceCount += 1;
    }
    row.minDamage = row.minDamage === null ? sample.damage : Math.min(row.minDamage, sample.damage);
    row.maxDamage = row.maxDamage === null ? sample.damage : Math.max(row.maxDamage, sample.damage);
  }
  target[key] = row;
}

function finalizeAgg(group) {
  return Object.fromEntries(Object.entries(group)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, row]) => [key, {
      count: row.count,
      usableCount: row.usableCount,
      avgDamage: row.usableCount ? round(row.damageSum / row.usableCount, 4) : null,
      avgDistanceMeters: row.distanceCount ? round(row.distanceSum / row.distanceCount, 2) : null,
      minDamage: row.minDamage,
      maxDamage: row.maxDamage,
    }]));
}

function summarize(samples) {
  const byHelmetLevel = {};
  const byWeapon = {};
  const byWeaponHelmet = {};
  const byMap = {};

  for (const sample of samples) {
    const weapon = sample.weapon || 'Unknown';
    const helmet = String(sample.helmetLevel ?? 0);
    addAgg(byHelmetLevel, helmet, sample);
    addAgg(byWeapon, weapon, sample);
    addAgg(byWeaponHelmet, `${weapon}|helmet_${helmet}`, sample);
    addAgg(byMap, sample.mapName || 'Unknown', sample);
  }

  return {
    byHelmetLevel: finalizeAgg(byHelmetLevel),
    byWeapon: finalizeAgg(byWeapon),
    byWeaponHelmet: finalizeAgg(byWeaponHelmet),
    byMap: finalizeAgg(byMap),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const files = listTelemetryFiles(args);
  const samples = [];
  const matches = [];
  const skipped = { zeroDamage: 0, nonGun: 0, missingPlayers: 0, failedFiles: {} };

  console.log('Headshot damage extraction');
  console.log(`telemetryDir=${path.relative(ROOT, args.telemetryDir) || '.'}`);
  console.log(`files=${files.length} positiveOnly=${args.positiveOnly ? 'yes' : 'no'}`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const matchId = telemetryMatchId(file);
    try {
      const result = processTelemetry(file, args);
      samples.push(...result.samples);
      matches.push({
        ...result.match,
        telemetryFile: result.telemetryFile,
        events: result.events,
        headshotSamples: result.samples.length,
      });
      skipped.zeroDamage += result.skipped.zeroDamage;
      skipped.nonGun += result.skipped.nonGun;
      skipped.missingPlayers += result.skipped.missingPlayers;
      console.log(`[${i + 1}/${files.length}] ${matchId.slice(0, 8)} ${result.match.mapName} headshots=${result.samples.length}`);
    } catch (err) {
      skipped.failedFiles[matchId] = err.message;
      console.log(`[${i + 1}/${files.length}] ${matchId.slice(0, 8)} error ${err.message}`);
    }
  }

  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'public/jsons/matches/telemetry_*.json',
    filters: {
      damageReason: 'HeadShot',
      damageTypeCategory: 'Damage_Gun',
      positiveOnly: args.positiveOnly,
    },
    processedTelemetryFiles: matches.length,
    totalSamples: samples.length,
    usableSamples: samples.filter(sample => sample.usableForDamageCalibration).length,
    validationSamples: samples.filter(sample => sample.usableForValidation).length,
    damageCalibrationSamples: samples.filter(sample => sample.usableForDamageCalibration).length,
    excludedFromDamageCalibration: samples.reduce((acc, sample) => {
      const reason = sample.excludedFromDamageCalibrationReason;
      if (reason) acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
    skipped,
    matches,
    summary: summarize(samples),
    samples,
  };

  console.log('');
  console.log(`samples=${doc.totalSamples} usable=${doc.usableSamples} failed=${Object.keys(skipped.failedFiles).length}`);
  if (args.dryRun) {
    console.log('dry-run: output not written');
  } else {
    writeJson(args.out, doc);
    console.log(`written ${args.out}`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
