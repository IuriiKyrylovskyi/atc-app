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
