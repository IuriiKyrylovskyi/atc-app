import type { ScenarioScript } from '../script';

/**
 * Conflict drill over Colts Neck VOR (COL), 26 NM south-west of JFK.
 *
 * - Head-on at 12 000 ft: SWA2214 KORRY → COL and NKS318 JFK → COL meet over COL
 *   after ~5 min unless one is turned or given another level.
 * - Crossing at 11 000 ft: FFT1427 from the north (TYNIE) and ASA8 from the west
 *   (METRO) reach COL together ~8 min in.
 * - Control pair 1 000 ft apart (SKW5520 at 14 000, ENY3810 at 15 000): separated,
 *   must never alert.
 *
 * Calm wind keeps the timing exact.
 */
export const NY_CONFLICTS: ScenarioScript = {
  id: 'ny-conflicts',
  name: 'Conflict drill over COL',
  packId: 'ny-tma',
  seed: 2,
  arrivals: [],
  flights: [
    { atS: 0, callsign: 'SWA2214', icaoType: 'B738', fromFix: 'KORRY', route: ['COL', 'JFK'], altFt: 12_000, casKt: 250 },
    { atS: 0, callsign: 'NKS318', icaoType: 'A20N', fromFix: 'JFK', route: ['COL', 'KORRY'], altFt: 12_000, casKt: 250 },
    { atS: 60, callsign: 'SKW5520', icaoType: 'CRJ7', fromFix: 'SBJ', route: ['COL'], altFt: 14_000, casKt: 250 },
    { atS: 60, callsign: 'ENY3810', icaoType: 'E145', fromFix: 'MUFIE', route: ['COL'], altFt: 15_000, casKt: 250 },
    { atS: 180, callsign: 'FFT1427', icaoType: 'A321', fromFix: 'TYNIE', route: ['COL'], altFt: 11_000, casKt: 250 },
    { atS: 203, callsign: 'ASA8', icaoType: 'B739', fromFix: 'METRO', route: ['COL'], altFt: 11_000, casKt: 250 },
  ],
};
