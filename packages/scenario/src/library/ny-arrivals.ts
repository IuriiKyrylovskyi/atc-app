import type { ScenarioScript } from '../script';

/**
 * New York TMA arrival push: seven arrivals on the real STARs into JFK, LaGuardia
 * and Newark, spread over three minutes. Every aircraft is descending to the
 * altitude it would be handed off at and flies its STAR until vectored. No
 * conflicts are built in yet: this is the first traffic-on-scope scenario.
 */
export const NY_ARRIVALS: ScenarioScript = {
  id: 'ny-arrivals',
  name: 'NY arrivals: JFK, LGA, EWR',
  packId: 'ny-tma',
  seed: 1,
  wind: { fromDeg: 310, speedKt: 20 },
  arrivals: [
    { atS: 0, callsign: 'DAL1192', icaoType: 'B739', airport: 'KJFK', star: 'CAMRN5', fromFix: 'HOGGS', altFt: 16_000, casKt: 290, clearedAltFt: 11_000 },
    { atS: 0, callsign: 'UAL1771', icaoType: 'B38M', airport: 'KEWR', star: 'PHLBO4', fromFix: 'STEFE', altFt: 19_000, casKt: 300, clearedAltFt: 13_000 },
    { atS: 30, callsign: 'AAL2412', icaoType: 'A321', airport: 'KJFK', star: 'PAWLN1', fromFix: 'PAWLN', altFt: 15_000, casKt: 280, clearedAltFt: 12_000 },
    { atS: 60, callsign: 'JBU615', icaoType: 'A320', airport: 'KJFK', star: 'PARCH4', runway: '04B', fromFix: 'PARCH', altFt: 18_000, casKt: 300, clearedAltFt: 12_000 },
    { atS: 90, callsign: 'RPA4520', icaoType: 'E75L', airport: 'KLGA', star: 'MIP4', fromFix: 'LIZZI', altFt: 14_000, casKt: 280, clearedAltFt: 10_000 },
    { atS: 120, callsign: 'BAW117', icaoType: 'B77W', wake: 'H', airport: 'KJFK', star: 'PUCKY1', transition: 'YODAA', fromFix: 'YODAA', altFt: 17_000, casKt: 290, clearedAltFt: 12_000 },
    { atS: 180, callsign: 'EDV5301', icaoType: 'CRJ9', airport: 'KEWR', star: 'FLOSI4', transition: 'HNK', fromFix: 'HELON', altFt: 13_000, casKt: 270, clearedAltFt: 11_000 },
  ],
};
