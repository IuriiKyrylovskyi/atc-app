/**
 * pnpm pack:build [<id> …] [--all] [--out <dir>] [--cifp <file>] [--ourairports <dir>] [--flag-above <m>]
 *
 * Builds the packs defined in packs/<id>.pack.json from the downloaded sources in
 * db/ (pnpm data:cifp, pnpm data:ourairports, pnpm data:eaip <state>), validates them, writes
 * packs/dist/<id>@<airac>.json + manifest.json, and reports the runway
 * cross-check and the diff against the previous AIRAC build. Exits 1 if any pack
 * fails validation (that pack is not written). Packs built from state AIP data
 * are flagged `devOnly` in the manifest (development builds only).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AirspacePack, LatLon } from '@atc-app/sim';
import { readCifpRecords } from '../importers/cifp';
import { buildOpenPack, buildPack, type BorderSource, type BuildResult, type OpenBuildInputs } from '../build/build-pack';
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

/** VATSpy FIR / UIR borders (db/vatspy/Boundaries.geojson, pnpm data:vatspy): largest outer ring per id. */
function loadVatspy(): BorderSource {
  const dir = path.join(ROOT, 'db', 'vatspy');
  const file = path.join(dir, 'Boundaries.geojson');
  if (!existsSync(file)) throw new Error('db/vatspy missing — run pnpm data:vatspy');
  const geo = JSON.parse(readFileSync(file, 'utf8')) as {
    features: { properties: { id?: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[];
  };
  const rings = new Map<string, LatLon[]>();
  for (const f of geo.features) {
    const id = f.properties.id;
    if (!id) continue;
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    for (const poly of polys) {
      const outer = poly[0]!.map(([lon, lat]) => ({ lat: lat!, lon: lon! }));
      if (outer.length > (rings.get(id)?.length ?? 0)) rings.set(id, outer);
    }
  }
  const info = existsSync(path.join(dir, 'SOURCE')) ? readFileSync(path.join(dir, 'SOURCE'), 'utf8').split('\n') : [];
  return {
    ring: (id) => rings.get(id),
    source: {
      name: `VATSpy data project FIR borders (${(info[1] ?? '').replace('commit ', '').slice(0, 7) || 'unknown commit'})`,
      licence: 'CC-BY-SA-4.0',
      url: 'https://github.com/vatsimnetwork/vatspy-data-project',
      retrieved: (info[2] ?? '').replace('retrieved ', '').trim() || isoDate(file),
    },
  };
}

/** Latest downloaded eAIP edition of a state (db/eaip-<state>/<edition>/). */
function loadEaip(state: string): (NonNullable<OpenBuildInputs['eaip']> & { retrieved: string }) {
  const dir = path.join(ROOT, 'db', `eaip-${state}`);
  const editions = existsSync(dir) ? readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  const edition = editions.pop();
  if (!edition) throw new Error(`no eAIP for "${state}" — run pnpm data:eaip ${state}`);
  const base = path.join(dir, edition);
  const page = (name: string) => {
    const f = readdirSync(base).find((x) => x.includes(`-${name}-`));
    return f ? readFileSync(path.join(base, f), 'utf8') : undefined;
  };
  const need = (name: string) => {
    const p = page(name);
    if (!p) throw new Error(`eAIP ${state} ${edition}: ${name} missing`);
    return p;
  };
  const info = existsSync(path.join(base, 'EDITION')) ? readFileSync(path.join(base, 'EDITION'), 'utf8').split('\n') : [];
  const enr33 = page('ENR-3.3');
  return {
    edition,
    stateName: info[1] ?? state.toUpperCase(),
    url: 'https://aip.caat.or.th/',
    enr31: need('ENR-3.1'),
    ...(enr33 ? { enr33 } : {}),
    enr41: need('ENR-4.1'),
    enr44: need('ENR-4.4'),
    retrieved: (info[2] ?? '').replace('retrieved ', '').trim() || edition,
  };
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

  const t0 = Date.now();
  const needCifp = defs.some((d) => d.source === 'cifp');
  if (needCifp && !existsSync(args.cifp)) throw new Error(`${path.relative(ROOT, args.cifp)} missing — run pnpm data:cifp`);
  const cifp = needCifp ? readCifpRecords(readFileSync(args.cifp, 'latin1')) : null;
  const haveOa = existsSync(path.join(args.ourairports, 'airports.csv'));
  const navaidsCsv = path.join(args.ourairports, 'navaids.csv');
  const ourAirports = haveOa
    ? {
        airportsCsv: readFileSync(path.join(args.ourairports, 'airports.csv'), 'utf8'),
        runwaysCsv: readFileSync(path.join(args.ourairports, 'runways.csv'), 'utf8'),
        ...(existsSync(navaidsCsv) ? { navaidsCsv: readFileSync(navaidsCsv, 'utf8') } : {}),
        retrieved: existsSync(path.join(args.ourairports, 'RETRIEVED'))
          ? readFileSync(path.join(args.ourairports, 'RETRIEVED'), 'utf8').trim()
          : isoDate(path.join(args.ourairports, 'airports.csv')),
      }
    : undefined;
  console.log(
    `Sources: ${cifp ? `CIFP AIRAC ${cifp.airac ?? '?'} (${(Date.now() - t0) / 1000}s)` : 'no CIFP pack requested'}` +
      (haveOa ? `, OurAirports ${ourAirports!.retrieved}` : ', OurAirports not downloaded (pnpm data:ourairports)')
  );

  mkdirSync(args.out, { recursive: true });
  const manifestPath = path.join(args.out, 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { packs: Record<string, unknown> })
    : { packs: {} as Record<string, unknown> };

  let failed = 0;
  for (const def of defs) {
    let r: BuildResult;
    if (def.source === 'open') {
      if (!ourAirports) throw new Error(`${def.id}: needs OurAirports (pnpm data:ourairports)`);
      const eaip = def.eaip ? loadEaip(def.eaip) : undefined;
      const borders = def.boundaries === 'vatspy' ? loadVatspy() : undefined;
      r = buildOpenPack(def, {
        ourAirports,
        ...(eaip ? { eaip } : {}),
        ...(borders ? { borders } : {}),
        retrieved: eaip?.retrieved ?? ourAirports.retrieved,
      });
    } else {
      if (!existsSync(args.cifp)) throw new Error(`${path.relative(ROOT, args.cifp)} missing — run pnpm data:cifp`);
      r = buildPack(def, { cifp: cifp!, ourAirports, retrieved: isoDate(args.cifp) }, { flagAboveM: args.flagAboveM });
    }
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
      ...(r.devOnly ? { devOnly: true } : {}),
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
