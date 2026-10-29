#!/usr/bin/env node
/**
 * Downloads the ENR pages of a state's eAIP (EUROCONTROL eAIP HTML format) into
 * db/eaip-<state>/<edition>/: ENR 2.1 (ATS airspace), ENR 3.1 / 3.3 (routes),
 * ENR 4.1 (navaids), ENR 4.4 (significant points).
 *
 *   pnpm data:eaip th                # Thailand, latest effective AIRAC edition
 *   pnpm data:eaip th --edition 2026-10-29
 *
 * AIP content is state copyright: fine for development; check the state's terms
 * before shipping data built from it (ATC_ARCHITECTURE.md §5.2).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STATES = {
  th: {
    name: 'Thailand (CAAT AIS)',
    index: 'https://aip.caat.or.th/',
    editionUrl: (e) => `https://aip.caat.or.th/${e}-AIRAC/html/eAIP/`,
    prefix: 'VT',
    pages: ['ENR-2.1', 'ENR-3.1', 'ENR-3.3', 'ENR-4.1', 'ENR-4.4'],
  },
};

const args = process.argv.slice(2).filter((a) => a !== '--');
const state = args[0];
const cfg = STATES[state];
if (!cfg) {
  console.error(`usage: pnpm data:eaip <state> [--edition YYYY-MM-DD]   (states: ${Object.keys(STATES).join(', ')})`);
  process.exit(1);
}
const at = args.indexOf('--edition');
let edition = at >= 0 ? args[at + 1] : undefined;

const UA = { 'User-Agent': 'atc-app data fetch (development)' };
if (!edition) {
  const res = await fetch(cfg.index, { headers: UA });
  if (!res.ok) throw new Error(`${cfg.index}: HTTP ${res.status}`);
  const today = new Date().toISOString().slice(0, 10);
  const editions = [...new Set((await res.text()).match(/\d{4}-\d{2}-\d{2}(?=-AIRAC)/g) ?? [])].sort();
  edition = editions.filter((e) => e <= today).pop();
  if (!edition) throw new Error('no effective edition found on the index page');
}

const out = path.join(ROOT, 'db', `eaip-${state}`, edition);
mkdirSync(out, { recursive: true });
for (const page of cfg.pages) {
  const file = `${cfg.prefix}-${page}-en-GB.html`;
  const res = await fetch(cfg.editionUrl(edition) + file, { headers: UA });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(path.join(out, file), text);
  console.log(`${file}: ${(text.length / 1e3).toFixed(0)} KB`);
}
writeFileSync(path.join(out, 'EDITION'), `${edition}\n${cfg.name}\nretrieved ${new Date().toISOString().slice(0, 10)}\n`);
console.log(`Ready: ${path.relative(ROOT, out)} (${cfg.name}, AIRAC edition ${edition})`);
