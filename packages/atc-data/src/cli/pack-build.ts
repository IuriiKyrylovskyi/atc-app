/**
 * pnpm pack:build [<id> …] [--all] [--out <dir>] [--cifp <file>] [--ourairports <dir>] [--flag-above <m>]
 *
 * Builds the packs defined in packs/<id>.pack.json from the downloaded sources in
 * db/ (pnpm data:cifp, pnpm data:ourairports), validates them, writes
 * packs/dist/<id>@<airac>.json + manifest.json, and reports the runway
 * cross-check and the diff against the previous AIRAC build. Exits 1 if any pack
 * fails validation (that pack is not written).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AirspacePack } from '@atc-app/sim';
import { readCifpRecords } from '../importers/cifp';
import { buildPack, type BuildResult } from '../build/build-pack';
import { parsePackDefinition, type PackDefinition } from '../build/definition';
import { diffPacks, summarizeDiff } from '../build/diff';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

interface Args {
  ids: string[];
  all: boolean;
  out: string;
  cifp: string;
  ourairports: string;
  flagAboveM: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    ids: [],
    all: false,
    out: path.join(ROOT, 'packs', 'dist'),
    cifp: path.join(ROOT, 'db', 'faa-cifp', 'FAACIFP18'),
    ourairports: path.join(ROOT, 'db', 'ourairports'),
    flagAboveM: 50,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    const next = () => {
      const n = argv[++i];
      if (!n) throw new Error(`${v} needs a value`);
      return n;
    };
    if (v === '--all') a.all = true;
    else if (v === '--out') a.out = path.resolve(next());
    else if (v === '--cifp') a.cifp = path.resolve(next());
    else if (v === '--ourairports') a.ourairports = path.resolve(next());
    else if (v === '--flag-above') a.flagAboveM = Number(next());
    else if (v === '--') continue;
    else if (v.startsWith('--')) throw new Error(`unknown option ${v}`);
    else a.ids.push(v);
  }
  return a;
}

const isoDate = (file: string) => statSync(file).mtime.toISOString().slice(0, 10);

function loadDefinitions(args: Args): PackDefinition[] {
  const dir = path.join(ROOT, 'packs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.pack.json'));
  const all = files.map((f) => parsePackDefinition(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))));
  if (args.all) return all;
  if (args.ids.length === 0) throw new Error(`name a pack (${all.map((d) => d.id).join(', ')}) or use --all`);
  return args.ids.map((id) => {
    const d = all.find((x) => x.id === id);
    if (!d) throw new Error(`no packs/${id}.pack.json`);
    return d;
  });
}

function previousBuild(out: string, id: string, airac: string): AirspacePack | null {
  if (!existsSync(out)) return null;
  const prev = readdirSync(out)
    .map((f) => /^(.+)@(\d{4})\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m && m[1] === id && m[2]! < airac)
    .sort((a, b) => b[2]!.localeCompare(a[2]!))[0];
  return prev ? (JSON.parse(readFileSync(path.join(out, prev[0]), 'utf8')) as AirspacePack) : null;
}

function report(def: PackDefinition, r: BuildResult): void {
  const p = r.pack;
  console.log(`\n■ ${def.id} — ${def.name} (AIRAC ${p.meta.airac})`);
  console.log(
    `  ${p.airports.length} airports · ${p.runways.length} runways · ${p.fixes.length} fixes · ` +
      `${p.airways?.length ?? 0} airways · ${p.procedures?.length ?? 0} procedures`
  );
  console.log(`  sources: ${p.meta.sources.map((s) => `${s.name} (${s.licence})`).join(', ')}`);
  if (r.warnings.length) {
    console.log(`  ${r.warnings.length} import warnings:`);
    for (const w of r.warnings.slice(0, 5)) console.log(`    · ${w}`);
    if (r.warnings.length > 5) console.log(`    · … ${r.warnings.length - 5} more`);
  }
  const c = r.crossCheck;
  if (c) {
    console.log(
      `  runway cross-check vs OurAirports: ${c.compared} compared, median ${c.medianDiffM?.toFixed(1) ?? '—'} m, ` +
        `max ${c.maxDiffM?.toFixed(1) ?? '—'} m, ${c.flagged.length} over ${c.flagAboveM} m` +
        (c.missing.length ? `, ${c.missing.length} not in OurAirports` : '')
    );
    for (const f of c.flagged.slice(0, 5)) {
      console.log(`    · ${f.airport}/${f.runway}: ${f.thresholdDiffM.toFixed(0)} m, heading Δ ${f.headingDiffDeg.toFixed(1)}°`);
    }
  }
  for (const w of r.validation.warnings) console.log(`  ⚠ ${w.path}: ${w.message}`);
  for (const e of r.validation.errors) console.log(`  ✗ ${e.path}: ${e.message}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const defs = loadDefinitions(args);
  if (!existsSync(args.cifp)) throw new Error(`${path.relative(ROOT, args.cifp)} missing — run pnpm data:cifp`);

  const t0 = Date.now();
  const cifp = readCifpRecords(readFileSync(args.cifp, 'latin1'));
  const haveOa = existsSync(path.join(args.ourairports, 'airports.csv'));
  const ourAirports = haveOa
    ? {
        airportsCsv: readFileSync(path.join(args.ourairports, 'airports.csv'), 'utf8'),
        runwaysCsv: readFileSync(path.join(args.ourairports, 'runways.csv'), 'utf8'),
        retrieved: existsSync(path.join(args.ourairports, 'RETRIEVED'))
          ? readFileSync(path.join(args.ourairports, 'RETRIEVED'), 'utf8').trim()
          : isoDate(path.join(args.ourairports, 'airports.csv')),
      }
    : undefined;
  console.log(
    `Sources: CIFP AIRAC ${cifp.airac ?? '?'} (${(Date.now() - t0) / 1000}s)` +
      (haveOa ? `, OurAirports ${ourAirports!.retrieved}` : ', OurAirports not downloaded (pnpm data:ourairports)')
  );

  mkdirSync(args.out, { recursive: true });
  const manifestPath = path.join(args.out, 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { packs: Record<string, unknown> })
    : { packs: {} as Record<string, unknown> };

  let failed = 0;
  for (const def of defs) {
    const r = buildPack(def, { cifp, ourAirports, retrieved: isoDate(args.cifp) }, { flagAboveM: args.flagAboveM });
    report(def, r);
    if (!r.validation.ok) {
      failed++;
      console.log(`  ✗ not written: ${r.validation.errors.length} validation errors`);
      continue;
    }
    const airac = r.pack.meta.airac;
    const prev = previousBuild(args.out, def.id, airac);
    const diff = prev ? diffPacks(prev, r.pack) : null;
    if (diff) {
      console.log(`  ${summarizeDiff(diff)}`);
      writeFileSync(path.join(args.out, `${def.id}@${airac}.diff.json`), JSON.stringify(diff, null, 1));
    }
    const file = `${def.id}@${airac}.json`;
    const body = JSON.stringify(r.pack);
    writeFileSync(path.join(args.out, file), body);
    manifest.packs[def.id] = {
      id: def.id,
      name: def.name,
      airac,
      file,
      bytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex'),
      counts: {
        airports: r.pack.airports.length,
        runways: r.pack.runways.length,
        fixes: r.pack.fixes.length,
        airways: r.pack.airways?.length ?? 0,
        procedures: r.pack.procedures?.length ?? 0,
      },
      sources: r.pack.meta.sources,
      crossCheck: r.crossCheck && {
        compared: r.crossCheck.compared,
        medianDiffM: r.crossCheck.medianDiffM,
        maxDiffM: r.crossCheck.maxDiffM,
        flagged: r.crossCheck.flagged.length,
      },
      ...(diff ? { diffFrom: diff.fromAirac } : {}),
      builtAt: new Date().toISOString(),
    };
    console.log(`  ✓ ${path.relative(ROOT, path.join(args.out, file))} (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (failed) process.exitCode = 1;
}

try {
  main();
} catch (e) {
  console.error(`pack:build: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
