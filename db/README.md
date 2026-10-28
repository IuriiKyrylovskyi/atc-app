# db/ — source data

Raw navigation / traffic data the importers read. Large downloads stay out of git
(see `.gitignore`); fetch them with the scripts below. Only this README and small
derived artefacts belong in the repository.

| Folder | Source | Licence | Update | Fetch |
|---|---|---|---|---|
| `faa-cifp/` | FAA Coded Instrument Flight Procedures (ARINC 424, file `FAACIFP18`) — US airports, runways, ILS, fixes, navaids, airways, SIDs/STARs/approaches | US Government work, public domain | every AIRAC cycle (28 days) | `pnpm data:cifp` (current cycle) · `pnpm data:cifp --next` |
| `ourairports/` | OurAirports `airports.csv`, `runways.csv` — airports worldwide, runway ends; used for non-IFR airports and to cross-check CIFP runway thresholds | Public domain | nightly upstream | `pnpm data:ourairports` |

The FAA publishes each cycle about three weeks before it becomes effective at
`https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_<YYMMDD>.zip` (YYMMDD = effective date).
CIFP is "not for navigation" outside certified avionics — fine for a simulator;
see `FAA CIFP Disclaimer.pdf` inside the zip.
