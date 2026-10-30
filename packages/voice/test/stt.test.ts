import { describe, expect, it } from 'vitest';
import {
  PcmRecognizer,
  STT_SAMPLE_RATE,
  WebSpeechRecognizer,
  joinSegments,
  pickTranscript,
  resample,
  trimSilence,
  type AudioSource,
  type PcmAudio,
  type RecognitionConstructor,
} from '../src';

/** Silence, then a 300 Hz tone ("speech"), then silence. */
function burst(rate: number, silenceS: number, speechS: number, amp = 0.3, noise = 0.001): PcmAudio {
  const n = Math.round((2 * silenceS + speechS) * rate);
  const samples = new Float32Array(n);
  const from = Math.round(silenceS * rate);
  const to = from + Math.round(speechS * rate);
  for (let i = 0; i < n; i++) {
    const s = i >= from && i < to ? amp * Math.sin((2 * Math.PI * 300 * i) / rate) : 0;
    samples[i] = s + noise * Math.sin(i * 12.9898);
  }
  return { samples, sampleRate: rate };
}

describe('resample', () => {
  it('keeps the duration and the signal', () => {
    const tone = burst(48000, 0, 1).samples;
    const out = resample(tone, 48000);
    expect(out.length).toBe(16000);
    // The 300 Hz tone survives the box filter almost unchanged.
    const peak = Math.max(...out.map(Math.abs));
    expect(peak).toBeGreaterThan(0.28);
    expect(resample(tone, 16000)).toBe(tone);
  });

  it('upsamples by interpolation', () => {
    const out = resample(new Float32Array([0, 1]), 8000, 16000);
    expect(Array.from(out)).toEqual([0, 0.5, 1, 1]);
  });
});

describe('trimSilence', () => {
  it('cuts the silence around speech, with padding', () => {
    const trimmed = trimSilence(burst(STT_SAMPLE_RATE, 1, 1))!;
    const s = trimmed.samples.length / STT_SAMPLE_RATE;
    expect(s).toBeGreaterThan(1.2);
    expect(s).toBeLessThan(1.4);
  });

  it('finds no transmission in silence, noise or a click', () => {
    expect(trimSilence(burst(STT_SAMPLE_RATE, 1, 0))).toBeNull();
    expect(trimSilence(burst(STT_SAMPLE_RATE, 1, 0.1))).toBeNull();
    expect(trimSilence({ samples: new Float32Array(0), sampleRate: STT_SAMPLE_RATE })).toBeNull();
  });

  it('keeps a recording that is speech from end to end', () => {
    const all = burst(STT_SAMPLE_RATE, 0, 1);
    expect(trimSilence(all)!.samples.length).toBe(all.samples.length);
  });
});

describe('PcmRecognizer', () => {
  const source = (audio: PcmAudio): AudioSource & { started: number } => ({
    started: 0,
    start() {
      this.started++;
    },
    stop: async () => audio,
    cancel: () => undefined,
  });

  it('sends 16 kHz speech to the model and returns its text', async () => {
    let heard: PcmAudio | null = null;
    const src = source(burst(48000, 0.5, 1));
    const r = new PcmRecognizer('moonshine', src, async (a) => {
      heard = a;
      return ' Delta 1192, descend and maintain 8,000. ';
    });
    r.start();
    expect(src.started).toBe(1);
    expect(await r.stop()).toEqual({
      alternatives: ['Delta 1192, descend and maintain 8,000.'],
      engine: 'moonshine',
    });
    expect(heard!.sampleRate).toBe(STT_SAMPLE_RATE);
    expect(heard!.samples.length).toBeLessThan(1.4 * STT_SAMPLE_RATE);
  });

  it('skips the model when nothing was said, and drops noise readings', async () => {
    let calls = 0;
    const silent = new PcmRecognizer('m', source(burst(48000, 1, 0)), async () => (calls++, 'Thank you.'));
    expect(await silent.stop()).toBeNull();
    expect(calls).toBe(0);
    const dots = new PcmRecognizer('m', source(burst(48000, 0.5, 1)), async () => ' ... ');
    expect(await dots.stop()).toBeNull();
  });
});

describe('n-best', () => {
  it('joins continuous-mode segments', () => {
    expect(joinSegments([['Delta 1192'], ['descend and maintain 8000', 'descend and maintain 800']])).toEqual([
      'Delta 1192 descend and maintain 8000',
      'Delta 1192 descend and maintain 800',
    ]);
    expect(joinSegments([])).toEqual([]);
  });

  it('picks the first alternative the grammar understands', () => {
    const t = { alternatives: ['delta eleven ninety to', 'delta 1192 climb 9000'], engine: 'browser' };
    expect(pickTranscript(t, (s) => s.includes('climb'))).toBe('delta 1192 climb 9000');
    expect(pickTranscript(t, () => false)).toBe('delta eleven ninety to');
  });
});

describe('WebSpeechRecognizer', () => {
  type Handlers = {
    onresult: ((e: { results: unknown }) => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    onend: (() => void) | null;
  };
  let last: (Handlers & { started: boolean; lang: string; maxAlternatives: number }) | null = null;
  let behaviour: (rec: Handlers) => void = () => undefined;

  class FakeRecognition {
    lang = '';
    continuous = false;
    interimResults = true;
    maxAlternatives = 1;
    started = false;
    onresult: Handlers['onresult'] = null;
    onerror: Handlers['onerror'] = null;
    onend: Handlers['onend'] = null;
    constructor() {
      last = this;
    }
    start() {
      this.started = true;
    }
    stop() {
      behaviour(this);
      this.onend?.();
    }
    abort() {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    }
  }
  const results = (...segments: string[][]) =>
    segments.map((alts) => Object.assign(alts.map((transcript) => ({ transcript })), { isFinal: true }));
  const Ctor = FakeRecognition as unknown as RecognitionConstructor;

  it('listens in English with n-best results', async () => {
    behaviour = (rec) => rec.onresult?.({ results: results(['Delta 1192 climb 9000', 'Delta 1192 climb 900']) });
    const r = new WebSpeechRecognizer(Ctor);
    r.start();
    expect(last).toMatchObject({ started: true, lang: 'en-US', maxAlternatives: 5 });
    expect(await r.stop()).toEqual({
      alternatives: ['Delta 1192 climb 9000', 'Delta 1192 climb 900'],
      engine: 'browser',
    });
  });

  it('returns null for no speech and throws for a broken engine', async () => {
    const r = new WebSpeechRecognizer(Ctor);
    behaviour = (rec) => rec.onerror?.({ error: 'no-speech' });
    r.start();
    expect(await r.stop()).toBeNull();
    behaviour = (rec) => rec.onerror?.({ error: 'not-allowed' });
    r.start();
    await expect(r.stop()).rejects.toThrow('not-allowed');
  });
});
