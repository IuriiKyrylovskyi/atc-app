/**
 * Pilot voices on the scope: one radio channel, three modes.
 *
 * - off: silent (the comms log still prints everything).
 * - system: OS voices through Web Speech, no download.
 * - kokoro: Kokoro-82M in a Web Worker, through the VHF radio filter. The model
 *   downloads once (≈ 92 MB); system voices speak while it loads, and if it fails.
 *
 * Start it from a user gesture (a click / key press): browsers only let audio
 * start after one.
 */
import {
  KokoroEngine,
  RadioChannel,
  RadioFx,
  WebSpeechEngine,
  type PcmAudio,
  type SpeechEngine,
  type Synthesize,
  type Transmission,
} from '@atc-app/voice';
import type { TtsReply, TtsRequest } from '@/workers/tts.worker';

export const VOICE_MODES = ['off', 'system', 'kokoro'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export interface RadioVoiceStatus {
  mode: VoiceMode;
  /** Engine speaking now: may be 'system' while Kokoro loads. */
  engine: 'off' | 'system' | 'kokoro';
  /** Kokoro download / load progress, 0–1, while loading. */
  loading: number | null;
  error: string | null;
  /** Pilot transmitting now. */
  speaking: Transmission | null;
}

export class RadioVoice {
  private ctx: AudioContext | null = null;
  private radio: RadioFx | null = null;
  private worker: Worker | null = null;
  private kokoro: KokoroEngine | null = null;
  private system: WebSpeechEngine | null = null;
  private readonly channel: RadioChannel;
  private status: RadioVoiceStatus = {
    mode: 'off',
    engine: 'off',
    loading: null,
    error: null,
    speaking: null,
  };
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (a: PcmAudio) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly onStatus: (s: RadioVoiceStatus) => void) {
    this.channel = new RadioChannel(null, { onTransmit: (t) => this.update({ speaking: t }) });
  }

  setMode(mode: VoiceMode): void {
    this.update({ mode, error: null });
    if (mode === 'off') {
      this.use(null, 'off');
      return;
    }
    this.ensureAudio();
    if (mode === 'system' || !this.kokoro) this.use(this.systemEngine(), 'system');
    if (mode === 'kokoro') {
      if (this.kokoro) this.use(this.kokoro, 'kokoro');
      else this.loadKokoro();
    }
  }

  /** A pilot transmission (spoken form). */
  say(callsign: string, text: string): void {
    this.channel.say(callsign, text);
  }

  /** Silences the frequency (scenario change, pause). */
  clear(): void {
    this.channel.clear();
  }

  dispose(): void {
    this.channel.setEngine(null);
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error('disposed'));
    this.pending.clear();
    this.radio?.dispose();
    void this.ctx?.close();
    this.ctx = null;
  }

  private update(patch: Partial<RadioVoiceStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  private use(engine: SpeechEngine | null, id: RadioVoiceStatus['engine']): void {
    this.channel.setEngine(engine);
    this.update({ engine: engine ? id : 'off' });
  }

  private ensureAudio(): void {
    if (typeof AudioContext === 'undefined') return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.radio ??= new RadioFx(this.ctx);
  }

  private systemEngine(): WebSpeechEngine | null {
    if (!this.system && WebSpeechEngine.available())
      this.system = new WebSpeechEngine(speechSynthesis, this.radio);
    return this.system;
  }

  private loadKokoro(): void {
    if (this.worker || !this.ctx || !this.radio || typeof Worker === 'undefined') {
      if (!this.worker) this.update({ error: 'Kokoro needs Web Audio and Web Workers' });
      return;
    }
    const worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    this.update({ loading: 0 });
    worker.addEventListener('message', (e: MessageEvent<TtsReply>) => this.onReply(e.data));
    worker.addEventListener('error', (e) => this.kokoroFailed(e.message || 'worker error'));
    const req: TtsRequest = { op: 'load', device: 'wasm' };
    worker.postMessage(req);
  }

  private onReply(r: TtsReply): void {
    switch (r.type) {
      case 'progress':
        this.update({ loading: r.fraction });
        break;
      case 'ready': {
        const synth: Synthesize = (text, voice, speed) =>
          new Promise((resolve, reject) => {
            const id = ++this.nextId;
            this.pending.set(id, { resolve, reject });
            const req: TtsRequest = { op: 'say', id, text, voice, speed };
            this.worker?.postMessage(req);
          });
        this.kokoro = new KokoroEngine(this.ctx!, synth, this.radio!);
        this.update({ loading: null });
        if (this.status.mode === 'kokoro') this.use(this.kokoro, 'kokoro');
        break;
      }
      case 'load-failed':
        this.kokoroFailed(r.error);
        break;
      case 'audio':
        this.pending.get(r.id)?.resolve({ samples: r.samples, sampleRate: r.sampleRate });
        this.pending.delete(r.id);
        break;
      case 'say-failed':
        this.pending.get(r.id)?.reject(new Error(r.error));
        this.pending.delete(r.id);
        break;
    }
  }

  private kokoroFailed(error: string): void {
    this.worker?.terminate();
    this.worker = null;
    // System voices keep speaking (setMode already switched to them).
    this.update({ loading: null, error: `Kokoro: ${error}` });
  }
}
