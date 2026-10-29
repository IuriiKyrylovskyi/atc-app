#!/usr/bin/env node
/**
 * Downloads OurAirports airports.csv, runways.csv and navaids.csv (public domain) into
 * db/ourairports/. The mirror on GitHub Pages is updated nightly.
 *
 *   pnpm data:ourairports
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'db', 'ourairports');
const BASE = 'https://davidmegginson.github.io/ourairports-data/';

mkdirSync(OUT, { recursive: true });
for (const file of ['airports.csv', 'runways.csv', 'navaids.csv']) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(path.join(OUT, file), text);
  console.log(`${file}: ${(text.length / 1e6).toFixed(1)} MB`);
}
writeFileSync(path.join(OUT, 'RETRIEVED'), new Date().toISOString().slice(0, 10) + '\n');
console.log(`Ready: ${path.relative(ROOT, OUT)}`);
