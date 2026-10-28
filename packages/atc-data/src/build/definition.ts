/**
 * Pack definitions — `packs/<id>.pack.json`, one per playable area.
 *
 * A definition says which airports the area is built around and how far it
 * reaches; the builder turns it into a validated, AIRAC-versioned pack.
 */
import { z } from 'zod';
import { latLonSchema } from '../schema';

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
  })
  .strict();

export type PackDefinition = z.infer<typeof packDefinitionSchema>;

export function parsePackDefinition(input: unknown): PackDefinition {
  return packDefinitionSchema.parse(input);
}
