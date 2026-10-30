/**
 * Pilot voices: every callsign keeps one voice for the whole session — same
 * gender, accent, pitch and pace on every transmission — derived from a hash of
 * the callsign, so it is stable without storing anything.
 *
 * Accent follows the operator (British carriers speak British English); Kokoro
 * offers American and British English voices, system voices whatever the OS has.
 */

export type Accent = 'us' | 'gb';
export type Gender = 'male' | 'female';

export interface PilotVoice {
  callsign: string;
  gender: Gender;
  accent: Accent;
  /** BCP 47 language tag for system voices. */
  lang: 'en-US' | 'en-GB';
  /** Web Speech pitch, 0.85–1.15. */
  pitch: number;
  /** Web Speech rate, 1.05–1.25 (pilots read back briskly). */
  rate: number;
  /** Kokoro voice id. */
  kokoroVoice: string;
  /** Kokoro speed, 1.0–1.2. */
  kokoroSpeed: number;
  /** Stable per-callsign number for picking among system voices. */
  seed: number;
}

/** Operators whose crews get a British voice. */
const GB_OPERATORS = new Set(['BAW', 'EIN', 'EZY', 'RYR', 'VIR']);

/** Kokoro English voices, rated B or better on the model card where there is a choice. */
export const KOKORO_VOICES: Readonly<Record<Accent, Readonly<Record<Gender, readonly string[]>>>> = {
  us: {
    male: ['am_adam', 'am_echo', 'am_eric', 'am_liam', 'am_michael', 'am_onyx', 'am_puck'],
    female: ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_nova', 'af_river'],
  },
  gb: {
    male: ['bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'],
    female: ['bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily'],
  },
};

/** FNV-1a, 32 bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Share of female pilots' voices. */
const FEMALE_SHARE = 0.25;

export function pilotVoice(callsign: string): PilotVoice {
  const cs = callsign.toUpperCase();
  const seed = hash32(cs);
  // Independent "dice" from different bits of the hash.
  const dice = (shift: number, n: number) => (seed >>> shift) % n;
  const gender: Gender = dice(0, 100) < FEMALE_SHARE * 100 ? 'female' : 'male';
  const accent: Accent = GB_OPERATORS.has(cs.slice(0, 3)) ? 'gb' : 'us';
  const pool = KOKORO_VOICES[accent][gender];
  return {
    callsign: cs,
    gender,
    accent,
    lang: accent === 'gb' ? 'en-GB' : 'en-US',
    pitch: 0.85 + dice(7, 31) / 100,
    rate: 1.05 + dice(12, 21) / 100,
    kokoroVoice: pool[dice(17, pool.length)]!,
    kokoroSpeed: 1 + dice(22, 21) / 100,
    seed,
  };
}

/** The part of `SpeechSynthesisVoice` we use. */
export interface SystemVoice {
  name: string;
  lang: string;
  localService?: boolean;
}

// macOS novelty voices and other voices nobody would hear on frequency.
const NOVELTY =
  /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Grandma|Grandpa|Rocko|Shelley|Sandy|Flo|Eddy|Reed)\b/i;
const FEMALE_NAMES =
  /\b(female|Samantha|Karen|Moira|Tessa|Fiona|Victoria|Allison|Ava|Susan|Zira|Hazel|Serena|Kate|Martha|Catherine|Veena|Nicky|Libby|Sonia|Jenny|Aria|Emma|Joanna|Kendra|Kimberly|Salli|Ivy|Amy)\b/i;
const MALE_NAMES = /\b(male|Alex|Daniel|Fred|Tom|Oliver|Arthur|Aaron|David|Mark|George|James|Gordon|Rishi|Guy|Ryan|Thomas|Matthew|Joey|Justin|Brian)\b/i;

const genderOf = (v: SystemVoice): Gender | null =>
  /\bfemale\b/i.test(v.name) ? 'female' : MALE_NAMES.test(v.name) ? 'male' : FEMALE_NAMES.test(v.name) ? 'female' : null;

/**
 * Picks a system voice for a pilot: same accent first (any English otherwise),
 * same gender where the name tells it, then a stable choice by the callsign's seed.
 */
export function pickSystemVoice<V extends SystemVoice>(voices: readonly V[], pilot: PilotVoice): V | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name));
  if (english.length === 0) return null;
  const sameAccent = english.filter((v) => v.lang.replace('_', '-').toLowerCase() === pilot.lang.toLowerCase());
  const pool = sameAccent.length ? sameAccent : english;
  const sameGender = pool.filter((v) => genderOf(v) === pilot.gender);
  const pick = sameGender.length ? sameGender : pool;
  return pick[pilot.seed % pick.length]!;
}
