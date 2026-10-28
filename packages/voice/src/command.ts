/**
 * Keyboard command line → `Message`.
 *
 *   [CALLSIGN] ITEM [ITEM …]          e.g.  DAL1192 D080 H240 S220
 *
 * Callsign: the full callsign, any unique ending of it ("1192"), or nothing —
 * then the selected aircraft gets the command.
 *
 * | Item              | Meaning                                    |
 * |-------------------|--------------------------------------------|
 * | `FL190` `F190`    | climb / descend to flight level 190        |
 * | `A080` `A8000`    | altitude 8 000 ft (≤ 3 digits = hundreds)  |
 * | `C120` `D080`     | climb / descend (checked against current)  |
 * | `H240`            | fly heading 240                            |
 * | `L240` `R240`     | turn left / right heading 240              |
 * | `TL20` `TR20`     | turn left / right 20 degrees               |
 * | `S220` `M78`      | speed 220 kt / Mach .78                    |
 * | `DCT CAMRN`       | proceed direct CAMRN                       |
 * | `SQ4521`          | squawk 4521                                |
 * | `RON`             | resume own navigation                      |
 * | `ILS 04R`         | cleared ILS runway 04R (destination field) |
 * | `ILS KJFK 04R`    | … at another airport                       |
 *
 * An approach clearance combines with a vector and a level in one message:
 * `DAL1192 L220 A030 ILS 04R`.
 * Only the syntax and plain ranges are checked here; whether the aircraft can do
 * it (performance, ceiling) is the sim's call, answered by the pilot as "unable".
 * Spoken phraseology (Phase 2) produces the same `Message`.
 */
import type { AircraftState, Clearance, Message } from '@atc-app/sim';

export interface CommandContext {
  /** Callsigns on the scope. */
  callsigns: readonly string[];
  /** Aircraft that gets commands typed without a callsign. */
  selected?: string | null;
  /** Fix lookup for `DCT`; omitted = any fix accepted. */
  hasFix?: (id: string) => boolean;
  /** Current aircraft state, for climb / descend sanity checks and the destination. */
  aircraft?: (callsign: string) => AircraftState | undefined;
  /** Whether the runway has an ILS; omitted = any runway accepted. */
  hasIls?: (airport: string, runway: string) => boolean;
}

export type CommandResult =
  | { ok: true; message: Message }
  | { ok: false; error: string; callsign?: string };

type Group = 'vertical' | 'lateral' | 'speed' | 'squawk' | 'approach';

const GROUP: Record<Clearance['kind'], Group> = {
  altitude: 'vertical',
  heading: 'lateral',
  turn: 'lateral',
  direct: 'lateral',
  resume_own_navigation: 'lateral',
  speed: 'speed',
  squawk: 'squawk',
  approach: 'approach',
};

const MAX_ALT_FT = 60_000;

interface ItemParse {
  clearance: Clearance;
  /** Tokens consumed (DCT and SQ take the next one). */
  used: number;
  /** C / D items: the direction the controller asked for. */
  direction?: 'climb' | 'descend';
}

type ItemResult = ItemParse | { error: string } | null;

/** Runway designator: "4R" → "04R", "13" → "13". */
const RUNWAY = /^(\d{1,2})([LRC]?)$/;
const normaliseRunway = (t: string) => {
  const m = RUNWAY.exec(t)!;
  return `${m[1]!.padStart(2, '0')}${m[2]}`;
};

/** One item at tokens[i]; null if the token is not an item at all. */
function parseItem(tokens: readonly string[], i: number, ctx: CommandContext, callsign?: string): ItemResult {
  const t = tokens[i]!;
  let m: RegExpExecArray | null;

  if ((m = /^(?:FL|F)(\d{2,3})$/.exec(t))) return altitude(Number(m[1]) * 100);
  if ((m = /^A(\d{2,5})$/.exec(t))) return altitude(m[1]!.length <= 3 ? Number(m[1]) * 100 : Number(m[1]));
  if ((m = /^([CD])(\d{2,3})$/.exec(t))) {
    const r = altitude(Number(m[2]) * 100);
    return 'error' in r ? r : { ...r, direction: m[1] === 'C' ? 'climb' : 'descend' };
  }
  if ((m = /^([HLR])(\d{1,3})$/.exec(t))) {
    const hdg = Number(m[2]);
    if (hdg < 1 || hdg > 360) return { error: `Heading ${m[2]} is not 001–360` };
    const turn = m[1] === 'L' ? 'left' : m[1] === 'R' ? 'right' : undefined;
    return { clearance: { kind: 'heading', headingMag: hdg, ...(turn ? { turn } : {}) }, used: 1 };
  }
  if ((m = /^T([LR])(\d{1,3})$/.exec(t))) {
    const deg = Number(m[2]);
    if (deg < 1 || deg > 359) return { error: `Turn of ${m[2]}° is not 1–359` };
    return { clearance: { kind: 'turn', degrees: deg, direction: m[1] === 'L' ? 'left' : 'right' }, used: 1 };
  }
  if ((m = /^S(\d{2,3})$/.exec(t))) {
    const kt = Number(m[1]);
    if (kt < 60 || kt > 450) return { error: `Speed ${kt} kt is not 60–450` };
    return { clearance: { kind: 'speed', casKt: kt }, used: 1 };
  }
  if ((m = /^M\.?(\d{2})$/.exec(t))) {
    const mach = Number(m[1]) / 100;
    if (mach < 0.4 || mach > 0.95) return { error: `Mach .${m[1]} is not .40–.95` };
    return { clearance: { kind: 'speed', mach }, used: 1 };
  }
  if (t === 'DCT') {
    const fix = tokens[i + 1];
    if (!fix) return { error: 'DCT needs a fix' };
    if (ctx.hasFix && !ctx.hasFix(fix)) return { error: `Unknown fix ${fix}` };
    return { clearance: { kind: 'direct', fix }, used: 2 };
  }
  if ((m = /^SQ(\d*)$/.exec(t))) {
    const code = m[1] || tokens[i + 1] || '';
    if (!/^[0-7]{4}$/.test(code)) return { error: `Squawk ${code || '?'} is not four octal digits` };
    return { clearance: { kind: 'squawk', code }, used: m[1] ? 1 : 2 };
  }
  if (t === 'RON') return { clearance: { kind: 'resume_own_navigation' }, used: 1 };
  if (t === 'ILS') {
    const a = tokens[i + 1];
    const b = tokens[i + 2];
    let airport: string | undefined;
    let runway: string | undefined;
    let used = 2;
    if (a && /^[A-Z]{4}$/.test(a) && b && RUNWAY.test(b)) {
      airport = a;
      runway = normaliseRunway(b);
      used = 3;
    } else if (a && RUNWAY.test(a)) {
      airport = callsign ? ctx.aircraft?.(callsign)?.destination : undefined;
      runway = normaliseRunway(a);
      if (!airport) return { error: 'No destination known: use ILS <airport> <runway>' };
    } else {
      return { error: 'ILS needs a runway, e.g. ILS 04R' };
    }
    if (ctx.hasIls && !ctx.hasIls(airport, runway)) return { error: `No ILS for ${airport} runway ${runway}` };
    return { clearance: { kind: 'approach', type: 'ILS', airport, runway }, used };
  }
  return null;

  function altitude(ft: number): ItemParse | { error: string } {
    if (ft <= 0 || ft > MAX_ALT_FT) return { error: `Altitude ${ft} ft is out of range` };
    return { clearance: { kind: 'altitude', altFt: ft }, used: 1 };
  }
}

/** Resolves a typed callsign: exact match first, then a unique ending. */
export function matchCallsign(token: string, callsigns: readonly string[]): string | 'ambiguous' | null {
  const t = token.toUpperCase();
  const exact = callsigns.find((c) => c.toUpperCase() === t);
  if (exact) return exact;
  const ends = callsigns.filter((c) => c.toUpperCase().endsWith(t));
  if (ends.length === 1) return ends[0]!;
  return ends.length > 1 ? 'ambiguous' : null;
}

export function parseCommand(input: string, ctx: CommandContext): CommandResult {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: 'Empty command' };

  // ── Who ──────────────────────────────────────────────────────────────────
  let callsign: string | undefined;
  let i = 0;
  const first = tokens[0]!;
  // Exact callsign, then command item (uses the selection), then a callsign ending.
  const asItem = parseItem(tokens, 0, ctx);
  const match = matchCallsign(first, ctx.callsigns);
  const exact = match !== null && match !== 'ambiguous' && match.toUpperCase() === first;
  if (exact || (!asItem && match && match !== 'ambiguous')) {
    callsign = match as string;
    i = 1;
  } else if (asItem) {
    if (!ctx.selected) return { ok: false, error: 'No aircraft selected: start with a callsign' };
    callsign = ctx.selected;
  } else if (match === 'ambiguous') {
    return { ok: false, error: `${first} matches more than one aircraft` };
  } else {
    return { ok: false, error: `No aircraft ${first}` };
  }

  // ── What ─────────────────────────────────────────────────────────────────
  const clearances: Clearance[] = [];
  const used = new Set<Group>();
  const ac = ctx.aircraft?.(callsign);
  while (i < tokens.length) {
    const r = parseItem(tokens, i, ctx, callsign);
    if (!r) return { ok: false, error: `Unknown item ${tokens[i]}`, callsign };
    if ('error' in r) return { ok: false, error: r.error, callsign };
    const group = GROUP[r.clearance.kind];
    if (used.has(group)) return { ok: false, error: `Two ${group} instructions in one message`, callsign };
    used.add(group);
    if (r.direction && ac && r.clearance.kind === 'altitude') {
      const target = r.clearance.altFt;
      if (r.direction === 'climb' && target <= ac.altFt) {
        return { ok: false, error: `${callsign} is at ${Math.round(ac.altFt / 100)}: climb to ${target / 100}?`, callsign };
      }
      if (r.direction === 'descend' && target >= ac.altFt) {
        return { ok: false, error: `${callsign} is at ${Math.round(ac.altFt / 100)}: descend to ${target / 100}?`, callsign };
      }
    }
    clearances.push(r.clearance);
    i += r.used;
  }
  if (clearances.length === 0) return { ok: false, error: `What should ${callsign} do?`, callsign };

  return { ok: true, message: { to: callsign, clearances, text: input.trim() } };
}
