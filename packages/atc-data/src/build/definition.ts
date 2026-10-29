/**
 * Pack definitions — `packs/<id>.pack.json`, one per playable area.
 *
 * A definition says which airports the area is built around and how far it
 * reaches; the builder turns it into a validated, AIRAC-versioned pack.
 */
import { z } from 'zod';
import { latLonSchema } from '../schema';

/**
 * One boundary step, as AIPs publish them:
 * - `"VTBD"` / `"BKK"` — an airport ARP or a fix / navaid of the pack;
 * - `{ "dms": "134342N 1003526E" }` — published coordinates;
 * - `{ "radial": "BKK", "deg": 35, "nm": 51.3 }` — VOR radial (magnetic) / DME;
 * - `{ "arc": { "centre": "VTBD", "radiusNm": 50, "dir": "cw" }, "to": <point> }` —
 *   along a circle from the previous point to `to`;
 * - `{ "along": "VTBB", "dir": "cw", "to": <point> }` — along a FIR border (AIP
 *   "then clockwise along Bangkok/Yangon FIR boundary to …"), from the previous
 *   point to `to`; the border comes from the pack's boundary source (VATSpy).
 */
const boundaryPointSchema = z.union([
  z.string(),
  latLonSchema,
  z.object({ dms: z.string() }).strict(),
  z.object({ radial: z.string(), deg: z.number().min(0).max(360), nm: z.number().min(0) }).strict(),
]);
export type BoundaryPoint = z.infer<typeof boundaryPointSchema>;

const boundaryStepSchema = z.union([
  boundaryPointSchema,
  z
    .object({
      arc: z.object({ centre: boundaryPointSchema, radiusNm: z.number().positive(), dir: z.enum(['cw', 'ccw']) }).strict(),
      to: boundaryPointSchema,
    })
    .strict(),
  z.object({ along: z.string(), dir: z.enum(['cw', 'ccw']), to: boundaryPointSchema }).strict(),
]);
export type BoundaryStep = z.infer<typeof boundaryStepSchema>;

/**
 * A control sector: lateral shape + vertical limits. Either a polygon (fix ids
 * or coordinates, in order), a wedge around a centre (airport or fix) between
 * two true bearings, clockwise, from an inner to an outer radius, or a
 * `boundary` transcribed from an AIP (points, radial/DME points and arcs).
 */
export const sectorDefinitionSchema = z
  .object({
    id: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, 'upper-case sector id, e.g. "KEN"'),
    name: z.string().min(1),
    floorFt: z.number().min(0),
    ceilingFt: z.number().positive(),
    polygon: z.array(z.union([z.string(), latLonSchema])).min(3).optional(),
    wedge: z
      .object({
        centre: z.string(),
        fromDeg: z.number().min(0).max(360),
        toDeg: z.number().min(0).max(360),
        innerNm: z.number().min(0).default(0),
        outerNm: z.number().positive(),
      })
      .strict()
      .optional(),
    boundary: z.array(boundaryStepSchema).min(3).optional(),
    /** Other sectors carved out of this one ("excluding ARR sector, DSB sector"). */
    exclude: z.array(z.string()).optional(),
    /** Further volumes of the same sector ("and an area bounded by …"). */
    parts: z
      .array(z.object({ boundary: z.array(boundaryStepSchema).min(3), floorFt: z.number().min(0), ceilingFt: z.number().positive() }).strict())
      .optional(),
  })
  .strict()
  .refine((s) => (s.polygon ? 1 : 0) + (s.wedge ? 1 : 0) + (s.boundary ? 1 : 0) === 1, 'give one of polygon, wedge, boundary')
  .refine((s) => s.floorFt < s.ceilingFt, 'floor must be below ceiling');

export type SectorDefinition = z.infer<typeof sectorDefinitionSchema>;

export const packDefinitionSchema = z
  .object({
    /** Pack id, also the file name: `packs/<id>.pack.json`. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lowercase id, e.g. "ny-tma"'),
    name: z.string().min(1),
    /**
     * Where the navigation data comes from: `cifp` (FAA, US) or `open` (OurAirports
     * airports / runways / navaids, plus a state eAIP when `eaip` is set).
     */
    source: z.enum(['cifp', 'open']).default('cifp'),
    /** eAIP state code (db/eaip-<state>/, `pnpm data:eaip <state>`); `open` packs only. */
    eaip: z.string().regex(/^[a-z]{2}$/).optional(),
    /** Airports whose runways and procedures are imported (ICAO). First one is the main airport. */
    airports: z.array(z.string().regex(/^[A-Z0-9]{3,4}$/)).min(1),
    /** Fixes, airways and extra airports within this distance are included. */
    radiusNm: z.number().positive().max(600),
    /** Projection centre; default: the main airport. */
    reference: latLonSchema.optional(),
    /** Also add non-instrument airports from OurAirports inside the area. */
    vfrAirports: z
      .object({
        radiusNm: z.number().positive().max(300),
        types: z
          .array(z.enum(['large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base']))
          .default(['large_airport', 'medium_airport']),
      })
      .strict()
      .optional(),
    /**
     * Control sectors. Real sector boundaries are mostly not published (FAA TRACON
     * sectors are internal); author them here, ideally from the ANSP's own data.
     */
    sectors: z.array(sectorDefinitionSchema).optional(),
    /** Where the sector definitions come from (shown as a pack source). */
    sectorsSource: z.string().optional(),
    /** Licence of the sector definitions source (default CC0-1.0 for our own synthetic ones). */
    sectorsLicence: z.string().optional(),
    /** URL of the sector definitions source. */
    sectorsUrl: z.string().optional(),
    /** Where FIR borders for `along` boundary steps come from (db/vatspy, pnpm data:vatspy). */
    boundaries: z.literal('vatspy').optional(),
  })
  .strict();

export type PackDefinition = z.infer<typeof packDefinitionSchema>;

export function parsePackDefinition(input: unknown): PackDefinition {
  return packDefinitionSchema.parse(input);
}
