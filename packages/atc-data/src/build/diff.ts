/**
 * Differences between two builds of the same pack (normally consecutive AIRAC
 * cycles): what was added, removed, moved or changed. Used in the build report
 * and to flag scenarios that reference fixes which disappeared.
 */
import { distanceM, type AirspacePack, type Procedure } from '@atc-app/sim';

export interface MovedItem {
  id: string;
  movedM: number;
}

export interface PackDiff {
  fromAirac: string;
  toAirac: string;
  fixes: { added: string[]; removed: string[]; moved: MovedItem[] };
  runways: { added: string[]; removed: string[]; changed: string[] };
  procedures: { added: string[]; removed: string[]; changed: string[] };
  airways: { added: string[]; removed: string[]; changed: string[] };
  /** True when nothing differs beyond the movement tolerance. */
  unchanged: boolean;
}

const procKey = (p: Procedure) => `${p.airport} ${p.kind} ${p.id}${p.transition ? `.${p.transition}` : ''}`;

function keyed<T>(items: T[] | undefined, key: (t: T) => string): Map<string, T> {
  return new Map((items ?? []).map((t) => [key(t), t]));
}

function compareSets<T>(
  a: Map<string, T>,
  b: Map<string, T>,
  changed: (x: T, y: T) => boolean
): { added: string[]; removed: string[]; changed: string[] } {
  const added = [...b.keys()].filter((k) => !a.has(k)).sort();
  const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
  const diff = [...a.keys()].filter((k) => b.has(k) && changed(a.get(k)!, b.get(k)!)).sort();
  return { added, removed, changed: diff };
}

/** `toleranceM`: positions closer than this count as unchanged (default 1 m). */
export function diffPacks(prev: AirspacePack, next: AirspacePack, toleranceM = 1): PackDiff {
  const pf = keyed(prev.fixes, (f) => f.id);
  const nf = keyed(next.fixes, (f) => f.id);
  const moved: MovedItem[] = [];
  for (const [id, f] of pf) {
    const g = nf.get(id);
    if (!g) continue;
    const d = distanceM(f.pos, g.pos);
    if (d > toleranceM) moved.push({ id, movedM: d });
  }
  moved.sort((x, y) => y.movedM - x.movedM);

  const runways = compareSets(
    keyed(prev.runways, (r) => `${r.airport}/${r.id}`),
    keyed(next.runways, (r) => `${r.airport}/${r.id}`),
    (x, y) =>
      distanceM(x.threshold, y.threshold) > toleranceM ||
      Math.abs(x.lengthM - y.lengthM) > toleranceM ||
      JSON.stringify(x.ils ?? null) !== JSON.stringify(y.ils ?? null)
  );
  const procedures = compareSets(keyed(prev.procedures, procKey), keyed(next.procedures, procKey), (x, y) =>
    JSON.stringify(x.legs) !== JSON.stringify(y.legs)
  );
  const airways = compareSets(keyed(prev.airways, (a) => a.id), keyed(next.airways, (a) => a.id), (x, y) =>
    JSON.stringify(x.segments) !== JSON.stringify(y.segments)
  );
  const fixes = {
    added: [...nf.keys()].filter((k) => !pf.has(k)).sort(),
    removed: [...pf.keys()].filter((k) => !nf.has(k)).sort(),
    moved,
  };
  const empty = (s: { added: string[]; removed: string[] }) => s.added.length === 0 && s.removed.length === 0;
  return {
    fromAirac: prev.meta.airac,
    toAirac: next.meta.airac,
    fixes,
    runways,
    procedures,
    airways,
    unchanged:
      empty(fixes) && moved.length === 0 &&
      empty(runways) && runways.changed.length === 0 &&
      empty(procedures) && procedures.changed.length === 0 &&
      empty(airways) && airways.changed.length === 0,
  };
}

/** One-line summary for build logs. */
export function summarizeDiff(d: PackDiff): string {
  if (d.unchanged) return `AIRAC ${d.fromAirac} → ${d.toAirac}: no changes`;
  const part = (name: string, s: { added: string[]; removed: string[]; changed?: string[] }) =>
    `${name} +${s.added.length}/−${s.removed.length}${s.changed ? `/~${s.changed.length}` : ''}`;
  return [
    `AIRAC ${d.fromAirac} → ${d.toAirac}:`,
    `fixes +${d.fixes.added.length}/−${d.fixes.removed.length}/moved ${d.fixes.moved.length}`,
    part('runways', d.runways),
    part('procedures', d.procedures),
    part('airways', d.airways),
  ].join(' ');
}
