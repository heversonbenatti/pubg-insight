// Pipeline completo de atualização dos dados de armas a partir de telemetrias reais.
// Ordem das etapas (cada uma pode ser pulada com flag):
//   1. fetch-telemetries.js   — baixa telemetrias dos matches já cacheados em public/jsons/matches/
//   2. build-weapon-stats.js  — extrai stats das armas a partir dos game files (weapons/AlmostAll/...)
//   3. extract-damage-samples.js — varre todas telemetrias e gera AI_training/damage_samples.json
//   4. validate-damage-formula.js — valida fórmula contra as amostras → AI_training/damage_validation.json
//
// Uso:
//   node scripts/refresh-weapon-data.js                # roda tudo
//   node scripts/refresh-weapon-data.js --skip-fetch   # pula download de telemetrias
//   node scripts/refresh-weapon-data.js --skip-build   # pula re-build de weapon-stats
//   node scripts/refresh-weapon-data.js --fetch-minutes 30  # passa pra fetch-telemetries
//
// Pré-requisito: ter matches cacheados em public/jsons/matches/. Pra encher esse cache,
// abrir o app e ver alguns jogadores — cada visualização de partida no replay cria um
// `steam_<matchId>.json` que serve de fonte pras telemetrias.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    skipFetch: false,
    skipBuild: false,
    skipExtract: false,
    skipValidate: false,
    fetchMinutes: null,
    fetchConcurrency: null,
    extractLimit: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === '--skip-fetch') args.skipFetch = true;
    else if (a === '--skip-build') args.skipBuild = true;
    else if (a === '--skip-extract') args.skipExtract = true;
    else if (a === '--skip-validate') args.skipValidate = true;
    else if (a === '--fetch-minutes') { args.fetchMinutes = n; i++; }
    else if (a === '--fetch-concurrency') { args.fetchConcurrency = n; i++; }
    else if (a === '--extract-limit') { args.extractLimit = n; i++; }
    else if (a === '--help' || a === '-h') {
      console.log(`Refresh pipeline. Etapas: fetch → build → extract → validate.
Flags: --skip-fetch, --skip-build, --skip-extract, --skip-validate
       --fetch-minutes N, --fetch-concurrency N, --extract-limit N`);
      process.exit(0);
    }
  }
  return args;
}

function runStep(label, script, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    console.log(`\n━━━ ${label} ━━━`);
    console.log(`> node ${path.relative(process.cwd(), script)} ${extraArgs.join(' ')}`.trim());
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=8192', script, ...extraArgs],
      { stdio: 'inherit' }
    );
    child.on('error', reject);
    child.on('exit', code => {
      const took = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`  ✓ ${label} (${took}s)`);
        resolve();
      } else {
        reject(new Error(`${label} falhou com código ${code}`));
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const t0 = Date.now();

  if (!args.skipFetch) {
    const flags = [];
    if (args.fetchMinutes) flags.push('--minutes', args.fetchMinutes);
    if (args.fetchConcurrency) flags.push('--concurrency', args.fetchConcurrency);
    await runStep('1/4  Fetch telemetries', path.join(__dirname, 'fetch-telemetries.js'), flags);
  } else {
    console.log('1/4  Fetch telemetries — pulado');
  }

  if (!args.skipBuild) {
    await runStep('2/4  Build weapon-stats.json from game files', path.join(__dirname, 'build-weapon-stats.js'));
  } else {
    console.log('2/4  Build weapon-stats — pulado');
  }

  if (!args.skipExtract) {
    const flags = [];
    if (args.extractLimit) flags.push('--limit', args.extractLimit);
    await runStep('3/4  Extract damage samples', path.join(__dirname, 'extract-damage-samples.js'), flags);
  } else {
    console.log('3/4  Extract damage samples — pulado');
  }

  if (!args.skipValidate) {
    await runStep('4/4  Validate damage formula', path.join(__dirname, 'validate-damage-formula.js'));
  } else {
    console.log('4/4  Validate damage formula — pulado');
  }

  const tot = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n✓ Pipeline concluído em ${tot}min`);
}

main().catch(err => {
  console.error('\n✗', err.message);
  process.exit(1);
});
