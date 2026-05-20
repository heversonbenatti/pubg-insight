// Extrai amostras de TODAS as zonas (Head/Torso/Arm/Pelvis/Leg) das telemetrias.
// Rastreia estado de capacete/colete (incluindo "quebrado mas ainda vestido") por jogador
// usando LogItemEquip/Unequip + LogArmorDestroy. Marca cada sample com tudo necessário
// pra calibrar a fórmula de dano por zona/armadura/distância.
//
// Uso:
//   node scripts/extract-damage-samples.js [--limit N] [--match-id <id>]
// Default lê tudo de cache/matches/telemetry_*.json

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TELEMETRY_DIR = path.join(ROOT, 'cache', 'matches');

// Lê telemetria (.json.gz comprimido ou .json legado).
function readTelemetryFile(file) {
  const buf = fs.readFileSync(file);
  return JSON.parse(file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf.toString('utf8'));
}
const OUT_FILE = path.join(ROOT, 'scripts', 'output', 'damage_samples.json');

const ITEM_DICT_FILE = path.join(ROOT, 'pubg-api-assets', 'dictionaries', 'telemetry', 'item', 'itemId.json');
const ITEM_DICT = fs.existsSync(ITEM_DICT_FILE) ? JSON.parse(fs.readFileSync(ITEM_DICT_FILE, 'utf8')) : {};

const DAMAGE_REASONS = new Set(['HeadShot', 'TorsoShot', 'ArmShot', 'PelvisShot', 'LegShot']);
// Zonas que usam armadura
const ZONE_TO_SLOT = {
  HeadShot: 'helmet',
  TorsoShot: 'vest',
  PelvisShot: 'vest',
  ArmShot: null,
  LegShot: null,
};

function parseArgs(argv) {
  const args = { limit: 0, matchId: null, out: OUT_FILE };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === '--limit') { args.limit = Math.max(0, parseInt(n, 10) || 0); i++; }
    else if (a === '--match-id') { args.matchId = n; i++; }
    else if (a === '--out') { args.out = path.resolve(n); i++; }
  }
  return args;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function itemLevel(itemId) {
  const m = String(itemId || '').match(/Lv([123])_C/i);
  return m ? Number(m[1]) : 0;
}

function slotForItem(item) {
  const sub = String(item?.subCategory || '');
  if (sub === 'Headgear') return 'helmet';
  if (sub === 'Vest') return 'vest';
  return null;
}

function findMatchMetadata(matchId) {
  const dir = TELEMETRY_DIR;
  const candidates = fs.readdirSync(dir)
    .filter(f => f.endsWith(`${matchId}.json`) && !f.startsWith('telemetry_'));
  for (const f of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (data?.data?.attributes) return data.data.attributes;
    } catch {}
  }
  return null;
}

function listTelemetryFiles(args) {
  // Aceita .json.gz (novo) e .json (legado). Dedup por matchId, preferindo .gz.
  const byId = new Map();
  for (const f of fs.readdirSync(TELEMETRY_DIR)) {
    const m = f.match(/^telemetry_(.+?)\.json(\.gz)?$/);
    if (!m) continue;
    if (!byId.has(m[1]) || m[2]) byId.set(m[1], path.join(TELEMETRY_DIR, f));
  }
  let files = [...byId.values()].sort();
  if (args.matchId) files = files.filter(f => path.basename(f).includes(args.matchId));
  if (args.limit > 0) files = files.slice(0, args.limit);
  return files;
}

function buildElapsedMapper(events) {
  const timeline = events
    .filter(ev => ev?.gameState && ev._D)
    .map(ev => ({ dMs: new Date(ev._D).getTime(), elapsed: Number(ev.gameState.elapsedTime) || 0 }))
    .filter(r => Number.isFinite(r.dMs))
    .sort((a, b) => a.dMs - b.dMs);
  const startMs = new Date(events.find(ev => ev._T === 'LogMatchStart')?._D || timeline[0]?.dMs || 0).getTime();
  return function toElapsed(ev) {
    if (Number.isFinite(ev.elapsedTime)) return Number(ev.elapsedTime);
    const dMs = new Date(ev._D).getTime();
    if (!Number.isFinite(dMs)) return null;
    if (!timeline.length) return Math.max(0, (dMs - startMs) / 1000);
    if (dMs <= timeline[0].dMs) return timeline[0].elapsed;
    if (dMs >= timeline[timeline.length - 1].dMs) return timeline[timeline.length - 1].elapsed;
    let lo = 0, hi = timeline.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (timeline[m].dMs < dMs) lo = m + 1; else hi = m; }
    const next = timeline[lo], prev = timeline[lo - 1] || next;
    const span = Math.max(1, next.dMs - prev.dMs);
    return prev.elapsed + (next.elapsed - prev.elapsed) * ((dMs - prev.dMs) / span);
  };
}

function processTelemetry(file) {
  const matchId = path.basename(file).replace(/^telemetry_/, '').replace(/\.json(\.gz)?$/, '');
  const attr = findMatchMetadata(matchId) || {};
  const mapName = attr.mapName || 'Unknown';
  const gameMode = attr.gameMode || '';
  const createdAt = attr.createdAt || '';

  const events = readTelemetryFile(file);
  const toElapsed = buildElapsedMapper(events);

  // Estado de armadura por accountId:
  //  helmet: { itemId, level, broken: bool }, vest: idem
  const armor = new Map();
  function getArmor(id) {
    if (!armor.has(id)) armor.set(id, { helmet: null, vest: null });
    return armor.get(id);
  }

  // LogPlayerAttack indexado por attackId — pra cruzar weapon.itemId
  const attacks = new Map();

  // LogArmorDestroy indexado por attackId — diz que armadura quebrou nesse tiro
  const destroysByAttack = new Map();
  // Pre-pass: coletar LogArmorDestroy primeiro (mesmo attackId pode aparecer antes ou depois)
  for (const ev of events) {
    if (ev._T === 'LogArmorDestroy' && ev.attackId != null && ev.item) {
      const slot = slotForItem(ev.item);
      if (!slot) continue;
      const key = String(ev.attackId);
      const list = destroysByAttack.get(key) || [];
      list.push({ slot, itemId: ev.item.itemId, level: itemLevel(ev.item.itemId) });
      destroysByAttack.set(key, list);
    }
  }

  const samples = [];
  const counts = {
    totalTakeDamage: 0,
    nonGun: 0,
    nonZone: 0,
    selfDamage: 0,
    missingPlayer: 0,
    samples: 0,
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || !ev._T) continue;

    if (ev._T === 'LogPlayerAttack' && ev.attackId != null) {
      attacks.set(String(ev.attackId), ev);
      continue;
    }

    if (ev._T === 'LogItemEquip' && ev.character?.accountId && ev.item) {
      const slot = slotForItem(ev.item);
      if (!slot) continue;
      const s = getArmor(ev.character.accountId);
      s[slot] = { itemId: ev.item.itemId, level: itemLevel(ev.item.itemId), broken: false };
      continue;
    }

    if (ev._T === 'LogItemUnequip' && ev.character?.accountId && ev.item) {
      const slot = slotForItem(ev.item);
      if (!slot) continue;
      const s = getArmor(ev.character.accountId);
      // Só limpa se o item desequipado bate com o atual
      if (s[slot]?.itemId === ev.item.itemId) s[slot] = null;
      continue;
    }

    if (ev._T === 'LogPlayerTakeDamage') {
      counts.totalTakeDamage += 1;
      const reason = ev.damageReason;
      const cat = ev.damageTypeCategory;
      if (cat !== 'Damage_Gun') { counts.nonGun += 1; continue; }
      if (!DAMAGE_REASONS.has(reason)) { counts.nonZone += 1; continue; }
      if (!ev.attacker || !ev.victim) { counts.missingPlayer += 1; continue; }
      if (ev.attacker.accountId === ev.victim.accountId) { counts.selfDamage += 1; continue; }

      const damage = Number(ev.damage ?? 0);
      const hpBefore = Number(ev.victim.health ?? 0);
      const victimDbno = ev.victim.isDBNO === true;
      const wall = ev.isThroughPenetrableWall === true;

      const attackId = ev.attackId == null ? '' : String(ev.attackId);
      const atk = attacks.get(attackId) || null;
      const destroyed = destroysByAttack.get(attackId) || [];
      const destroyedHelmet = destroyed.find(d => d.slot === 'helmet') || null;
      const destroyedVest = destroyed.find(d => d.slot === 'vest') || null;

      // Estado de armadura da vítima imediatamente ANTES do tiro
      const vState = getArmor(ev.victim.accountId);
      const helmetBefore = vState.helmet ? { ...vState.helmet } : { itemId: null, level: 0, broken: false };
      const vestBefore = vState.vest ? { ...vState.vest } : { itemId: null, level: 0, broken: false };

      // Se houve LogArmorDestroy desse mesmo attackId pra esse slot, a peça estava INTACTA antes
      if (destroyedHelmet) helmetBefore.willBreak = true;
      if (destroyedVest) vestBefore.willBreak = true;

      // Posição -> distância
      const a = ev.attacker.location, v = ev.victim.location;
      let distMeters = null, dist2d = null, distUU = null;
      if (a && v) {
        const dx = a.x - v.x, dy = a.y - v.y, dz = (a.z || 0) - (v.z || 0);
        distUU = Math.hypot(dx, dy, dz);
        distMeters = round(distUU / 100, 3);
        dist2d = round(Math.hypot(dx, dy) / 100, 3);
      }

      const slot = ZONE_TO_SLOT[reason];
      const armorPiece = slot === 'helmet' ? helmetBefore : slot === 'vest' ? vestBefore : null;
      // "Efetivo" para o cálculo: peça quebrada conta como sem armadura
      const effectiveArmorLevel = armorPiece && !armorPiece.broken ? armorPiece.level : 0;

      samples.push({
        matchId,
        mapName,
        gameMode,
        createdAt,
        eventIndex: i,
        eventTime: ev._D,
        elapsedTime: round(toElapsed(ev), 3),
        attackId: ev.attackId ?? null,
        weapon: ev.damageCauserName || '',
        weaponItemId: atk?.weapon?.itemId || '',
        attackType: atk?.attackType || '',
        damageReason: reason,
        zone: reason.replace('Shot', ''),
        damage: round(damage, 4),
        victimHealthBefore: round(hpBefore, 4),
        victimHealthAfter: round(Math.max(0, hpBefore - damage), 4),
        victimDbno,
        throughWall: wall,
        distanceMeters: distMeters,
        distance2dMeters: dist2d,
        distanceUU: round(distUU, 3),
        // Armadura efetiva (considerando quebra prévia)
        armorSlot: slot,
        armorLevel: effectiveArmorLevel,
        armorItemId: armorPiece?.itemId || null,
        armorBrokenBefore: armorPiece?.broken || false,
        armorDestroyedByThisShot: slot === 'helmet' ? !!destroyedHelmet : slot === 'vest' ? !!destroyedVest : false,
        // Pra reanálise
        helmetBefore,
        vestBefore,
        // Atacante
        attacker: {
          name: ev.attacker.name,
          accountId: ev.attacker.accountId,
          teamId: ev.attacker.teamId,
        },
        victim: {
          name: ev.victim.name,
          accountId: ev.victim.accountId,
          teamId: ev.victim.teamId,
        },
        // Flags úteis pra calibração
        capped: damage > 0 && damage + 0.02 >= hpBefore,
        usableForCalibration: damage > 0
          && hpBefore > damage + 0.02
          && !victimDbno
          && !wall
          && distMeters !== null,
        usableForValidation: damage > 0
          && hpBefore > 0
          && !victimDbno
          && !wall
          && distMeters !== null,
      });
      counts.samples += 1;

      // Aplicar quebras DEPOIS de registrar o sample.
      // Importante: marcamos broken APENAS via TakeDamage emparelhado com LogArmorDestroy
      // (não via LogArmorDestroy standalone) porque a ordem dos eventos no array
      // pode entrelaçar e gerar falso-positivo de "broken" antes de ler o TakeDamage.
      if (destroyedHelmet) vState.helmet = { itemId: destroyedHelmet.itemId, level: destroyedHelmet.level, broken: true };
      if (destroyedVest) vState.vest = { itemId: destroyedVest.itemId, level: destroyedVest.level, broken: true };
      continue;
    }
    // LogArmorDestroy standalone: ignorado de propósito. Vide comentário acima.
  }

  return { matchId, mapName, gameMode, createdAt, events: events.length, samples, counts };
}

function main() {
  const args = parseArgs(process.argv);
  const files = listTelemetryFiles(args);
  console.log(`telemetry files: ${files.length}`);

  const allSamples = [];
  const perMatch = [];
  const globalCounts = { totalTakeDamage: 0, nonGun: 0, nonZone: 0, selfDamage: 0, missingPlayer: 0, samples: 0 };
  const failed = {};

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const r = processTelemetry(file);
      allSamples.push(...r.samples);
      perMatch.push({ matchId: r.matchId, mapName: r.mapName, gameMode: r.gameMode, createdAt: r.createdAt, events: r.events, samples: r.samples.length, counts: r.counts });
      for (const k of Object.keys(globalCounts)) globalCounts[k] += r.counts[k];
      if ((i + 1) % 25 === 0 || i === files.length - 1) {
        console.log(`[${i + 1}/${files.length}] samples=${allSamples.length}`);
      }
    } catch (err) {
      failed[path.basename(file)] = err.message;
      console.log(`[${i + 1}/${files.length}] FAIL ${path.basename(file)} ${err.message}`);
    }
  }

  // Summary buckets
  const byZone = {}, byArmor = {}, byWeapon = {}, byZoneArmor = {};
  for (const s of allSamples) {
    byZone[s.zone] = (byZone[s.zone] || 0) + 1;
    byArmor[`${s.armorSlot || 'none'}-${s.armorLevel}`] = (byArmor[`${s.armorSlot || 'none'}-${s.armorLevel}`] || 0) + 1;
    byWeapon[s.weapon] = (byWeapon[s.weapon] || 0) + 1;
    const k = `${s.zone}|${s.armorSlot || 'none'}-${s.armorLevel}`;
    byZoneArmor[k] = (byZoneArmor[k] || 0) + 1;
  }

  const doc = {
    version: 2,
    generatedAt: new Date().toISOString(),
    telemetryFiles: files.length,
    matchesProcessed: perMatch.length,
    counts: globalCounts,
    totalSamples: allSamples.length,
    usableForCalibration: allSamples.filter(s => s.usableForCalibration).length,
    usableForValidation: allSamples.filter(s => s.usableForValidation).length,
    byZone,
    byArmor,
    byZoneArmor,
    byWeapon,
    failed,
    matches: perMatch,
    samples: allSamples,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(doc), 'utf8'); // sem indent pra economizar
  console.log(`\nwritten ${args.out}`);
  console.log(`samples=${doc.totalSamples} calibrationUsable=${doc.usableForCalibration} validationUsable=${doc.usableForValidation}`);
  console.log(`byZone:`, byZone);
  console.log(`byArmor:`, byArmor);
}

main();
