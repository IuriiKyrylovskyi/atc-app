import { describe, expect, it } from 'vitest';
import type { AircraftState, Clearance, Message } from '@atc-app/sim';
import {
  clearancePhrase,
  instruction,
  normaliseTranscript,
  parseTransmission,
  resolveCallsign,
  resolveFix,
  runwayPhrase,
  sayAgain,
  telephonyPrefix,
  type PhraseOptions,
  type TransmissionContext,
} from '../src';

const aircraft = (callsign: string, over: Partial<AircraftState> = {}): AircraftState => ({
  callsign, icaoType: 'B739', wake: 'M', squawk: '2101', origin: 'scenario',
  pos: { lat: 40, lon: -74 }, altFt: 16_000, headingTrue: 180, trackTrue: 180,
  casKt: 290, tasKt: 370, gsKt: 360, mach: 0.6, vsFpm: 0, destination: 'KJFK',
  target: { altFt: 16_000, headingTrue: 180, turn: null, casKt: 290, mach: null, vsFpm: null, directFix: null, route: [] },
  ...over,
});

const CALLSIGNS = ['DAL1192', 'UAL1771', 'AAL2412', 'N12ABC', 'ACA875', 'FFT12', 'BAW117', 'KLM643', 'RYR8QK', 'AUI101'];
const states: Record<string, AircraftState> = Object.fromEntries(CALLSIGNS.map((c) => [c, aircraft(c)]));
const FIXES = ['CAMRN', 'KARRS', 'KEN', 'PAWLN', 'PARCH', 'LENDY'];
const ctx: TransmissionContext = {
  callsigns: CALLSIGNS,
  fixes: FIXES,
  hasFix: (id) => FIXES.includes(id),
  aircraft: (cs) => states[cs],
  hasIls: (airport, runway) => airport === 'KJFK' && ['04R', '13L', '22L'].includes(runway),
};

const parse = (input: string, c: TransmissionContext = ctx): Message => {
  const r = parseTransmission(input, c);
  if (!r.ok) throw new Error(`${input}: ${r.error}`);
  return r.message;
};
const failure = (input: string, c: TransmissionContext = ctx) => {
  const r = parseTransmission(input, c);
  if (r.ok) throw new Error(`${input}: parsed as ${JSON.stringify(r.message.clearances)}`);
  return r;
};

describe('transcript normaliser', () => {
  it.each([
    ['Delta one one niner two', 'delta 1 1 9 2'],
    ['tree fife fower', '3 5 4'],
    ['descend and maintain 8,000', 'descend and maintain 8000'],
    ['climb FL340', 'climb flight level 340'],
    ['climb FL 3 4 0', 'climb flight level 3 4 0'],
    ['maintain Mach .78', 'maintain mach point 78'],
    ['maintain Mach 0.82', 'maintain mach point 82'],
    ['Mach decimal seven eight', 'mach point 7 8'],
    ['reduce to 210kts', 'reduce to 210 knots'],
    ['cleared I.L.S. runway 04R', 'cleared ils runway 04 right'],
    ['cleared i l s runway 13L', 'cleared ils runway 13 left'],
    ['cleared india lima sierra approach', 'cleared ils approach'],
    ['runway 22C', 'runway 22 center'],
    ['centre', 'center'],
    ['x-ray alfa juliet', 'xray alpha juliett'],
    ['three thousand ft', '3 thousand feet'],
  ])('%s', (input, words) => {
    expect(normaliseTranscript(input).join(' ')).toBe(words);
  });
});

describe('callsigns', () => {
  it('reads telephony names, multi-word names and alphanumeric flight numbers', () => {
    expect(telephonyPrefix(['air', 'canada', '8'])).toEqual({ designators: ['ACA'], words: 2 });
    expect(resolveCallsign(['delta', '1', '1', '9', '2'], CALLSIGNS)).toBe('DAL1192');
    expect(resolveCallsign(['delta', '1192'], CALLSIGNS)).toBe('DAL1192');
    expect(resolveCallsign(['air', 'canada', '875'], CALLSIGNS)).toBe('ACA875');
    expect(resolveCallsign(['frontier', 'flight', '1', '2'], CALLSIGNS)).toBe('FFT12');
    expect(resolveCallsign(['speedbird', '117'], CALLSIGNS)).toBe('BAW117');
    expect(resolveCallsign(['ryanair', '8', 'quebec', 'kilo'], CALLSIGNS)).toBe('RYR8QK');
    expect(resolveCallsign(['ukraine', 'international', '1', '0', '1'], CALLSIGNS)).toBe('AUI101');
  });

  it('reads spelled callsigns and the written code', () => {
    expect(resolveCallsign(['delta', 'alpha', 'lima', '1192'], CALLSIGNS)).toBe('DAL1192');
    expect(resolveCallsign(['kilo', 'lima', 'mike', '643'], CALLSIGNS)).toBe('KLM643');
    expect(resolveCallsign(['dal1192'], CALLSIGNS)).toBe('DAL1192');
    expect(resolveCallsign(['november', '1', '2', 'alpha', 'bravo', 'charlie'], CALLSIGNS)).toBe('N12ABC');
  });

  it('accepts the ICAO registration abbreviation only after first contact', () => {
    expect(resolveCallsign(['november', 'bravo', 'charlie'], CALLSIGNS)).toBe('N12ABC');
    expect(resolveCallsign(['november', 'bravo', 'charlie'], CALLSIGNS, () => false)).toBeNull();
    // Airline flight numbers are never abbreviated.
    expect(resolveCallsign(['delta', '9', '2'], CALLSIGNS)).toBeNull();
  });

  it('accepts a unique ending of the digits, refuses an ambiguous one', () => {
    expect(resolveCallsign(['1', '7', '7', '1'], CALLSIGNS)).toBe('UAL1771');
    expect(resolveCallsign(['2412'], ['AAL2412', 'UAL2412'])).toBe('ambiguous');
    expect(resolveCallsign(['hello'], CALLSIGNS)).toBeNull();
  });
});

describe('fixes', () => {
  it('matches by name, NATO spelling, letters and sound', () => {
    expect(resolveFix(['camrn'], ctx)).toBe('CAMRN');
    expect(resolveFix(['camren'], ctx)).toBe('CAMRN');
    expect(resolveFix(['pawlin'], ctx)).toBe('PAWLN');
    expect(resolveFix(['kilo', 'echo', 'november'], ctx)).toBe('KEN');
    expect(resolveFix(['c', 'a', 'm', 'r', 'n'], ctx)).toBe('CAMRN');
    expect(resolveFix(['lendee'], ctx)).toBe('LENDY');
    expect(resolveFix(['cars'], ctx)).toBe('CARS');
  });
});

// ─── Hand-written corpus: speech-engine spellings, variants, ICAO wording ─────

const alt = (altFt: number): Clearance => ({ kind: 'altitude', altFt });
const hdg = (headingMag: number, turn?: 'left' | 'right'): Clearance => ({ kind: 'heading', headingMag, ...(turn ? { turn } : {}) });
const kt = (casKt: number): Clearance => ({ kind: 'speed', casKt });
const ils = (runway: string): Clearance => ({ kind: 'approach', type: 'ILS', airport: 'KJFK', runway });

const HAND: [string, string, Clearance[]][] = [
  ['Delta 1192, descend and maintain 8,000', 'DAL1192', [alt(8000)]],
  ['Delta one one niner two descend and maintain eight thousand', 'DAL1192', [alt(8000)]],
  ['DAL1192 fly heading 090', 'DAL1192', [hdg(90)]],
  ['delta alpha lima one one niner two descend to flight level one two zero', 'DAL1192', [alt(12_000)]],
  ['1192 turn right heading 3 6 0', 'DAL1192', [hdg(360, 'right')]],
  ['Delta 1192 turn left by 30 degrees', 'DAL1192', [{ kind: 'turn', degrees: 30, direction: 'left' }]],
  ['Delta 1192 turn right 15 degrees', 'DAL1192', [{ kind: 'turn', degrees: 15, direction: 'right' }]],
  ['Delta 1192 reduce to 180', 'DAL1192', [kt(180)]],
  ['Delta 1192 speed 200', 'DAL1192', [kt(200)]],
  ['Delta 1192 speed two zero zero knots', 'DAL1192', [kt(200)]],
  ['Delta 1192 increase speed to mach point 8 2', 'DAL1192', [{ kind: 'speed', mach: 0.82 }]],
  ['Delta 1192 mach point 8', 'DAL1192', [{ kind: 'speed', mach: 0.8 }]],
  ['Delta 1192 maintain two five zero knots', 'DAL1192', [kt(250)]],
  ['Delta 1192 descend and maintain four thousand five hundred', 'DAL1192', [alt(4500)]],
  ['Delta 1192 descend to two thousand feet', 'DAL1192', [alt(2000)]],
  ['Delta 1192 descend maintain 3000', 'DAL1192', [alt(3000)]],
  ['Delta 1192 descend two thousand', 'DAL1192', [alt(2000)]],
  ['Delta 1192 maintain five hundred feet', 'DAL1192', [alt(500)]],
  ['Delta 1192 climb and maintain one niner thousand', 'DAL1192', [alt(19_000)]],
  ['Delta 1192 climb FL 2 4 0', 'DAL1192', [alt(24_000)]],
  ['Delta 1192 cleared I.L.S. runway 4 right approach', 'DAL1192', [ils('04R')]],
  ['Delta 1192 cleared india lima sierra approach runway zero four right', 'DAL1192', [ils('04R')]],
  ['Delta 1192 cleared ILS runway 13 left', 'DAL1192', [ils('13L')]],
  ['Delta 1192 cleared ILS approach runway 22L', 'DAL1192', [ils('22L')]],
  ['Delta 1192 squawk seven seven zero zero', 'DAL1192', [{ kind: 'squawk', code: '7700' }]],
  ['Delta 1192 squawk 0 1 2 3', 'DAL1192', [{ kind: 'squawk', code: '0123' }]],
  ['Delta 1192 direct C A M R N', 'DAL1192', [{ kind: 'direct', fix: 'CAMRN' }]],
  ['Delta 1192 direct charlie alpha mike romeo november', 'DAL1192', [{ kind: 'direct', fix: 'CAMRN' }]],
  ['Delta 1192 proceed direct to camren', 'DAL1192', [{ kind: 'direct', fix: 'CAMRN' }]],
  ['Delta 1192 direct karrs', 'DAL1192', [{ kind: 'direct', fix: 'KARRS' }]],
  ['Delta 1192 resume own navigation', 'DAL1192', [{ kind: 'resume_own_navigation' }]],
  ['Air Canada 875 climb FL 2 4 0', 'ACA875', [alt(24_000)]],
  ['Speedbird 117 descend and maintain flight level 1 2 0, reduce speed to 2 5 0 knots, proceed direct camrn', 'BAW117', [alt(12_000), kt(250), { kind: 'direct', fix: 'CAMRN' }]],
  ['Ryanair eight quebec kilo resume own navigation', 'RYR8QK', [{ kind: 'resume_own_navigation' }]],
  ['Frontier Flight 12 turn left heading 270 and descend to 5000 feet', 'FFT12', [hdg(270, 'left'), alt(5000)]],
  ['november bravo charlie maintain 3000', 'N12ABC', [alt(3000)]],
  ['November one two alpha bravo charlie squawk 1 2 0 0', 'N12ABC', [{ kind: 'squawk', code: '1200' }]],
  ['Ukraine International 101 descend to FL 100 and reduce speed to 250 knots', 'AUI101', [alt(10_000), kt(250)]],
  ['Delta 1192 turn left heading 220, descend and maintain 3000, cleared ILS runway 4R approach', 'DAL1192', [hdg(220, 'left'), alt(3000), ils('04R')]],
];

describe('hand corpus', () => {
  it.each(HAND)('%s', (input, to, expected) => {
    const m = parse(input);
    expect(m.to).toBe(to);
    expect(m.clearances).toEqual(expected);
    expect(m.text).toBe(input);
  });

  it('uses the selected aircraft when no callsign is said', () => {
    expect(parse('descend and maintain 8000', { ...ctx, selected: 'UAL1771' }).to).toBe('UAL1771');
    expect(failure('descend and maintain 8000').error).toBe('No callsign');
  });
});

describe('say again', () => {
  it.each([
    ['Delta 1192 contact New York one two zero', 'DAL1192'],
    ['Delta 1192', 'DAL1192'],
    ['Delta 1192 descend and maintain 80', 'DAL1192'],
    ['Delta 1192 squawk 8 0 0 0', 'DAL1192'],
    ['Delta 1192 fly heading 400', 'DAL1192'],
    ['Delta 1192 climb FL200 and descend 8000', 'DAL1192'],
    ['Delta 1192 climb and maintain 8000', 'DAL1192'],
    ['Delta 1192 direct cars', 'DAL1192'],
    ['Delta 1192 cleared ILS runway 31', 'DAL1192'],
    ['Delta 1192 reduce speed to 3 thousand', 'DAL1192'],
    ['Delta 1192 turn left', 'DAL1192'],
  ])('%s', (input, callsign) => {
    const r = failure(input);
    expect(r.sayAgain).toBe(true);
    expect(r.callsign).toBe(callsign);
  });

  it.each(['delta eleven ninety two descend 8000', 'hello world', 'United 9999 descend 8000'])('nobody answers: %s', (input) => {
    expect(failure(input).callsign).toBeUndefined();
  });

  it('refuses an ambiguous callsign', () => {
    expect(failure('2412 descend 8000', { ...ctx, callsigns: ['AAL2412', 'UAL2412'] }).error).toMatch(/more than one/);
  });

  it('pilot phrase', () => {
    expect(sayAgain('DAL1192')).toEqual({ text: 'Say again, Delta 1192', spoken: 'say again, Delta one one niner two' });
  });
});

// ─── Generated corpus: every instruction the app says must parse back ────────

const SETS: Clearance[][] = [
  [alt(19_000)],
  [alt(8000)],
  [alt(16_000)],
  [alt(3500)],
  [hdg(240)],
  [hdg(90, 'left')],
  [hdg(360, 'right')],
  [hdg(5)],
  [{ kind: 'turn', degrees: 20, direction: 'left' }],
  [kt(210)],
  [kt(320)],
  [kt(290)],
  [{ kind: 'speed', mach: 0.78 }],
  [{ kind: 'direct', fix: 'CAMRN' }],
  [{ kind: 'squawk', code: '4521' }],
  [{ kind: 'resume_own_navigation' }],
  [ils('04R')],
  [alt(8000), hdg(220, 'left')],
  [alt(11_000), kt(250), { kind: 'direct', fix: 'KARRS' }],
  [hdg(180, 'right'), alt(3000), ils('13L')],
];

const STYLES: [string, PhraseOptions][] = [
  ['FAA', {}],
  ['ICAO TA 6000', { style: 'icao', transitionAltitudeFt: 6000 }],
];

const GENERATED = CALLSIGNS.flatMap((cs) =>
  STYLES.flatMap(([style, opts]) =>
    SETS.flatMap((clearances) => {
      const said = instruction({ to: cs, clearances }, states[cs], opts);
      return [
        { style, form: 'text', input: said.text, to: cs, clearances },
        { style, form: 'spoken', input: said.spoken, to: cs, clearances },
      ];
    }),
  ),
);

describe('generated corpus (instruction → parse)', () => {
  it('has at least 500 phrases', () => {
    expect(GENERATED.length + HAND.length).toBeGreaterThanOrEqual(500);
  });

  it.each(GENERATED)('$style $form: $input', ({ input, to, clearances }) => {
    const m = parse(input);
    expect(m.to).toBe(to);
    expect(m.clearances).toEqual(clearances);
  });
});

describe('ICAO wording', () => {
  const ac = aircraft('DAL1192');
  const icao: PhraseOptions = { style: 'icao' };
  it('uses "to" for level changes, feet below the transition altitude, knots on every speed', () => {
    expect(clearancePhrase(alt(8000), ac, icao).text).toBe('descend to 8000 feet');
    expect(clearancePhrase(alt(19_000), ac, icao).text).toBe('climb to FL190');
    expect(clearancePhrase(kt(210), ac, icao).text).toBe('reduce speed to 210 knots');
    expect(clearancePhrase({ kind: 'speed', mach: 0.78 }, ac, icao).spoken).toBe('maintain Mach decimal seven eight');
  });
  it('keeps the leading zero of a runway and puts "approach" before it', () => {
    expect(runwayPhrase('04R', icao).spoken).toBe('zero four right');
    expect(runwayPhrase('04R').spoken).toBe('four right');
    expect(clearancePhrase(ils('04R'), ac, icao).text).toBe('cleared ILS approach runway 04R');
  });
});
