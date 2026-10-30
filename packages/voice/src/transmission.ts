/**
 * Spoken transmission → `Message`.
 *
 *   "Delta one one niner two, descend and maintain eight thousand, turn left heading two two zero"
 *
 * 1. normalise.ts turns the transcript into words and digits.
 * 2. The callsign is every word before the first keyword, matched against the
 *    aircraft on frequency: telephony name + flight number ("Delta 1192"), spelled
 *    ("delta alpha lima 1192", "november 1 2 alpha bravo charlie"), the ICAO
 *    abbreviation of a registration after first contact ("november bravo charlie"),
 *    or a unique ending of the digits.
 * 3. grammar.ts parses the instructions; fixes are matched by name, by NATO
 *    spelling, or by sound ("camren" → CAMRN).
 * 4. The items become a command line and go through `parseCommand`, so spoken and
 *    typed instructions share one validation.
 *
 * Anything that fails is a "say again" — addressed to the aircraft when the
 * callsign was understood.
 */
import type { Message } from '@atc-app/sim';
import { parseCommand, type CommandContext } from './command';
import { callsignLength, lexWords, parseItems, type SpokenItem, type SpokenNumber } from './grammar';
import { normaliseTranscript } from './normalise';
import { TELEPHONY, natoLetter, telephonyPrefix } from './telephony';

export interface TransmissionContext extends CommandContext {
  /** All fix identifiers, for matching names the speech engine spelled its own way. */
  fixes?: readonly string[];
  /** Abbreviated callsigns are only valid after first contact; omitted = always allowed. */
  contacted?: (callsign: string) => boolean;
}

export type TransmissionResult =
  | { ok: true; message: Message }
  | { ok: false; error: string; sayAgain: true; callsign?: string };

const fail = (error: string, callsign?: string): TransmissionResult => ({
  ok: false,
  error,
  sayAgain: true,
  ...(callsign ? { callsign } : {}),
});

// ─── Callsigns ───────────────────────────────────────────────────────────────

/** Words as callsign characters: digits, NATO letters, single letters, "dal1192"; null if a word is none of these. */
function chars(words: readonly string[]): string | null {
  let s = '';
  for (const w of words) {
    if (/^\d+$/.test(w)) s += w;
    else if (natoLetter(w)) s += natoLetter(w);
    else if (/^[a-z]$/.test(w) || (/\d/.test(w) && /^[a-z0-9]+$/.test(w))) s += w.toUpperCase();
    else return null;
  }
  return s || null;
}

/** "DAL1192" style: three-letter operator + flight number; everything else is a registration. */
const isFlightNumber = (cs: string) => /^[A-Z]{3}\d/.test(cs);

/** Resolves callsign words against the aircraft on frequency. */
export function resolveCallsign(
  words: readonly string[],
  callsigns: readonly string[],
  contacted?: (callsign: string) => boolean,
): string | 'ambiguous' | null {
  const byUpper = new Map(callsigns.map((c) => [c.toUpperCase(), c]));
  const found = new Set<string>();

  const named = telephonyPrefix(words);
  if (named) {
    const rest = chars(words.slice(named.words));
    if (rest) for (const d of named.designators) if (byUpper.has(d + rest)) found.add(byUpper.get(d + rest)!);
  }
  const spelled = chars(words);
  if (spelled && byUpper.has(spelled)) found.add(byUpper.get(spelled)!);
  if (found.size) return found.size === 1 ? [...found][0]! : 'ambiguous';

  if (!spelled) return misheardOperator(words, callsigns);
  // ICAO abbreviation of a registration: first character + at least the last two.
  if (spelled.length >= 3) {
    const abbr = callsigns.filter((c) => {
      const u = c.toUpperCase();
      return !isFlightNumber(u) && u[0] === spelled[0] && u.endsWith(spelled.slice(1)) && contacted?.(c) !== false;
    });
    if (abbr.length) return abbr.length === 1 ? abbr[0]! : 'ambiguous';
  }
  // A unique ending of the digits, as on the command line ("one one niner two").
  if (/^\d+$/.test(spelled)) {
    const ends = callsigns.filter((c) => c.toUpperCase().endsWith(spelled));
    if (ends.length) return ends.length === 1 ? ends[0]! : 'ambiguous';
  }
  return null;
}

/**
 * A misheard operator name before a clear flight number (speech engines: "Dell
 * to 1192" for "Delta 1192"): the aircraft with that number whose telephony
 * name sounds like the words heard (consonant skeletons one edit apart).
 */
function misheardOperator(words: readonly string[], callsigns: readonly string[]): string | 'ambiguous' | null {
  // The name is 1–3 words without digits, the flight number all the rest.
  for (let i = 1; i <= Math.min(3, words.length - 1); i++) {
    if (words.slice(0, i).some((w) => /\d/.test(w))) return null;
    const number = chars(words.slice(i));
    if (!number || !/^\d/.test(number)) continue;
    const heard = skeleton(words.slice(0, i).join('').toUpperCase());
    const near = callsigns.filter((c) => {
      const u = c.toUpperCase();
      const name = TELEPHONY[u.slice(0, 3)];
      return (
        isFlightNumber(u) &&
        u.slice(3) === number &&
        name !== undefined &&
        editDistance(skeleton(name.replace(/[^a-z]/gi, '').toUpperCase()), heard) <= 1
      );
    });
    return near.length === 0 ? null : near.length === 1 ? near[0]! : 'ambiguous';
  }
  return null;
}

// ─── Fixes ───────────────────────────────────────────────────────────────────

/** First letter + consonants, doubles collapsed: CAMRN and "camren" → CMRN. */
const skeleton = (s: string) => (s[0]! + s.slice(1).replace(/[AEIOUY]/g, '')).replace(/(.)\1+/g, '$1');

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** Fix words → identifier: NATO spelling ("kilo echo november" → KEN), else the word(s), matched by sound. */
export function resolveFix(words: readonly string[], ctx: TransmissionContext): string {
  const spelled = words.every((w) => natoLetter(w) || /^[a-z]$/.test(w)) ? chars(words) : null;
  const ident = spelled ?? words.join('').toUpperCase();
  if (!ctx.fixes || ctx.hasFix?.(ident) || ctx.fixes.includes(ident)) return ident;
  const sk = skeleton(ident);
  const bySound = ctx.fixes.filter((f) => skeleton(f) === sk);
  if (bySound.length === 1) return bySound[0]!;
  const close = ctx.fixes.filter((f) => f[0] === ident[0] && Math.abs(f.length - ident.length) <= 1 && editDistance(f, ident) <= 1);
  return close.length === 1 ? close[0]! : ident;
}

// ─── Items → command line ────────────────────────────────────────────────────

const pad3 = (s: string | number) => String(s).padStart(3, '0');

/** Feet from a spoken number; null if it is not an altitude. */
function feet(n: SpokenNumber): number | null {
  if (n.unit === 'knots') return null;
  const v = Number(n.digits);
  if (n.thousand) return v * 1000 + (n.thousand.hundreds ? Number(n.thousand.hundreds) * 100 : 0);
  if (n.hundred) return v * 100;
  return v >= 100 || n.unit === 'feet' ? v : null;
}

type Converted = { ok: true; command: string } | { ok: false; error: string };

function toCommand(item: SpokenItem, ctx: TransmissionContext): Converted {
  const ok = (command: string): Converted => ({ ok: true, command });
  switch (item.kind) {
    case 'altitude': {
      const ft = item.flightLevel !== undefined ? Number(item.flightLevel) * 100 : item.value ? feet(item.value) : null;
      if (ft === null) return { ok: false, error: 'Say the level: flight level … or … thousand' };
      if (item.direction) {
        if (ft % 100) return { ok: false, error: `${ft} ft is not in hundreds` };
        return ok(`${item.direction === 'climb' ? 'C' : 'D'}${pad3(ft / 100)}`);
      }
      return ok(item.flightLevel !== undefined ? `FL${pad3(item.flightLevel)}` : `A${String(ft).padStart(4, '0')}`);
    }
    case 'heading': {
      if (item.digits.length > 3) return { ok: false, error: `Heading ${item.digits}?` };
      return ok(`${item.turn === 'left' ? 'L' : item.turn === 'right' ? 'R' : 'H'}${item.digits}`);
    }
    case 'turn':
      return ok(`T${item.direction === 'left' ? 'L' : 'R'}${item.digits}`);
    case 'speed': {
      if (item.mach !== undefined) {
        if (item.mach.length > 2) return { ok: false, error: `Mach .${item.mach}?` };
        return ok(`M${item.mach.padEnd(2, '0')}`);
      }
      const n = item.knots!;
      if (n.unit === 'feet' || n.thousand || n.hundred) return { ok: false, error: 'Say the speed in knots' };
      return ok(`S${n.digits}`);
    }
    case 'direct':
      return ok(`DCT ${resolveFix(item.fix, ctx)}`);
    case 'squawk':
      return ok(`SQ${item.digits}`);
    case 'resume_own_navigation':
      return ok('RON');
    case 'approach':
      if (item.runway.length > 2) return { ok: false, error: `Runway ${item.runway}?` };
      return ok(`ILS ${item.runway.padStart(2, '0')}${item.side ?? ''}`);
  }
}

// ─── Transmission ────────────────────────────────────────────────────────────

const KEYWORD_NAMES = new Set(['Climb', 'Descend', 'Maintain', 'Heading', 'Turn', 'Speed', 'Reduce', 'Increase', 'Mach', 'Direct', 'Squawk', 'Resume', 'Cleared', 'Flight']);

/** Command line or phraseology? Phraseology has instruction words ("descend", "heading", …). */
export function looksSpoken(input: string): boolean {
  return lexWords(normaliseTranscript(input)).some((t) => KEYWORD_NAMES.has(t.tokenType.name));
}

export type InterpretResult =
  | { ok: true; message: Message; spoken: boolean }
  | { ok: false; error: string; spoken: boolean; callsign?: string };

/** The scope's input box: command-line syntax first, then phraseology. */
export function interpret(input: string, ctx: TransmissionContext): InterpretResult {
  const typed = parseCommand(input, ctx);
  if (typed.ok) return { ok: true, message: typed.message, spoken: false };
  const said = parseTransmission(input, ctx);
  if (said.ok) return { ok: true, message: said.message, spoken: true };
  const r = looksSpoken(input) ? { ...said, spoken: true } : { ...typed, spoken: false };
  return { ok: false, error: r.error, spoken: r.spoken, ...(r.callsign ? { callsign: r.callsign } : {}) };
}

export function parseTransmission(input: string, ctx: TransmissionContext): TransmissionResult {
  const tokens = lexWords(normaliseTranscript(input));
  if (tokens.length === 0) return fail('Nothing said');

  // ── Who: the longest leading run of callsign words that matches an aircraft ──
  const words = tokens.map((t) => t.image);
  const lead = callsignLength(tokens);
  let callsign: string | undefined;
  let start = 0;
  for (let n = lead; n > 0 && !callsign; n--) {
    const r = resolveCallsign(words.slice(0, n), ctx.callsigns, ctx.contacted);
    if (r === 'ambiguous') return fail(`${words.slice(0, n).join(' ')} matches more than one aircraft`);
    if (r) {
      callsign = r;
      start = n;
    }
  }
  if (!callsign) {
    if (lead > 0) return fail(`No aircraft ${words.slice(0, lead).join(' ')}`);
    if (!ctx.selected) return fail('No callsign');
    callsign = ctx.selected;
  }

  // ── What ─────────────────────────────────────────────────────────────────
  const parsed = parseItems(tokens.slice(start));
  if (!parsed.ok) return fail(parsed.error, callsign);
  const commands: string[] = [];
  for (const item of parsed.items) {
    const c = toCommand(item, ctx);
    if (!c.ok) return fail(c.error, callsign);
    commands.push(c.command);
  }
  const r = parseCommand(`${callsign} ${commands.join(' ')}`, ctx);
  if (!r.ok) return fail(r.error, callsign);
  return { ok: true, message: { ...r.message, text: input.trim() } };
}
