/**
 * @atc-app/atc-data — airspace packs.
 *
 * Phase 1 (see TODO.md). Free sources used by the first implementation:
 *
 * - FAA CIFP (ARINC 424): procedures, fixes, airways, runways — US public domain.
 *   https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
 * - FAA NASR 28-day subscription: airspace, navaids, frequencies — US public domain.
 * - FAA d-TPP: approach/SID/STAR chart PDFs — US public domain.
 * - OurAirports: airports + runway thresholds worldwide — public domain.
 *
 * PAID-ALT: Navigraph navigation data + charts (worldwide, AIRAC-current).
 *   Why better: global coverage, professionally maintained, charts included.
 *   Price: €0 for us; each user needs their own Navigraph subscription
 *   (≈ €10/month or ≈ $95/year). Navigraph licenses the end user, not the
 *   developer; charts are allowed only in "virtual environment" apps — confirm
 *   eligibility with dev@navigraph.com before integrating.
 *
 * PAID-ALT: Jeppesen / Lufthansa Systems (Lido) navigation data.
 *   Why better: commercial-grade worldwide data with redistribution rights.
 *   Price: enterprise licence, quote only.
 *
 * PAID-ALT: Eurocontrol EAD B2B (European AIP data in AIXM 5.1).
 *   Why better: all European states in one machine-readable feed.
 *   Price: paid B2B service, quote only. (EAD Basic is free but non-commercial.)
 *
 * PAID-ALT: AIS of Ukraine (UkSATSE) eAIP + ARINC 424 database.
 *   Why better: official Ukrainian data in ARINC 424 (reuses the CIFP importer).
 *   Price: $1,200/year access (non-resident, AIC A 03/25); use in a product needs
 *   a written agreement — pubs@uksatse.aero.
 */
export * from './schema';
export * from './validate';
export * from './csv';
export * from './importers/ourairports';
export * from './importers/cifp';
export * from './build/definition';
export * from './build/build-pack';
export * from './build/diff';
export * from './importers/eaip';
