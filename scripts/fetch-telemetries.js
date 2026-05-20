import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MATCHES_DIR = path.join(ROOT, 'cache', 'matches');

const DEFAULTS = {
  durationMs: 15 * 60 * 1000,
  concurrency: 4,
  limit: 0,
  platform: 'steam',
  perRequestTimeoutMs: 60 * 1000,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--minutes') { args.durationMs = Math.max(1, Number(n)) * 60 * 1000; i++; }
    else if (a === '--concurrency') { args.concurrency = Math.max(1, Number(n)); i++; }
    else if (a === '--limit') { args.limit = Math.max(0, Number(n)); i++; }
    else if (a === '--platform') { args.platform = String(n); i++; }
    else if (a === '--help') {
      console.log(`Usage: node scripts/fetch-telemetries.js [options]

Lê os match jsons já cacheados em cache/matches/<platform>_*.json,
descobre quais ainda não têm telemetry_*.json companheiro, e baixa do CDN
(endpoint público, não consome o rate limit de 10/min da chave).

Options:
  --minutes <n>      Tempo máximo total (default: 15)
  --concurrency <n>  Downloads em paralelo (default: 4)
  --limit <n>        Limitar quantidade total (default: 0 = sem limite)
  --platform <p>     Plataforma (default: steam)
`);
      process.exit(0);
    }
  }
  return args;
}

function listPending(platform) {
  if (!fs.existsSync(MATCHES_DIR)) return [];
  const all = fs.readdirSync(MATCHES_DIR);
  const matchPrefix = `${platform}_`;
  const haveTelemetry = new Set(
    all.filter(f => /^telemetry_.+\.json(\.gz)?$/.test(f))
      .map(f => f.replace(/^telemetry_/, '').replace(/\.json(\.gz)?$/, ''))
  );

  const pending = [];
  const skippedNoUrl = [];
  for (const file of all) {
    if (!file.startsWith(matchPrefix) || !file.endsWith('.json')) continue;
    if (file.startsWith('telemetry_')) continue;
    const matchId = file.slice(matchPrefix.length, -'.json'.length);
    if (haveTelemetry.has(matchId)) continue;
    let url = null;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MATCHES_DIR, file), 'utf8'));
      url = data?.included?.find(i => i?.type === 'asset')?.attributes?.URL || null;
    } catch {
      url = null;
    }
    if (url) pending.push({ matchId, url });
    else skippedNoUrl.push(matchId);
  }
  return { pending, skippedNoUrl };
}

function fmt(n) { return String(n).padStart(3, ' '); }
function pad8(s) { return String(s).slice(0, 8); }

async function fetchTelemetry({ matchId, url }, timeoutMs) {
  const dest = path.join(MATCHES_DIR, `telemetry_${matchId}.json.gz`);
  const res = await axios.get(url, {
    timeout: timeoutMs,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    responseType: 'json',
  });
  fs.writeFileSync(dest, zlib.gzipSync(JSON.stringify(res.data)));
  const events = Array.isArray(res.data) ? res.data.length : null;
  const bytes = fs.statSync(dest).size;
  return { events, bytes };
}

async function main() {
  const args = parseArgs(process.argv);
  const { pending, skippedNoUrl } = listPending(args.platform);
  const queue = args.limit > 0 ? pending.slice(0, args.limit) : pending;

  console.log(`platform=${args.platform}`);
  console.log(`pending=${pending.length} (no URL=${skippedNoUrl.length}) planned=${queue.length}`);
  console.log(`concurrency=${args.concurrency} duration=${(args.durationMs / 60000).toFixed(1)}min`);

  if (!queue.length) {
    console.log('Nothing to do — todas as partidas cacheadas já têm telemetria.');
    return;
  }

  const deadline = Date.now() + args.durationMs;
  const stats = { done: 0, fail: 0, bytes: 0, events: 0 };
  let cursor = 0;
  let stopped = false;

  function tag(workerId) { return `[w${workerId}]`; }

  async function worker(workerId) {
    while (!stopped) {
      if (Date.now() >= deadline) { stopped = true; return; }
      const i = cursor++;
      if (i >= queue.length) return;
      const item = queue[i];
      const t0 = Date.now();
      try {
        const { events, bytes } = await fetchTelemetry(item, args.perRequestTimeoutMs);
        stats.done += 1;
        stats.bytes += bytes;
        if (typeof events === 'number') stats.events += events;
        const took = ((Date.now() - t0) / 1000).toFixed(1);
        const remain = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        console.log(`${tag(workerId)} ${fmt(stats.done)} ok  ${pad8(item.matchId)} events=${events ?? '?'} ${mb}MB (${took}s) — ${remain}s left, ${stats.done + stats.fail}/${queue.length}`);
      } catch (err) {
        stats.fail += 1;
        const code = err.response?.status || err.code || 'ERR';
        console.log(`${tag(workerId)} ${fmt(stats.fail)} fail ${pad8(item.matchId)} [${code}] ${err.message}`);
      }
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: args.concurrency }, (_, k) => worker(k + 1)));
  const tookMin = ((Date.now() - startedAt) / 60000).toFixed(1);

  console.log('');
  console.log(`Finished in ${tookMin}min — fetched=${stats.done} failed=${stats.fail}`);
  console.log(`totalEvents=${stats.events.toLocaleString('en-US')} totalBytes=${(stats.bytes / (1024 * 1024)).toFixed(1)}MB`);
  if (stopped && cursor < queue.length) {
    console.log(`Time budget esgotou — ${queue.length - stats.done - stats.fail} ainda na fila. Rode de novo para continuar.`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
