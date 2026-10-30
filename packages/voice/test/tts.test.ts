import { describe, expect, it } from 'vitest';
import {
  KOKORO_VOICES,
  KokoroEngine,
  RadioChannel,
  clauses,
  hash32,
  pickSystemVoice,
  pilotVoice,
  softClipCurve,
  type PilotVoice,
  type SpeechEngine,
  type Transmission,
} from '../src';

describe('pilot voices', () => {
  it('gives every callsign one stable voice', () => {
    expect(pilotVoice('DAL1192')).toEqual(pilotVoice('dal1192'));
    expect(hash32('DAL1192')).toBe(hash32('DAL1192'));
    const v = pilotVoice('UAL1771');
    expect(v.pitch).toBeGreaterThanOrEqual(0.85);
    expect(v.pitch).toBeLessThanOrEqual(1.15);
    expect(v.rate).toBeGreaterThanOrEqual(1.05);
    expect(v.rate).toBeLessThanOrEqual(1.25);
    expect(v.kokoroSpeed).toBeGreaterThanOrEqual(1);
    expect(v.kokoroSpeed).toBeLessThanOrEqual(1.2);
  });

  it('matches accent to the operator and the Kokoro voice to accent and gender', () => {
    expect(pilotVoice('BAW117')).toMatchObject({ accent: 'gb', lang: 'en-GB' });
    expect(pilotVoice('RYR8QK').accent).toBe('gb');
    expect(pilotVoice('DAL1192')).toMatchObject({ accent: 'us', lang: 'en-US' });
    for (let i = 0; i < 200; i++) {
      const v = pilotVoice(`TST${i}`);
      expect(KOKORO_VOICES[v.accent][v.gender]).toContain(v.kokoroVoice);
    }
  });

  it('varies voices across a busy frequency, mostly male', () => {
    const voices = Array.from({ length: 400 }, (_, i) => pilotVoice(`AAL${100 + i}`));
    const female = voices.filter((v) => v.gender === 'female').length / voices.length;
    expect(female).toBeGreaterThan(0.15);
    expect(female).toBeLessThan(0.35);
    expect(new Set(voices.map((v) => v.kokoroVoice)).size).toBeGreaterThanOrEqual(10);
  });
});

describe('system voice choice', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Alex', lang: 'en-US' },
    { name: 'Fred', lang: 'en-US' },
    { name: 'Daniel', lang: 'en-GB' },
    { name: 'Kate', lang: 'en_GB' },
    { name: 'Bubbles', lang: 'en-US' },
    { name: 'Thomas', lang: 'fr-FR' },
  ];
  const pilot = (over: Partial<PilotVoice>): PilotVoice => ({ ...pilotVoice('DAL1192'), ...over });

  it('prefers same accent and gender, never novelty or non-English voices', () => {
    expect(pickSystemVoice(voices, pilot({ lang: 'en-GB', gender: 'male' }))?.name).toBe('Daniel');
    expect(pickSystemVoice(voices, pilot({ lang: 'en-GB', gender: 'female' }))?.name).toBe('Kate');
    expect(pickSystemVoice(voices, pilot({ lang: 'en-US', gender: 'female' }))?.name).toBe('Samantha');
    for (let seed = 0; seed < 10; seed++) {
      expect(['Alex', 'Fred']).toContain(pickSystemVoice(voices, pilot({ lang: 'en-US', gender: 'male', seed }))?.name);
    }
  });

  it('falls back to any English voice, or none', () => {
    expect(pickSystemVoice([{ name: 'Karen', lang: 'en-AU' }], pilot({ lang: 'en-GB' }))?.name).toBe('Karen');
    expect(pickSystemVoice([{ name: 'Thomas', lang: 'fr-FR' }], pilot({}))).toBeNull();
  });
});

describe('radio channel', () => {
  /** Engine that records what it says; each transmission ends when `finish` is called. */
  function fakeEngine() {
    const said: { text: string; voice: PilotVoice }[] = [];
    let finish: (() => void) | null = null;
    let cancelled = 0;
    const engine: SpeechEngine = {
      id: 'fake',
      speak: (text, voice) =>
        new Promise<void>((resolve) => {
          said.push({ text, voice });
          finish = resolve;
        }),
      cancel: () => {
        cancelled++;
        finish?.();
      },
    };
    return {
      engine,
      said,
      end: () => finish?.(),
      get cancelled() {
        return cancelled;
      },
    };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const noSleep = () => Promise.resolve();

  it('speaks one transmission at a time, in order, in the pilot voice', async () => {
    const f = fakeEngine();
    const on: (Transmission | null)[] = [];
    const ch = new RadioChannel(f.engine, { sleep: noSleep, onTransmit: (t) => on.push(t) });
    ch.say('DAL1192', 'descend and maintain eight thousand, Delta one one niner two');
    ch.say('UAL1771', 'say again, United one seven seven one');
    await tick();
    expect(f.said.map((s) => s.text)).toEqual(['descend and maintain eight thousand, Delta one one niner two']);
    expect(f.said[0]!.voice).toEqual(pilotVoice('DAL1192'));
    f.end();
    await tick();
    expect(f.said).toHaveLength(2);
    expect(f.said[1]!.voice.callsign).toBe('UAL1771');
    f.end();
    await tick();
    expect(ch.busy).toBe(false);
    expect(on.map((t) => t?.callsign ?? null)).toEqual(['DAL1192', null, 'UAL1771', null]);
  });

  it('drops the oldest waiting transmissions beyond the queue limit', async () => {
    const f = fakeEngine();
    const ch = new RadioChannel(f.engine, { sleep: noSleep, maxQueue: 2 });
    for (const cs of ['A1', 'A2', 'A3', 'A4']) ch.say(cs, cs);
    expect(ch.waiting.map((t) => t.text)).toEqual(['A3', 'A4']);
  });

  it('clear stops the speaker and the queue; muted channels say nothing', async () => {
    const f = fakeEngine();
    const ch = new RadioChannel(f.engine, { sleep: noSleep });
    ch.say('DAL1192', 'one');
    ch.say('DAL1192', 'two');
    await tick();
    ch.clear();
    await tick();
    expect(f.cancelled).toBe(1);
    expect(f.said.map((s) => s.text)).toEqual(['one']);
    ch.say('DAL1192', 'three');
    await tick();
    expect(f.said.map((s) => s.text)).toEqual(['one', 'three']);

    const muted = new RadioChannel(null, { sleep: noSleep });
    muted.say('DAL1192', 'nothing');
    expect(muted.waiting).toHaveLength(0);
  });
});

describe('Kokoro streaming', () => {
  it('splits at commas and keeps short pieces with their neighbours', () => {
    expect(clauses('turn left heading two two zero, descend and maintain six thousand, Delta one one niner two')).toEqual([
      'turn left heading two two zero',
      'descend and maintain six thousand',
      'Delta one one niner two',
    ]);
    expect(clauses('unable, above our ceiling, Delta one one niner two')).toEqual([
      'unable, above our ceiling',
      'Delta one one niner two',
    ]);
    expect(clauses('say again, KLM 6')).toEqual(['say again, KLM 6']);
  });

  /** Audio clock that runs only when told; sources end when the clock passes them. */
  function fakeAudio() {
    const started: { at: number; dur: number; src: { onended: (() => void) | null } }[] = [];
    const ctx = {
      currentTime: 0,
      state: 'running',
      resume: async () => undefined,
      createBuffer: (_ch: number, n: number, rate: number) => ({ duration: n / rate, copyToChannel: () => undefined }),
      createBufferSource: () => {
        const src = {
          buffer: null as { duration: number } | null,
          onended: null as (() => void) | null,
          connect: () => undefined,
          start: (at: number) => started.push({ at, dur: src.buffer!.duration, src }),
          stop: () => src.onended?.(),
        };
        return src;
      },
    };
    const advance = (t: number) => {
      ctx.currentTime = t;
      for (const s of started) if (s.at + s.dur <= t && s.src.onended) {
        const end = s.src.onended;
        s.src.onended = null;
        end();
      }
    };
    const keys: string[] = [];
    const radio = { input: {}, keyUp: () => keys.push('up'), keyDown: () => keys.push('down') };
    return { ctx, radio, started, advance, keys };
  }

  it('plays clause 1 while clause 2 synthesises, back to back on the audio clock', async () => {
    const a = fakeAudio();
    const asked: string[] = [];
    const pending: ((pcm: { samples: Float32Array<ArrayBuffer>; sampleRate: number }) => void)[] = [];
    const synth = (text: string) =>
      new Promise<{ samples: Float32Array<ArrayBuffer>; sampleRate: number }>((resolve) => {
        asked.push(text);
        pending.push(resolve);
      });
    const engine = new KokoroEngine(a.ctx as never, synth, a.radio as never);
    const done = engine.speak('reduce speed to two one zero, Delta one one niner two', pilotVoice('DAL1192'));
    const tick = () => new Promise((r) => setTimeout(r, 0));

    await tick();
    expect(asked).toEqual(['reduce speed to two one zero']);
    pending[0]!({ samples: new Float32Array(24_000 * 2), sampleRate: 24_000 }); // 2 s
    await tick();
    // Clause 1 is playing and clause 2 already asked for.
    expect(a.started).toHaveLength(1);
    expect(a.started[0]!.at).toBeCloseTo(0.05);
    expect(asked).toHaveLength(2);
    pending[1]!({ samples: new Float32Array(24_000), sampleRate: 24_000 }); // 1 s
    await tick();
    // Queued right after clause 1 plus the comma pause.
    expect(a.started[1]!.at).toBeCloseTo(0.05 + 2 + 0.12);
    a.advance(10);
    await done;
    expect(a.keys).toEqual(['up', 'down']);
  });

  it('cancel stops scheduled clauses and drops the look-ahead', async () => {
    const a = fakeAudio();
    const pending: ((pcm: { samples: Float32Array<ArrayBuffer>; sampleRate: number }) => void)[] = [];
    const synth = () => new Promise<{ samples: Float32Array<ArrayBuffer>; sampleRate: number }>((r) => pending.push(r));
    const engine = new KokoroEngine(a.ctx as never, synth, a.radio as never);
    const done = engine.speak('turn left heading two two zero, descend and maintain six thousand', pilotVoice('DAL1192'));
    await new Promise((r) => setTimeout(r, 0));
    pending[0]!({ samples: new Float32Array(24_000), sampleRate: 24_000 });
    await new Promise((r) => setTimeout(r, 0));
    engine.cancel();
    pending[1]!({ samples: new Float32Array(24_000), sampleRate: 24_000 });
    await done;
    expect(a.started).toHaveLength(1);
    expect(a.keys).toEqual(['up', 'down']);
  });
});

describe('radio effect', () => {
  it('soft-clips symmetrically and keeps full scale', () => {
    const c = softClipCurve(3, 101);
    expect(c[0]).toBeCloseTo(-1);
    expect(c[50]).toBeCloseTo(0);
    expect(c[100]).toBeCloseTo(1);
    expect(c[75]).toBeGreaterThan(0.5); // driven: louder than linear
  });
});
