/**
 * eAIP importer — states that publish their AIP in the EUROCONTROL eAIP HTML
 * format (Thailand, the Baltic states, Singapore, … and many others).
 *
 * Reads the tables of ENR 4.4 (significant points), ENR 4.1 (navaids) and
 * ENR 3.x (ATS / RNAV routes). Every value in these pages is a `<span class="SD">`
 * followed by a hidden `<span class="sdParams">` naming its AIXM field; the
 * hidden spans are dropped and the tables are read row by row (some rows tag
 * only half a coordinate, so the visible text is the reliable part).
 *
 * ATS airspace (ENR 2.1) is prose with radial/DME points, arcs and exclusions;
 * packs transcribe those sectors into their definition (build/definition.ts)
 * with the published values.
 *
 * AIP content is state copyright — fine for development; product use needs the
 * state's permission (ATC_ARCHITECTURE.md §5.2).
 */
import type { Airway, Fix, LatLon } from '@atc-app/sim';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Hidden AIXM parameter spans. Matched up to their `</span>` rather than the
 * opening tag's `>`: some published pages miss that `>` (Thailand ENR 4.1, BRM).
 */
const SD_PARAMS = /<span class="sdParams"[\s\S]*?<\/span>/g;

/** Table rows as cell texts, hidden AIXM parameter spans removed. */
export function eaipRows(html: string): string[][] {
  const clean = html.replace(SD_PARAMS, '');
  const rows: string[][] = [];
  for (const tr of clean.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    rows.push([...tr[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]!)));
  }
  return rows;
}

/** The page as plain text (hidden parameter spans removed). */
export function eaipText(html: string): string {
  return text(html.replace(SD_PARAMS, ''));
}

/** "135337N 1003546E" or "135452.0N1003620.0E" (DDMMSS[.s], DDDMMSS[.s]). */
export const DMS = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)\s*([EW])/;

export function parseDms(s: string): LatLon | null {
  const m = DMS.exec(s);
  if (!m) return null;
  const lat = (Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * (m[4] === 'S' ? -1 : 1);
  const lon = (Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600) * (m[8] === 'W' ? -1 : 1);
  return { lat, lon };
}

/** ENR 4.4: five-letter significant points with coordinates. */
export function importEaipPoints(enr44: string): Fix[] {
  const out: Fix[] = [];
  for (const c of eaipRows(enr44)) {
    const id = c[0] ?? '';
    const pos = c[1] ? parseDms(c[1]) : null;
    if (/^[A-Z]{5}$/.test(id) && pos) out.push({ id, kind: 'waypoint', pos });
  }
  return out;
}

/** ENR 4.1: VOR / DME / NDB stations (type from the name column). */
export function importEaipNavaids(enr41: string): Fix[] {
  const out: Fix[] = [];
  for (const c of eaipRows(enr41)) {
    const id = c[1] ?? '';
    if (!/^[A-Z]{2,3}$/.test(id)) continue;
    const pos = c.map(parseDms).find((p): p is LatLon => !!p);
    if (!pos) continue;
    const name = (c[0] ?? '').toUpperCase();
    const kind: Fix['kind'] = /VOR/.test(name) ? 'vor' : /NDB/.test(name) ? 'ndb' : /DME/.test(name) ? 'dme' : 'vor';
    out.push({ id, kind, pos });
  }
  return out;
}

const ROUTE_ID = /^[A-Z]{1,2}\d{1,4}[A-Z]?$/;

/**
 * ENR 3.x: routes as fix sequences. A row whose first cell is a designator
 * starts a route; point rows ("▲ ROBKA 141043N 1012508E", or a navaid
 * "BANGKOK DVOR/DME ( BKK )") follow in order. Points are returned too, so
 * route points missing from ENR 4.4 / 4.1 still exist in the pack.
 */
export function importEaipRoutes(...pages: string[]): { airways: Airway[]; points: Fix[] } {
  const routes = new Map<string, Airway>();
  const points = new Map<string, Fix>();
  for (const html of pages) {
    let current: Airway | null = null;
    let last: string | null = null;
    for (const c of eaipRows(html)) {
      const first = c[0] ?? '';
      if (ROUTE_ID.test(first) && c.length <= 3) {
        current = routes.get(first) ?? { id: first, segments: [] };
        routes.set(first, current);
        last = null;
        continue;
      }
      if (!current || c.length < 3) continue;
      const pos = parseDms(c[2] ?? '');
      if (!pos) continue;
      const name = c[1] ?? '';
      const navaid = /\(\s*([A-Z]{2,3})\s*\)/.exec(name);
      const id = navaid ? navaid[1]! : /^[A-Z]{5}\b/.exec(name)?.[0];
      if (!id) {
        last = null;
        continue;
      }
      if (!points.has(id)) {
        const kind: Fix['kind'] = navaid ? (/VOR/.test(name) ? 'vor' : /NDB/.test(name) ? 'ndb' : 'dme') : 'waypoint';
        points.set(id, { id, kind, pos });
      }
      if (last && last !== id) current.segments.push({ from: last, to: id });
      last = id;
    }
  }
  return { airways: [...routes.values()].filter((r) => r.segments.length > 0), points: [...points.values()] };
}
