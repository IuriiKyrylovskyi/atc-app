/**
 * Radio callsigns: ICAO three-letter designator + flight number → what is said
 * on frequency ("DAL1192" → "Delta 1192" / "Delta one one niner two").
 *
 * The table holds the operators our scenarios and the US / European / Asian packs
 * meet first (a starter set, not the full Doc 8585 list).
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
  AAY: 'Allegiant',
  ACA: 'Air Canada',
  AFR: 'Airfrance',
  AIC: 'Air India',
  AMX: 'Aeromexico',
  ANA: 'All Nippon',
  ASA: 'Alaska',
  AUA: 'Austrian',
  AUI: 'Ukraine International',
  BAW: 'Speedbird',
  BKP: 'Bangkok Air',
  CCA: 'Air China',
  CES: 'China Eastern',
  CPA: 'Cathay',
  CSN: 'China Southern',
  DAL: 'Delta',
  DLH: 'Lufthansa',
  EDV: 'Endeavor',
  EIN: 'Shamrock',
  ELY: 'El Al',
  ENY: 'Envoy',
  ETD: 'Etihad',
  ETH: 'Ethiopian',
  EZY: 'Easy',
  FDX: 'FedEx',
  FFT: 'Frontier Flight',
  FIN: 'Finnair',
  HAL: 'Hawaiian',
  HVN: 'Vietnam Airlines',
  IBE: 'Iberia',
  JAL: 'Japan Air',
  JBU: 'JetBlue',
  JIA: 'Blue Streak',
  KAL: 'Korean Air',
  KLM: 'KLM',
  MAS: 'Malaysian',
  NKS: 'Spirit Wings',
  QFA: 'Qantas',
  QTR: 'Qatari',
  RPA: 'Brickyard',
  RYR: 'Ryanair',
  SAS: 'Scandinavian',
  SIA: 'Singapore',
  SKW: 'SkyWest',
  SWA: 'Southwest',
  SWR: 'Swiss',
  TAP: 'Air Portugal',
  THA: 'Thai',
  THY: 'Turkish',
  UAE: 'Emirates',
  UAL: 'United',
  UPS: 'UPS',
  VIR: 'Virgin',
  WJA: 'Westjet',
  WZZ: 'Wizz Air',
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

/** Telephony name in lower case ("air canada") → designators. */
const BY_NAME = new Map<string, string[]>();
for (const [designator, name] of Object.entries(TELEPHONY)) {
  const key = name.toLowerCase();
  BY_NAME.set(key, [...(BY_NAME.get(key) ?? []), designator]);
}
const MAX_NAME_WORDS = Math.max(...[...BY_NAME.keys()].map((k) => k.split(' ').length));

/**
 * Longest telephony name at the start of `words` (lower case):
 * ["air", "canada", "8", "7"] → { designators: ["ACA"], words: 2 }.
 */
export function telephonyPrefix(words: readonly string[]): { designators: string[]; words: number } | null {
  for (let n = Math.min(MAX_NAME_WORDS, words.length); n > 0; n--) {
    const designators = BY_NAME.get(words.slice(0, n).join(' '));
    if (designators) return { designators, words: n };
  }
  return null;
}

/** NATO word → letter ("xray" and "x-ray" both → "X"). */
export function natoLetter(word: string): string | undefined {
  const w = word.toLowerCase().replace('-', '');
  for (const [letter, name] of Object.entries(NATO)) if (name.replace('-', '') === w) return letter;
  return undefined;
}
