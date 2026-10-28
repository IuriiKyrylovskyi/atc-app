import { describe, expect, it } from 'vitest';
import type { AircraftState, Message } from '@atc-app/sim';
import {
  altitudePhrase,
  instruction,
  matchCallsign,
  parseCommand,
  radioCallsign,
  readback,
  spell,
  unable,
  type CommandContext,
} from '../src';

const aircraft = (over: Partial<AircraftState> = {}): AircraftState => ({
  callsign: 'DAL1192', icaoType: 'B739', wake: 'M', squawk: '2101', origin: 'scenario',
  pos: { lat: 40, lon: -74 }, altFt: 16_000, headingTrue: 180, trackTrue: 180,
  casKt: 290, tasKt: 370, gsKt: 360, mach: 0.6, vsFpm: 0,
  target: { altFt: 16_000, headingTrue: 180, turn: null, casKt: 290, mach: null, vsFpm: null, directFix: null, route: [] },
  ...over,
});

const states: Record<string, AircraftState> = {
  DAL1192: aircraft(),
  UAL1771: aircraft({ callsign: 'UAL1771', altFt: 8000 }),
  AAL2412: aircraft({ callsign: 'AAL2412' }),
  N12ABC: aircraft({ callsign: 'N12ABC', altFt: 3000, casKt: 110 }),
};
const ctx: CommandContext = {
  callsigns: Object.keys(states),
  hasFix: (id) => ['CAMRN', 'KARRS'].includes(id),
  aircraft: (cs) => states[cs],
};
const clearances = (input: string, c: CommandContext = ctx) => {
  const r = parseCommand(input, c);
  if (!r.ok) throw new Error(r.error);
  return r.message.clearances;
};
const error = (input: string, c: CommandContext = ctx) => {
  const r = parseCommand(input, c);
  return r.ok ? null : r.error;
};

describe('command line', () => {
  it('parses every item kind', () => {
    expect(clearances('DAL1192 FL190')).toEqual([{ kind: 'altitude', altFt: 19_000 }]);
    expect(clearances('DAL1192 F190')).toEqual([{ kind: 'altitude', altFt: 19_000 }]);
    expect(clearances('DAL1192 A080')).toEqual([{ kind: 'altitude', altFt: 8000 }]);
    expect(clearances('DAL1192 A3500')).toEqual([{ kind: 'altitude', altFt: 3500 }]);
    expect(clearances('DAL1192 D080')).toEqual([{ kind: 'altitude', altFt: 8000 }]);
    expect(clearances('UAL1771 C120')).toEqual([{ kind: 'altitude', altFt: 12_000 }]);
    expect(clearances('DAL1192 H240')).toEqual([{ kind: 'heading', headingMag: 240 }]);
    expect(clearances('DAL1192 L90')).toEqual([{ kind: 'heading', headingMag: 90, turn: 'left' }]);
    expect(clearances('DAL1192 R360')).toEqual([{ kind: 'heading', headingMag: 360, turn: 'right' }]);
    expect(clearances('DAL1192 TL20')).toEqual([{ kind: 'turn', degrees: 20, direction: 'left' }]);
    expect(clearances('DAL1192 S220')).toEqual([{ kind: 'speed', casKt: 220 }]);
    expect(clearances('DAL1192 M78')).toEqual([{ kind: 'speed', mach: 0.78 }]);
    expect(clearances('DAL1192 M.82')).toEqual([{ kind: 'speed', mach: 0.82 }]);
    expect(clearances('DAL1192 DCT CAMRN')).toEqual([{ kind: 'direct', fix: 'CAMRN' }]);
    expect(clearances('DAL1192 SQ4521')).toEqual([{ kind: 'squawk', code: '4521' }]);
    expect(clearances('DAL1192 SQ 4521')).toEqual([{ kind: 'squawk', code: '4521' }]);
    expect(clearances('DAL1192 RON')).toEqual([{ kind: 'resume_own_navigation' }]);
  });

  it('takes several items, any case, and keeps the typed text', () => {
    const r = parseCommand('  dal1192 d080  h240 s250 ', ctx);
    expect(r).toEqual({
      ok: true,
      message: {
        to: 'DAL1192',
        clearances: [
          { kind: 'altitude', altFt: 8000 },
          { kind: 'heading', headingMag: 240 },
          { kind: 'speed', casKt: 250 },
        ],
        text: 'dal1192 d080  h240 s250',
      },
    });
  });

  it('finds the aircraft by a unique ending, or uses the selection', () => {
    expect(matchCallsign('1192', ctx.callsigns)).toBe('DAL1192');
    expect(matchCallsign('2', ctx.callsigns)).toBe('ambiguous');
    expect(parseCommand('1771 C120', ctx)).toMatchObject({ ok: true, message: { to: 'UAL1771' } });
    expect(parseCommand('H240 S220', { ...ctx, selected: 'AAL2412' })).toMatchObject({ ok: true, message: { to: 'AAL2412' } });
    expect(error('H240')).toBe('No aircraft selected: start with a callsign');
    expect(error('2 H240')).toBe('2 matches more than one aircraft');
    expect(error('SWA1 H240')).toBe('No aircraft SWA1');
  });

  it('an exact callsign beats an item, an item beats a callsign ending', () => {
    const c: CommandContext = { callsigns: ['H240', 'XRON'], selected: 'XRON' };
    expect(parseCommand('H240 S200', c)).toMatchObject({ ok: true, message: { to: 'H240' } });
    expect(parseCommand('RON', c)).toMatchObject({ ok: true, message: { to: 'XRON', clearances: [{ kind: 'resume_own_navigation' }] } });
  });

  it('explains what is wrong', () => {
    expect(error('DAL1192')).toBe('What should DAL1192 do?');
    expect(error('DAL1192 X12')).toBe('Unknown item X12');
    expect(error('DAL1192 H400')).toBe('Heading 400 is not 001–360');
    expect(error('DAL1192 S20')).toBe('Speed 20 kt is not 60–450');
    expect(error('DAL1192 M99')).toBe('Mach .99 is not .40–.95');
    expect(error('DAL1192 DCT')).toBe('DCT needs a fix');
    expect(error('DAL1192 DCT NOWHR')).toBe('Unknown fix NOWHR');
    expect(error('DAL1192 SQ7778')).toBe('Squawk 7778 is not four octal digits');
    expect(error('DAL1192 H240 DCT CAMRN')).toBe('Two lateral instructions in one message');
    expect(error('DAL1192 FL190 A080')).toBe('Two vertical instructions in one message');
  });

  it('checks climb / descend against the current level', () => {
    expect(error('DAL1192 C120')).toBe('DAL1192 is at 160: climb to 120?');
    expect(error('UAL1771 D120')).toBe('UAL1771 is at 80: descend to 120?');
    // Plain altitude items have no direction to check.
    expect(clearances('UAL1771 A120')).toEqual([{ kind: 'altitude', altFt: 12_000 }]);
  });
});

describe('phraseology', () => {
  it('says callsigns the radio way', () => {
    expect(radioCallsign('DAL1192')).toEqual({ text: 'Delta 1192', spoken: 'Delta one one niner two' });
    expect(radioCallsign('BAW117')).toEqual({ text: 'Speedbird 117', spoken: 'Speedbird one one seven' });
    expect(radioCallsign('N12ABC').spoken).toBe('november one two alpha bravo charlie');
    expect(radioCallsign('XYZ12').text).toBe('XYZ12');
    expect(spell('09')).toBe('zero niner');
  });

  it('says altitudes and flight levels (US transition altitude 18 000 ft)', () => {
    expect(altitudePhrase(19_000)).toEqual({ text: 'FL190', spoken: 'flight level one niner zero' });
    expect(altitudePhrase(18_000).text).toBe('FL180');
    expect(altitudePhrase(11_000)).toEqual({ text: '11000', spoken: 'one one thousand' });
    expect(altitudePhrase(3500).spoken).toBe('three thousand five hundred');
    expect(altitudePhrase(500).spoken).toBe('five hundred');
    expect(altitudePhrase(6000, { transitionAltitudeFt: 5000 }).text).toBe('FL060');
  });

  it('builds the instruction and the readback (callsign last)', () => {
    const msg: Message = {
      to: 'DAL1192',
      clearances: [
        { kind: 'altitude', altFt: 8000 },
        { kind: 'heading', headingMag: 40, turn: 'left' },
        { kind: 'speed', casKt: 250 },
      ],
    };
    expect(instruction(msg, states.DAL1192).text).toBe(
      'Delta 1192, descend and maintain 8000, turn left heading 040, reduce speed to 250'
    );
    const rb = readback(msg, states.DAL1192);
    expect(rb.text).toBe('Descend and maintain 8000, turn left heading 040, reduce speed to 250, Delta 1192');
    expect(rb.spoken).toBe(
      'descend and maintain eight thousand, turn left heading zero four zero, reduce speed to two five zero, Delta one one niner two'
    );
  });

  it('picks the verb from the aircraft state', () => {
    const say = (m: Message, ac?: AircraftState) => readback(m, ac).text;
    expect(say({ to: 'UAL1771', clearances: [{ kind: 'altitude', altFt: 19_000 }] }, states.UAL1771)).toBe(
      'Climb and maintain FL190, United 1771'
    );
    expect(say({ to: 'UAL1771', clearances: [{ kind: 'altitude', altFt: 8000 }] }, states.UAL1771)).toBe(
      'Maintain 8000, United 1771'
    );
    expect(say({ to: 'N12ABC', clearances: [{ kind: 'speed', casKt: 140 }] }, states.N12ABC)).toBe(
      'Increase speed to 140, N12ABC'
    );
    expect(say({ to: 'DAL1192', clearances: [{ kind: 'speed', mach: 0.78 }, { kind: 'squawk', code: '4521' }] })).toBe(
      'Maintain Mach .78, squawk 4521, Delta 1192'
    );
    expect(say({ to: 'DAL1192', clearances: [{ kind: 'turn', degrees: 20, direction: 'right' }] })).toBe(
      'Turn right 20 degrees, Delta 1192'
    );
    expect(say({ to: 'DAL1192', clearances: [{ kind: 'direct', fix: 'CAMRN' }] })).toBe('Proceed direct CAMRN, Delta 1192');
    expect(say({ to: 'DAL1192', clearances: [{ kind: 'resume_own_navigation' }] })).toBe(
      'Resume own navigation, Delta 1192'
    );
    expect(unable('DAL1192', 'speed outside performance').text).toBe('Unable, speed outside performance, Delta 1192');
  });
});
