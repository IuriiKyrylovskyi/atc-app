/**
 * Transcript normaliser: what a speech-to-text engine (or a person typing
 * phraseology) writes → one lower-case word list the grammar can lex.
 *
 * - ICAO number words → digits, one token per digit ("niner" → "9", "tree" → "3",
 *   "fife" → "5"); numerals the engine already wrote stay as they are ("8,000" → "8000").
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

const SIDE: Readonly<Record<string, string>> = { l: 'left', r: 'right', c: 'center' };

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
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const word = SPELLING[raw] ?? raw;
    const runway = /^(\d{1,2})([lrc])$/.exec(word);
    if (runway) {
      out.push(runway[1]!, SIDE[runway[2]!]!);
    } else if (word === 'fl') {
      out.push('flight', 'level');
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
