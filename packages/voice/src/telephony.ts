/**
 * Radio callsigns: ICAO three-letter designator + flight number → what is said
 * on frequency ("DAL1192" → "Delta 1192" / "Delta one one niner two").
 *
 * The table holds the operators our scenarios and the US/EU packs meet first.
 * Free source for a full table: ICAO Doc 8585 designators are widely mirrored
 * (e.g. Wikipedia's airline codes list, CC BY-SA) — import it when live traffic
 * arrives (Phase 5).
 *
 * PAID-ALT: ICAO Doc 8585 data set (official designators + telephony).
 *   Why better: authoritative and complete, updated by ICAO.
 *   Price: sold by ICAO as a publication / data subscription — quote required.
 */

export const TELEPHONY: Readonly<Record<string, string>> = {
  AAL: 'American',
  ACA: 'Air Canada',
  AFR: 'Airfrance',
  ASA: 'Alaska',
  BAW: 'Speedbird',
  DAL: 'Delta',
  DLH: 'Lufthansa',
  EDV: 'Endeavor',
  EIN: 'Shamrock',
  ENY: 'Envoy',
  FDX: 'FedEx',
  FFT: 'Frontier Flight',
  JBU: 'JetBlue',
  JIA: 'Blue Streak',
  KLM: 'KLM',
  NKS: 'Spirit Wings',
  RPA: 'Brickyard',
  SKW: 'SkyWest',
  SWA: 'Southwest',
  UAE: 'Emirates',
  UAL: 'United',
  UPS: 'UPS',
  VIR: 'Virgin',
};

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'] as const;

const NATO: Readonly<Record<string, string>> = {
  A: 'alpha', B: 'bravo', C: 'charlie', D: 'delta', E: 'echo', F: 'foxtrot', G: 'golf', H: 'hotel',
  I: 'india', J: 'juliett', K: 'kilo', L: 'lima', M: 'mike', N: 'november', O: 'oscar', P: 'papa',
  Q: 'quebec', R: 'romeo', S: 'sierra', T: 'tango', U: 'uniform', V: 'victor', W: 'whiskey',
  X: 'x-ray', Y: 'yankee', Z: 'zulu',
};

/** Spells digits and letters one by one ("12A" → "one two alpha"). */
export function spell(chars: string): string {
  return [...chars.toUpperCase()]
    .map((c) => (c >= '0' && c <= '9' ? DIGITS[Number(c)] : NATO[c]))
    .filter((w): w is NonNullable<typeof w> => w !== undefined)
    .join(' ');
}

export interface RadioCallsign {
  /** For the log: "Delta 1192", or the registration as written ("N123AB"). */
  text: string;
  /** For TTS: "Delta one one niner two", "November one two three alpha bravo". */
  spoken: string;
}

export function radioCallsign(callsign: string): RadioCallsign {
  const cs = callsign.toUpperCase();
  const m = /^([A-Z]{3})(\d[0-9A-Z]*)$/.exec(cs);
  const name = m ? TELEPHONY[m[1]!] : undefined;
  if (m && name) return { text: `${name} ${m[2]}`, spoken: `${name} ${spell(m[2]!)}` };
  return { text: cs, spoken: spell(cs) };
}
