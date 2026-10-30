/**
 * Clearance ↔ phraseology text.
 *
 * Two styles: FAA (JO 7110.65: "descend and maintain 8000", "runway four right",
 * "Mach point seven eight") for US packs and ICAO (Doc 4444: "descend to 8000 feet",
 * "runway zero four right", "Mach decimal seven eight", speeds with "knots") for
 * the rest. The parser (transmission.ts) accepts both.
 *
 * Every phrase comes in two forms: `text` for the communication log and
 * `spoken` (numbers as words, ICAO digit-by-digit style) for text-to-speech.
 */
import type { AircraftState, Clearance, Message } from '@atc-app/sim';
import { radioCallsign, spell } from './telephony';

export interface Phrase {
  text: string;
  spoken: string;
}

export type PhraseStyle = 'faa' | 'icao';

export interface PhraseOptions {
  /** Altitudes at or above are flight levels. US: 18 000 ft everywhere. */
  transitionAltitudeFt?: number;
  /** Default 'faa'. */
  style?: PhraseStyle;
}

const US_TRANSITION_ALTITUDE_FT = 18_000;

const pad3 = (n: number) => String(Math.round(n)).padStart(3, '0');

const SIDE: Readonly<Record<string, string>> = { L: 'left', R: 'right', C: 'center' };

/** "04R" / "four right" (FAA: no leading zero) or "zero four right" (ICAO); digits one by one. */
export function runwayPhrase(runway: string, opts: PhraseOptions = {}): Phrase {
  const m = /^(\d{1,2})([LRC]?)$/.exec(runway);
  if (!m) return { text: runway, spoken: runway };
  const digits = opts.style === 'icao' ? m[1]!.padStart(2, '0') : String(Number(m[1]));
  return { text: runway, spoken: [spell(digits), SIDE[m[2]!]].filter(Boolean).join(' ') };
}

/** "FL190" / "flight level one niner zero"; "8000" / "eight thousand". */
export function altitudePhrase(ft: number, opts: PhraseOptions = {}): Phrase {
  const ta = opts.transitionAltitudeFt ?? US_TRANSITION_ALTITUDE_FT;
  if (ft >= ta) {
    const fl = pad3(ft / 100);
    return { text: `FL${fl}`, spoken: `flight level ${spell(fl)}` };
  }
  const thousands = Math.floor(ft / 1000);
  const hundreds = Math.round((ft % 1000) / 100);
  const words = [
    thousands > 0 ? `${spell(String(thousands))} thousand` : '',
    hundreds > 0 ? `${spell(String(hundreds))} hundred` : '',
  ].filter(Boolean);
  const unit = opts.style === 'icao' ? ' feet' : '';
  return { text: `${Math.round(ft)}${unit}`, spoken: `${words.join(' ') || 'zero'}${unit}` };
}

/** One clearance as the controller says it (no callsign). */
export function clearancePhrase(c: Clearance, ac?: AircraftState, opts: PhraseOptions = {}): Phrase {
  const icao = opts.style === 'icao';
  switch (c.kind) {
    case 'altitude': {
      const alt = altitudePhrase(c.altFt, opts);
      const change = !ac || Math.abs(c.altFt - ac.altFt) < 100 ? null : c.altFt > ac.altFt ? 'climb' : 'descend';
      const verb = !change ? 'maintain' : icao ? `${change} to` : `${change} and maintain`;
      return { text: `${verb} ${alt.text}`, spoken: `${verb} ${alt.spoken}` };
    }
    case 'heading': {
      const hdg = pad3(c.headingMag);
      const verb = c.turn ? `turn ${c.turn} heading` : 'fly heading';
      return { text: `${verb} ${hdg}`, spoken: `${verb} ${spell(hdg)}` };
    }
    case 'turn':
      return {
        text: `turn ${c.direction} ${c.degrees} degrees`,
        spoken: `turn ${c.direction} ${spell(String(c.degrees))} degrees`,
      };
    case 'speed': {
      if (c.mach !== undefined) {
        const digits = c.mach.toFixed(2).slice(2);
        return { text: `maintain Mach .${digits}`, spoken: `maintain Mach ${icao ? 'decimal' : 'point'} ${spell(digits)}` };
      }
      const kt = Math.round(c.casKt ?? 0);
      const verb = !ac || Math.abs(kt - ac.casKt) < 5 ? 'maintain' : kt < ac.casKt ? 'reduce speed to' : 'increase speed to';
      const unit = verb === 'maintain' || icao ? ' knots' : '';
      return { text: `${verb} ${kt}${unit}`, spoken: `${verb} ${spell(String(kt))}${unit}` };
    }
    case 'direct':
      return { text: `proceed direct ${c.fix}`, spoken: `proceed direct ${c.fix}` };
    case 'squawk':
      return { text: `squawk ${c.code}`, spoken: `squawk ${spell(c.code)}` };
    case 'resume_own_navigation':
      return { text: 'resume own navigation', spoken: 'resume own navigation' };
    case 'approach': {
      const rwy = runwayPhrase(c.runway, opts);
      if (icao) return { text: `cleared ${c.type} approach runway ${rwy.text}`, spoken: `cleared I L S approach runway ${rwy.spoken}` };
      return { text: `cleared ${c.type} runway ${rwy.text} approach`, spoken: `cleared I L S runway ${rwy.spoken} approach` };
    }
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function join(phrases: Phrase[]): Phrase {
  return { text: phrases.map((p) => p.text).join(', '), spoken: phrases.map((p) => p.spoken).join(', ') };
}

/** What the controller transmits: callsign first. */
export function instruction(message: Message, ac?: AircraftState, opts: PhraseOptions = {}): Phrase {
  const cs = radioCallsign(message.to);
  const body = join(message.clearances.map((c) => clearancePhrase(c, ac, opts)));
  return { text: `${cs.text}, ${body.text}`, spoken: `${cs.spoken}, ${body.spoken}` };
}

/** The pilot's readback: the clearances, callsign last. */
export function readback(message: Message, ac?: AircraftState, opts: PhraseOptions = {}): Phrase {
  const cs = radioCallsign(message.to);
  const body = join(message.clearances.map((c) => clearancePhrase(c, ac, opts)));
  return { text: `${capitalise(body.text)}, ${cs.text}`, spoken: `${body.spoken}, ${cs.spoken}` };
}

/** The pilot cannot comply. `reason` comes from the sim's rejection. */
export function unable(callsign: string, reason: string): Phrase {
  const cs = radioCallsign(callsign);
  return { text: `Unable, ${reason}, ${cs.text}`, spoken: `unable, ${reason}, ${cs.spoken}` };
}

/** The pilot did not understand the transmission. */
export function sayAgain(callsign: string): Phrase {
  const cs = radioCallsign(callsign);
  return { text: `Say again, ${cs.text}`, spoken: `say again, ${cs.spoken}` };
}
