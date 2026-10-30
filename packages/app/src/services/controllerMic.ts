/**
 * Controller push-to-talk on the scope: one recogniser, three modes.
 *
 * - off: typing only.
 * - browser: the browser's own speech recognition (Web Speech) — no download;
 *   Chrome / Edge send the audio to their servers. Not in Firefox or Electron.
 * - moonshine: Moonshine base in a Web Worker, on the device. The model
 *   downloads once (≈ 63 MB); browser recognition stands in while it loads.
 *
 * `press` on PTT down, `release` on PTT up → the transcript (or null: nothing said).
 */
import {
  MicCapture,
  PcmRecognizer,
  WebSpeechRecognizer,
  recognitionConstructor,
  type SpeechToText,
  type Transcribe,
  type Transcript,
} from '@atc-app/voice';
import type { SttReply, SttRequest } from '@/workers/stt.worker';

export const MIC_MODES = ['off', 'browser', 'moonshine'] as const;
export type MicMode = (typeof MIC_MODES)[number];

export interface ControllerMicStatus {
  mode: MicMode;
  /** Engine listening now: may be 'browser' (or 'off') while Moonshine loads. */
  engine: 'off' | 'browser' | 'moonshine';
  /** Moonshine download / load progress, 0–1, while loading. */
  loading: number | null;
  error: string | null;
  /** PTT down / transcribing after release. */
  state: 'idle' | 'listening' | 'recognising';
}

/** Electron's Chromium has the API but no Google key: every attempt fails with "network". */
const browserRecognition = () =>
  typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)
    ? null
    : recognitionConstructor();

/** Modes this platform can run (the selector hides the rest). */
export function availableMicModes(): MicMode[] {
  const modes: MicMode[] = ['off'];
  if (browserRecognition()) modes.push('browser');
  if (typeof Worker !== 'undefined' && MicCapture.available()) modes.push('moonshine');
  return modes;
}

/** What went wrong, for the command line's error line. */
function micError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const text = err instanceof Error ? err.message : String(err);
  if (name === 'NotAllowedError' || /not-allowed/.test(text))
    return 'Microphone blocked: allow it for this site in the browser settings';
  if (name === 'NotFoundError' || /audio-capture/.test(text)) return 'No microphone found';
  if (/network/.test(text)) return 'Browser speech recognition is offline: try MIC MOONSHINE';
  return text;
}

export class ControllerMic {
  private browser: WebSpeechRecognizer | null = null;
  private moonshine: PcmRecognizer | null = null;
  private mic: MicCapture | null = null;
  private worker: Worker | null = null;
  private active: SpeechToText | null = null;
  private status: ControllerMicStatus = {
    mode: 'off',
    engine: 'off',
    loading: null,
    error: null,
    state: 'idle',
  };
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (t: string) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly onStatus: (s: ControllerMicStatus) => void) {}

  get engine(): ControllerMicStatus['engine'] {
    return this.status.engine;
  }

  setMode(mode: MicMode): void {
    this.cancel();
    this.update({ mode, error: null });
    if (mode === 'off') {
      this.mic?.close();
      this.use(null, 'off');
      return;
    }
    if (mode === 'browser' || !this.moonshine) this.use(this.browserEngine(), 'browser');
    if (mode === 'moonshine') {
      if (this.moonshine) this.use(this.moonshine, 'moonshine');
      else this.loadMoonshine();
    }
  }

  /** PTT down. False when no engine can listen (mode off, still loading). */
  press(): boolean {
    if (!this.active || this.status.state !== 'idle') return false;
    this.update({ state: 'listening', error: null });
    this.active.start();
    if (this.active === this.moonshine)
      this.mic?.open().catch((err: unknown) => this.update({ error: micError(err) }));
    return true;
  }

  /** PTT up: what the controller said. */
  async release(): Promise<Transcript | null> {
    const engine = this.active;
    if (!engine || this.status.state !== 'listening') return null;
    this.update({ state: 'recognising' });
    try {
      return await engine.stop();
    } catch (err) {
      this.update({ error: micError(err) });
      return null;
    } finally {
      this.update({ state: 'idle' });
      // Moonshine finished loading during this transmission: it takes the next one.
      if (this.status.mode === 'moonshine' && this.moonshine && this.active !== this.moonshine)
        this.use(this.moonshine, 'moonshine');
    }
  }

  cancel(): void {
    this.active?.cancel();
    if (this.status.state !== 'idle') this.update({ state: 'idle' });
  }

  dispose(): void {
    this.cancel();
    this.mic?.close();
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error('disposed'));
    this.pending.clear();
  }

  private update(patch: Partial<ControllerMicStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  private use(engine: SpeechToText | null, id: ControllerMicStatus['engine']): void {
    this.active = engine;
    this.update({ engine: engine ? id : 'off' });
  }

  private browserEngine(): WebSpeechRecognizer | null {
    const Ctor = browserRecognition();
    if (!this.browser && Ctor) this.browser = new WebSpeechRecognizer(Ctor);
    return this.browser;
  }

  private loadMoonshine(): void {
    if (this.worker) return;
    if (typeof Worker === 'undefined' || !MicCapture.available()) {
      this.update({ error: 'Moonshine needs a microphone and Web Workers' });
      return;
    }
    const worker = new Worker(new URL('../workers/stt.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    this.update({ loading: 0 });
    worker.addEventListener('message', (e: MessageEvent<SttReply>) => this.onReply(e.data));
    worker.addEventListener('error', (e) => this.moonshineFailed(e.message || 'worker error'));
    const req: SttRequest = { op: 'load', device: 'wasm' };
    worker.postMessage(req);
  }

  private onReply(r: SttReply): void {
    switch (r.type) {
      case 'progress':
        this.update({ loading: r.fraction });
        break;
      case 'ready': {
        const transcribe: Transcribe = (audio) =>
          new Promise((resolve, reject) => {
            const id = ++this.nextId;
            this.pending.set(id, { resolve, reject });
            const req: SttRequest = {
              op: 'transcribe',
              id,
              samples: audio.samples,
              sampleRate: audio.sampleRate,
            };
            this.worker?.postMessage(req, [audio.samples.buffer]);
          });
        this.mic ??= new MicCapture();
        this.moonshine = new PcmRecognizer('moonshine', this.mic, transcribe);
        this.update({ loading: null });
        // Not while the browser engine is mid-transmission: the next press uses Moonshine.
        if (this.status.mode === 'moonshine' && this.status.state === 'idle')
          this.use(this.moonshine, 'moonshine');
        break;
      }
      case 'load-failed':
        this.moonshineFailed(r.error);
        break;
      case 'text':
        this.pending.get(r.id)?.resolve(r.text);
        this.pending.delete(r.id);
        break;
      case 'transcribe-failed':
        this.pending.get(r.id)?.reject(new Error(r.error));
        this.pending.delete(r.id);
        break;
    }
  }

  private moonshineFailed(error: string): void {
    this.worker?.terminate();
    this.worker = null;
    // Browser recognition keeps listening where there is one (setMode already switched to it).
    this.update({ loading: null, error: `Moonshine: ${error}` });
  }
}
