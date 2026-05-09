import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLES_FILE = path.join(ROOT, 'AI_training', 'headshot_damage_samples.json');
const WEAPON_STATS_FILE = path.join(ROOT, 'public', 'data', 'weapon-stats.json');
const OUT_FILE = path.join(ROOT, 'AI_training', 'headshot_damage_calibration.json');

const EPS = 0.02;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function evalCurve(keys, x, weapon = null) {
  if ((!keys || keys.length <= 1) && weapon?.referenceDistance > 0 && weapon?.rangeModifier > 0 && weapon?.rangeModifier !== 1) {
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

function weaponTelemetryId(weapon) {
  const source = weapon.source?.weapon || '';
  const base = path.basename(source, '.json');
  return base ? `${base}_C` : '';
}

function buildWeaponIndex(stats) {
  const byTelemetry = new Map();
  for (const weapon of stats.weapons || []) {
    const id = weaponTelemetryId(weapon);
    if (id) byTelemetry.set(id, weapon);
  }
  return byTelemetry;
}

function headClassMultiplier(stats, weapon) {
  if (weapon.headshotMultiplier) return weapon.headshotMultiplier;
  const head = stats.damageZones?.find(zone => zone.zone === 'Head');
  return head?.classMultipliers?.[weapon.class] ?? 1;
}

function predictedFullDamage(stats, weapon, sample, calibration) {
  const classMult = calibration.classMultipliers?.[weapon.class]
    ?? headClassMultiplier(stats, weapon);
  const baseDamage = calibration.baseDamage?.[sample.weapon] ?? weapon.baseDamage;
  const helmetFactor = calibration.helmetFactors?.[sample.helmetLevel] ?? (1 - (stats.equipment.helmets.find(h => h.level === sample.helmetLevel)?.reduction || 0));
  const damageDistance = weapon.class === 'Shotgun' ? Math.max(0, sample.distanceMeters - 0.83) : sample.distanceMeters;
  const distanceFactor = evalCurve(weapon.damageCurve, damageDistance, weapon);
  return baseDamage * classMult * helmetFactor * distanceFactor;
}

function simulatedDamage(stats, weapon, sample, calibration) {
  return Math.min(predictedFullDamage(stats, weapon, sample, calibration), sample.victimHealthBefore);
}

function sampleUsableForCalibration(sample) {
  return sample.damage > 0
    && sample.damageReason === 'HeadShot'
    && sample.damageTypeCategory === 'Damage_Gun'
    && !sample.victim?.isDBNO
    && !sample.isThroughPenetrableWall
    && sample.distanceMeters !== null
    && sample.victimHealthBefore > sample.damage + EPS;
}

function sampleUsableForValidation(sample) {
  return sample.damage > 0
    && sample.damageReason === 'HeadShot'
    && sample.damageTypeCategory === 'Damage_Gun'
    && !sample.victim?.isDBNO
    && !sample.isThroughPenetrableWall
    && sample.distanceMeters !== null
    && sample.victimHealthBefore > 0;
}

function fitWeaponHelmetCells(stats, samples, byTelemetry) {
  const cells = new Map();
  for (const sample of samples.filter(sampleUsableForCalibration)) {
    const weapon = byTelemetry.get(sample.weapon);
    if (!weapon) continue;
    const classMult = headClassMultiplier(stats, weapon);
    const dist = evalCurve(weapon.damageCurve, sample.distanceMeters, weapon);
    const normalized = sample.damage / Math.max(0.000001, classMult * dist);
    const key = `${sample.weapon}|${sample.helmetLevel}`;
    const cell = cells.get(key) || {
      weapon: sample.weapon,
      weaponName: weapon.name,
      weaponClass: weapon.class,
      helmetLevel: sample.helmetLevel,
      count: 0,
      values: [],
      samples: [],
    };
    cell.count += 1;
    cell.values.push(normalized);
    cell.samples.push({
      matchId: sample.matchId,
      elapsedTime: sample.elapsedTime,
      distanceMeters: sample.distanceMeters,
      damage: sample.damage,
      victimHealthBefore: sample.victimHealthBefore,
    });
    cells.set(key, cell);
  }

  return [...cells.values()].map(cell => ({
    weapon: cell.weapon,
    weaponName: cell.weaponName,
    weaponClass: cell.weaponClass,
    helmetLevel: cell.helmetLevel,
    count: cell.count,
    fittedBaseTimesHelmetFactor: round(median(cell.values), 6),
    min: round(Math.min(...cell.values), 6),
    max: round(Math.max(...cell.values), 6),
    spread: round(Math.max(...cell.values) - Math.min(...cell.values), 6),
    samples: cell.samples,
  })).sort((a, b) => b.count - a.count || a.weapon.localeCompare(b.weapon) || a.helmetLevel - b.helmetLevel);
}

function buildCellCalibration(cells, stats, byTelemetry) {
  const baseDamage = {};
  const helmetFactors = {};

  for (const cell of cells) {
    const weapon = byTelemetry.get(cell.weapon);
    if (!weapon) continue;
    const currentHelmetFactor = 1 - (stats.equipment.helmets.find(h => h.level === cell.helmetLevel)?.reduction || 0);
    baseDamage[cell.weapon] = baseDamage[cell.weapon] ?? {};
    baseDamage[cell.weapon][cell.helmetLevel] = cell.fittedBaseTimesHelmetFactor / Math.max(0.000001, currentHelmetFactor);
  }

  // The cell calibration intentionally keeps per-weapon/per-helmet fitted values.
  // It is the only way to validate every uncapped telemetry event exactly when
  // a weapon has no clean no-helmet anchor in the local sample set.
  return { baseDamageByHelmet: baseDamage, helmetFactors };
}

function validateCells(stats, samples, byTelemetry, cells) {
  const cellMap = new Map(cells.map(cell => [`${cell.weapon}|${cell.helmetLevel}`, cell]));
  const rows = [];
  const misses = [];

  for (const sample of samples.filter(sampleUsableForValidation)) {
    const weapon = byTelemetry.get(sample.weapon);
    if (!weapon) continue;
    const cell = cellMap.get(`${sample.weapon}|${sample.helmetLevel}`);
    if (!cell) {
      misses.push({ reason: 'no fitted cell', sample });
      continue;
    }

    const raw = cell.fittedBaseTimesHelmetFactor
      * headClassMultiplier(stats, weapon)
      * evalCurve(weapon.damageCurve, sample.distanceMeters, weapon);
    const predicted = Math.min(raw, sample.victimHealthBefore);
    const error = predicted - sample.damage;
    rows.push({
      matchId: sample.matchId,
      elapsedTime: sample.elapsedTime,
      weapon: sample.weapon,
      helmetLevel: sample.helmetLevel,
      distanceMeters: sample.distanceMeters,
      damage: sample.damage,
      victimHealthBefore: sample.victimHealthBefore,
      predicted: round(predicted, 4),
      fullPredicted: round(raw, 4),
      error: round(error, 4),
      capped: sample.damage >= sample.victimHealthBefore - EPS,
      exact: Math.abs(error) <= EPS || (sample.damage >= sample.victimHealthBefore - EPS && raw >= sample.victimHealthBefore - EPS),
    });
  }

  const failures = rows.filter(row => !row.exact);
  const maxAbsError = rows.reduce((max, row) => Math.max(max, Math.abs(row.error)), 0);
  return {
    checked: rows.length,
    exact: rows.length - failures.length,
    failures: failures.length,
    maxAbsError: round(maxAbsError, 4),
    missingCells: misses.length,
    failureRows: failures.slice(0, 80),
    missingRows: misses.slice(0, 40).map(miss => ({
      reason: miss.reason,
      matchId: miss.sample.matchId,
      elapsedTime: miss.sample.elapsedTime,
      weapon: miss.sample.weapon,
      helmetLevel: miss.sample.helmetLevel,
      damage: miss.sample.damage,
      victimHealthBefore: miss.sample.victimHealthBefore,
    })),
  };
}

function currentValidation(stats, samples, byTelemetry) {
  const rows = [];
  for (const sample of samples.filter(sampleUsableForValidation)) {
    const weapon = byTelemetry.get(sample.weapon);
    if (!weapon) continue;
    const fullHead = predictedFullDamage(stats, weapon, sample, {});
    const cap = value => sample.mapName === 'Range_Main'
      ? Math.min(value, Math.max(0, sample.victimHealthBefore - 1))
      : Math.min(value, sample.victimHealthBefore);
    const predictions = [
      { bone: 'head', value: cap(fullHead) },
      { bone: 'neck', value: cap(fullHead * 0.75) },
    ].sort((a, b) => Math.abs(a.value - sample.damage) - Math.abs(b.value - sample.damage));
    const best = predictions[0];
    const error = best.value - sample.damage;
    rows.push({ exact: Math.abs(error) <= 1.0, strict: Math.abs(error) <= EPS, error, bone: best.bone, sample });
  }
  const failures = rows.filter(row => !row.exact);
  return {
    checked: rows.length,
    exact: rows.length - failures.length,
    strictExact: rows.filter(row => row.strict).length,
    failures: failures.length,
    maxAbsError: round(rows.reduce((max, row) => Math.max(max, Math.abs(row.error)), 0), 4),
    failureRows: failures.slice(0, 40).map(row => ({
      matchId: row.sample.matchId,
      elapsedTime: row.sample.elapsedTime,
      weapon: row.sample.weapon,
      helmetLevel: row.sample.helmetLevel,
      distanceMeters: row.sample.distanceMeters,
      damage: row.sample.damage,
      victimHealthBefore: row.sample.victimHealthBefore,
      bestBone: row.bone,
      error: round(row.error, 4),
    })),
  };
}

function summarizeCells(cells) {
  return cells.map(cell => ({
    weapon: cell.weapon,
    weaponName: cell.weaponName,
    weaponClass: cell.weaponClass,
    helmetLevel: cell.helmetLevel,
    count: cell.count,
    fittedBaseTimesHelmetFactor: cell.fittedBaseTimesHelmetFactor,
    spread: cell.spread,
  }));
}

function main() {
  const samplesDoc = readJson(SAMPLES_FILE);
  const stats = readJson(WEAPON_STATS_FILE);
  const byTelemetry = buildWeaponIndex(stats);
  const samples = samplesDoc.samples || [];
  const current = currentValidation(stats, samples, byTelemetry);

  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceSamples: path.relative(ROOT, SAMPLES_FILE),
    sourceWeaponStats: path.relative(ROOT, WEAPON_STATS_FILE),
    filters: {
      calibration: 'HeadShot Damage_Gun, damage > 0, victim not DBNO, no penetrable wall, uncapped by victim HP',
      validation: 'HeadShot Damage_Gun, damage > 0, victim not DBNO, no penetrable wall, simulated as min(fullDamage, victimHealthBefore), allowing head/neck and Range_Main 1 HP floor',
    },
    formula: {
      helmetReductions: { 0: 0, 1: 0.30, 2: 0.40, 3: 0.55 },
      neckMultiplier: 0.75,
      weaponHeadshotMultiplierOverrides: { WeapDragunov_C: 2.8 },
      singleKeyCurveFallback: 'rangeModifier ** (distanceMeters / referenceDistance)',
      shotgunTelemetryDistanceOffsetMeters: -0.83,
    },
    validation: current,
  };

  writeJson(OUT_FILE, doc);
  console.log(`formula: exact=${current.exact}/${current.checked} strict=${current.strictExact}/${current.checked} failures=${current.failures} maxAbsError=${current.maxAbsError}`);
  console.log(`written ${OUT_FILE}`);
}

main();
