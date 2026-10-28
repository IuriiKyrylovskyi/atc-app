/**
 * @atc-app/traffic — real, recorded and synthetic traffic.
 *
 * Phase 5 (see TODO.md). Free stack used by the first implementation:
 *
 * - Live positions: adsb.lol API (ODbL 1.0) — free, community-run, no SLA.
 * - 7-day global history: adsb.lol daily globe_history dumps (ODbL 1.0). Our derived
 *   flight DB must be published under ODbL with attribution
 *   "© adsb.lol contributors, ODbL"; the game itself is not affected.
 * - Flight plans: inferred from tracks (ADEP/ADES detection + map-matching to
 *   airways / SID / STAR of the pack).
 * - Weather: aviationweather.gov METAR/TAF (US Government, free).
 *
 * PAID-ALT: Flightradar24 traffic via the Navigraph sim-developer platform.
 *   Why better: licensed for flight-sim products, global coverage incl. MLAT,
 *   commercial support.
 *   Price: €0 for us if exposed to users with Navigraph Unlimited (≈ €10/month);
 *   developer terms via dev@navigraph.com.
 *
 * PAID-ALT: Flightradar24 API direct.
 *   Why better: one stable commercial feed with flight data enrichment.
 *   Price: Explorer $9 / Essential ≈ $90–99 / Advanced $900 per month; redistribution
 *   inside a product needs a separate licence.
 *
 * PAID-ALT: OpenSky Network licence.
 *   Why better: research-grade data quality and historical database.
 *   Price: commercial/operational use requires a written licence — quote only.
 *
 * PAID-ALT: FlightAware AeroAPI (filed routes, schedules).
 *   Why better: real filed flight plans instead of inferred routes.
 *   Price: Standard tier ≥ $100/month minimum, usage-based per result set.
 *
 * PAID-ALT: FAA SWIM SFDPS (US filed flight plans).
 *   Why better: authoritative US flight-plan feed.
 *   Price: access terms/fees to confirm with FAA; LADD block list must be honoured.
 */
export {};
