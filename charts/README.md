# charts/

Reference charts downloaded by hand. **Not committed** (copyrighted, large) —
only this README is tracked. Use them for development and data validation; do
not ship them, or anything traced from them, without the owner's permission.

## EUROCONTROL Cartography

Source: https://www.eurocontrol.int/service/cartography (free download, "for
information purposes only"). Every chart carries: "© EUROCONTROL … no part may
be reproduced or used except as authorized by written permission of
EUROCONTROL". Product use of any geometry needs that written permission.

| File | What | Format |
|---|---|---|
| `erc06h-11jun2026.pdf` | ERC-06 Central Europe – Ukraine, **upper** airspace, edition 11 Jun 2026 | GeoPDF, 1300 × 1000 mm, layers |
| `erc06l-11jun2026.pdf` | ERC-06 Central Europe – Ukraine, **lower** airspace, edition 11 Jun 2026 | GeoPDF, 1300 × 1000 mm, layers |
| `eurocontrol-erc-charts-legend-2023-v2.pdf` | ERC legend: symbology, ATFM high/low split per state (Ukraine FL275) | PDF (georeferenced inset) |
| `eurocontrol-erc-charts-layout-update-2020.pdf` | ERC sheet layout (ERC-01 … ERC-13) | GeoPDF |
| `eurocontrol-firuir-upper-airspace-europe-2026.pdf` | FIR/UIR overview, upper airspace, 2026 | PDF (not georeferenced) |
| `eurocontrol-firuir-lower-airspace-europe-2026.pdf` | FIR/UIR overview, lower airspace, 2026 | PDF (not georeferenced) |

### What the ERC GeoPDFs contain

- Georeferencing: ISO 32000 geospatial viewport (`/VP` → `/Measure` `/GEO`) with
  ground control points and the projection WKT `EC_Lambert_Conformal_Conic`
  (WGS-84, standard parallels N42° / N57°). ERC-06 covers about 38–55°N,
  14.5–43.4°E (all of Ukraine).
- Separate optional-content layers (ArcGIS export), among them: `ATFM Sector`,
  `ATFM Sector Annotation` (sector names + FL bands), `FIR/UIR`, `ATS Route`,
  `Designated Point`, `Navaid System`, `Aerodrome`, `AMC-Manageable SUA`,
  `non AMC-Manageable SUA`, `Free Route Airspace`, `Country Border`.
- ATFM sectors come from the Network Manager environment data and are drawn
  as zones of constant vertical sectorisation; EUROCONTROL notes they "may not
  be as precise as the sector descriptions used by ATC".

So the sector polygons (and FIR / route geometry) can be extracted layer by
layer and converted to lat/lon through the viewport transform — useful to
validate an AIP-based importer or for a local prototype, not for distribution.

`pnpm data:erc` does that for every `charts/erc*.pdf` (pdf.js) and writes
`db/erc/<sheet>.json`; packs with an `erc` section (Kyiv) build points, routes
and ATFM sectors from it and are devOnly. Positions come from the drawing:
navaid symbols land 0.02–0.25 NM from their published positions.

## Ukraine

`UKKT_AIP.pdf` — Ukrainian AIP AD 2 for UKKT Kyiv/Antonov-1 (23 pages: ARP
502844N 0302303E, runway, obstacles, …). UkSATSE material, all rights
reserved — reference only.

## FAA IFR Enroute charts (North America)

Source: https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/ifr/
— US Government work, **public domain**: free to display, georeference and
trace.

Downloaded: `enr_l01.zip`, `enr_l02/` (L-02: California / Oregon), `enr_h01/` (H-01
GeoTIFF), `dehus1/` (H-01, H-02 PDFs), `dehus9/` (**H-09** ≈ 28–38°N, south-east US;
**H-10** ≈ 34–44.7°N, **covers New York**). The H PDFs are ArcGIS GeoPDFs with
layers (ATSRoute, DesignatedPoint, NavaidSystem, HoldingPattern, AirspaceLine
incl. ARTCC / SUA / FIR, Service = comm outlets).

| Series | Charts | Files (edition folder `MM-DD-YYYY`) |
|---|---|---|
| IFR Enroute Low, conterminous US | L-01 … L-36 | GeoTIFF `enr_l01.zip` … `enr_l36.zip`; PDF `delus1.zip` … (two charts per PDF zip) |
| IFR Enroute High, conterminous US | H-01 … H-12 | GeoTIFF `enr_h01.zip` …; PDF `dehus1.zip` … |
| Alaska low / high | AK L-01…L-04, AK H-01…H-02 | `enr_akl01.zip` … / `delak1.zip` …, `enr_akh01.zip` / `dehak1.zip` |
| Area charts (US terminal areas) | A-1, A-2 | `enr_a01.zip`, `enr_a02.zip` / `darea.zip` |
| Hawaii / Pacific | P-1, P-2 | `enr_p01.zip` … / `dephi1.zip` |
| Oceanic route charts | NARC, PORC, WATRS | `narc_tif.zip` / `narc_pdf.zip`, `porc_*`, `watrs_*` |
| Caribbean low / high | CL-1, CL-3, CL-5, CH-1 … | `DELCB1_tif.zip` / `delcb1.zip` … |
| Full 56-day set | all of the above | `DDECUS.zip` |

Base URL: `https://aeronav.faa.gov/enroute/<MM-DD-YYYY>/`. 56-day cycle (current
edition 03 Sep 2026, next 29 Oct 2026); the next edition is published 19 days
before it becomes effective. The VIS 26-02 charting notice ends some FAA
products from May 2026 — check it before depending on a series.

For the NY TMA pick the sheets from the coverage indexes on the FAA page
(Enroute Low index includes Area chart coverage); the pack itself already
comes from CIFP / NASR data, so these are for visual validation.
