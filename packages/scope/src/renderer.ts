/**
 * Canvas 2D scope renderer.
 *
 * Canvas 2D (not Phaser/WebGL) for the scope: a radar picture is thin vector
 * lines and small text, which Canvas 2D draws crisply at any DPR with no
 * texture management; a full NY TMA frame (~1 300 fixes, ~100 airways) draws in
 * a few milliseconds. Free, built into every browser, no paid alternative needed.
 *
 * Every colour, font, track symbol and label layout comes from the selected
 * ATC system profile (systems.ts), so the same picture can look like a Selex,
 * an Indra or our generic display.
 *
 * Declutter follows the range knob: fewer symbols and labels as the range grows,
 * and labels never overlap (first come, first placed, navaids before waypoints).
 */
import { M_PER_NM, type Conflict, type LocalXY } from '@atc-app/sim';
import type { ScopeView, ScreenXY } from './view';
import type { MapFix, VideoMap } from './videomap';
import { leaderVector, type TrafficTrack } from './traffic';
import { clockTime, verticalLimits, type MapArea, type RoutePath } from './sectors';
import { GENERIC_SYSTEM, type ScopeSystem } from './systems';

export interface ScopeLayers {
  rangeRings: boolean;
  airways: boolean;
  fixes: boolean;
  labels: boolean;
  runways: boolean;
  centrelines: boolean;
  airports: boolean;
  /** Sector fills, borders and labels with vertical limits. */
  sectors: boolean;
  /** CTR / TMA and restricted / danger / prohibited areas. */
  areas: boolean;
}

export const DEFAULT_LAYERS: ScopeLayers = {
  rangeRings: true,
  airways: true,
  fixes: true,
  labels: true,
  runways: true,
  centrelines: true,
  airports: true,
  sectors: true,
  areas: true,
};

/** Range (NM) up to which each item is shown. */
export const DECLUTTER = {
  waypointOnRoute: 60,
  waypointOther: 25,
  waypointLabelOnRoute: 25,
  waypointLabelOther: 12,
  navaidLabel: 120,
  centrelineTicks: 30,
} as const;

/** The subset of CanvasRenderingContext2D the renderer uses (lets tests pass a fake). */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'setTransform' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' | 'arc'
  | 'closePath' | 'fillText' | 'measureText' | 'setLineDash' | 'save' | 'restore'
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

export interface DrawStats {
  fixes: number;
  labels: number;
  airwaySegments: number;
  runways: number;
  ms: number;
}

/** What the controller has selected on the map. */
export interface MapDrawOptions {
  /** Active sector id; null = all sectors. */
  activeSector: string | null;
}

/** Non-overlapping label placement on a coarse grid. */
class LabelGrid {
  private readonly cells = new Set<string>();
  private static readonly CELL = 8;

  place(x: number, y: number, w: number, h: number): boolean {
    const c = LabelGrid.CELL;
    const keys: string[] = [];
    for (let gx = Math.floor(x / c); gx <= Math.floor((x + w) / c); gx++) {
      for (let gy = Math.floor(y / c); gy <= Math.floor((y + h) / c); gy++) {
        const k = `${gx},${gy}`;
        if (this.cells.has(k)) return false;
        keys.push(k);
      }
    }
    for (const k of keys) this.cells.add(k);
    return true;
  }
}

const TERMINAL_KINDS = new Set(['CTR', 'TMA']);

export class ScopeRenderer {
  constructor(private readonly ctx: Ctx2D) {}

  private polygon(view: ScopeView, poly: readonly LocalXY[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    poly.forEach((p, i) => {
      const s = view.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  /** Draws one frame. Canvas backing size must be view.widthPx × dpr etc. */
  draw(
    view: ScopeView,
    map: VideoMap,
    layers: ScopeLayers = DEFAULT_LAYERS,
    system: ScopeSystem = GENERIC_SYSTEM,
    options: MapDrawOptions = { activeSector: null }
  ): DrawStats {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ctx = this.ctx;
    const P = system.map;
    const stats: DrawStats = { fixes: 0, labels: 0, airwaySegments: 0, runways: 0, ms: 0 };
    const range = view.rangeNm;
    const S = (p: LocalXY): ScreenXY => view.toScreen(p);
    const grid = new LabelGrid();

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = P.background;
    ctx.fillRect(0, 0, view.widthPx, view.heightPx);
    ctx.font = system.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // ── Airspace: the unit's sectors on the outside background, active one highlighted
    const active = map.sectors.find((s) => s.id === options.activeSector) ?? null;
    if (layers.sectors && map.sectors.length > 0) {
      ctx.fillStyle = P.airspace;
      for (const s of map.sectors) {
        this.polygon(view, s.polygon);
        ctx.fill();
      }
      if (active) {
        ctx.fillStyle = P.activeSector;
        this.polygon(view, active.polygon);
        ctx.fill();
      }
    }

    // ── Areas: CTR / TMA, restricted / danger / prohibited ────────────────
    if (layers.areas) {
      for (const a of map.areas) {
        const terminal = TERMINAL_KINDS.has(a.kind);
        ctx.fillStyle = terminal ? P.terminalFill : P.restrictedFill;
        ctx.strokeStyle = terminal ? P.terminalBorder : P.restrictedBorder;
        ctx.lineWidth = 1;
        ctx.setLineDash(terminal ? [] : [6, 3]);
        this.polygon(view, a.polygon);
        ctx.fill();
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ── Range rings around the pack reference (labels placed last: they yield to fixes)
    const ringLabels: { text: string; x: number; y: number }[] = [];
    if (layers.rangeRings) {
      const step = range <= 20 ? 5 : range <= 80 ? 10 : 20;
      const centre = S({ x: 0, y: 0 });
      ctx.strokeStyle = P.ring;
      ctx.lineWidth = 1;
      for (let nm = step; nm <= range * 2.5; nm += step) {
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, nm * view.pxPerNm, 0, Math.PI * 2);
        ctx.stroke();
        const ly = centre.y - nm * view.pxPerNm;
        if (ly > 8) ringLabels.push({ text: String(nm), x: centre.x + 3, y: ly + 7 });
      }
    }

    // ── Airways ───────────────────────────────────────────────────────────
    if (layers.airways) {
      ctx.strokeStyle = P.airway;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const a of map.airways) {
        if (!view.isVisible(a.from, 2000) && !view.isVisible(a.to, 2000)) continue;
        const p = S(a.from);
        const q = S(a.to);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        stats.airwaySegments++;
      }
      ctx.stroke();
    }

    // ── Sector borders (active on top, thicker) ───────────────────────────
    if (layers.sectors && map.sectors.length > 0) {
      ctx.strokeStyle = P.sectorBorder;
      ctx.lineWidth = P.sectorBorderWidth;
      for (const s of map.sectors) {
        if (s === active) continue;
        this.polygon(view, s.polygon);
        ctx.stroke();
      }
      if (active) {
        ctx.strokeStyle = P.activeSectorBorder;
        ctx.lineWidth = P.activeSectorBorderWidth;
        this.polygon(view, active.polygon);
        ctx.stroke();
      }
    }

    // ── Extended centrelines (ILS runways) ────────────────────────────────
    if (layers.centrelines) {
      ctx.strokeStyle = P.centreline;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (const r of map.runways) {
        if (!r.centreline) continue;
        const a = S(r.centreline.from);
        const b = S(r.centreline.to);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (range <= DECLUTTER.centrelineTicks) {
        ctx.beginPath();
        for (const r of map.runways) {
          if (!r.centreline) continue;
          const h = (r.centreline.headingTrue * Math.PI) / 180;
          // Perpendicular in screen space (screen y grows downwards).
          const px = Math.cos(h);
          const py = Math.sin(h);
          r.centreline.ticks.forEach((t, i) => {
            const s = S(t);
            const len = (i + 1) % 5 === 0 ? 7 : 3.5;
            ctx.moveTo(s.x - px * len, s.y - py * len);
            ctx.lineTo(s.x + px * len, s.y + py * len);
          });
        }
        ctx.stroke();
      }
    }

    // ── Runways ───────────────────────────────────────────────────────────
    if (layers.runways) {
      ctx.strokeStyle = P.runway;
      // Both directions of a runway overlap; drawing each is simpler than pairing them.
      for (const r of map.runways) {
        if (!view.isVisible(r.threshold, 200)) continue;
        const a = S(r.threshold);
        const b = S(r.end);
        ctx.lineWidth = Math.max(1.5, Math.min(4, (r.widthM / view.metresPerPx) * 1.5));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        stats.runways++;
      }
    }

    // ── Fixes ─────────────────────────────────────────────────────────────
    const navaids: MapFix[] = [];
    const waypoints: MapFix[] = [];
    for (const f of map.fixes) {
      if (!view.isVisible(f.xy)) continue;
      if (f.kind === 'vor' || f.kind === 'dme' || f.kind === 'ndb') navaids.push(f);
      else if (range <= (f.onRoute ? DECLUTTER.waypointOnRoute : DECLUTTER.waypointOther)) waypoints.push(f);
    }
    if (layers.fixes) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = P.waypoint;
      ctx.fillStyle = P.waypoint;
      ctx.beginPath();
      for (const f of waypoints) {
        const s = S(f.xy);
        ctx.moveTo(s.x, s.y - 3.5);
        ctx.lineTo(s.x + 3.5, s.y + 2.5);
        ctx.lineTo(s.x - 3.5, s.y + 2.5);
        ctx.closePath();
        stats.fixes++;
      }
      if (P.waypointFilled) ctx.fill();
      else ctx.stroke();
      ctx.strokeStyle = P.navaid;
      for (const f of navaids) {
        const s = S(f.xy);
        ctx.beginPath();
        if (f.kind === 'ndb') {
          ctx.setLineDash([1.5, 2]);
          ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i;
            const x = s.x + 5 * Math.cos(a);
            const y = s.y + 5 * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
          if (f.kind === 'vor') {
            ctx.beginPath();
            ctx.arc(s.x, s.y, 1, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        stats.fixes++;
      }
    }

    // ── Sector labels: id + vertical limits (placed before fix labels) ────
    if (layers.sectors) {
      for (const s of map.sectors) {
        if (!view.isVisible(s.labelAt)) continue;
        const p = S(s.labelAt);
        const lines = [s.id, verticalLimits(s)];
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
        if (!grid.place(p.x - w / 2, p.y - 12, w, 24)) continue;
        ctx.fillStyle = s === active ? P.activeSectorBorder : P.sectorLabel;
        ctx.textAlign = 'center';
        lines.forEach((l, i) => ctx.fillText(l, p.x, p.y - 6 + i * 12));
        ctx.textAlign = 'left';
        stats.labels++;
      }
    }

    // ── Airports ──────────────────────────────────────────────────────────
    if (layers.airports) {
      ctx.fillStyle = P.airportLabel;
      for (const a of map.airports) {
        if (!view.isVisible(a.xy)) continue;
        const s = S(a.xy);
        const w = ctx.measureText(a.icao).width;
        if (grid.place(s.x + 10, s.y + 6, w, 12)) {
          ctx.fillText(a.icao, s.x + 10, s.y + 12);
          stats.labels++;
        }
      }
    }

    // ── Fix labels (navaids first, then route waypoints, then the rest) ───
    if (layers.labels && layers.fixes) {
      const label = (f: MapFix, colour: string) => {
        const s = S(f.xy);
        const w = ctx.measureText(f.id).width;
        if (!grid.place(s.x + 6, s.y - 13, w, 12)) return;
        ctx.fillStyle = colour;
        ctx.fillText(f.id, s.x + 6, s.y - 7);
        stats.labels++;
      };
      if (range <= DECLUTTER.navaidLabel) for (const f of navaids) label(f, P.navaidLabel);
      for (const f of waypoints) {
        if (f.onRoute && range <= DECLUTTER.waypointLabelOnRoute) label(f, P.waypointLabel);
      }
      for (const f of waypoints) {
        if (!f.onRoute && range <= DECLUTTER.waypointLabelOther) label(f, P.waypointLabel);
      }
    }

    ctx.fillStyle = P.ringLabel;
    for (const l of ringLabels) {
      if (grid.place(l.x, l.y - 6, ctx.measureText(l.text).width, 12)) ctx.fillText(l.text, l.x, l.y);
    }

    // ── Scale bar ─────────────────────────────────────────────────────────
    const barNm = [1, 2, 5, 10, 20, 50].find((n) => n * view.pxPerNm >= 60) ?? 50;
    const barPx = barNm * view.pxPerNm;
    const bx = view.widthPx - 20 - barPx;
    const by = view.heightPx - 20;
    ctx.strokeStyle = P.scaleBar;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.lineTo(bx + barPx, by - 4);
    ctx.stroke();
    ctx.fillStyle = P.scaleBar;
    ctx.textAlign = 'right';
    ctx.fillText(`${barNm} NM`, bx + barPx, by - 10);
    ctx.textAlign = 'left';

    stats.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return stats;
  }

  /**
   * Draws traffic on top of the video map: route paths with ETOs, history dots,
   * speed vectors (one dash per minute), conflict pair lines, leader lines,
   * track symbols and labels, coloured by ownership (owned / incoming / other),
   * red with a blinking "CA" while in conflict. Returns hit boxes for selection.
   */
  drawTraffic(
    view: ScopeView,
    tracks: readonly TrafficTrack[],
    opts: TrafficOptions,
    conflicts: readonly Conflict[] = [],
    system: ScopeSystem = GENERIC_SYSTEM,
    routes: readonly RoutePath[] = []
  ): TrafficDrawResult {
    const ctx = this.ctx;
    const T = system.traffic;
    const hits: TrafficHit[] = [];
    const S = (p: LocalXY): ScreenXY => view.toScreen(p);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.font = system.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const byCallsign = new Map(tracks.map((t) => [t.callsign, t]));
    const inConflict = new Set<string>();
    for (const c of conflicts) {
      inConflict.add(c.a);
      inConflict.add(c.b);
    }
    const colourOf = (t: TrafficTrack) =>
      inConflict.has(t.callsign)
        ? T.alert
        : t.callsign === opts.selected && !T.selectedBox
          ? T.selected
          : T[t.ownership];

    // Margin wide enough for a data block of a target just off screen.
    const visible = tracks.filter((t) => view.isVisible(t.xy, 120));

    // ── Routes with ETOs (under everything else) ──────────────────────────
    for (const r of routes) {
      const t = byCallsign.get(r.callsign);
      if (!t || r.points.length === 0) continue;
      const colour = colourOf(t);
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      const start = S(t.xy);
      ctx.moveTo(start.x, start.y);
      for (const p of r.points) {
        const s = S(p.xy);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of r.points) {
        const s = S(p.xy);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${p.id} ${clockTime(p.etoS)}`, s.x + 6, s.y + 9);
      }
    }

    // ── History: oldest faintest ──────────────────────────────────────────
    const dots = Math.min(opts.historyDots, T.history.length);
    for (let i = dots - 1; i >= 0; i--) {
      ctx.fillStyle = T.history[i]!;
      ctx.beginPath();
      for (const t of visible) {
        const h = t.history[i];
        if (!h) continue;
        const s = S(h);
        ctx.moveTo(s.x + 1.6, s.y);
        ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // ── Speed vectors: one dash per minute of flight ──────────────────────
    if (opts.vectorMinutes > 0) {
      ctx.lineWidth = 1;
      for (const t of visible) {
        const perMinM = (t.ac.gsKt * M_PER_NM) / 60;
        const minutePx = perMinM / view.metresPerPx;
        const tr = (t.ac.trackTrue * Math.PI) / 180;
        const a = S(t.xy);
        const b = S({
          x: t.xy.x + perMinM * opts.vectorMinutes * Math.sin(tr),
          y: t.xy.y + perMinM * opts.vectorMinutes * Math.cos(tr),
        });
        // Each dash is one minute long; a short gap marks every minute boundary.
        const gap = Math.min(4, minutePx * 0.3);
        ctx.setLineDash([Math.max(1, minutePx - gap), gap]);
        ctx.strokeStyle = colourOf(t);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ── Conflict pairs: dashed while predicted, solid once lost ───────────
    ctx.strokeStyle = T.alert;
    ctx.fillStyle = T.alert;
    ctx.lineWidth = 1;
    for (const c of conflicts) {
      const ta = byCallsign.get(c.a);
      const tb = byCallsign.get(c.b);
      if (!ta || !tb) continue;
      const p = S(ta.xy);
      const q = S(tb.xy);
      ctx.setLineDash(c.kind === 'loss' ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(conflictLabel(c), (p.x + q.x) / 2, (p.y + q.y) / 2 - 8);
      ctx.textAlign = 'left';
    }
    ctx.setLineDash([]);

    // ── Tracks, leader lines, labels ──────────────────────────────────────
    const lineH = 13;
    for (const t of visible) {
      const s = S(t.xy);
      const selected = t.callsign === opts.selected;
      const alert = inConflict.has(t.callsign);
      const colour = colourOf(t);

      this.symbol(T.symbol, s, colour);
      if (selected && !T.selectedBox) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, TARGET_RADIUS_PX + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      hits.push({
        callsign: t.callsign,
        kind: 'target',
        x: s.x - TARGET_HIT_PX,
        y: s.y - TARGET_HIT_PX,
        w: TARGET_HIT_PX * 2,
        h: TARGET_HIT_PX * 2,
      });

      const ctxLabel = { ownership: t.ownership, sector: t.sector, nextFix: t.ac.target.directFix ?? undefined };
      const lines = selected ? T.selectedLabel(t.ac, ctxLabel) : T.label(t.ac, ctxLabel);
      // Width without the tag, so the block does not jump while "CA" blinks.
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (alert && opts.blinkOn) lines[0] = `${lines[0]} CA`;
      const h = lineH * lines.length;
      const { dx, dy } = leaderVector(t.leader);
      const start = { x: s.x + dx * (TARGET_RADIUS_PX + 2), y: s.y + dy * (TARGET_RADIUS_PX + 2) };
      const end = { x: s.x + dx * LEADER_PX, y: s.y + dy * LEADER_PX };
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Block corner nearest the target sits at the leader end.
      const bx = dx > 0.1 ? end.x + 2 : dx < -0.1 ? end.x - 2 - w : end.x - w / 2;
      const by = dy > 0.1 ? end.y : dy < -0.1 ? end.y - h : end.y - h / 2;
      const box = selected ? T.selectedBox : null;
      if (box) {
        const pad = 3;
        ctx.fillStyle = box.background;
        ctx.fillRect(bx - pad, by - pad, w + pad * 2, h + pad * 2);
        ctx.strokeStyle = alert ? T.alert : box.border;
        ctx.beginPath();
        ctx.moveTo(bx - pad, by - pad);
        ctx.lineTo(bx + w + pad, by - pad);
        ctx.lineTo(bx + w + pad, by + h + pad);
        ctx.lineTo(bx - pad, by + h + pad);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.fillStyle = box ? (alert ? T.alert : box.text) : colour;
      lines.forEach((l, i) => ctx.fillText(l, bx, by + lineH * i + lineH / 2));
      hits.push({ callsign: t.callsign, kind: 'label', x: bx, y: by, w, h });
    }
    return { hits, drawn: visible.length };
  }

  private symbol(kind: ScopeSystem['traffic']['symbol'], s: ScreenXY, colour: string): void {
    const ctx = this.ctx;
    const r = TARGET_RADIUS_PX;
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;
    if (kind === 'dot') {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'square') {
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    } else {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x - r - 1, s.y);
      ctx.lineTo(s.x + r + 1, s.y);
      ctx.moveTo(s.x, s.y - r - 1);
      ctx.lineTo(s.x, s.y + r + 1);
      ctx.stroke();
    }
  }
}

const TARGET_RADIUS_PX = 3.5;
const TARGET_HIT_PX = 10;
const LEADER_PX = 22;

export interface TrafficOptions {
  /** Speed vector length, minutes; 0 hides vectors. */
  vectorMinutes: number;
  historyDots: number;
  selected: string | null;
  /** Blink phase for the "CA" tag (the UI toggles it about twice a second). */
  blinkOn: boolean;
}

export const DEFAULT_TRAFFIC_OPTIONS: TrafficOptions = { vectorMinutes: 1, historyDots: 5, selected: null, blinkOn: true };

/** Pair line label: distance / height difference once lost, time to loss before. */
export function conflictLabel(c: Conflict): string {
  return c.kind === 'loss'
    ? `${c.lateralNm.toFixed(1)} NM ${String(Math.round(c.verticalFt / 100)).padStart(2, '0')}`
    : `CA ${Math.round(c.inS)}s`;
}

/** Screen-space box (CSS px) that selects an aircraft when clicked. */
export interface TrafficHit {
  callsign: string;
  /** The track symbol, or its label. */
  kind: 'target' | 'label';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrafficDrawResult {
  hits: TrafficHit[];
  drawn: number;
}

/** Topmost hit under a screen point (later boxes are drawn on top). */
export function hitTestDetail(hits: readonly TrafficHit[], p: ScreenXY): TrafficHit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!;
    if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h;
  }
  return null;
}

/** Callsign under a screen point. */
export function hitTest(hits: readonly TrafficHit[], p: ScreenXY): string | null {
  return hitTestDetail(hits, p)?.callsign ?? null;
}

/** Distance between two local points in NM (cursor readouts). */
export const localDistanceNm = (a: LocalXY, b: LocalXY): number => Math.hypot(a.x - b.x, a.y - b.y) / M_PER_NM;

/** The map palette of the generic system (kept for callers of the first scope MVP). */
export const SCOPE_PALETTE = GENERIC_SYSTEM.map;
