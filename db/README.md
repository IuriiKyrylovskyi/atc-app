# db/ — source data

Raw navigation / traffic data the importers read. Large downloads stay out of git
(see `.gitignore`); fetch them with the scripts below. Only this README and small
derived artefacts belong in the repository.

| Folder | Source | Licence | Update | Fetch |
|---|---|---|---|---|
| `faa-cifp/` | FAA Coded Instrument Flight Procedures (ARINC 424, file `FAACIFP18`) — US airports, runways, ILS, fixes, navaids, airways, SIDs/STARs/approaches, controlled (Class B / C / D) and restrictive airspace | US Government work, public domain | every AIRAC cycle (28 days) | `pnpm data:cifp` (current cycle) · `pnpm data:cifp --next` |
| `ourairports/` | OurAirports `airports.csv`, `runways.csv`, `navaids.csv` — airports worldwide, runway ends, VOR/DME/NDB; used for non-IFR airports, to cross-check CIFP runway thresholds, and as the navaid source for areas without AIP data (Kyiv) | Public domain | nightly upstream | `pnpm data:ourairports` |
| `vatspy/` | VATSpy data project `Boundaries.geojson` — FIR / UIR borders worldwide, for AIP sector edges that run "along the FIR boundary" (Bangkok `VTBB`); `SOURCE` holds the upstream commit | CC BY-SA 4.0 (credit; packs using it share-alike) | on upstream changes | `pnpm data:vatspy` |
| `erc/` | EUROCONTROL ERC GeoPDF extracts (`erc06h.json`, `erc06l.json`): page paths and texts of the ATFM sector / designated point / navaid / ATS route layers plus the georeference, read from `charts/erc*.pdf` — points, routes and ATFM sectors for the Kyiv pack | © EUROCONTROL: development only | 2× a year (new ERC edition) | `pnpm data:erc` (all `charts/erc*.pdf`) · `pnpm data:erc charts/<file>.pdf` |
| `eaip-th/<edition>/` | Thailand eAIP ENR 2.1, 3.1, 3.3, 4.1, 4.4 (EUROCONTROL eAIP HTML) — points, navaids, routes for the Bangkok pack | State copyright: development only | every AIRAC cycle | `pnpm data:eaip th` (latest effective) · `--edition YYYY-MM-DD` |

The FAA publishes each cycle about three weeks before it becomes effective at
`https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_<YYMMDD>.zip` (YYMMDD = effective date).
CIFP is "not for navigation" outside certified avionics — fine for a simulator;
see `FAA CIFP Disclaimer.pdf` inside the zip.
