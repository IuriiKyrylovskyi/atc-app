#!/usr/bin/env node
/**
 * Downloads the FAA CIFP (ARINC 424) for an AIRAC cycle into db/faa-cifp/ and
 * extracts FAACIFP18. Public domain (US Government work).
 *
 *   pnpm data:cifp            cycle effective today
 *   pnpm data:cifp --next     next cycle (published ~3 weeks before it starts)
 *   pnpm data:cifp 2611       a specific cycle
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'db', 'faa-cifp');

// AIRAC 2601 became effective 2026-01-22; every cycle is 28 days, 13 per year
// (occasionally 14 — the cycle number then comes from counting within the year).
const EPOCH = Date.UTC(2026, 0, 22);
const DAY = 86_400_000;

function cycleStart(index) {
  return new Date(EPOCH + index * 28 * DAY);
}

function cycleId(start) {
  const year = start.getUTCFullYear();
  const firstOfYear = Math.ceil((Date.UTC(year, 0, 1) - EPOCH) / (28 * DAY));
  const n = Math.round((start.getTime() - EPOCH) / (28 * DAY)) - firstOfYear + 1;
  return `${String(year).slice(2)}${String(n).padStart(2, '0')}`;
}

function pickCycle(arg) {
  const today = Math.floor((Date.now() - EPOCH) / (28 * DAY));
  if (!arg) return cycleStart(today);
  if (arg === '--next') return cycleStart(today + 1);
  if (/^\d{4}$/.test(arg)) {
    for (let i = today - 30; i < today + 30; i++) if (cycleId(cycleStart(i)) === arg) return cycleStart(i);
  }
  throw new Error(`Unknown cycle "${arg}" — use nothing, --next or an AIRAC id like 2611`);
}

const start = pickCycle(process.argv[2]);
const yymmdd = start.toISOString().slice(2, 10).replaceAll('-', '');
const url = `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_${yymmdd}.zip`;
const zip = path.join(OUT, `CIFP_${yymmdd}.zip`);

mkdirSync(OUT, { recursive: true });
if (!existsSync(zip)) {
  console.log(`Downloading AIRAC ${cycleId(start)} (effective ${start.toISOString().slice(0, 10)})\n  ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} — the cycle may not be published yet`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
}
execFileSync('unzip', ['-o', '-q', zip, 'FAACIFP18', '-d', OUT], { stdio: 'inherit' });
console.log(`Ready: ${path.relative(ROOT, path.join(OUT, 'FAACIFP18'))} (AIRAC ${cycleId(start)})`);
