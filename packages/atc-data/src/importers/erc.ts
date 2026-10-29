/**
 * EUROCONTROL ERC (European Route Chart) importer: the vector layers of an ERC
 * GeoPDF, extracted by `pnpm data:erc` (cli/erc-extract.ts) into db/erc/, turned
 * into pack content:
 *
 * - ATFM sectors: closed outlines ("ATFM Sector Symbol") with stacked labels
 *   ("UKBVW / 355 / UKBVL45 / 345 / … / UKBVL2"): each name gets the outline
 *   its label stack sits in, between the flight levels printed above and below
 *   it. The upper sheet (ercNNh) spans the state's high / low split up to FL660,
 *   the lower sheet (ercNNl) ground to the split.
 * - Designated points and navaids: symbol centres, named through the leader
 *   line from the symbol to its label (within ~0.05 NM of the symbol centre).
 * - ATS routes: route lines are broken around their labels; pieces are joined
 *   end to end where collinear, and segments between two symbols take the
 *   designators printed along them.
 *
 * Positions are as drawn (GIS export, sub-metre georeference): close, not
 * survey-exact. © EUROCONTROL — any reuse needs written permission, so packs
 * using it are devOnly (licence "EUROCONTROL-Development").
 */
import type { Airway, Area, LatLon } from '@atc-app/sim';
import { geoPdfTransform, type GeoPdfViewport } from './geopdf';

export const ERC_SOURCE_URL = 'https://www.eurocontrol.int/service/cartography';
export const ERC_LICENCE = 'EUROCONTROL-Development';

/** Layers kept by the extractor. */
export const ERC_LAYERS = [
  'ATFM Sector Symbol',
  'ATFM Sector Annotation',
  'Designated Point Symbol',
  'Designated Point Annotation',
  'Navaid System Symbol',
  'Navaid System Annotation',
  'ATS Route Symbol',
  'ATS Route Annotation',
] as const;

export interface ErcPath {
  layer: string;
  closed: boolean;
  /** x, y pairs in page units. */
  pts: number[];
}

export interface ErcText {
  layer: string;
  str: string;
  /** Baseline origin, page units. */
  x: number;
  y: number;
  /** Advance width and font size, page units; angle in degrees, counter-clockwise. */
  w: number;
  size: number;
  angle: number;
}

/** One extracted sheet (db/erc/<sheet>.json). */
export interface ErcSheet {
  /** "erc06h" (upper) / "erc06l" (lower). */
  sheet: string;
  /** ISO date of the chart edition. */
  edition: string;
  file: string;
  viewport: GeoPdfViewport;
  paths: ErcPath[];
  texts: ErcText[];
}

type XY = { x: number; y: number };

const pointsOf = (p: ErcPath): XY[] => Array.from({ length: p.pts.length / 2 }, (_, i) => ({ x: p.pts[2 * i]!, y: p.pts[2 * i + 1]! }));
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const isUpper = (s: ErcSheet) => /h$/i.test(s.sheet);

function pointInPolygon(p: XY, poly: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: readonly XY[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/** Text position in its own (rotated) frame: u along the baseline, v up. */
function textFrame(t: ErcText, p: XY): { u: number; v: number } {
  const r = (t.angle * Math.PI) / 180;
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return { u: dx * Math.cos(r) + dy * Math.sin(r), v: -dx * Math.sin(r) + dy * Math.cos(r) };
}

/** Distance from a point to a text's box (baseline origin, width × size, rotated). */
function distanceToText(t: ErcText, p: XY): number {
  const { u, v } = textFrame(t, p);
  const du = u < 0 ? -u : u > t.w ? u - t.w : 0;
  const dv = v < -0.25 * t.size ? -0.25 * t.size - v : v > t.size ? v - t.size : 0;
  return Math.hypot(du, dv);
}

// ─── ATFM sectors ────────────────────────────────────────────────────────────

const SECTOR_NAME = /^[A-Z]{4}[A-Z0-9]{1,6}$/;
const FLIGHT_LEVEL = /^[-\s]*(\d{3})\s*$/; // "  355", or "------ 355" with its separator

interface LabelStack {
  /** Top to bottom: names, with the flight level between each pair. */
  names: string[];
  levels: number[];
  anchor: XY;
}

/** Groups ATFM labels into stacks (lines a few units apart, same size and angle). */
export function ercLabelStacks(texts: readonly ErcText[]): LabelStack[] {
  const items = texts.filter((t) => t.layer === 'ATFM Sector Annotation');
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (Math.abs(a.size - b.size) > 0.3 || Math.abs(a.angle - b.angle) > 3) continue;
      // Next line of the same box: within ~1.5 line heights across, a box width along.
      const { u, v } = textFrame(a, b);
      if (Math.abs(v) < 1.5 * a.size && u > -2 * a.size && u < 7 * a.size) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, ErcText[]>();
  items.forEach((t, i) => {
    const g = groups.get(find(i));
    if (g) g.push(t);
    else groups.set(find(i), [t]);
  });
  const stacks: LabelStack[] = [];
  for (const g of groups.values()) {
    const ref = g[0]!;
    g.sort((a, b) => textFrame(ref, b).v - textFrame(ref, a).v);
    const names: string[] = [];
    const levels: number[] = [];
    let anchor: XY | null = null;
    for (const t of g) {
      const s = t.str.trim();
      if (SECTOR_NAME.test(s)) {
        names.push(s);
        anchor ??= { x: t.x, y: t.y };
      } else {
        // A level printed under a name is the boundary between it and the next name.
        const m = FLIGHT_LEVEL.exec(t.str);
        if (m && names.length > 0) levels[names.length - 1] = Number(m[1]);
      }
    }
    if (!names.length || !anchor) continue;
    stacks.push({ names, levels: levels.slice(0, names.length - 1), anchor });
  }
  return stacks;
}

export interface ErcSectorOptions {
  /** ATFM sector name prefix to keep ("UKBV": Kyiv ACC). */
  prefix: string;
  /** Display name prefix ("Kyiv ACC"). */
  label?: string;
  /** The state's ATFM high / low split on the ERC sheets, ft (Ukraine FL275). */
  splitFt: number;
  /** Bottom of the lower sheet and top of the upper sheet, ft. */
  floorFt?: number;
  ceilingFt?: number;
}

interface Volume {
  name: string;
  key: string;
  polygon: LatLon[];
  floorFt: number;
  ceilingFt: number;
}

/**
 * ATFM sectors named `prefix…` from upper and lower sheets: one area per name,
 * the lowest volume as its outline and the others as parts; the same outline on
 * consecutive levels is one volume.
 */
export function ercSectors(sheets: readonly ErcSheet[], opts: ErcSectorOptions): { areas: Area[]; warnings: string[] } {
  const floor = opts.floorFt ?? 0;
  const ceiling = opts.ceilingFt ?? 66000;
  const volumes: Volume[] = [];
  const warnings: string[] = [];
  for (const sheet of sheets) {
    const { toLatLon } = geoPdfTransform(sheet.viewport);
    const [bottom, top] = isUpper(sheet) ? [opts.splitFt, ceiling] : [floor, opts.splitFt];
    const outlines = sheet.paths
      .filter((p) => p.layer === 'ATFM Sector Symbol' && p.closed)
      .map((p, i) => ({ i, pts: pointsOf(p) }))
      .map((o) => ({ ...o, area: polygonArea(o.pts) }));
    for (const st of ercLabelStacks(sheet.texts)) {
      if (!st.names.some((n) => n.startsWith(opts.prefix))) continue;
      const outline = outlines.filter((o) => pointInPolygon(st.anchor, o.pts)).sort((a, b) => a.area - b.area)[0];
      if (!outline) {
        warnings.push(`ERC ${sheet.sheet}: no outline around ${st.names.join(' / ')}`);
        continue;
      }
      const polygon = outline.pts.map((p) => toLatLon(p.x, p.y));
      st.names.forEach((name, k) => {
        if (!name.startsWith(opts.prefix)) return;
        const upper = k === 0 ? top : (st.levels[k - 1] ?? NaN) * 100;
        const lower = k === st.names.length - 1 ? bottom : (st.levels[k] ?? NaN) * 100;
        if (!Number.isFinite(upper) || !Number.isFinite(lower) || lower >= upper) {
          warnings.push(`ERC ${sheet.sheet}: ${name} has no usable vertical limits`);
          return;
        }
        volumes.push({ name, key: outline.pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '), polygon, floorFt: lower, ceilingFt: upper });
      });
    }
  }

  const byName = new Map<string, Volume[]>();
  for (const v of volumes) {
    const list = byName.get(v.name);
    if (list) list.push(v);
    else byName.set(v.name, [v]);
  }
  const areas: Area[] = [];
  for (const [name, list] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.floorFt - b.floorFt);
    const merged: Volume[] = [];
    for (const v of list) {
      const last = merged[merged.length - 1];
      if (last && last.key === v.key && last.ceilingFt >= v.floorFt) last.ceilingFt = Math.max(last.ceilingFt, v.ceilingFt);
      else merged.push({ ...v });
    }
    const [main, ...rest] = merged;
    areas.push({
      id: name,
      kind: 'sector',
      name: `${opts.label ? `${opts.label} ` : ''}${name.slice(opts.prefix.length) || name}`,
      polygon: main!.polygon,
      floorFt: main!.floorFt,
      ceilingFt: main!.ceilingFt,
      ...(rest.length ? { parts: rest.map((v) => ({ polygon: v.polygon, floorFt: v.floorFt, ceilingFt: v.ceilingFt })) } : {}),
    });
  }
  return { areas, warnings };
}

// ─── Points ──────────────────────────────────────────────────────────────────

export interface ErcPoint {
  id: string;
  kind: 'waypoint' | 'navaid';
  pos: LatLon;
}

interface Symbol {
  at: XY;
  kind: ErcPoint['kind'];
  id?: string;
}

/** Symbol centres of one sheet: designated points (triangles) and navaids. */
function symbols(sheet: ErcSheet): Symbol[] {
  const out: Symbol[] = [];
  for (const p of sheet.paths) {
    const pts = pointsOf(p);
    if (p.layer === 'Designated Point Symbol' && pts.length >= 3) {
      const v = pts.slice(0, 3);
      out.push({ kind: 'waypoint', at: { x: (v[0]!.x + v[1]!.x + v[2]!.x) / 3, y: (v[0]!.y + v[1]!.y + v[2]!.y) / 3 } });
    } else if (p.layer === 'Navaid System Symbol') {
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      out.push({ kind: 'navaid', at: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } });
    }
  }
  // Navaid symbols are drawn in several pieces: one symbol per centre.
  return out.filter((s, i) => s.kind === 'waypoint' || !out.slice(0, i).some((o) => o.kind === 'navaid' && dist(o.at, s.at) < 1));
}

const POINT_NAME = /^[A-Z][A-Z0-9]{1,4}$/;
/** A leader line starts this close to its symbol's centre, page units. */
const LEADER_SNAP = 1;
/** A leader's free end lies this close to its label box. */
const LEADER_TO_LABEL = 3;
/** Labels without a leader: nearest free symbol within this distance. */
const LABEL_TO_SYMBOL = 30;

/** Names the symbols of one sheet (leader lines first, then nearest free symbol). */
function nameSymbols(sheet: ErcSheet, syms: Symbol[], warnings: string[]): void {
  for (const kind of ['waypoint', 'navaid'] as const) {
    const layer = kind === 'waypoint' ? 'Designated Point Annotation' : 'Navaid System Annotation';
    const mine = syms.filter((s) => s.kind === kind);
    const labels = sheet.texts.filter((t) => t.layer === layer && POINT_NAME.test(t.str.trim()));
    const named = new Set<ErcText>();
    for (const p of sheet.paths) {
      if (p.layer !== layer || p.pts.length !== 4) continue;
      const [a, b] = pointsOf(p) as [XY, XY];
      for (const [end, free] of [[a, b], [b, a]] as const) {
        const s = mine.find((m) => !m.id && dist(m.at, end) < LEADER_SNAP);
        if (!s) continue;
        const label = labels
          .filter((t) => !named.has(t))
          .map((t) => ({ t, d: distanceToText(t, free) }))
          .filter((x) => x.d < LEADER_TO_LABEL)
          .sort((x, y) => x.d - y.d)[0];
        if (label) {
          s.id = label.t.str.trim();
          named.add(label.t);
        }
        break;
      }
    }
    // Labels set right next to their symbol (no leader).
    const pairs = labels
      .filter((t) => !named.has(t))
      .flatMap((t) => mine.filter((s) => !s.id).map((s) => ({ t, s, d: distanceToText(t, s.at) })))
      .filter((x) => x.d < LABEL_TO_SYMBOL)
      .sort((x, y) => x.d - y.d);
    for (const { t, s } of pairs) {
      if (named.has(t) || s.id) continue;
      s.id = t.str.trim();
      named.add(t);
    }
    const left = labels.filter((t) => !named.has(t)).length;
    if (left) warnings.push(`ERC ${sheet.sheet}: ${left} ${kind} labels without a symbol`);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const ROUTE_ID = /^[A-Z]{1,2}\d{1,4}[A-Z]?$/;
/** A route line ends this close to a symbol centre. */
const ROUTE_SNAP = 0.8;
/** Route pieces broken around a label: gap and direction tolerance. */
const JOIN_GAP = 45;
const JOIN_DEG = 4;
/** A designator sits this close to its segment (perpendicular), page units. */
const LABEL_TO_ROUTE = 12;

interface Piece {
  a: XY;
  b: XY;
  /** Direction at each end, pointing outwards. */
  da: XY;
  db: XY;
}

const unit = (v: XY): XY => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const angleDeg = (u: XY, v: XY) => (Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) * 180) / Math.PI;

/** Joins route pieces that continue each other across a label gap; returns straight chains. */
function joinPieces(pieces: Piece[], isNode: (p: XY) => boolean): Piece[] {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pieces.length && !changed; i++) {
      const p = pieces[i]!;
      for (const [end, dir] of [[p.b, p.db], [p.a, p.da]] as const) {
        if (isNode(end)) continue;
        let best: { j: number; atA: boolean; d: number } | null = null;
        for (let j = 0; j < pieces.length; j++) {
          if (j === i) continue;
          const q = pieces[j]!;
          for (const atA of [true, false]) {
            const e = atA ? q.a : q.b;
            const de = atA ? q.da : q.db;
            const d = dist(end, e);
            if (d > JOIN_GAP || isNode(e)) continue;
            // The gap continues p's direction, and q leaves the gap the same way.
            if (d > 0.5 && angleDeg(dir, unit({ x: e.x - end.x, y: e.y - end.y })) > JOIN_DEG) continue;
            if (angleDeg(dir, { x: -de.x, y: -de.y }) > JOIN_DEG) continue;
            if (!best || d < best.d) best = { j, atA, d };
          }
        }
        if (!best) continue;
        const q = pieces[best.j]!;
        const [far, farDir] = best.atA ? [q.b, q.db] : [q.a, q.da];
        const keep = end === p.b ? { a: p.a, da: p.da } : { a: p.b, da: p.db };
        pieces[i] = { a: keep.a, da: keep.da, b: far, db: farDir };
        pieces.splice(best.j, 1);
        changed = true;
        break;
      }
    }
  }
  return pieces;
}

/** Route segments with designators of one sheet, between named symbols. */
function sheetRoutes(sheet: ErcSheet, syms: Symbol[], keep: (p: XY) => boolean): Map<string, Set<string>> {
  const named = syms.filter((s) => s.id);
  const nodeAt = (p: XY) => named.find((s) => dist(s.at, p) < ROUTE_SNAP);
  const pieces: Piece[] = [];
  for (const path of sheet.paths) {
    if (path.layer !== 'ATS Route Symbol' || path.closed) continue;
    const pts = pointsOf(path);
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (dist(a, b) < 0.5 || (!keep(a) && !keep(b))) continue;
    pieces.push({ a, b, da: unit({ x: a.x - pts[1]!.x, y: a.y - pts[1]!.y }), db: unit({ x: b.x - pts[pts.length - 2]!.x, y: b.y - pts[pts.length - 2]!.y }) });
  }
  const chains = joinPieces(pieces, (p) => nodeAt(p) !== undefined);
  const segments = chains.flatMap((c) => {
    const from = nodeAt(c.a);
    const to = nodeAt(c.b);
    return from && to && from !== to ? [{ from, to }] : [];
  });

  const routes = new Map<string, Set<string>>();
  for (const t of sheet.texts) {
    const id = t.str.trim();
    if (t.layer !== 'ATS Route Annotation' || !ROUTE_ID.test(id)) continue;
    const r = (t.angle * Math.PI) / 180;
    const c = { x: t.x + (t.w / 2) * Math.cos(r) - (t.size / 2) * Math.sin(r), y: t.y + (t.w / 2) * Math.sin(r) + (t.size / 2) * Math.cos(r) };
    let best: { s: (typeof segments)[number]; d: number } | null = null;
    for (const s of segments) {
      const v = { x: s.to.at.x - s.from.at.x, y: s.to.at.y - s.from.at.y };
      const len = Math.hypot(v.x, v.y);
      const k = ((c.x - s.from.at.x) * v.x + (c.y - s.from.at.y) * v.y) / (len * len);
      if (k < 0 || k > 1) continue;
      const d = Math.abs((c.x - s.from.at.x) * v.y - (c.y - s.from.at.y) * v.x) / len;
      // Designators are written along their route.
      const diff = Math.abs(((Math.atan2(v.y, v.x) * 180) / Math.PI - t.angle + 360) % 180);
      if (d > LABEL_TO_ROUTE || Math.min(diff, 180 - diff) > 12) continue;
      if (!best || d < best.d) best = { s, d };
    }
    if (!best) continue;
    const key = [best.s.from.id!, best.s.to.id!].sort().join('|');
    const set = routes.get(id);
    if (set) set.add(key);
    else routes.set(id, new Set([key]));
  }
  return routes;
}

/** Segments "A|B" of one designator, ordered along the route where it is a simple chain. */
function orderSegments(keys: Set<string>): { from: string; to: string }[] {
  const edges = [...keys].map((k) => k.split('|') as [string, string]);
  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const left = new Set(edges);
  const out: { from: string; to: string }[] = [];
  while (left.size) {
    const starts = [...left].flat().filter((n) => degree.get(n) === 1).sort();
    let at = starts[0] ?? [...left][0]![0];
    for (;;) {
      const e = [...left].find(([a, b]) => a === at || b === at);
      if (!e) break;
      left.delete(e);
      const next = e[0] === at ? e[1] : e[0];
      out.push({ from: at, to: next });
      at = next;
    }
  }
  return out;
}

export interface ErcNavigation {
  points: ErcPoint[];
  airways: Airway[];
  warnings: string[];
}

/**
 * Points and routes of the sheets within `keep` (lat / lon test, e.g. the pack
 * radius). A name seen on several sheets keeps its first position.
 */
export function ercNavigation(sheets: readonly ErcSheet[], keep: (p: LatLon) => boolean): ErcNavigation {
  const warnings: string[] = [];
  const points = new Map<string, ErcPoint>();
  const routes = new Map<string, Set<string>>();
  for (const sheet of sheets) {
    const { toLatLon } = geoPdfTransform(sheet.viewport);
    const inside = (p: XY) => keep(toLatLon(p.x, p.y));
    const syms = symbols(sheet);
    nameSymbols(sheet, syms, warnings);
    for (const s of syms) {
      if (!s.id || points.has(s.id)) continue;
      const pos = toLatLon(s.at.x, s.at.y);
      points.set(s.id, { id: s.id, kind: s.kind, pos });
    }
    for (const [id, keys] of sheetRoutes(sheet, syms, inside)) {
      const set = routes.get(id) ?? new Set<string>();
      keys.forEach((k) => set.add(k));
      routes.set(id, set);
    }
  }
  const airways: Airway[] = [...routes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, keys]) => ({ id, segments: orderSegments(keys) }));
  return { points: [...points.values()], airways, warnings };
}
