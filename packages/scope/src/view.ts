/**
 * Scope view: maps local sector coordinates (metres east/north of the pack
 * reference, see StereographicProjection) to screen pixels and back.
 *
 * North-up, uniform scale. `rangeNm` is the distance from the view centre to
 * the nearest screen edge — what a controller selects with the range knob.
 * All screen values are CSS pixels; the renderer applies devicePixelRatio.
 */
import { M_PER_NM, type LocalXY } from '@atc-app/sim';

export interface ScreenXY {
  x: number;
  y: number;
}

export const MIN_RANGE_NM = 2;
export const MAX_RANGE_NM = 300;
/** Range presets offered by the UI (NM). */
export const RANGE_PRESETS_NM = [5, 10, 20, 40, 60, 80, 120, 200] as const;

export class ScopeView {
  widthPx = 1;
  heightPx = 1;
  dpr = 1;
  /** Local coordinates at the screen centre. */
  centre: LocalXY = { x: 0, y: 0 };
  private range = 40;

  constructor(init?: { widthPx?: number; heightPx?: number; dpr?: number; rangeNm?: number; centre?: LocalXY }) {
    if (init?.widthPx) this.widthPx = init.widthPx;
    if (init?.heightPx) this.heightPx = init.heightPx;
    if (init?.dpr) this.dpr = init.dpr;
    if (init?.centre) this.centre = { ...init.centre };
    if (init?.rangeNm) this.rangeNm = init.rangeNm;
  }

  get rangeNm(): number {
    return this.range;
  }

  set rangeNm(nm: number) {
    this.range = Math.min(MAX_RANGE_NM, Math.max(MIN_RANGE_NM, nm));
  }

  /** Metres per CSS pixel. */
  get metresPerPx(): number {
    return (this.range * M_PER_NM) / (Math.min(this.widthPx, this.heightPx) / 2);
  }

  /** CSS pixels per nautical mile. */
  get pxPerNm(): number {
    return M_PER_NM / this.metresPerPx;
  }

  resize(widthPx: number, heightPx: number, dpr = this.dpr): void {
    this.widthPx = Math.max(1, widthPx);
    this.heightPx = Math.max(1, heightPx);
    this.dpr = dpr;
  }

  toScreen(p: LocalXY): ScreenXY {
    const mpp = this.metresPerPx;
    return {
      x: this.widthPx / 2 + (p.x - this.centre.x) / mpp,
      y: this.heightPx / 2 - (p.y - this.centre.y) / mpp,
    };
  }

  toLocal(s: ScreenXY): LocalXY {
    const mpp = this.metresPerPx;
    return {
      x: this.centre.x + (s.x - this.widthPx / 2) * mpp,
      y: this.centre.y - (s.y - this.heightPx / 2) * mpp,
    };
  }

  /** Moves the map with the pointer: a drag of (dx, dy) px moves the picture by that much. */
  panBy(dxPx: number, dyPx: number): void {
    const mpp = this.metresPerPx;
    this.centre = { x: this.centre.x - dxPx * mpp, y: this.centre.y + dyPx * mpp };
  }

  /** Changes range by `factor` (< 1 zooms in) keeping the point under `at` fixed. */
  zoomAt(factor: number, at: ScreenXY): void {
    const anchor = this.toLocal(at);
    this.rangeNm = this.range * factor;
    const moved = this.toLocal(at);
    this.centre = { x: this.centre.x + anchor.x - moved.x, y: this.centre.y + anchor.y - moved.y };
  }

  /** True when a local point is within `marginPx` of the visible screen. */
  isVisible(p: LocalXY, marginPx = 20): boolean {
    const s = this.toScreen(p);
    return s.x >= -marginPx && s.y >= -marginPx && s.x <= this.widthPx + marginPx && s.y <= this.heightPx + marginPx;
  }
}
