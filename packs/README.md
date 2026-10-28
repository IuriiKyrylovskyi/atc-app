# packs/ — playable areas

Each `<id>.pack.json` defines one area (ATC sector / TMA). `pnpm pack:build <id>`
turns it into a validated airspace pack from the free sources in `db/`:

```bash
pnpm data:cifp          # FAA CIFP for the current AIRAC cycle
pnpm data:ourairports   # OurAirports airports + runways
pnpm pack:build ny-tma  # or --all
```

Output (gitignored): `packs/dist/<id>@<airac>.json`, `packs/dist/manifest.json`
(size, sha256, counts, sources, cross-check summary) and, when an older AIRAC build
exists, `packs/dist/<id>@<airac>.diff.json`.

## Definition fields

| Field | Meaning |
|---|---|
| `id` | Lowercase pack id, also the file name |
| `name` | Display name |
| `airports` | ICAO codes whose runways and procedures are imported; the first is the main airport (projection centre, charted magnetic variation) |
| `radiusNm` | Fixes, navaids and airways within this distance are included |
| `reference` | Optional `{ lat, lon }` projection centre instead of the main airport |
| `vfrAirports` | Optional `{ radiusNm, types }`: also add non-instrument airports from OurAirports |

A pack is not written when validation fails (bad geometry, unknown references,
non-publishable licence). The build also reports how far CIFP runway thresholds
are from OurAirports' — a second, independent source.
