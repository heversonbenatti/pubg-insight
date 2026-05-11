// Valida a fórmula:
//   damage = baseDamage(weapon)
//          * classMultiplier(weapon.class, zone)
//          * boneMultiplier(zone, bone)
//          * distanceFactor(weapon, distanceMeters)
//          * armorFactor(zone, armorLevel)
//
// Bate cada amostra contra todas as combinações plausíveis (bones da zona,
// shotgun pellet offset, etc) e fica com a que melhor explica o damage real.
// Reporta % de acerto exato (< 0.02 HP), erro máximo, e perfis de falhas.
//
// Uso:
//   node scripts/validate-damage-formula.js [--out file] [--samples file]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLES_FILE = path.join(ROOT, 'scripts', 'output', 'damage_samples.json');
const WEAPON_STATS = path.join(ROOT, 'public', 'data', 'weapon-stats.json');
const OUT_FILE = path.join(ROOT, 'scripts', 'output', 'damage_validation.json');

const EPS = 0.02;
const SHOTGUN_DIST_OFFSET = -0.83; // metros (descoberta em calibrate-headshot-damage)

function parseArgs() {
  const args = { out: OUT_FILE, samples: SAMPLES_FILE };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i], n = process.argv[i + 1];
    if (a === '--out') { args.out = path.resolve(n); i++; }
    else if (a === '--samples') { args.samples = path.resolve(n); i++; }
  }
  return args;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function evalCurve(keys, x, weapon) {
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
      const t2 = t * t, t3 = t2 * t;
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
  const src = weapon.source?.weapon || '';
  const base = path.basename(src, '.json');
  return base ? `${base}_C` : '';
}

function buildWeaponIndex(stats) {
  const map = new Map();
  const lowerMap = new Map();
  for (const w of stats.weapons || []) {
    const id = weaponTelemetryId(w);
    if (id) {
      map.set(id, w);
      lowerMap.set(id.toLowerCase(), w);
    }
  }
  return {
    get(telemetryName) {
      return map.get(telemetryName) || lowerMap.get(String(telemetryName).toLowerCase()) || null;
    },
    size: map.size,
  };
}

function zoneInfo(stats) {
  const out = {};
  for (const z of stats.damageZones || []) {
    out[z.damageReason] = {
      zone: z.zone,
      equipSlot: z.equipSlot,
      bones: z.bones,
      classMultipliers: z.classMultipliers,
    };
  }
  return out;
}

function helmetReduction(stats, level) {
  return stats.equipment.helmets.find(h => h.level === level)?.reduction || 0;
}
function vestReduction(stats, level) {
  return stats.equipment.vests.find(v => v.level === level)?.reduction || 0;
}

// Constantes derivadas empiricamente da telemetria:
//   - vest quebrado fica vestida com redução fixa de 20% (factor 0.80), independente do nível.
//     Confirmado por 2 análises independentes (~600 samples): histograma com pico em 0.80-0.85
//     (66% das samples), ratio mediano broken/no-vest = 0.800 exato em 26 buckets pareados.
//   - capacete quebrado voa do personagem (observação visual): proteção = 0.
const BROKEN_VEST_FACTOR = 0.80;
const BROKEN_HELMET_FACTOR = 1.0;

function armorFactor(stats, zone, armorLevel, broken = false) {
  if (zone === 'Head') {
    if (broken && armorLevel > 0) return BROKEN_HELMET_FACTOR;
    return 1 - helmetReduction(stats, armorLevel);
  }
  if (zone === 'Torso' || zone === 'Pelvis') {
    if (broken && armorLevel > 0) return BROKEN_VEST_FACTOR;
    return 1 - vestReduction(stats, armorLevel);
  }
  return 1;
}

// Pra Sniper.headshot tem override de 2.8 só pro Dragunov
const HEADSHOT_OVERRIDES = { Item_Weapon_Dragunov_C: 2.8 };

function classMultiplier(stats, zone, weapon) {
  if (zone === 'Head' && HEADSHOT_OVERRIDES[weapon.id]) return HEADSHOT_OVERRIDES[weapon.id];
  const z = stats.damageZones.find(z => z.zone === zone);
  return z?.classMultipliers?.[weapon.class] ?? 1;
}

function predictRaw(stats, weapon, sample, boneMult, armorLevelOverride, brokenOverride) {
  const base = weapon.baseDamage;
  const cls = classMultiplier(stats, sample.zone, weapon);
  let dist = sample.distanceMeters;
  if (weapon.class === 'Shotgun') dist = Math.max(0, dist + SHOTGUN_DIST_OFFSET);
  const distFactor = evalCurve(weapon.damageCurve, dist, weapon);
  const armorLevel = armorLevelOverride !== undefined ? armorLevelOverride : sample.armorLevel;
  const broken = brokenOverride !== undefined ? brokenOverride : !!sample.armorBrokenBefore;
  const armor = armorFactor(stats, sample.zone, armorLevel, broken);
  return base * cls * boneMult * distFactor * armor;
}

// Best-fit usando bone tracking apenas (armor = o que rastreamos)
function bestMatchTracked(stats, weapon, sample) {
  const zone = stats.damageZones.find(z => z.zone === sample.zone);
  const bones = zone?.bones || [{ name: 'default', multiplier: 1 }];
  let best = { error: Infinity };
  for (const b of bones) {
    const full = predictRaw(stats, weapon, sample, b.multiplier);
    const capped = Math.min(full, sample.victimHealthBefore);
    const err = capped - sample.damage;
    if (Math.abs(err) < Math.abs(best.error)) {
      best = { bone: b.name, boneMult: b.multiplier, full, capped, error: err, armorLevel: sample.armorLevel };
    }
  }
  return best;
}

// Best-fit "oracle" varre TODAS as combinações (bone × armor 0/1/2/3 × broken/intact)
// pra ver se a FÓRMULA em si fecha.
function bestMatchOracle(stats, weapon, sample) {
  const zone = stats.damageZones.find(z => z.zone === sample.zone);
  const bones = zone?.bones || [{ name: 'default', multiplier: 1 }];
  const slot = zone?.equipSlot;
  const armorLevels = (slot === 'Head' || slot === 'TorsoArmor') ? [0, 1, 2, 3] : [0];
  let best = { error: Infinity };
  for (const b of bones) {
    for (const lvl of armorLevels) {
      // tenta tanto intact quanto broken (broken só faz diferença se lvl>0 e slot=vest)
      const states = lvl === 0 ? [false] : [false, true];
      for (const brk of states) {
        const full = predictRaw(stats, weapon, sample, b.multiplier, lvl, brk);
        const capped = Math.min(full, sample.victimHealthBefore);
        const err = capped - sample.damage;
        if (Math.abs(err) < Math.abs(best.error)) {
          best = { bone: b.name, boneMult: b.multiplier, full, capped, error: err, armorLevel: lvl, broken: brk };
        }
      }
    }
  }
  return best;
}

function bucket(d) {
  if (d < 10) return '<10m';
  if (d < 25) return '10-25m';
  if (d < 50) return '25-50m';
  if (d < 100) return '50-100m';
  if (d < 200) return '100-200m';
  if (d < 400) return '200-400m';
  return '400m+';
}

function main() {
  const args = parseArgs();
  console.log(`loading samples: ${args.samples}`);
  const doc = JSON.parse(fs.readFileSync(args.samples, 'utf8'));
  const stats = JSON.parse(fs.readFileSync(WEAPON_STATS, 'utf8'));
  const wIndex = buildWeaponIndex(stats);
  const zMap = zoneInfo(stats);
  console.log(`samples=${doc.samples.length} weapons indexed=${wIndex.size} zones=${Object.keys(zMap).join(',')}`);

  // Diagnostics — excluindo Range_Main (training, com floor de 1 HP que distorce tudo)
  const usable = doc.samples.filter(s => s.usableForCalibration && s.mapName !== 'Range_Main');
  console.log(`usable (sem Range_Main)=${usable.length}`);

  const rows = [];
  const noWeapon = new Map();
  let exactT = 0, exactO = 0, agreeArmor = 0;
  const failuresBy = {
    zone: {},
    weapon: {},
    armor: {},
    distBucket: {},
    weaponZone: {},
  };
  const oracleFailuresBy = { weaponZone: {}, weapon: {}, distBucket: {} };
  const errorsTracked = [];
  const errorsOracle = [];

  function bumpFail(map, key) { map[key] = (map[key] || 0) + 1; }

  for (const s of usable) {
    const weapon = wIndex.get(s.weapon);
    if (!weapon) {
      noWeapon.set(s.weapon, (noWeapon.get(s.weapon) || 0) + 1);
      continue;
    }
    const tracked = bestMatchTracked(stats, weapon, s);
    const oracle = bestMatchOracle(stats, weapon, s);
    const isExactT = Math.abs(tracked.error) <= EPS;
    const isExactO = Math.abs(oracle.error) <= EPS;
    if (isExactT) exactT += 1;
    if (isExactO) exactO += 1;
    if (oracle.armorLevel === s.armorLevel) agreeArmor += 1;

    const row = {
      matchId: s.matchId,
      elapsedTime: s.elapsedTime,
      weapon: s.weapon,
      weaponClass: weapon.class,
      zone: s.zone,
      armorSlot: s.armorSlot,
      armorLevelTracked: s.armorLevel,
      armorLevelOracle: oracle.armorLevel,
      armorBrokenBefore: s.armorBrokenBefore,
      armorDestroyedByThisShot: s.armorDestroyedByThisShot,
      distanceMeters: s.distanceMeters,
      damage: s.damage,
      hpBefore: s.victimHealthBefore,
      predictedFullTracked: round(tracked.full, 4),
      predictedFullOracle: round(oracle.full, 4),
      bestBoneTracked: tracked.bone,
      bestBoneOracle: oracle.bone,
      errorTracked: round(tracked.error, 4),
      errorOracle: round(oracle.error, 4),
      exactTracked: isExactT,
      exactOracle: isExactO,
    };
    rows.push(row);
    errorsTracked.push(Math.abs(tracked.error));
    errorsOracle.push(Math.abs(oracle.error));

    if (!isExactT) {
      bumpFail(failuresBy.zone, s.zone);
      bumpFail(failuresBy.weapon, s.weapon);
      bumpFail(failuresBy.armor, `${s.armorSlot || 'none'}-${s.armorLevel}`);
      bumpFail(failuresBy.distBucket, bucket(s.distanceMeters));
      bumpFail(failuresBy.weaponZone, `${s.weapon}|${s.zone}`);
    }
    if (!isExactO) {
      bumpFail(oracleFailuresBy.weaponZone, `${s.weapon}|${s.zone}`);
      bumpFail(oracleFailuresBy.weapon, s.weapon);
      bumpFail(oracleFailuresBy.distBucket, bucket(s.distanceMeters));
    }
  }

  function percentile(arr, p) {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] || 0;
  }

  const failuresByWeaponZoneSorted = Object.entries(failuresBy.weaponZone).sort(([, a], [, b]) => b - a).slice(0, 30);
  const oracleFailuresByWeaponZoneSorted = Object.entries(oracleFailuresBy.weaponZone).sort(([, a], [, b]) => b - a).slice(0, 30);
  const oracleFailuresByWeaponSorted = Object.entries(oracleFailuresBy.weapon).sort(([, a], [, b]) => b - a).slice(0, 20);

  const summary = {
    samplesEvaluated: rows.length,
    tracked: {
      exact: exactT,
      exactPct: round(exactT / rows.length * 100, 2),
      err_p50: round(percentile(errorsTracked, 0.5), 4),
      err_p90: round(percentile(errorsTracked, 0.9), 4),
      err_p99: round(percentile(errorsTracked, 0.99), 4),
      err_max: round(errorsTracked.reduce((m, x) => x > m ? x : m, 0), 4),
    },
    oracle: {
      exact: exactO,
      exactPct: round(exactO / rows.length * 100, 2),
      err_p50: round(percentile(errorsOracle, 0.5), 4),
      err_p90: round(percentile(errorsOracle, 0.9), 4),
      err_p99: round(percentile(errorsOracle, 0.99), 4),
      err_p999: round(percentile(errorsOracle, 0.999), 4),
      err_max: round(errorsOracle.reduce((m, x) => x > m ? x : m, 0), 4),
    },
    armorAgreement: {
      agree: agreeArmor,
      agreePct: round(agreeArmor / rows.length * 100, 2),
    },
    weaponsMissingFromStats: [...noWeapon.entries()].sort(([, a], [, b]) => b - a),
    failuresByZone: failuresBy.zone,
    failuresByDistance: failuresBy.distBucket,
    failuresByArmor: failuresBy.armor,
    failuresByWeaponZone: Object.fromEntries(failuresByWeaponZoneSorted),
    oracleFailuresByWeaponZone: Object.fromEntries(oracleFailuresByWeaponZoneSorted),
    oracleFailuresByWeapon: Object.fromEntries(oracleFailuresByWeaponSorted),
    oracleFailuresByDistance: oracleFailuresBy.distBucket,
  };

  // Worst rows: ranked by oracle error (não por tracked) — esses são os casos onde a fórmula realmente falha
  rows.sort((a, b) => Math.abs(b.errorOracle) - Math.abs(a.errorOracle));
  const worstOracle = rows.slice(0, 100);

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify({ summary, worstOracle }, null, 2), 'utf8');

  console.log(`\n=== Validation summary ===`);
  console.log(`samples=${summary.samplesEvaluated}`);
  console.log(`TRACKED (usa armor que rastreamos):`);
  console.log(`  exact (|err|<${EPS}): ${exactT} (${summary.tracked.exactPct}%)`);
  console.log(`  err p50=${summary.tracked.err_p50} p90=${summary.tracked.err_p90} p99=${summary.tracked.err_p99} max=${summary.tracked.err_max}`);
  console.log(`ORACLE (varre armor 0/1/2/3, mostra se a FÓRMULA está certa):`);
  console.log(`  exact (|err|<${EPS}): ${exactO} (${summary.oracle.exactPct}%)`);
  console.log(`  err p50=${summary.oracle.err_p50} p90=${summary.oracle.err_p90} p99=${summary.oracle.err_p99} p999=${summary.oracle.err_p999} max=${summary.oracle.err_max}`);
  console.log(`ARMOR AGREEMENT: ${agreeArmor} (${summary.armorAgreement.agreePct}%) — oracle.armorLevel == tracked.armorLevel`);
  console.log(`weapons missing from stats:`, summary.weaponsMissingFromStats.slice(0, 10));
  console.log(`oracle failures by weapon:`, Object.fromEntries(oracleFailuresByWeaponSorted));
  console.log(`oracle failures by weapon|zone:`, Object.fromEntries(oracleFailuresByWeaponZoneSorted.slice(0, 15)));
  console.log(`oracle failures by distance:`, summary.oracleFailuresByDistance);
  console.log(`\nWritten ${args.out}`);
}

main();
