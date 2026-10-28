/**
 * Pack definitions — `packs/<id>.pack.json`, one per playable area.
 *
 * A definition says which airports the area is built around and how far it
 * reaches; the builder turns it into a validated, AIRAC-versioned pack.
 */
import { z } from 'zod';
import { latLonSchema } from '../schema';

/**
 * A control sector: lateral shape + vertical limits. Either a polygon (fix ids
 * or coordinates, in order) or a wedge around a centre (airport or fix) between
 * two true bearings, clockwise, from an inner to an outer radius.
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
  })
  .strict()
  .refine((s) => (s.polygon ? 1 : 0) + (s.wedge ? 1 : 0) === 1, 'give either polygon or wedge')
  .refine((s) => s.floorFt < s.ceilingFt, 'floor must be below ceiling');

export type SectorDefinition = z.infer<typeof sectorDefinitionSchema>;

export const packDefinitionSchema = z
  .object({
    /** Pack id, also the file name: `packs/<id>.pack.json`. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lowercase id, e.g. "ny-tma"'),
    name: z.string().min(1),
    /** Airports whose runways and procedures are imported (ICAO). First one is the main airport. */
    airports: z.array(z.string().regex(/^[A-Z0-9]{3,4}$/)).min(1),
    /** Fixes, airways and extra airports within this distance are included. */
    radiusNm: z.number().positive().max(300),
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
  })
  .strict();

export type PackDefinition = z.infer<typeof packDefinitionSchema>;

export function parsePackDefinition(input: unknown): PackDefinition {
  return packDefinitionSchema.parse(input);
}
