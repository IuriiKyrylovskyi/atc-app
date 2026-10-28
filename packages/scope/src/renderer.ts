/**
 * Canvas 2D scope renderer.
 *
 * Canvas 2D (not Phaser/WebGL) for the scope: a radar picture is thin vector
 * lines and small monospace text, which Canvas 2D draws crisply at any DPR with
 * no texture management; a full NY TMA frame (~1 300 fixes, ~100 airways) draws in
 * a few milliseconds. Free, built into every browser, no paid alternative needed.
 *
 * Declutter follows the range knob: fewer symbols and labels as the range grows,
 * and labels never overlap (first come, first placed, navaids before waypoints).
 */
import { M_PER_NM, type LocalXY } from '@atc-app/sim';
import type { ScopeView, ScreenXY } from './view';
import type { MapFix, VideoMap } from './videomap';
import { dataBlockLines, leaderVector, type TrafficTrack } from './traffic';

export interface ScopeLayers {
  rangeRings: boolean;
  airways: boolean;
  fixes: boolean;
  labels: boolean;
  runways: boolean;
  centrelines: boolean;
  airports: boolean;
}

export const DEFAULT_LAYERS: ScopeLayers = {
  rangeRings: true,
  airways: true,
  fixes: true,
  labels: true,
  runways: true,
  centrelines: true,
  airports: true,
};

export const SCOPE_PALETTE = {
  background: '#0b1620',
  ring: '#1c3342',
  ringLabel: '#35596d',
  airway: '#21404f',
  waypoint: '#4f7386',
  waypointLabel: '#5f8396',
  navaid: '#7fa3b5',
  navaidLabel: '#8fb0c0',
  runway: '#d8e4ea',
  centreline: '#3a5f72',
  airportLabel: '#a9bfca',
  scaleBar: '#5f8396',
} as const;

const FONT = '11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

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

export class ScopeRenderer {
  constructor(private readonly ctx: Ctx2D) {}

  /** Draws one frame. Canvas backing size must be view.widthPx × dpr etc. */
  draw(view: ScopeView, map: VideoMap, layers: ScopeLayers = DEFAULT_LAYERS): DrawStats {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ctx = this.ctx;
    const stats: DrawStats = { fixes: 0, labels: 0, airwaySegments: 0, runways: 0, ms: 0 };
    const range = view.rangeNm;
    const S = (p: LocalXY): ScreenXY => view.toScreen(p);
    const grid = new LabelGrid();

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = SCOPE_PALETTE.background;
    ctx.fillRect(0, 0, view.widthPx, view.heightPx);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // ── Range rings around the pack reference (labels placed last: they yield to fixes)
    const ringLabels: { text: string; x: number; y: number }[] = [];
    if (layers.rangeRings) {
      const step = range <= 20 ? 5 : range <= 80 ? 10 : 20;
      const centre = S({ x: 0, y: 0 });
      ctx.strokeStyle = SCOPE_PALETTE.ring;
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
      ctx.strokeStyle = SCOPE_PALETTE.airway;
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

    // ── Extended centrelines (ILS runways) ────────────────────────────────
    if (layers.centrelines) {
      ctx.strokeStyle = SCOPE_PALETTE.centreline;
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
      ctx.strokeStyle = SCOPE_PALETTE.runway;
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
      ctx.strokeStyle = SCOPE_PALETTE.waypoint;
      ctx.beginPath();
      for (const f of waypoints) {
        const s = S(f.xy);
        ctx.moveTo(s.x, s.y - 3.5);
        ctx.lineTo(s.x + 3.5, s.y + 2.5);
        ctx.lineTo(s.x - 3.5, s.y + 2.5);
        ctx.closePath();
        stats.fixes++;
      }
      ctx.stroke();
      ctx.strokeStyle = SCOPE_PALETTE.navaid;
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

    // ── Airports ──────────────────────────────────────────────────────────
    if (layers.airports) {
      ctx.fillStyle = SCOPE_PALETTE.airportLabel;
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
      if (range <= DECLUTTER.navaidLabel) for (const f of navaids) label(f, SCOPE_PALETTE.navaidLabel);
      for (const f of waypoints) {
        if (f.onRoute && range <= DECLUTTER.waypointLabelOnRoute) label(f, SCOPE_PALETTE.waypointLabel);
      }
      for (const f of waypoints) {
        if (!f.onRoute && range <= DECLUTTER.waypointLabelOther) label(f, SCOPE_PALETTE.waypointLabel);
      }
    }

    ctx.fillStyle = SCOPE_PALETTE.ringLabel;
    for (const l of ringLabels) {
      if (grid.place(l.x, l.y - 6, ctx.measureText(l.text).width, 12)) ctx.fillText(l.text, l.x, l.y);
    }

    // ── Scale bar ─────────────────────────────────────────────────────────
    const barNm = [1, 2, 5, 10, 20, 50].find((n) => n * view.pxPerNm >= 60) ?? 50;
    const barPx = barNm * view.pxPerNm;
    const bx = view.widthPx - 20 - barPx;
    const by = view.heightPx - 20;
    ctx.strokeStyle = SCOPE_PALETTE.scaleBar;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.lineTo(bx + barPx, by - 4);
    ctx.stroke();
    ctx.fillStyle = SCOPE_PALETTE.scaleBar;
    ctx.textAlign = 'right';
    ctx.fillText(`${barNm} NM`, bx + barPx, by - 10);
    ctx.textAlign = 'left';

    stats.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return stats;
  }

  /**
   * Draws traffic on top of the video map: history dots, speed vectors, leader
   * lines, targets and full data blocks. Returns hit boxes for selection.
   */
  drawTraffic(view: ScopeView, tracks: readonly TrafficTrack[], opts: TrafficOptions): TrafficDrawResult {
    const ctx = this.ctx;
    const hits: TrafficHit[] = [];
    const S = (p: LocalXY): ScreenXY => view.toScreen(p);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Margin wide enough for a data block of a target just off screen.
    const visible = tracks.filter((t) => view.isVisible(t.xy, 120));

    // ── History: oldest faintest ──────────────────────────────────────────
    const dots = Math.min(opts.historyDots, TRAFFIC_PALETTE.history.length);
    for (let i = dots - 1; i >= 0; i--) {
      ctx.fillStyle = TRAFFIC_PALETTE.history[i]!;
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

    // ── Speed vectors: where the aircraft will be in N minutes ────────────
    if (opts.vectorMinutes > 0) {
      ctx.strokeStyle = TRAFFIC_PALETTE.vector;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const t of visible) {
        const m = (t.ac.gsKt * M_PER_NM * opts.vectorMinutes) / 60;
        const tr = (t.ac.trackTrue * Math.PI) / 180;
        const a = S(t.xy);
        const b = S({ x: t.xy.x + m * Math.sin(tr), y: t.xy.y + m * Math.cos(tr) });
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }

    // ── Targets, leader lines, data blocks ────────────────────────────────
    const lineH = 12;
    for (const t of visible) {
      const s = S(t.xy);
      const selected = t.callsign === opts.selected;
      const colour = selected ? TRAFFIC_PALETTE.selected : TRAFFIC_PALETTE.dataBlock;

      ctx.fillStyle = selected ? TRAFFIC_PALETTE.selected : TRAFFIC_PALETTE.target;
      ctx.beginPath();
      ctx.arc(s.x, s.y, TARGET_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = TRAFFIC_PALETTE.selected;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, TARGET_RADIUS_PX + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      hits.push({
        callsign: t.callsign,
        x: s.x - TARGET_HIT_PX,
        y: s.y - TARGET_HIT_PX,
        w: TARGET_HIT_PX * 2,
        h: TARGET_HIT_PX * 2,
      });

      const lines = dataBlockLines(t.ac);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
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
      ctx.fillStyle = colour;
      lines.forEach((l, i) => ctx.fillText(l, bx, by + lineH * i + lineH / 2));
      hits.push({ callsign: t.callsign, x: bx, y: by, w, h });
    }
    return { hits, drawn: visible.length };
  }
}

export const TRAFFIC_PALETTE = {
  target: '#e6f2f8',
  dataBlock: '#8fe3a8',
  selected: '#ffd27a',
  vector: '#8fe3a8',
  /** Newest → oldest. */
  history: ['#5d8fae', '#4f7f9c', '#45718b', '#3c637a', '#34566a', '#2d4b5c', '#28414f', '#233944'],
} as const;

const TARGET_RADIUS_PX = 3.5;
const TARGET_HIT_PX = 10;
const LEADER_PX = 22;

export interface TrafficOptions {
  /** Speed vector length, minutes; 0 hides vectors. */
  vectorMinutes: number;
  historyDots: number;
  selected: string | null;
}

export const DEFAULT_TRAFFIC_OPTIONS: TrafficOptions = { vectorMinutes: 1, historyDots: 5, selected: null };

/** Screen-space box (CSS px) that selects an aircraft when clicked. */
export interface TrafficHit {
  callsign: string;
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
export function hitTest(hits: readonly TrafficHit[], p: ScreenXY): string | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!;
    if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h.callsign;
  }
  return null;
}

/** Distance between two local points in NM (cursor readouts). */
export const localDistanceNm = (a: LocalXY, b: LocalXY): number => Math.hypot(a.x - b.x, a.y - b.y) / M_PER_NM;
