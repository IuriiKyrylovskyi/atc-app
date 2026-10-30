/**
 * Transcript normaliser: what a speech-to-text engine (or a person typing
 * phraseology) writes → one lower-case word list the grammar can lex.
 *
 * - ICAO number words → digits, one token per digit ("niner" → "9", "tree" → "3",
 *   "fife" → "5"); numerals the engine already wrote stay as they are ("8,000" → "8000").
 * - Group words a speech engine may write → digits: "eleven ninety two" → "11 92",
 *   "two hundred fifty" → "250" (hundred + tens only: "five thousand five hundred"
 *   stays for the grammar).
 * - "FL340" → "flight level 340", "250kts" → "250 knots", "0.78" / ".78" → "point 78",
 *   "decimal" → "point".
 * - Runway designators "04R" → "04 right"; "centre" → "center".
 * - "I.L.S." / "i l s" → "ils"; NATO spelling variants ("alfa", "juliet", "x-ray") unified.
 * - Punctuation dropped (commas separate clearances only by meaning, not by syntax).
 */

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  tree: '3',
  four: '4',
  fower: '4',
  five: '5',
  fife: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  niner: '9',
};

const TEENS_AND_TENS: Readonly<Record<string, number>> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SPELLING: Readonly<Record<string, string>> = {
  alfa: 'alpha',
  juliet: 'juliett',
  xray: 'xray',
  'x-ray': 'xray',
  centre: 'center',
  decimal: 'point',
  kts: 'knots',
  kt: 'knots',
  knot: 'knots',
  ft: 'feet',
  foot: 'feet',
};

/** Runway side glued to the number ("04R", "4right") — and what speech engines make of it ("4Ride"). */
const SIDE: Readonly<Record<string, string>> = {
  l: 'left',
  r: 'right',
  c: 'center',
  left: 'left',
  right: 'right',
  center: 'center',
  centre: 'center',
  ride: 'right',
  rite: 'right',
  write: 'right',
};

export function normaliseTranscript(input: string): string[] {
  const text = input
    .toLowerCase()
    // Keep "x-ray" whole before hyphens become spaces.
    .replace(/\bx-ray\b/g, 'xray')
    // "I.L.S." → "ils"
    .replace(/\bi\.\s*l\.\s*s\.?/g, 'ils ')
    // Thousands separators: "8,000" → "8000".
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    // Mach numbers: "0.78" / ".78" → "point 78".
    .replace(/(^|[^\d])0?\.(\d{2})\b/g, '$1 point $2')
    // Glued units and levels.
    .replace(/\bfl\s?(\d{2,3})\b/g, 'flight level $1')
    .replace(/(\d)\s?(kts|kt|knots)\b/g, '$1 knots')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ');

  const out: string[] = [];
  // Indexes in `out` of numbers said as group words ("ninety two", "eleven").
  const grouped = new Set<number>();
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const word = SPELLING[raw] ?? raw;
    const runway = /^(\d{1,2})([a-z]+)$/.exec(word);
    const side = runway ? SIDE[runway[2]!] : undefined;
    const last = out.length - 1;
    if (runway && side) {
      out.push(runway[1]!, side);
    } else if (word === 'fl') {
      out.push('flight', 'level');
    } else if (word in TEENS_AND_TENS) {
      const value = TEENS_AND_TENS[word]!;
      // "two hundred fifty" → "250"
      if (out[last] === 'hundred' && /^[1-9]$/.test(out[last - 1] ?? '')) {
        out.splice(last - 1, 2, `${out[last - 1]}${String(value).padStart(2, '0')}`);
        grouped.add(out.length - 1);
      } else {
        out.push(String(value));
        grouped.add(out.length - 1);
      }
    } else if (
      word in NUMBER_WORDS &&
      word !== 'zero' &&
      grouped.has(last) &&
      out[last]!.endsWith('0') &&
      Number(out[last]) % 100 >= 20
    ) {
      // "ninety two" → "92", "two hundred fifty five" → "255"
      out[last] = String(Number(out[last]) + Number(NUMBER_WORDS[word]));
    } else {
      out.push(NUMBER_WORDS[word] ?? word);
    }
  }
  // Spelled "i l s" → "ils"; "cleared india lima sierra" → "cleared ils".
  for (let i = 0; i + 2 < out.length; i++) {
    if (out[i] === 'i' && out[i + 1] === 'l' && out[i + 2] === 's') out.splice(i, 3, 'ils');
    else if (out[i - 1] === 'cleared' && out[i] === 'india' && out[i + 1] === 'lima' && out[i + 2] === 'sierra') {
      out.splice(i, 3, 'ils');
    }
  }
  return out;
}
