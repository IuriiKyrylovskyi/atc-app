#!/usr/bin/env node
/**
 * Downloads the VATSpy data project's FIR / UIR boundaries (Boundaries.geojson,
 * CC BY-SA 4.0, VATSIM community) into db/vatspy/, with the upstream commit it
 * came from. Used where an AIP sector follows a FIR border ("then clockwise
 * along Bangkok/Yangon FIR boundary"), which AIPs do not give as coordinates.
 *
 *   pnpm data:vatspy
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'db', 'vatspy');
const REPO = 'vatsimnetwork/vatspy-data-project';
const UA = { 'User-Agent': 'atc-app data fetch (development)' };

const meta = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=1&path=Boundaries.geojson`, { headers: UA });
if (!meta.ok) throw new Error(`GitHub API: HTTP ${meta.status}`);
const [latest] = await meta.json();
const sha = latest.sha;

const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/Boundaries.geojson`, { headers: UA });
if (!res.ok) throw new Error(`Boundaries.geojson: HTTP ${res.status}`);
const text = await res.text();
const features = JSON.parse(text).features.length;

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'Boundaries.geojson'), text);
writeFileSync(
  path.join(OUT, 'SOURCE'),
  `https://github.com/${REPO}\ncommit ${sha}\nretrieved ${new Date().toISOString().slice(0, 10)}\nlicence CC-BY-SA-4.0\n`
);
console.log(`Boundaries.geojson: ${features} boundaries, ${(text.length / 1e3).toFixed(0)} KB (commit ${sha.slice(0, 7)})`);
console.log(`Ready: ${path.relative(ROOT, OUT)}`);
