// Varre public/jsons/matches/<platform>_*.json e (re)constrói o índice
// matches_index_<platform>.json mapeando accountId → [{matchId, createdAt}].
//
// Necessário rodar uma vez pra criar o índice a partir do cache já existente.
// Depois disso, server.js mantém o índice atualizado on-the-fly via getMatch().
//
// Uso:
//   node scripts/build-matches-index.js              # processa todas plataformas detectadas
//   node scripts/build-matches-index.js --platform steam

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'public', 'jsons');
const MATCHES_DIR = path.join(CACHE_DIR, 'matches');

const PLATFORMS = new Set(['steam', 'psn', 'xbox', 'kakao', 'stadia']);

function parseArgs(argv) {
  const args = { platform: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--platform') { args.platform = argv[i + 1]; i++; }
  }
  return args;
}

function detectPlatforms() {
  if (!fs.existsSync(MATCHES_DIR)) return [];
  const found = new Set();
  for (const f of fs.readdirSync(MATCHES_DIR)) {
    if (f.startsWith('telemetry_')) continue;
    const m = f.match(/^([a-z]+)_/);
    if (m && PLATFORMS.has(m[1])) found.add(m[1]);
  }
  return [...found];
}

function buildIndex(platform) {
  const prefix = `${platform}_`;
  const files = fs.readdirSync(MATCHES_DIR)
    .filter(f => f.startsWith(prefix) && !f.startsWith('telemetry_') && f.endsWith('.json'));

  const players = {};
  let processed = 0, failed = 0;

  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MATCHES_DIR, f), 'utf8'));
      const matchId = data?.data?.id;
      const createdAt = data?.data?.attributes?.createdAt;
      if (!matchId) { failed++; continue; }
      for (const it of (data.included || [])) {
        if (it.type !== 'participant') continue;
        const accountId = it.attributes?.stats?.playerId;
        const name = it.attributes?.stats?.name;
        if (!accountId) continue;
        const entry = players[accountId] || { name, matches: [] };
        if (!entry.matches.some(m => m.id === matchId)) {
          entry.matches.push({ id: matchId, createdAt });
        }
        if (name) entry.name = name;
        players[accountId] = entry;
      }
      processed++;
    } catch (e) {
      failed++;
    }
  }

  // Ordena matches de cada player do mais recente pro mais antigo
  for (const e of Object.values(players)) {
    e.matches.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    platform,
    sourceFiles: files.length,
    processed,
    failed,
    playerCount: Object.keys(players).length,
    players,
  };

  const file = path.join(CACHE_DIR, `matches_index_${platform}.json`);
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log(`[${platform}] indexed ${out.playerCount} players across ${processed} matches (${failed} failed) → ${path.relative(ROOT, file)}`);
}

const args = parseArgs(process.argv);
const platforms = args.platform ? [args.platform] : detectPlatforms();
if (!platforms.length) {
  console.log('Nenhum match cacheado encontrado em public/jsons/matches/');
  process.exit(0);
}
for (const p of platforms) buildIndex(p);
