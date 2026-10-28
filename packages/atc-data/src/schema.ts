/**
 * Runtime schema for airspace packs (zod, MIT).
 *
 * The TypeScript types live in @atc-app/sim (`AirspacePack` and friends); this
 * schema validates JSON coming from importers, storage or users at runtime and
 * exports a JSON Schema for tooling. The `_typeCheck` assertions below fail to
 * compile if the schema and the sim types drift apart.
 */
import { z } from 'zod';
import type { AirspacePack } from '@atc-app/sim';

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
export const latLonSchema = z.object({ lat, lon }).strict();

const course = z.number().min(0).lt(360);
const ident = z.string().min(1).max(32);

/**
 * Licences a pack may be published under. Anything else is rejected by the
 * validator — "licence-clean by construction" (ATC_ARCHITECTURE.md §2).
 */
export const PUBLISHABLE_LICENCES = [
  'Public-Domain',
  'CC0-1.0',
  'CC-BY-4.0',
  'ODbL-1.0',
  'Customer-Supplied',
] as const;

export const packSourceSchema = z
  .object({
    name: z.string().min(1),
    licence: z.string().min(1),
    url: z.string(),
    retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD'),
  })
  .strict();

export const packMetaSchema = z
  .object({
    id: ident,
    name: z.string().min(1),
    airac: z.string().regex(/^\d{4}$/, 'AIRAC id like 2611'),
    reference: latLonSchema,
    magVar: z.number().min(-180).max(180),
    sources: z.array(packSourceSchema).min(1),
  })
  .strict();

export const airportSchema = z
  .object({
    icao: ident,
    iata: z.string().optional(),
    name: z.string().min(1),
    arp: latLonSchema,
    elevationFt: z.number().min(-1500).max(30_000),
    magVar: z.number().min(-180).max(180).optional(),
    transitionAltFt: z.number().positive().optional(),
    transitionLevel: z.number().positive().optional(),
  })
  .strict();

export const runwaySchema = z
  .object({
    id: z.string().regex(/^(0[1-9]|[1-2]\d|3[0-6])[LCR]?$|^[A-Z0-9]{1,4}$/, 'runway designator'),
    airport: ident,
    threshold: latLonSchema,
    end: latLonSchema,
    headingTrue: course,
    lengthM: z.number().positive(),
    widthM: z.number().positive(),
    thresholdElevFt: z.number().min(-1500).max(30_000),
    displacedM: z.number().nonnegative().optional(),
    ils: z
      .object({
        courseTrue: course,
        glideslopeDeg: z.number().min(1).max(8),
        fafId: z.string().optional(),
        tchFt: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const fixSchema = z
  .object({
    id: ident,
    kind: z.enum(['waypoint', 'vor', 'ndb', 'dme', 'rnav']),
    pos: latLonSchema,
  })
  .strict();

const altitudeConstraintSchema = z
  .object({
    type: z.enum(['at', 'atOrAbove', 'atOrBelow', 'between']),
    ft: z.number(),
    ft2: z.number().optional(),
  })
  .strict();

export const legSchema = z
  .object({
    type: z.enum(['IF', 'TF', 'CF', 'DF', 'RF', 'VA', 'VM', 'VI', 'CA', 'FA', 'HM', 'HA', 'HF']),
    fix: z.string().optional(),
    courseTrue: course.optional(),
    centre: z.string().optional(),
    radiusNm: z.number().positive().optional(),
    altitude: altitudeConstraintSchema.optional(),
    speedKt: z.number().positive().optional(),
    flyOver: z.boolean().optional(),
  })
  .strict();

export const procedureSchema = z
  .object({
    id: ident,
    kind: z.enum(['SID', 'STAR', 'IAP']),
    airport: ident,
    runway: z.string().optional(),
    transition: z.string().optional(),
    legs: z.array(legSchema).min(1),
  })
  .strict();

export const airwaySchema = z
  .object({
    id: ident,
    segments: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string(),
            minAltFt: z.number().optional(),
            maxAltFt: z.number().optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const polygon = z.array(latLonSchema).min(3);

export const areaSchema = z
  .object({
    id: ident,
    kind: z.enum(['CTR', 'TMA', 'sector', 'restricted', 'danger', 'prohibited', 'TRA', 'TSA']),
    polygon,
    floorFt: z.number(),
    ceilingFt: z.number(),
  })
  .strict();

export const mvaSchema = z.object({ polygon, minAltFt: z.number() }).strict();

export const airspacePackSchema = z
  .object({
    meta: packMetaSchema,
    airports: z.array(airportSchema),
    runways: z.array(runwaySchema),
    fixes: z.array(fixSchema),
    airways: z.array(airwaySchema).optional(),
    procedures: z.array(procedureSchema).optional(),
    areas: z.array(areaSchema).optional(),
    mva: z.array(mvaSchema).optional(),
  })
  .strict();

/** JSON Schema (draft 2020-12) for editors, CI and other tools. */
export function airspacePackJsonSchema(): unknown {
  return z.toJSONSchema(airspacePackSchema);
}

// ── Compile-time sync with @atc-app/sim types ────────────────────────────────
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _typeCheck: Equals<z.infer<typeof airspacePackSchema>, AirspacePack> = true;
void _typeCheck;
